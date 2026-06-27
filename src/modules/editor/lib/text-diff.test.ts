import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { RGA } from "@/lib/crdt/rga";

import { diffText } from "./text-diff";

/** Mirror the hook: diff the new editor value and apply it as CRDT ops. */
function applyEdit(rga: RGA, next: string): void {
  const prev = rga.toString();
  const { index, deleteCount, insert } = diffText(prev, next);
  if (deleteCount > 0) rga.deleteAt(index, deleteCount);
  if (insert) rga.insertAt(index, insert);
}

describe("text-diff → RGA pipeline", () => {
  it("round-trips: the RGA always matches the latest editor value", () => {
    fc.assert(
      fc.property(fc.array(fc.string(), { maxLength: 30 }), (edits) => {
        const rga = new RGA("a");
        for (const next of edits) {
          applyEdit(rga, next);
          expect(rga.toString()).toBe(next);
        }
      }),
      { numRuns: 500 }
    );
  });

  it("handles prefix / middle / suffix replaces and clears", () => {
    const rga = new RGA("a");
    const steps = [
      "hello world",
      "hello brave world", // middle insert
      "hi brave world", // prefix replace
      "hi brave", // suffix delete
      "", // clear
    ];
    for (const next of steps) {
      applyEdit(rga, next);
      expect(rga.toString()).toBe(next);
    }
  });
});
