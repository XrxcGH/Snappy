/**
 * snappy-export lookalikes: a calm check for usernames that look alike, across your friends, requests and
 * blocked list. Read-only: it writes no file, never opens the ledger and changes nothing in Snapchat. The pairs
 * come from core's findLookalikeUsernames. Usernames appear only in the pair table the person asked for (and
 * never with --counts); notes, errors and codes carry counts only. A lookalike proves nothing, so the wording
 * only says a pair may be worth a second look.
 */
import { insights } from "@snappy-export/core";
import { intOption } from "../args.ts";
import { formatCount, noun, plural } from "../format.ts";
import type { InsightCommand } from "../insights-command.ts";
import { insightTerm, loadInsightInput, parseInsightArgs } from "../insights-input.ts";
import type { CommonFlags } from "../insights-input.ts";
import type { Io } from "../io.ts";
import { finish, jsonText, renderNotes, section } from "../render-insights.ts";
import type { NoteLine } from "../render-insights.ts";
import { printable } from "../term.ts";
import type { Term } from "../term.ts";

type LookalikeContext = insights.lookalikeUsernames.LookalikeContext;
type LookalikeLevel = insights.lookalikeUsernames.LookalikeLevel;
type LookalikeListId = insights.lookalikeUsernames.LookalikeListId;
type LookalikeNote = insights.lookalikeUsernames.LookalikeNote;
type LookalikePair = insights.lookalikeUsernames.LookalikePair;
type LookalikeReason = insights.lookalikeUsernames.LookalikeReason;
type LookalikeUsernames = insights.lookalikeUsernames.LookalikeUsernames;

export const LOOKALIKES_USAGE = `Usage: snappy-export lookalikes <ZIP files or folder...> [options]

Finds usernames in your export that look alike, such as two names that differ by a dot or a digit.
Lookalikes are common and prove nothing, so use it to double-check. It only reads your export and
changes nothing.

Give it every part of your export, or a folder or wildcard such as "mydata*.zip".

Options
  --limit <n>  Pairs to show in text, from 1 to 1000. Default 25.
  --counts     Show counts only, with no usernames.
  --json       Print JSON instead of text.
  --verbose    Add a short code to each note, for bug reports.
  --no-color   Plain text.

Exit codes: 0 done, 1 could not run, 2 the export has errors.
`;

type Flags = CommonFlags & { limit?: string; counts?: boolean };

export interface LookalikesRenderOptions {
  /** Pairs shown in text. */
  limit?: number;
  /** Counts only: no usernames. */
  counts?: boolean;
}

const DEFAULT_LIMIT = 25;
/** The most pairs core is asked for, so --limit can reach its own maximum and JSON holds every pair shown. */
const MAX_LIMIT = 1000;

const LEVELS: readonly LookalikeLevel[] = ["high", "medium", "low"];
const LEVEL_LABEL: Record<LookalikeLevel, string> = { high: "Very close", medium: "Close", low: "Slight" };
const LIST_LABEL: Record<LookalikeListId, string> = {
  friends: "Friend",
  pendingRequests: "Request in",
  sentRequests: "Request sent",
  blocked: "Blocked",
};
/** Written to follow a capital letter or a comma, so the table can join them. */
const REASON_LABEL: Record<LookalikeReason, string> = {
  "lookalike-swap": "similar-looking characters",
  "separator-differs": "dots or underscores differ",
  "repeated-characters": "repeated letters",
  "appended-digits": "digits added",
  "digits-differ": "digits differ",
  "one-edit": "one character apart",
};
const CONTEXT_LABEL: Record<LookalikeContext, string> = {
  "pending-resembles-friend": "a request resembles a friend",
  "resembles-blocked": "resembles someone you blocked",
};

const num = (v: number | undefined): number => (typeof v === "number" ? v : 0);
const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** The sentence for one note. Counts only, never a person. Hedged where Snappy infers. */
function noteText(n: LookalikeNote): string | null {
  const count = num(n.params.count);
  switch (n.code) {
    case "no-people":
      return "Snappy found no usernames to compare. The export may be short.";
    case "no-lookalikes":
      return "Snappy found no pairs of names that look alike.";
    case "lookalikes-found":
      return `${plural(count, "pair")} may be worth a second look.`;
    case "list-truncated":
      return `Snappy kept the closest ${formatCount(num(n.params.shown))} of ${formatCount(num(n.params.total))} pairs.`;
    case "case-duplicates":
      return `${plural(count, "extra row")} ${noun(count, "repeats", "repeat")} a person already listed. Snappy counts each person once.`;
    case "blank-entries":
      return `${plural(count, "row")} ${noun(count, "has", "have")} no username. Snappy leaves ${noun(count, "it", "them")} out.`;
    case "overlong-entries":
      return `${plural(count, "username")} ${noun(count, "is", "are")} too long to compare. Snappy leaves ${noun(count, "it", "them")} out.`;
    case "crowded-groups":
      return `${plural(num(n.params.people), "person", "people")} ${noun(num(n.params.people), "has a name", "have names")} in a long numbered family. Snappy does not compare ${noun(num(n.params.people), "it", "them")}.`;
    default:
      return "Snappy noted something it cannot describe. Run it with --verbose and share the code.";
  }
}

function noteSeverity(code: string): NoteLine["severity"] {
  return code === "blank-entries" || code === "overlong-entries" ? "warning" : "info";
}

const listsText = (p: LookalikePair): string => `${p.aLists.map((l) => LIST_LABEL[l]).join(", ")} / ${p.bLists.map((l) => LIST_LABEL[l]).join(", ")}`;
const whyText = (p: LookalikePair): string => capital([...p.reasons.map((r) => REASON_LABEL[r]), ...p.contexts.map((c) => CONTEXT_LABEL[c])].join(", "));

/** The text for a result. `opts.counts` leaves every username out. Pure: easy to test with hand-built results. */
export function renderLookalikes(result: LookalikeUsernames, term: Term, verbose: boolean, opts: LookalikesRenderOptions = {}): string {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const counts = opts.counts === true;
  const out: string[] = [term.bold("Lookalike usernames")];
  out.push(`  ${term.violet(`${plural(result.totals.people, "username")} compared.`)}`);
  out.push("  Lookalikes are common and prove nothing. Snappy only compares names in your export.", "");

  if (result.totals.pairs > 0) {
    out.push(
      ...section(
        term,
        "How alike",
        term.table(
          [{ header: "Level" }, { header: "Pairs", align: "right" }],
          LEVELS.map((level) => [LEVEL_LABEL[level], formatCount(result.totals.byLevel[level])]),
        ),
      ),
    );
  }

  if (!counts && result.pairs.length > 0) {
    const shown = result.pairs.slice(0, limit);
    const lines = term.table(
      [{ header: "Username" }, { header: "Looks like" }, { header: "How alike" }, { header: "Lists" }, { header: "Why", flex: true, wrap: true }],
      shown.map((p) => [printable(p.a), printable(p.b), LEVEL_LABEL[p.level], listsText(p), whyText(p)]),
    );
    const rest = result.totals.pairs - shown.length;
    if (rest > 0) lines.push(`And ${formatCount(rest)} more. Use --limit to see more.`);
    out.push(...section(term, "Worth a second look", lines));
  }

  const notes: NoteLine[] = result.notes.flatMap((n) => {
    const text = noteText(n);
    return text === null ? [] : [{ severity: noteSeverity(n.code), code: n.code, text }];
  });
  const noteLines = renderNotes(notes, term, { heading: "Notes", verbose });
  if (noteLines.length > 0) out.push(...noteLines, "");

  return finish(out);
}

/** The JSON for a result. With --counts the rows that name people are left out. */
function jsonResult(result: LookalikeUsernames, counts: boolean): LookalikeUsernames {
  return counts ? { ...result, pairs: [] } : result;
}

export async function runLookalikes(args: string[], io: Io): Promise<number> {
  const { values: flags, positionals } = parseInsightArgs<Flags>("lookalikes", args, {
    limit: { type: "string" },
    counts: { type: "boolean" },
  });
  if (flags.help) {
    io.out.write(LOOKALIKES_USAGE);
    return 0;
  }
  const limit = intOption("--limit", flags.limit, 1, MAX_LIMIT) ?? DEFAULT_LIMIT;
  const counts = flags.counts === true;
  const term = insightTerm(flags, io);

  const input = await loadInsightInput(positionals, io);
  const generatedAt = new Date(input.now).toISOString();

  // A broken export may hide part of a list, so Snappy stops instead of comparing what is left.
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

  const result = insights.lookalikeUsernames.findLookalikeUsernames(input.parsed.friends, { now: input.now, maxPairs: MAX_LIMIT });
  if (flags.json) {
    const { generatedAt: _core, ...rest } = jsonResult(result, counts);
    io.out.write(jsonText({ generatedAt, ...rest }));
  } else {
    io.out.write(renderLookalikes(result, term, flags.verbose === true, { limit, counts }));
  }
  return 0;
}

export const lookalikesCommand: InsightCommand = {
  name: "lookalikes",
  synopsis: "lookalikes <ZIP files...>",
  summary: "Find usernames that look alike.",
  group: "Friends",
  usage: LOOKALIKES_USAGE,
  run: runLookalikes,
};
