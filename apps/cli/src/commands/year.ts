/**
 * snappy-export year: a summary of one calendar year of chats, Snaps, friends and Memories.
 * Read-only: it writes no file and never opens the ledger. The numbers come from core's year in
 * review module, which sees only directions, kinds and dates, so nothing here can name a person.
 * This file turns the result into short sentences.
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
import type { Column, Term } from "../term.ts";

export const YEAR_USAGE = `Usage: snappy-export year <ZIP files or folder...> [options]

Sums up one calendar year of your chats, Snaps, new friends and Memories. It reads dates,
directions and media types only, never names, message text, photos or videos.

Snappy picks the latest year with dates unless you set --year. Times are in UTC unless you set
--utc-offset. Give it every part of your export, or a folder or wildcard such as "mydata*.zip".

Options
  --year <n>            The year to sum up, such as 2025. Default: the latest.
  --utc-offset <hours>  Hours from UTC, such as 2 or 5:30. Write -5 as --utc-offset=-5.
  --json                Print JSON instead of text.
  --verbose             Add a short code to each note, for bug reports.
  --no-color            Plain text.

Exit codes: 0 done, 1 could not run, 2 the export has errors.
`;

interface YearFlags extends CommonFlags {
  year?: string;
  "utc-offset"?: string;
}
type Review = insights.yearInReview.YearInReviewResult;

/** The years Snappy accepts: the range core uses. */
const MIN_YEAR = 1969;
const MAX_YEAR = 2200;

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const MONTH_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;
const BAR_WIDTH = 20;

const offsetLabel = formatOffset;

/** "2026-03-14" as "Mar 14, 2026". */
function dayText(day: string): string {
  const [y = 0, m = 1, d = 1] = day.split("-").map(Number);
  return formatDate(Date.UTC(y, m - 1, d));
}

const things = (n: number): string => plural(n, "chat or Snap", "chats and Snaps");
const items = (n: number): string => plural(n, "item");
const num = (v: number | undefined): number => (typeof v === "number" ? v : 0);

/** The sentence for one note. Hedged: Snappy infers from dates and directions alone. */
function noteText(n: insights.yearInReview.YearNote): string {
  const count = num(n.params.count);
  switch (n.code) {
    case "no-data":
      return "Nothing has a usable date, so there is no year to show.";
    case "year-invalid":
      return "That year could not be used, so Snappy chose the latest one.";
    case "no-activity-data":
      return "No chats or Snaps with a usable date were found.";
    case "no-friend-dates":
      return "No friend has a usable date, so new friends are not counted.";
    case "no-removal-dates":
      return "No removed friend has a usable date, so removals are not counted.";
    case "no-memories":
      return "No Memory has a usable date, so Memories are not counted.";
    case "no-activity-in-year":
      return `No chats or Snaps are dated in ${num(n.params.year)}.`;
    case "few-events":
      return `Only ${things(count)} ${wasWere(count)} counted, so this year may look thin.`;
    case "many-unknown-direction":
      return `About ${num(n.params.percent)}% have no known direction, so sent and received may be off.`;
    case "year-in-progress":
      return `${num(n.params.year)} is not over yet, so these numbers may still grow.`;
    case "undated-skipped":
      return `${items(count)} ${hasHave(count)} no usable date. Snappy leaves ${noun(count, "it", "them")} out.`;
    case "future-skipped":
      return `${items(count)} ${isAre(count)} dated in the future. Snappy leaves ${noun(count, "it", "them")} out.`;
    case "offset-adjusted":
      return "The time zone was moved to the nearest allowed one.";
    default:
      return "Snappy noted something it cannot describe. Run it with --verbose and share the code.";
  }
}

const WARNINGS: readonly insights.yearInReview.YearNoteCode[] = ["no-data", "no-activity-data", "no-activity-in-year", "few-events", "many-unknown-direction"];

function severityOf(code: insights.yearInReview.YearNoteCode): NoteLine["severity"] {
  return WARNINGS.includes(code) ? "warning" : "info";
}

function bar(term: Term, count: number, max: number): string {
  return term.meter(max > 0 ? count / max : 0, BAR_WIDTH);
}

/** The activity, or null when the year holds none: the section is then left out. */
const counted = (result: Review): NonNullable<Review["activity"]> | null => (result.activity !== null && result.activity.total.total > 0 ? result.activity : null);

function overviewRows(result: Review): string[][] {
  const a = counted(result);
  const { memories: m } = result;
  const rows: string[][] = [
    ["Year", result.inProgress ? `${result.year}, so far` : String(result.year)],
    ["Time zone", offsetLabel(result.utcOffsetMinutes)],
  ];
  if (a !== null) {
    rows.push(["Chats and Snaps", formatCount(a.total.total)], ["Active days", formatCount(a.activeDays)]);
    if (a.firstDay !== null) rows.push(["First", dayText(a.firstDay)]);
    if (a.lastDay !== null) rows.push(["Last", dayText(a.lastDay)]);
    if (a.longestQuietGap !== null) rows.push(["Longest quiet stretch", `${plural(a.longestQuietGap.days, "day")}, ${stretchDates(dayText(a.longestQuietGap.startDay), dayText(a.longestQuietGap.endDay))}`]);
  }
  if (result.friends.added !== null) rows.push(["New friends", formatCount(result.friends.added)]);
  if (result.friends.removed !== null) rows.push(["Friends removed", formatCount(result.friends.removed)]);
  if (m !== null) rows.push(["Memories", formatCount(m.total)]);
  return rows;
}

function headline(result: Review): string {
  if (result.year === null) return "There is nothing to count yet.";
  const a = counted(result);
  if (a === null) return `No chats or Snaps to count in ${result.year}.`;
  return `${things(a.total.total)}, on ${plural(a.activeDays, "day")} of ${result.year}.`;
}

export function renderYear(result: Review, term: Term, verbose: boolean): string {
  const out: string[] = [term.bold(result.year === null ? "Year in review" : `Year in review ${result.year}`)];
  out.push(`  ${result.year === null ? headline(result) : term.violet(headline(result))}`, "");

  if (result.year !== null) {
    out.push(...section(term, "Overview", term.table([{ header: "Measure" }, { header: "Value" }], overviewRows(result))));
    const a = counted(result);

    if (a !== null) {
      const tied = (p: { ties: number }): string => (p.ties > 0 ? " (tied)" : "");
      const peaks: string[][] = [];
      if (a.busiestMonth) peaks.push(["Month", `${MONTH_LONG[a.busiestMonth.key - 1] ?? NO_VALUE}${tied(a.busiestMonth)}`, formatCount(a.busiestMonth.count), formatPercent(a.busiestMonth.share)]);
      if (a.busiestDay) peaks.push(["Day", `${dayText(a.busiestDay.key)}${tied(a.busiestDay)}`, formatCount(a.busiestDay.count), formatPercent(a.busiestDay.share)]);
      out.push(
        ...section(term, "Busiest times", term.table([{ header: "Pattern" }, { header: "Busiest" }, { header: "Count", align: "right" }, { header: "Share", align: "right" }], peaks)),
      );

      const split = (name: string, c: { total: number; sent: number; received: number; unknown: number }): string[] => [name, formatCount(c.total), formatCount(c.sent), formatCount(c.received), formatCount(c.unknown)];
      const columns: Column[] = [{ header: "Type" }, { header: "Total", align: "right" }, { header: "Sent", align: "right" }, { header: "Received", align: "right" }, { header: "Unknown", align: "right" }];
      out.push(...section(term, "Sent and received", term.table(columns, [split("Snaps", a.snaps), split("Saved chats", a.chats), split("Both", a.total)])));
    }

    const memoryMonths = result.memories !== null && result.memories.total > 0 ? result.memories.byMonth : undefined;
    const maxActivity = Math.max(0, ...(a?.byMonth.map((m) => m.total) ?? []));
    const maxMemories = Math.max(0, ...(memoryMonths?.map((m) => m.total) ?? []));
    if (a !== null || memoryMonths !== undefined) {
      const columns: Column[] = [{ header: "Month" }];
      if (a !== null) columns.push({ header: "Chats and Snaps", align: "right" }, { header: "" });
      if (memoryMonths !== undefined) columns.push({ header: "Memories", align: "right" }, { header: "" });
      const rows = MONTH_NAMES.map((name, i) => {
        const row: string[] = [name];
        const activity = a?.byMonth[i];
        if (a !== null) row.push(formatCount(activity?.total ?? 0), bar(term, activity?.total ?? 0, maxActivity));
        const memories = memoryMonths?.[i];
        if (memoryMonths !== undefined) row.push(formatCount(memories?.total ?? 0), bar(term, memories?.total ?? 0, maxMemories));
        return row;
      });
      out.push(...section(term, "By month", term.table(columns, rows)));
    }
  }

  const notes: NoteLine[] = result.notes.map((n) => ({ severity: severityOf(n.code), code: n.code, text: noteText(n) }));
  if (counted(result) !== null) {
    notes.push({ severity: "info", code: "saved-chats-only", text: "Only saved chats are in the export, so chat counts may be lower than what you sent." });
  }
  if ((result.friends.added ?? 0) > 0) {
    notes.push({ severity: "info", code: "current-friends-only", text: "New friends counts people still on your list, so it may be lower than the real number." });
  }
  const noteLines = renderNotes(notes, term, { heading: "Notes", verbose });
  if (noteLines.length > 0) out.push(...noteLines, "");
  return finish(out);
}

export async function runYear(args: string[], io: Io): Promise<number> {
  const { values: flags, positionals } = parseInsightArgs<YearFlags>("year", args, {
    year: { type: "string" },
    "utc-offset": { type: "string" },
  });
  if (flags.help) {
    io.out.write(YEAR_USAGE);
    return 0;
  }
  const term = insightTerm(flags, io);
  // Check every option before reading anything.
  const year = intOption("--year", flags.year, MIN_YEAR, MAX_YEAR);
  const utcOffsetMinutes = flags["utc-offset"] === undefined ? undefined : parseUtcOffsetHours(flags["utc-offset"]);

  const input = await loadInsightInput(positionals, io);

  if (input.broken) {
    // A damaged export gives a year that may mislead, so say so and stop, as habits does.
    const notes: NoteLine[] = input.issues.map((i) => ({ severity: i.severity, code: i.code, text: i.message }));
    if (flags.json) {
      io.out.write(jsonText({ generatedAt: new Date(input.now).toISOString(), issues: input.issues, stopped: "export-errors" }));
    } else {
      io.out.write(
        finish([
          ...renderNotes(notes, term, { heading: "Export check", verbose: flags.verbose === true }),
          "",
          "Snappy stopped, since a year from a broken export may mislead.",
          'Run "snappy-export check" to see what to do.',
        ]),
      );
    }
    return 2;
  }

  // Core reads only the direction, kind and time of each event, the dates of friends and the date and type of each Memory.
  const { parsed } = input;
  const result = insights.yearInReview.computeYearInReview(
    { chats: parsed.chats, friends: parsed.friends.friends, deletedFriends: parsed.friends.deletedFriends, memories: parsed.memories },
    { now: input.now, ...(year !== undefined && { year }), ...(utcOffsetMinutes !== undefined && { utcOffsetMinutes }) },
  );

  if (flags.json) {
    io.out.write(jsonText({ generatedAt: new Date(input.now).toISOString(), ...result }));
  } else {
    io.out.write(renderYear(result, term, flags.verbose === true));
  }
  return 0;
}

export const yearCommand: InsightCommand = {
  name: "year",
  synopsis: "year <ZIP files...>",
  summary: "Sum up a year of chats, Snaps and Memories.",
  group: "Your export",
  usage: YEAR_USAGE,
  run: runYear,
};
