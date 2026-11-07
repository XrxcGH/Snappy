import { DAY_MS, normUser } from "../util.ts";

/**
 * Friendship anniversaries: which friendships reach a whole number of years soon.
 *
 * The date used is the friend record's createdAt. In an export that is when the connection was
 * created, which may not be the first time two people met (re-adds, account changes), so every
 * result that has upcoming rows carries the "export-date-caveat" note and the wording layer should
 * hedge ("about", "may be").
 *
 * Input: pass CURRENT friends only (parsed.friends.friends). The other friend lists in an export
 * (sent or pending requests, deleted friends, blocked) share the same record shape, but their dates
 * are request dates, so anniversaries computed from them would be wrong and must not be shown.
 *
 * Pure and deterministic: time is a parameter, nothing is read or logged, and usernames appear only
 * in the explicit `upcoming` and `milestones` rows, never in notes.
 *
 * Defaults, all overridable through AnniversaryOptions:
 *  - windowDays 30 (clamped to 0..366): today counts as day 0.
 *  - utcOffsetMinutes 0 (clamped to +-14 hours): the caller's local offset, so "today" and the
 *    creation day are both read as calendar days in that offset (day precision, no hours).
 *  - milestones 1, 2, 3, 5 and 10 years.
 *  - Feb 29 creations: the anniversary falls on Feb 29 in leap years and on Feb 28 otherwise
 *    (flagged with leapDayShifted so a caller can show it differently).
 *  - Duplicate usernames that differ only by case are merged; the earliest known date wins.
 *  - Entries with an empty or whitespace-only username are counted (invalidUsername) and skipped,
 *    so friends + duplicatesMerged + invalidUsername equals the input length.
 *  - Friends without a usable createdAt, or one after `now`, are counted and skipped.
 */

/** One CURRENT friend (from parsed.friends.friends only; never requests, deleted or blocked lists). */
export interface AnniversaryFriend {
  username: string;
  createdAt?: number;
}

export interface AnniversaryOptions {
  /** Current time, epoch ms. Required: core never reads a clock. */
  now: number;
  /** How far ahead to look, in days (default 30). */
  windowDays?: number;
  /** Caller's offset from UTC in minutes, e.g. -300 for UTC-5 (default 0). */
  utcOffsetMinutes?: number;
  /** Whole-year counts that are marked as milestones (default 1, 2, 3, 5, 10). */
  milestones?: readonly number[];
}

export interface AnniversaryRow {
  /** Normalised username. Only ever listed here, never in notes. */
  username: string;
  /** Number of years the friendship reaches on that day. */
  years: number;
  /** Local calendar day of the anniversary, "YYYY-MM-DD". */
  on: string;
  /** Whole days from today (0 = today). */
  daysUntil: number;
  /** True when `years` is one of the milestone counts. */
  milestone: boolean;
  /** True when a Feb 29 creation is shown on Feb 28 because that year has no Feb 29. */
  leapDayShifted: boolean;
}

export type AnniversaryNoteCode =
  | "export-date-caveat" // upcoming rows exist; the date is when the connection was created in the export
  | "created-at-missing" // params.count friends had no usable date and were skipped
  | "created-at-future" // params.count friends had a date after now and were skipped
  | "duplicate-usernames" // params.count extra entries merged (same name, different case)
  | "invalid-username" // params.count entries had an empty username and were skipped
  | "now-invalid"; // now was not a finite number; nothing was computed

export interface AnniversaryNote {
  code: AnniversaryNoteCode;
  params: Record<string, number>;
}

export interface AnniversaryCounts {
  /** Distinct friends after merging case duplicates. */
  friends: number;
  /** Friends with a usable, not-future date. */
  dated: number;
  missingDate: number;
  futureDate: number;
  duplicatesMerged: number;
  /** Entries skipped because the username was empty or only whitespace. */
  invalidUsername: number;
  upcoming: number;
  milestones: number;
}

export interface AnniversaryResult {
  windowDays: number;
  /** Upcoming anniversaries in the window, soonest first (then more years, then username). */
  upcoming: AnniversaryRow[];
  /** The subset of `upcoming` that falls on a milestone year, same order. */
  milestones: AnniversaryRow[];
  counts: AnniversaryCounts;
  notes: AnniversaryNote[];
}

const DEFAULT_WINDOW_DAYS = 30;
const MAX_WINDOW_DAYS = 366;
const MAX_OFFSET_MINUTES = 14 * 60;
const DEFAULT_MILESTONES: readonly number[] = [1, 2, 3, 5, 10];

const isLeap = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const pad = (n: number, w: number): string => String(n).padStart(w, "0");

function cmpKey(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Calendar day (month is 0-based) of `ms` as seen at the given UTC offset. */
function localDay(ms: number, offsetMinutes: number): { y: number; m: number; d: number } {
  const dt = new Date(ms + offsetMinutes * 60_000);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth(), d: dt.getUTCDate() };
}

function emptyResult(windowDays: number, notes: AnniversaryNote[]): AnniversaryResult {
  return {
    windowDays,
    upcoming: [],
    milestones: [],
    counts: { friends: 0, dated: 0, missingDate: 0, futureDate: 0, duplicatesMerged: 0, invalidUsername: 0, upcoming: 0, milestones: 0 },
    notes,
  };
}

/** Finds upcoming anniversaries. `friends` must be current friends only, see the header note. */
export function findAnniversaries(friends: readonly AnniversaryFriend[], opts: AnniversaryOptions): AnniversaryResult {
  // Infinity means "as far as allowed"; NaN and non-numbers fall back to the default.
  const wd =
    typeof opts.windowDays === "number" && !Number.isNaN(opts.windowDays)
      ? Math.floor(opts.windowDays)
      : DEFAULT_WINDOW_DAYS;
  const windowDays = clamp(wd, 0, MAX_WINDOW_DAYS);
  if (!Number.isFinite(opts.now)) return emptyResult(windowDays, [{ code: "now-invalid", params: {} }]);

  const offset = Number.isFinite(opts.utcOffsetMinutes)
    ? clamp(Math.round(opts.utcOffsetMinutes as number), -MAX_OFFSET_MINUTES, MAX_OFFSET_MINUTES)
    : 0;
  const milestoneSet = new Set(opts.milestones ?? DEFAULT_MILESTONES);

  // Merge case duplicates; keep the earliest usable date per person.
  const byUser = new Map<string, number | undefined>();
  let duplicatesMerged = 0;
  let invalidUsername = 0;
  for (const f of friends) {
    const key = normUser(f.username);
    if (key === "") {
      invalidUsername++;
      continue;
    }
    const at = typeof f.createdAt === "number" && Number.isFinite(f.createdAt) && f.createdAt > 0 ? f.createdAt : undefined;
    if (byUser.has(key)) {
      duplicatesMerged++;
      const prev = byUser.get(key);
      if (at !== undefined && (prev === undefined || at < prev)) byUser.set(key, at);
    } else {
      byUser.set(key, at);
    }
  }

  const today = localDay(opts.now, offset);
  const todayUtc = Date.UTC(today.y, today.m, today.d);
  const upcoming: AnniversaryRow[] = [];
  let dated = 0;
  let missingDate = 0;
  let futureDate = 0;

  for (const [username, createdAt] of byUser) {
    if (createdAt === undefined) {
      missingDate++;
      continue;
    }
    if (createdAt > opts.now) {
      futureDate++;
      continue;
    }
    dated++;
    const c = localDay(createdAt, offset);
    const leapBorn = c.m === 1 && c.d === 29;
    // First occurrence that is today or later, and at least one year after creation.
    for (let y = Math.max(today.y, c.y + 1); y <= today.y + 1; y++) {
      const shifted = leapBorn && !isLeap(y);
      const day = shifted ? 28 : c.d;
      const daysUntil = Math.round((Date.UTC(y, c.m, day) - todayUtc) / DAY_MS);
      if (daysUntil < 0) continue;
      if (daysUntil <= windowDays) {
        const years = y - c.y;
        upcoming.push({
          username,
          years,
          on: `${pad(y, 4)}-${pad(c.m + 1, 2)}-${pad(day, 2)}`,
          daysUntil,
          milestone: milestoneSet.has(years),
          leapDayShifted: shifted,
        });
      }
      break;
    }
  }

  upcoming.sort((a, b) => a.daysUntil - b.daysUntil || b.years - a.years || cmpKey(a.username, b.username));
  const milestones = upcoming.filter((r) => r.milestone);

  const notes: AnniversaryNote[] = [];
  if (upcoming.length > 0) notes.push({ code: "export-date-caveat", params: {} });
  if (missingDate > 0) notes.push({ code: "created-at-missing", params: { count: missingDate } });
  if (futureDate > 0) notes.push({ code: "created-at-future", params: { count: futureDate } });
  if (duplicatesMerged > 0) notes.push({ code: "duplicate-usernames", params: { count: duplicatesMerged } });
  if (invalidUsername > 0) notes.push({ code: "invalid-username", params: { count: invalidUsername } });

  return {
    windowDays,
    upcoming,
    milestones,
    counts: {
      friends: byUser.size,
      dated,
      missingDate,
      futureDate,
      duplicatesMerged,
      invalidUsername,
      upcoming: upcoming.length,
      milestones: milestones.length,
    },
    notes,
  };
}
