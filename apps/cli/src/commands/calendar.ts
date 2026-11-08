/**
 * snappy-export calendar: when your chats and Snaps happened, day by day, and what kind they were.
 * Read-only: it writes no file and never opens the ledger. The numbers come from core's activity
 * calendar module, which sees only a kind and a time per event, so nothing here can name a person.
 * Only the kind and the time go in: no conversation, no direction, no username. This file turns the
 * result into short sentences and tables.
 */
import { insights } from "@snappy-export/core";
import { intOption } from "../args.ts";
import { formatCount, formatDate, formatOffset, formatPercent, hasHave, isAre, NO_VALUE, noun, plural, stretchDates, wasWere } from "../format.ts";
import type { InsightCommand } from "../insights-command.ts";
import { insightTerm, loadInsightInput, parseInsightArgs, parseUtcOffsetHours } from "../insights-input.ts";
import type { CommonFlags } from "../insights-input.ts";
import type { Io } from "../io.ts";
import { finish, jsonText, renderNotes, section } from "../render-insights.ts";
import type { NoteLine } from "../render-insights.ts";
import type { Term } from "../term.ts";

export const CALENDAR_USAGE = `Usage: snappy-export calendar <ZIP files or folder...> [options]

Shows when your chats and Snaps happened, by day, week and month, and what kinds they were. It
reads kinds and times only, never names, message text, photos or videos. Runs and totals cover
your whole account, never one friend.

Times are in UTC unless you set --utc-offset. Give it every part of your export, or a folder or
wildcard such as "mydata*.zip".

Options
  --year <year>         The year to list. Default: the year of your latest chat or Snap.
  --utc-offset <hours>  Hours from UTC, such as 2 or 5:30. Write -5 as --utc-offset=-5.
  --limit <n>           The most years to list in the kinds table. Default 10.
  --detail              Add a row for every full week of the year.
  --json                Print JSON instead of text.
  --verbose             Add a short code to each note, for bug reports.
  --no-color            Plain text.

Exit codes: 0 done, 1 could not run, 2 the export has errors.
`;

interface CalendarFlags extends CommonFlags {
  year?: string;
  "utc-offset"?: string;
  limit?: string;
  detail?: boolean;
}
type Calendar = insights.activityCalendar.ActivityCalendarResult;
type Run = insights.activityCalendar.ActivityRun | null;
type Mix = insights.activityCalendar.KindMix;

/** Years listed in the kinds table by default. */
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 1000;
/** The years a person may ask for (core accepts the same range). */
const MIN_YEAR = 1969;
const MAX_YEAR = 2200;

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const KIND_NAMES: Record<insights.activityCalendar.ActivityKind, string> = {
  text: "Text",
  image: "Image",
  video: "Video",
  note: "Note",
  sticker: "Sticker",
  other: "Other",
};
const BAR_WIDTH = 20;

const offsetLabel = formatOffset;

/** Turns a year and month key such as 2026-03 into "Mar 2026". */
function monthLabel(month: string): string {
  const [year, number] = month.split("-");
  return `${MONTH_NAMES[Number(number) - 1] ?? "?"} ${year ?? ""}`;
}

/** Turns a date key such as 2026-03-02 into "Mar 2, 2026". */
function dayLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  if (y === undefined || m === undefined || d === undefined) return NO_VALUE;
  return formatDate(Date.UTC(y, m - 1, d));
}

const things = (n: number): string => plural(n, "chat or Snap", "chats and Snaps");

const num = (v: number | undefined): number => (typeof v === "number" ? v : 0);

/** The sentence for one note. Hedged: Snappy infers from kinds and times alone. */
function noteText(n: insights.activityCalendar.ActivityCalendarNote): string {
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
      return `Only ${things(count)} ${wasWere(count)} counted, so this picture may be weak.`;
    case "many-other-kind":
      return `About ${num(n.params.percent)}% have a kind Snappy cannot sort, so the mix may be off.`;
    case "year-adjusted":
      return `That year was not usable, so Snappy shows ${num(n.params.year)}.`;
    case "year-empty":
      return `No chats or Snaps were found in ${num(n.params.year)}, so its calendar is empty.`;
    case "offset-adjusted":
      return "The time zone was moved to the nearest allowed one.";
    default:
      return "Snappy noted something it cannot describe. Run it with --verbose and share the code.";
  }
}

function severityOf(code: insights.activityCalendar.ActivityCalendarNoteCode): NoteLine["severity"] {
  return code === "no-events" || code === "no-usable-events" || code === "few-events" || code === "many-other-kind" ? "warning" : "info";
}

const runLength = (run: NonNullable<Run>): string => plural(run.days, "day");

/** One cell for a run: "12 days, Mar 2, 2026 to Mar 13, 2026", or "1 day, on Mar 2, 2026". */
function runCell(run: Run): string {
  if (run === null) return NO_VALUE;
  return `${runLength(run)}, ${stretchDates(dayLabel(run.start), dayLabel(run.end))}`;
}

function runRows(streaks: insights.activityCalendar.Streaks): string[][] {
  const row = (name: string, run: Run): string[] => (run === null ? [name, NO_VALUE, NO_VALUE, NO_VALUE] : [name, runLength(run), dayLabel(run.start), dayLabel(run.end)]);
  return [row("Longest active run", streaks.longestActive), row("Longest quiet run", streaks.longestQuiet)];
}

/** A busiest or quietest week as one cell: the week's first day and its count. A tie is marked. */
function weekCell(peak: insights.activityCalendar.WeekPeak | null): string {
  if (peak === null) return NO_VALUE;
  return `Week of ${dayLabel(peak.start)}, ${plural(peak.count, "chat or Snap", "chats and Snaps")}${peak.ties > 0 ? " (tied)" : ""}`;
}

export interface CalendarRenderOptions {
  /** The most years to list in the kinds table. Default 10. */
  limit?: number;
  /** Add a row for every full week of the year. */
  detail?: boolean;
}

function bar(term: Term, count: number, max: number): string {
  return term.meter(max > 0 ? count / max : 0, BAR_WIDTH);
}

function kindRows(all: Mix, year: Mix | null): string[][] {
  return insights.activityCalendar.KIND_ORDER.map((kind) => {
    const row = [KIND_NAMES[kind], formatCount(all[kind]), formatPercent(all.total > 0 ? all[kind] / all.total : 0)];
    if (year !== null) row.push(formatCount(year[kind]));
    return row;
  });
}

export function renderCalendar(result: Calendar, term: Term, verbose: boolean, options: CalendarRenderOptions = {}): string {
  const limit = Math.max(1, options.limit ?? DEFAULT_LIMIT);
  const out: string[] = [term.bold("Activity calendar")];
  const used = result.totals.used;
  const cal = result.calendar;

  if (used === 0) {
    out.push("  There is nothing to count yet.", "");
  } else {
    out.push(`  ${term.violet(`${things(used)}, on ${plural(result.totals.activeDays, "day")}.`)}`, "");

    const overview: string[][] = [["Counted", things(used)], ["Active days", formatCount(result.totals.activeDays)]];
    if (result.first !== null) overview.push(["First", formatDate(result.first)]);
    if (result.last !== null) overview.push(["Last", formatDate(result.last)]);
    overview.push(["Time zone", offsetLabel(result.utcOffsetMinutes)]);
    out.push(...section(term, "Overview", term.table([{ header: "Measure" }, { header: "Value" }], overview)));

    const runLines = term.table(
      [{ header: "Run" }, { header: "Length", align: "right" }, { header: "From" }, { header: "To" }],
      runRows(result.streaks),
    );
    runLines.push("", "Runs cover your whole account, never one friend.", "A quiet run has an active day on both sides.");
    out.push(...section(term, "Across all time", runLines));
  }

  if (cal !== null) {
    const yearFacts: string[][] = [
      ["Counted", things(cal.total)],
      ["Active days", formatCount(cal.activeDays)],
      ["Busiest full week", weekCell(cal.busiestWeek)],
      ["Quietest full week", weekCell(cal.quietestWeek)],
      ...[
        ["Longest active run", cal.streaks.longestActive],
        ["Longest quiet run", cal.streaks.longestQuiet],
      ].map(([name, run]) => [`${name as string} this year`, runCell(run as Run)]),
    ];
    out.push(...section(term, `Year ${cal.year}`, term.table([{ header: "Measure" }, { header: "Value" }], yearFacts)));

    if (cal.total > 0) {
      const maxMonth = Math.max(...cal.months.map((m) => m.count));
      out.push(
        ...section(
          term,
          `By month in ${cal.year}`,
          term.table(
            [{ header: "Month" }, { header: "Total", align: "right" }, { header: "Active days", align: "right" }, { header: "" }],
            cal.months.map((m) => [monthLabel(m.month), formatCount(m.count), formatCount(m.activeDays), bar(term, m.count, maxMonth)]),
          ),
        ),
      );
    }

    if (options.detail === true && cal.weeks.length > 0) {
      const maxWeek = Math.max(...cal.weeks.map((w) => w.count));
      const weekLines = term.table(
        [{ header: "Week of" }, { header: "Total", align: "right" }, { header: "" }],
        cal.weeks.map((w) => [dayLabel(w.start), formatCount(w.count), bar(term, w.count, maxWeek)]),
      );
      weekLines.push("", "Only full weeks between your first and last active day are listed.");
      out.push(...section(term, `By week in ${cal.year}`, weekLines));
    }
  }

  if (used > 0) {
    const yearMix = cal !== null && cal.total > 0 ? cal.mix : null;
    const columns = [{ header: "Kind" }, { header: "All time", align: "right" as const }, { header: "Share", align: "right" as const }];
    if (yearMix !== null && cal !== null) columns.push({ header: String(cal.year), align: "right" });
    const kindLines = term.table(columns, kindRows(result.mix, yearMix));
    kindLines.push("", "Other holds chat media, which may be a photo or a video.");
    out.push(...section(term, "Kinds", kindLines));

    const listed = result.mixByYear.slice(-limit);
    const yearLines = term.table(
      [
        { header: "Year" },
        ...insights.activityCalendar.KIND_ORDER.map((k) => ({ header: KIND_NAMES[k], align: "right" as const })),
        { header: "Total", align: "right" as const },
      ],
      listed.map((m) => [String(m.year), ...insights.activityCalendar.KIND_ORDER.map((k) => formatCount(m[k])), formatCount(m.total)]),
    );
    if (listed.length < result.mixByYear.length) {
      yearLines.push("", `Showing the latest ${plural(listed.length, "year")} of ${formatCount(result.mixByYear.length)}.`);
    }
    out.push(...section(term, "Kinds by year", yearLines));
  }

  const notes: NoteLine[] = result.notes.map((n) => ({ severity: severityOf(n.code), code: n.code, text: noteText(n) }));
  const noteLines = renderNotes(notes, term, { heading: "Notes", verbose });
  if (noteLines.length > 0) out.push(...noteLines, "");
  return finish(out);
}

export async function runCalendar(args: string[], io: Io): Promise<number> {
  const { values: flags, positionals } = parseInsightArgs<CalendarFlags>("calendar", args, {
    year: { type: "string" },
    "utc-offset": { type: "string" },
    limit: { type: "string" },
    detail: { type: "boolean" },
  });
  if (flags.help) {
    io.out.write(CALENDAR_USAGE);
    return 0;
  }
  const term = insightTerm(flags, io);
  // Check every option before reading anything.
  const utcOffsetMinutes = flags["utc-offset"] === undefined ? undefined : parseUtcOffsetHours(flags["utc-offset"]);
  const year = intOption("--year", flags.year, MIN_YEAR, MAX_YEAR);
  const limit = intOption("--limit", flags.limit, 1, MAX_LIMIT) ?? DEFAULT_LIMIT;

  const input = await loadInsightInput(positionals, io);

  if (input.broken) {
    // A damaged export gives a calendar that may mislead, so say so and stop, as analyze does.
    const notes: NoteLine[] = input.issues.map((i) => ({ severity: i.severity, code: i.code, text: i.message }));
    if (flags.json) {
      io.out.write(jsonText({ generatedAt: new Date(input.now).toISOString(), issues: input.issues, stopped: "export-errors" }));
    } else {
      io.out.write(
        finish([
          ...renderNotes(notes, term, { heading: "Export check", verbose: flags.verbose === true }),
          "",
          "Snappy stopped, since a calendar from a broken export may mislead.",
          'Run "snappy-export check" to see what to do.',
        ]),
      );
    }
    return 2;
  }

  // Only the kind and the time go to core: no conversation, no direction, no username.
  const events = input.parsed.chats.map((c) => ({ kind: c.kind, at: c.at }));
  const result = insights.activityCalendar.computeActivityCalendar(events, {
    now: input.now,
    ...(utcOffsetMinutes !== undefined && { utcOffsetMinutes }),
    ...(year !== undefined && { year }),
  });

  if (flags.json) {
    io.out.write(jsonText({ generatedAt: new Date(input.now).toISOString(), ...result }));
  } else {
    io.out.write(renderCalendar(result, term, flags.verbose === true, { limit, detail: flags.detail === true }));
  }
  return 0;
}

export const calendarCommand: InsightCommand = {
  name: "calendar",
  synopsis: "calendar <ZIP files...>",
  summary: "Show your activity by day, week and kind.",
  group: "Chats",
  usage: CALENDAR_USAGE,
  run: runCalendar,
};
