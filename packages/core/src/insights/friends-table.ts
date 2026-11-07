import type { ChatEvent, FriendRecord, ParsedExport } from "../types.ts";
import { DAY_MS, neutralizeCell, normUser } from "../util.ts";
import { WAITING_DEFAULTS } from "./waiting-on-reply.ts";

/**
 * Friends table: one row per current friend, ready to sort, filter and export.
 *
 * Metadata only. A row holds the friend's username (the one identifier Snappy keeps), the
 * friendship date and counts and dates of one-to-one chat and Snap events. Nothing else is read.
 * Flags are hints from SAVED chats and Snaps, never facts about the person, so a screen should
 * word them as "may be".
 *
 * Flags reuse the thresholds of the existing checks:
 *  - quiet: the rule of the quiet-friends check (no one-to-one event for `quietDays`, friendship
 *    older than that, and chat data that reaches back that far).
 *  - waiting: the waiting-on-reply thresholds (received and unanswered for 3 days, or sent and
 *    unanswered for 7 days, up to 90 days; an unknown direction on the newest event means no flag).
 *  - one-sided: the one-sided thresholds (90 day window, 10 known events, 85% from one side).
 *
 * Time is measured back from the earlier of `now` and the export time, so an old export is not
 * read as a long silence. Events after that moment or without a usable time are left out and
 * counted in a note. Group chats and people who are not current friends are left out and counted.
 *
 * Pure and deterministic: no clock, no I/O. Linear in friends plus events, then one sort.
 */

/** Documented defaults. */
export const FRIENDS_TABLE_DEFAULTS = {
  /** "Recent events" counts events in this many days before the reference time. */
  recentDays: 90,
  /** Quiet check: no one-to-one event for this many days (same as the quiet-friends check). */
  quietDays: 180,
  /** Waiting and one-sided thresholds come from the waiting-on-reply module. */
  waiting: WAITING_DEFAULTS,
} as const;

/** The slice of a parsed export this module reads (a `ParsedExport` fits as is). */
export interface FriendsTableInput {
  friends: { friends: FriendRecord[] };
  chats: ChatEvent[];
  exportedAt?: ParsedExport["exportedAt"];
}

export interface FriendsTableOptions {
  /** Epoch ms "now" (injected; the module never reads a clock). */
  now: number;
  /** The viewer's offset from UTC in minutes, for the day text of each date. Default 0. Clamped to +-14 hours. */
  utcOffsetMinutes?: number;
}

export interface FriendRow {
  /** Stable id: "u:" plus the username. Unique, and the same on every run for the same friend. */
  id: string;
  /** Normalised username. Usernames appear only in rows like this one. */
  username: string;
  /** When the friendship was created, epoch ms, or null when the export does not say. */
  addedAt: number | null;
  /** First and last one-to-one event with this friend, epoch ms, or null when there are none. */
  firstAt: number | null;
  lastAt: number | null;
  /** The same dates as "YYYY-MM-DD" at the given UTC offset, or null. */
  addedDay: string | null;
  firstDay: string | null;
  lastDay: string | null;
  /** Events in the recent window and all time (all directions). */
  recent: number;
  total: number;
  /** All-time split by direction. `unknown` events prove activity but not who wrote. */
  sent: number;
  received: number;
  unknown: number;
  /** Status flags. `waitingOn` is null exactly when `waiting` is false. */
  quiet: boolean;
  oneSided: boolean;
  waiting: boolean;
  waitingOn: "you" | "them" | null;
}

export type FriendsTableNoteCode =
  | "invalid-now"
  | "no-friends"
  | "no-events"
  | "events-without-time"
  | "events-in-future"
  | "group-events-skipped"
  | "events-not-with-friends"
  | "friends-duplicates-merged"
  | "friends-invalid-username"
  | "friends-without-added-date"
  | "quiet-not-judged-no-activity"
  | "quiet-not-judged-short-history";

/** A stable code with whole-number counts only. Never carries user data. */
export interface FriendsTableNote {
  code: FriendsTableNoteCode;
  params: Record<string, number>;
}

export interface FriendsTable {
  /** Reference time actually used (epoch ms), or null when `now` was unusable. */
  asOf: number | null;
  /** One row per friend, sorted by username. */
  rows: FriendRow[];
  summary: { friends: number; withEvents: number; quiet: number; oneSided: number; waiting: number };
  notes: FriendsTableNote[];
}

interface Acc {
  first: number;
  last: number;
  lastSent: number;
  lastReceived: number;
  lastUnknown: number;
  sent: number;
  received: number;
  unknown: number;
  wSent: number;
  wReceived: number;
  wUnknown: number;
  recent: number;
}

const MAX_OFFSET_MINUTES = 14 * 60;
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const pad = (n: number, w: number): string => String(n).padStart(w, "0");

function dayText(ms: number | null, offsetMinutes: number): string | null {
  if (ms === null) return null;
  const d = new Date(ms + offsetMinutes * 60_000);
  if (Number.isNaN(d.getTime())) return null;
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1, 2)}-${pad(d.getUTCDate(), 2)}`;
}

const newAcc = (): Acc => ({
  first: Infinity,
  last: -Infinity,
  lastSent: -Infinity,
  lastReceived: -Infinity,
  lastUnknown: -Infinity,
  sent: 0,
  received: 0,
  unknown: 0,
  wSent: 0,
  wReceived: 0,
  wUnknown: 0,
  recent: 0,
});

function emptyTable(asOf: number | null, notes: FriendsTableNote[]): FriendsTable {
  return { asOf, rows: [], summary: { friends: 0, withEvents: 0, quiet: 0, oneSided: 0, waiting: 0 }, notes };
}

export function buildFriendsTable(input: FriendsTableInput, opts: FriendsTableOptions): FriendsTable {
  if (!Number.isFinite(opts.now)) return emptyTable(null, [{ code: "invalid-now", params: {} }]);

  const F = FRIENDS_TABLE_DEFAULTS;
  const W = F.waiting;
  const offset = Number.isFinite(opts.utcOffsetMinutes)
    ? Math.min(MAX_OFFSET_MINUTES, Math.max(-MAX_OFFSET_MINUTES, Math.round(opts.utcOffsetMinutes as number)))
    : 0;
  const asOf = Math.min(opts.now, Number.isFinite(input.exportedAt) ? (input.exportedAt as number) : opts.now);
  const recentStart = asOf - F.recentDays * DAY_MS;
  const quietMs = F.quietDays * DAY_MS;
  const windowStart = asOf - W.windowDays * DAY_MS;

  // Friends: one entry per normalised username, keeping the oldest known added date.
  const friends = new Map<string, { addedAt: number | null; acc: Acc }>();
  let duplicates = 0;
  let invalid = 0;
  for (const f of input.friends.friends) {
    const key = normUser(f?.username);
    if (!key) {
      invalid++;
      continue;
    }
    const added = typeof f.createdAt === "number" && Number.isFinite(f.createdAt) ? f.createdAt : null;
    const prev = friends.get(key);
    if (!prev) {
      friends.set(key, { addedAt: added, acc: newAcc() });
    } else {
      duplicates++;
      if (added !== null && (prev.addedAt === null || added < prev.addedAt)) prev.addedAt = added;
    }
  }
  if (friends.size === 0) {
    const notes: FriendsTableNote[] = [{ code: "no-friends", params: {} }];
    if (invalid > 0) notes.push({ code: "friends-invalid-username", params: { count: invalid } });
    return emptyTable(asOf, notes);
  }

  // Single pass over the events. The cache avoids normalising the same conversation twice.
  let noTime = 0;
  let future = 0;
  let groups = 0;
  let notFriends = 0;
  let earliestAny = Infinity;
  let oneToOne = 0;
  const byConversation = new Map<string, Acc | null>();
  for (const e of input.chats) {
    const at = e.at;
    if (typeof at !== "number" || !Number.isFinite(at)) {
      noTime++;
      continue;
    }
    if (at > asOf) {
      future++;
      continue;
    }
    if (at < earliestAny) earliestAny = at;
    if (e.isGroup || String(e.conversation ?? "").startsWith("group:")) {
      groups++;
      continue;
    }
    let acc = byConversation.get(e.conversation);
    if (acc === undefined) {
      acc = friends.get(normUser(e.conversation))?.acc ?? null;
      byConversation.set(e.conversation, acc);
    }
    if (acc === null) {
      notFriends++;
      continue;
    }
    oneToOne++;
    if (at < acc.first) acc.first = at;
    if (at > acc.last) acc.last = at;
    const inWindow = at > windowStart;
    if (at > recentStart) acc.recent++;
    if (e.direction === "sent") {
      acc.sent++;
      if (at > acc.lastSent) acc.lastSent = at;
      if (inWindow) acc.wSent++;
    } else if (e.direction === "received") {
      acc.received++;
      if (at > acc.lastReceived) acc.lastReceived = at;
      if (inWindow) acc.wReceived++;
    } else {
      acc.unknown++;
      if (at > acc.lastUnknown) acc.lastUnknown = at;
      if (inWindow) acc.wUnknown++;
    }
  }

  // Quiet needs chat data to judge from, and data that reaches back across the window.
  const hasActivity = oneToOne > 0;
  const coversWindow = earliestAny <= asOf - quietMs;
  let noAddedDate = 0;
  let shortHistory = 0;
  const rows: FriendRow[] = [];
  const summary = { friends: 0, withEvents: 0, quiet: 0, oneSided: 0, waiting: 0 };

  for (const [username, { addedAt, acc: a }] of friends) {
    const total = a.sent + a.received + a.unknown;
    const hasEvents = total > 0;
    const firstAt = hasEvents ? a.first : null;
    const lastAt = hasEvents ? a.last : null;
    if (addedAt === null) noAddedDate++;

    let quiet = false;
    if (hasActivity && addedAt !== null && asOf - addedAt >= quietMs) {
      if (hasEvents) quiet = asOf - a.last >= quietMs;
      else if (coversWindow) quiet = true;
      else shortHistory++;
    }

    // Waiting: who spoke last is decidable only when the newest event has a known direction.
    let waitingOn: "you" | "them" | null = null;
    const lastKnown = Math.max(a.lastSent, a.lastReceived);
    if (lastKnown !== -Infinity && a.lastUnknown < lastKnown && a.lastSent !== a.lastReceived) {
      const theyLast = a.lastReceived > a.lastSent;
      const ageDays = (asOf - lastKnown) / DAY_MS;
      if (ageDays >= (theyLast ? W.waitingOnYouDays : W.waitingOnThemDays) && ageDays <= W.maxWaitDays) {
        waitingOn = theyLast ? "you" : "them";
      }
    }

    // One-sided: known events in the window; unknown-direction events stay out of both sides.
    const known = a.wSent + a.wReceived;
    const oneSided =
      known >= W.minEvents &&
      a.wUnknown <= known &&
      a.wSent !== a.wReceived &&
      Math.max(a.wSent, a.wReceived) / known >= W.dominantShare;

    rows.push({
      id: `u:${username}`,
      username,
      addedAt,
      firstAt,
      lastAt,
      addedDay: dayText(addedAt, offset),
      firstDay: dayText(firstAt, offset),
      lastDay: dayText(lastAt, offset),
      recent: a.recent,
      total,
      sent: a.sent,
      received: a.received,
      unknown: a.unknown,
      quiet,
      oneSided,
      waiting: waitingOn !== null,
      waitingOn,
    });
    summary.friends++;
    if (hasEvents) summary.withEvents++;
    if (quiet) summary.quiet++;
    if (oneSided) summary.oneSided++;
    if (waitingOn) summary.waiting++;
  }
  rows.sort((x, y) => cmp(x.username, y.username));

  const notes: FriendsTableNote[] = [];
  const add = (code: FriendsTableNoteCode, count: number) => {
    if (count > 0) notes.push({ code, params: { count } });
  };
  if (input.chats.length === 0) notes.push({ code: "no-events", params: {} });
  else if (!hasActivity) notes.push({ code: "quiet-not-judged-no-activity", params: {} });
  add("group-events-skipped", groups);
  add("events-without-time", noTime);
  add("events-in-future", future);
  add("events-not-with-friends", notFriends);
  add("friends-duplicates-merged", duplicates);
  add("friends-invalid-username", invalid);
  add("friends-without-added-date", noAddedDate);
  add("quiet-not-judged-short-history", shortHistory);

  return { asOf, rows, summary, notes };
}

// ------------------------------------------------------------------ sorting ---

export type FriendsSortKey = "username" | "added" | "first" | "last" | "recent" | "total" | "sent" | "received";
export type SortDirection = "asc" | "desc";

const SORT_VALUE: Record<FriendsSortKey, (r: FriendRow) => number | null> = {
  username: () => 0,
  added: (r) => r.addedAt,
  first: (r) => r.firstAt,
  last: (r) => r.lastAt,
  recent: (r) => r.recent,
  total: (r) => r.total,
  sent: (r) => r.sent,
  received: (r) => r.received,
};

/**
 * A sorted copy of the rows. Rows with no value for the key (no date) always go last, whichever
 * the direction. Ties are broken by username ascending, so the order is the same on every run and
 * does not depend on the input order. An unknown key sorts by username.
 */
export function sortRows(rows: readonly FriendRow[], key: FriendsSortKey, direction: SortDirection = "asc"): FriendRow[] {
  const value = SORT_VALUE[key] ?? SORT_VALUE.username;
  const sign = direction === "desc" ? -1 : 1;
  if (key === "username") return rows.slice().sort((x, y) => sign * cmp(x.username, y.username));
  return rows.slice().sort((x, y) => {
    const a = value(x);
    const b = value(y);
    if (a === null || b === null) {
      if (a !== b) return a === null ? 1 : -1;
    } else if (a !== b) {
      return sign * (a - b);
    }
    return cmp(x.username, y.username);
  });
}

// ---------------------------------------------------------------- filtering ---

/** Inclusive epoch ms bounds. A row with no date never matches a range that has any bound. */
export interface DateRange {
  from?: number;
  to?: number;
}

export interface FriendsFilter {
  /** Case-insensitive start of the username. Empty or blank means no text filter. */
  prefix?: string;
  /** true: the flag must be set. false: it must not be. Left out: any. */
  quiet?: boolean;
  oneSided?: boolean;
  waiting?: boolean;
  /** Only people waiting on you or on them. */
  waitingOn?: "you" | "them";
  added?: DateRange;
  firstEvent?: DateRange;
  lastEvent?: DateRange;
}

function inRange(v: number | null, r: DateRange | undefined): boolean {
  if (!r) return true;
  const hasFrom = typeof r.from === "number" && Number.isFinite(r.from);
  const hasTo = typeof r.to === "number" && Number.isFinite(r.to);
  if (!hasFrom && !hasTo) return true;
  if (v === null) return false;
  return (!hasFrom || v >= (r.from as number)) && (!hasTo || v <= (r.to as number));
}

/** The rows that match every given condition, in their current order. */
export function filterRows(rows: readonly FriendRow[], filter: FriendsFilter): FriendRow[] {
  const prefix = normUser(filter.prefix ?? "");
  return rows.filter(
    (r) =>
      (prefix === "" || r.username.startsWith(prefix)) &&
      (filter.quiet === undefined || r.quiet === filter.quiet) &&
      (filter.oneSided === undefined || r.oneSided === filter.oneSided) &&
      (filter.waiting === undefined || r.waiting === filter.waiting) &&
      (filter.waitingOn === undefined || r.waitingOn === filter.waitingOn) &&
      inRange(r.addedAt, filter.added) &&
      inRange(r.firstAt, filter.firstEvent) &&
      inRange(r.lastAt, filter.lastEvent),
  );
}

// ---------------------------------------------------------------------- CSV ---

export const FRIENDS_CSV_HEADER = [
  "username",
  "added",
  "first_event",
  "last_event",
  "events_90_days",
  "events_total",
  "sent",
  "received",
  "unknown_direction",
  "quiet",
  "one_sided",
  "waiting_on",
] as const;

/**
 * One CSV cell. Text is neutralized first (see neutralizeCell): control and direction-changing characters are
 * replaced and a cell a spreadsheet could read as a formula (first character = + - @) gets a leading
 * apostrophe. The cell is quoted when it holds a comma or quote, with quotes doubled (RFC 4180).
 */
export function csvCell(value: string | number | boolean | null): string {
  if (value === null) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "yes" : "no";
  const safe = neutralizeCell(value);
  return /[",]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** The rows as CSV text: a header, then one line per row, CRLF line endings, a final CRLF. */
export function toCsv(rows: readonly FriendRow[]): string {
  const lines = [FRIENDS_CSV_HEADER.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.username,
        r.addedDay,
        r.firstDay,
        r.lastDay,
        r.recent,
        r.total,
        r.sent,
        r.received,
        r.unknown,
        r.quiet,
        r.oneSided,
        r.waitingOn ?? "",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}
