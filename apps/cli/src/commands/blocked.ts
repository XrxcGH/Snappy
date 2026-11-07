/**
 * snappy-export blocked: a calm look at the people you blocked, ignored or hid from suggestions.
 * Read-only: it writes no file, never opens the ledger and changes nothing in Snapchat. The review
 * comes from core's reviewBlocked. Usernames appear only in the result tables the person asked for
 * (and never with --counts); notes, errors and codes carry counts only.
 */
import { insights } from "@snappy-export/core";
import { intOption } from "../args.ts";
import { formatCount, formatDate, noun, plural } from "../format.ts";
import type { InsightCommand } from "../insights-command.ts";
import { insightTerm, loadInsightInput, parseInsightArgs } from "../insights-input.ts";
import type { CommonFlags } from "../insights-input.ts";
import type { Io } from "../io.ts";
import { finish, jsonText, renderNotes, section } from "../render-insights.ts";
import type { NoteLine } from "../render-insights.ts";
import { printable } from "../term.ts";
import type { Term } from "../term.ts";

export const BLOCKED_USAGE = `Usage: snappy-export blocked <ZIP files or folder...> [options]

Lists the people you blocked, ignored or hid from suggestions, oldest first. It also points out
people who show up in more than one place. It only reads your export and changes nothing.

Give it every part of your export, or a folder or wildcard such as "mydata*.zip".

Options
  --limit <n>  Rows to show per list in text, from 1 to 1000. Default 25.
  --counts     Show counts only, with no usernames.
  --json       Print JSON instead of text.
  --verbose    Add a short code to each note, for bug reports.
  --no-color   Plain text.

Exit codes: 0 done, 1 could not run, 2 the export has errors.
`;

type Flags = CommonFlags & { limit?: string; counts?: boolean };
type Review = insights.blockedReview.BlockedReview;
type ListId = insights.blockedReview.ReviewListId;
type Kind = insights.blockedReview.ConflictKind;

export interface BlockedRenderOptions {
  /** Rows shown per list in text. */
  limit?: number;
  /** Counts only: no usernames. */
  counts?: boolean;
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 1000;

const LIST_LABEL: Record<ListId, string> = {
  blocked: "Blocked",
  ignored: "Ignored",
  hiddenSuggestions: "Hidden suggestions",
};
/** Names for use inside a sentence. */
const LIST_NAME: Record<ListId, string> = {
  blocked: "blocked",
  ignored: "ignored",
  hiddenSuggestions: "hidden suggestions",
};
const KIND_LABEL: Record<Kind, string> = {
  "multiple-lists": "More than one list",
  "also-friend": "Also a friend",
  "also-pending": "Request pending",
  "also-sent": "Request sent",
};

const num = (v: number | string | undefined): number => (typeof v === "number" ? v : 0);
const listName = (v: number | string | undefined): string => LIST_NAME[v as ListId] ?? "list";
const dateCell = (ms: number | null | undefined): string => (ms === undefined || ms === null ? "-" : formatDate(ms));

/** The sentence for one note. Counts and list names only, never a person. Hedged where Snappy infers. */
function noteText(n: insights.blockedReview.ReviewNote): string {
  const count = num(n.params.count);
  const where = listName(n.params.list);
  switch (n.code) {
    case "no-entries":
      return "Snappy found no blocked, ignored or hidden people in this export.";
    case "undated-entries":
      return `${plural(count, "person", "people")} in your ${where} list ${noun(count, "has", "have")} no date.`;
    case "future-dated-entries":
      return `${plural(count, "person", "people")} in your ${where} list ${noun(count, "has", "have")} a date in the future. Snappy leaves ${noun(count, "it", "them")} out.`;
    case "case-duplicates":
      return `${plural(count, "extra row")} in your ${where} list ${noun(count, "repeats", "repeat")} a person already listed. Snappy counts each person once.`;
    case "blank-entries":
      return `${plural(count, "row")} in your ${where} list ${noun(count, "has", "have")} no username. Snappy leaves ${noun(count, "it", "them")} out.`;
    case "conflicts-found":
      return `${plural(count, "person", "people")} may be worth a second look.`;
    case "friends-list-empty":
      return "Your friends list is empty, so Snappy cannot tell who is also a friend. The export may be short.";
    default:
      return "Snappy noted something it cannot describe. Run it with --verbose and share the code.";
  }
}

function noteSeverity(code: string): NoteLine["severity"] {
  return code === "future-dated-entries" || code === "blank-entries" ? "warning" : "info";
}

/** The sentence for one review step. */
function stepText(s: insights.blockedReview.ReviewStep): string {
  const people = plural(s.count, "person", "people");
  switch (s.code) {
    case "review-conflicts":
      return `Look at the ${people} who ${noun(s.count, "shows", "show")} up in more than one place.`;
    case "review-blocked":
      return `Look over your blocked list (${people}).`;
    case "review-ignored":
      return `Look over your ignored list (${people}).`;
    case "review-hidden-suggestions":
      return `Look over your hidden suggestions (${people}).`;
    default:
      return "Run Snappy with --verbose and share the code.";
  }
}

/** The text for a review. `opts.counts` leaves every username out. Pure: easy to test with hand-built results. */
export function renderBlocked(review: Review, term: Term, verbose: boolean, opts: BlockedRenderOptions = {}): string {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const counts = opts.counts === true;
  const out: string[] = [term.bold("Blocked and ignored review")];
  out.push(`  ${term.violet(`${plural(review.totals.people, "person", "people")} in your lists.`)}`);
  out.push("  Snappy only lists them. It changes nothing in Snapchat.", "");

  out.push(
    ...section(
      term,
      "Your lists",
      term.table(
        [{ header: "List" }, { header: "People", align: "right" }, { header: "Oldest" }, { header: "Newest" }],
        review.lists.map((l) => [LIST_LABEL[l.id], formatCount(l.count), dateCell(l.oldestAt), dateCell(l.newestAt)]),
      ),
    ),
  );

  if (review.reviewOrder.length > 0) {
    out.push(...section(term, "What to look at first", review.reviewOrder.map((s, i) => `${i + 1}. ${stepText(s)}`)));
  }

  if (!counts && review.conflicts.length > 0) {
    const shown = review.conflicts.slice(0, limit);
    const lines = term.table(
      [{ header: "Username" }, { header: "Lists" }, { header: "Why" }],
      shown.map((c) => [printable(c.username), c.lists.map((l) => LIST_LABEL[l]).join(", "), c.kinds.map((k) => KIND_LABEL[k]).join(", ")]),
    );
    const rest = review.conflicts.length - shown.length;
    if (rest > 0) lines.push(`And ${formatCount(rest)} more. Use --limit to see more.`);
    out.push(...section(term, "Worth a second look", lines));
  }

  if (!counts) {
    for (const l of review.lists) {
      if (l.entries.length === 0) continue;
      const shown = l.entries.slice(0, limit);
      const lines = term.table(
        [{ header: "Username" }, { header: "Date" }],
        shown.map((e) => [printable(e.username), dateCell(e.at)]),
      );
      const rest = l.entries.length - shown.length;
      if (rest > 0) lines.push(`And ${formatCount(rest)} more. Use --limit to see more.`);
      out.push(...section(term, `${LIST_LABEL[l.id]}, oldest first`, lines));
    }
  }

  const notes: NoteLine[] = review.notes
    .filter((n) => n.code !== "list-empty")
    .map((n) => ({ severity: noteSeverity(n.code), code: n.code, text: noteText(n) }));
  const noteLines = renderNotes(notes, term, { heading: "Notes", verbose });
  if (noteLines.length > 0) out.push(...noteLines, "");

  return finish(out);
}

/** The JSON for a review. With --counts the rows that name people are left out. */
function jsonReview(review: Review, counts: boolean): Review {
  if (!counts) return review;
  return { ...review, lists: review.lists.map((l) => ({ ...l, entries: [] })), conflicts: [] };
}

export async function runBlocked(args: string[], io: Io): Promise<number> {
  const { values: flags, positionals } = parseInsightArgs<Flags>("blocked", args, {
    limit: { type: "string" },
    counts: { type: "boolean" },
  });
  if (flags.help) {
    io.out.write(BLOCKED_USAGE);
    return 0;
  }
  const limit = intOption("--limit", flags.limit, 1, MAX_LIMIT) ?? DEFAULT_LIMIT;
  const counts = flags.counts === true;
  const term = insightTerm(flags, io);

  const input = await loadInsightInput(positionals, io);
  const generatedAt = new Date(input.now).toISOString();

  // A broken export may hide part of a list, so Snappy stops instead of reviewing it.
  if (input.broken) {
    if (flags.json) {
      const issues = input.issues.map((i) => ({ severity: i.severity, code: i.code }));
      io.out.write(jsonText({ generatedAt, issues, stopped: "export-errors" }));
    } else {
      const notes: NoteLine[] = input.issues.map((i) => ({ severity: i.severity, code: i.code, text: i.message }));
      io.out.write(
        finish([
          ...renderNotes(notes, term, { heading: "Notes", verbose: flags.verbose === true }),
          "",
          "Snappy stopped, since a broken export could give wrong results.",
          "Run the check command to see what to fix.",
        ]),
      );
    }
    return 2;
  }

  const review = insights.blockedReview.reviewBlocked(input.parsed.friends, { now: input.now });
  if (flags.json) {
    const { generatedAt: _core, ...rest } = jsonReview(review, counts);
    io.out.write(jsonText({ generatedAt, ...rest }));
  } else {
    io.out.write(renderBlocked(review, term, flags.verbose === true, { limit, counts }));
  }
  return 0;
}

export const blockedCommand: InsightCommand = {
  name: "blocked",
  synopsis: "blocked <ZIP files...>",
  summary: "Review blocked and ignored people.",
  group: "Friends",
  usage: BLOCKED_USAGE,
  run: runBlocked,
};
