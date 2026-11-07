/**
 * Next-export reminder: builds an iCalendar (.ics) text with one event that reminds the user
 * to request their next Snapchat export. Pure and deterministic: time is a parameter, nothing
 * is read from a clock, and nothing leaves the device. No network, no URL fields.
 *
 * The file holds NO personal data: the title, description and UID are fixed generic text. The UID
 * is a constant, so nothing about the person (not even a hash) goes into the saved file.
 *
 * Defaults (all documented here so callers can rely on them):
 *  - interval: 3 months after the last export, calendar-correct (Nov 30 + 3 months = Feb 28/29).
 *  - dates are UTC calendar days taken from the epoch values (or days in the caller's own
 *    `utcOffsetMinutes`, when given; without it an evening export west of UTC counts as the next
 *    UTC day). All-day events are floating dates;
 *    timed events use floating local time (no zone), so the reminder fires at 9:00 wherever the
 *    person opens it. Default timed event: 9:00 for 30 minutes.
 *  - last export unknown or invalid: the interval counts from today. Last export in the future
 *    (clock skew): counted from today.
 *  - due date already past: moved to the day after today, so the reminder is never in the past.
 *  - alarm: none unless `alarmDaysBefore` is given (0 to 30 whole days). All-day events alert at
 *    9:00 on that day; timed events alert at the event start time.
 *  - the event is marked free (TRANSP:TRANSPARENT) and private (CLASS:PRIVATE).
 */

import { escapeIcsText, joinIcsLines } from "./export-reminder/ics.ts";

export { escapeIcsText, foldIcsLine, joinIcsLines, validateIcs, MAX_LINE_OCTETS } from "./export-reminder/ics.ts";
export type { IcsIssue, IcsValidation } from "./export-reminder/ics.ts";

export const DEFAULT_INTERVAL_MONTHS = 3;
export const MAX_INTERVAL_MONTHS = 120;
export const MAX_ALARM_DAYS = 30;
export const MAX_OFFSET_MINUTES = 840;
export const DEFAULT_TIME = { hour: 9, minute: 0, durationMinutes: 30 } as const;
/** Suggested file name for saving the text. */
export const REMINDER_FILE_NAME = "snappy-export-reminder.ics";

const PRODID = "-//Snappy//Export reminder//EN";
const SUMMARY = "Request your next Snapchat export";
const DESCRIPTION =
  "Time to request a fresh copy of your Snapchat data, so your lists stay current.\n" +
  "Made by Snappy on your device. It holds no personal data.";
const UID_DOMAIN = "snappy-export.invalid"; // reserved TLD (RFC 2606): never resolves anywhere

export interface CalendarDay {
  year: number;
  /** 1 to 12. */
  month: number;
  /** 1 to 31. */
  day: number;
}

export interface ReminderNote {
  /**
   * Stable machine code. One of: "no-last-export", "last-export-invalid", "last-export-in-future",
   * "interval-adjusted", "time-adjusted", "alarm-adjusted", "offset-adjusted", "day-clamped", "due-date-passed".
   */
  code: string;
  /** Small numbers only (never user data). */
  params: Record<string, number>;
}

export interface ReminderOptions {
  /** Epoch ms when "now" is, used for DTSTAMP and the past check. Required. */
  now: number;
  /** Epoch ms of the last export, when known. */
  lastExportAt?: number | null;
  /** Whole months between the last export and the reminder. Default 3, range 1 to 120. */
  intervalMonths?: number | null;
  /** Omit (or null) for an all-day event. Give it for a timed one (floating local time). */
  timed?: { hour?: number | null; minute?: number | null; durationMinutes?: number | null } | null;
  /** Add a display alarm this many whole days before (0 = same day at 9:00). Omit (or null) for none. */
  alarmDaysBefore?: number | null;
  /**
   * Minutes east of UTC (for example -300 for UTC-5, 60 for UTC+1), whole, -840 to 840. It only
   * decides which calendar day "today" and the last export fall on. Default 0: UTC days. Without
   * it, someone west of UTC who exported in the evening may see the due date one day later than
   * their local calendar says.
   */
  utcOffsetMinutes?: number | null;
}

export interface ExportReminder {
  /** The .ics text: CRLF line endings, lines folded at 75 octets. */
  ics: string;
  due: CalendarDay;
  /**
   * The due day written as midnight UTC (epoch ms). It is a label for the calendar day, not a
   * local instant: format it with UTC getters, since local formatting west of UTC shows the
   * previous evening.
   */
  dueAt: number;
  intervalMonths: number;
  allDay: boolean;
  uid: string;
  notes: ReminderNote[];
}

// ------------------------------------------------------------------ dates ---

const MIN_YEAR = 1970;
const MAX_NOW_YEAR = 9000;

/** Calendar day of an instant, in UTC unless an offset (minutes east of UTC) is given. */
function dayOf(ms: number, offsetMinutes = 0): CalendarDay {
  const d = new Date(ms + offsetMinutes * 60_000);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Adds whole months, clamping the day to the end of the target month
 * (Jan 31 + 1 month = Feb 28 or 29, never March 3).
 */
export function addMonths(from: CalendarDay, months: number): CalendarDay & { clamped: boolean } {
  const total = from.year * 12 + (from.month - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const last = daysInMonth(year, month);
  return { year, month, day: Math.min(from.day, last), clamped: from.day > last };
}

const dayKey = (d: CalendarDay) => d.year * 10000 + d.month * 100 + d.day;
const pad = (n: number, width = 2) => String(n).padStart(width, "0");
const ymd = (d: CalendarDay) => `${pad(d.year, 4)}${pad(d.month)}${pad(d.day)}`;

function stamp(ms: number): string {
  const d = new Date(ms);
  return `${ymd(dayOf(ms))}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

// ------------------------------------------------------------------- uid ---

/** Fixed event id. Same on every run, so importing a newer file updates the same event. */
export const REMINDER_UID = `snappy-export-reminder@${UID_DOMAIN}`;

/**
 * The event id. It is a constant and is never derived from user data: even a hash of a username
 * would leave the device inside the saved file and could be confirmed by guessing.
 */
export function reminderUid(): string {
  return REMINDER_UID;
}

// ---------------------------------------------------------------- builder ---

function wholeInRange(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
}

/**
 * Builds the reminder. Throws RangeError only when `now` is not a usable epoch value (a caller
 * bug); every other odd input is repaired and reported in `notes`.
 */
export function buildExportReminder(opts: ReminderOptions): ExportReminder {
  const { now } = opts;
  if (typeof now !== "number" || !Number.isFinite(now) || dayOf(now).year < MIN_YEAR || dayOf(now).year > MAX_NOW_YEAR) {
    throw new RangeError("now must be an epoch millisecond value between 1970 and year 9000");
  }
  const notes: ReminderNote[] = [];

  // Which calendar day an instant falls on: UTC unless the caller gives its own offset.
  let offset = 0;
  if (opts.utcOffsetMinutes !== undefined && opts.utcOffsetMinutes !== null) {
    if (wholeInRange(opts.utcOffsetMinutes, -MAX_OFFSET_MINUTES, MAX_OFFSET_MINUTES)) offset = opts.utcOffsetMinutes;
    else notes.push({ code: "offset-adjusted", params: { used: 0 } });
  }
  const today = dayOf(now, offset);

  // Interval.
  let intervalMonths = DEFAULT_INTERVAL_MONTHS;
  if (opts.intervalMonths !== undefined && opts.intervalMonths !== null) {
    if (wholeInRange(opts.intervalMonths, 1, MAX_INTERVAL_MONTHS)) intervalMonths = opts.intervalMonths;
    else {
      notes.push({ code: "interval-adjusted", params: { used: DEFAULT_INTERVAL_MONTHS } });
    }
  }

  // Base day: the last export, else today.
  let base = today;
  const last = opts.lastExportAt;
  if (last === undefined || last === null) notes.push({ code: "no-last-export", params: {} });
  else if (typeof last !== "number" || !Number.isFinite(last) || dayOf(last, offset).year < MIN_YEAR || dayOf(last, offset).year > MAX_NOW_YEAR) {
    notes.push({ code: "last-export-invalid", params: {} });
  } else if (last > now) notes.push({ code: "last-export-in-future", params: {} });
  else base = dayOf(last, offset);

  const added = addMonths(base, intervalMonths);
  let due: CalendarDay = { year: added.year, month: added.month, day: added.day };
  if (added.clamped) notes.push({ code: "day-clamped", params: { from: base.day, to: due.day } });
  if (dayKey(due) < dayKey(today)) {
    due = dayOf(Date.UTC(today.year, today.month - 1, today.day + 1));
    notes.push({ code: "due-date-passed", params: {} });
  }
  const dueAt = Date.UTC(due.year, due.month - 1, due.day);

  // Event times.
  const uid = reminderUid();
  const allDay = opts.timed === undefined || opts.timed === null; // null means "not given", like undefined
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:${PRODID}`, "CALSCALE:GREGORIAN", "BEGIN:VEVENT", `UID:${uid}`, `DTSTAMP:${stamp(now)}`];
  if (allDay) {
    const next = dayOf(dueAt + 24 * 60 * 60 * 1000);
    lines.push(`DTSTART;VALUE=DATE:${ymd(due)}`, `DTEND;VALUE=DATE:${ymd(next)}`);
  } else {
    const t: NonNullable<ReminderOptions["timed"]> = typeof opts.timed === "object" && opts.timed !== null ? opts.timed : {};
    const hour = wholeInRange(t.hour, 0, 23) ? t.hour : DEFAULT_TIME.hour;
    const minute = wholeInRange(t.minute, 0, 59) ? t.minute : DEFAULT_TIME.minute;
    const duration = wholeInRange(t.durationMinutes, 1, 24 * 60) ? t.durationMinutes : DEFAULT_TIME.durationMinutes;
    const given = (v: unknown) => v !== undefined && v !== null;
    const adjusted = (given(t.hour) && hour !== t.hour) || (given(t.minute) && minute !== t.minute) || (given(t.durationMinutes) && duration !== t.durationMinutes);
    if (adjusted) notes.push({ code: "time-adjusted", params: { hour, minute, durationMinutes: duration } });
    const startMs = Date.UTC(due.year, due.month - 1, due.day, hour, minute);
    const local = (ms: number) => stamp(ms).slice(0, -1); // floating: same digits, no "Z"
    lines.push(`DTSTART:${local(startMs)}`, `DTEND:${local(startMs + duration * 60_000)}`);
  }
  lines.push(`SUMMARY:${escapeIcsText(SUMMARY)}`, `DESCRIPTION:${escapeIcsText(DESCRIPTION)}`, "TRANSP:TRANSPARENT", "CLASS:PRIVATE", "SEQUENCE:0");

  // Optional alarm. All-day events start at midnight, so shift the trigger to land at 9:00.
  if (opts.alarmDaysBefore !== undefined && opts.alarmDaysBefore !== null) {
    const days = wholeInRange(opts.alarmDaysBefore, 0, MAX_ALARM_DAYS) ? opts.alarmDaysBefore : 0;
    if (days !== opts.alarmDaysBefore) notes.push({ code: "alarm-adjusted", params: { used: days } });
    const trigger = allDay
      ? days === 0 ? `PT${DEFAULT_TIME.hour}H` : `-PT${days * 24 - DEFAULT_TIME.hour}H`
      : days === 0 ? "PT0S" : `-P${days}D`;
    lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${escapeIcsText(SUMMARY)}`, `TRIGGER:${trigger}`, "END:VALARM");
  }
  lines.push("END:VEVENT", "END:VCALENDAR");

  return { ics: joinIcsLines(lines), due, dueAt, intervalMonths, allDay, uid, notes };
}
