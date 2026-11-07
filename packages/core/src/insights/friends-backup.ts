/**
 * Friends backup: a portable, versioned copy of the friends list (plus the blocked and ignored
 * lists) and a check that compares a backup with the current friends.
 *
 * Privacy: a backup holds only normalised usernames and, when known, the friendship's creation
 * time. It is plain data. The caller serializes it (`backupToJson`, `backupToRows`) and may seal
 * the JSON text with `sealText` from ledger/seal.ts. Nothing here reads a clock, a file or the
 * network, and no note or parse error ever contains a username or any input text: usernames
 * appear only in the explicit list fields of a backup or of a comparison.
 *
 * Defaults (all documented where they are used):
 *  - Usernames are normalised with `normUser` and dropped when empty or longer than
 *    MAX_USERNAME_LENGTH. Names that differ only by case are one entry.
 *  - Each list holds at most MAX_BACKUP_ENTRIES entries; the parser reads at most
 *    MAX_BACKUP_CHARS characters of text.
 *  - A creation time must be a positive finite number of epoch ms and not later than `now`.
 */
import type { FriendRecord } from "../types.ts";
import { MAX_USERNAME_LENGTH, normUser } from "../util.ts";

export const BACKUP_FORMAT = "snappy-friends-backup";
export const BACKUP_VERSION = 1;
/** Per list. Snapchat's own friend limit is a small fraction of this. */
export const MAX_BACKUP_ENTRIES = 100_000;
/** Longest text the parser accepts (about 10 MB); a full backup of 100,000 friends is well under it. */
export const MAX_BACKUP_CHARS = 10_000_000;

export type BackupListName = "friends" | "blocked" | "ignored";
const LISTS: readonly BackupListName[] = ["friends", "blocked", "ignored"];

export interface BackupEntry {
  /** Normalised username. */
  username: string;
  /** When the friendship or request was created, epoch ms; omitted when unknown. */
  createdAt?: number;
}

export interface FriendsBackup {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  /** When the backup was made (the caller's `now`), epoch ms; null when the caller gave no usable time. */
  takenAt: number | null;
  /** Each list is sorted by username and holds no duplicates. */
  friends: BackupEntry[];
  blocked: BackupEntry[];
  ignored: BackupEntry[];
}

export type BackupNoteCode =
  | "usernames-skipped" // params.count: empty, too long or not text
  | "duplicates-merged" // params.count: same name repeated or in a different case
  | "timestamps-invalid" // params.count: dropped, not a positive finite number
  | "timestamps-in-future" // params.count: dropped, later than now
  | "entries-over-limit" // params.count: left out, more than MAX_BACKUP_ENTRIES in a list
  | "lists-overlap" // params.count: names in both the friends list and the blocked list
  | "friends-empty" // no params
  | "time-unknown"; // no params

/** A stable machine code with counts; the CLI and dashboard turn it into wording. */
export interface BackupNote {
  code: BackupNoteCode;
  params: Record<string, number>;
}

/** What a backup is made from. `ParsedFriends` from the export parser fits (extra fields are ignored). */
export interface BackupSource {
  friends: readonly Pick<FriendRecord, "username" | "createdAt">[];
  blocked?: readonly Pick<FriendRecord, "username" | "createdAt">[];
  ignored?: readonly Pick<FriendRecord, "username" | "createdAt">[];
}

// ------------------------------------------------------------------ create ---

type CountedCode = Extract<BackupNoteCode, "usernames-skipped" | "duplicates-merged" | "timestamps-invalid" | "timestamps-in-future" | "entries-over-limit">;
const COUNTED_CODES: readonly CountedCode[] = ["usernames-skipped", "duplicates-merged", "timestamps-invalid", "timestamps-in-future", "entries-over-limit"];

type Counter = Map<CountedCode, number>;
const bump = (c: Counter, code: CountedCode, n = 1) => c.set(code, (c.get(code) ?? 0) + n);

/**
 * The one rule for every stored time: truncate to whole epoch ms first, then require it to be
 * positive. Used on create and on parse, so a backup always round-trips to the same value.
 */
const wholeTime = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && Math.trunc(v) > 0 ? Math.trunc(v) : undefined);

/** Compare by UTF-16 code units: the same order on every machine and locale. */
const byName = (a: BackupEntry, b: BackupEntry) => (a.username < b.username ? -1 : a.username > b.username ? 1 : 0);

/**
 * Normalise one untrusted list: clean names, merge duplicates (keeping the earliest known time),
 * sort, and cap at `cap`. `now` is undefined when the future check should be skipped.
 */
function cleanList(items: readonly unknown[], now: number | undefined, counter: Counter, cap = MAX_BACKUP_ENTRIES): BackupEntry[] {
  const byUser = new Map<string, number | undefined>();
  for (const item of items) {
    const rawName = typeof item === "string" ? item : isRecord(item) ? item.username : undefined;
    const username = typeof rawName === "string" ? normUser(rawName) : "";
    if (username === "" || username.length > MAX_USERNAME_LENGTH) {
      bump(counter, "usernames-skipped");
      continue;
    }
    let createdAt: number | undefined;
    const rawTime = isRecord(item) ? item.createdAt : undefined;
    if (rawTime !== undefined && rawTime !== null) {
      const t = wholeTime(rawTime);
      if (t === undefined) bump(counter, "timestamps-invalid");
      else if (now !== undefined && t > now) bump(counter, "timestamps-in-future");
      else createdAt = t;
    }
    if (byUser.has(username)) {
      bump(counter, "duplicates-merged");
      const known = byUser.get(username);
      if (createdAt !== undefined && (known === undefined || createdAt < known)) byUser.set(username, createdAt);
    } else {
      byUser.set(username, createdAt);
    }
  }
  const entries: BackupEntry[] = [];
  for (const [username, createdAt] of byUser) entries.push(createdAt === undefined ? { username } : { username, createdAt });
  entries.sort(byName);
  if (entries.length > cap) {
    bump(counter, "entries-over-limit", entries.length - cap);
    entries.length = cap;
  }
  return entries;
}

function countOverlap(a: readonly BackupEntry[], b: readonly BackupEntry[]): number {
  const names = new Set(a.map((e) => e.username));
  let n = 0;
  for (const e of b) if (names.has(e.username)) n++;
  return n;
}

function finishNotes(backup: FriendsBackup, counter: Counter): BackupNote[] {
  const notes: BackupNote[] = COUNTED_CODES.filter((c) => counter.has(c)).map((code) => ({ code, params: { count: counter.get(code)! } }));
  const shared = countOverlap(backup.friends, backup.blocked);
  if (shared > 0) notes.push({ code: "lists-overlap", params: { count: shared } });
  if (backup.friends.length === 0) notes.push({ code: "friends-empty", params: {} });
  if (backup.takenAt === null) notes.push({ code: "time-unknown", params: {} });
  return notes;
}

/**
 * Build a backup. `now` (epoch ms) is the time it is made; creation times later than `now` are
 * dropped. `now` is truncated to whole ms; a zero, negative or non-finite `now` counts as unknown
 * (`takenAt` is null and the future check is skipped). The result is deterministic: the same input always gives the same backup.
 */
export function createFriendsBackup(source: BackupSource, now: number): { backup: FriendsBackup; notes: BackupNote[] } {
  const counter: Counter = new Map();
  const at = wholeTime(now);
  const backup: FriendsBackup = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    takenAt: at ?? null,
    friends: cleanList(source.friends ?? [], at, counter),
    blocked: cleanList(source.blocked ?? [], at, counter),
    ignored: cleanList(source.ignored ?? [], at, counter),
  };
  return { backup, notes: finishNotes(backup, counter) };
}

// ----------------------------------------------------------- serialization ---

/**
 * The exact JSON text of a backup: compact, with a fixed key order, so the same backup always
 * produces the same bytes. Only contract fields are written. Seal it with `sealText` if wanted.
 */
export function backupToJson(backup: FriendsBackup): string {
  const entry = (e: BackupEntry) => (e.createdAt === undefined ? { username: e.username } : { username: e.username, createdAt: e.createdAt });
  return JSON.stringify({
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    takenAt: backup.takenAt,
    friends: backup.friends.map(entry),
    blocked: backup.blocked.map(entry),
    ignored: backup.ignored.map(entry),
  });
}

/** One flat row per entry (friends, then blocked, then ignored), ready for a CSV or a text list. */
export function backupToRows(backup: FriendsBackup): { list: BackupListName; username: string; createdAt: number | null }[] {
  return LISTS.flatMap((list) => backup[list].map((e) => ({ list, username: e.username, createdAt: e.createdAt ?? null })));
}

// ------------------------------------------------------------------- parse ---

/** Why text was rejected. Never includes any of the text. */
export type BackupParseError =
  | "too-large" // longer than MAX_BACKUP_CHARS
  | "not-json"
  | "not-a-backup" // JSON, but not this format or the wrong shape
  | "unsupported-version" // a backup from a version this one cannot read safely
  | "too-many-entries"; // a list with more than MAX_BACKUP_ENTRIES entries

export type BackupParseResult = { ok: true; backup: FriendsBackup; notes: BackupNote[] } | { ok: false; error: BackupParseError };

/**
 * Read backup text. Rejects what is oversized or malformed and says only which kind of problem it
 * was. Inside a valid backup, single bad entries are skipped and counted in the notes (the same
 * cleaning as `createFriendsBackup`, so a parsed backup is always in canonical form). The
 * `friends` list is required; `blocked` and `ignored` default to empty. Pass `now` to also drop
 * creation times that lie in the future.
 */
export function parseFriendsBackup(text: unknown, opts: { now?: number } = {}): BackupParseResult {
  if (typeof text !== "string") return { ok: false, error: "not-a-backup" };
  if (text.length > MAX_BACKUP_CHARS) return { ok: false, error: "too-large" };
  let raw: unknown;
  try {
    raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    return { ok: false, error: "not-json" };
  }
  if (!isRecord(raw) || raw.format !== BACKUP_FORMAT || typeof raw.version !== "number") return { ok: false, error: "not-a-backup" };
  if (raw.version !== BACKUP_VERSION) return { ok: false, error: "unsupported-version" };

  const lists: Partial<Record<BackupListName, unknown[]>> = {};
  for (const name of LISTS) {
    const value = raw[name];
    if (value === undefined && name !== "friends") continue;
    if (!Array.isArray(value)) return { ok: false, error: "not-a-backup" };
    if (value.length > MAX_BACKUP_ENTRIES) return { ok: false, error: "too-many-entries" };
    lists[name] = value;
  }

  const counter: Counter = new Map();
  const now = wholeTime(opts.now);
  const takenAt = wholeTime(raw.takenAt) ?? null;
  const backup: FriendsBackup = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    takenAt,
    friends: cleanList(lists.friends ?? [], now, counter),
    blocked: cleanList(lists.blocked ?? [], now, counter),
    ignored: cleanList(lists.ignored ?? [], now, counter),
  };
  return { ok: true, backup, notes: finishNotes(backup, counter) };
}

// ------------------------------------------------------------------ verify ---

/** The difference for one list. `added` and `removed` are relative to the backup. */
export interface ListComparison {
  /** In the current list but not in the backup (new since the backup). Sorted. */
  added: string[];
  /** In the backup but not in the current list (what a restore would bring back). Sorted. */
  removed: string[];
  /** In both. Sorted. */
  unchanged: string[];
  counts: { backup: number; current: number; added: number; removed: number; unchanged: number };
}

export type ComparisonNoteCode =
  | "current-empty" // params.backup: the current friends list is empty but the backup is not, so it may be the wrong list
  | "usernames-skipped" // params.count: current names left out (empty, too long or not text), so they are not compared
  | "many-removed"; // params.removed, params.backup: at least half of 10 or more backed-up friends are missing now

export interface ComparisonNote {
  code: ComparisonNoteCode;
  params: Record<string, number>;
}

export interface BackupComparison {
  friends: ListComparison;
  /** Null when the caller did not supply the current list, so nothing is called removed by mistake. */
  blocked: ListComparison | null;
  ignored: ListComparison | null;
  /** True when every supplied list matches the backup exactly. */
  identical: boolean;
  notes: ComparisonNote[];
}

function compareList(backupList: readonly BackupEntry[], current: readonly unknown[], skipped: Counter): ListComparison {
  // No cap on either side: a long list must not look like missing or new friends. The backup is
  // cleaned again (cheap, linear) so a hand-built one with mixed case or repeats still compares right.
  const backup = cleanList(backupList ?? [], undefined, new Map(), Infinity);
  const cleaned = cleanList(current, undefined, skipped, Infinity);
  const have = new Set(backup.map((e) => e.username));
  const now = new Set(cleaned.map((e) => e.username));
  const added = cleaned.filter((e) => !have.has(e.username)).map((e) => e.username);
  const removed = backup.filter((e) => !now.has(e.username)).map((e) => e.username);
  const unchanged = backup.filter((e) => now.has(e.username)).map((e) => e.username);
  return {
    added,
    removed,
    unchanged,
    counts: { backup: backup.length, current: cleaned.length, added: added.length, removed: removed.length, unchanged: unchanged.length },
  };
}

/**
 * Compare a backup with the current lists. The backup is cleaned again, so it need not come from
 * `createFriendsBackup` or `parseFriendsBackup`. The current friends are required; blocked and ignored
 * are compared only when supplied. Current names go through the same cleaning as a backup, so
 * case and stray spaces do not count as a difference; names that cannot be used are counted in a
 * `usernames-skipped` note. Set lookups keep it linear, and the result
 * lists come out sorted, so it is deterministic.
 */
export function compareFriendsBackup(backup: FriendsBackup, current: BackupSource): BackupComparison {
  const skipped: Counter = new Map();
  const friends = compareList(backup.friends, current.friends ?? [], skipped);
  const blocked = current.blocked ? compareList(backup.blocked, current.blocked, skipped) : null;
  const ignored = current.ignored ? compareList(backup.ignored, current.ignored, skipped) : null;

  const notes: ComparisonNote[] = [];
  const skippedCount = skipped.get("usernames-skipped") ?? 0;
  if (skippedCount > 0) notes.push({ code: "usernames-skipped", params: { count: skippedCount } });
  const { backup: inBackup, current: inCurrent, removed } = friends.counts;
  if (inCurrent === 0 && inBackup > 0) notes.push({ code: "current-empty", params: { backup: inBackup } });
  if (inBackup >= 10 && removed * 2 >= inBackup) notes.push({ code: "many-removed", params: { removed, backup: inBackup } });

  const same = (c: ListComparison | null) => c === null || (c.counts.added === 0 && c.counts.removed === 0);
  return { friends, blocked, ignored, identical: same(friends) && same(blocked) && same(ignored), notes };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
