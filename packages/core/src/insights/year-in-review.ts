/**
 * Year in review: an aggregate-only summary of one calendar year of Snap and chat activity,
 * friend changes and Memories.
 *
 * Privacy: the inputs are only a direction, a kind and a time per chat or Snap event, a date per
 * friend and per removed friend, and a date and media type per Memory. No username, conversation,
 * id, path or link is read, so the result cannot hold any per-person data. Notes carry a stable code
 * plus numbers only (never text, never user data).
 *
 * Pure and deterministic: no clock (take `now`), no randomness, no input-order dependence. Two
 * passes over each list and fixed-size typed arrays (12 months, up to 366 days), so 10,000+ items
 * are fast.
 *
 * Defaults (all documented here, none hidden):
 *  - year: the latest calendar year (in the chosen offset) that has any usable date in any section.
 *    A `year` option outside 1969..2200 or not a whole number is ignored and noted.
 *  - utcOffsetMinutes: 0 (UTC). Valid range is -720..840; other values are clamped and noted.
 *    Fractional minutes are rounded. A non-finite offset means 0 (noted). The year, months and days
 *    all follow this one fixed offset (daylight saving time is not followed).
 *  - A time that is missing, not finite, at or before 0 or after year 2200 is "undated"; a time
 *    after `now` is "future". Both are only counted (for events, friends, removals and Memories
 *    together) and never used.
 *  - Activity means chat and Snap events only. Direction "unknown" (or anything unrecognized) still
 *    counts as activity. A Snap is an event whose kind is IMAGE or VIDEO (any case); every other
 *    kind is a saved chat. The export keeps saved chats only, so chat counts may be lower than
 *    what was really sent.
 *  - Busiest month and busiest day: ties go to the earliest; `ties` says how many other months or
 *    days share the count.
 *  - Longest quiet gap: the longest run of whole calendar days with no activity between two active
 *    days of the year. Time before the first and after the last activity of the year is not a gap
 *    (the account or the export may simply not cover it). Null under two active days, or when every
 *    active day is followed by another.
 *  - New friends: current friends whose friendship date is in the year. A person added and removed
 *    later is not in the current friends list, so this can undercount. Friends removed: removed
 *    friends whose deletion date is in the year (it may be guessed by the parser).
 *  - Memories are placed by capture date, not by the day they were saved.
 *  - A section with no usable date anywhere is null (never invented) and a note says so. A section
 *    that has dates but none in the year is zero.
 */
import { MAX_EVENT_TIME } from "./habits.ts";

// ------------------------------------------------------------------ types ---

/** The only fields read of a chat or Snap event. A ChatEvent fits as is; extra fields are never copied. */
export interface YearEvent {
  direction?: "sent" | "received" | "unknown" | string | null;
  /** Upper-cased, as exported: "IMAGE" or "VIDEO" for a Snap, anything else for a saved chat. */
  kind?: string | null;
  /** Epoch ms. Missing or invalid means "undated". */
  at?: number | null;
}

/** The only field read of a friend. A FriendRecord fits as is. */
export interface YearFriend {
  /** When the friendship was created, epoch ms. */
  createdAt?: number | null;
}

/** The only field read of a removed friend. A DeletedFriendRecord fits as is. */
export interface YearRemovedFriend {
  /** When the user removed the friend, epoch ms. */
  deletedAt?: number | null;
}

/** The only fields read of a Memory. A MemoryItem fits as is. */
export interface YearMemory {
  /** Capture date, epoch ms. Null or missing means "undated". */
  date?: number | null;
  mediaType?: "image" | "video" | "unknown" | string | null;
}

/**
 * Every part is optional: leave one out and its section is reported missing.
 * From a parsed export: { chats: p.chats, friends: p.friends.friends, deletedFriends: p.friends.deletedFriends, memories: p.memories }.
 */
export interface YearInput {
  chats?: readonly YearEvent[];
  friends?: readonly YearFriend[];
  deletedFriends?: readonly YearRemovedFriend[];
  memories?: readonly YearMemory[];
}

export interface YearOptions {
  /** Epoch ms "now" (injected for determinism). Dates after it are not used. */
  now: number;
  /** Calendar year to summarize (e.g. 2025). Default: the latest year with data. */
  year?: number;
  /** Minutes east of UTC for month and day boundaries. Default 0. */
  utcOffsetMinutes?: number;
}

export interface DirectionCounts {
  total: number;
  sent: number;
  received: number;
  unknown: number;
}

export interface YearPeak<K> {
  key: K;
  count: number;
  /** count divided by the year's activity, 0..1. */
  share: number;
  /** Number of other months or days with the same count. */
  ties: number;
}

export interface YearMonthActivity extends DirectionCounts {
  /** 1 is January .. 12 is December. */
  month: number;
}

export interface QuietGap {
  /** Whole quiet days in a row. */
  days: number;
  /** First and last quiet day, "YYYY-MM-DD" in the chosen offset. */
  startDay: string;
  endDay: string;
}

export interface YearActivity {
  /** Snaps and saved chats together. */
  total: DirectionCounts;
  snaps: DirectionCounts;
  chats: DirectionCounts;
  /** Always 12 rows, month 1..12. */
  byMonth: YearMonthActivity[];
  busiestMonth: YearPeak<number> | null;
  /** key is "YYYY-MM-DD" in the chosen offset. */
  busiestDay: YearPeak<string> | null;
  longestQuietGap: QuietGap | null;
  /** Distinct calendar days of the year with at least one event. */
  activeDays: number;
  /** Epoch ms of the first and last event of the year; null with no events. */
  first: number | null;
  last: number | null;
  /** The same as "YYYY-MM-DD" in the chosen offset. */
  firstDay: string | null;
  lastDay: string | null;
}

export interface YearMemoryCounts {
  total: number;
  image: number;
  video: number;
  unknown: number;
}

export interface YearMemoryMonth extends YearMemoryCounts {
  /** 1 is January .. 12 is December. */
  month: number;
}

export interface YearMemories extends YearMemoryCounts {
  /** Always 12 rows, month 1..12. */
  byMonth: YearMemoryMonth[];
}

export type YearNoteCode =
  | "no-data" // params: none (no usable date in any section, so there is no year)
  | "year-invalid" // params: none (the year option was ignored)
  | "no-activity-data" // params: none (no usable chat or Snap time anywhere)
  | "no-friend-dates" // params: none (no friend has a usable date)
  | "no-removal-dates" // params: none (no removed friend has a usable date)
  | "no-memories" // params: none (no Memory has a usable date)
  | "no-activity-in-year" // params: year
  | "few-events" // params: count (activity under FEW_EVENTS in the year)
  | "many-unknown-direction" // params: count, percent
  | "year-in-progress" // params: year (the year is not over at `now`)
  | "undated-skipped" // params: count
  | "future-skipped" // params: count
  | "offset-adjusted"; // params: minutes (the offset actually used)

export interface YearNote {
  code: YearNoteCode;
  params: Record<string, number>;
}

export interface YearInReviewResult {
  /** The year summarized; null when there is no usable date at all. */
  year: number | null;
  yearSource: "given" | "latest" | "none";
  utcOffsetMinutes: number;
  /** True when `now` falls inside the year, so it is not complete. */
  inProgress: boolean;
  /** Null when no chat or Snap has a usable time. */
  activity: YearActivity | null;
  friends: {
    /** Null when no friend has a usable date. */
    added: number | null;
    /** Null when no removed friend has a usable date. */
    removed: number | null;
  };
  /** Null when no Memory has a usable date. */
  memories: YearMemories | null;
  /** Entries (of every list) that were left out for having no usable date, or a date after now. */
  skipped: { undated: number; future: number };
  notes: YearNote[];
}

/** Under this many events in the year the summary is noted as thin. */
export const FEW_EVENTS = 30;
/** Above this share of unknown direction the sent and received split is noted as unreliable. */
export const MANY_UNKNOWN_SHARE = 0.5;

const MIN_YEAR = 1969; // a time just after the epoch, shifted west, lands here
const MAX_YEAR = 2200;
const MIN_OFFSET = -720;
const MAX_OFFSET = 840;
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

// ---------------------------------------------------------------- helpers ---

/** 0 usable, 1 undated, 2 future. */
function timeState(t: unknown, now: number): 0 | 1 | 2 {
  if (typeof t !== "number" || !Number.isFinite(t) || t <= 0 || t > MAX_EVENT_TIME) return 1;
  return t <= now ? 0 : 2;
}

/** The offset to use and whether it differs from what the caller passed. */
function resolveOffset(requested: number | undefined): { minutes: number; adjusted: boolean } {
  if (requested === undefined) return { minutes: 0, adjusted: false };
  if (!Number.isFinite(requested)) return { minutes: 0, adjusted: true };
  const minutes = Math.min(MAX_OFFSET, Math.max(MIN_OFFSET, Math.round(requested)));
  return { minutes, adjusted: minutes !== requested };
}

/** "YYYY-MM-DD" of a day number counted from 1970-01-01. */
function dayLabel(dayNumber: number): string {
  const d = new Date(dayNumber * DAY_MS);
  const p = (n: number, w: number) => String(n).padStart(w, "0");
  return `${p(d.getUTCFullYear(), 4)}-${p(d.getUTCMonth() + 1, 2)}-${p(d.getUTCDate(), 2)}`;
}

/** The first index with the highest count (earliest wins ties), or null when nothing was counted. */
function peakIndex(counts: ArrayLike<number>, used: number): { index: number; count: number; ties: number; share: number } | null {
  if (used === 0) return null;
  let best = 0;
  for (let i = 1; i < counts.length; i++) if (counts[i]! > counts[best]!) best = i;
  const count = counts[best]!;
  let ties = 0;
  for (let i = 0; i < counts.length; i++) if (i !== best && counts[i] === count) ties++;
  return { index: best, count, ties, share: count / used };
}

function isSnapKind(kind: unknown): boolean {
  if (typeof kind !== "string") return false;
  if (kind === "IMAGE" || kind === "VIDEO") return true;
  const k = kind.trim().toUpperCase();
  return k === "IMAGE" || k === "VIDEO";
}

/** Counts are laid out as [sent, received, unknown] per row. */
function directionCounts(counts: Uint32Array, row: number): DirectionCounts {
  const sent = counts[row * 3]!;
  const received = counts[row * 3 + 1]!;
  const unknown = counts[row * 3 + 2]!;
  return { total: sent + received + unknown, sent, received, unknown };
}

// ------------------------------------------------------------------- main ---

export function computeYearInReview(input: YearInput, options: YearOptions): YearInReviewResult {
  const notes: YearNote[] = [];
  const { minutes: offset, adjusted } = resolveOffset(options.utcOffsetMinutes);
  const offsetMs = offset * MINUTE_MS;
  const now = options.now;
  const chats = input.chats ?? [];
  const friends = input.friends ?? [];
  const removed = input.deletedFriends ?? [];
  const memories = input.memories ?? [];

  // Pass 1: count what is unusable, and find what each section has and the latest time of all.
  const skipped = { undated: 0, future: 0 };
  let latest = -Infinity;
  const usableIn = { chats: 0, friends: 0, removed: 0, memories: 0 };
  const scan = <T>(list: readonly T[], pick: (item: T) => unknown, key: keyof typeof usableIn): void => {
    for (let i = 0; i < list.length; i++) {
      const t = pick(list[i]!);
      const state = timeState(t, now);
      if (state === 1) skipped.undated++;
      else if (state === 2) skipped.future++;
      else {
        usableIn[key]++;
        if ((t as number) > latest) latest = t as number;
      }
    }
  };
  scan(chats, (e) => e?.at, "chats");
  scan(friends, (f) => f?.createdAt, "friends");
  scan(removed, (f) => f?.deletedAt, "removed");
  scan(memories, (m) => m?.date, "memories");
  const anyData = usableIn.chats + usableIn.friends + usableIn.removed + usableIn.memories > 0;

  // The year: the one asked for if it is valid, else the latest with data.
  let year: number | null = null;
  let yearSource: YearInReviewResult["yearSource"] = "none";
  const asked = options.year;
  if (asked !== undefined) {
    if (typeof asked === "number" && Number.isInteger(asked) && asked >= MIN_YEAR && asked <= MAX_YEAR) {
      year = asked;
      yearSource = "given";
    } else notes.push({ code: "year-invalid", params: {} });
  }
  if (year === null && anyData) {
    year = new Date(latest + offsetMs).getUTCFullYear();
    yearSource = "latest";
  }

  if (year === null) {
    notes.push({ code: "no-data", params: {} });
    pushCommonNotes(notes, skipped, adjusted, offset);
    return {
      year: null,
      yearSource: "none",
      utcOffsetMinutes: offset,
      inProgress: false,
      activity: null,
      friends: { added: null, removed: null },
      memories: null,
      skipped,
      notes,
    };
  }

  // Pass 2: count inside the year. Day 0 is Jan 1 of the year in the chosen offset.
  const yearStart = Date.UTC(year, 0, 1);
  const yearEnd = Date.UTC(year + 1, 0, 1);
  const yearStartDay = yearStart / DAY_MS;
  const dayCount = (yearEnd - yearStart) / DAY_MS; // 365 or 366
  const monthOfDay = new Uint8Array(dayCount);
  for (let m = 0; m < 12; m++) {
    const from = (Date.UTC(year, m, 1) - yearStart) / DAY_MS;
    const to = (Date.UTC(year, m + 1, 1) - yearStart) / DAY_MS;
    monthOfDay.fill(m, from, to);
  }
  const inProgress = now + offsetMs >= yearStart && now + offsetMs < yearEnd;

  const typeDir = new Uint32Array(2 * 3); // row 0 chats, row 1 snaps
  const monthDir = new Uint32Array(12 * 3);
  const dayTotals = new Uint32Array(dayCount);
  let first: number | null = null;
  let last: number | null = null;
  let total = 0;
  for (let i = 0; i < chats.length; i++) {
    const e = chats[i];
    const at = e?.at;
    if (timeState(at, now) !== 0) continue;
    const shifted = (at as number) + offsetMs;
    if (shifted < yearStart || shifted >= yearEnd) continue;
    const day = Math.floor((shifted - yearStart) / DAY_MS);
    const direction = e?.direction;
    const d = direction === "sent" ? 0 : direction === "received" ? 1 : 2;
    typeDir[(isSnapKind(e?.kind) ? 3 : 0) + d]!++;
    monthDir[monthOfDay[day]! * 3 + d]!++;
    dayTotals[day]!++;
    total++;
    if (first === null || (at as number) < first) first = at as number;
    if (last === null || (at as number) > last) last = at as number;
  }

  let added = 0;
  for (let i = 0; i < friends.length; i++) {
    const t = friends[i]?.createdAt;
    if (timeState(t, now) !== 0) continue;
    const shifted = (t as number) + offsetMs;
    if (shifted >= yearStart && shifted < yearEnd) added++;
  }
  let removedCount = 0;
  for (let i = 0; i < removed.length; i++) {
    const t = removed[i]?.deletedAt;
    if (timeState(t, now) !== 0) continue;
    const shifted = (t as number) + offsetMs;
    if (shifted >= yearStart && shifted < yearEnd) removedCount++;
  }

  const memoryMonth = new Uint32Array(12 * 3); // image, video, unknown per month
  for (let i = 0; i < memories.length; i++) {
    const m = memories[i];
    const t = m?.date;
    if (timeState(t, now) !== 0) continue;
    const shifted = (t as number) + offsetMs;
    if (shifted < yearStart || shifted >= yearEnd) continue;
    const month = monthOfDay[Math.floor((shifted - yearStart) / DAY_MS)]!;
    const type = m?.mediaType === "image" ? 0 : m?.mediaType === "video" ? 1 : 2;
    memoryMonth[month * 3 + type]!++;
  }

  // Activity.
  let activity: YearActivity | null = null;
  if (usableIn.chats > 0) {
    const byMonth: YearMonthActivity[] = Array.from({ length: 12 }, (_, m) => ({ month: m + 1, ...directionCounts(monthDir, m) }));
    const monthTotals = byMonth.map((r) => r.total);
    const monthPeak = peakIndex(monthTotals, total);
    const dayPeak = peakIndex(dayTotals, total);
    let activeDays = 0;
    let gapDays = 0;
    let gapFrom = -1;
    let previous = -1;
    for (let d = 0; d < dayCount; d++) {
      if (dayTotals[d] === 0) continue;
      activeDays++;
      const quiet = d - previous - 1;
      if (previous >= 0 && quiet > gapDays) {
        gapDays = quiet;
        gapFrom = previous + 1;
      }
      previous = d;
    }
    activity = {
      total: sumCounts(directionCounts(typeDir, 0), directionCounts(typeDir, 1)),
      snaps: directionCounts(typeDir, 1),
      chats: directionCounts(typeDir, 0),
      byMonth,
      busiestMonth: monthPeak && { key: monthPeak.index + 1, count: monthPeak.count, share: monthPeak.share, ties: monthPeak.ties },
      busiestDay: dayPeak && { key: dayLabel(yearStartDay + dayPeak.index), count: dayPeak.count, share: dayPeak.share, ties: dayPeak.ties },
      longestQuietGap:
        gapDays > 0
          ? { days: gapDays, startDay: dayLabel(yearStartDay + gapFrom), endDay: dayLabel(yearStartDay + gapFrom + gapDays - 1) }
          : null,
      activeDays,
      first,
      last,
      firstDay: first === null ? null : dayLabel(Math.floor((first + offsetMs) / DAY_MS)),
      lastDay: last === null ? null : dayLabel(Math.floor((last + offsetMs) / DAY_MS)),
    };
  }

  // Memories.
  let memoriesResult: YearMemories | null = null;
  if (usableIn.memories > 0) {
    const byMonth: YearMemoryMonth[] = Array.from({ length: 12 }, (_, m) => {
      const image = memoryMonth[m * 3]!;
      const video = memoryMonth[m * 3 + 1]!;
      const unknown = memoryMonth[m * 3 + 2]!;
      return { month: m + 1, total: image + video + unknown, image, video, unknown };
    });
    const sum = (k: "image" | "video" | "unknown") => byMonth.reduce((s, r) => s + r[k], 0);
    const image = sum("image");
    const video = sum("video");
    const unknown = sum("unknown");
    memoriesResult = { total: image + video + unknown, image, video, unknown, byMonth };
  }

  // Notes: what is missing first, then what to be careful about.
  if (usableIn.chats === 0) notes.push({ code: "no-activity-data", params: {} });
  if (usableIn.friends === 0) notes.push({ code: "no-friend-dates", params: {} });
  if (usableIn.removed === 0) notes.push({ code: "no-removal-dates", params: {} });
  if (usableIn.memories === 0) notes.push({ code: "no-memories", params: {} });
  if (activity && total === 0) notes.push({ code: "no-activity-in-year", params: { year } });
  if (total > 0 && total < FEW_EVENTS) notes.push({ code: "few-events", params: { count: total } });
  if (activity && total > 0) {
    const unknownCount = activity.total.unknown;
    if (unknownCount / total > MANY_UNKNOWN_SHARE) {
      notes.push({ code: "many-unknown-direction", params: { count: unknownCount, percent: Math.round((unknownCount / total) * 100) } });
    }
  }
  if (inProgress) notes.push({ code: "year-in-progress", params: { year } });
  pushCommonNotes(notes, skipped, adjusted, offset);

  return {
    year,
    yearSource,
    utcOffsetMinutes: offset,
    inProgress,
    activity,
    friends: { added: usableIn.friends > 0 ? added : null, removed: usableIn.removed > 0 ? removedCount : null },
    memories: memoriesResult,
    skipped,
    notes,
  };
}

function sumCounts(a: DirectionCounts, b: DirectionCounts): DirectionCounts {
  return { total: a.total + b.total, sent: a.sent + b.sent, received: a.received + b.received, unknown: a.unknown + b.unknown };
}

function pushCommonNotes(notes: YearNote[], skipped: { undated: number; future: number }, adjusted: boolean, offset: number): void {
  if (skipped.undated > 0) notes.push({ code: "undated-skipped", params: { count: skipped.undated } });
  if (skipped.future > 0) notes.push({ code: "future-skipped", params: { count: skipped.future } });
  if (adjusted) notes.push({ code: "offset-adjusted", params: { minutes: offset } });
}
