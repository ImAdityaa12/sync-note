import { describe, expect, it } from "vitest";

import { PayloadTooLargeError, readJsonWithLimit } from "./read-json";

function streamRequest(chunks: Uint8Array[]): Request {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
  return new Request("http://localhost/test", {
    method: "POST",
    body: stream,
    // Node's fetch requires `duplex` when streaming a request body.
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

const enc = (s: string) => new TextEncoder().encode(s);

describe("readJsonWithLimit", () => {
  it("parses JSON within the limit", async () => {
    const req = streamRequest([enc(JSON.stringify({ ops: [1, 2, 3] }))]);
    expect(await readJsonWithLimit(req, 1024)).toEqual({ ops: [1, 2, 3] });
  });

  it("aborts past the byte ceiling regardless of content-length", async () => {
    const req = streamRequest([new Uint8Array(4096)]); // > 1KB cap
    await expect(readJsonWithLimit(req, 1024)).rejects.toBeInstanceOf(
      PayloadTooLargeError
    );
  });

  it("aborts once the running total across chunks exceeds the cap", async () => {
    const chunks = Array.from({ length: 5 }, () => new Uint8Array(300)); // 1500 > 1024
    const req = streamRequest(chunks);
    await expect(readJsonWithLimit(req, 1024)).rejects.toBeInstanceOf(
      PayloadTooLargeError
    );
  });

  it("returns undefined for an empty body", async () => {
    const req = new Request("http://localhost/test", { method: "POST" });
    expect(await readJsonWithLimit(req, 1024)).toBeUndefined();
  });

  it("throws on invalid JSON within the limit", async () => {
    const req = streamRequest([enc("{ not json ")]);
    await expect(readJsonWithLimit(req, 1024)).rejects.toBeInstanceOf(SyntaxError);
  });
});
