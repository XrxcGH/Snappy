/** Number, date and size formatting. Dates use UTC to match the dates in the detectors' evidence text. */

const DATE = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
const MONTH = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long", timeZone: "UTC" });
const NUMBER = new Intl.NumberFormat("en-US");

/** "Nov 6, 2026" */
export function formatDate(ms: number): string {
  return Number.isFinite(ms) ? DATE.format(new Date(ms)) : "unknown date";
}

/** The date at `ms` in a zone `offsetMinutes` east of UTC: "Nov 6, 2026". Same rules as formatDate otherwise. */
export function formatDateIn(ms: number, offsetMinutes: number): string {
  return formatDate(ms + (Number.isFinite(offsetMinutes) ? offsetMinutes : 0) * 60_000);
}

/** "November 2026" */
export function formatMonth(ms: number): string {
  return Number.isFinite(ms) ? MONTH.format(new Date(ms)) : "unknown date";
}

export function formatCount(n: number): string {
  return NUMBER.format(n);
}

const GB = 1000 ** 3;
/** A size typed in GB, as bytes. The unit is decimal (1 GB is 1,000 MB), like the label, so 0.5 shows as 500 MB. The name and the "GiB" in capGiB and goalGiB are from when it was binary. */
export const gibToBytes = (gb: number): number => Math.round(gb * GB);

/** Decimal units, the way the cap is typed and Snapchat labels it: "5 GB" is 5,000 MB. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "unknown size";
  const units = ["bytes", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  const digits = unit === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${NUMBER.format(Number(value.toFixed(digits)))} ${units[unit]}`;
}

/**
 * A length of time in words, with one rule for every page: seconds under a minute, minutes under two hours, hours under two days,
 * then days. "40 seconds", "83 minutes", "5 hours", "3 days". Nothing for a time that is not a length.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  if (ms < 1000) return "Under 1 second";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return countOf(seconds, "second", "seconds");
  const minutes = Math.round(ms / 60_000);
  if (minutes < 120) return countOf(minutes, "minute", "minutes");
  const hours = Math.round(ms / 3_600_000);
  if (hours < 48) return countOf(hours, "hour", "hours");
  return countOf(Math.round(ms / 86_400_000), "day", "days");
}

export function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** "1 friend", "2 friends" */
export function countOf(n: number, one: string, many: string): string {
  return `${formatCount(n)} ${plural(n, one, many)}`;
}

export function formatPercent(fraction: number): string {
  return `${Math.round(Math.max(0, fraction) * 100)}%`;
}
