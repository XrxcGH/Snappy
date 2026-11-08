/**
 * snappy-export habits: when you chat and Snap most. Read-only: it writes no file and never opens
 * the ledger. The numbers come from core's habits module, which sees only a direction and a time
 * per event, so nothing here can name a person. This file turns the result into short sentences.
 */
import { insights } from "@snappy-export/core";
import { intOption } from "../args.ts";
import { formatCount, formatDate, formatDuration, formatHour, formatOffset, formatPercent, hasHave, isAre, NO_VALUE, noun, plural, wasWere } from "../format.ts";
import type { InsightCommand } from "../insights-command.ts";
import { insightTerm, loadInsightInput, parseInsightArgs, parseUtcOffsetHours } from "../insights-input.ts";
import type { CommonFlags } from "../insights-input.ts";
import type { Io } from "../io.ts";
import { finish, jsonText, renderNotes, section } from "../render-insights.ts";
import type { NoteLine } from "../render-insights.ts";
import type { Term } from "../term.ts";

export const HABITS_USAGE = `Usage: snappy-export habits <ZIP files or folder...> [options]

Shows when you chat and Snap most, such as your busiest hours, days and months. It reads times
and directions only, never names, message text, photos or videos.

Times are in UTC unless you set --utc-offset. Give it every part of your export, or a folder or
wildcard such as "mydata*.zip".

Options
  --utc-offset <hours>  Hours from UTC, such as 2 or 5:30. Write -5 as --utc-offset=-5.
  --months <n>          How many recent months to list. Default 12.
  --detail              Add a row for every hour and weekday.
  --json                Print JSON instead of text.
  --verbose             Add a short code to each note, for bug reports.
  --no-color            Plain text.

Exit codes: 0 done, 1 could not run, 2 the export has errors.
`;

interface HabitsFlags extends CommonFlags {
  "utc-offset"?: string;
  months?: string;
  detail?: boolean;
}
type Habits = insights.habits.HabitsResult;

/** Months listed by default. */
const DEFAULT_MONTHS = 12;
const MAX_MONTHS = 1200;

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const BAR_WIDTH = 20;

const offsetLabel = formatOffset;

/** "12 AM", "9 PM". */
const hourLabel = formatHour;

/** Turns a year and month key such as 2026-03 into "Mar 2026". */
function monthLabel(month: string): string {
  const [year, number] = month.split("-");
  return `${MONTH_NAMES[Number(number) - 1] ?? "?"} ${year ?? ""}`;
}

/** The typical gap in words: "40 seconds", "83 minutes", "3 hours", "2 days". */
const gapText = formatDuration;

const things = (n: number): string => plural(n, "chat or Snap", "chats and Snaps");

const num = (v: number | undefined): number => (typeof v === "number" ? v : 0);

/** The sentence for one note. Hedged: Snappy infers from times and directions alone. */
function noteText(n: insights.habits.HabitsNote): string {
  const count = num(n.params.count);
  switch (n.code) {
    case "no-events":
      return "No chats or Snaps were found in your export.";
    case "no-usable-events":
      return "None of your chats or Snaps has a usable date, so there is nothing to count.";
    case "undated-skipped":
      return `${things(count)} ${hasHave(count)} no usable date. Snappy leaves ${noun(count, "it", "them")} out.`;
    case "future-skipped":
      return `${things(count)} ${isAre(count)} dated in the future. Snappy leaves ${noun(count, "it", "them")} out.`;
    case "few-events":
      return `Only ${things(count)} ${wasWere(count)} counted, so these patterns may be weak.`;
    case "many-unknown-direction":
      return `About ${num(n.params.percent)}% have no known direction, so the sent share may be off.`;
    case "offset-adjusted":
      return "The time zone was moved to the nearest allowed one.";
    default:
      return "Snappy noted something it cannot describe. Run it with --verbose and share the code.";
  }
}

function severityOf(code: insights.habits.HabitsNoteCode): NoteLine["severity"] {
  return code === "no-events" || code === "no-usable-events" || code === "many-unknown-direction" || code === "few-events" ? "warning" : "info";
}

export interface HabitsRenderOptions {
  /** How many recent months to list. Default 12. */
  months?: number;
  /** Add a row for every hour and weekday. */
  detail?: boolean;
}

function bar(term: Term, count: number, max: number): string {
  return term.meter(max > 0 ? count / max : 0, BAR_WIDTH);
}

export function renderHabits(result: Habits, term: Term, verbose: boolean, options: HabitsRenderOptions = {}): string {
  const monthsShown = Math.max(1, options.months ?? DEFAULT_MONTHS);
  const out: string[] = [term.bold("Habits")];
  const used = result.totals.used;

  if (used === 0) {
    out.push("  There is nothing to count yet.", "");
  } else {
    out.push(`  ${term.violet(`${things(used)}, on ${plural(result.activeDays, "day")}.`)}`, "");

    const overview: string[][] = [["Counted", things(used)], ["Active days", formatCount(result.activeDays)]];
    if (result.first !== null) overview.push(["First", formatDate(result.first)]);
    if (result.last !== null) overview.push(["Last", formatDate(result.last)]);
    if (result.medianGapMs !== null) overview.push(["Typical gap between them", gapText(result.medianGapMs)]);
    overview.push(["Time zone", offsetLabel(result.utcOffsetMinutes)]);
    out.push(...section(term, "Overview", term.table([{ header: "Measure" }, { header: "Value" }], overview)));

    const monthKeys = result.byMonth.map((m) => m.month);
    const interiorMonth = (p: insights.habits.Peak<string> | null): string =>
      p === null || p.ties > 0 || p.key === monthKeys[0] || p.key === monthKeys.at(-1) ? NO_VALUE : monthLabel(p.key);
    const tied = (p: { ties: number }): string => (p.ties > 0 ? " (tied)" : "");
    const quietHour = result.quietest.hour;
    const quietDay = result.quietest.weekday;
    const { hour, weekday, month } = result.busiest;
    const peaks: string[][] = [];
    if (hour) peaks.push(["Hour of day", `${hourLabel(hour.key)}${tied(hour)}`, formatPercent(hour.share), quietHour && quietHour.ties === 0 ? hourLabel(quietHour.key) : NO_VALUE]);
    if (weekday) peaks.push(["Day of week", `${WEEKDAYS[weekday.key] ?? NO_VALUE}${tied(weekday)}`, formatPercent(weekday.share), quietDay && quietDay.ties === 0 ? (WEEKDAYS[quietDay.key] ?? NO_VALUE) : NO_VALUE]);
    if (month) peaks.push(["Month", `${monthLabel(month.key)}${tied(month)}`, formatPercent(month.share), interiorMonth(result.quietest.month)]);
    out.push(
      ...section(term, "Busiest times", term.table([{ header: "Pattern" }, { header: "Busiest" }, { header: "Share", align: "right" }, { header: "Quietest" }], peaks)),
    );

    const c = result.totals;
    const directionLines = term.table(
      [{ header: "Direction" }, { header: "Count", align: "right" }, { header: "Share", align: "right" }],
      [
        ["Sent", formatCount(c.sent), formatPercent(c.sent / used)],
        ["Received", formatCount(c.received), formatPercent(c.received / used)],
        ["Unknown", formatCount(c.unknown), formatPercent(c.unknown / used)],
      ],
    );
    if (result.sentShare !== null) directionLines.push("", `Of those with a known direction, you sent about ${formatPercent(result.sentShare)}.`);
    out.push(...section(term, "Sent and received", directionLines));

    if (options.detail === true) {
      const maxHour = Math.max(...result.byHour.map((b) => b.total));
      out.push(
        ...section(term, "By hour", term.table(
          [{ header: "Hour" }, { header: "Count", align: "right" }, { header: "" }],
          result.byHour.map((b) => [hourLabel(b.hour), formatCount(b.total), bar(term, b.total, maxHour)]),
        )),
      );
      const maxDay = Math.max(...result.byWeekday.map((b) => b.total));
      out.push(
        ...section(term, "By weekday", term.table(
          [{ header: "Day" }, { header: "Count", align: "right" }, { header: "" }],
          result.byWeekday.map((b) => [WEEKDAYS[b.weekday] ?? NO_VALUE, formatCount(b.total), bar(term, b.total, maxDay)]),
        )),
      );
    }

    const listed = result.byMonth.slice(-monthsShown);
    const maxMonth = Math.max(...listed.map((m) => m.total));
    const monthLines = term.table(
      [{ header: "Month" }, { header: "Total", align: "right" }, { header: "Sent", align: "right" }, { header: "Received", align: "right" }, { header: "" }],
      listed.map((m) => [monthLabel(m.month), formatCount(m.total), formatCount(m.sent), formatCount(m.received), bar(term, m.total, maxMonth)]),
    );
    if (listed.length < result.byMonth.length) {
      monthLines.push("", `Showing the latest ${plural(listed.length, "month")} of ${formatCount(result.byMonth.length)}.`);
    }
    out.push(...section(term, "By month", monthLines));
  }

  const notes: NoteLine[] = result.notes.map((n) => ({ severity: severityOf(n.code), code: n.code, text: noteText(n) }));
  const noteLines = renderNotes(notes, term, { heading: "Notes", verbose });
  if (noteLines.length > 0) out.push(...noteLines, "");
  return finish(out);
}

export async function runHabits(args: string[], io: Io): Promise<number> {
  const { values: flags, positionals } = parseInsightArgs<HabitsFlags>("habits", args, {
    "utc-offset": { type: "string" },
    months: { type: "string" },
    detail: { type: "boolean" },
  });
  if (flags.help) {
    io.out.write(HABITS_USAGE);
    return 0;
  }
  const term = insightTerm(flags, io);
  // Check every option before reading anything.
  const utcOffsetMinutes = flags["utc-offset"] === undefined ? undefined : parseUtcOffsetHours(flags["utc-offset"]);
  const months = intOption("--months", flags.months, 1, MAX_MONTHS) ?? DEFAULT_MONTHS;

  const input = await loadInsightInput(positionals, io);

  if (input.broken) {
    // A damaged export gives patterns that may mislead, so say so and stop, as analyze does.
    const notes: NoteLine[] = input.issues.map((i) => ({ severity: i.severity, code: i.code, text: i.message }));
    if (flags.json) {
      io.out.write(jsonText({ generatedAt: new Date(input.now).toISOString(), issues: input.issues, stopped: "export-errors" }));
    } else {
      io.out.write(
        finish([
          ...renderNotes(notes, term, { heading: "Export check", verbose: flags.verbose === true }),
          "",
          "Snappy stopped, since habits from a broken export may mislead.",
          'Run "snappy-export check" to see what to do.',
        ]),
      );
    }
    return 2;
  }

  // Only the direction and the time go to core: no conversation, no kind.
  const events = input.parsed.chats.map((c) => ({ direction: c.direction, at: c.at }));
  const result = insights.habits.computeHabits(events, { now: input.now, ...(utcOffsetMinutes !== undefined && { utcOffsetMinutes }) });

  if (flags.json) {
    io.out.write(jsonText({ generatedAt: new Date(input.now).toISOString(), ...result }));
  } else {
    io.out.write(renderHabits(result, term, flags.verbose === true, { months, detail: flags.detail === true }));
  }
  return 0;
}

export const habitsCommand: InsightCommand = {
  name: "habits",
  synopsis: "habits <ZIP files...>",
  summary: "Show when you chat and Snap most.",
  group: "Chats",
  usage: HABITS_USAGE,
  run: runHabits,
};
