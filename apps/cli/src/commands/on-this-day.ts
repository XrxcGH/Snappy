/**
 * snappy-export on-this-day: the Memories you took on this day in earlier years, plus calendar views.
 * Read-only: it writes no file and never opens the ledger. Only the dates of the Memories list are
 * read. The result carries counts and calendar numbers, never an id, a file name or a link.
 */
import { insights } from "@snappy-export/core";
import { intOption } from "../args.ts";
import { CliError } from "../errors.ts";
import { formatCount, formatDate, noun, plural, isAre, wasWere } from "../format.ts";
import type { InsightCommand } from "../insights-command.ts";
import { insightTerm, loadInsightInput, parseInsightArgs } from "../insights-input.ts";
import type { CommonFlags } from "../insights-input.ts";
import type { Io } from "../io.ts";
import { finish, jsonText, renderNotes } from "../render-insights.ts";
import type { NoteLine } from "../render-insights.ts";
import type { Term } from "../term.ts";

export const ON_THIS_DAY_USAGE = `Usage: snappy-export on-this-day <ZIP files or folder...> [options]

Shows the Memories you took on this day in earlier years, or around it. It reads the dates in
your Memories list only, never photos or videos, and it writes no file.

Options
  --date <date>      A day such as 2026-11-06. Default: today.
  --window <days>    Also look this many days either side, from 0 to 31.
  --year <year>      Show one year of Memories by month instead.
  --by-year          Show how many Memories each year holds instead.
  --offset <hours>   Hours from UTC, such as +1 or +5:30. West: --offset=-5.
  --json             Print JSON instead of text.
  --verbose          Add a short code to each note, for bug reports.
  --no-color         Plain text.

Exit codes: 0 done, 1 could not run, 2 the export has no usable Memories list.
`;

interface Flags extends CommonFlags {
  date?: string;
  window?: string;
  year?: string;
  "by-year"?: boolean;
  offset?: string;
}

type Core = typeof insights.memoriesOnThisDay;
type Note = insights.memoriesOnThisDay.InsightNote;

/** The view that was asked for, with the core result for it. */
export type OnThisDayView =
  | { kind: "day"; result: insights.memoriesOnThisDay.OnThisDayResult }
  | { kind: "nearby"; result: insights.memoriesOnThisDay.NearbyResult }
  | { kind: "year"; result: insights.memoriesOnThisDay.CalendarYearResult }
  | { kind: "years"; result: insights.memoriesOnThisDay.HeatmapResult };

/** Problems with the export as a whole, found by this command (not by core). */
export type ExportProblem = "export-problems" | "no-memories";

export interface OnThisDayReport {
  view: OnThisDayView;
  /** Minutes east of UTC that the dates use. */
  utcOffsetMinutes: number;
  counts: insights.memoriesOnThisDay.MemoryDayCounts;
  problems: ExportProblem[];
}

/** Most rows a list prints. The JSON always holds everything. */
export const MAX_ROWS = 40;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

const mem = (n: number): string => plural(n, "Memory", "Memories");

const num = (n: Note, key: string): number => n.params[key] ?? 0;

/** The sentence for one note from core. Hedged: Snappy infers from the dates in the list. */
function noteText(n: Note): string {
  const count = num(n, "count");
  switch (n.code) {
    case "undated-items":
      return `${mem(count)} ${noun(count, "has", "have")} no usable date, so Snappy left ${noun(count, "it", "them")} out.`;
    case "future-dates-skipped":
      return `${mem(count)} ${isAre(count)} dated in the future, so Snappy left ${noun(count, "it", "them")} out.`;
    case "duplicate-ids-skipped":
      return `${plural(count, "repeated Memory", "repeated Memories")} ${wasWere(count)} counted once.`;
    case "invalid-ids-skipped":
      return `${plural(count, "Memory", "Memories")} without an id ${wasWere(count)} left out.`;
    case "no-dated-items":
      return "No Memories have a usable date.";
    case "invalid-target":
      return "Snappy cannot use that date.";
    case "invalid-year":
      return "Snappy cannot use that year.";
    case "window-adjusted":
      return `The window was changed to ${plural(num(n, "windowDays"), "day")}.`;
    case "leap-day-folded":
      return `${mem(count)} from Feb 29 ${isAre(count)} shown on Feb 28, since this year has no Feb 29.`;
    default:
      return "Snappy noted something it cannot describe. Run it with --verbose and share the code.";
  }
}

const PROBLEM_TEXT: Record<ExportProblem, string> = {
  "export-problems": "Snappy found problems in your export. Run check to see them.",
  "no-memories": "Your export has no Memories list. Run check to see what is missing.",
};

function problemLine(p: ExportProblem): NoteLine {
  return { severity: "warning", code: p, text: PROBLEM_TEXT[p] };
}

/** Core's notes that apply to a view. The index notes come first, in core's order. */
const notesOf = (view: OnThisDayView): Note[] => view.result.notes;

/** "UTC", "UTC-5", "UTC+5:30". */
export function offsetLabel(minutes: number): string {
  if (minutes === 0) return "UTC";
  const abs = Math.abs(minutes);
  const mm = abs % 60;
  return `UTC${minutes < 0 ? "-" : "+"}${Math.floor(abs / 60)}${mm === 0 ? "" : `:${String(mm).padStart(2, "0")}`}`;
}

const dayText = (c: insights.memoriesOnThisDay.CivilDate): string => formatDate(Date.UTC(c.year, c.month - 1, c.day));

const yearsAgoText = (n: number): string => (n <= 0 ? "Same year" : `${plural(n, "year")} ago`);

function offsetDaysText(n: number): string {
  if (n === 0) return "Same day";
  return `${plural(Math.abs(n), "day")} ${n < 0 ? "before" : "after"}`;
}

/** Rows up to the cap, and a closing line when some were left out. */
function capped<T>(rows: T[], noun1: string, nounMany: string): { shown: T[]; more: string[] } {
  if (rows.length <= MAX_ROWS) return { shown: rows, more: [] };
  return { shown: rows.slice(0, MAX_ROWS), more: [`And ${plural(rows.length - MAX_ROWS, `more ${noun1}`, `more ${nounMany}`)}.`] };
}

function dayLines(term: Term, r: insights.memoriesOnThisDay.OnThisDayResult): string[] {
  const head = `Looking at ${dayText(r.target)}.`;
  if (r.total === 0) return [head, "", "No Memories were taken on this day in other years."];
  const rows = r.years.map((y) => [String(y.year), yearsAgoText(y.yearsAgo), formatCount(y.count)]);
  const { shown, more } = capped(rows, "year", "years");
  return [
    head,
    "",
    `${term.violet(mem(r.total))} from this day in ${plural(r.years.length, "year")}.`,
    "",
    ...term.table([{ header: "Year" }, { header: "When" }, { header: "Memories", align: "right" }], shown),
    ...more,
  ];
}

function nearbyLines(term: Term, r: insights.memoriesOnThisDay.NearbyResult): string[] {
  const head = `Looking at ${dayText(r.target)}, with ${plural(r.windowDays, "day")} either side.`;
  if (r.total === 0) return [head, "", "No Memories were taken around this day in other years."];
  const rows = r.years.flatMap((y) => y.days.map((d) => [dayText(d.date), offsetDaysText(d.offsetDays), formatCount(d.ids.length)]));
  const { shown, more } = capped(rows, "day", "days");
  return [
    head,
    "",
    `${term.violet(mem(r.total))} around this day in ${plural(r.years.length, "year")}.`,
    "",
    ...term.table([{ header: "Date" }, { header: "When" }, { header: "Memories", align: "right" }], shown),
    ...more,
  ];
}

function yearLines(term: Term, r: insights.memoriesOnThisDay.CalendarYearResult): string[] {
  if (r.total === 0) return [`No Memories are dated in ${r.year}.`];
  const busiest = [...r.days].sort((a, b) => b.count - a.count || a.month - b.month || a.day - b.day).slice(0, 5);
  return [
    `${term.violet(mem(r.total))} in ${r.year}, on ${plural(r.activeDays, "day")}.`,
    "",
    ...term.table(
      [{ header: "Month" }, { header: "Memories", align: "right" }],
      MONTHS.map((m, i) => [m, formatCount(r.months[i] ?? 0)]),
    ),
    "",
    "Busiest days",
    ...term.table(
      [{ header: "Date" }, { header: "Memories", align: "right" }],
      busiest.map((d) => [dayText({ year: r.year, month: d.month, day: d.day }), formatCount(d.count)]),
    ),
  ];
}

function yearsLines(term: Term, r: insights.memoriesOnThisDay.HeatmapResult): string[] {
  if (r.total === 0) return ["No Memories have a usable date."];
  const newestFirst = [...r.years].reverse();
  const rows = newestFirst.map((y) => {
    let best = 0;
    y.months.forEach((n, i) => {
      if (n > (y.months[best] ?? 0)) best = i;
    });
    const top = y.months[best] ?? 0;
    return [String(y.year), formatCount(y.total), top > 0 ? `${MONTHS[best]}, ${formatCount(top)}` : "-"];
  });
  const { shown, more } = capped(rows, "year", "years");
  return [
    `${term.violet(mem(r.total))} in ${plural(r.years.length, "year")}.`,
    "",
    ...term.table([{ header: "Year" }, { header: "Memories", align: "right" }, { header: "Busiest month", align: "right" }], shown),
    ...more,
  ];
}

const HEADING: Record<OnThisDayView["kind"], string> = {
  day: "Memories on this day",
  nearby: "Memories around this day",
  year: "Memories by month",
  years: "Memories by year",
};

export function renderOnThisDay(report: OnThisDayReport, term: Term, verbose: boolean): string {
  const { view } = report;
  const body =
    view.kind === "day"
      ? dayLines(term, view.result)
      : view.kind === "nearby"
        ? nearbyLines(term, view.result)
        : view.kind === "year"
          ? yearLines(term, view.result)
          : yearsLines(term, view.result);
  const out: string[] = [term.bold(HEADING[view.kind]), `  Dates use ${offsetLabel(report.utcOffsetMinutes)}.`, ""];
  out.push(...body.map((l) => (l === "" ? l : `  ${l}`)), "");

  const notes: NoteLine[] = [...report.problems.map(problemLine), ...notesOf(view).map((n) => ({ severity: "info" as const, code: n.code, text: noteText(n) }))];
  const noteLines = renderNotes(notes, term, { heading: "Notes", verbose });
  if (noteLines.length > 0) out.push(...noteLines, "");
  return finish(out);
}

/** A day as YYYY-MM-DD, checked to be a real calendar day. */
function parseDate(raw: string): insights.memoriesOnThisDay.CivilDate {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  const bad = new CliError("usage", "--date must be a real day written like 2026-11-06, from 1970 to 2200.");
  if (!m) throw bad;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(year, month - 1, day));
  if (year < 1970 || year > 2200 || d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) throw bad;
  return { year, month, day };
}

/** Hours from UTC as minutes: "-5", "+5:30", "0". */
function parseOffset(raw: string): number {
  const m = /^([+-])?(\d{1,2})(?::([0-5]\d))?$/.exec(raw.trim());
  const bad = new CliError("usage", "--offset must be hours from UTC such as +1 or +5:30, or =-5 for west, up to 14.");
  if (!m) throw bad;
  const minutes = Number(m[2]) * 60 + Number(m[3] ?? 0);
  if (minutes > 14 * 60) throw bad;
  return m[1] === "-" ? -minutes : minutes;
}

/** The result without ids, so the JSON holds counts and calendar numbers only. */
function viewJson(view: OnThisDayView): Record<string, unknown> {
  switch (view.kind) {
    case "day": {
      const { years, ...rest } = view.result;
      return { view: "day", ...rest, years: years.map(({ year, yearsAgo, count }) => ({ year, yearsAgo, count })) };
    }
    case "nearby": {
      const { years, ...rest } = view.result;
      return {
        view: "nearby",
        ...rest,
        years: years.map((y) => ({
          year: y.year,
          yearsAgo: y.yearsAgo,
          count: y.count,
          days: y.days.map((d) => ({ date: d.date, offsetDays: d.offsetDays, count: d.ids.length })),
        })),
      };
    }
    case "year":
      return { view: "year", ...view.result };
    default:
      return { view: "years", ...view.result };
  }
}

export async function runOnThisDay(args: string[], io: Io): Promise<number> {
  const { values: flags, positionals } = parseInsightArgs<Flags>("on-this-day", args, {
    date: { type: "string" },
    window: { type: "string" },
    year: { type: "string" },
    "by-year": { type: "boolean" },
    offset: { type: "string" },
  });
  if (flags.help) {
    io.out.write(ON_THIS_DAY_USAGE);
    return 0;
  }
  const term = insightTerm(flags, io);

  // Check every option before anything is read.
  const target = flags.date === undefined ? undefined : parseDate(flags.date);
  const windowDays = intOption("--window", flags.window, 0, 31) ?? 0;
  const year = intOption("--year", flags.year, 1970, 2200);
  const byYear = flags["by-year"] === true;
  const offset = flags.offset === undefined ? 0 : parseOffset(flags.offset);
  const days = target !== undefined || flags.window !== undefined;
  if ((year !== undefined ? 1 : 0) + (byYear ? 1 : 0) + (days ? 1 : 0) > 1) {
    throw new CliError("usage", "Choose one view: a day, --year or --by-year.");
  }

  const input = await loadInsightInput(positionals, io);
  const core: Core = insights.memoriesOnThisDay;
  const index = core.indexMemoryDays(input.parsed.memories, { now: input.now, utcOffsetMinutes: offset });

  let view: OnThisDayView;
  if (year !== undefined) view = { kind: "year", result: core.calendarYear(index, year) };
  else if (byYear) view = { kind: "years", result: core.monthYearHeatmap(index) };
  else {
    const day = target ?? core.localDate(input.now, offset);
    if (day === null) throw new CliError("usage", "Snappy could not read the date on this device.");
    const opts = { includeSameYear: target !== undefined };
    view =
      windowDays > 0
        ? { kind: "nearby", result: core.nearbyDays(index, day, { ...opts, windowDays }) }
        : { kind: "day", result: core.onThisDay(index, day, opts) };
  }

  const problems: ExportProblem[] = [];
  if (input.parsed.memories.length === 0) problems.push("no-memories");
  else if (input.broken) problems.push("export-problems");
  const report: OnThisDayReport = { view, utcOffsetMinutes: index.utcOffsetMinutes, counts: index.counts, problems };

  if (flags.json) {
    io.out.write(
      jsonText({
        generatedAt: new Date(input.now).toISOString(),
        utcOffsetMinutes: report.utcOffsetMinutes,
        counts: report.counts,
        ...viewJson(view),
        notes: [...problems.map((code) => ({ code, params: {} })), ...notesOf(view)],
      }),
    );
  } else {
    io.out.write(renderOnThisDay(report, term, flags.verbose === true));
  }
  return problems.length > 0 ? 2 : 0;
}

export const onThisDayCommand: InsightCommand = {
  name: "on-this-day",
  synopsis: "on-this-day <ZIP files...>",
  summary: "See your Memories from this day.",
  group: "Memories",
  usage: ON_THIS_DAY_USAGE,
  run: runOnThisDay,
};
