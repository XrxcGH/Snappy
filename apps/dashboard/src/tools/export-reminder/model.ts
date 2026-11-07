/**
 * Export reminder: the pure step. It turns the person's settings (and the date of the export the page holds, when
 * there is one) into core's reminder options, asks core for the due date and notes, and returns them as plain
 * values: dates and numbers, no username and no text of any kind.
 *
 * The calendar file itself is not kept in the result. `buildReminderFile` makes it from the same options, and the
 * page calls it only when the person presses the download button.
 */
import { insights } from "@snappy-export/core";
import type { ToolData } from "../data.ts";

const { exportReminder } = insights;

/** What the person typed, as text: an empty string means "not given". */
export interface ReminderParams {
  /** A date such as 2026-11-01. */
  lastExport: string;
  months: string;
  /** A 24-hour time such as 09:30. */
  time: string;
  alert: string;
  /** Minutes east of UTC, as text. */
  offset: string;
}

export const DEFAULT_PARAMS: ReminderParams = { lastExport: "", months: "3", time: "", alert: "", offset: "0" };

/** Offsets the time zone list offers, in minutes east of UTC. */
export const OFFSETS: readonly number[] = [
  -720, -660, -600, -570, -540, -480, -420, -360, -300, -240, -210, -180, -120, -60, 0, 60, 120, 180, 210, 240, 270, 300, 330, 345, 360, 390, 420, 480, 525, 540, 570, 600, 630, 660, 720, 765, 780, 840,
];

export type LastSource = "typed" | "export" | "none";

export interface ReminderResult {
  /** The due day as midnight UTC (a label for the calendar day). */
  dueAt: number;
  intervalMonths: number;
  allDay: boolean;
  /** The time of a timed event. Null for an all-day event. */
  timed: { hour: number; minute: number; durationMinutes: number } | null;
  /** Days before the event, or null for no alert. */
  alertDays: number | null;
  /** The last export day as midnight UTC, or null when the wait counts from today. */
  lastDayAt: number | null;
  lastSource: LastSource;
  /** Core's notes: stable codes and small numbers. */
  notes: insights.exportReminder.ReminderNote[];
  /** What core needs to make the file again. */
  options: insights.exportReminder.ReminderOptions;
}

const blank = (s: string): boolean => s.trim() === "";

/** A typed date as noon of that day in the person's own offset. NaN when it is not a real date. */
function parseDay(raw: string, offsetMinutes: number): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (m === null) return Number.NaN;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const noon = Date.UTC(year, month - 1, day, 12);
  const check = new Date(noon);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return Number.NaN;
  return noon - offsetMinutes * 60_000;
}

/** The calendar day an instant falls on in the person's offset, written as midnight UTC. */
function dayLabel(ms: number, offsetMinutes: number): number {
  const d = new Date(ms + offsetMinutes * 60_000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** The options core is given for these settings. Anything it cannot use goes through as it is, so core says so in a note. */
export function reminderOptions(data: ToolData, params: ReminderParams): { options: insights.exportReminder.ReminderOptions; lastSource: LastSource } {
  const asked = Number(params.offset);
  const offset = OFFSETS.includes(asked) ? asked : 0;

  let lastExportAt: number | null = null;
  let lastSource: LastSource = "none";
  if (!blank(params.lastExport)) {
    lastExportAt = parseDay(params.lastExport, offset);
    lastSource = "typed";
  } else if (data.parsed?.exportedAt !== undefined) {
    lastExportAt = data.parsed.exportedAt;
    lastSource = "export";
  }

  const time = /^(\d{1,2}):(\d{2})$/.exec(params.time.trim());
  const timed = blank(params.time) ? null : { hour: time === null ? Number.NaN : Number(time[1]), minute: time === null ? Number.NaN : Number(time[2]) };

  return {
    lastSource,
    options: {
      now: data.now,
      lastExportAt,
      intervalMonths: blank(params.months) ? null : Number(params.months),
      timed,
      alarmDaysBefore: blank(params.alert) ? null : Number(params.alert),
      utcOffsetMinutes: offset,
    },
  };
}

export function computeExportReminder(data: ToolData, params: ReminderParams = DEFAULT_PARAMS): ReminderResult {
  const { options, lastSource } = reminderOptions(data, params);
  const reminder = exportReminder.buildExportReminder(options);
  const codes = new Set(reminder.notes.map((n) => n.code));
  const offset = options.utcOffsetMinutes ?? 0;
  const noLast = codes.has("no-last-export") || codes.has("last-export-invalid") || codes.has("last-export-in-future");

  // Core repairs a time or an alert it cannot use and says what it used, so the page shows what the file holds.
  const adjusted = reminder.notes.find((n) => n.code === "time-adjusted")?.params;
  const alarm = reminder.notes.find((n) => n.code === "alarm-adjusted")?.params;
  const timed = reminder.allDay
    ? null
    : {
        hour: adjusted?.hour ?? options.timed?.hour ?? exportReminder.DEFAULT_TIME.hour,
        minute: adjusted?.minute ?? options.timed?.minute ?? exportReminder.DEFAULT_TIME.minute,
        durationMinutes: adjusted?.durationMinutes ?? exportReminder.DEFAULT_TIME.durationMinutes,
      };
  const alertDays = options.alarmDaysBefore === null || options.alarmDaysBefore === undefined ? null : (alarm?.used ?? options.alarmDaysBefore);

  return {
    dueAt: reminder.dueAt,
    intervalMonths: reminder.intervalMonths,
    allDay: reminder.allDay,
    timed,
    alertDays,
    lastDayAt: noLast || options.lastExportAt === null || options.lastExportAt === undefined ? null : dayLabel(options.lastExportAt, offset),
    lastSource: noLast ? "none" : lastSource,
    notes: reminder.notes,
    options,
  };
}

/** The calendar file, exactly as core makes it. Called only when the person presses the download button. */
export function buildReminderFile(result: ReminderResult): { fileName: string; text: string; mime: string } {
  return { fileName: exportReminder.REMINDER_FILE_NAME, text: exportReminder.buildExportReminder(result.options).ics, mime: "text/calendar" };
}
