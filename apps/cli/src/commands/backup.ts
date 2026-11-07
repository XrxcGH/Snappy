/**
 * snappy-export backup: save a portable copy of your friends list (plus the blocked and ignored
 * lists) as a small JSON file, or check a saved backup against a new export. Read-only unless the
 * person passes --out: no file is written otherwise and the ledger is never opened. The lists come
 * from core's friendsBackup. Usernames are printed only with --list, in a table the person asked
 * for; notes, errors and JSON counts never hold one.
 */
import { readFile, stat } from "node:fs/promises";
import { insights } from "@snappy-export/core";
import { CliError, fsError } from "../errors.ts";
import { formatCount, formatDate, isAre, noun, plural, wasWere } from "../format.ts";
import type { InsightCommand } from "../insights-command.ts";
import { friendCountOf, insightTerm, loadInsightInput, parseInsightArgs, FRIEND_COUNT_OPTIONS } from "../insights-input.ts";
import type { CommonFlags, FriendCountFlags } from "../insights-input.ts";
import { checkOutputPath, saveInsightFile } from "../insights-output.ts";
import type { Io } from "../io.ts";
import { finish, jsonText, renderNotes, section } from "../render-insights.ts";
import type { NoteLine } from "../render-insights.ts";
import type { Term } from "../term.ts";

export const BACKUP_USAGE = `Usage: snappy-export backup <ZIP files or folder...> [options]

Saves your friends list, and your blocked and ignored lists, as a small file you can keep. Later you
can check that file against a new export to see who is missing.

Give it every part of your export, or a folder or wildcard such as "mydata*.zip".

Options
  --out <file.json>      Save the backup to this file.
  --force                Replace the file named by --out if it exists.
  --compare <file.json>  Check a saved backup against this export.
  --list                 Print the usernames too.
  --friend-count <n>     The friend count in the app, to catch a short export.
  --json                 Print JSON instead of text.
  --verbose              Add a short code to each note, for bug reports.
  --no-color             Plain text.

Exit codes: 0 done, 1 could not run, 2 the export has problems and nothing was saved.
`;

type Flags = CommonFlags &
  FriendCountFlags & {
    out?: string;
    force?: boolean;
    compare?: string;
    list?: boolean;
  };

type ListName = insights.friendsBackup.BackupListName;
type Backup = insights.friendsBackup.FriendsBackup;
type BackupNote = insights.friendsBackup.BackupNote;
type ComparisonNote = insights.friendsBackup.ComparisonNote;

const LIST_NAMES: readonly ListName[] = ["friends", "blocked", "ignored"];
const LIST_LABEL: Record<ListName, string> = { friends: "Friends", blocked: "Blocked", ignored: "Ignored" };
/** The most usernames printed per list. The file and the JSON counts always hold every one. */
const MAX_LISTED = 200;

/** What a new backup holds. `lists` is present only with --list. */
export interface CreateResult {
  mode: "create";
  /** The date of the export the backup comes from, epoch ms. */
  exportDate: number;
  /** When the backup was made, epoch ms, or null when unknown. */
  takenAt: number | null;
  counts: Record<ListName, { people: number; dated: number }>;
  notes: BackupNote[];
  /** Warnings that the export may be short. Set when the run finds any. */
  exportNotes?: ExportNote[];
  lists?: Record<ListName, insights.friendsBackup.BackupEntry[]>;
  /** The path as the person typed it, once the file is written. */
  saved?: string;
}

export interface ListDiff {
  counts: insights.friendsBackup.ListComparison["counts"];
  /** Present only with --list. In this export, not in the backup. */
  added?: string[];
  /** Present only with --list. In the backup, not in this export. */
  removed?: string[];
}

/** What a comparison found. A list that is empty in the export is not compared (null). */
export interface CompareResult {
  mode: "compare";
  exportDate: number;
  backupTakenAt: number | null;
  identical: boolean;
  lists: Record<ListName, ListDiff | null>;
  notes: ComparisonNote[];
  /** Warnings that the export may be short. Set when the run finds any. */
  exportNotes?: ExportNote[];
  /** True when --list was given. */
  listed: boolean;
}

export type BackupResult = CreateResult | CompareResult;

/**
 * Warnings about the export itself that mean the backup may be missing people. They come from the
 * whole-export checks (the friend count from --friend-count, or a date range), not from the backup.
 */
export type ExportNoteCode = "friend-count-mismatch" | "possibly-date-limited";
export interface ExportNote {
  code: ExportNoteCode;
  params: Record<string, number>;
}
const EXPORT_NOTE_CODES: readonly string[] = ["friend-count-mismatch", "possibly-date-limited"];

const EXPORT_NOTE_TEXT: Record<ExportNoteCode, string> = {
  "friend-count-mismatch": "The friends list differs from the count you gave. The backup may miss friends.",
  "possibly-date-limited": "The export may cover only part of your history. The backup may miss people.",
};

/** Notes for the export-wide warnings that matter here. */
function exportNoteLines(notes: ExportNote[] | undefined): NoteLine[] {
  return (notes ?? []).map((n) => ({ severity: "warning" as const, code: n.code, text: EXPORT_NOTE_TEXT[n.code] }));
}

// ----------------------------------------------------------------- wording ---

const num = (n: BackupNote | ComparisonNote, key: string): number => n.params[key] ?? 0;

/** The sentence for one note about a backup being made. */
function createNoteText(n: BackupNote): string {
  const count = num(n, "count");
  switch (n.code) {
    case "usernames-skipped":
      return `${plural(count, "username")} could not be used and ${wasWere(count)} left out.`;
    case "duplicates-merged":
      return `${plural(count, "repeated entry", "repeated entries")} ${wasWere(count)} merged.`;
    case "timestamps-invalid":
      return `${plural(count, "date")} could not be read and ${wasWere(count)} left out.`;
    case "timestamps-in-future":
      return `${plural(count, "date")} ${isAre(count)} in the future. Snappy leaves ${noun(count, "it", "them")} out.`;
    case "entries-over-limit":
      return `${plural(count, "entry", "entries")} went over the size limit and ${wasWere(count)} left out.`;
    case "lists-overlap":
      return `${plural(count, "person", "people")} may be on both your friends list and your blocked list.`;
    case "friends-empty":
      return "Your friends list is empty, so the backup holds no friends. The export may be cut short.";
    case "time-unknown":
      return "Snappy could not tell when this backup was made.";
    default:
      return "Snappy noted something it cannot describe. Run it with --verbose and share the code.";
  }
}

/** The sentence for one note about a comparison. */
function compareNoteText(n: ComparisonNote): string {
  switch (n.code) {
    case "current-empty":
      return "The friends list in this export is empty, but the backup is not. This may be the wrong export.";
    case "usernames-skipped": {
      const count = num(n, "count");
      return `${plural(count, "username")} in this export could not be used and ${wasWere(count)} not compared.`;
    }
    case "many-removed":
      return `${formatCount(num(n, "removed"))} of ${plural(num(n, "backup"), "backed-up friend")} ${isAre(num(n, "removed"))} missing here. This export may be older or cut short.`;
    default:
      return "Snappy noted something it cannot describe. Run it with --verbose and share the code.";
  }
}

const SEVERITY: Record<string, "error" | "warning" | "info"> = {
  "current-empty": "warning",
  "many-removed": "warning",
  "friends-empty": "warning",
  "lists-overlap": "info",
};
const severityOf = (code: string): "warning" | "info" => (SEVERITY[code] === "warning" ? "warning" : "info");

/** The sentence for a backup file Snappy could not read. Never echoes anything from the file. */
function parseErrorText(error: insights.friendsBackup.BackupParseError): string {
  switch (error) {
    case "too-large":
      return "That file is too large to be a Snappy friends backup.";
    case "unsupported-version":
      return "That backup comes from another version of Snappy, so it cannot be read safely.";
    case "too-many-entries":
      return "That backup holds more entries than Snappy reads, so it may not be a real backup.";
    default:
      return "That file is not a Snappy friends backup. Choose a file saved by the backup command.";
  }
}

// --------------------------------------------------------------- rendering ---

const asOf = (result: BackupResult): string => `Based on your export from ${formatDate(result.exportDate)}.`;

function renderCreate(r: CreateResult, term: Term, verbose: boolean): string[] {
  const out: string[] = [term.bold("Friends backup"), `  ${term.violet(`${plural(r.counts.friends.people, "friend")} in this backup.`)}`, `  ${asOf(r)}`, ""];

  out.push(
    ...section(
      term,
      "What the backup holds",
      term.table(
        [{ header: "List" }, { header: "People", align: "right" }, { header: "With a date", align: "right" }],
        LIST_NAMES.map((name) => [LIST_LABEL[name], formatCount(r.counts[name].people), formatCount(r.counts[name].dated)]),
      ),
    ),
  );

  const notes: NoteLine[] = [...exportNoteLines(r.exportNotes), ...r.notes.map((n) => ({ severity: severityOf(n.code), code: n.code, text: createNoteText(n) }))];
  const noteLines = renderNotes(notes, term, { heading: "Notes", verbose });
  if (noteLines.length > 0) out.push(...noteLines, "");

  if (r.lists !== undefined) {
    for (const name of LIST_NAMES) {
      const entries = r.lists[name];
      if (entries.length === 0) continue;
      const shown = entries.slice(0, MAX_LISTED);
      const rows = term.table(
        [{ header: "Username" }, { header: "Added" }],
        shown.map((e) => [e.username, e.createdAt === undefined ? "-" : formatDate(e.createdAt)]),
      );
      const more = entries.length > shown.length ? [`And ${plural(entries.length - shown.length, "more person", "more people")}.`] : [];
      out.push(...section(term, LIST_LABEL[name], [...rows, ...more]));
    }
  }

  out.push(
    ...section(
      term,
      "Saving",
      r.saved === undefined
        ? ["Nothing was saved. Add --out friends.json to save this backup."]
        : [`Saved to ${r.saved}.`, "The file is plain text and lists your friends. Keep it somewhere private."],
    ),
  );
  return out;
}

const diffCell = (value: number | undefined): string => (value === undefined ? "-" : formatCount(value));

function renderCompare(r: CompareResult, term: Term, verbose: boolean): string[] {
  const verdict = r.identical ? "Your lists match the backup." : "Your lists differ from the backup.";
  const made = r.backupTakenAt === null ? "The backup has no date." : `The backup was made ${formatDate(r.backupTakenAt)}.`;
  const out: string[] = [term.bold("Backup check"), `  ${term.violet(verdict)}`, `  ${made}`, `  ${asOf(r)}`, ""];

  out.push(
    ...section(term, "Compared with this export", [
      ...term.table(
        [{ header: "List" }, { header: "In backup", align: "right" }, { header: "Here now", align: "right" }, { header: "New", align: "right" }, { header: "Missing", align: "right" }],
        LIST_NAMES.map((name) => {
          const d = r.lists[name];
          return [LIST_LABEL[name], diffCell(d?.counts.backup), diffCell(d?.counts.current), diffCell(d?.counts.added), diffCell(d?.counts.removed)];
        }),
      ),
      ...(LIST_NAMES.some((name) => r.lists[name] === null) ? ["A list that is empty in this export is not compared."] : []),
    ]),
  );

  const notes: NoteLine[] = [...exportNoteLines(r.exportNotes), ...r.notes.map((n) => ({ severity: severityOf(n.code), code: n.code, text: compareNoteText(n) }))];
  const noteLines = renderNotes(notes, term, { heading: "Notes", verbose });
  if (noteLines.length > 0) out.push(...noteLines, "");

  if (r.listed) {
    for (const name of LIST_NAMES) {
      const d = r.lists[name];
      for (const [heading, names] of [
        [`${LIST_LABEL[name]}: missing from this export`, d?.removed ?? []],
        [`${LIST_LABEL[name]}: new since the backup`, d?.added ?? []],
      ] as const) {
        if (names.length === 0) continue;
        const shown = names.slice(0, MAX_LISTED);
        const more = names.length > shown.length ? [`And ${plural(names.length - shown.length, "more person", "more people")}.`] : [];
        out.push(...section(term, heading, [...term.table([{ header: "Username" }], shown.map((u) => [u])), ...more]));
      }
    }
  }

  if (!r.identical && !r.listed) out.push(...section(term, "Next step", ["Add --list to see the usernames."]));
  return out;
}

export function renderBackup(result: BackupResult, term: Term, verbose: boolean): string {
  return finish(result.mode === "create" ? renderCreate(result, term, verbose) : renderCompare(result, term, verbose));
}

// ------------------------------------------------------------------- build ---

function buildCreate(backup: Backup, notes: BackupNote[], exportDate: number, listed: boolean): CreateResult {
  const counts = Object.fromEntries(
    LIST_NAMES.map((name) => [name, { people: backup[name].length, dated: backup[name].filter((e) => e.createdAt !== undefined).length }]),
  ) as CreateResult["counts"];
  return {
    mode: "create",
    exportDate,
    takenAt: backup.takenAt,
    counts,
    notes,
    ...(listed && { lists: { friends: backup.friends, blocked: backup.blocked, ignored: backup.ignored } }),
  };
}

function buildCompare(backup: Backup, cmp: insights.friendsBackup.BackupComparison, exportDate: number, listed: boolean): CompareResult {
  const diff = (c: insights.friendsBackup.ListComparison | null): ListDiff | null =>
    c === null ? null : { counts: c.counts, ...(listed && { added: c.added, removed: c.removed }) };
  return {
    mode: "compare",
    exportDate,
    backupTakenAt: backup.takenAt,
    identical: cmp.identical,
    lists: { friends: diff(cmp.friends), blocked: diff(cmp.blocked), ignored: diff(cmp.ignored) },
    notes: cmp.notes,
    listed,
  };
}

/** Read and parse a saved backup. Only the path the person typed is ever named in an error. */
async function readBackupFile(path: string, now: number): Promise<Backup> {
  let text: string;
  try {
    const size = (await stat(path)).size;
    // A backup is plain text of at most MAX_BACKUP_CHARS characters, so a much larger file is not one.
    if (size > insights.friendsBackup.MAX_BACKUP_CHARS * 4) throw new CliError("bad-backup", parseErrorText("too-large"));
    text = await readFile(path, "utf8");
  } catch (e) {
    if (e instanceof CliError) throw e;
    throw fsError(e, "read", path);
  }
  const parsed = insights.friendsBackup.parseFriendsBackup(text, { now });
  if (!parsed.ok) throw new CliError("bad-backup", parseErrorText(parsed.error));
  return parsed.backup;
}

// --------------------------------------------------------------------- run ---

export async function runBackup(args: string[], io: Io): Promise<number> {
  const { values: flags, positionals } = parseInsightArgs<Flags>("backup", args, {
    ...FRIEND_COUNT_OPTIONS,
    out: { type: "string" },
    force: { type: "boolean" },
    compare: { type: "string" },
    list: { type: "boolean" },
  });
  if (flags.help) {
    io.out.write(BACKUP_USAGE);
    return 0;
  }
  const friendCount = friendCountOf(flags);
  const term = insightTerm(flags, io);
  const listed = flags.list === true;
  const force = flags.force === true;

  // Check every option and the output name before anything is read.
  if (flags.out !== undefined && flags.compare !== undefined) {
    throw new CliError("usage", "Use --out to save a backup or --compare to check one, not both.");
  }
  if (flags.out !== undefined) await checkOutputPath(flags.out, { option: "--out", extension: ".json", force });
  if (flags.compare !== undefined && flags.compare.trim() === "") {
    throw new CliError("usage", "--compare needs the path of a saved backup.");
  }

  const input = await loadInsightInput(positionals, io, { friendCount });
  if (input.broken) {
    // A broken export would make a wrong backup, so nothing is saved and nothing is compared.
    const issues = input.issues.map((i) => ({ severity: i.severity, code: i.code, text: i.message }));
    if (flags.json) {
      io.out.write(jsonText({ generatedAt: new Date(input.now).toISOString(), stopped: true, issues: input.issues }));
    } else {
      const lines = [...renderNotes(issues, term, { heading: "Problems found", verbose: flags.verbose === true }), "", "Snappy stopped, so no backup was made or checked. Fix the problems above and run it again."];
      io.out.write(finish(lines));
    }
    return 2;
  }

  // The export itself may be short. Say so, since a short export makes a short backup.
  const exportNotes: ExportNote[] = input.issues
    .filter((i) => EXPORT_NOTE_CODES.includes(i.code))
    .map((i) => ({ code: i.code as ExportNoteCode, params: {} }));

  let result: BackupResult;
  if (flags.compare !== undefined) {
    const backup = await readBackupFile(flags.compare, input.now);
    const { friends, blocked, ignored } = input.parsed.friends;
    // A list the export does not hold at all must not make every backed-up name look removed.
    const current: insights.friendsBackup.BackupSource = {
      friends,
      ...(blocked.length > 0 && { blocked }),
      ...(ignored.length > 0 && { ignored }),
    };
    result = buildCompare(backup, insights.friendsBackup.compareFriendsBackup(backup, current), input.takenAt, listed);
  } else {
    const { friends, blocked, ignored } = input.parsed.friends;
    const { backup, notes } = insights.friendsBackup.createFriendsBackup({ friends, blocked, ignored }, input.now);
    result = buildCreate(backup, notes, input.takenAt, listed);
    if (flags.out !== undefined) {
      await saveInsightFile(flags.out, insights.friendsBackup.backupToJson(backup) + "\n", { option: "--out", extension: ".json", force });
      result.saved = flags.out;
    }
  }

  if (exportNotes.length > 0) result.exportNotes = exportNotes;

  if (flags.json) io.out.write(jsonText({ generatedAt: new Date(input.now).toISOString(), ...result }));
  else io.out.write(renderBackup(result, term, flags.verbose === true));
  return 0;
}

export const backupCommand: InsightCommand = {
  name: "backup",
  synopsis: "backup <ZIP files...>",
  summary: "Save a copy of your friends list.",
  group: "Friends",
  usage: BACKUP_USAGE,
  run: runBackup,
};
