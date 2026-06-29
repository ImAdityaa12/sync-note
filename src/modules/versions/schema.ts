import { z } from "zod";

/**
 * Input validation for the versions (snapshot / time-travel) module.
 *
 * The content cap is a security control. It is measured in **bytes** (UTF-8),
 * not string length, so multi-byte content (CJK, emoji) can't slip 2-3x past the
 * intended budget. The transport-level "reject before allocating" guard for the
 * save action is Next's `serverActions.bodySizeLimit` (set in `next.config.ts`);
 * this zod cap is the semantic check that runs once the body is in hand.
 */
const documentId = z.string().min(1, "Missing document id");

export const MAX_SNAPSHOT_BYTES = 512 * 1024; // 512 KB of materialized text
export const MAX_LABEL_CHARS = 100;

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

export const saveVersionSchema = z.object({
  documentId,
  label: z.string().trim().max(MAX_LABEL_CHARS, "Label is too long").optional(),
  content: z
    .string()
    .refine((value) => utf8Bytes(value) <= MAX_SNAPSHOT_BYTES, {
      message: "This document is too large to snapshot",
    }),
  /**
   * The client's pull cursor at capture — the highest server seq reflected in
   * `content`. Stored (clamped) as the snapshot's `uptoSeq` so compaction never
   * over-claims coverage. Optional/back-compat: absent → treated as 0.
   */
  baseSeq: z.number().int().min(0).optional(),
});

export const listVersionsSchema = z.object({ documentId });

export const versionContentSchema = z.object({
  documentId,
  versionId: z.string().min(1),
});

export type SaveVersionInput = z.infer<typeof saveVersionSchema>;
export type ListVersionsInput = z.infer<typeof listVersionsSchema>;
export type VersionContentInput = z.infer<typeof versionContentSchema>;
