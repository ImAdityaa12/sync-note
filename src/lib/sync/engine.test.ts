import "fake-indexeddb/auto";

import { describe, expect, it } from "vitest";

import type { Op } from "@/lib/crdt/codec";
import { RGA } from "@/lib/crdt/rga";
import { loadDocumentRecord, saveSnapshot } from "@/lib/local/repo";

import { SyncEngine } from "./engine";
import type { SyncTransport } from "./transport";

/**
 * In-memory stand-in for the server route: an idempotent op store with a global
 * seq, per document. Acts as the "other side" so a single local client (one fake
 * IndexedDB) can be tested without two clients sharing local state.
 *
 * The engine is now **pull-only** — pushing local edits lives in `OutboundQueue`
 * (see `outbound.test.ts`), so these tests only need the pull side.
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

function engineFor(docId: string, rga: RGA, transport: SyncTransport) {
  return new SyncEngine({
    docId,
    rga,
    transport,
    onRemoteApplied: noop,
    onState: noop,
    persist: () => saveSnapshot(docId, rga.snapshot()),
  });
}

describe("SyncEngine (pull-only catch-up)", () => {
  it("pulls remote ops, converges, and persists them (reload-safe)", async () => {
    const docId = "doc-reload";
    const { transport } = makeServer();

    // A remote device publishes content this client never authored.
    const remote = new RGA("X");
    await transport.push(docId, remote.insertAt(0, "remote text"));

    const local = new RGA("C");
    await engineFor(docId, local, transport).catchUp();
    expect(local.toString()).toBe("remote text");

    // Simulate a reload: rebuild purely from the persisted snapshot. This fails
    // if the cursor was advanced past ops that weren't snapshotted.
    const record = await loadDocumentRecord(docId);
    expect(record?.crdtState).toBeDefined();
    expect(RGA.fromSnapshot(record!.crdtState!, "C").toString()).toBe(
      "remote text"
    );
  });

  it("persists ops already applied live, before advancing the cursor", async () => {
    const docId = "doc-ws-first";
    const { transport } = makeServer();

    // A remote device publishes ops.
    const remote = new RGA("X");
    await transport.push(docId, remote.insertAt(0, "live"));

    // The realtime path applies them to the in-memory CRDT *before* the engine
    // pulls, so the engine sees them as already-applied (no new op) — yet it must
    // still persist them or a reload (after the cursor advances) would skip them.
    const local = new RGA("C");
    for (const e of (await transport.pull(docId, 0)).ops) local.apply(e);
    expect(local.toString()).toBe("live");

    await engineFor(docId, local, transport).catchUp();

    const record = await loadDocumentRecord(docId);
    expect(RGA.fromSnapshot(record!.crdtState!, "C").toString()).toBe("live");
  });

  it("is idempotent across repeated catch-ups — applies each op once", async () => {
    const docId = "doc-pull-idem";
    const { transport } = makeServer();

    const remote = new RGA("X");
    await transport.push(docId, remote.insertAt(0, "abc"));

    const local = new RGA("C");
    const engine = engineFor(docId, local, transport);
    await engine.catchUp();
    await engine.catchUp(); // re-run must not duplicate or corrupt

    expect(local.toString()).toBe("abc");
  });
});
