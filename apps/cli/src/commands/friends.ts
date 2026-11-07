/**
 * snappy-export friends: one table of your friends that you can sort, filter and save as a spreadsheet
 * file (.csv). Read-only unless the person passes --out: no file is written otherwise and the ledger is
 * never opened. The rows come from core's friendsTable, which sees only usernames, the dates friendships
 * were made and a direction and a time per one-to-one chat or Snap. Usernames are printed in the table
 * the person asked for and in the file they chose; notes, errors and JSON counts never hold one.
 */
import { insights } from "@snappy-export/core";
import { CliError } from "../errors.ts";
import { intOption } from "../args.ts";
import { formatCount, formatDate, hasHave, isAre, noun, plural, wasWere } from "../format.ts";
import type { InsightCommand } from "../insights-command.ts";
import { insightTerm, loadInsightInput, parseInsightArgs, parseUtcOffsetHours } from "../insights-input.ts";
import type { CommonFlags } from "../insights-input.ts";
import { checkOutputPath, saveInsightFile } from "../insights-output.ts";
import type { Io } from "../io.ts";
import { finish, jsonText, renderNotes, section } from "../render-insights.ts";
import type { NoteLine } from "../render-insights.ts";
import type { Term } from "../term.ts";

export const FRIENDS_USAGE = `Usage: snappy-export friends <ZIP files or folder...> [options]

Lists your friends in one table, with the day you added each one, your last chat or Snap, and hints
such as quiet or one-sided. It reads usernames, dates and directions only, never message text, photos
or videos.

Give it every part of your export, or a folder or wildcard such as "mydata*.zip".

Options
  --sort <key>              Sort by username, added, first, last, recent, total, sent or received.
  --desc                    Put the highest or newest first.
  --starts-with <text>      Only friends whose username starts with this.
  --quiet                   Only friends who may be quiet.
  --one-sided               Only friends where one side may write most.
  --waiting                 Only friends who may be waiting on a reply.
  --waiting-on <you|them>   Only friends waiting on you, or only those you wait on.
  --added-from <date>       Only friends added on or after this day, such as 2024-01-31.
  --added-to <date>         Only friends added on or before this day.
  --last-from <date>        Only a last chat or Snap on or after this day.
  --last-to <date>          Only a last chat or Snap on or before this day.
  --utc-offset <hours>      Hours from UTC, such as 2 or 5:30. Write -5 as --utc-offset=-5.
  --limit <n>               Rows to show. Default 25. A file and JSON always hold every match.
  --out <file.csv>          Save the table as a spreadsheet file. It lists usernames.
  --force                   Replace the file named by --out if it exists.
  --json                    Print JSON instead of text.
  --verbose                 Add a short code to each note, for bug reports.
  --no-color                Plain text.

Exit codes: 0 done, 1 could not run, 2 the export has errors and was not read.
`;

interface Flags extends CommonFlags {
  sort?: string;
  desc?: boolean;
  "starts-with"?: string;
  quiet?: boolean;
  "one-sided"?: boolean;
  waiting?: boolean;
  "waiting-on"?: string;
  "added-from"?: string;
  "added-to"?: string;
  "last-from"?: string;
  "last-to"?: string;
  "utc-offset"?: string;
  limit?: string;
  out?: string;
  force?: boolean;
}

const OPTIONS = {
  sort: { type: "string" },
  desc: { type: "boolean" },
  "starts-with": { type: "string" },
  quiet: { type: "boolean" },
  "one-sided": { type: "boolean" },
  waiting: { type: "boolean" },
  "waiting-on": { type: "string" },
  "added-from": { type: "string" },
  "added-to": { type: "string" },
  "last-from": { type: "string" },
  "last-to": { type: "string" },
  "utc-offset": { type: "string" },
  limit: { type: "string" },
  out: { type: "string" },
  force: { type: "boolean" },
} as const;

type Table = insights.friendsTable.FriendsTable;
type Row = insights.friendsTable.FriendRow;
type Note = insights.friendsTable.FriendsTableNote;
type SortKey = insights.friendsTable.FriendsSortKey;
type Filter = insights.friendsTable.FriendsFilter;

const DEFAULTS = insights.friendsTable.FRIENDS_TABLE_DEFAULTS;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 1000;
const CSV_FILE_NAME = "friends.csv";

const SORT_KEYS: readonly SortKey[] = ["username", "added", "first", "last", "recent", "total", "sent", "received"];

/** What each sort key is called in the "Sorted by" line, and how its two directions read. */
const SORT_TEXT: Record<SortKey, { label: string; asc: string; desc: string }> = {
  username: { label: "username", asc: "A to Z", desc: "Z to A" },
  added: { label: "date added", asc: "oldest first", desc: "newest first" },
  first: { label: "first chat or Snap", asc: "oldest first", desc: "newest first" },
  last: { label: "last chat or Snap", asc: "oldest first", desc: "newest first" },
  recent: { label: `chats and Snaps in the last ${DEFAULTS.recentDays} days`, asc: "fewest first", desc: "most first" },
  total: { label: "total chats and Snaps", asc: "fewest first", desc: "most first" },
  sent: { label: "chats and Snaps you sent", asc: "fewest first", desc: "most first" },
  received: { label: "chats and Snaps you received", asc: "fewest first", desc: "most first" },
};

/** What the person asked for, after the options are checked. */
export interface FriendsView {
  sort: SortKey;
  desc: boolean;
  /** Rows to show in the text table. */
  limit: number;
  /** True when any filter was given. */
  filtered: boolean;
  /** Every row that matches, sorted. The text shows the first `limit`; the file and JSON hold all. */
  rows: Row[];
  /** The path the person typed, once the file is written. */
  savedTo?: string;
}

// ----------------------------------------------------------------- wording ---

const num = (n: Note): number => n.params.count ?? 0;

/** The sentence for one note. Counts only: a note never names a person. Hedged where Snappy infers. */
function noteText(n: Note): string {
  const c = num(n);
  switch (n.code) {
    case "invalid-now":
      return "Snappy could not read today's date, so it left the table empty.";
    case "no-friends":
      return "Your export has no usable friends, so the table is empty.";
    case "no-events":
      return "Your export has no saved chats or Snaps, so the chat columns are empty.";
    case "events-without-time":
      return `${plural(c, "event")} had no usable date and ${wasWere(c)} left out.`;
    case "events-in-future":
      return `${plural(c, "event")} ${isAre(c)} dated after your export. Snappy left ${noun(c, "it", "them")} out.`;
    case "group-events-skipped":
      return `${plural(c, "group chat event")} ${wasWere(c)} left out.`;
    case "events-not-with-friends":
      return `${plural(c, "event")} with people outside your friends list ${wasWere(c)} left out.`;
    case "friends-duplicates-merged":
      return `${plural(c, "repeated friend")} ${wasWere(c)} merged, so each person is listed once.`;
    case "friends-invalid-username":
      return `${plural(c, "friend")} had no usable username and ${wasWere(c)} left out.`;
    case "friends-without-added-date":
      return `${plural(c, "friend")} ${hasHave(c)} no added date, so Snappy could not check them for quiet.`;
    case "quiet-not-judged-no-activity":
      return "Your export has no one-to-one chats or Snaps, so Snappy did not mark anyone as quiet.";
    case "quiet-not-judged-short-history":
      return `${plural(c, "friend")} without chats ${wasWere(c)} not checked for quiet, since your chats start too recently.`;
    default:
      return "Snappy noted something it cannot describe. Run it with --verbose and share the code.";
  }
}

function severityOf(code: string): NoteLine["severity"] {
  return code === "invalid-now" || code === "no-friends" ? "warning" : "info";
}

/** "2026-02-28" as a date that reads like the rest of Snappy. Days are the viewer's own calendar days. */
function dayCell(day: string | null): string {
  if (day === null) return "-";
  const [y = 0, m = 1, d = 1] = day.split("-").map(Number);
  return formatDate(Date.UTC(y, m - 1, d));
}

/** "Quiet", "One-sided, waiting on you": the hints on one row, or a dash. */
function hintsCell(r: Row): string {
  const parts: string[] = [];
  if (r.quiet) parts.push("quiet");
  if (r.oneSided) parts.push("one-sided");
  if (r.waitingOn === "you") parts.push("waiting on you");
  if (r.waitingOn === "them") parts.push("waiting on them");
  const text = parts.join(", ");
  return text === "" ? "-" : `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

const sortedByLine = (view: FriendsView): string => {
  const t = SORT_TEXT[view.sort];
  return `Sorted by ${t.label}, ${view.desc ? t.desc : t.asc}.`;
};

export function renderFriends(table: Table, view: FriendsView, term: Term, verbose: boolean): string {
  const s = table.summary;
  const out: string[] = [term.bold("Friends")];

  if (s.friends === 0) {
    out.push("  No friends to list.", "");
  } else {
    out.push(
      `  ${term.violet(plural(s.friends, "friend"))} in your export. ${formatCount(s.withEvents)} ${hasHave(s.withEvents)} saved chats or Snaps.`,
      ...(table.asOf === null ? [] : [`  Counted up to ${formatDate(table.asOf)}.`]),
      "  Hints come from saved chats and Snaps, so check in the app.",
      "",
    );

    out.push(
      ...section(
        term,
        "At a glance",
        term.table(
          [{ header: "May be" }, { header: "Friends", align: "right" }],
          [
            ["Quiet", formatCount(s.quiet)],
            ["One-sided", formatCount(s.oneSided)],
            ["Waiting on a reply", formatCount(s.waiting)],
          ],
        ),
      ),
    );

    const shown = view.rows.slice(0, view.limit);
    const list: string[] = [];
    if (view.rows.length === 0) {
      list.push("No friends match your filters.");
    } else {
      list.push(
        `Showing ${formatCount(shown.length)} of ${plural(view.rows.length, "friend")}${view.filtered ? ` that ${noun(view.rows.length, "matches", "match")} your filters` : ""}. ${sortedByLine(view)}`,
        "",
        ...term.table(
          [
            { header: "Friend", flex: true },
            { header: "Added" },
            { header: "Last" },
            { header: "Total", align: "right" },
            { header: "Sent", align: "right" },
            { header: "Received", align: "right" },
            { header: "Hints" },
          ],
          shown.map((r) => [r.username, dayCell(r.addedDay), dayCell(r.lastDay), formatCount(r.total), formatCount(r.sent), formatCount(r.received), hintsCell(r)]),
        ),
      );
      const more = view.rows.length - shown.length;
      if (more > 0) list.push("", `${formatCount(more)} more not shown. Use --limit to show more.`);
    }
    out.push(...section(term, "Your friends", list));

    out.push(
      ...section(term, "How hints work", [
        `Quiet: no chat or Snap for ${plural(DEFAULTS.quietDays, "day")}.`,
        `One-sided: in the last ${plural(DEFAULTS.waiting.windowDays, "day")}, one side sent most of the messages.`,
        `Waiting: the last message may still be unanswered, as in "snappy-export replies".`,
      ]),
    );
  }

  const notes: NoteLine[] = table.notes.map((n) => ({ severity: severityOf(n.code), code: n.code, text: noteText(n) }));
  const noteLines = renderNotes(notes, term, { heading: "Notes", verbose });
  if (noteLines.length > 0) out.push(...noteLines, "");

  out.push(
    ...section(
      term,
      "File",
      view.savedTo === undefined
        ? ["Nothing was saved.", `Add --out ${CSV_FILE_NAME} to save every match as a spreadsheet file.`]
        : [`Saved to ${view.savedTo}.`, "It lists usernames, so keep it private."],
    ),
  );
  return finish(out);
}

// ---------------------------------------------------------------- options ---

/**
 * A day such as 2026-11-01 as the first or last millisecond of that day in the person's own offset, or
 * a usage error. The typed value is never echoed.
 */
function parseDay(flag: string, raw: string | undefined, offsetMinutes: number, end: boolean): number | undefined {
  if (raw === undefined) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  const bad = new CliError("usage", `${flag} must be a date such as 2026-11-01.`);
  if (m === null) throw bad;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const noon = new Date(Date.UTC(year, month - 1, day, 12));
  if (noon.getUTCFullYear() !== year || noon.getUTCMonth() !== month - 1 || noon.getUTCDate() !== day) throw bad;
  const start = Date.UTC(year, month - 1, day) - offsetMinutes * 60_000;
  return end ? start + 86_400_000 - 1 : start;
}

function parseRange(fromFlag: string, toFlag: string, from: string | undefined, to: string | undefined, offsetMinutes: number): insights.friendsTable.DateRange | undefined {
  const lo = parseDay(fromFlag, from, offsetMinutes, false);
  const hi = parseDay(toFlag, to, offsetMinutes, true);
  if (lo !== undefined && hi !== undefined && lo > hi) throw new CliError("usage", `${fromFlag} must not be after ${toFlag}.`);
  if (lo === undefined && hi === undefined) return undefined;
  return { ...(lo !== undefined && { from: lo }), ...(hi !== undefined && { to: hi }) };
}

function parseSort(raw: string | undefined): SortKey {
  if (raw === undefined) return "username";
  const key = raw.trim().toLowerCase();
  const found = SORT_KEYS.find((k) => k === key);
  if (found === undefined) throw new CliError("usage", `--sort must be one of ${SORT_KEYS.slice(0, -1).join(", ")} or ${SORT_KEYS.at(-1)}.`);
  return found;
}

function parseWaitingOn(raw: string | undefined): "you" | "them" | undefined {
  if (raw === undefined) return undefined;
  const who = raw.trim().toLowerCase();
  if (who !== "you" && who !== "them") throw new CliError("usage", "--waiting-on must be you or them.");
  return who;
}

export async function runFriends(args: string[], io: Io): Promise<number> {
  const { values: flags, positionals } = parseInsightArgs<Flags>("friends", args, OPTIONS);
  if (flags.help) {
    io.out.write(FRIENDS_USAGE);
    return 0;
  }
  const term = insightTerm(flags, io);

  // Check every option and the output name before anything is read.
  const offsetMinutes = flags["utc-offset"] === undefined ? undefined : parseUtcOffsetHours(flags["utc-offset"]);
  const sort = parseSort(flags.sort);
  const limit = intOption("--limit", flags.limit, 1, MAX_LIMIT) ?? DEFAULT_LIMIT;
  const waitingOn = parseWaitingOn(flags["waiting-on"]);
  const added = parseRange("--added-from", "--added-to", flags["added-from"], flags["added-to"], offsetMinutes ?? 0);
  const lastEvent = parseRange("--last-from", "--last-to", flags["last-from"], flags["last-to"], offsetMinutes ?? 0);
  const prefix = flags["starts-with"]?.trim();
  const filter: Filter = {
    ...(prefix !== undefined && prefix !== "" && { prefix }),
    ...(flags.quiet === true && { quiet: true }),
    ...(flags["one-sided"] === true && { oneSided: true }),
    ...(flags.waiting === true && { waiting: true }),
    ...(waitingOn !== undefined && { waitingOn }),
    ...(added !== undefined && { added }),
    ...(lastEvent !== undefined && { lastEvent }),
  };
  const save = { option: "--out", extension: ".csv", force: flags.force === true };
  if (flags.out !== undefined) await checkOutputPath(io, flags.out, save);
  else if (flags.force === true) throw new CliError("usage", "--force needs --out, since nothing is saved without it.");

  const input = await loadInsightInput(positionals, io);
  const generatedAt = new Date(input.now).toISOString();

  if (input.broken) {
    // A damaged export lists friends that may be missing, so say so and stop, as the other commands do.
    if (flags.json) {
      io.out.write(jsonText({ generatedAt, issues: input.issues, stopped: "export-errors" }));
    } else {
      const notes: NoteLine[] = input.issues.map((i) => ({ severity: i.severity, code: i.code, text: i.message }));
      io.out.write(
        finish([
          ...renderNotes(notes, term, { heading: "Problems found", verbose: flags.verbose === true }),
          "",
          "Snappy did not list friends from a broken export. Fix the problems above and run it again.",
          "",
        ]),
      );
    }
    return 2;
  }

  // Only the friends list and the chat metadata go to core: usernames, dates, directions and times.
  const table = insights.friendsTable.buildFriendsTable(
    { friends: input.parsed.friends, chats: input.parsed.chats, exportedAt: input.takenAt },
    { now: input.now, ...(offsetMinutes !== undefined && { utcOffsetMinutes: offsetMinutes }) },
  );
  const rows = insights.friendsTable.sortRows(insights.friendsTable.filterRows(table.rows, filter), sort, flags.desc === true ? "desc" : "asc");
  const view: FriendsView = { sort, desc: flags.desc === true, limit, filtered: Object.keys(filter).length > 0, rows };

  if (flags.out !== undefined) {
    await saveInsightFile(io, flags.out, insights.friendsTable.toCsv(rows), save);
    view.savedTo = flags.out;
  }

  if (flags.json) {
    io.out.write(
      jsonText({
        generatedAt,
        asOf: table.asOf === null ? null : new Date(table.asOf).toISOString(),
        utcOffsetMinutes: offsetMinutes ?? 0,
        saved: view.savedTo !== undefined,
        summary: table.summary,
        matching: rows.length,
        rows,
        notes: table.notes,
      }),
    );
  } else {
    io.out.write(renderFriends(table, view, term, flags.verbose === true));
  }
  return 0;
}

export const friendsCommand: InsightCommand = {
  name: "friends",
  synopsis: "friends <ZIP files...>",
  summary: "List your friends in a sortable table.",
  group: "Friends",
  usage: FRIENDS_USAGE,
  run: runFriends,
};
