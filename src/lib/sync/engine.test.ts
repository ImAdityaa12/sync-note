import "fake-indexeddb/auto";

import { describe, expect, it } from "vitest";

import type { Op } from "@/lib/crdt/codec";
import { RGA } from "@/lib/crdt/rga";
import {
  appendOps,
  getPendingOps,
  loadDocumentRecord,
} from "@/lib/local/repo";

import { SyncEngine } from "./engine";
import type { SyncTransport } from "./transport";

/**
 * In-memory stand-in for the server route: an idempotent op store with a global
 * seq, per document. Acts as the "other side" so a single local client (one fake
 * IndexedDB) can be tested without two clients sharing local state.
 */
function makeServer() {
  const docs = new Map<string, Map<string, { seq: number; op: Op }>>();
  let seq = 0;

  const key = (op: Op) =>
    op.type === "insert"
      ? `${op.id.counter}@${op.id.site}`
      : `del:${op.id.counter}@${op.id.site}`;

  const store = (docId: string) => {
    let m = docs.get(docId);
    if (!m) docs.set(docId, (m = new Map()));
    return m;
  };

  const transport: SyncTransport = {
    async push(docId, ops) {
      const m = store(docId);
      for (const op of ops) {
        const k = key(op);
        if (!m.has(k)) m.set(k, { seq: ++seq, op }); // idempotent
      }
      return { ok: true, latestSeq: seq };
    },
    async pull(docId, since) {
      const all = [...store(docId).values()]
        .filter((e) => e.seq > since)
        .sort((a, b) => a.seq - b.seq);
      return {
        ops: all.map((e) => e.op),
        latestSeq: all.length ? all[all.length - 1].seq : since,
        hasMore: false,
      };
    },
  };

  return { transport };
}

const noop = () => {};

function engineFor(
  docId: string,
  rga: RGA,
  transport: SyncTransport,
  canPush = true
) {
  return new SyncEngine({
    docId,
    rga,
    canPush,
    transport,
    onRemoteApplied: noop,
    onStatus: noop,
  });
}

describe("SyncEngine", () => {
  it("pushes queued ops and prunes the oplog once acked", async () => {
    const docId = "doc-push";
    const { transport } = makeServer();

    const rga = new RGA("A");
    await appendOps(docId, rga.insertAt(0, "hello"));
    expect(await getPendingOps(docId)).toHaveLength(5);

    await engineFor(docId, rga, transport).sync();

    expect(await getPendingOps(docId)).toHaveLength(0); // pruned
    expect((await transport.pull(docId, 0)).ops).toHaveLength(5); // durable on server
  });

  it("pulls remote ops, converges, and persists them (reload-safe)", async () => {
    const docId = "doc-reload";
    const { transport } = makeServer();

    // A remote device publishes content this client never authored.
    const remote = new RGA("X");
    await transport.push(docId, remote.insertAt(0, "remote text"));

    const local = new RGA("C");
    await engineFor(docId, local, transport).sync();
    expect(local.toString()).toBe("remote text");

    // Simulate a reload: rebuild purely from the persisted snapshot. This fails
    // if the cursor was advanced past ops that weren't snapshotted.
    const record = await loadDocumentRecord(docId);
    expect(record?.crdtState).toBeDefined();
    expect(RGA.fromSnapshot(record!.crdtState!, "C").toString()).toBe(
      "remote text"
    );
  });

  it("never loses offline edits — all queued ops reach the server on reconnect", async () => {
    const docId = "doc-offline";
    const { transport } = makeServer();

    // Edit "offline": queue ops without syncing.
    const rga = new RGA("A");
    await appendOps(docId, rga.insertAt(0, "first "));
    await appendOps(docId, rga.insertAt(rga.length, "second"));
    expect(await getPendingOps(docId)).toHaveLength(12);

    await engineFor(docId, rga, transport).sync(); // reconnect

    expect(await getPendingOps(docId)).toHaveLength(0);
    expect((await transport.pull(docId, 0)).ops).toHaveLength(12);
  });

  it("is idempotent across repeated syncs — no duplicate ops", async () => {
    const docId = "doc-idem";
    const { transport } = makeServer();

    const rga = new RGA("A");
    await appendOps(docId, rga.insertAt(0, "abc"));

    const engine = engineFor(docId, rga, transport);
    await engine.sync();
    await engine.sync(); // re-run must not duplicate

    expect(await getPendingOps(docId)).toHaveLength(0);
    expect((await transport.pull(docId, 0)).ops).toHaveLength(3);
    expect(rga.toString()).toBe("abc");
  });

  it("does not push when the client is a viewer (canPush=false)", async () => {
    const docId = "doc-viewer";
    const { transport } = makeServer();

    const rga = new RGA("V");
    await appendOps(docId, rga.insertAt(0, "x"));

    await engineFor(docId, rga, transport, false).sync();

    // Nothing pushed; ops stay queued locally.
    expect((await transport.pull(docId, 0)).ops).toHaveLength(0);
    expect(await getPendingOps(docId)).toHaveLength(1);
  });
});
