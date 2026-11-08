/**
 * snappy-export friend-count: how the friend count grew and shrank, month by month. The curve comes
 * from the dates in the export; with a sealed ledger it is also set against the saved snapshots.
 * Read-only: it writes no file and never changes the ledger. Counts, months and dates only, never a
 * username from the export. Login history is not read.
 */
import { insights } from "@snappy-export/core";
import { intOption } from "../args.ts";
import { formatCount, formatDate, hasHave, isAre, noun, plural } from "../format.ts";
import type { InsightCommand } from "../insights-command.ts";
import { insightTerm, LEDGER_OPTIONS, loadInsightInput, parseInsightArgs } from "../insights-input.ts";
import { historyPathFlag } from "../ledger-store.ts";
import type { CommonFlags, LedgerFlags } from "../insights-input.ts";
import type { Io } from "../io.ts";
import { finish, jsonText, renderNotes, section } from "../render-insights.ts";
import type { NoteLine } from "../render-insights.ts";
import type { Term } from "../term.ts";

export const FRIEND_COUNT_USAGE = `Usage: snappy-export friend-count <ZIP files or folder...> [options]

Shows how your friend count grew and shrank, month by month, from the dates in your export. If you
have a saved history, it also compares the two. Your saved history is read, never changed.

Options
  --months <n>              Months to print. Default: 24. Use 0 for all.
  --no-save                 Skip your saved history. Nothing is read, no passphrase asked.
  --history <path>          Saved history file. Default: ~/.snappy/ledger.sealed
  --passphrase-file <path>  Use the first line of this file as the passphrase.
  --json                    Print JSON instead of text.
  --verbose                 Add a short code to each note, for bug reports.
  --no-color                Plain text.

Exit codes: 0 done, 1 could not run, 2 the export has errors.
`;

type Flags = CommonFlags & LedgerFlags & { months?: string; "no-save"?: boolean };
type History = insights.friendCountHistory.FriendCountHistory;
type Note = insights.friendCountHistory.FriendCountNote;

/** What the ledger did in this run. "read" means snapshots were compared, "none" that no ledger exists yet. */
export type LedgerState = "read" | "none" | "skipped";

/** The core result plus two facts the wording needs. */
export interface FriendCountReport extends History {
  ledger: LedgerState;
  exportHasErrors: boolean;
}

/** Months printed when --months is not given. */
export const DEFAULT_MONTHS = 24;
/** The most snapshot comparisons printed. */
const MAX_COMPARISONS = 12;

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "2026-03" as "Mar 2026". */
export function monthText(label: string): string {
  const [year, month] = label.split("-");
  const name = MONTH_NAMES[Number(month) - 1];
  return name === undefined ? label : `${name} ${Number(year)}`;
}

const signed = (n: number): string => (n > 0 ? `+${formatCount(n)}` : n < 0 ? `-${formatCount(-n)}` : "0");
const num = (n: Note, key: string): number => n.params[key] ?? 0;

/** The sentence for one note. Hedged: Snappy infers the curve from the dates in the files. */
function noteText(n: Note, ledger: LedgerState): string {
  const count = num(n, "count");
  switch (n.code) {
    case "no-dated-friendships":
      return "No friendship in your export has a usable date, so Snappy cannot draw a curve.";
    case "curve-may-run-high":
      return "People who removed you are not on the curve, so earlier months may run high.";
    case "undated-joins":
      return `${plural(count, "friend")} ${hasHave(count)} no start date. Snappy counts ${noun(count, "that friend", "them")} from the first month.`;
    case "undated-leaves":
      return `${plural(count, "removed friend")} ${hasHave(count)} no removal date, so Snappy leaves ${noun(count, "that friend", "them")} out.`;
    case "unusable-dates-ignored":
      return `${plural(count, "date")} ${isAre(count)} in the future or too old to be real. Snappy ignores ${noun(count, "it", "them")}.`;
    case "leave-before-join":
      return `${plural(count, "removed friend")} ${hasHave(count)} a removal date before the start date. Snappy ignores ${noun(count, "that removal", "those removals")}.`;
    case "re-added-friends":
      return `${plural(count, "friend")} ${isAre(count)} in both lists, so you may have added ${noun(count, "that friend", "them")} back.`;
    case "snapshots-ignored":
      return `${plural(count, "saved snapshot")} had a missing or odd date. Snappy ignored ${noun(count, "it", "them")}.`;
    case "no-snapshots":
      return ledger === "skipped" ? "Your saved history was skipped, as you asked." : "No saved history was compared. Run analyze to start one.";
    case "single-snapshot":
      return "Only one snapshot was saved, so the comparison is a single point.";
    case "sources-agree":
      return `The curve and your saved history agree at ${plural(num(n, "compared"), "point")}.`;
    case "sources-disagree":
      return `The curve and your saved history differ at ${formatCount(num(n, "disagreeing"))} of ${plural(num(n, "compared"), "point")}. The largest gap is ${plural(num(n, "largestGap"), "friend")}.`;
    default:
      return "Snappy noted something it cannot describe. Run it with --verbose and share the code.";
  }
}

const NOTE_SEVERITY: Partial<Record<string, "info" | "warning">> = {
  "no-dated-friendships": "warning",
  "undated-leaves": "warning",
  "unusable-dates-ignored": "warning",
  "leave-before-join": "warning",
  "snapshots-ignored": "warning",
  "sources-disagree": "warning",
};

export function renderFriendCount(report: FriendCountReport, term: Term, verbose: boolean, opts: { months?: number } = {}): string {
  const limit = opts.months ?? DEFAULT_MONTHS;
  const out: string[] = [term.bold("Friend count over time"), ""];
  const { months, totals } = report;

  if (months.length > 0 && totals.currentCount !== null) {
    const first = months[0]!;
    const last = months.at(-1)!;
    const lines = [
      `Your friends list holds ${term.violet(plural(totals.currentCount, "friend"))}.`,
      `${plural(totals.joined, "friend")} added and ${formatCount(totals.left)} removed by you.`,
      `The dates run from ${monthText(first.month)} to ${monthText(last.month)}.`,
    ];
    if (report.best !== null) lines.push(`Biggest gain: ${monthText(report.best.month)}, up ${plural(report.best.net, "friend")}.`);
    if (report.worst !== null) lines.push(`Biggest drop: ${monthText(report.worst.month)}, down ${plural(-report.worst.net, "friend")}.`);
    out.push(...section(term, "Summary", lines));

    const shown = limit === 0 ? months : months.slice(-limit);
    const withSaved = shown.some((m) => m.snapshotCount !== null);
    const columns = [
      { header: "Month" },
      { header: "Added", align: "right" as const },
      { header: "Removed", align: "right" as const },
      { header: "Net", align: "right" as const },
      { header: "Friends", align: "right" as const },
      ...(withSaved ? [{ header: "Saved", align: "right" as const }] : []),
    ];
    const rows = shown.map((m) => [
      m.partial ? `${monthText(m.month)} (so far)` : monthText(m.month),
      formatCount(m.joined),
      formatCount(m.left),
      signed(m.net),
      m.count === null ? "-" : formatCount(m.count),
      ...(withSaved ? [m.snapshotCount === null ? "-" : formatCount(m.snapshotCount)] : []),
    ]);
    const lines2 = [...term.table(columns, rows)];
    if (shown.length < months.length) {
      lines2.push("", `Showing the latest ${plural(shown.length, "month")} of ${formatCount(months.length)}. Use --months 0 for all.`);
    }
    out.push(...section(term, "Month by month", lines2));
  }

  if (report.comparisons.length > 0) {
    const shown = report.comparisons.slice(-MAX_COMPARISONS);
    const lines = term.table(
      [{ header: "Saved on" }, { header: "Saved", align: "right" }, { header: "Curve", align: "right" }, { header: "Gap", align: "right" }, { header: "Result" }],
      shown.map((c) => [formatDate(c.takenAt), formatCount(c.snapshotCount), formatCount(c.curveCount), signed(c.gap), c.disagrees ? "Differs" : "Close"]),
    );
    if (shown.length < report.comparisons.length) {
      lines.push("", `Showing the latest ${formatCount(shown.length)} of ${formatCount(report.comparisons.length)}.`);
    }
    out.push(...section(term, "Against your saved history", lines));
  }

  const notes: NoteLine[] = [];
  if (report.exportHasErrors) {
    notes.push({ severity: "warning", code: "export-has-errors", text: "Your export has errors, so the curve may be off. Run check for details." });
  }
  for (const n of report.notes) notes.push({ severity: NOTE_SEVERITY[n.code] ?? "info", code: n.code, text: noteText(n, report.ledger) });
  const noteLines = renderNotes(notes, term, { heading: "Notes", verbose });
  if (noteLines.length > 0) out.push(...noteLines, "");
  return finish(out);
}

export async function runFriendCount(args: string[], io: Io): Promise<number> {
  const { values: flags, positionals } = parseInsightArgs<Flags>("friend-count", args, {
    ...LEDGER_OPTIONS,
    months: { type: "string" },
    "no-save": { type: "boolean" },
  });
  if (flags.help) {
    io.out.write(FRIEND_COUNT_USAGE);
    return 0;
  }
  const term = insightTerm(flags, io);
  const months = intOption("--months", flags.months, 0, 100_000);
  const noSave = flags["no-save"] === true;

  // The ledger is opened read-only and only after the export is read; --no-save leaves it alone.
  const input = await loadInsightInput(positionals, io, noSave ? {} : { ledger: { path: historyPathFlag(flags), passphraseFile: flags["passphrase-file"] } });
  const history = insights.friendCountHistory.buildFriendCountHistory({
    friends: input.parsed.friends.friends,
    deletedFriends: input.parsed.friends.deletedFriends,
    ...(input.ledger !== undefined && { ledger: input.ledger }),
    now: input.now,
  });
  const report: FriendCountReport = {
    ...history,
    ledger: noSave ? "skipped" : input.ledger === undefined ? "none" : "read",
    exportHasErrors: input.broken,
  };

  if (flags.json) {
    io.out.write(jsonText({ generatedAt: new Date(input.now).toISOString(), ...report }));
  } else {
    io.out.write(renderFriendCount(report, term, flags.verbose === true, { months }));
  }
  return input.broken ? 2 : 0;
}

export const friendCountCommand: InsightCommand = {
  name: "friend-count",
  synopsis: "friend-count <ZIP files...>",
  summary: "Chart your friend count over time.",
  group: "Friends",
  usage: FRIEND_COUNT_USAGE,
  run: runFriendCount,
};
