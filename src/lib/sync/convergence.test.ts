import "fake-indexeddb/auto";

import { describe, expect, it } from "vitest";

import type { Op } from "@/lib/crdt/codec";
import { RGA } from "@/lib/crdt/rga";
import {
  appendOps,
  getPendingOps,
  loadDocumentRecord,
  saveSnapshot,
} from "@/lib/local/repo";

import { SyncEngine } from "./engine";
import type { SyncTransport } from "./transport";

/**
 * Multi-client integration tests — the Phase D/E definition of done at the
 * system level: "two tabs, one offline, both edit, reconnect → identical docs."
 *
 * Each client is a *real* `SyncEngine` driving a real `RGA` over the real
 * IndexedDB local store (`fake-indexeddb`), so this exercises the full path:
 * drain oplog → push → prune → pull → merge → persist → advance cursor.
 *
 * The two clients share one in-memory "server" but must have isolated local
 * stores (one fake IndexedDB per process). We give each engine a distinct local
 * docId (`shared@A`, `shared@B`) so their oplog/cursor/snapshot rows never
 * collide, and the transport collapses both back onto the single server document
 * (everything before the `@`). That's the test-rig equivalent of two browser
 * tabs talking to the same server row.
 */
function makeSharedServer() {
  const store = new Map<string, { seq: number; op: Op }>();
  let seq = 0;

  const opKey = (op: Op) =>
    op.type === "insert"
      ? `${op.id.counter}@${op.id.site}`
      : `del:${op.id.counter}@${op.id.site}`;

  const transport: SyncTransport = {
    async push(_docId, ops) {
      for (const op of ops) {
        const k = opKey(op);
        if (!store.has(k)) store.set(k, { seq: ++seq, op }); // idempotent
      }
      return { ok: true, latestSeq: seq };
    },
    async pull(_docId, since) {
      const all = [...store.values()]
        .filter((e) => e.seq > since)
        .sort((a, b) => a.seq - b.seq);
      return {
        ops: all.map((e) => e.op),
        latestSeq: all.length ? all[all.length - 1].seq : since,
        hasMore: false,
      };
    },
  };

  return { transport, size: () => store.size };
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
    persist: () => saveSnapshot(docId, rga.snapshot()),
  });
}

describe("multi-client convergence (Phase D/E DoD)", () => {
  it("two clients edit offline, reconnect, and converge with no data loss", async () => {
    const docA = "conv@A";
    const docB = "conv@B";
    const { transport } = makeSharedServer();

    const a = new RGA("A");
    const b = new RGA("B");

    // Both edit *offline* — ops are queued in each client's oplog, nothing synced.
    await appendOps(docA, a.insertAt(0, "AAA"));
    await appendOps(docB, b.insertAt(0, "BBB"));
    expect(a.toString()).toBe("AAA");
    expect(b.toString()).toBe("BBB");

    // B reconnects first: pushes its work, sees nothing of A's yet.
    await engineFor(docB, b, transport).sync();

    // A reconnects: pushes its queued offline work AND pulls B's — converges.
    await engineFor(docA, a, transport).sync();

    // B syncs again and pulls A's ops — converges to the same string.
    await engineFor(docB, b, transport).sync();

    // Determinism: identical document on both peers.
    expect(a.toString()).toBe(b.toString());
    // No data loss: neither client's offline edits were dropped.
    expect(a.toString()).toContain("AAA");
    expect(a.toString()).toContain("BBB");
  });

  it("the converged state survives a reload from the persisted snapshot", async () => {
    const docA = "reload@A";
    const docB = "reload@B";
    const { transport } = makeSharedServer();

    const a = new RGA("A");
    const b = new RGA("B");
    await appendOps(docA, a.insertAt(0, "hello "));
    await appendOps(docB, b.insertAt(0, "world"));

    await engineFor(docB, b, transport).sync();
    await engineFor(docA, a, transport).sync();
    await engineFor(docB, b, transport).sync();

    const converged = a.toString();
    expect(b.toString()).toBe(converged);

    // Rebuild client A purely from its persisted snapshot (a tab reload). The
    // merged remote ops must be in the snapshot, or the cursor advanced too far.
    const recA = await loadDocumentRecord(docA);
    expect(RGA.fromSnapshot(recA!.crdtState!, "A").toString()).toBe(converged);
  });

  it("re-syncing after convergence is idempotent — no duplicate ops", async () => {
    const docA = "idem@A";
    const docB = "idem@B";
    const { transport, size } = makeSharedServer();

    const a = new RGA("A");
    const b = new RGA("B");
    await appendOps(docA, a.insertAt(0, "abc"));
    await appendOps(docB, b.insertAt(0, "xyz"));

    const engA = engineFor(docA, a, transport);
    const engB = engineFor(docB, b, transport);
    await engB.sync();
    await engA.sync();
    await engB.sync();

    const converged = a.toString();
    const opCount = size();

    // Run several more cycles; nothing new should be produced or applied.
    await engA.sync();
    await engB.sync();
    await engA.sync();

    expect(size()).toBe(opCount); // server gained no duplicate rows
    expect(a.toString()).toBe(converged);
    expect(b.toString()).toBe(converged);
  });

  it("recovers from a sync interrupted mid-batch — no dupes, no loss", async () => {
    const docId = "interrupt@A";
    const { transport, size } = makeSharedServer();

    // A flaky transport that persists the batch server-side but then loses the
    // ack on the first attempt (the classic "did my write land?" partial sync).
    let dropAck = true;
    const flaky: SyncTransport = {
      async push(docId, ops) {
        const result = await transport.push(docId, ops); // server *does* store
        if (dropAck) {
          dropAck = false;
          throw new Error("connection dropped before ack");
        }
        return result;
      },
      pull: transport.pull,
    };

    const rga = new RGA("A");
    await appendOps(docId, rga.insertAt(0, "important"));

    const engine = engineFor(docId, rga, flaky);
    await engine.sync(); // push lands server-side, ack is lost → engine treats as failed

    // The ops are persisted on the server but the client kept them queued (it
    // never saw the ack), so nothing is lost and a retry is safe.
    expect((await getPendingOps(docId)).length).toBeGreaterThan(0);

    await engine.sync(); // retry: server dedups the re-push, client prunes

    expect(await getPendingOps(docId)).toHaveLength(0); // no loss — fully acked now
    expect(size()).toBe("important".length); // idempotent — no duplicate rows
    expect(rga.toString()).toBe("important");
  });

  it("a viewer's offline edits never reach the server or other clients", async () => {
    const editorDoc = "ro@E";
    const viewerDoc = "ro@V";
    const { transport } = makeSharedServer();

    const editor = new RGA("E");
    const viewer = new RGA("V");

    await appendOps(editorDoc, editor.insertAt(0, "official"));
    await appendOps(viewerDoc, viewer.insertAt(0, "sneaky")); // viewer tries to edit

    await engineFor(editorDoc, editor, transport).sync();
    await engineFor(viewerDoc, viewer, transport, false).sync(); // canPush=false

    // The editor pulls everything on the server — the viewer's ops aren't there.
    await engineFor(editorDoc, editor, transport).sync();
    expect(editor.toString()).toBe("official");
    expect(editor.toString()).not.toContain("sneaky");
  });
});
