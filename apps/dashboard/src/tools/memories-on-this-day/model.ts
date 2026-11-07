/**
 * Memories on this day: the pure step. It indexes the dates of the Memories list (only `id` and `date` are read, by
 * core) and asks core for the same day in earlier years, the busiest month of each year and the days of the year that
 * come up most. The result holds calendar numbers, counts and note codes: never an id, a file name or a link.
 *
 * "Today" is the page's own reference date (data.now) in the chosen UTC offset. A fixed offset is a simplification
 * that does not follow daylight saving, which the page says in a note.
 */
import { insights } from "@snappy-export/core";
import type { ToolData } from "../data.ts";

const core = insights.memoriesOnThisDay;

export type CivilDate = insights.memoriesOnThisDay.CivilDate;
export type MemoryDayCounts = insights.memoriesOnThisDay.MemoryDayCounts;
export type ResultNote = insights.memoriesOnThisDay.InsightNote;

export interface OnThisDayParams {
  /** A day as "YYYY-MM-DD". Empty means today. */
  date: string;
  /** Days on each side of the day to look at. 0 is the day itself. */
  windowDays: number;
  /** Minutes east of UTC. */
  offsetMinutes: number;
}

export const DEFAULT_PARAMS: OnThisDayParams = { date: "", windowDays: 0, offsetMinutes: 0 };

export interface YearMatch {
  year: number;
  /** Whole years before the day looked at. */
  yearsAgo: number;
  count: number;
}

export interface YearTotal {
  year: number;
  total: number;
  /** 1..12, or null when no month has a Memory. */
  busiestMonth: number | null;
  busiestCount: number;
}

export interface TopDay {
  month: number;
  day: number;
  count: number;
  /** Distinct years with Memories on this day. */
  years: number;
}

export interface OnThisDayResult {
  target: CivilDate;
  /** No day was chosen, so the page's own "today" is used. */
  isToday: boolean;
  windowDays: number;
  utcOffsetMinutes: number;
  counts: MemoryDayCounts;
  firstYear: number | null;
  lastYear: number | null;
  /** Memories on the day (or near it) in earlier years. */
  total: number;
  /** Earlier years with Memories on or near the day, newest first. */
  years: YearMatch[];
  /** Every year with Memories, newest first. */
  byYear: YearTotal[];
  /** The days of the year with the most Memories across all years. */
  topDays: TopDay[];
  notes: ResultNote[];
}

const TOP_DAYS = 5;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The chosen day, or null for "today" (blank, or text that is not a date, which a date field never gives). */
function chosenDay(text: string): CivilDate | null {
  const m = DAY.exec(text);
  return m ? { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) } : null;
}

function busiestMonth(months: readonly number[]): { month: number | null; count: number } {
  let best = -1;
  let count = 0;
  months.forEach((n, i) => {
    if (n > count) {
      best = i;
      count = n;
    }
  });
  return { month: best < 0 ? null : best + 1, count };
}

export function computeMemoriesOnThisDay(data: ToolData, params: OnThisDayParams = DEFAULT_PARAMS): OnThisDayResult {
  const { parsed } = data;
  if (parsed === null) throw new Error("needs an export");
  const index = core.indexMemoryDays(parsed.memories, { now: data.now, utcOffsetMinutes: params.offsetMinutes });
  const picked = chosenDay(params.date);
  const target: CivilDate = picked ?? core.localDate(data.now, index.utcOffsetMinutes) ?? { year: 1970, month: 1, day: 1 };

  const windowDays = Number.isFinite(params.windowDays) ? Math.max(0, Math.floor(params.windowDays)) : 0;
  const matched = windowDays > 0 ? core.nearbyDays(index, target, { windowDays }) : core.onThisDay(index, target);

  const byYear = core
    .monthYearHeatmap(index)
    .years.filter((y) => y.total > 0)
    .map((y): YearTotal => {
      const best = busiestMonth(y.months);
      return { year: y.year, total: y.total, busiestMonth: best.month, busiestCount: best.count };
    })
    .reverse();
  const topDays = [...core.monthDayCalendar(index).cells]
    .sort((a, b) => b.count - a.count || a.month - b.month || a.day - b.day)
    .slice(0, TOP_DAYS)
    .map((c): TopDay => ({ month: c.month, day: c.day, count: c.count, years: c.years }));

  return {
    target,
    isToday: picked === null,
    windowDays: "windowDays" in matched ? matched.windowDays : 0,
    utcOffsetMinutes: index.utcOffsetMinutes,
    counts: index.counts,
    firstYear: index.firstYear,
    lastYear: index.lastYear,
    total: matched.total,
    years: matched.years.map((y) => ({ year: y.year, yearsAgo: y.yearsAgo, count: y.count })),
    byYear,
    topDays,
    notes: matched.notes,
  };
}
