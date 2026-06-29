import { z } from "zod";

import { opSchema, type Op } from "@/lib/crdt/codec";
import type { DocumentRole } from "@/modules/documents/types";

/**
 * Wire protocol for the realtime socket — JSON frames in both directions.
 *
 * The server validates every *incoming* (client→server) frame against these
 * zod schemas, after a hard byte cap (see `validateFrame`). Server→client frames
 * are produced by trusted code but typed here so the client can parse defensively.
 */

/**
 * Hard per-frame byte ceiling. Also handed to `ws` as `maxPayload`, so an
 * oversized frame is rejected at the protocol layer and never buffered into
 * memory — the real OOM defence.
 */
export const MAX_FRAME_BYTES = 64 * 1024;

/** A frame may carry a burst of ops (debounced keystrokes), but stays bounded. */
export const MAX_OPS_PER_FRAME = 500;

/* ------------------------------ client → server --------------------------- */

const opFrame = z.object({
  t: z.literal("op"),
  ops: z.array(opSchema).min(1).max(MAX_OPS_PER_FRAME),
});

/** Caret/selection as code-unit offsets into the materialized document. */
const cursorFrame = z.object({
  t: z.literal("cursor"),
  anchor: z.number().int().nonnegative(),
  head: z.number().int().nonnegative(),
});

export const clientFrame = z.discriminatedUnion("t", [opFrame, cursorFrame]);
export type ClientFrame = z.infer<typeof clientFrame>;

/* ------------------------------ server → client --------------------------- */

export interface Cursor {
  anchor: number;
  head: number;
}

export interface Peer {
  /** The peer's CRDT site id — correlates a remote cursor with its ops. */
  site: string;
  userId: string;
  name: string;
  /** Stable presence colour derived from the user id. */
  color: string;
  cursor?: Cursor;
}

export type ErrorCode =
  | "too_large"
  | "bad_json"
  | "bad_schema"
  | "forbidden"
  | "rate_limited"
  | "server_error";

export type ServerFrame =
  | { t: "welcome"; seq: number; peers: Peer[] }
  | { t: "op"; ops: Op[]; seq: number; from: string }
  | { t: "presence"; peers: Peer[] }
  | { t: "ack"; seq: number }
  | { t: "error"; code: ErrorCode };

/** Only editors and owners may write ops; viewers are read-only on the wire. */
export function mayPush(role: DocumentRole): boolean {
  return role === "owner" || role === "editor";
}
