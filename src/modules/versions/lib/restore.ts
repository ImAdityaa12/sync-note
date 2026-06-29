import type { Op } from "@/lib/crdt/codec";
import type { RGA } from "@/lib/crdt/rga";
import { diffText } from "@/modules/editor/lib/text-diff";

/**
 * Restore a past version as **forward operations**, never a destructive
 * overwrite.
 *
 * Diff the live document against the target snapshot text and emit the CRDT ops
 * that transform live → target, applying them to `rga` locally. Those ops travel
 * the exact same path as a keystroke (oplog → push → broadcast), so a restore is
 * just more collaborative editing: a peer concurrently editing the same document
 * still converges with no data loss — the restore does not rewind shared history,
 * it moves the shared document forward toward the chosen version.
 *
 * Returns the ops produced (empty if the live text already equals the target).
 * Convergence under concurrent edits is property-tested in `restore.test.ts`.
 */
export function restoreToText(rga: RGA, target: string): Op[] {
  const prev = rga.toString();
  if (prev === target) return [];

  const { index, deleteCount, insert } = diffText(prev, target);
  const ops: Op[] = [];
  if (deleteCount > 0) ops.push(...rga.deleteAt(index, deleteCount));
  if (insert) ops.push(...rga.insertAt(index, insert));
  return ops;
}
