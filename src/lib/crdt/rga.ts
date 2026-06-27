import { compareId, idKey, type Id } from "./clock";
import type { DeleteOp, InsertOp, Op } from "./codec";

export type { Op, InsertOp, DeleteOp };

interface Node {
  id: Id;
  value: string;
  originLeft: Id | null;
}

/**
 * RGA (Replicated Growable Array) — a sequence CRDT for collaborative text.
 *
 * The document is an ordered list of character nodes, each with a unique `Id`.
 * An insert records the id of the node it was placed *after* (`originLeft`). A
 * delete tombstones a node by id (the node stays in the list for positioning;
 * it's just hidden from the rendered text).
 *
 * ## Why it converges
 * Two invariants make every replica that has seen the same set of ops compute
 * the *same* string, regardless of the order ops arrive in:
 *
 * 1. **Lamport ids.** A locally-inserted node's id is always greater than its
 *    origin's id (the inserter has observed the origin). So when integrating,
 *    scanning rightward from the origin and skipping nodes with a *greater* id
 *    deterministically orders concurrent inserts at the same slot by id,
 *    descending — identical on every peer. (`integrate`)
 * 2. **Commutativity + idempotency.** Deletes are a grow-only tombstone set, so
 *    they commute with everything and are idempotent. Inserts buffer until their
 *    origin exists, so an insert that arrives before its origin (or a delete
 *    before its target) still converges. (`apply`)
 *
 * This is correctness over conflict-resolution policy: concurrent edits merge
 * without data loss, deterministically. Convergence/idempotency/commutativity
 * are property-tested in `rga.test.ts`.
 */
export class RGA {
  readonly site: string;
  private clock = 0;
  private nodes: Node[] = [];
  private present = new Map<string, Node>();
  private deleted = new Set<string>();
  /** Inserts waiting for their origin to be integrated, keyed by origin id. */
  private pending = new Map<string, InsertOp[]>();

  constructor(site: string) {
    this.site = site;
  }

  // --------------------------------------------------------------------------
  // Local edits — produce ops to persist/broadcast, applied locally first.
  // --------------------------------------------------------------------------

  /** Insert `text` at visible position `index` (0..length). Returns the ops. */
  insertAt(index: number, text: string): Op[] {
    const visible = this.visibleNodes();
    let originLeft = index <= 0 ? null : visible[Math.min(index, visible.length) - 1].id;
    const ops: Op[] = [];
    // Iterates by code point, so surrogate pairs / emoji stay one node.
    for (const value of text) {
      const id: Id = { counter: ++this.clock, site: this.site };
      const op: InsertOp = { type: "insert", id, value, originLeft };
      this.apply(op);
      ops.push(op);
      originLeft = id; // chain: next char is inserted after this one
    }
    return ops;
  }

  /** Delete `count` visible characters starting at visible position `index`. */
  deleteAt(index: number, count: number): Op[] {
    const visible = this.visibleNodes();
    const ops: Op[] = [];
    for (let i = 0; i < count && index + i < visible.length; i++) {
      const op: DeleteOp = { type: "delete", id: visible[index + i].id };
      this.apply(op);
      ops.push(op);
    }
    return ops;
  }

  // --------------------------------------------------------------------------
  // Apply — idempotent, commutative integration of local or remote ops.
  // --------------------------------------------------------------------------

  apply(op: Op): void {
    // Advance the Lamport clock past anything we observe.
    if (op.id.counter > this.clock) this.clock = op.id.counter;

    if (op.type === "delete") {
      this.deleted.add(idKey(op.id)); // grow-only set; commutes, idempotent
      return;
    }

    const key = idKey(op.id);
    if (this.present.has(key)) return; // already integrated — idempotent

    // Causal safety: an insert can only be placed once its origin exists.
    if (op.originLeft && !this.present.has(idKey(op.originLeft))) {
      const originKey = idKey(op.originLeft);
      const queue = this.pending.get(originKey) ?? [];
      queue.push(op);
      this.pending.set(originKey, queue);
      return;
    }

    this.integrate(op);

    // Integrating this node may unblock inserts that were waiting on it.
    const waiting = this.pending.get(key);
    if (waiting) {
      this.pending.delete(key);
      for (const w of waiting) this.apply(w);
    }
  }

  private integrate(op: InsertOp): void {
    const node: Node = {
      id: op.id,
      value: op.value,
      originLeft: op.originLeft,
    };
    const originIdx = op.originLeft ? this.indexOf(op.originLeft) : -1;
    // Place after the origin, skipping concurrent inserts with a greater id so
    // siblings end up in descending-id order on every replica.
    let i = originIdx + 1;
    while (i < this.nodes.length && compareId(this.nodes[i].id, op.id) > 0) {
      i++;
    }
    this.nodes.splice(i, 0, node);
    this.present.set(idKey(op.id), node);
  }

  // --------------------------------------------------------------------------
  // Reads
  // --------------------------------------------------------------------------

  toString(): string {
    let out = "";
    for (const node of this.nodes) {
      if (!this.deleted.has(idKey(node.id))) out += node.value;
    }
    return out;
  }

  get length(): number {
    let n = 0;
    for (const node of this.nodes) {
      if (!this.deleted.has(idKey(node.id))) n++;
    }
    return n;
  }

  private indexOf(id: Id): number {
    const key = idKey(id);
    return this.nodes.findIndex((node) => idKey(node.id) === key);
  }

  private visibleNodes(): Node[] {
    return this.nodes.filter((node) => !this.deleted.has(idKey(node.id)));
  }
}
