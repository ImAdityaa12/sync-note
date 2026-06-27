export class PayloadTooLargeError extends Error {
  constructor() {
    super("Payload too large");
    this.name = "PayloadTooLargeError";
  }
}

/**
 * Read a request body as JSON while enforcing a hard byte ceiling *as it
 * streams* — so a massive or chunked body (with a missing/lying `content-length`)
 * can never be fully buffered. We accumulate at most `maxBytes` before aborting,
 * which is the real OOM defence (the `content-length` header is only a fast path).
 *
 * Throws `PayloadTooLargeError` past the limit, or `SyntaxError` on invalid JSON.
 */
export async function readJsonWithLimit(
  request: Request,
  maxBytes: number
): Promise<unknown> {
  const body = request.body;
  if (!body) return undefined;

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new PayloadTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  if (total === 0) return undefined;

  const buffer = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(buffer));
}
