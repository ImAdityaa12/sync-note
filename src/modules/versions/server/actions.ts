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
 * Every action wraps its DB/auth work in try/catch so a transient error surfaces
 * as a clean ActionResult (like the documents domain), not a rejected action.
 */

const SAVE_PER_MIN = 30;

function fail(message: string): ActionResult<never> {
  return { ok: false, error: message };
}

const GENERIC_ERROR = "Something went wrong. Please try again.";

export async function saveVersion(input: {
  documentId: string;
  label?: string;
  content: string;
  baseSeq?: number;
}): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await getCurrentUser();
    if (!user) return fail("You need to sign in.");

    // Resolve the document id cheaply so we can rate-limit and authorize *before*
    // validating the (potentially large) content body.
    const documentId =
      typeof input?.documentId === "string" ? input.documentId : "";
    if (!documentId) return fail("Missing document.");

    // Per-(user, document) so saving in one document can't throttle another, and
    // an inaccessible doc can only exhaust its own bucket — mirrors the ops route.
    const rl = rateLimit(
      `version:save:${user.id}:${documentId}`,
      SAVE_PER_MIN,
      60_000
    );
    if (!rl.ok) {
      return fail("You're saving versions too quickly. Try again shortly.");
    }

    // Editors and owners may snapshot; viewers cannot. Authorize before touching
    // the body so an unauthorized caller never drives content validation.
    const membership = await requireMembership(documentId, user.id, "editor");
    if (!membership) return fail("You can't save versions of this document.");

    const parsed = saveVersionSchema.safeParse(input);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Couldn't save this version.");
    }
    const { label, content, baseSeq } = parsed.data;

    // `uptoSeq` must reflect what `content` actually covers: the client's pull
    // cursor (server ops it had applied). Clamp to the server's latest so a stale
    // or hostile cursor can't over-claim — under-claiming is the safe direction
    // for compaction (we keep more ops, never prune ones the snapshot misses).
    const serverLatest = await latestSeqFor(documentId);
    const uptoSeq = Math.max(0, Math.min(baseSeq ?? 0, serverLatest));

    const id = await createSnapshot({
      documentId,
      createdBy: user.id,
      label: label && label.length > 0 ? label : null,
      content,
      uptoSeq,
    });

    return { ok: true, data: { id } };
  } catch {
    return fail(GENERIC_ERROR);
  }
}

export async function listVersions(input: {
  documentId: string;
}): Promise<ActionResult<VersionSummary[]>> {
  try {
    const user = await getCurrentUser();
    if (!user) return fail("You need to sign in.");

    const parsed = listVersionsSchema.safeParse(input);
    if (!parsed.success) return fail("Missing document.");

    const membership = await requireMembership(parsed.data.documentId, user.id);
    if (!membership) return fail("You don't have access to this document.");

    const versions = await listSnapshots(parsed.data.documentId);
    return { ok: true, data: versions };
  } catch {
    return fail(GENERIC_ERROR);
  }
}

export async function getVersionContent(input: {
  documentId: string;
  versionId: string;
}): Promise<ActionResult<{ content: string }>> {
  try {
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
  } catch {
    return fail(GENERIC_ERROR);
  }
}
