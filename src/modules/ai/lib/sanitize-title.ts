/**
 * Clean a model-suggested title before it's applied.
 *
 * The prompt asks for a bare title (no quotes, no trailing punctuation), but
 * LLMs don't reliably comply, so we normalize defensively: take the first line,
 * strip surrounding quotes (straight or smart), drop trailing sentence
 * punctuation, and collapse whitespace. Returns "" if nothing usable remains.
 */
export function sanitizeTitle(raw: string): string {
  const firstLine = raw.trim().split(/\r?\n/, 1)[0] ?? "";
  return firstLine
    .trim()
    .replace(/^["'“”‘’`]+/, "")
    .replace(/["'“”‘’`]+$/, "")
    .replace(/[.,;:!?]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}
