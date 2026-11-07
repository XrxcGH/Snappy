/**
 * Year in review: the pure step. It hands core's year-in-review module the chats, friends, removed friends and
 * Memories as they are. Core reads only a direction, a kind and a time per event, one date per friend and one date
 * and type per Memory, so no username or conversation can reach the result. Nothing is copied first: a large export
 * holds over a million events, and core makes two linear passes over them.
 */
import { insights } from "@snappy-export/core";
import type { ToolData } from "../data.ts";

export type YearResult = insights.yearInReview.YearInReviewResult;

export interface YearParams {
  /** The calendar year, or null for the latest year that has dates. */
  year: number | null;
  /** Minutes east of UTC. 0 is UTC. */
  utcOffsetMinutes: number;
}

export const DEFAULT_PARAMS: YearParams = { year: null, utcOffsetMinutes: 0 };

/** The time zones the page offers, in minutes east of UTC: every whole hour, plus the half and quarter hours in common use. */
export const OFFSETS: readonly number[] = [
  -720, -660, -600, -570, -540, -480, -420, -360, -300, -240, -210, -180, -120, -60, 0, 60, 120, 180, 210, 240, 270, 300, 330, 345, 360, 390, 420, 480, 525, 540, 570, 600, 630, 660, 720, 765, 780, 840,
];

export interface YearView {
  result: YearResult;
  /** The activity, or null when the year holds no chat or Snap (the sections that need it are left out). */
  activity: insights.yearInReview.YearActivity | null;
  /** The Memories, or null when the year holds none. */
  memories: insights.yearInReview.YearMemories | null;
  /** The numbers of the tiles. Null means the export has nothing to count it from (a dash), which is not the same as zero. */
  tiles: {
    chats: number | null;
    activeDays: number | null;
    memories: number | null;
    newFriends: number | null;
    removedFriends: number | null;
    /** The longest quiet stretch in days; null when there is none. */
    gapDays: number | null;
  };
}

export function computeYear(data: ToolData, params: YearParams = DEFAULT_PARAMS): YearView {
  const { parsed } = data;
  if (parsed === null) throw new Error("needs an export");
  const result = insights.yearInReview.computeYearInReview(
    { chats: parsed.chats, friends: parsed.friends.friends, deletedFriends: parsed.friends.deletedFriends, memories: parsed.memories },
    { now: data.now, utcOffsetMinutes: params.utcOffsetMinutes, ...(params.year !== null && { year: params.year }) },
  );
  const { activity: a, memories: m } = result;
  return {
    result,
    activity: a !== null && a.total.total > 0 ? a : null,
    memories: m !== null && m.total > 0 ? m : null,
    tiles: {
      chats: a === null ? null : a.total.total,
      activeDays: a === null ? null : a.activeDays,
      memories: m === null ? null : m.total,
      newFriends: result.friends.added,
      removedFriends: result.friends.removed,
      gapDays: a?.longestQuietGap?.days ?? null,
    },
  };
}

const MIN_YEAR = 1969;
const MAX_YEAR = 2200;
const MINUTE_MS = 60_000;
/** The largest shifts west and east of UTC that core accepts, in minutes. */
const MIN_OFFSET = -720;
const MAX_OFFSET = 840;
const MAX_TIME = Date.UTC(MAX_YEAR, 11, 31, 23, 59, 59);

/**
 * The calendar years the page offers, latest first: every year from the earliest to the latest usable date among
 * the chats, friends, removed friends and Memories. The range is widened by the largest time zone shift, so a
 * year is offered in every time zone in which it could hold something. Empty when no date is usable.
 */
export function availableYears(data: ToolData): number[] {
  const { parsed } = data;
  if (parsed === null) return [];
  const limit = Math.min(data.now, MAX_TIME);
  let min = Infinity;
  let max = -Infinity;
  const see = (t: number | null | undefined): void => {
    if (typeof t !== "number" || !Number.isFinite(t) || t <= 0 || t > limit) return;
    if (t < min) min = t;
    if (t > max) max = t;
  };
  for (const c of parsed.chats) see(c.at);
  for (const f of parsed.friends.friends) see(f.createdAt);
  for (const f of parsed.friends.deletedFriends) see(f.deletedAt);
  for (const m of parsed.memories) see(m.date);
  if (min > max) return [];
  const first = Math.max(MIN_YEAR, new Date(min + MIN_OFFSET * MINUTE_MS).getUTCFullYear());
  const last = Math.min(MAX_YEAR, new Date(max + MAX_OFFSET * MINUTE_MS).getUTCFullYear());
  const years: number[] = [];
  for (let y = last; y >= first; y--) years.push(y);
  return years;
}
