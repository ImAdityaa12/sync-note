"use server";

import { rateLimit } from "@/lib/rate-limit";
import {
  getCurrentUser,
  requireMembership,
} from "@/modules/documents/server/membership";
import { latestSeqFor } from "@/modules/documents/server/ops-store";
import type { ActionResult } from "@/modules/documents/types";
import {
  listVersionsSchema,
  saveVersionSchema,
  versionContentSchema,
} from "@/modules/versions/schema";
import {
  createSnapshot,
  getSnapshotContent,
  listSnapshots,
} from "@/modules/versions/server/snapshots-store";
import type { VersionSummary } from "@/modules/versions/types";

/**
 * Version-history mutations and reads (snapshots + time-travel).
 *
 * Role model mirrors the rest of the documents domain:
 *   - save a version  → editor+ (it's a contribution to the document)
 *   - list / read     → viewer+ (any member may browse history read-only)
 * The actual *restore* runs client-side as forward CRDT ops, so the ops route's
 * editor-only gate is what ultimately stops a viewer from mutating the document.
 *
 * Non-members get a generic failure (never a leak of which documents exist).
 */

const SAVE_PER_MIN = 30;

function fail(message: string): ActionResult<never> {
  return { ok: false, error: message };
}

export async function saveVersion(input: {
  documentId: string;
  label?: string;
  content: string;
}): Promise<ActionResult<{ id: string }>> {
  const user = await getCurrentUser();
  if (!user) return fail("You need to sign in.");

  const parsed = saveVersionSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Couldn't save this version.");
  }
  const { documentId, label, content } = parsed.data;

  const rl = rateLimit(`version:save:${user.id}`, SAVE_PER_MIN, 60_000);
  if (!rl.ok) return fail("You're saving versions too quickly. Try again shortly.");

  // Editors and owners may snapshot; viewers cannot.
  const membership = await requireMembership(documentId, user.id, "editor");
  if (!membership) return fail("You can't save versions of this document.");

  // Record the server's latest seq as the snapshot's cursor. Any local edits not
  // yet pushed sit *above* this watermark, so it never over-claims coverage —
  // the safe direction for compaction (we'd keep more ops, never prune too many).
  const uptoSeq = await latestSeqFor(documentId);

  await createSnapshot({
    documentId,
    createdBy: user.id,
    label: label && label.length > 0 ? label : null,
    content,
    uptoSeq,
  });

  return { ok: true, data: { id: documentId } };
}

export async function listVersions(input: {
  documentId: string;
}): Promise<ActionResult<VersionSummary[]>> {
  const user = await getCurrentUser();
  if (!user) return fail("You need to sign in.");

  const parsed = listVersionsSchema.safeParse(input);
  if (!parsed.success) return fail("Missing document.");

  const membership = await requireMembership(parsed.data.documentId, user.id);
  if (!membership) return fail("You don't have access to this document.");

  const versions = await listSnapshots(parsed.data.documentId);
  return { ok: true, data: versions };
}

export async function getVersionContent(input: {
  documentId: string;
  versionId: string;
}): Promise<ActionResult<{ content: string }>> {
  const user = await getCurrentUser();
  if (!user) return fail("You need to sign in.");

  const parsed = versionContentSchema.safeParse(input);
  if (!parsed.success) return fail("Missing version.");
  const { documentId, versionId } = parsed.data;

  const membership = await requireMembership(documentId, user.id);
  if (!membership) return fail("You don't have access to this document.");

  const content = await getSnapshotContent(documentId, versionId);
  if (content === null) return fail("That version no longer exists.");

  return { ok: true, data: { content } };
}
