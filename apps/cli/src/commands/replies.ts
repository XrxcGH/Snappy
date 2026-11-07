/**
 * snappy-export replies: who may be waiting on a reply, and which chats lean one way. Read-only: it
 * writes no file and never opens the ledger. The lists come from core's waitingOnReply, which reads
 * only who wrote last and when. Usernames appear in the result tables the person asked for, and
 * nowhere else: notes and errors carry counts only.
 */
import { insights } from "@snappy-export/core";
import { intOption } from "../args.ts";
import { formatCount, formatDate, formatPercent, hasHave, isAre, noun, plural, wasWere } from "../format.ts";
import type { InsightCommand } from "../insights-command.ts";
import { insightTerm, loadInsightInput, parseInsightArgs } from "../insights-input.ts";
import type { CommonFlags } from "../insights-input.ts";
import type { Io } from "../io.ts";
import { finish, jsonText, renderNotes, section } from "../render-insights.ts";
import type { NoteLine } from "../render-insights.ts";
import type { Term } from "../term.ts";

export const REPLIES_USAGE = `Usage: snappy-export replies <ZIP files or folder...> [options]

Lists friends who may be waiting on a reply from you, friends you may be waiting on, and chats
where one side writes most. It reads who wrote last and when, never message text, photos or videos.

Options
  --you-days <n>   Days of silence before a friend may be waiting on you. Default 3.
  --them-days <n>  Days of silence before you may be waiting on them. Default 7.
  --limit <n>      Rows to show in each list. Default 15.
  --json           Print JSON instead of text.
  --verbose        Add a short code to each note, for bug reports.
  --no-color       Plain text.

Exit codes: 0 done, 1 could not run, 2 the export has errors and was not read.
`;

type Flags = CommonFlags & { "you-days"?: string; "them-days"?: string; limit?: string };
type Report = insights.waitingOnReply.WaitingReport;

const DEFAULTS = insights.waitingOnReply.WAITING_DEFAULTS;
const DEFAULT_LIMIT = 15;

export interface RepliesView {
  /** Rows shown in each list. */
  limit?: number;
  youDays?: number;
  themDays?: number;
}

const count = (n: insights.waitingOnReply.WaitingNote): number => n.params.count ?? 0;

/** The sentence for one note. Counts only: a note never names a person. */
function noteText(n: insights.waitingOnReply.WaitingNote): string {
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
    case "people-last-direction-unknown":
      return `${plural(c, "chat")} could not be checked, since the export does not say who wrote last.`;
    case "people-last-event-tied":
      return `${plural(c, "chat")} ${hasHave(c)} a sent and a received message at the same moment. Snappy cannot tell which came last.`;
    case "people-wait-too-old":
      return `${plural(c, "chat")} ${hasHave(c)} been quiet for over ${plural(DEFAULTS.maxWaitDays, "day")}. Snappy does not list ${noun(c, "it", "them")}.`;
    case "people-one-sided-direction-unreliable":
      return `${plural(c, "chat")} had too many messages with no known direction to judge whether one side writes most.`;
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

export function renderReplies(report: Report, term: Term, verbose: boolean, view: RepliesView = {}): string {
  const limit = view.limit ?? DEFAULT_LIMIT;
  const youDays = view.youDays ?? DEFAULTS.waitingOnYouDays;
  const themDays = view.themDays ?? DEFAULTS.waitingOnThemDays;
  const s = report.summary;

  const out: string[] = [term.bold("Replies")];
  if (s.people === 0) {
    out.push("  No one-to-one chats to check.", "");
  } else {
    const headline =
      s.waitingOnYou === 0
        ? "No one looks to be waiting on a reply from you."
        : `${term.violet(plural(s.waitingOnYou, "person", "people"))} may be waiting on a reply from you.`;
    out.push(
      `  ${headline}`,
      `  ${s.waitingOnThem === 0 ? "You may not be waiting on anyone." : `You may be waiting on ${plural(s.waitingOnThem, "person", "people")}.`} ${
        s.oneSided === 0 ? "No chats look one-sided." : `${plural(s.oneSided, "chat")} ${isAre(s.oneSided)} mostly one-sided.`
      }`,
      `  Checked ${plural(s.people, "one-to-one chat")}, using saved chats and Snaps.`,
      "  These are hints. Messages can be missing from an export, so check in the app.",
      "",
    );

    const waitCols = [{ header: "Friend" }, { header: "Last message" }, { header: "Waiting", align: "right" as const }];
    const waitRows = (list: insights.waitingOnReply.WaitingPerson[]): string[][] =>
      list.map((p) => [p.username, formatDate(p.since), plural(p.days, "day")]);

    out.push(
      ...section(term, "Waiting on you", [
        `They wrote last, and Snappy saw no reply for ${plural(youDays, "day")} or more.`,
        ...(report.waitingOnYou.length === 0 ? ["None found."] : listLines(term, waitCols, waitRows(report.waitingOnYou), limit)),
      ]),
      ...section(term, "Waiting on them", [
        `You wrote last, and Snappy saw no reply for ${plural(themDays, "day")} or more.`,
        ...(report.waitingOnThem.length === 0 ? ["None found."] : listLines(term, waitCols, waitRows(report.waitingOnThem), limit)),
      ]),
      ...section(term, "One-sided chats", [
        `In the last ${plural(DEFAULTS.windowDays, "day")}, one side sent at least ${formatPercent(DEFAULTS.dominantShare)} of the messages.`,
        ...(report.oneSided.length === 0
          ? ["None found."]
          : listLines(
              term,
              [
                { header: "Friend" },
                { header: "Sends most" },
                { header: "You sent", align: "right" },
                { header: "They sent", align: "right" },
                { header: "Share", align: "right" },
              ],
              report.oneSided.map((p) => [
                p.username,
                p.dominant === "you" ? "You" : "They do",
                formatCount(p.sent),
                formatCount(p.received),
                formatPercent(p.share),
              ]),
              limit,
            )),
      ]),
    );
  }

  const notes: NoteLine[] = report.notes.map((n) => ({ severity: "info", code: n.code, text: noteText(n) }));
  const noteLines = renderNotes(notes, term, { heading: "Notes", verbose });
  if (noteLines.length > 0) out.push(...noteLines, "");
  return finish(out);
}

export async function runReplies(args: string[], io: Io): Promise<number> {
  const { values: flags, positionals } = parseInsightArgs<Flags>("replies", args, {
    "you-days": { type: "string" },
    "them-days": { type: "string" },
    limit: { type: "string" },
  });
  if (flags.help) {
    io.out.write(REPLIES_USAGE);
    return 0;
  }
  const term = insightTerm(flags, io);
  const youDays = intOption("--you-days", flags["you-days"], 0, DEFAULTS.maxWaitDays);
  const themDays = intOption("--them-days", flags["them-days"], 0, DEFAULTS.maxWaitDays);
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
  const report = insights.waitingOnReply.findWaitingOnReply(input.parsed.chats, {
    now: input.now,
    exportedAt: input.takenAt,
    ...(friends.length > 0 && { friends }),
    ...(youDays !== undefined && { waitingOnYouDays: youDays }),
    ...(themDays !== undefined && { waitingOnThemDays: themDays }),
  });

  if (flags.json) {
    io.out.write(jsonText({ generatedAt, ...report }));
  } else {
    io.out.write(renderReplies(report, term, flags.verbose === true, { limit, youDays, themDays }));
  }
  return 0;
}

export const repliesCommand: InsightCommand = {
  name: "replies",
  synopsis: "replies <ZIP files...>",
  summary: "See who may be waiting on a reply.",
  group: "Chats",
  usage: REPLIES_USAGE,
  run: runReplies,
};
