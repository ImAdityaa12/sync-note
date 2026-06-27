import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { idKey } from "./clock";
import type { Op } from "./codec";
import { RGA } from "./rga";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Apply a list of ops to a fresh replica and return the rendered text. */
function render(ops: Op[], site = "verifier"): string {
  const rga = new RGA(site);
  for (const op of ops) rga.apply(op);
  return rga.toString();
}

type Action = { site: number; kind: "insert" | "delete"; pos: number; ch: string };

/**
 * Replay random actions across `siteCount` independent replicas — each edits its
 * OWN copy from empty, so every site's edits are concurrent with every other's
 * (maximal concurrency, like everyone editing offline then merging). Returns the
 * flat op log produced.
 */
function buildOpLog(actions: Action[], siteCount: number): Op[] {
  const replicas = Array.from(
    { length: siteCount },
    (_, i) => new RGA(`s${i}`)
  );
  const log: Op[] = [];
  for (const a of actions) {
    const r = replicas[a.site % siteCount];
    if (a.kind === "insert") {
      log.push(...r.insertAt(a.pos % (r.length + 1), a.ch));
    } else if (r.length > 0) {
      log.push(...r.deleteAt(a.pos % r.length, 1));
    }
  }
  return log;
}

const byIdAsc = (a: Op, b: Op) => (idKey(a.id) < idKey(b.id) ? -1 : 1);

const actionsArb = fc.array(
  fc.record({
    site: fc.nat(),
    // Bias toward inserts so documents actually grow.
    kind: fc.constantFrom<Action["kind"]>("insert", "insert", "insert", "delete"),
    pos: fc.nat({ max: 64 }),
    // Tiny alphabet → frequent concurrent inserts at the same slot (stresses tie-break).
    ch: fc.constantFrom("a", "b", "c", "d", "e"),
  }),
  { maxLength: 64 }
);

// ---------------------------------------------------------------------------
// Property tests — the Phase C definition of done
// ---------------------------------------------------------------------------

describe("RGA — convergence properties", () => {
  it("converges: the same op set yields the same text under any delivery order", () => {
    fc.assert(
      fc.property(actionsArb, (actions) => {
        const log = buildOpLog(actions, 3);

        const inOrder = render(log);
        const reversed = render([...log].reverse()); // children before origins, deletes before inserts
        const byId = render([...log].sort(byIdAsc));
        const byIdDesc = render([...log].sort((a, b) => -byIdAsc(a, b)));

        expect(reversed).toBe(inOrder);
        expect(byId).toBe(inOrder);
        expect(byIdDesc).toBe(inOrder);
      }),
      // The DoD: ≥1k randomized op sequences must converge.
      { numRuns: 1000 }
    );
  });

  it("is idempotent: applying every op twice equals applying it once", () => {
    fc.assert(
      fc.property(actionsArb, (actions) => {
        const log = buildOpLog(actions, 3);
        expect(render([...log, ...log])).toBe(render(log));
      }),
      { numRuns: 500 }
    );
  });

  it("commutes: a shuffled interleaving converges to the same text", () => {
    fc.assert(
      fc.property(actionsArb, fc.infiniteStream(fc.nat()), (actions, rnd) => {
        const log = buildOpLog(actions, 3);
        // Fisher–Yates using the fast-check-provided randomness.
        const shuffled = [...log];
        const it = rnd[Symbol.iterator]();
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = it.next().value % (i + 1);
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        expect(render(shuffled)).toBe(render(log));
      }),
      { numRuns: 500 }
    );
  });
});

// ---------------------------------------------------------------------------
// Deterministic unit tests — the tricky cases, spelled out
// ---------------------------------------------------------------------------

describe("RGA — core behaviour", () => {
  it("inserts and renders in order on one replica", () => {
    const r = new RGA("a");
    r.insertAt(0, "hello");
    r.insertAt(5, " world");
    expect(r.toString()).toBe("hello world");
  });

  it("deletes by tombstone without shifting other positions", () => {
    const r = new RGA("a");
    r.insertAt(0, "abcdef");
    r.deleteAt(1, 2); // remove "bc"
    expect(r.toString()).toBe("adef");
  });

  it("two replicas inserting at the same slot converge deterministically", () => {
    const a = new RGA("a");
    const b = new RGA("b");
    const opsA = a.insertAt(0, "A"); // concurrent...
    const opsB = b.insertAt(0, "B"); // ...both at position 0 from empty
    a.insertAt(0, ""); // no-op guard
    // cross-apply
    for (const op of opsB) a.apply(op);
    for (const op of opsA) b.apply(op);
    expect(a.toString()).toBe(b.toString());
    expect(a.toString().length).toBe(2);
  });

  it("buffers an insert that arrives before its origin", () => {
    const src = new RGA("a");
    const [op1] = src.insertAt(0, "x"); // origin
    const [op2] = src.insertAt(1, "y"); // child, originLeft = op1.id

    const out = new RGA("b");
    out.apply(op2); // child first — must buffer
    expect(out.toString()).toBe(""); // not yet visible
    out.apply(op1); // origin arrives — flushes the buffered child
    expect(out.toString()).toBe("xy");
  });

  it("applies a delete that arrives before its target", () => {
    const src = new RGA("a");
    const [ins] = src.insertAt(0, "z");
    const [del] = src.deleteAt(0, 1);

    const out = new RGA("b");
    out.apply(del); // delete first
    out.apply(ins); // then the insert it referred to
    expect(out.toString()).toBe(""); // tombstoned, never shown
  });

  it("ignores a duplicate insert", () => {
    const r = new RGA("a");
    const [op] = r.insertAt(0, "q");
    r.apply(op); // duplicate
    expect(r.toString()).toBe("q");
  });
});
