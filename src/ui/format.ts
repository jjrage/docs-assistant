/** "Oct 19, 2026, 3:04 PM" in the viewer's region conventions (US English for the demo). */
export function formatInstant(iso: string, timeZone = "America/New_York"): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

/** "March 1, 2026" for a calendar date (no time zone shift). */
export function formatDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00Z`));
}

/** "2.4 MB", "830 KB" */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Micro-dollars as money: "$0.042" below a dollar (API costs are small), "$1.20" above. */
export function formatMicroUsd(micro: number): string {
  const dollars = micro / 1_000_000;
  return dollars >= 1 ? `$${dollars.toFixed(2)}` : `$${dollars.toFixed(dollars >= 0.1 ? 3 : 4)}`;
}

/** "1.8 s" or "650 ms" */
export function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}
