import { z } from "zod";

import type { Id } from "./clock";

/**
 * Wire/storage format for CRDT operations.
 *
 * Ops are plain JSON, so they serialize as-is for IndexedDB, the HTTP sync
 * routes, and the WS relay. The zod schema here is the single source of truth
 * for validating *incoming* ops server-side (defence against malformed payloads)
 * and is shared by the realtime relay.
 */
export const idSchema: z.ZodType<Id> = z.object({
  counter: z.number().int().nonnegative(),
  site: z.string().min(1).max(64),
});

/** One inserted UTF-16 code unit (length 1; max 2 guards lone-surrogate edge cases). */
const insertOpSchema = z.object({
  type: z.literal("insert"),
  id: idSchema,
  value: z.string().min(1).max(2),
  originLeft: idSchema.nullable(),
});

const deleteOpSchema = z.object({
  type: z.literal("delete"),
  id: idSchema,
});

export const opSchema = z.discriminatedUnion("type", [
  insertOpSchema,
  deleteOpSchema,
]);

export type InsertOp = z.infer<typeof insertOpSchema>;
export type DeleteOp = z.infer<typeof deleteOpSchema>;
export type Op = z.infer<typeof opSchema>;

/** Parse + validate an untrusted op (throws on invalid). */
export function decodeOp(value: unknown): Op {
  return opSchema.parse(value);
}

/** Validate a batch, returning only well-formed ops (used at the sync boundary). */
export function decodeOps(value: unknown): Op[] {
  return z.array(opSchema).parse(value);
}
