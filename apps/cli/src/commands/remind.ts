/**
 * snappy-export remind: makes a calendar file (.ics) with one event that reminds you to request your
 * next export. The date comes from core's exportReminder. The file holds no personal data and is
 * written only when the person passes --out. ZIP files are optional: they are read only to learn the
 * date of the last export, and nothing else from them is used or printed.
 */
import { insights } from "@snappy-export/core";
import { intOption } from "../args.ts";
import { CliError } from "../errors.ts";
import { formatDate, plural } from "../format.ts";
import type { InsightCommand } from "../insights-command.ts";
import { insightTerm, loadInsightInput, parseInsightArgs } from "../insights-input.ts";
import type { CommonFlags } from "../insights-input.ts";
import { checkOutputPath, saveInsightFile } from "../insights-output.ts";
import type { Io } from "../io.ts";
import { finish, jsonText, renderNotes, section } from "../render-insights.ts";
import type { NoteLine } from "../render-insights.ts";
import type { Term } from "../term.ts";

export const REMIND_USAGE = `Usage: snappy-export remind [ZIP files or folder...] [options]

Makes a calendar file that reminds you to request your next export. It holds no personal data.
ZIP files are optional, and are read only to find your last export date.

Options
  --last-export <date>  Date of your last export, such as 2026-11-01.
  --months <n>          Months to wait after the last export. Default 3.
  --time <time>         Make a timed event, in 24-hour time. Default is all day.
  --length <minutes>    Length of a timed event. Default 30.
  --alarm <days>        Add an alert this many days before. 0 is the same day.
  --utc-offset <min>    Minutes east of UTC, written as --utc-offset=-300.
  --out <file>          Save the calendar file. The name must end in .ics.
  --force               Replace the file if it already exists.
  --json                Print JSON instead of text.
  --verbose             Add a short code to each note, for bug reports.
  --no-color            Plain text.

Exit codes: 0 done, 1 could not run.
`;

interface Flags extends CommonFlags {
  "last-export"?: string;
  months?: string;
  time?: string;
  length?: string;
  alarm?: string;
  "utc-offset"?: string;
  out?: string;
  force?: boolean;
}

const OPTIONS = {
  "last-export": { type: "string" },
  months: { type: "string" },
  time: { type: "string" },
  length: { type: "string" },
  alarm: { type: "string" },
  "utc-offset": { type: "string" },
  out: { type: "string" },
  force: { type: "boolean" },
} as const;

/** Where the last export date came from. */
export type LastSource = "given" | "export" | "file" | "none";

/** What the command works out, and what the text and JSON are built from. */
export interface RemindView {
  reminder: insights.exportReminder.ExportReminder;
  /** The last export as an instant, when known. */
  lastExportAt: number | null;
  lastSource: LastSource;
  /** Minutes east of UTC used to decide calendar days. */
  utcOffsetMinutes: number;
  /** The time of a timed event. Absent for an all-day event. */
  timed?: { hour: number; minute: number; durationMinutes: number };
  alarmDaysBefore?: number;
  /** The path the person typed, once the file is written. */
  savedTo?: string;
}

const num = (v: number | undefined): number => (typeof v === "number" ? v : 0);

/** The sentence for one note. Hedged: Snappy works from the dates it was given. */
function noteText(n: insights.exportReminder.ReminderNote, view: RemindView): string {
  switch (n.code) {
    case "no-last-export":
      return "No last export date was found, so the wait counts from today.";
    case "last-export-invalid":
      return "The last export date could not be used, so the wait counts from today.";
    case "last-export-in-future":
      return "The last export date is in the future, so the wait counts from today.";
    case "interval-adjusted":
      return `The number of months could not be used, so Snappy used ${plural(num(n.params.used), "month")}.`;
    case "time-adjusted":
      return "The event time could not be used, so Snappy used the nearest time it could.";
    case "alarm-adjusted":
      return "The alert could not be used as given, so it is set for the same day.";
    case "offset-adjusted":
      return "The UTC offset could not be used, so Snappy used UTC days.";
    case "day-clamped":
      return "That day does not exist in the reminder month, so it falls on the last day of it.";
    case "due-date-passed":
      return view.lastSource === "none"
        ? "The reminder date had already passed, so it is set for tomorrow."
        : "Your next export may be due already, so the reminder is set for tomorrow.";
    default:
      return "Snappy noted something it cannot describe. Run it with --verbose and share the code.";
  }
}

const SOURCE_TEXT: Record<LastSource, string> = {
  given: "the date you gave",
  export: "your export",
  file: "the date of your ZIP file",
  none: "not known",
};

/** "9:00 AM". American English clocks, like the dates. */
function clock(hour: number, minute: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}

/** The calendar day an instant falls on, written as midnight UTC so formatDate shows it. */
function dayLabel(ms: number, offsetMinutes: number): number {
  const d = new Date(ms + offsetMinutes * 60_000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function alertText(days: number | undefined): string {
  if (days === undefined) return "None";
  return days === 0 ? "Same day" : `${plural(days, "day")} before`;
}

const row = (label: string, value: string): string => `${label.padEnd(15)}${value}`;

export function renderRemind(view: RemindView, term: Term, verbose: boolean): string {
  const { reminder } = view;
  const out: string[] = [term.bold("Export reminder"), `  ${term.violet(`Request your next export on ${formatDate(reminder.dueAt)}.`)}`, ""];

  const last = view.lastExportAt === null ? "Not known" : `${formatDate(dayLabel(view.lastExportAt, view.utcOffsetMinutes))}, from ${SOURCE_TEXT[view.lastSource]}`;
  const event =
    view.timed === undefined
      ? "All day"
      : `${clock(view.timed.hour, view.timed.minute)}, ${plural(view.timed.durationMinutes, "minute")}`;
  out.push(
    ...section(term, "Details", [
      row("Last export", last),
      row("Wait", plural(reminder.intervalMonths, "month")),
      row("Event", event),
      row("Alert", alertText(view.alarmDaysBefore)),
    ]),
  );

  const notes: NoteLine[] = reminder.notes.map((n) => ({
    severity: n.code === "due-date-passed" || n.code === "last-export-in-future" ? "warning" : "info",
    code: n.code,
    text: noteText(n, view),
  }));
  const noteLines = renderNotes(notes, term, { heading: "Notes", verbose });
  if (noteLines.length > 0) out.push(...noteLines, "");

  out.push(
    ...section(
      term,
      "File",
      view.savedTo === undefined
        ? ["Nothing was saved.", `Add --out ${insights.exportReminder.REMINDER_FILE_NAME} to make the calendar file.`]
        : [`Saved to ${view.savedTo}.`, "Open it in your calendar app to add the event."],
    ),
  );
  return finish(out);
}

/** A date such as 2026-11-01 as noon of that day in the person's own offset, or a usage error. */
function parseLastExport(raw: string | undefined, offsetMinutes: number): number | undefined {
  if (raw === undefined) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  const bad = new CliError("usage", "--last-export must be a date such as 2026-11-01.");
  if (m === null) throw bad;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const noon = Date.UTC(year, month - 1, day, 12);
  const check = new Date(noon);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) throw bad;
  return noon - offsetMinutes * 60_000;
}

function parseOffset(raw: string | undefined): number {
  if (raw === undefined) return 0;
  const n = Number(raw);
  if (!/^[+-]?\d+$/.test(raw.trim()) || n < -insights.exportReminder.MAX_OFFSET_MINUTES || n > insights.exportReminder.MAX_OFFSET_MINUTES) {
    throw new CliError("usage", `--utc-offset must be a whole number of minutes from -${insights.exportReminder.MAX_OFFSET_MINUTES} to ${insights.exportReminder.MAX_OFFSET_MINUTES}.`);
  }
  return n;
}

function parseTime(raw: string | undefined): { hour: number; minute: number } | undefined {
  if (raw === undefined) return undefined;
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  const hour = m === null ? NaN : Number(m[1]);
  const minute = m === null ? NaN : Number(m[2]);
  if (!(hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59)) {
    throw new CliError("usage", "--time must be a 24-hour time such as 09:30.");
  }
  return { hour, minute };
}

export async function runRemind(args: string[], io: Io): Promise<number> {
  const { values: flags, positionals } = parseInsightArgs<Flags>("remind", args, OPTIONS);
  if (flags.help) {
    io.out.write(REMIND_USAGE);
    return 0;
  }
  const term = insightTerm(flags, io);

  // Check every option and the output name before anything is read.
  const offset = parseOffset(flags["utc-offset"]);
  const given = parseLastExport(flags["last-export"], offset);
  const months = intOption("--months", flags.months, 1, insights.exportReminder.MAX_INTERVAL_MONTHS);
  const clockTime = parseTime(flags.time);
  const length = intOption("--length", flags.length, 1, 24 * 60);
  const alarm = intOption("--alarm", flags.alarm, 0, insights.exportReminder.MAX_ALARM_DAYS);
  if (length !== undefined && clockTime === undefined) {
    throw new CliError("usage", "--length needs --time, since only a timed event has a length.");
  }
  if (given !== undefined && positionals.length > 0) {
    throw new CliError("usage", "Give ZIP files or --last-export, not both.");
  }
  const save = { option: "--out", extension: ".ics", force: flags.force === true };
  if (flags.out !== undefined) await checkOutputPath(flags.out, save);
  else if (flags.force === true) throw new CliError("usage", "--force needs --out, since nothing is saved without it.");

  let now = io.now();
  let lastExportAt: number | null = given ?? null;
  let lastSource: LastSource = given === undefined ? "none" : "given";
  if (positionals.length > 0) {
    // The ZIP files give the date of the last export. Nothing else from them is used.
    const input = await loadInsightInput(positionals, io);
    now = input.now;
    if (input.takenAtSource !== "clock") {
      lastExportAt = input.takenAt;
      lastSource = input.takenAtSource;
    }
  }

  const timedPart = clockTime === undefined ? undefined : { ...clockTime, durationMinutes: length ?? insights.exportReminder.DEFAULT_TIME.durationMinutes };
  const reminder = insights.exportReminder.buildExportReminder({
    now,
    lastExportAt,
    intervalMonths: months,
    timed: timedPart ?? null,
    alarmDaysBefore: alarm ?? null,
    utcOffsetMinutes: offset,
  });
  const view: RemindView = {
    reminder,
    lastExportAt: lastExportAt !== null && lastExportAt <= now ? lastExportAt : null,
    lastSource: lastExportAt !== null && lastExportAt <= now ? lastSource : "none",
    utcOffsetMinutes: offset,
    ...(timedPart !== undefined && { timed: timedPart }),
    ...(alarm !== undefined && { alarmDaysBefore: alarm }),
  };

  if (flags.out !== undefined) {
    await saveInsightFile(flags.out, reminder.ics, save);
    view.savedTo = flags.out;
  }

  if (flags.json) {
    io.out.write(
      jsonText({
        generatedAt: new Date(now).toISOString(),
        lastExportAt: view.lastExportAt === null ? null : new Date(view.lastExportAt).toISOString(),
        lastExportSource: view.lastSource,
        saved: view.savedTo !== undefined,
        ...reminder,
      }),
    );
  } else {
    io.out.write(renderRemind(view, term, flags.verbose === true));
  }
  return 0;
}

export const remindCommand: InsightCommand = {
  name: "remind",
  synopsis: "remind [ZIP files...]",
  summary: "Make a reminder to request your next export.",
  group: "Your export",
  usage: REMIND_USAGE,
  run: runRemind,
};
