import { z } from "zod";

/**
 * Input validation for the versions (snapshot / time-travel) module.
 *
 * The content cap is a security control: a snapshot carries the whole
 * materialized document, so we bound it before it's persisted. UTF-16 length is
 * a proxy for bytes here (the durable ops route enforces the streaming byte cap);
 * 1M code units keeps a single snapshot well under a megabyte of text.
 */
const documentId = z.string().min(1, "Missing document id");

export const MAX_SNAPSHOT_CHARS = 1_000_000;
export const MAX_LABEL_CHARS = 100;

export const saveVersionSchema = z.object({
  documentId,
  label: z.string().trim().max(MAX_LABEL_CHARS, "Label is too long").optional(),
  content: z
    .string()
    .max(MAX_SNAPSHOT_CHARS, "This document is too large to snapshot"),
});

export const listVersionsSchema = z.object({ documentId });

export const versionContentSchema = z.object({
  documentId,
  versionId: z.string().min(1),
});

export type SaveVersionInput = z.infer<typeof saveVersionSchema>;
export type ListVersionsInput = z.infer<typeof listVersionsSchema>;
export type VersionContentInput = z.infer<typeof versionContentSchema>;
