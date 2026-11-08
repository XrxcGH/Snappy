/** Plain formatting helpers: American English numbers and dates, sentence-case units. */

const DATE = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" });
const UNITS = ["bytes", "KB", "MB", "GB", "TB"] as const;

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

const SIZE_NUMBER = new Intl.NumberFormat("en-US");

/**
 * "512 bytes", "2.21 KB", "340 MB", "1.2 GB". Binary steps (1024), the way file managers report sizes.
 * Two decimals under 10, one under 100, none above: the same rule and words as the dashboard, so one
 * size reads the same on every surface.
 */
export function formatBytes(bytes: number): string {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = unit === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 2;
  const shown = Number(value.toFixed(digits));
  return `${SIZE_NUMBER.format(shown)} ${unit === 0 && shown === 1 ? "byte" : UNITS[unit]}`;
}

/** What a table shows where there is no value: an en dash, never a hyphen. */
export const NO_VALUE = "\u2013";

/** A true minus sign, for a negative number in a table. */
export const MINUS = "\u2212";

/** "UTC", "UTC+2:00", "UTC-5:30": one way to write a time zone, from minutes east of UTC. */
export function formatOffset(minutes: number): string {
  if (minutes === 0) return "UTC";
  const abs = Math.abs(minutes);
  return `UTC${minutes < 0 ? "-" : "+"}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, "0")}`;
}

/** "12 AM", "7 PM": an hour of the day, with the capitals the brand guide uses. */
export function formatHour(hour: number): string {
  return `${hour % 12 === 0 ? 12 : hour % 12} ${hour < 12 ? "AM" : "PM"}`;
}

/** A length of time in words: "40 seconds", "83 minutes", "5 hours", "2 days". Hours start at 120 minutes. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return "Under 1 second";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return plural(seconds, "second");
  const minutes = Math.round(ms / 60_000);
  if (minutes < 120) return plural(minutes, "minute");
  const hours = Math.round(ms / 3_600_000);
  if (hours < 48) return plural(hours, "hour");
  return plural(Math.round(ms / 86_400_000), "day");
}

/** "on Jan 21, 2026" for a stretch of one day, "Jan 21, 2026 to Jan 23, 2026" for longer, from the two written dates. */
export function stretchDates(start: string, end: string): string {
  return start === end ? `on ${start}` : `${start} to ${end}`;
}

/** "24%". */
export function formatPercent(fraction: number): string {
  return `${Math.round(Math.max(0, fraction) * 100)}%`;
}
