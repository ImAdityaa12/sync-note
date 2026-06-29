/** Compact relative time ("2 hours ago", "just now") using the platform Intl API. */
export function formatRelativeTime(value: Date | string | number): string {
  const date = value instanceof Date ? value : new Date(value);
  const diffMs = date.getTime() - Date.now();
  const abs = Math.abs(diffMs);

  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31_536_000_000],
    ["month", 2_592_000_000],
    ["week", 604_800_000],
    ["day", 86_400_000],
    ["hour", 3_600_000],
    ["minute", 60_000],
  ];

  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (const [unit, ms] of units) {
    if (abs >= ms) return rtf.format(Math.round(diffMs / ms), unit);
  }
  return "just now";
}
