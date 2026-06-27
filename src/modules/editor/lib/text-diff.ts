export interface TextDiff {
  /** UTF-16 offset where the change begins. */
  index: number;
  /** Number of code units removed at `index`. */
  deleteCount: number;
  /** Text inserted at `index` (after the deletion). */
  insert: string;
}

/**
 * Diff two textarea values into a single replace, by trimming the common prefix
 * and suffix. Covers typing, paste, multi-char delete, and select-and-replace —
 * enough to translate every `onChange` into CRDT ops. Offsets are UTF-16 code
 * units, matching the RGA's per-unit nodes.
 */
export function diffText(prev: string, next: string): TextDiff {
  if (prev === next) return { index: 0, deleteCount: 0, insert: "" };

  let start = 0;
  const min = Math.min(prev.length, next.length);
  while (start < min && prev.charCodeAt(start) === next.charCodeAt(start)) {
    start++;
  }

  let endPrev = prev.length;
  let endNext = next.length;
  while (
    endPrev > start &&
    endNext > start &&
    prev.charCodeAt(endPrev - 1) === next.charCodeAt(endNext - 1)
  ) {
    endPrev--;
    endNext--;
  }

  return {
    index: start,
    deleteCount: endPrev - start,
    insert: next.slice(start, endNext),
  };
}
