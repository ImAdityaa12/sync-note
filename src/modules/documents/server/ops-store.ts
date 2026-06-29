import { and, asc, eq, gt, max } from "drizzle-orm";

import { db } from "@/db";
import { documentOps } from "@/db/schema";
import type { Op } from "@/lib/crdt/codec";

/**
 * Shared durable persistence for CRDT ops, used by **both** the HTTP sync route
 * and the realtime ws server — so idempotency and byte accounting live in exactly
 * one place and the two transports can't drift apart.
 *
 * Idempotency key: inserts key on the new node id; deletes on the target
 * (namespaced). Clients self-assign op ids, so a malicious *editor* could
 * pre-claim an id to drop another client's future op — an accepted trust
 * assumption (editors are trusted collaborators), documented in the threat model.
 */
export function opKey(op: Op): string {
  const base = `${op.id.counter}@${op.id.site}`;
  return op.type === "insert" ? base : `del:${base}`;
}

export function jsonByteSize(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/** Highest server-assigned seq for a document (0 if it has no ops yet). */
export async function latestSeqFor(documentId: string): Promise<number> {
  const [row] = await db
    .select({ seq: max(documentOps.seq) })
    .from(documentOps)
    .where(eq(documentOps.documentId, documentId));
  return row?.seq ?? 0;
}

/**
 * Idempotently append ops authored by `authorId`. Re-inserting an op with the
 * same key is a no-op, so interrupted or duplicated pushes never double-apply.
 * Returns the document's latest seq after the write.
 */
export async function persistOps(
  documentId: string,
  authorId: string,
  ops: Op[]
): Promise<number> {
  if (ops.length > 0) {
    const rows = ops.map((op) => ({
      id: opKey(op),
      documentId,
      authorId,
      op,
      byteSize: jsonByteSize(op),
    }));
    await db.insert(documentOps).values(rows).onConflictDoNothing();
  }
  return latestSeqFor(documentId);
}

export interface PullResult {
  ops: Op[];
  latestSeq: number;
  hasMore: boolean;
}

/** Ops with `seq > since`, capped at `limit`, in ascending seq order. */
export async function pullOpsSince(
  documentId: string,
  since: number,
  limit: number
): Promise<PullResult> {
  const rows = await db
    .select({ seq: documentOps.seq, op: documentOps.op })
    .from(documentOps)
    .where(and(eq(documentOps.documentId, documentId), gt(documentOps.seq, since)))
    .orderBy(asc(documentOps.seq))
    .limit(limit);

  const latestSeq = rows.length > 0 ? rows[rows.length - 1].seq : since;
  return {
    ops: rows.map((r) => r.op as Op),
    latestSeq,
    hasMore: rows.length === limit,
  };
}
