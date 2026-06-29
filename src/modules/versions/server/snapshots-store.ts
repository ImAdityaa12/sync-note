import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { documentSnapshots, user } from "@/db/schema";
import type { SnapshotState, VersionSummary } from "@/modules/versions/types";

/**
 * Durable persistence for version snapshots (time-travel).
 *
 * A snapshot stores the *materialized* document text at capture plus `uptoSeq`
 * (the server op cursor at that moment). The text is what a restore diffs
 * against to emit forward ops; `uptoSeq` exists for compaction (prune ops older
 * than the latest snapshot, keeping N recent for late offline clients).
 *
 * Tenant scoping is the caller's job — every entry point in `actions.ts` funnels
 * through `requireMembership` first, exactly like the documents domain.
 */
/** Most recent snapshots returned to the timeline (bounds an unbounded log). */
export const MAX_VERSION_LIST = 100;

/** Persist a snapshot and return its generated id. */
export async function createSnapshot(input: {
  documentId: string;
  createdBy: string;
  label: string | null;
  content: string;
  uptoSeq: number;
}): Promise<string> {
  const id = crypto.randomUUID();
  const state: SnapshotState = { content: input.content };
  await db.insert(documentSnapshots).values({
    id,
    documentId: input.documentId,
    createdBy: input.createdBy,
    label: input.label,
    state,
    uptoSeq: input.uptoSeq,
  });
  return id;
}

/**
 * Snapshots for a document, newest first, with author identity for the timeline.
 * Capped at `MAX_VERSION_LIST`: the op/snapshot log grows without bound, so the
 * dialog never ships (or renders) an unbounded set. `id` is a stable secondary
 * sort key so same-timestamp versions don't reorder between reloads.
 */
export async function listSnapshots(
  documentId: string
): Promise<VersionSummary[]> {
  const rows = await db
    .select({
      id: documentSnapshots.id,
      label: documentSnapshots.label,
      uptoSeq: documentSnapshots.uptoSeq,
      createdAt: documentSnapshots.createdAt,
      authorId: documentSnapshots.createdBy,
      authorName: user.name,
      authorImage: user.image,
    })
    .from(documentSnapshots)
    .innerJoin(user, eq(user.id, documentSnapshots.createdBy))
    .where(eq(documentSnapshots.documentId, documentId))
    .orderBy(desc(documentSnapshots.createdAt), desc(documentSnapshots.id))
    .limit(MAX_VERSION_LIST);

  return rows;
}

/**
 * The materialized content of one snapshot, or `null` if no snapshot with that
 * id exists *on this document*. Scoping on `documentId` as well as the snapshot
 * id means a member of document A can never read document B's snapshot by
 * guessing its id.
 */
export async function getSnapshotContent(
  documentId: string,
  versionId: string
): Promise<string | null> {
  const [row] = await db
    .select({ state: documentSnapshots.state })
    .from(documentSnapshots)
    .where(
      and(
        eq(documentSnapshots.id, versionId),
        eq(documentSnapshots.documentId, documentId)
      )
    )
    .limit(1);

  if (!row) return null;
  const state = row.state as SnapshotState;
  return typeof state?.content === "string" ? state.content : null;
}
