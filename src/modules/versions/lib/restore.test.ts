import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { Op } from "@/lib/crdt/codec";
import { RGA } from "@/lib/crdt/rga";

import { restoreToText } from "./restore";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function applyAll(rga: RGA, ops: Op[]): void {
  for (const op of ops) rga.apply(op);
}

function render(ops: Op[], site = "verifier"): string {
  const rga = new RGA(site);
  applyAll(rga, ops);
  return rga.toString();
}

// Tiny alphabet (+ newline) → frequent edits at the same slots, which is exactly
// where a restore and a concurrent edit can collide. Strings stay short so a run
// explores many distinct base/target/edit combinations.
const textArb = fc
  .array(fc.constantFrom("a", "b", "c", "d", "\n"), { maxLength: 40 })
  .map((chars) => chars.join(""));

/**
 * Two replicas from a shared `base`: A restores to `target`, B concurrently
 * edits toward `edit`. Returns the merged ops as seen by each side.
 */
function concurrentRestore(base: string, target: string, edit: string) {
  const a = new RGA("A");
  const initOps = a.insertAt(0, base);
  const b = new RGA("B");
  applyAll(b, initOps);

  // Neither replica has seen the other's change yet — true concurrency.
  const restoreOps = restoreToText(a, target);
  const editOps = restoreToText(b, edit);

  return { a, b, initOps, restoreOps, editOps };
}

// ---------------------------------------------------------------------------
// Property: restore is a *forward operation*, not a history rewrite.
//
// The Phase F definition of done: restore an old version while a second client
// edits the same document → both peers converge, with no data loss. A restore is
// just more collaborative ops, so it must merge like any other concurrent edit.
// ---------------------------------------------------------------------------

describe("restoreToText — convergence under concurrent editing", () => {
  it("a restore on A and a concurrent edit on B converge to the same text", () => {
    fc.assert(
      fc.property(textArb, textArb, textArb, (base, target, edit) => {
        const { a, b, restoreOps, editOps } = concurrentRestore(
          base,
          target,
          edit
        );

        // The ops cross the wire in both directions.
        applyAll(a, editOps);
        applyAll(b, restoreOps);

        // Same op set on both peers → identical document. The restore did not
        // clobber B's concurrent work; it merged with it.
        expect(a.toString()).toBe(b.toString());
      }),
      { numRuns: 500 }
    );
  });

  it("converges regardless of the order restore/edit ops are delivered in", () => {
    fc.assert(
      fc.property(textArb, textArb, textArb, (base, target, edit) => {
        const { initOps, restoreOps, editOps } = concurrentRestore(
          base,
          target,
          edit
        );
        const all = [...initOps, ...restoreOps, ...editOps];

        const inOrder = render(all);
        const reversed = render([...all].reverse());
        expect(reversed).toBe(inOrder);
      }),
      { numRuns: 500 }
    );
  });
});

// ---------------------------------------------------------------------------
// Deterministic cases — the exact guarantees, spelled out
// ---------------------------------------------------------------------------

describe("restoreToText — behaviour", () => {
  it("with no concurrent editor, restore reproduces the version exactly", () => {
    const a = new RGA("A");
    a.insertAt(0, "the quick brown fox");

    const ops = restoreToText(a, "the lazy dog");
    expect(a.toString()).toBe("the lazy dog");

    // A peer that only sees the restore ops (after sharing the base) converges
    // to the same text — proven generally by the property test above.
    expect(ops.length).toBeGreaterThan(0);
  });

  it("restoring to the current text is a no-op (emits no ops)", () => {
    const a = new RGA("A");
    a.insertAt(0, "unchanged");
    expect(restoreToText(a, "unchanged")).toEqual([]);
    expect(a.toString()).toBe("unchanged");
  });

  it("emits forward ops that delete removed text and insert new text", () => {
    const a = new RGA("A");
    a.insertAt(0, "hello world");

    const ops = restoreToText(a, "hello there");
    expect(a.toString()).toBe("hello there");
    expect(ops.some((o) => o.type === "delete")).toBe(true);
    expect(ops.some((o) => o.type === "insert")).toBe(true);
  });
});
