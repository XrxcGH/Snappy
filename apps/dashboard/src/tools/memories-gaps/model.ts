/**
 * Memories timeline gaps: the pure step. It hands the dates of the Memories list (only `id` and `date` are read, by
 * core) to core's gaps insight and returns what the page shows: counts, calendar months and note codes. Never an id,
 * a file name, a link or a username.
 *
 * Two more inputs come from the export itself, as dates only: the oldest date in the current friends list (where an
 * early gap starts; current friends only, since a removed friend's date can be the removal date) and the export's own
 * date. The codes of the export's health notes give the "may be date-limited" hint; their text is never read.
 *
 * Months follow a fixed UTC offset, which does not follow daylight saving. Time is data.now, never a clock.
 */
import { insights } from "@snappy-export/core";
import type { FriendRecord } from "@snappy-export/core";
import type { ToolData } from "../data.ts";

const core = insights.memoriesGaps;

export type GapNote = insights.memoriesGaps.GapNote;
export type MemoryGap = insights.memoriesGaps.MemoryGap;
export type YearMonth = insights.memoriesGaps.YearMonth;
export type MonthCount = insights.memoriesGaps.MonthCount;
export type BusiestStretch = insights.memoriesGaps.BusiestStretch;
export type GapCounts = insights.memoriesGaps.MemoryGapCounts;
export type GapRange = insights.memoriesGaps.MemoryGapRange;

export interface GapsParams {
  /** Shortest gap to show, in empty calendar months. */
  minGapMonths: number;
  /** Width of the busiest stretch, in months. */
  stretchMonths: number;
  /** Minutes east of UTC. */
  offsetMinutes: number;
}

export const DEFAULT_PARAMS: GapsParams = { minGapMonths: 2, stretchMonths: 3, offsetMinutes: 0 };

export interface GapsResult {
  utcOffsetMinutes: number;
  minGapMonths: number;
  stretchMonths: number;
  counts: GapCounts;
  /** Null when no Memory has a usable date. */
  range: GapRange | null;
  /** Gaps of at least `minGapMonths`, in date order. */
  gaps: MemoryGap[];
  longestGapMonths: number;
  busiestMonth: MonthCount | null;
  busiestStretch: BusiestStretch | null;
  /** An oldest friend date was found and given to core, so a gap before the first Memory can be reported. */
  sinceUsed: boolean;
  notes: GapNote[];
}

/** Dates outside this window are not real (the same window core uses). */
const DATE_LOW = Date.UTC(1990, 0, 1);
const DATE_HIGH = Date.UTC(2100, 0, 1);

/** The oldest usable date in the current friends list, or undefined. Kept in step with the gaps command. */
export function oldestFriendDate(friends: ReadonlyArray<Pick<FriendRecord, "createdAt">>, now: number): number | undefined {
  let oldest: number | undefined;
  for (const f of friends) {
    const at = f.createdAt;
    if (typeof at !== "number" || !Number.isFinite(at) || at < DATE_LOW || at > DATE_HIGH || at > now) continue;
    if (oldest === undefined || at < oldest) oldest = at;
  }
  return oldest;
}

export function computeMemoriesGaps(data: ToolData, params: GapsParams = DEFAULT_PARAMS): GapsResult {
  const { parsed } = data;
  if (parsed === null) throw new Error("needs an export");
  const since = oldestFriendDate(parsed.friends.friends, data.now);
  const found = core.findMemoryGaps(parsed.memories, {
    now: data.now,
    utcOffsetMinutes: params.offsetMinutes,
    minGapMonths: params.minGapMonths,
    stretchMonths: params.stretchMonths,
    ...(since !== undefined && { since }),
    ...(parsed.exportedAt !== undefined && { exportedAt: parsed.exportedAt }),
    issueCodes: data.issues.map((i) => i.code),
  });
  return {
    utcOffsetMinutes: found.utcOffsetMinutes,
    minGapMonths: found.minGapMonths,
    stretchMonths: found.stretchMonths,
    counts: found.counts,
    range: found.range,
    gaps: found.gaps,
    longestGapMonths: found.longestGapMonths,
    busiestMonth: found.busiestMonth,
    busiestStretch: found.busiestStretch,
    sinceUsed: since !== undefined,
    notes: found.notes,
  };
}
