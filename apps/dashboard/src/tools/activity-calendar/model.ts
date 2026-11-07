/**
 * Activity calendar: the pure step. It hands core's activity calendar module the chats and Snaps, of which core reads
 * only the kind and the time (never a conversation, direction or username), then shapes its result for the page:
 * plain numbers, dates and keys. There is no per-friend figure anywhere in it.
 */
import { insights } from "@snappy-export/core";
import type { ToolData } from "../data.ts";

export type CalendarResult = insights.activityCalendar.ActivityCalendarResult;

export interface CalendarParams {
  /** Minutes east of UTC. 0 is UTC. */
  utcOffsetMinutes: number;
  /** The year to list, or null for the year of the latest chat or Snap. */
  year: number | null;
}

export const DEFAULT_PARAMS: CalendarParams = { utcOffsetMinutes: 0, year: null };

/** The time zones the page offers, in minutes east of UTC: every whole hour, plus the half and quarter hours in common use. */
export const OFFSETS: readonly number[] = [
  -720, -660, -600, -570, -540, -480, -420, -360, -300, -240, -210, -180, -120, -60, 0, 60, 120, 180, 210, 240, 270, 300, 330, 345, 360, 390, 420, 480, 525, 540, 570, 600, 630, 660, 720, 765, 780, 840,
];

/** How many recent years the kinds-by-year table lists. */
export const YEARS_SHOWN = 10;

const MINUTE_MS = 60_000;
/** The widest shift a time zone can make to a date. */
const MAX_SHIFT_MS = 840 * MINUTE_MS;

export interface MonthMark {
  /** 1 to 12. */
  month: number;
  /** The grid column (1-based) where the month's first day sits. */
  column: number;
}

export interface YearView {
  calendar: insights.activityCalendar.YearCalendar;
  /** One heat level per listed day, 0 (none) to 4 (the busiest quarter of days). */
  levels: number[];
  /** The row (0 is Monday, 6 is Sunday) of January 1, so the grid starts in the right row. */
  startRow: number;
  /** The month labels above the grid. */
  marks: MonthMark[];
  /** The number of grid columns. */
  columns: number;
}

export interface CalendarView {
  result: CalendarResult;
  /** The listed year, or null when there is none (nothing usable and no year asked for). */
  year: YearView | null;
  /** The latest years of the mix, oldest first. */
  yearsShown: CalendarResult["mixByYear"];
  /** More years exist than are listed. */
  yearsTotal: number;
}

/** 0 for no activity; 1 to 4 for the share of the busiest day, in quarters. */
export function heatLevel(count: number, max: number): number {
  if (!(count > 0) || !(max > 0)) return 0;
  const share = count / max;
  return share > 0.75 ? 4 : share > 0.5 ? 3 : share > 0.25 ? 2 : 1;
}

/** Monday is row 0, Sunday row 6. */
function rowOf(year: number, month: number, day: number): number {
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
}

function yearView(calendar: insights.activityCalendar.YearCalendar): YearView {
  const max = calendar.days.reduce((m, d) => (d.count > m ? d.count : m), 0);
  const levels = calendar.days.map((d) => heatLevel(d.count, max));
  const startRow = rowOf(calendar.year, 1, 1);
  const marks: MonthMark[] = [];
  calendar.days.forEach((d, i) => {
    if (d.date.endsWith("-01")) marks.push({ month: Number(d.date.slice(5, 7)), column: Math.floor((i + startRow) / 7) + 1 });
  });
  return { calendar, levels, startRow, marks, columns: Math.floor((calendar.days.length - 1 + startRow) / 7) + 1 };
}

/** The years the page offers for a list of chats, newest first, in memory once per list (a large export holds over a million). */
const choices = new WeakMap<object, { now: number; years: number[] }>();

/**
 * Every year that any chat or Snap could fall in, in any time zone, newest first. The edge years may be empty in the
 * time zone the person picks: that is shown honestly, as an empty year.
 */
export function yearChoices(data: ToolData): number[] {
  const chats = data.parsed?.chats;
  if (chats === undefined) return [];
  const held = choices.get(chats);
  if (held && held.now === data.now) return held.years;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < chats.length; i++) {
    const at = chats[i]?.at;
    if (typeof at !== "number" || !Number.isFinite(at) || at <= 0 || at > data.now) continue;
    if (at < lo) lo = at;
    if (at > hi) hi = at;
  }
  const years: number[] = [];
  if (lo <= hi) {
    const first = new Date(lo - MAX_SHIFT_MS).getUTCFullYear();
    const last = new Date(hi + MAX_SHIFT_MS).getUTCFullYear();
    for (let y = Math.min(last, 2200); y >= Math.max(first, 1969); y--) years.push(y);
  }
  choices.set(chats, { now: data.now, years });
  return years;
}

export function computeCalendar(data: ToolData, params: CalendarParams = DEFAULT_PARAMS): CalendarView {
  const { parsed } = data;
  if (parsed === null) throw new Error("needs an export");
  // The chats go in as they are, not copied into new objects first: core reads only each event's kind and time.
  const result = insights.activityCalendar.computeActivityCalendar(parsed.chats, {
    now: data.now,
    utcOffsetMinutes: params.utcOffsetMinutes,
    ...(params.year !== null && { year: params.year }),
  });
  return {
    result,
    year: result.calendar === null ? null : yearView(result.calendar),
    yearsShown: result.mixByYear.slice(-YEARS_SHOWN),
    yearsTotal: result.mixByYear.length,
  };
}
