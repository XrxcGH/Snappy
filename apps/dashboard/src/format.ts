/** Number, date and size formatting. Dates use UTC to match the dates in the detectors' evidence text. */

const DATE = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
const MONTH = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long", timeZone: "UTC" });
const NUMBER = new Intl.NumberFormat("en-US");

/** "Nov 6, 2026" */
export function formatDate(ms: number): string {
  return Number.isFinite(ms) ? DATE.format(new Date(ms)) : "unknown date";
}

/** "November 2026" */
export function formatMonth(ms: number): string {
  return Number.isFinite(ms) ? MONTH.format(new Date(ms)) : "unknown date";
}

export function formatCount(n: number): string {
  return NUMBER.format(n);
}

const GIB = 1024 ** 3;
export const gibToBytes = (gib: number): number => Math.round(gib * GIB);

/** Binary units labelled the way Snapchat labels its cap: "5 GB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "unknown size";
  const units = ["bytes", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = unit === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${NUMBER.format(Number(value.toFixed(digits)))} ${units[unit]}`;
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
