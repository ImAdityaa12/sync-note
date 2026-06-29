import { describe, expect, it } from "vitest";

import { mayPush, MAX_FRAME_BYTES } from "./protocol";
import { validateFrame } from "./validate";

const insertOp = {
  type: "insert" as const,
  id: { counter: 0, site: "s1" },
  value: "a",
  originLeft: null,
};

const encode = (value: unknown) => JSON.stringify(value);

describe("validateFrame", () => {
  it("accepts a well-formed op frame", () => {
    const result = validateFrame(encode({ t: "op", ops: [insertOp] }));
    expect(result).toEqual({ ok: true, frame: { t: "op", ops: [insertOp] } });
  });

  it("accepts a well-formed cursor frame", () => {
    const result = validateFrame(encode({ t: "cursor", anchor: 3, head: 5 }));
    expect(result.ok).toBe(true);
  });

  it("rejects an oversized frame *before* parsing it (OOM defence)", () => {
    // Larger than the cap and not even valid JSON — if it parsed first we'd get
    // `bad_json`; getting `too_large` proves the size check short-circuits.
    const huge = "a".repeat(MAX_FRAME_BYTES + 1);
    expect(validateFrame(huge)).toEqual({ ok: false, code: "too_large" });
  });

  it("rejects invalid JSON", () => {
    expect(validateFrame("{not json")).toEqual({ ok: false, code: "bad_json" });
  });

  it("rejects a frame that doesn't match the schema", () => {
    expect(validateFrame(encode({ t: "nope" }))).toEqual({
      ok: false,
      code: "bad_schema",
    });
    expect(validateFrame(encode({ t: "op", ops: [] }))).toEqual({
      ok: false,
      code: "bad_schema", // an op frame must carry at least one op
    });
    expect(
      validateFrame(encode({ t: "cursor", anchor: -1, head: 0 }))
    ).toEqual({ ok: false, code: "bad_schema" });
  });

  it("validates raw bytes the same as a string", () => {
    const bytes = new TextEncoder().encode(encode({ t: "cursor", anchor: 0, head: 0 }));
    expect(validateFrame(bytes).ok).toBe(true);
  });
});

describe("mayPush (viewer read-only on the wire)", () => {
  it("lets owners and editors push, never viewers", () => {
    expect(mayPush("owner")).toBe(true);
    expect(mayPush("editor")).toBe(true);
    expect(mayPush("viewer")).toBe(false);
  });
});
