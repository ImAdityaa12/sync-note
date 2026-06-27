import type { Op } from "@/lib/crdt/codec";
import type { RGASnapshot } from "@/lib/crdt/rga";

import {
  getLocalDB,
  type LocalDocumentRecord,
  type OplogRecord,
} from "./db";

export type { LocalDocumentRecord, OplogRecord };

/** Materialized local state for a document, or undefined if never opened here. */
export async function loadDocumentRecord(
  docId: string
): Promise<LocalDocumentRecord | undefined> {
  const db = await getLocalDB();
  return db.get("documents", docId);
}

/** Persist the full CRDT snapshot (called debounced after edits). */
export async function saveSnapshot(
  docId: string,
  crdtState: RGASnapshot
): Promise<void> {
  const db = await getLocalDB();
  const existing = await db.get("documents", docId);
  const record: LocalDocumentRecord = {
    docId,
    crdtState,
    version: (existing?.version ?? 0) + 1,
    updatedAt: Date.now(),
  };
  await db.put("documents", record);
}

/**
 * A stable per-replica site id, created once and reused across reloads so this
 * client's op ids never collide with its own past ids. Scoped per document for
 * simplicity (a fresh site per doc is harmless — node ids carry their origin).
 */
export async function getOrCreateSiteId(docId: string): Promise<string> {
  const db = await getLocalDB();
  const existing = await db.get("meta", docId);
  if (existing) return existing.siteId;
  const siteId = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  await db.put("meta", { docId, siteId });
  return siteId;
}

/** Append locally-produced ops to the durable outgoing queue. */
export async function appendOps(docId: string, ops: Op[]): Promise<void> {
  if (ops.length === 0) return;
  const db = await getLocalDB();
  const tx = db.transaction("oplog", "readwrite");
  const now = Date.now();
  await Promise.all(
    ops.map((op) => tx.store.add({ docId, op, createdAt: now }))
  );
  await tx.done;
}

/** Pending (unsynced) ops for a document, in local order. Used by the sync engine. */
export async function getPendingOps(docId: string): Promise<OplogRecord[]> {
  const db = await getLocalDB();
  return db.getAllFromIndex("oplog", "by-doc", docId);
}

/** Remove acked ops from the outgoing queue, by their local keys. */
export async function pruneOps(localSeqs: number[]): Promise<void> {
  if (localSeqs.length === 0) return;
  const db = await getLocalDB();
  const tx = db.transaction("oplog", "readwrite");
  await Promise.all(localSeqs.map((key) => tx.store.delete(key)));
  await tx.done;
}

/** The highest server seq this client has pulled + applied for a document. */
export async function getCursor(docId: string): Promise<number> {
  const db = await getLocalDB();
  const meta = await db.get("meta", docId);
  return meta?.lastServerSeq ?? 0;
}

/** Advance the pull cursor, preserving the site id. */
export async function setCursor(docId: string, lastServerSeq: number): Promise<void> {
  const db = await getLocalDB();
  const meta = (await db.get("meta", docId)) ?? {
    docId,
    siteId: crypto.randomUUID().replace(/-/g, "").slice(0, 8),
  };
  await db.put("meta", { ...meta, lastServerSeq });
}

/** Drop a document's local state entirely (e.g. after it's deleted). */
export async function deleteLocalDocument(docId: string): Promise<void> {
  const db = await getLocalDB();
  await db.delete("documents", docId);
  await db.delete("meta", docId);
  const tx = db.transaction("oplog", "readwrite");
  let cursor = await tx.store.index("by-doc").openCursor(docId);
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}
