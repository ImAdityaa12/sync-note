import "fake-indexeddb/auto";

import { describe, expect, it } from "vitest";

import type { Op } from "@/lib/crdt/codec";
import { RGA } from "@/lib/crdt/rga";
import { appendOps, getPendingOps } from "@/lib/local/repo";

import { OutboundQueue } from "./outbound";

/**
 * The websocket push path. The queue drains the durable oplog one batch at a
 * time, and only prunes after the relay acks — durability lives on the socket
 * now that the HTTP poll is gone. We stub `send` (the socket) and drive acks /
 * (dis)connects by hand, with the ack timer disabled for determinism.
 */
function makeQueue(docId: string, canPush = true) {
  const sent: Op[][] = [];
  let connected = true;
  const q = new OutboundQueue({
    docId,
    canPush,
    send: (ops) => {
      if (!connected) return false;
      sent.push(ops);
      return true;
    },
    ackTimeoutMs: 0, // no timer; acks are driven explicitly in the tests
  });
  return { q, sent, setConnected: (v: boolean) => (connected = v) };
}

describe("OutboundQueue", () => {
  it("sends queued ops over the socket and prunes them only on ack", async () => {
    const docId = "out-push";
    const rga = new RGA("A");
    await appendOps(docId, rga.insertAt(0, "hi"));

    const { q, sent } = makeQueue(docId);
    await q.kick();

    expect(sent).toHaveLength(1);
    expect(sent[0]).toHaveLength(2);
    expect(await getPendingOps(docId)).toHaveLength(2); // not pruned until acked

    await q.onAck();
    expect(await getPendingOps(docId)).toHaveLength(0); // pruned
  });

  it("keeps one batch in flight — new edits wait for the ack", async () => {
    const docId = "out-inflight";
    const rga = new RGA("A");
    await appendOps(docId, rga.insertAt(0, "ab"));

    const { q, sent } = makeQueue(docId);
    await q.kick(); // sends [a, b]
    expect(sent).toHaveLength(1);

    await appendOps(docId, rga.insertAt(rga.length, "c"));
    await q.kick(); // a batch is outstanding → nothing new goes out
    expect(sent).toHaveLength(1);

    await q.onAck(); // prunes [a, b], then drains the next batch
    expect(sent).toHaveLength(2);
    expect(sent[1]).toHaveLength(1); // just [c]
    await q.onAck();
    expect(await getPendingOps(docId)).toHaveLength(0);
  });

  it("never sends for a viewer (canPush=false) — ops stay queued", async () => {
    const docId = "out-viewer";
    const rga = new RGA("V");
    await appendOps(docId, rga.insertAt(0, "x"));

    const { q, sent } = makeQueue(docId, false);
    await q.kick();

    expect(sent).toHaveLength(0);
    expect(await getPendingOps(docId)).toHaveLength(1);
  });

  it("releases the in-flight batch on disconnect and re-sends on reconnect", async () => {
    const docId = "out-reconnect";
    const rga = new RGA("A");
    await appendOps(docId, rga.insertAt(0, "ab"));

    const { q, sent } = makeQueue(docId);
    await q.kick(); // sends [a, b]
    expect(sent).toHaveLength(1);

    q.onDisconnect(); // ack never arrived
    await q.onConnect(); // reconnect → re-send the still-queued ops
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0]);

    await q.onAck();
    expect(await getPendingOps(docId)).toHaveLength(0);
  });

  it("stays queued while the socket is down, then drains on connect", async () => {
    const docId = "out-offline";
    const rga = new RGA("A");
    await appendOps(docId, rga.insertAt(0, "ab"));

    const { q, sent, setConnected } = makeQueue(docId);
    setConnected(false);
    await q.kick(); // send() returns false → nothing leaves, nothing outstanding
    expect(sent).toHaveLength(0);
    expect(await getPendingOps(docId)).toHaveLength(2);

    setConnected(true);
    await q.onConnect();
    expect(sent).toHaveLength(1);
    await q.onAck();
    expect(await getPendingOps(docId)).toHaveLength(0);
  });
});
