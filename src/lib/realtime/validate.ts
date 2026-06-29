import {
  clientFrame,
  MAX_FRAME_BYTES,
  type ClientFrame,
  type ErrorCode,
} from "./protocol";

export type FrameResult =
  | { ok: true; frame: ClientFrame }
  | {
      ok: false;
      code: Extract<ErrorCode, "too_large" | "bad_json" | "bad_schema">;
    };

/**
 * Validate one inbound socket frame: enforce the byte ceiling **before** parsing
 * (so an oversized frame never allocates a JSON tree — OOM defence), then JSON-
 * parse, then zod-validate against the client protocol. Pure + synchronous, so it
 * unit-tests without a live socket.
 */
export function validateFrame(raw: string | Uint8Array): FrameResult {
  const size = typeof raw === "string" ? Buffer.byteLength(raw) : raw.byteLength;
  if (size > MAX_FRAME_BYTES) return { ok: false, code: "too_large" };

  let json: unknown;
  try {
    const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
    json = JSON.parse(text);
  } catch {
    return { ok: false, code: "bad_json" };
  }

  const parsed = clientFrame.safeParse(json);
  if (!parsed.success) return { ok: false, code: "bad_schema" };
  return { ok: true, frame: parsed.data };
}
