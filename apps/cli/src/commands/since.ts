/**
 * snappy-export since: what changed between your last saved export and this one. The comparison comes from
 * core's sinceLastExport: friends added or no longer listed, how requests went, new Memories and the change in
 * chats and Snaps. The earlier export is read from the sealed ledger (read-only, never changed) or, with
 * --earlier, from another export. Usernames appear only in the result tables (and the CSV the person asked
 * for with --out); notes, errors and verbose codes never name anyone. Login history is not read.
 */
import { insights, snapshotFromExport } from "@snappy-export/core";
import type { Snapshot } from "@snappy-export/core";
import { CliError } from "../errors.ts";
import { intOption } from "../args.ts";
import { formatCount, formatDate, hasHave, isAre, noun, plural } from "../format.ts";
import type { InsightCommand } from "../insights-command.ts";
import { checkOutputPath, saveInsightFile } from "../insights-output.ts";
import { insightTerm, LEDGER_OPTIONS, loadInsightInput, parseInsightArgs, parseUtcOffsetHours } from "../insights-input.ts";
import { historyPathFlag } from "../ledger-store.ts";
import type { CommonFlags, InsightInput, LedgerFlags } from "../insights-input.ts";
import type { Io } from "../io.ts";
import { csvCell } from "../render-analysis.ts";
import { finish, jsonText, renderNotes, section } from "../render-insights.ts";
import type { NoteLine } from "../render-insights.ts";
import { printable } from "../term.ts";
import type { Term } from "../term.ts";

export const SINCE_USAGE = `Usage: snappy-export since <ZIP files or folder...> [options]

Shows what changed since your last export: friends added, friends who may have left, and how your
requests went. It also counts new Memories, chats and Snaps when your export has them.

Your last export comes from your saved history or from --earlier. Both are only read,
never changed.

Give it every part of your export, or a folder or wildcard such as "mydata*.zip".

Options
  --earlier <path>          Compare with this earlier export instead of your saved history.
  --utc-offset <hours>      Hours from UTC for counting days, such as 2 or 5:30.
  --limit <n>               Rows to show per list in text, from 1 to 1000. Default 25.
  --counts                  Show counts only, with no usernames.
  --out <file.csv>          Also save the friend and request changes as a CSV file.
  --force                   Replace the file named by --out if it exists.
  --no-save                 Skip your saved history. Nothing is read, no passphrase asked.
  --history <path>          Saved history file. Default: ~/.snappy/ledger.sealed
  --passphrase-file <path>  Use the first line of this file as the passphrase.
  --json                    Print JSON instead of text.
  --verbose                 Add a short code to each note, for bug reports.
  --no-color                Plain text.

Write a negative offset as --utc-offset=-5. Days are counted in UTC unless you set it.

Exit codes: 0 done, 1 could not run, 2 an export has errors.
`;

type Flags = CommonFlags &
  LedgerFlags & {
    earlier?: string;
    "utc-offset"?: string;
    limit?: string;
    counts?: boolean;
    out?: string;
    force?: boolean;
    "no-save"?: boolean;
  };

type Result = insights.sinceLastExport.SinceLastExport;
type Note = insights.sinceLastExport.SinceNote;
type Person = insights.sinceLastExport.SincePerson;

/**
 * Where the earlier export came from: the sealed ledger, a file given with --earlier, nowhere because no ledger has
 * been saved yet ("none"), or nowhere because the person skipped it with --no-save.
 */
export type PreviousSource = "ledger" | "file" | "none" | "skipped";

export interface SinceReport extends Result {
  source: PreviousSource;
  /** The export has no date of its own, so Snappy used its file date or the clock. */
  dateGuessed: boolean;
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 1000;

// ------------------------------------------------------------------ choosing the earlier export ---

/**
 * The saved export to compare with: the newest one saved at or before this one. If every other saved export is
 * newer, the nearest one is used and core notes that the order was swapped, as analyze does when an export is older
 * than the ledger. The snapshot of this very export (same id) never counts as an earlier one. No export lies between
 * the two, so core needs no `between` snapshots to explain who left.
 */
export function choosePrevious(snapshots: readonly Snapshot[], current: Snapshot): Snapshot | undefined {
  let previous: Snapshot | undefined;
  let nearestNewer: Snapshot | undefined;
  for (const s of snapshots) {
    if (s.id === current.id || !Number.isFinite(s.takenAt)) continue;
    if (s.takenAt <= current.takenAt) {
      if (previous === undefined || s.takenAt >= previous.takenAt) previous = s;
    } else if (nearestNewer === undefined || s.takenAt < nearestNewer.takenAt) {
      nearestNewer = s;
    }
  }
  return previous ?? nearestNewer;
}

// ------------------------------------------------------------------------------- people rows ---

export type ChangeKind = "added" | "no-longer-listed" | "removed-by-you" | "blocked-by-you" | "request-accepted" | "request-pending" | "request-no-longer-listed";

export interface PersonRow {
  change: ChangeKind;
  username: string;
  /** The date that goes with the change, or null when the export does not say. */
  at: number | null;
}

interface Group {
  change: ChangeKind;
  heading: string;
  /** What the date column of this group means. */
  dateHeader: string;
}

/** The lists in the order they are shown and saved. */
const GROUPS: readonly Group[] = [
  { change: "added", heading: "New friends", dateHeader: "Friends since" },
  { change: "no-longer-listed", heading: "No longer listed", dateHeader: "Friends since" },
  { change: "removed-by-you", heading: "Removed by you", dateHeader: "Removed on" },
  { change: "blocked-by-you", heading: "Blocked by you", dateHeader: "Friends since" },
  { change: "request-accepted", heading: "Requests accepted", dateHeader: "Sent on" },
  { change: "request-pending", heading: "Requests still waiting", dateHeader: "Sent on" },
  { change: "request-no-longer-listed", heading: "Requests no longer listed", dateHeader: "Sent on" },
];

/** The people of each list, by change. Empty lists when nothing was compared. */
export function peopleByChange(r: Result): Record<ChangeKind, Person[]> {
  return {
    added: r.friends?.added ?? [],
    "no-longer-listed": r.friends?.disappeared ?? [],
    "removed-by-you": r.friends?.removedByYou ?? [],
    "blocked-by-you": r.friends?.blockedByYou ?? [],
    "request-accepted": r.requests?.accepted ?? [],
    "request-pending": r.requests?.stillPending ?? [],
    "request-no-longer-listed": r.requests?.vanished ?? [],
  };
}

/** Every person in every list, in the order shown. The CSV and the tables read this one list. */
export function personRows(r: Result): PersonRow[] {
  const by = peopleByChange(r);
  return GROUPS.flatMap((g) => by[g.change].map((p) => ({ change: g.change, username: p.username, at: p.at })));
}

const dateCell = (ms: number | null): string => (ms === null ? "-" : formatDate(ms));

/** The CSV: username, change, date as YYYY-MM-DD in UTC. Cells that could run as a formula are neutralized by csvCell. */
export function sinceToCsv(r: Result): string {
  const rows = personRows(r).map((p) => [printable(p.username), p.change, p.at === null ? "" : new Date(p.at).toISOString().slice(0, 10)]);
  return [["username", "change", "date"], ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

// -------------------------------------------------------------------------------------- notes ---

const num = (n: Note, key: string): number => n.params[key] ?? 0;

/** The sentence for one note. Counts only, never a person. Hedged: Snappy infers from two lists. */
function noteText(n: Note, source: PreviousSource): string {
  const count = num(n, "count");
  switch (n.code) {
    case "no-previous-export":
      if (source === "skipped") return "Your saved history was skipped, as you asked, so there is nothing to compare.";
      if (source === "none") return "No earlier export is saved yet. Run analyze on each export, or use --earlier.";
      return "Your saved history holds no earlier export, so there is nothing to compare.";
    case "unusable-snapshot-time":
      return "One of the two exports has no usable date, so Snappy cannot compare them.";
    case "order-swapped":
      return "The saved export is newer than this one, so Snappy compared them the other way round. Chats, Snaps and Memories are not shown.";
    case "same-time":
      return "Both exports have the same time, so there is no period to measure.";
    case "same-day":
      return "Both exports are from the same day, so few changes are likely.";
    case "long-gap":
      return `The exports are ${plural(num(n, "days"), "day")} apart. Anyone no longer listed may have left at any point in that time.`;
    case "snapshot-time-in-future":
      return `${plural(count, "export")} ${hasHave(count)} a date in the future. A device clock may have been wrong.`;
    case "friends-may-have-left":
      return `${plural(count, "friend")} ${isAre(count)} no longer listed. ${noun(count, "That friend", "They")} may have removed you or closed their account.`;
    case "possible-partial-export":
      return `${formatCount(count)} of ${plural(num(n, "previous"), "friend")} ${isAre(count)} gone. This may be a partial export, so check it before you trust the list.`;
    case "blocked-excluded":
      return `${plural(count, "friend")} left your list because you blocked ${noun(count, "that friend", "them")}. Snappy keeps ${noun(count, "that friend", "them")} apart.`;
    case "requests-may-be-declined":
      return `${plural(count, "request")} you sent ${noun(count, "is", "are")} no longer listed. ${noun(count, "It", "They")} may have been declined.`;
    case "no-activity-data":
      return "Your export has no saved chats or Snaps, so activity is not shown.";
    case "earlier-period-not-covered":
      return "Your chats and Snaps may not reach back far enough to compare.";
    case "unusable-times-ignored":
      return `${plural(count, "chat or Snap", "chats or Snaps")} ${hasHave(count)} a missing or future date. Snappy leaves ${noun(count, "it", "them")} out.`;
    case "no-memories-data":
      return "Your export has no Memories list, so Memories are not shown.";
    case "memories-dates-unusable": {
      const left = num(n, "undated") + num(n, "future");
      return `${plural(left, "Memory", "Memories")} ${hasHave(left)} no date or a date in the future. Snappy leaves ${noun(left, "it", "them")} out of the new count.`;
    }
    default:
      return "Snappy noted something it cannot describe. Run it with --verbose and share the code.";
  }
}

const WARNINGS = new Set(["unusable-snapshot-time", "order-swapped", "snapshot-time-in-future", "possible-partial-export"]);

function noteLines(r: SinceReport): NoteLine[] {
  const lines = r.notes.map((n): NoteLine => ({ severity: WARNINGS.has(n.code) ? "warning" : "info", code: n.code, text: noteText(n, r.source) }));
  if (r.dateGuessed) {
    lines.push({ severity: "info", code: "export-date-guessed", text: "Your export has no date of its own, so Snappy used the date of its file. Counts may be off by a little." });
  }
  return lines;
}

// ------------------------------------------------------------------------------------ rendering ---

const signed = (n: number): string => (n > 0 ? `up ${formatCount(n)}` : n < 0 ? `down ${formatCount(-n)}` : "no change");

function summaryLines(r: Result, term: Term): string[] {
  const f = r.friends;
  if (!r.comparable || f === null || r.previousAt === null || r.currentAt === null || r.daysBetween === null) return [];
  return [
    `Compared ${formatDate(r.previousAt)} with ${formatDate(r.currentAt)}, ${term.violet(plural(r.daysBetween, "day"))} apart.`,
    `Friends: ${formatCount(f.previousCount)} before, ${formatCount(f.currentCount)} now (${signed(f.net)}).`,
  ];
}

function countsTable(r: Result, term: Term): string[] {
  const by = peopleByChange(r);
  return term.table(
    [{ header: "Change" }, { header: "People", align: "right" }],
    GROUPS.map((g) => [g.heading, formatCount(by[g.change].length)]),
  );
}

function memoriesLines(m: NonNullable<Result["memories"]>): string[] {
  const lines = [`${plural(m.total, "Memory", "Memories")} in this export, ${formatCount(m.newCount)} captured since your last export.`];
  if (m.totalChange !== null) lines.push(`The total is ${signed(m.totalChange)} since your last export.`);
  lines.push("Snappy counts the date a Memory was captured, not the date it was uploaded.");
  return lines;
}

function activityLines(a: NonNullable<Result["activity"]>, term: Term): string[] {
  const rows = [["Since your last export", formatCount(a.since.sent), formatCount(a.since.received), formatCount(a.since.unknown)]];
  if (a.earlier !== null) rows.push(["Before that", formatCount(a.earlier.sent), formatCount(a.earlier.received), formatCount(a.earlier.unknown)]);
  const lines = term.table([{ header: "Period" }, { header: "Sent", align: "right" }, { header: "Received", align: "right" }, { header: "Unknown", align: "right" }], rows);
  if (a.change !== null) lines.push("", `Sent: ${signed(a.change.sent)}. Received: ${signed(a.change.received)}.`, "Before that means the same length of time before your last export.");
  return lines;
}

export interface SinceRenderOptions {
  /** Rows shown per list in text. */
  limit?: number;
  /** Counts only: no usernames. */
  counts?: boolean;
  /** The CSV file that was saved, named under the lists. */
  saved?: string;
}

/** The text for a result. `opts.counts` leaves every username out. Pure: easy to test with hand-built results. */
export function renderSince(report: SinceReport, term: Term, verbose: boolean, opts: SinceRenderOptions = {}): string {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const counts = opts.counts === true;
  const out: string[] = [term.bold("Since your last export")];
  const summary = summaryLines(report, term);
  if (summary.length > 0) out.push(...summary.map((l) => `  ${l}`));
  out.push("");

  if (report.comparable) {
    out.push(...section(term, "What changed", countsTable(report, term)));
    if (!counts) {
      const by = peopleByChange(report);
      for (const g of GROUPS) {
        const people = by[g.change];
        if (people.length === 0) continue;
        const shown = people.slice(0, limit);
        const lines = term.table(
          [{ header: "Username" }, { header: g.dateHeader }],
          shown.map((p) => [printable(p.username), dateCell(p.at)]),
        );
        const rest = people.length - shown.length;
        if (rest > 0) lines.push("", `And ${formatCount(rest)} more. Use --limit to see more, or --out to save them all.`);
        out.push(...section(term, g.heading, lines));
      }
    }
    if (report.memories !== null) out.push(...section(term, "Memories", memoriesLines(report.memories)));
    if (report.activity !== null) out.push(...section(term, "Chats and Snaps", activityLines(report.activity, term)));
  }

  const lines = renderNotes(noteLines(report), term, { heading: "Notes", verbose });
  if (lines.length > 0) out.push(...lines, "");
  if (opts.saved !== undefined) out.push(`CSV saved: ${opts.saved}`, "");
  return finish(out);
}

/** The JSON for a result. With --counts the lists that name people are emptied, and listCounts says how long each was. */
function jsonReport(report: SinceReport, counts: boolean): Record<string, unknown> {
  const by = peopleByChange(report);
  const listCounts = Object.fromEntries(GROUPS.map((g) => [g.change, by[g.change].length]));
  if (!counts || report.friends === null || report.requests === null) return { ...report, listCounts };
  return {
    ...report,
    friends: { ...report.friends, added: [], disappeared: [], removedByYou: [], blockedByYou: [] },
    requests: { accepted: [], stillPending: [], vanished: [] },
    listCounts,
  };
}

// ------------------------------------------------------------------------------------- running ---

export async function runSince(args: string[], io: Io): Promise<number> {
  const { values: flags, positionals } = parseInsightArgs<Flags>("since", args, {
    ...LEDGER_OPTIONS,
    earlier: { type: "string" },
    "utc-offset": { type: "string" },
    limit: { type: "string" },
    counts: { type: "boolean" },
    out: { type: "string" },
    force: { type: "boolean" },
    "no-save": { type: "boolean" },
  });
  if (flags.help) {
    io.out.write(SINCE_USAGE);
    return 0;
  }
  const term = insightTerm(flags, io);
  const verbose = flags.verbose === true;

  // Check every option and the output name before anything is read.
  const limit = intOption("--limit", flags.limit, 1, MAX_LIMIT) ?? DEFAULT_LIMIT;
  const utcOffsetMinutes = flags["utc-offset"] === undefined ? undefined : parseUtcOffsetHours(flags["utc-offset"]);
  const counts = flags.counts === true;
  const noSave = flags["no-save"] === true;
  if (flags.earlier !== undefined && flags.earlier.trim() === "") throw new CliError("usage", "--earlier needs the path of an earlier export.");
  if (flags.out !== undefined) {
    if (counts) throw new CliError("usage", "--out saves usernames, so it cannot be used with --counts.");
    await checkOutputPath(io, flags.out, { option: "--out", extension: ".csv", force: flags.force === true });
  }

  const useLedger = flags.earlier === undefined && !noSave;
  const input = await loadInsightInput(positionals, io, useLedger ? { ledger: { path: historyPathFlag(flags), passphraseFile: flags["passphrase-file"] } } : {});
  const earlierInput: InsightInput | undefined = flags.earlier === undefined ? undefined : await loadInsightInput([flags.earlier], io);
  const generatedAt = new Date(input.now).toISOString();

  // A broken export may hide part of a list, which would look like people leaving. So Snappy stops.
  if (input.broken || earlierInput?.broken === true) {
    const issues = [...input.issues, ...(earlierInput?.issues ?? [])];
    if (flags.json) {
      io.out.write(jsonText({ generatedAt, issues: issues.map((i) => ({ severity: i.severity, code: i.code })), stopped: "export-errors" }));
    } else {
      const notes: NoteLine[] = issues.map((i) => ({ severity: i.severity, code: i.code, text: i.message }));
      io.out.write(
        finish([
          ...renderNotes(notes, term, { heading: "Notes", verbose }),
          "",
          "Snappy stopped, since a broken export could make friends look as if they left.",
          "Run the check command to see what to fix.",
        ]),
      );
    }
    return 2;
  }

  const current = snapshotFromExport(input.parsed, { takenAt: input.takenAt });
  let previous: Snapshot | undefined;
  let source: PreviousSource;
  if (earlierInput !== undefined) {
    previous = snapshotFromExport(earlierInput.parsed, { takenAt: earlierInput.takenAt });
    source = "file";
  } else if (noSave) {
    source = "skipped";
  } else if (input.ledger === undefined) {
    source = "none";
  } else {
    previous = choosePrevious(input.ledger.snapshots, current);
    source = "ledger";
  }

  const result = insights.sinceLastExport.sinceLastExport({
    ...(previous !== undefined && { previous }),
    current,
    events: input.parsed.chats,
    memories: input.parsed.memories,
    now: input.now,
    ...(utcOffsetMinutes !== undefined && { utcOffsetMinutes }),
  });
  const report: SinceReport = { ...result, source, dateGuessed: input.takenAtSource !== "export" };

  if (flags.out !== undefined) await saveInsightFile(io, flags.out, sinceToCsv(report), { option: "--out", extension: ".csv", force: flags.force === true });

  if (flags.json) {
    io.out.write(jsonText({ generatedAt, ...jsonReport(report, counts), ...(flags.out !== undefined && { saved: flags.out }) }));
  } else {
    io.out.write(renderSince(report, term, verbose, { limit, counts, ...(flags.out !== undefined && { saved: flags.out }) }));
  }
  return 0;
}

export const sinceCommand: InsightCommand = {
  name: "since",
  synopsis: "since <ZIP files...>",
  summary: "See what changed since your last export.",
  group: "Your export",
  usage: SINCE_USAGE,
  run: runSince,
};
