/**
 * Friend count over time, from two sources that are compared with each other:
 *
 *  1. The CURVE: every friend's `createdAt` is a +1 and every deleted friend's `deletedAt` is a -1.
 *  2. The SNAPSHOTS: the friend-list sizes recorded in the ledger (point-in-time, one per export or scan).
 *
 * Pure and deterministic: no clock (the caller passes `now`), no I/O, no logging. The result holds
 * counts, month labels and stable note codes only. It never contains a username, so there is
 * nothing here that could echo user data. The login history is not an input and is never read.
 *
 * What the curve can and cannot know (hedged on purpose):
 *  - It only knows people who appear in the friends or deleted-friends lists. Someone who removed
 *    you, or whose record aged out of the deleted list, is not subtracted, so the curve may run
 *    higher than the real count in earlier months.
 *  - A current friend (or a deleted one with a known deletion date) whose creation date is missing is
 *    assumed to have been a friend since before the first month: they are the series' `startingCount`.
 *  - A deleted friend with no usable deletion date has no known place on the curve and is left out.
 *  - A person listed as both a current friend and a deleted friend was probably added back: they
 *    count as a current friend.
 *
 * Defaults (all overridable through the options):
 *  - Dates before Jan 1, 2011 or after `now` are unusable (they are ignored and counted in a note).
 *  - The sources "disagree" at a snapshot when the curve differs from the snapshot's size by more than
 *    max(5 friends, 10% of the snapshot's size).
 *  - The "unusable dates" count is of bad date values, not of people: someone in both lists can add 2 or more.
 *  - A `now` past Dec 31, 9999 UTC is treated as that moment, so the series stays a sane length.
 *  - A threshold option that is not a finite number falls back to its default.
 *  - Best and worst months compare net change over COMPLETE months only (the month of `now` is partial),
 *    and only when it is above (best) or below (worst) zero. Ties go to the earlier month.
 */
import type { DeletedFriendRecord, FriendRecord, Ledger } from "../types.ts";
import { normUser } from "../util.ts";

/** Snapchat launched in 2011: an earlier date is a bad value, not history. */
const EARLIEST_PLAUSIBLE_MS = Date.UTC(2011, 0, 1);

export const DEFAULT_DISAGREE_MIN_GAP = 5;
export const DEFAULT_DISAGREE_FRACTION = 0.1;

/** The latest moment the month labels (4-digit years) can show; a later `now` is clamped to it. */
const LATEST_MS = Date.UTC(9999, 11, 31, 23, 59, 59, 999);

export interface FriendCountInput {
  /** Current friends (the parsed export's friends list). */
  friends: readonly FriendRecord[];
  /** Friends the user removed (the parsed export's deleted-friends list). */
  deletedFriends: readonly DeletedFriendRecord[];
  /** The decrypted ledger, if there is one. Only the snapshot sizes and times are used. */
  ledger?: Ledger;
  /** Epoch ms "now". Required: nothing in core reads the clock. */
  now: number;
}

export interface FriendCountOptions {
  /** Smallest gap, in friends, that counts as a disagreement. Default 5. */
  disagreeMinGap?: number;
  /** Gap as a share of the snapshot's size that counts as a disagreement. Default 0.1. */
  disagreeFraction?: number;
}

export interface FriendCountMonth {
  /** UTC month as "YYYY-MM". */
  month: string;
  /** Friendships that started this month (known dates only). */
  joined: number;
  /** Friends the user removed this month (known dates only). */
  left: number;
  /** joined - left. */
  net: number;
  /** The curve at the end of the month; null when no friendship has a usable date at all. */
  count: number | null;
  /** Size of the latest snapshot taken this month; null when there is none. */
  snapshotCount: number | null;
  /** True for the month of `now`: it is still going, so it is left out of best and worst. */
  partial: boolean;
}

export interface FriendCountMonthNet {
  month: string;
  net: number;
}

/** One snapshot set against the curve at the moment the snapshot was taken. */
export interface FriendCountComparison {
  takenAt: number;
  snapshotCount: number;
  curveCount: number;
  /** snapshotCount - curveCount: positive means the snapshot holds more friends than the curve shows. */
  gap: number;
  disagrees: boolean;
}

export type FriendCountNoteCode =
  | "no-dated-friendships" //     no friendship has a usable date, so there is no curve
  | "curve-may-run-high" //       people who left on their own are not on the curve
  | "undated-joins" //            {count}: assumed friends since before the first month
  | "undated-leaves" //           {count}: deleted friends left out of the curve
  | "unusable-dates-ignored" //   {count}: future or implausible dates
  | "leave-before-join" //        {count}: deleted before created; the deletion date was not used
  | "re-added-friends" //         {count}: listed as current and as deleted
  | "snapshots-ignored" //        {count}: snapshots with a missing, future or implausible time
  | "no-snapshots" //             nothing to compare with
  | "single-snapshot" //          one point only
  | "sources-agree" //            {compared}
  | "sources-disagree"; //        {compared, disagreeing, largestGap}

/** A stable machine code plus counts; the CLI and dashboard turn it into wording. */
export interface FriendCountNote {
  code: FriendCountNoteCode;
  params: Record<string, number>;
}

export interface FriendCountHistory {
  /** One row per month from the first month with data to the month of `now`, no gaps. Empty when there is no data. */
  months: FriendCountMonth[];
  /** Month with the highest net change above zero (complete months only), or null. */
  best: FriendCountMonthNet | null;
  /** Month with the lowest net change below zero (complete months only), or null. */
  worst: FriendCountMonthNet | null;
  totals: {
    joined: number;
    left: number;
    net: number;
    /** Friends assumed present before the first month (creation date unknown). */
    startingCount: number;
    /** The curve at `now`; null when there is no curve. */
    currentCount: number | null;
  };
  /** One entry per usable snapshot, oldest first. Empty when there are no dated friendships. */
  comparisons: FriendCountComparison[];
  notes: FriendCountNote[];
}

const monthIndex = (ms: number): number => {
  const d = new Date(ms);
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
};

const monthLabel = (index: number): string => {
  const year = Math.floor(index / 12);
  return `${String(year).padStart(4, "0")}-${String((index % 12) + 1).padStart(2, "0")}`;
};

/** Number of values <= x in an ascending array. */
function countUpTo(sorted: readonly number[], x: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid]! <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const earliest = (a: number | undefined, b: number | undefined): number | undefined =>
  a === undefined ? b : b === undefined ? a : Math.min(a, b);

interface Person {
  current: boolean;
  deleted: boolean;
  joinAt?: number;
  leaveAt?: number;
}

export function buildFriendCountHistory(input: FriendCountInput, options: FriendCountOptions = {}): FriendCountHistory {
  if (typeof input.now !== "number" || !Number.isFinite(input.now)) {
    throw new TypeError("buildFriendCountHistory: now must be a finite epoch ms value.");
  }
  const now = Math.min(input.now, LATEST_MS);
  const finiteOr = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
  const minGap = finiteOr(options.disagreeMinGap, DEFAULT_DISAGREE_MIN_GAP);
  const fraction = finiteOr(options.disagreeFraction, DEFAULT_DISAGREE_FRACTION);

  // A missing or garbled value is plainly undated; a future or pre-2011 one is counted as unusable.
  let unusableDates = 0;
  const usable = (v: unknown): number | undefined => {
    if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
    if (v < EARLIEST_PLAUSIBLE_MS || v > now) {
      unusableDates++;
      return undefined;
    }
    return v;
  };

  // ---- one entry per person (case-insensitive): earliest creation, latest deletion ----
  const people = new Map<string, Person>();
  const personFor = (name: unknown): Person | undefined => {
    if (typeof name !== "string") return undefined;
    const key = normUser(name);
    if (key === "") return undefined;
    let p = people.get(key);
    if (!p) people.set(key, (p = { current: false, deleted: false }));
    return p;
  };

  for (const rec of input.friends) {
    const p = personFor(rec.username);
    if (!p) continue;
    p.current = true;
    p.joinAt = earliest(p.joinAt, usable(rec.createdAt));
  }
  for (const rec of input.deletedFriends) {
    const p = personFor(rec.username);
    if (!p) continue;
    p.deleted = true;
    p.joinAt = earliest(p.joinAt, usable(rec.createdAt));
    const at = usable(rec.deletedAt);
    // The latest known deletion wins; an unknown time never erases a known one.
    if (at !== undefined) p.leaveAt = p.leaveAt === undefined ? at : Math.max(p.leaveAt, at);
  }

  // ---- the curve's events ----
  const joins: number[] = [];
  const leaves: number[] = [];
  let startingCount = 0;
  let undatedJoins = 0;
  let undatedLeaves = 0;
  let leaveBeforeJoin = 0;
  let reAdded = 0;
  const addJoin = (p: Person) => {
    if (p.joinAt === undefined) {
      undatedJoins++;
      startingCount++;
    } else joins.push(p.joinAt);
  };
  for (const p of people.values()) {
    if (p.current) {
      if (p.deleted) reAdded++;
      addJoin(p);
      continue;
    }
    // Deleted only. Without a deletion date there is no place for the departure: leave the person out.
    if (p.leaveAt === undefined) {
      undatedLeaves++;
      continue;
    }
    if (p.joinAt !== undefined && p.leaveAt < p.joinAt) {
      // Inconsistent dates: keep a plain join and do not use the deletion date.
      leaveBeforeJoin++;
      joins.push(p.joinAt);
      continue;
    }
    addJoin(p);
    leaves.push(p.leaveAt);
  }
  joins.sort((a, b) => a - b);
  leaves.sort((a, b) => a - b);
  const hasCurve = joins.length + leaves.length > 0;

  // ---- usable snapshots, oldest first (stable: ties keep ledger order) ----
  let ignoredSnapshots = 0;
  const snaps: { takenAt: number; size: number }[] = [];
  for (const s of input.ledger?.snapshots ?? []) {
    const t = s?.takenAt;
    if (typeof t !== "number" || !Number.isFinite(t) || t < EARLIEST_PLAUSIBLE_MS || t > now || !Array.isArray(s.friends)) {
      ignoredSnapshots++;
      continue;
    }
    const size = new Set(s.friends.map((f) => normUser(f)).filter((f) => f !== "")).size;
    snaps.push({ takenAt: t, size });
  }
  snaps.sort((a, b) => a.takenAt - b.takenAt);

  // ---- the monthly series ----
  const byMonth = new Map<number, { joined: number; left: number; snapshotCount: number | null }>();
  const row = (i: number) => {
    let r = byMonth.get(i);
    if (!r) byMonth.set(i, (r = { joined: 0, left: 0, snapshotCount: null }));
    return r;
  };
  for (const t of joins) row(monthIndex(t)).joined++;
  for (const t of leaves) row(monthIndex(t)).left++;
  for (const s of snaps) row(monthIndex(s.takenAt)).snapshotCount = s.size; // oldest first: the latest in a month wins

  const months: FriendCountMonth[] = [];
  const nowMonth = monthIndex(now);
  let totalJoined = 0;
  let totalLeft = 0;
  if (byMonth.size > 0) {
    let first = Infinity;
    for (const i of byMonth.keys()) if (i < first) first = i;
    let running = startingCount;
    for (let i = first; i <= nowMonth; i++) {
      const r = byMonth.get(i);
      const joined = r?.joined ?? 0;
      const left = r?.left ?? 0;
      running += joined - left;
      totalJoined += joined;
      totalLeft += left;
      months.push({
        month: monthLabel(i),
        joined,
        left,
        net: joined - left,
        count: hasCurve ? running : null,
        snapshotCount: r?.snapshotCount ?? null,
        partial: i === nowMonth,
      });
    }
  }

  // ---- best and worst (complete months with movement; strict comparison keeps the earlier month on a tie) ----
  let best: FriendCountMonthNet | null = null;
  let worst: FriendCountMonthNet | null = null;
  for (const m of months) {
    if (m.partial) continue;
    if (m.net > 0 && (best === null || m.net > best.net)) best = { month: m.month, net: m.net };
    if (m.net < 0 && (worst === null || m.net < worst.net)) worst = { month: m.month, net: m.net };
  }

  // ---- snapshots against the curve ----
  const comparisons: FriendCountComparison[] = [];
  if (hasCurve) {
    for (const s of snaps) {
      const curveCount = startingCount + countUpTo(joins, s.takenAt) - countUpTo(leaves, s.takenAt);
      const gap = s.size - curveCount;
      comparisons.push({
        takenAt: s.takenAt,
        snapshotCount: s.size,
        curveCount,
        gap,
        disagrees: Math.abs(gap) > Math.max(minGap, fraction * s.size),
      });
    }
  }

  // ---- notes (fixed order, so equal inputs give equal output) ----
  const notes: FriendCountNote[] = [];
  const note = (code: FriendCountNoteCode, params: Record<string, number> = {}) => notes.push({ code, params });
  note(hasCurve ? "curve-may-run-high" : "no-dated-friendships");
  if (undatedJoins > 0) note("undated-joins", { count: undatedJoins });
  if (undatedLeaves > 0) note("undated-leaves", { count: undatedLeaves });
  if (unusableDates > 0) note("unusable-dates-ignored", { count: unusableDates });
  if (leaveBeforeJoin > 0) note("leave-before-join", { count: leaveBeforeJoin });
  if (reAdded > 0) note("re-added-friends", { count: reAdded });
  if (ignoredSnapshots > 0) note("snapshots-ignored", { count: ignoredSnapshots });
  if (snaps.length === 0) note("no-snapshots");
  else if (snaps.length === 1) note("single-snapshot");
  if (comparisons.length > 0) {
    const disagreeing = comparisons.filter((c) => c.disagrees);
    if (disagreeing.length === 0) note("sources-agree", { compared: comparisons.length });
    else {
      let largestGap = 0;
      for (const c of disagreeing) largestGap = Math.max(largestGap, Math.abs(c.gap));
      note("sources-disagree", { compared: comparisons.length, disagreeing: disagreeing.length, largestGap });
    }
  }

  return {
    months,
    best,
    worst,
    totals: {
      joined: totalJoined,
      left: totalLeft,
      net: totalJoined - totalLeft,
      startingCount,
      currentCount: hasCurve ? startingCount + totalJoined - totalLeft : null,
    },
    comparisons,
    notes,
  };
}
