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

/** The word alone, for a count that is printed another way: "friend" for 1, "friends" for 0 or 3. */
export function noun(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many;
}

/** "1 friend", "3 friends". Use this (or noun) wherever a count meets a word, so "1 requests" cannot happen. */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${formatCount(n)} ${noun(n, one, many)}`;
}

/** "is" for 1, "are" for anything else. */
export const isAre = (n: number): string => noun(n, "is", "are");
/** "has" for 1, "have" for anything else. */
export const hasHave = (n: number): string => noun(n, "has", "have");
/** "was" for 1, "were" for anything else. */
export const wasWere = (n: number): string => noun(n, "was", "were");

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
