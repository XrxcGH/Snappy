/**
 * snappy-export anniversaries: which friendships reach a whole number of years soon. Read-only: it
 * writes no file and never opens the ledger. The dates come from core's anniversaries insight, which
 * uses current friends only. Usernames appear only in the result table the person asked for, never
 * in a note or an error.
 */
import { insights } from "@snappy-export/core";
import { intOption } from "../args.ts";
import { formatDate, noun, plural } from "../format.ts";
import type { InsightCommand } from "../insights-command.ts";
import { insightTerm, loadInsightInput, parseInsightArgs } from "../insights-input.ts";
import type { CommonFlags } from "../insights-input.ts";
import type { Io } from "../io.ts";
import { finish, jsonText, renderNotes, section } from "../render-insights.ts";
import type { NoteLine } from "../render-insights.ts";
import { PRIVACY_RESULTS, renderIssues, wrapText } from "../render.ts";
import type { Term } from "../term.ts";

export const ANNIVERSARIES_USAGE = `Usage: snappy-export anniversaries <ZIP files or folder...> [options]

Lists the friendships that reach a whole number of years soon. It reads your friends list and its
dates only, never message text, photos or videos.

Options
  --days <n>     How many days ahead to look, from 0 to 366. Default 30.
  --milestones   Show only 1, 2, 3, 5 and 10 year marks.
  --limit <n>    The most rows to show. Default 25.
  --json         Print JSON instead of text.
  --verbose      Add a short code to each note, for bug reports.
  --no-color     Plain text.

Exit codes: 0 done, 1 could not run, 2 the export has errors.
`;

type Flags = CommonFlags & { days?: string; milestones?: boolean; limit?: string };
type Result = insights.anniversaries.AnniversaryResult;

const DEFAULT_DAYS = 30;
const DEFAULT_LIMIT = 25;

export interface AnniversaryView {
  /** Show milestone years only. */
  milestonesOnly?: boolean;
  /** The most rows to print (the JSON keeps all of them). */
  limit?: number;
}

const num = (v: number | undefined): number => (typeof v === "number" ? v : 0);

/** The sentence for one note. Counts only, never a name. */
function noteText(n: insights.anniversaries.AnniversaryNote): string {
  const count = num(n.params.count);
  switch (n.code) {
    case "export-date-caveat":
      return "Dates come from when each connection was created. They may not match when you first met.";
    case "created-at-missing":
      return `${plural(count, "friend")} ${noun(count, "has", "have")} no date and ${noun(count, "is", "are")} left out.`;
    case "created-at-future":
      return `${plural(count, "date")} ${noun(count, "is", "are")} in the future. Snappy leaves ${noun(count, "it", "them")} out.`;
    case "duplicate-usernames":
      return `${plural(count, "repeated username")} in your friends list. Snappy counts each person once.`;
    case "invalid-username":
      return `${plural(count, "entry", "entries")} had no username and ${noun(count, "was", "were")} left out.`;
    case "now-invalid":
      return "Snappy could not read the date on your device, so it found nothing.";
    default:
      return "Snappy noted something it cannot describe. Run it with --verbose and share the code.";
  }
}

/** How far ahead the run looked, as the end of a sentence. */
function spanText(days: number): string {
  if (days === 0) return "today";
  return days === 1 ? "today or tomorrow" : `in the next ${days} days`;
}

/** "2027-02-28" as a date that reads like the rest of the output. */
function dayText(on: string): string {
  const [y = 0, m = 1, d = 1] = on.split("-").map(Number);
  return formatDate(Date.UTC(y, m - 1, d));
}

function remark(row: insights.anniversaries.AnniversaryRow): string {
  if (row.milestone) return row.leapDayShifted ? "Milestone, shown on Feb 28" : "Milestone";
  return row.leapDayShifted ? "Shown on Feb 28" : "";
}

export function renderAnniversaries(result: Result, term: Term, verbose: boolean, view: AnniversaryView = {}): string {
  const milestonesOnly = view.milestonesOnly === true;
  const limit = view.limit ?? DEFAULT_LIMIT;
  const rows = milestonesOnly ? result.milestones : result.upcoming;
  const span = spanText(result.windowDays);
  const out: string[] = [term.bold("Friendship anniversaries")];

  if (rows.length === 0) {
    out.push(`  ${milestonesOnly ? "No milestone anniversaries" : "No friendship anniversaries"} ${span}.`, "");
  } else {
    const n = rows.length;
    const year = milestonesOnly ? "a milestone year" : "a whole year";
    out.push(`  ${term.violet(`${plural(n, "friendship")} ${noun(n, "reaches", "reach")} ${year} ${span}.`)}`, "");
    const shown = rows.slice(0, Math.max(0, limit));
    const lines = term.table(
      [{ header: "Friend", flex: true }, { header: "Date" }, { header: "In", align: "right" }, { header: "Reaches" }, { header: "Details" }],
      shown.map((r) => [r.username, dayText(r.on), r.daysUntil === 0 ? "today" : plural(r.daysUntil, "day"), plural(r.years, "year"), remark(r)]),
    );
    if (shown.length < n) lines.push("", `${plural(n - shown.length, "more row")} not shown. Use --limit to see more.`);
    out.push(...section(term, "Coming up", lines));
  }

  const notes: NoteLine[] = result.notes.map((x) => ({ severity: "info", code: x.code, text: noteText(x) }));
  const noteLines = renderNotes(notes, term, { heading: "Notes", verbose });
  if (noteLines.length > 0) out.push(...noteLines, "");
  return finish(out);
}

export async function runAnniversaries(args: string[], io: Io): Promise<number> {
  const { values: flags, positionals } = parseInsightArgs<Flags>("anniversaries", args, {
    days: { type: "string" },
    milestones: { type: "boolean" },
    limit: { type: "string" },
  });
  if (flags.help) {
    io.out.write(ANNIVERSARIES_USAGE);
    return 0;
  }
  const term = insightTerm(flags, io);
  const windowDays = intOption("--days", flags.days, 0, 366) ?? DEFAULT_DAYS;
  const limit = intOption("--limit", flags.limit, 1, 100_000) ?? DEFAULT_LIMIT;

  const input = await loadInsightInput(positionals, io);
  if (input.broken) {
    if (flags.json) {
      io.out.write(jsonText({ generatedAt: new Date(input.now).toISOString(), issues: input.issues, stopped: "export-errors" }));
    } else {
      const issues = input.issues.map((i) => ({ ...i, source: "your export" }));
      const stop = wrapText("Snappy stopped, since a broken export can give wrong dates. Fix the problems above and run it again.", term.columns - 2);
      io.out.write([...renderIssues(issues, term, flags.verbose === true), "", ...stop, PRIVACY_RESULTS].join("\n") + "\n");
    }
    return 2;
  }

  // Current friends only: the other lists hold request dates, which would give wrong anniversaries.
  const result = insights.anniversaries.findAnniversaries(input.parsed.friends.friends, { now: input.now, windowDays });
  if (flags.json) {
    io.out.write(jsonText({ generatedAt: new Date(input.now).toISOString(), ...result }));
  } else {
    io.out.write(renderAnniversaries(result, term, flags.verbose === true, { milestonesOnly: flags.milestones === true, limit }));
  }
  return 0;
}

export const anniversariesCommand: InsightCommand = {
  name: "anniversaries",
  synopsis: "anniversaries <ZIP files...>",
  summary: "Find friendship anniversaries coming up.",
  group: "Friends",
  usage: ANNIVERSARIES_USAGE,
  run: runAnniversaries,
};
