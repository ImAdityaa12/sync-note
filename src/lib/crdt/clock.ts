/**
 * Logical clock + identifiers for the RGA CRDT.
 *
 * Every character ever inserted gets a globally-unique, immutable `Id`:
 *   - `counter` is a Lamport clock — on each local insert a replica uses
 *     max(seen counters) + 1, guaranteeing a new id is always greater than any
 *     id it has observed (in particular, greater than its insertion origin).
 *   - `site` is the replica's unique id, breaking ties when two replicas pick
 *     the same counter concurrently.
 *
 * `compareId` gives a *total order* over ids — the deterministic tie-break that
 * makes concurrent inserts converge to the same sequence on every peer.
 */
export interface Id {
  counter: number;
  site: string;
}

/** Stable string key for use in Maps/Sets. */
export function idKey(id: Id): string {
  return `${id.counter}@${id.site}`;
}

export function eqId(a: Id | null, b: Id | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.counter === b.counter && a.site === b.site;
}

/** Total order: by counter, then lexicographically by site. */
export function compareId(a: Id, b: Id): number {
  if (a.counter !== b.counter) return a.counter - b.counter;
  if (a.site < b.site) return -1;
  if (a.site > b.site) return 1;
  return 0;
}
