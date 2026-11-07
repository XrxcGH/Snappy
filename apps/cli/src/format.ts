/** Plain formatting helpers: American English numbers and dates, sentence-case units. */

const DATE = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" });
const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/** "Nov 6, 2026". Export times are UTC, so the same export reads the same on every machine. */
export function formatDate(ms: number): string {
  return DATE.format(new Date(ms));
}

/** "1,234". */
export function formatCount(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** "1 friend", "3 friends". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${formatCount(n)} ${n === 1 ? one : many}`;
}

/** "340 MB", "1.2 GB". Binary steps (1024), the way file managers report sizes. */
export function formatBytes(bytes: number): string {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  const text = value.toFixed(unit === 0 || value >= 100 ? 0 : 1).replace(/\.0$/, "");
  return `${text} ${UNITS[unit]}`;
}

/** "24%". */
export function formatPercent(fraction: number): string {
  return `${Math.round(Math.max(0, fraction) * 100)}%`;
}
