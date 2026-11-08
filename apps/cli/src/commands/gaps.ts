/**
 * snappy-export gaps: the quiet stretches and the busiest stretch in your Memories timeline. Read-only:
 * it writes no file and never opens the ledger. Only the dates of the Memories list are read, plus the
 * oldest date in your friends list to say where an early gap starts. The result carries counts and
 * calendar months, never an id, a file name, a link or a username.
 */
import { insights } from "@snappy-export/core";
import type { FriendRecord } from "@snappy-export/core";
import { intOption } from "../args.ts";
import { formatCount, formatOffset, isAre, NO_VALUE, noun, plural, wasWere } from "../format.ts";
import type { InsightCommand } from "../insights-command.ts";
import { insightTerm, loadInsightInput, parseInsightArgs, parseUtcOffsetHours } from "../insights-input.ts";
import type { CommonFlags } from "../insights-input.ts";
import type { Io } from "../io.ts";
import { finish, jsonText, renderNotes, section } from "../render-insights.ts";
import type { NoteLine } from "../render-insights.ts";
import type { Term } from "../term.ts";

export const GAPS_USAGE = `Usage: snappy-export gaps <ZIP files or folder...> [options]

Finds the months with no Memories, and the months with the most. It reads the dates in your
Memories list and in your friends list only, never photos or videos, and it writes no file.

Options
  --min-gap <months>    Shortest gap to show, from 1 to 120. Default 2.
  --stretch <months>    Width of the busiest stretch, from 1 to 24. Default 3.
  --limit <n>           The most gaps to list, from 1 to 1000. Default 25.
  --utc-offset <hours>  Hours from UTC, such as 2 or 5:30. Write -5 as --utc-offset=-5.
  --json                Print JSON instead of text.
  --verbose             Add a short code to each note, for bug reports.
  --no-color            Plain text.

Exit codes: 0 done, 1 could not run, 2 the export has no usable Memories list.
`;

interface Flags extends CommonFlags {
  "min-gap"?: string;
  stretch?: string;
  limit?: string;
  "utc-offset"?: string;
}

type Result = insights.memoriesGaps.MemoryGapsResult;
type Note = insights.memoriesGaps.GapNote;
type Gap = insights.memoriesGaps.MemoryGap;
type YearMonth = insights.memoriesGaps.YearMonth;

/** Problems with the export as a whole, found by this command (not by core). */
export type ExportProblem = "export-problems" | "no-memories";

export interface GapsReport {
  result: Result;
  problems: ExportProblem[];
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 1000;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** Dates outside this window are not real (the same window core uses). */
const DATE_LOW = Date.UTC(1990, 0, 1);
const DATE_HIGH = Date.UTC(2100, 0, 1);

const mem = (n: number): string => plural(n, "Memory", "Memories");
const num = (n: Note, key: string): number => n.params[key] ?? 0;

/** "Mar 2021". */
export const monthText = (ym: YearMonth): string => `${MONTHS[ym.month - 1] ?? "?"} ${ym.year}`;

/** The sentence for one note from core. Hedged: Snappy infers from the dates in the list. */
function noteText(n: Note, r: Result): string {
  const count = num(n, "count");
  switch (n.code) {
    case "offset-invalid":
      return "That UTC offset is not valid, so Snappy used UTC.";
    case "now-invalid":
      return "Snappy could not read the date on your device, so it could not tell which dates are in the future.";
    case "min-gap-adjusted":
      return `The shortest gap was changed to ${plural(num(n, "minGapMonths"), "month")}.`;
    case "stretch-adjusted":
      return `The busiest stretch was changed to ${plural(num(n, "stretchMonths"), "month")}.`;
    case "since-invalid":
      return "Snappy could not use your oldest friend date, so it skipped gaps before your first Memory.";
    case "exported-at-invalid":
      return "The export date is not usable, so Snappy used today's date.";
    case "exported-at-future":
      return "The export date is in the future, so Snappy used today's date.";
    case "undated-items":
      return `${mem(count)} ${noun(count, "has", "have")} no usable date, so Snappy left ${noun(count, "it", "them")} out.`;
    case "future-dates-skipped":
      return `${mem(count)} ${isAre(count)} dated in the future, so Snappy left ${noun(count, "it", "them")} out.`;
    case "duplicate-ids-skipped":
      return `${plural(count, "repeated Memory", "repeated Memories")} ${wasWere(count)} counted once.`;
    case "no-dated-items":
      return "No Memories have a usable date.";
    case "single-month":
      return "All dated Memories fall in one month, so there is no timeline to compare.";
    case "no-gaps":
      return `Snappy found no gaps of ${plural(r.minGapMonths, "month")} or more.`;
    case "gaps-may-be-quiet-time":
      return `${noun(count, "This gap", "These gaps")} may be a quiet time. Snappy cannot tell if anything is missing.`;
    case "gap-near-limited-export":
      return `${plural(count, "gap")} at the start or end may come from a date range chosen for the export.`;
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

/** "UTC", "UTC+2:00", "UTC-5:30": the shared time zone label. */
export const offsetLabel = formatOffset;

const KIND_TEXT: Record<Gap["kind"], string> = {
  start: "Before first Memory",
  middle: "Between Memories",
  end: "Since last Memory",
};

/** The oldest usable date in the current friends list, or undefined. It says when an early gap starts. */
export function oldestFriendDate(friends: ReadonlyArray<Pick<FriendRecord, "createdAt">>, now: number): number | undefined {
  let oldest: number | undefined;
  for (const f of friends) {
    const at = f.createdAt;
    if (typeof at !== "number" || !Number.isFinite(at) || at < DATE_LOW || at > DATE_HIGH || at > now) continue;
    if (oldest === undefined || at < oldest) oldest = at;
  }
  return oldest;
}

const share = (count: number, total: number): string => (total > 0 ? `${Math.round((count / total) * 100)}%` : NO_VALUE);

function timelineLines(term: Term, r: Result): string[] {
  const range = r.range;
  if (range === null) return ["No Memories have a usable date."];
  const first = monthText(range.first);
  const last = monthText(range.last);
  return [
    `${term.violet(mem(r.counts.dated))} in ${plural(range.months, "month")}, from ${first}${first === last ? "" : ` to ${last}`}.`,
    `${plural(range.activeMonths, "month")} ${noun(range.activeMonths, "has", "have")} Memories and ${formatCount(range.emptyMonths)} ${isAre(range.emptyMonths)} empty.`,
  ];
}

function gapLines(term: Term, r: Result, limit: number): string[] {
  if (r.gaps.length === 0) return [`No gaps of ${plural(r.minGapMonths, "month")} or more.`];
  const shown = r.gaps.slice(0, limit);
  const lines = term.table(
    [{ header: "Kind" }, { header: "From" }, { header: "To" }, { header: "Months", align: "right" }, { header: "Details" }],
    shown.map((g) => [KIND_TEXT[g.kind], monthText(g.from), monthText(g.to), formatCount(g.months), g.exportHint ? "Export may be limited" : ""]),
  );
  if (r.gaps.length > shown.length) lines.push(`And ${plural(r.gaps.length - shown.length, "more gap")}. Use --limit to see more.`);
  if (r.gaps.some((g) => g.kind === "start")) lines.push("Early gaps count from your oldest friend date.");
  return lines;
}

function busiestLines(term: Term, r: Result): string[] {
  const rows: string[][] = [];
  if (r.busiestMonth !== null) {
    rows.push(["Busiest month", monthText(r.busiestMonth), formatCount(r.busiestMonth.count), share(r.busiestMonth.count, r.counts.dated)]);
  }
  const s = r.busiestStretch;
  // A one-month stretch is the busiest month again.
  if (s !== null && s.months > 1) {
    const when = `${monthText(s.from)} to ${monthText(s.to)}`;
    rows.push([`Busiest ${plural(s.months, "month")}`, when, formatCount(s.count), `${s.sharePercent}%`]);
  }
  return term.table([{ header: "Highlight" }, { header: "When" }, { header: "Memories", align: "right" }, { header: "Share", align: "right" }], rows);
}

export function renderGaps(report: GapsReport, term: Term, verbose: boolean, limit = DEFAULT_LIMIT): string {
  const { result: r } = report;
  const out: string[] = [
    term.bold("Memories timeline gaps"),
    `  Dates use ${offsetLabel(r.utcOffsetMinutes)}.${r.utcOffsetMinutes === 0 ? " Use --utc-offset to change this." : ""}`,
    "",
  ];
  out.push(...section(term, "Timeline", timelineLines(term, r)));
  if (r.range !== null) {
    out.push(...section(term, "Gaps", gapLines(term, r, limit)));
    out.push(...section(term, "Busiest", busiestLines(term, r)));
  }

  const notes: NoteLine[] = [...report.problems.map(problemLine), ...r.notes.map((n) => ({ severity: "info" as const, code: n.code, text: noteText(n, r) }))];
  const noteLines = renderNotes(notes, term, { heading: "Notes", verbose });
  if (noteLines.length > 0) out.push(...noteLines, "");
  return finish(out);
}

export async function runGaps(args: string[], io: Io): Promise<number> {
  const { values: flags, positionals } = parseInsightArgs<Flags>("gaps", args, {
    "min-gap": { type: "string" },
    stretch: { type: "string" },
    limit: { type: "string" },
    "utc-offset": { type: "string" },
  });
  if (flags.help) {
    io.out.write(GAPS_USAGE);
    return 0;
  }
  const term = insightTerm(flags, io);

  // Check every option before anything is read.
  const minGapMonths = intOption("--min-gap", flags["min-gap"], 1, 120);
  const stretchMonths = intOption("--stretch", flags.stretch, 1, 24);
  const limit = intOption("--limit", flags.limit, 1, MAX_LIMIT) ?? DEFAULT_LIMIT;
  const offset = flags["utc-offset"] === undefined ? 0 : parseUtcOffsetHours(flags["utc-offset"], "--utc-offset");

  const input = await loadInsightInput(positionals, io);
  const since = oldestFriendDate(input.parsed.friends.friends, input.now);
  const result = insights.memoriesGaps.findMemoryGaps(input.parsed.memories, {
    now: input.now,
    utcOffsetMinutes: offset,
    ...(minGapMonths !== undefined && { minGapMonths }),
    ...(stretchMonths !== undefined && { stretchMonths }),
    ...(since !== undefined && { since }),
    ...(input.exportedAt !== undefined && { exportedAt: input.exportedAt }),
    issueCodes: input.issues.map((i) => i.code),
  });

  const problems: ExportProblem[] = [];
  if (input.parsed.memories.length === 0) problems.push("no-memories");
  else if (input.broken) problems.push("export-problems");
  const report: GapsReport = { result, problems };

  if (flags.json) {
    io.out.write(
      jsonText({
        generatedAt: new Date(input.now).toISOString(),
        ...result,
        notes: [...problems.map((code) => ({ code, params: {} })), ...result.notes],
      }),
    );
  } else {
    io.out.write(renderGaps(report, term, flags.verbose === true, limit));
  }
  return problems.length > 0 ? 2 : 0;
}

export const gapsCommand: InsightCommand = {
  name: "gaps",
  synopsis: "gaps <ZIP files...>",
  summary: "Find quiet stretches in your Memories.",
  group: "Memories",
  usage: GAPS_USAGE,
  run: runGaps,
};
