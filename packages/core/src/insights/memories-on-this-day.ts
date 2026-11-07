/**
 * "Memories on this day" and calendar data (pure, offline, deterministic).
 *
 * Input is the parsed Memories list; only `id` and `date` are read. Nothing else on a MemoryItem
 * (download link, zip path, overlay paths, sizes) is touched, and the output carries only memory
 * ids, calendar numbers, counts and machine-coded notes: no file names, no paths, no text.
 *
 * Build an index once with `indexMemoryDays`, then ask it questions:
 *  - `onThisDay`          same month and day in earlier years (grouped by year)
 *  - `nearbyDays`         the same, with a window of days around it
 *  - `calendarYear`       counts per day for one year
 *  - `monthYearHeatmap`   counts per month and year (dense grid)
 *  - `monthDayCalendar`   counts per month-and-day across all years (366 cells)
 *
 * Conventions
 *  - Time is a parameter: `now` (epoch ms) is required, the clock is never read.
 *  - The caller supplies the UTC offset in minutes (default 0). A memory belongs to the calendar
 *    day it falls on after adding that offset. Offsets outside -14h..+14h are ignored (0 is used)
 *    and a note says so. A fixed offset is a simplification: it does not follow daylight saving.
 *  - Unusable dates (null, not finite, outside 1990..2100) are "undated". Dates after `now` are
 *    "future" (likely a wrong camera clock). Both are counted separately and left off every
 *    calendar and every "on this day" list.
 *  - Ids are opaque and case-sensitive. An id that repeats exactly is counted once (first wins,
 *    in input order); ids that differ only by case are different memories.
 *  - Feb 29: it has its own cell. A memory from Feb 29 shows on a Feb 29 target, and, because a
 *    common year has no Feb 29, on a Feb 28 target in a common year ("leap-day-folded" note).
 *  - Ordering: years newest first in "on this day" lists, oldest first in grids; ids inside a day
 *    by capture time, then by id (plain code-unit order, never locale-dependent).
 */
import { DAY_MS } from "../util.ts";

// ------------------------------------------------------------------ types ---

export interface CalendarOptions {
  /** Epoch ms "now". Dates after it are counted as future. */
  now: number;
  /** Minutes east of UTC (e.g. -300 for UTC-5). Default 0. Whole minutes within +-840. */
  utcOffsetMinutes?: number;
}

/** A stable code plus whole-number params. The front end turns codes into wording. */
export interface InsightNote {
  code:
    | "offset-invalid"
    | "now-invalid"
    | "undated-items"
    | "future-dates-skipped"
    | "duplicate-ids-skipped"
    | "invalid-ids-skipped"
    | "no-dated-items"
    | "invalid-target"
    | "invalid-year"
    | "window-adjusted"
    | "leap-day-folded";
  params: Record<string, number>;
}

export interface CivilDate {
  year: number;
  /** 1..12 */
  month: number;
  /** 1..31 */
  day: number;
}

export interface MemoryDayCounts {
  /** Items given. */
  input: number;
  /** Distinct, valid ids: dated + undated + future. */
  unique: number;
  /** On the calendar. */
  dated: number;
  undated: number;
  future: number;
  duplicateIds: number;
  invalidIds: number;
}

/** What was left off the calendar (also in the index counts). */
export interface Excluded {
  undated: number;
  future: number;
}

export interface MemoryDayIndex {
  /** The offset actually used, in minutes. */
  utcOffsetMinutes: number;
  counts: MemoryDayCounts;
  /** Ids without a usable date, sorted by id. */
  undatedIds: string[];
  /** First and last calendar year with items, or null when nothing is dated. */
  firstYear: number | null;
  lastYear: number | null;
  notes: InsightNote[];
  /** Internal: ids per local day number (days since 1970-01-01), in capture order. */
  readonly byDay: ReadonlyMap<number, readonly string[]>;
  /** Internal: item count per year * 12 + (month - 1). */
  readonly byMonth: ReadonlyMap<number, number>;
}

export interface OnThisDayOptions {
  /** Also list the target year itself (earlier the same day). Default false. */
  includeSameYear?: boolean;
}

export interface NearbyOptions extends OnThisDayOptions {
  /** Days on each side of the target day. Default 3, whole number clamped to 0..31. */
  windowDays?: number;
}

export interface OnThisDayYear {
  year: number;
  /** target.year - year (0 only with includeSameYear). */
  yearsAgo: number;
  ids: string[];
  count: number;
}

export interface OnThisDayResult {
  target: CivilDate;
  /** Years with at least one memory, newest first. */
  years: OnThisDayYear[];
  total: number;
  excluded: Excluded;
  notes: InsightNote[];
}

export interface NearbyDay {
  date: CivilDate;
  /** Days from the matching day of that year (-3 .. +3 for the default window). */
  offsetDays: number;
  ids: string[];
}

export interface NearbyYear {
  /** The year whose matching day the window is centered on. */
  year: number;
  yearsAgo: number;
  /** Days with items, oldest first (a window can reach into a neighboring year). */
  days: NearbyDay[];
  count: number;
}

export interface NearbyResult {
  target: CivilDate;
  windowDays: number;
  years: NearbyYear[];
  total: number;
  excluded: Excluded;
  notes: InsightNote[];
}

export interface CalendarDay {
  month: number;
  day: number;
  count: number;
}

export interface CalendarYearResult {
  year: number;
  /** Days with at least one item, in date order. */
  days: CalendarDay[];
  total: number;
  activeDays: number;
  maxDayCount: number;
  /** Items per month, index 0 = January. */
  months: number[];
  excluded: Excluded;
  notes: InsightNote[];
}

export interface HeatmapYear {
  year: number;
  /** Items per month, index 0 = January. */
  months: number[];
  total: number;
}

export interface HeatmapResult {
  /** Every year from the first to the last with items (empty years included), oldest first. */
  years: HeatmapYear[];
  /** Largest single month-and-year count (0 when empty). */
  max: number;
  total: number;
  excluded: Excluded;
  notes: InsightNote[];
}

export interface MonthDayCell {
  month: number;
  day: number;
  count: number;
  /** Distinct years that have items on this month and day. */
  years: number;
}

export interface MonthDayResult {
  /** Month-and-day cells with items, in calendar order (Feb 29 is its own cell). */
  cells: MonthDayCell[];
  total: number;
  excluded: Excluded;
  notes: InsightNote[];
}

// ---------------------------------------------------------------- helpers ---

/** Dates outside this window are garbage (same window as util.toMs). */
const DATE_LOW = Date.UTC(1990, 0, 1);
const DATE_HIGH = Date.UTC(2100, 0, 1);
/** Real UTC offsets run from -12:00 to +14:00. */
const MAX_OFFSET_MINUTES = 14 * 60;
const MIN_TARGET_YEAR = 1970;
const MAX_TARGET_YEAR = 2200;
const DEFAULT_WINDOW_DAYS = 3;
const MAX_WINDOW_DAYS = 31;

const isLeap = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

function daysInMonth(y: number, m: number): number {
  return m === 2 ? (isLeap(y) ? 29 : 28) : m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

const dayNumberOf = (y: number, m: number, d: number): number => Math.round(Date.UTC(y, m - 1, d) / DAY_MS);

function civilOf(dayNumber: number): CivilDate {
  const d = new Date(dayNumber * DAY_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function validTarget(t: CivilDate | undefined): t is CivilDate {
  return (
    !!t &&
    Number.isInteger(t.year) &&
    t.year >= MIN_TARGET_YEAR &&
    t.year <= MAX_TARGET_YEAR &&
    Number.isInteger(t.month) &&
    t.month >= 1 &&
    t.month <= 12 &&
    Number.isInteger(t.day) &&
    t.day >= 1 &&
    t.day <= daysInMonth(t.year, t.month)
  );
}

const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function excludedOf(index: MemoryDayIndex): Excluded {
  return { undated: index.counts.undated, future: index.counts.future };
}

const emptyIndexNotes = (index: MemoryDayIndex, extra: InsightNote[] = []): InsightNote[] => [...index.notes, ...extra];

// ------------------------------------------------------------------ index ---

interface Entry {
  id: string;
  at: number;
}

/**
 * Sort the memories onto local calendar days. Linear apart from one sort; fine for 100k items.
 * Only `id` and `date` are read from each item.
 */
export function indexMemoryDays(
  memories: ReadonlyArray<{ id: string; date: number | null | undefined }>,
  opts: CalendarOptions,
): MemoryDayIndex {
  const notes: InsightNote[] = [];

  let offset = 0;
  const rawOffset = opts?.utcOffsetMinutes;
  if (rawOffset !== undefined) {
    if (Number.isFinite(rawOffset) && Math.abs(rawOffset) <= MAX_OFFSET_MINUTES) offset = Math.round(rawOffset);
    else notes.push({ code: "offset-invalid", params: {} });
  }
  const now = opts?.now;
  const nowOk = typeof now === "number" && Number.isFinite(now);
  if (!nowOk) notes.push({ code: "now-invalid", params: {} });

  const seen = new Set<string>();
  const dated: Entry[] = [];
  const undatedIds: string[] = [];
  let future = 0;
  let duplicateIds = 0;
  let invalidIds = 0;

  for (const m of memories) {
    const id = m?.id;
    if (typeof id !== "string" || id === "") {
      invalidIds++;
      continue;
    }
    if (seen.has(id)) {
      duplicateIds++;
      continue;
    }
    seen.add(id);
    const at = m.date;
    if (typeof at !== "number" || !Number.isFinite(at) || at < DATE_LOW || at > DATE_HIGH) {
      undatedIds.push(id);
    } else if (nowOk && at > now) {
      future++;
    } else {
      dated.push({ id, at });
    }
  }

  dated.sort((a, b) => a.at - b.at || cmpStr(a.id, b.id));
  undatedIds.sort(cmpStr);

  const byDay = new Map<number, string[]>();
  const byMonth = new Map<number, number>();
  const offsetMs = offset * 60_000;
  let firstDay = Infinity;
  let lastDay = -Infinity;
  for (const e of dated) {
    const dn = Math.floor((e.at + offsetMs) / DAY_MS);
    const list = byDay.get(dn);
    if (list) list.push(e.id);
    else byDay.set(dn, [e.id]);
    if (dn < firstDay) firstDay = dn;
    if (dn > lastDay) lastDay = dn;
  }
  for (const [dn, ids] of byDay) {
    const c = civilOf(dn);
    const key = c.year * 12 + c.month - 1;
    byMonth.set(key, (byMonth.get(key) ?? 0) + ids.length);
  }

  if (undatedIds.length) notes.push({ code: "undated-items", params: { count: undatedIds.length } });
  if (future) notes.push({ code: "future-dates-skipped", params: { count: future } });
  if (duplicateIds) notes.push({ code: "duplicate-ids-skipped", params: { count: duplicateIds } });
  if (invalidIds) notes.push({ code: "invalid-ids-skipped", params: { count: invalidIds } });
  if (!dated.length) notes.push({ code: "no-dated-items", params: {} });

  return {
    utcOffsetMinutes: offset,
    counts: {
      input: memories.length,
      unique: seen.size,
      dated: dated.length,
      undated: undatedIds.length,
      future,
      duplicateIds,
      invalidIds,
    },
    undatedIds,
    firstYear: dated.length ? civilOf(firstDay).year : null,
    lastYear: dated.length ? civilOf(lastDay).year : null,
    notes,
    byDay,
    byMonth,
  };
}

// ------------------------------------------------------------ on this day ---

/** Years to look at: earlier years only, or up to and including the target year. */
function yearRange(index: MemoryDayIndex, target: CivilDate, includeSameYear: boolean): [number, number] | null {
  if (index.firstYear === null || index.lastYear === null) return null;
  const last = Math.min(index.lastYear, includeSameYear ? target.year : target.year - 1);
  return index.firstYear <= last ? [index.firstYear, last] : null;
}

/**
 * Years to scan for a window: a window centered on a day of year Y can reach into Y-1 or Y+1, so the
 * scan is one year wider than the memory range on each side (still capped like yearRange).
 */
function nearbyYearRange(index: MemoryDayIndex, target: CivilDate, includeSameYear: boolean): [number, number] | null {
  if (index.firstYear === null || index.lastYear === null) return null;
  const last = Math.min(index.lastYear + 1, includeSameYear ? target.year : target.year - 1);
  const first = index.firstYear - 1;
  return first <= last ? [first, last] : null;
}

/** Day numbers in `year` that count as "the same day" as the target (see the Feb 29 rule above). */
function matchingDays(year: number, target: CivilDate): number[] {
  const { month, day } = target;
  if (month === 2 && day === 29) return isLeap(year) ? [dayNumberOf(year, 2, 29)] : [];
  const out = [dayNumberOf(year, month, day)];
  // A Feb 28 target in a common year also collects Feb 29 memories (they have no day of their own).
  if (month === 2 && day === 28 && !isLeap(target.year) && isLeap(year)) out.push(dayNumberOf(year, 2, 29));
  return out;
}

/** Memories from the same month and day in other years. Years newest first. */
export function onThisDay(index: MemoryDayIndex, target: CivilDate, opts: OnThisDayOptions = {}): OnThisDayResult {
  const empty = (extra: InsightNote[]): OnThisDayResult => ({
    target: { ...target },
    years: [],
    total: 0,
    excluded: excludedOf(index),
    notes: emptyIndexNotes(index, extra),
  });
  if (!validTarget(target)) return empty([{ code: "invalid-target", params: {} }]);
  const range = yearRange(index, target, opts.includeSameYear === true);
  if (!range) return empty([]);

  const years: OnThisDayYear[] = [];
  let folded = 0;
  for (let y = range[1]; y >= range[0]; y--) {
    const ids: string[] = [];
    for (const dn of matchingDays(y, target)) {
      const list = index.byDay.get(dn);
      if (!list) continue;
      if (target.month === 2 && target.day === 28 && civilOf(dn).day === 29) folded += list.length;
      ids.push(...list);
    }
    if (ids.length) years.push({ year: y, yearsAgo: target.year - y, ids, count: ids.length });
  }
  const notes: InsightNote[] = folded ? [{ code: "leap-day-folded", params: { count: folded } }] : [];
  const total = years.reduce((n, y) => n + y.count, 0);
  return { target: { ...target }, years, total, excluded: excludedOf(index), notes: emptyIndexNotes(index, notes) };
}

/**
 * Memories within `windowDays` of the same month and day in other years. For a Feb 29 target the
 * window is centered on Feb 28 in common years. Windows may reach into the neighboring year.
 */
export function nearbyDays(index: MemoryDayIndex, target: CivilDate, opts: NearbyOptions = {}): NearbyResult {
  let windowDays = DEFAULT_WINDOW_DAYS;
  const extra: InsightNote[] = [];
  if (opts.windowDays !== undefined) {
    const w = Number.isFinite(opts.windowDays) ? Math.min(Math.max(Math.floor(opts.windowDays), 0), MAX_WINDOW_DAYS) : DEFAULT_WINDOW_DAYS;
    if (w !== opts.windowDays) extra.push({ code: "window-adjusted", params: { windowDays: w } });
    windowDays = w;
  }
  const empty = (more: InsightNote[]): NearbyResult => ({
    target: { ...target },
    windowDays,
    years: [],
    total: 0,
    excluded: excludedOf(index),
    notes: emptyIndexNotes(index, [...extra, ...more]),
  });
  if (!validTarget(target)) return empty([{ code: "invalid-target", params: {} }]);
  const range = nearbyYearRange(index, target, opts.includeSameYear === true);
  if (!range) return empty([]);

  const years: NearbyYear[] = [];
  for (let y = range[1]; y >= range[0]; y--) {
    const month = target.month;
    const day = target.month === 2 && target.day === 29 && !isLeap(y) ? 28 : target.day;
    const anchor = dayNumberOf(y, month, day);
    const days: NearbyDay[] = [];
    let count = 0;
    for (let off = -windowDays; off <= windowDays; off++) {
      const ids = index.byDay.get(anchor + off);
      if (!ids) continue;
      days.push({ date: civilOf(anchor + off), offsetDays: off, ids: [...ids] });
      count += ids.length;
    }
    if (count) years.push({ year: y, yearsAgo: target.year - y, days, count });
  }
  const total = years.reduce((n, y) => n + y.count, 0);
  return { target: { ...target }, windowDays, years, total, excluded: excludedOf(index), notes: emptyIndexNotes(index, extra) };
}

// --------------------------------------------------------------- calendar ---

/** Counts per day for one calendar year (only days with items are listed). */
export function calendarYear(index: MemoryDayIndex, year: number): CalendarYearResult {
  const result: CalendarYearResult = {
    year,
    days: [],
    total: 0,
    activeDays: 0,
    maxDayCount: 0,
    months: new Array<number>(12).fill(0),
    excluded: excludedOf(index),
    notes: emptyIndexNotes(index),
  };
  if (!Number.isInteger(year) || year < MIN_TARGET_YEAR || year > MAX_TARGET_YEAR) {
    result.notes.push({ code: "invalid-year", params: {} });
    return result;
  }
  const start = dayNumberOf(year, 1, 1);
  const end = dayNumberOf(year + 1, 1, 1);
  for (let dn = start; dn < end; dn++) {
    const ids = index.byDay.get(dn);
    if (!ids) continue;
    const c = civilOf(dn);
    result.days.push({ month: c.month, day: c.day, count: ids.length });
    result.months[c.month - 1]! += ids.length;
    result.total += ids.length;
    if (ids.length > result.maxDayCount) result.maxDayCount = ids.length;
  }
  result.activeDays = result.days.length;
  return result;
}

/** Counts per month and year as a dense grid (one row per year, first to last with items). */
export function monthYearHeatmap(index: MemoryDayIndex): HeatmapResult {
  const years: HeatmapYear[] = [];
  let max = 0;
  if (index.firstYear !== null && index.lastYear !== null) {
    for (let y = index.firstYear; y <= index.lastYear; y++) {
      const months: number[] = [];
      let total = 0;
      for (let m = 0; m < 12; m++) {
        const n = index.byMonth.get(y * 12 + m) ?? 0;
        months.push(n);
        total += n;
        if (n > max) max = n;
      }
      years.push({ year: y, months, total });
    }
  }
  return { years, max, total: index.counts.dated, excluded: excludedOf(index), notes: emptyIndexNotes(index) };
}

/** Month-and-day totals across all years, for spotting the days that come up most. */
export function monthDayCalendar(index: MemoryDayIndex): MonthDayResult {
  const cells = new Map<number, MonthDayCell>();
  for (const [dn, ids] of index.byDay) {
    const c = civilOf(dn);
    const key = c.month * 100 + c.day;
    const cell = cells.get(key);
    if (cell) {
      cell.count += ids.length;
      cell.years++;
    } else cells.set(key, { month: c.month, day: c.day, count: ids.length, years: 1 });
  }
  const sorted = [...cells.values()].sort((a, b) => a.month - b.month || a.day - b.day);
  return { cells: sorted, total: index.counts.dated, excluded: excludedOf(index), notes: emptyIndexNotes(index) };
}

/**
 * Shade bucket for a heatmap cell: 0 for none, else 1..4 in equal steps of the maximum
 * (the front end maps these to its violet scale).
 */
export function heatLevel(count: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (!(count > 0) || !(max > 0)) return 0;
  const level = Math.ceil((Math.min(count, max) / max) * 4);
  return Math.min(Math.max(level, 1), 4) as 1 | 2 | 3 | 4;
}

/** The local calendar date of an instant under the index's offset (for "today" in the caller's zone). */
export function localDate(ms: number, utcOffsetMinutes = 0): CivilDate | null {
  if (!Number.isFinite(ms)) return null;
  const off = Number.isFinite(utcOffsetMinutes) && Math.abs(utcOffsetMinutes) <= MAX_OFFSET_MINUTES ? Math.round(utcOffsetMinutes) : 0;
  const d = new Date(ms + off * 60_000);
  return Number.isNaN(d.getTime()) ? null : { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}
