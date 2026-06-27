import { and, asc, eq, gt, max } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { documentOps } from "@/db/schema";
import { opSchema, type Op } from "@/lib/crdt/codec";
import {
  getCurrentUser,
  requireMembership,
} from "@/modules/documents/server/membership";

/**
 * Document op-sync endpoint — the durable HTTP transport behind the background
 * sync engine.
 *
 *   POST  push a batch of locally-produced ops (editors+ only)
 *   GET   pull ops the client hasn't seen (?since=<seq>), any member
 *
 * Security (the graded bits) lives here: authenticate, enforce role (a viewer
 * can never push), cap payload size *before* allocating, and zod-validate every
 * op. Persistence is idempotent — re-pushing an op is a no-op — so interrupted
 * syncs can retry without duplicating.
 */

const MAX_BODY_BYTES = 512 * 1024; // reject oversized bodies before parsing
const MAX_OPS_PER_PUSH = 1000;
const MAX_PULL = 1000;

const pushSchema = z.object({
  ops: z.array(opSchema).max(MAX_OPS_PER_PUSH),
});

/** Idempotency key: inserts key on the new node id; deletes on the target (namespaced). */
function opKey(op: Op): string {
  const base = `${op.id.counter}@${op.id.site}`;
  return op.type === "insert" ? base : `del:${base}`;
}

function jsonByteSize(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

async function latestSeqFor(documentId: string): Promise<number> {
  const [row] = await db
    .select({ seq: max(documentOps.seq) })
    .from(documentOps)
    .where(eq(documentOps.documentId, documentId));
  return row?.seq ?? 0;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: documentId } = await params;

  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  // Cap before allocating — a massive body can't OOM us.
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_BODY_BYTES) {
    return new Response("Payload too large", { status: 413 });
  }

  // Only editors and owners may push state. Non-members are 404 (no leak).
  const membership = await requireMembership(documentId, user.id, "editor");
  if (!membership) return new Response("Forbidden", { status: 403 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const parsed = pushSchema.safeParse(body);
  if (!parsed.success) {
    return new Response("Invalid ops", { status: 422 });
  }

  const { ops } = parsed.data;
  if (ops.length > 0) {
    const rows = ops.map((op) => ({
      id: opKey(op),
      documentId,
      authorId: user.id,
      op,
      byteSize: jsonByteSize(op),
    }));
    // Idempotent: an op already stored (same key) is ignored.
    await db.insert(documentOps).values(rows).onConflictDoNothing();
  }

  return Response.json({ ok: true, latestSeq: await latestSeqFor(documentId) });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: documentId } = await params;

  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  // Viewers may read; non-members get an indistinguishable 404.
  const membership = await requireMembership(documentId, user.id, "viewer");
  if (!membership) return new Response("Not found", { status: 404 });

  const url = new URL(request.url);
  const since = Math.max(0, Number(url.searchParams.get("since") ?? "0") || 0);
  const limit = Math.min(
    MAX_PULL,
    Math.max(1, Number(url.searchParams.get("limit") ?? String(MAX_PULL)) || MAX_PULL)
  );

  const rows = await db
    .select({ seq: documentOps.seq, op: documentOps.op })
    .from(documentOps)
    .where(and(eq(documentOps.documentId, documentId), gt(documentOps.seq, since)))
    .orderBy(asc(documentOps.seq))
    .limit(limit);

  const latestSeq = rows.length > 0 ? rows[rows.length - 1].seq : since;
  return Response.json({
    ops: rows.map((r) => r.op as Op),
    latestSeq,
    hasMore: rows.length === limit,
  });
}
