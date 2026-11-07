/**
 * snappy-export reach-out: who tends to reach out first in each one-to-one chat. Read-only: it writes
 * no file and never opens the ledger. The lists come from core's findWhoReachesOutFirst, which reads
 * only each saved chat or Snap's conversation, direction and time. A gap is a plain length of time,
 * so there is no time zone option. Usernames appear in the result tables the person asked for, and
 * nowhere else: notes and errors carry counts only.
 */
import { insights } from "@snappy-export/core";
import { intOption } from "../args.ts";
import { formatCount, formatPercent, hasHave, isAre, noun, plural, wasWere } from "../format.ts";
import type { InsightCommand } from "../insights-command.ts";
import { insightTerm, loadInsightInput, parseInsightArgs } from "../insights-input.ts";
import type { CommonFlags } from "../insights-input.ts";
import type { Io } from "../io.ts";
import { finish, jsonText, renderNotes, section } from "../render-insights.ts";
import type { NoteLine } from "../render-insights.ts";
import type { Term } from "../term.ts";

export const REACH_OUT_USAGE = `Usage: snappy-export reach-out <ZIP files or folder...> [options]

Shows who tends to reach out first in each one-to-one chat. A new exchange starts after a long
silence, and whoever wrote first started it. It reads who sent each saved chat and Snap and when,
never message text, photos or videos.

Options
  --gap-hours <n>       Hours of silence that start a new exchange. Default 6.
  --min-exchanges <n>   Exchanges a chat needs before it is listed. Default 5.
  --share <percent>     How much of the exchanges one side must start. Default 70.
  --limit <n>           Rows to show in each list. Default 15.
  --json                Print JSON instead of text.
  --verbose             Add a short code to each note, for bug reports.
  --no-color            Plain text.

Exit codes: 0 done, 1 could not run, 2 the export has errors and was not read.
`;

type Flags = CommonFlags & { "gap-hours"?: string; "min-exchanges"?: string; share?: string; limit?: string };
type Report = insights.reachOutFirst.ReachOutReport;
type Person = insights.reachOutFirst.ReachOutPerson;
type Note = insights.reachOutFirst.ReachOutNote;

const DEFAULT_LIMIT = 15;

export interface ReachOutView {
  /** Rows shown in each list. */
  limit?: number;
}

const count = (n: Note): number => n.params.count ?? 0;

/** The sentence for one note. Counts only: a note never names a person. */
function noteText(n: Note): string {
  const c = count(n);
  switch (n.code) {
    case "invalid-now":
      return "Snappy could not read today's date, so it left the lists empty.";
    case "no-events":
      return "Your export has no saved chats or Snaps, so there is nothing to check.";
    case "no-one-to-one-events":
      return "Your saved chats are all group chats, and Snappy leaves those out.";
    case "group-events-skipped":
      return `${plural(c, "group chat event")} ${wasWere(c)} left out.`;
    case "events-without-time":
      return `${plural(c, "event")} had no usable date and ${wasWere(c)} left out.`;
    case "events-in-future":
      return `${plural(c, "event")} ${isAre(c)} dated after the export. Snappy left ${noun(c, "it", "them")} out.`;
    case "events-without-person":
      return `${plural(c, "event")} had no person attached and ${wasWere(c)} left out.`;
    case "people-not-in-friends":
      return `${plural(c, "chat")} with people outside your friends list ${wasWere(c)} left out.`;
    case "exchanges-starter-unknown":
      return `${plural(c, "exchange")} could not be counted, since the export does not say who wrote first.`;
    case "exchanges-starter-tied":
      return `${plural(c, "exchange")} began with a sent and a received message at the same moment. Snappy cannot tell who wrote first.`;
    case "people-too-few-exchanges":
      return `${plural(c, "chat")} ${hasHave(c)} too few exchanges to judge. Snappy does not list ${noun(c, "it", "them")}.`;
    case "people-starter-unreliable":
      return `${plural(c, "chat")} had too many exchanges with no known starter to judge.`;
    default:
      return "Snappy noted something it cannot describe. Run it with --verbose and share the code.";
  }
}

/** Rows up to the limit, then a line saying how many were left out. */
function listLines(term: Term, columns: Parameters<Term["table"]>[0], rows: string[][], limit: number): string[] {
  const shown = rows.slice(0, limit);
  const lines = term.table(columns, shown);
  const more = rows.length - shown.length;
  if (more > 0) lines.push("", `${formatCount(more)} more not shown. Use --limit to show more.`);
  return lines;
}

/** One list: who started most of the exchanges, with both counts and the side's share. */
function sideLines(term: Term, people: readonly Person[], side: "you" | "them", limit: number): string[] {
  if (people.length === 0) return ["None found."];
  const rows = people.map((p) => {
    const mine = side === "you" ? p.byYou : p.byThem;
    return [p.username, formatCount(p.byYou), formatCount(p.byThem), formatPercent(mine / p.exchanges)];
  });
  return listLines(term, [{ header: "Friend" }, { header: "You started", align: "right" }, { header: "They started", align: "right" }, { header: "Share", align: "right" }], rows, limit);
}

export function renderReachOut(report: Report, term: Term, verbose: boolean, view: ReachOutView = {}): string {
  const limit = view.limit ?? DEFAULT_LIMIT;
  const { overall, summary, settings } = report;

  const out: string[] = [term.bold("Who reaches out first")];
  if (summary.people === 0) {
    out.push("  No one-to-one chats to check.", "");
  } else {
    const known = overall.byYou + overall.byThem;
    const you = Math.round((overall.youShare ?? 0) * 100);
    const headline =
      overall.youShare === null
        ? "No exchange has a known starter, so Snappy cannot tell who reaches out first."
        : `${term.violet(`You started ${you}%`)} of ${plural(known, "exchange")}, and they started ${100 - you}%.`;
    const leaning =
      summary.mostlyThem + summary.mostlyYou === 0
        ? "No chat leans clearly one way."
        : `They mostly reach out first in ${plural(summary.mostlyThem, "chat")}, and you in ${plural(summary.mostlyYou, "chat")}.`;
    out.push(
      `  ${headline}`,
      `  ${leaning}`,
      `  Checked ${plural(summary.people, "one-to-one chat")}, using saved chats and Snaps.`,
      `  A new exchange starts after ${plural(settings.gapHours, "hour")} of silence.`,
      "  These are hints. Messages can be missing from an export, so check in the app.",
      "",
    );

    const rule = (who: string): string => `In chats with at least ${plural(settings.minExchanges, "exchange")}, ${who} started ${formatPercent(settings.mostlyShare)} or more.`;
    out.push(
      ...section(term, "They mostly reach out first", [rule("they"), ...sideLines(term, report.mostlyThem, "them", limit)]),
      ...section(term, "You mostly reach out first", [rule("you"), ...sideLines(term, report.mostlyYou, "you", limit)]),
    );
  }

  const notes: NoteLine[] = report.notes.map((n) => ({ severity: "info", code: n.code, text: noteText(n) }));
  const noteLines = renderNotes(notes, term, { heading: "Notes", verbose });
  if (noteLines.length > 0) out.push(...noteLines, "");
  return finish(out);
}

export async function runReachOut(args: string[], io: Io): Promise<number> {
  const { values: flags, positionals } = parseInsightArgs<Flags>("reach-out", args, {
    "gap-hours": { type: "string" },
    "min-exchanges": { type: "string" },
    share: { type: "string" },
    limit: { type: "string" },
  });
  if (flags.help) {
    io.out.write(REACH_OUT_USAGE);
    return 0;
  }
  const term = insightTerm(flags, io);
  const gapHours = intOption("--gap-hours", flags["gap-hours"], 1, 72);
  const minExchanges = intOption("--min-exchanges", flags["min-exchanges"], 1, 100);
  const share = intOption("--share", flags.share, 50, 100);
  const limit = intOption("--limit", flags.limit, 1, 1000);

  const input = await loadInsightInput(positionals, io);
  const generatedAt = new Date(input.now).toISOString();

  if (input.broken) {
    if (flags.json) {
      io.out.write(jsonText({ generatedAt, issues: input.issues, stopped: "export-errors" }));
    } else {
      const notes: NoteLine[] = input.issues.map((i) => ({ severity: i.severity, code: i.code, text: i.message }));
      io.out.write(
        finish([
          ...renderNotes(notes, term, { heading: "Problems found", verbose: flags.verbose === true }),
          "",
          "Snappy did not read your chats from a broken export. Fix the problems above and run it again.",
          "",
        ]),
      );
    }
    return 2;
  }

  // Only current friends are listed. A missing friends list would leave everyone out, so it is not used as a filter.
  const friends = input.parsed.friends.friends.map((f) => f.username);
  const report = insights.reachOutFirst.findWhoReachesOutFirst(input.parsed.chats, {
    now: input.now,
    exportedAt: input.takenAt,
    ...(friends.length > 0 && { friends }),
    ...(gapHours !== undefined && { gapHours }),
    ...(minExchanges !== undefined && { minExchanges }),
    ...(share !== undefined && { mostlyShare: share / 100 }),
  });

  if (flags.json) {
    io.out.write(jsonText({ generatedAt, ...report }));
  } else {
    io.out.write(renderReachOut(report, term, flags.verbose === true, { limit }));
  }
  return 0;
}

export const reachOutCommand: InsightCommand = {
  name: "reach-out",
  synopsis: "reach-out <ZIP files...>",
  summary: "See who tends to reach out first.",
  group: "Chats",
  usage: REACH_OUT_USAGE,
  run: runReachOut,
};
