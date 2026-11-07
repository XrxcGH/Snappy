/**
 * Activity calendar and mix: when Snap and chat activity happened, day by day, and what kind it was.
 *
 * Privacy: the input is only a kind and a time per event. There is no field for a username or a
 * conversation, so the result cannot hold any per-person data, and notes carry a stable code plus
 * numbers only (never text, never user data). Everything is summed across ALL friends. This is not
 * streak tracking: no run is ever computed for one friend, only for the account's overall activity.
 *
 * Pure and deterministic: no clock (take `now`), no randomness, no input-order dependence. One pass
 * writes a few typed-array counters per event; everything else works on days, not events, so
 * 10,000+ events (or a million) are fast.
 *
 * Defaults (all documented here, none hidden):
 *  - utcOffsetMinutes: 0 (UTC). Valid range is -720..840 (UTC-12:00 to UTC+14:00); other values are
 *    clamped and noted. Fractional minutes are rounded. A non-finite offset means 0 (noted).
 *  - year: the year of the latest used event. A year that is not a whole number from 1969 to 2200 is
 *    replaced by that default (noted). A valid year with no events gives an empty calendar (noted).
 *  - Events with a missing or non-finite time, a time at or before 0, or a time after
 *    MAX_CALENDAR_TIME (year 2200) are "undated"; events after `now` are "future". Both are left out
 *    of everything and only counted.
 *  - Kinds are matched ignoring case and surrounding spaces: TEXT, IMAGE, VIDEO, NOTE and STICKER.
 *    Anything else (MEDIA, a missing kind, a new kind Snapchat adds) counts as "other", so a total
 *    is always the sum of the six kinds. A chat's MEDIA kind does not say image or video, hence "other".
 *  - The calendar lists days and months from January 1 up to the day of `now` (in the offset), so
 *    the current year has no empty future rows.
 *  - Weeks run Monday to Sunday and only complete weeks count: inside the calendar year AND inside
 *    the period from the first to the last day with any activity (so the stretch before someone
 *    started, or the days since the export, never looks "quiet"). Ties go to the earliest week and
 *    `ties` says how many other weeks share the count. The quietest week is null under two weeks.
 *  - Runs: "active" is a run of consecutive days with at least one event. "Quiet" is a run of days
 *    with none that has an active day on both sides, so the time before the first event or after the
 *    last one is not a quiet run. Both are found for all time and inside the calendar year; ties go
 *    to the earliest run. A run is null when there is none.
 */

/** The only fields read. A ChatEvent fits as is (extra fields are ignored and never copied). */
export interface CalendarEvent {
  /** e.g. "TEXT", "IMAGE", "VIDEO", "NOTE", "STICKER" (any case). Missing or unknown counts as "other". */
  kind?: string | null;
  /** Epoch ms. Missing or invalid means "undated". */
  at?: number | null;
}

export interface ActivityCalendarOptions {
  /** Epoch ms "now" (injected for determinism). Events after it are not counted. */
  now: number;
  /** Minutes east of UTC for day, week, month and year boundaries. Default 0. */
  utcOffsetMinutes?: number;
  /** The calendar year to list (whole number, 1969..2200). Default: the year of the latest event. */
  year?: number;
}

export const KIND_ORDER = ["text", "image", "video", "note", "sticker", "other"] as const;
export type ActivityKind = (typeof KIND_ORDER)[number];

/** Events by kind. `total` is always the sum of the six. */
export type KindMix = Record<ActivityKind, number> & { total: number };

export interface YearMix extends KindMix {
  year: number;
}

export interface CalendarDay {
  /** "YYYY-MM-DD" in the chosen offset. */
  date: string;
  count: number;
}

export interface CalendarMonth {
  /** "YYYY-MM" in the chosen offset. */
  month: string;
  count: number;
  /** Days in the month with at least one event. */
  activeDays: number;
}

export interface CalendarWeek {
  /** The Monday that starts the week, "YYYY-MM-DD". */
  start: string;
  count: number;
}

export interface WeekPeak extends CalendarWeek {
  /** Number of other complete weeks with the same count. */
  ties: number;
}

export interface ActivityRun {
  /** Number of days in the run. */
  days: number;
  /** First and last day of the run, "YYYY-MM-DD". */
  start: string;
  end: string;
}

export interface Streaks {
  longestActive: ActivityRun | null;
  longestQuiet: ActivityRun | null;
}

export interface YearCalendar {
  year: number;
  /** Events in the year. */
  total: number;
  /** Days of the year with at least one event. */
  activeDays: number;
  /** January 1 up to the day of `now` at the latest, oldest first. */
  days: CalendarDay[];
  /** Same span as `days`, a month per row. */
  months: CalendarMonth[];
  /** Complete weeks only (see the module comment), oldest first. */
  weeks: CalendarWeek[];
  busiestWeek: WeekPeak | null;
  quietestWeek: WeekPeak | null;
  /** Runs inside this year only. */
  streaks: Streaks;
  mix: KindMix;
}

export type ActivityCalendarNoteCode =
  | "no-events" // params: none
  | "no-usable-events" // params: none (events exist, but none is dated and not in the future)
  | "undated-skipped" // params: count
  | "future-skipped" // params: count
  | "few-events" // params: count (patterns are weak under CALENDAR_FEW_EVENTS)
  | "many-other-kind" // params: count, percent
  | "year-adjusted" // params: year (the year actually used)
  | "year-empty" // params: year (no events in it)
  | "offset-adjusted"; // params: minutes (the offset actually used)

export interface ActivityCalendarNote {
  code: ActivityCalendarNoteCode;
  params: Record<string, number>;
}

export interface ActivityCalendarResult {
  utcOffsetMinutes: number;
  /** events = all given; used = dated and not in the future (what everything is built from). */
  totals: { events: number; used: number; undated: number; future: number; activeDays: number };
  first: number | null;
  last: number | null;
  /** Every year from the first to the last used event, no gaps, oldest first. */
  years: number[];
  /** The listed year; null when there is no usable event and no valid year was asked for. */
  calendar: YearCalendar | null;
  /** All time (first to last active day). */
  streaks: Streaks;
  /** The mix of kinds over all used events. */
  mix: KindMix;
  /** The mix per year, gap-free like `years`. */
  mixByYear: YearMix[];
  notes: ActivityCalendarNote[];
}

/** Under this many used events the picture is noted as weak. */
export const CALENDAR_FEW_EVENTS = 30;
/** Above this share of "other" kinds the mix is noted as unreliable. */
export const MANY_OTHER_KIND_SHARE = 0.5;

/** Latest time read (Jan 1, 2200 UTC). A later time is treated as undated. */
export const MAX_CALENDAR_TIME = Date.UTC(2200, 0, 1);
const MIN_YEAR = 1969; // an event just after the epoch can fall in 1969 in a negative offset
const MAX_YEAR = 2200;

const MIN_OFFSET = -720;
const MAX_OFFSET = 840;
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
/** Day slots cover every time that is read (the epoch to the year 2200, plus the offset). Slot = epoch day + 1. */
const DAY_SLOTS = Math.floor(MAX_CALENDAR_TIME / DAY_MS) + 4;
const KINDS = KIND_ORDER.length;
const OTHER = KINDS - 1;

const KIND_INDEX = new Map<string, number>(KIND_ORDER.map((k, i) => [k.toUpperCase(), i]));

function kindIndex(kind: unknown): number {
  if (typeof kind !== "string") return OTHER;
  return KIND_INDEX.get(kind) ?? KIND_INDEX.get(kind.trim().toUpperCase()) ?? OTHER;
}

function modulo(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/** Days since 1970-01-01 of a civil date (proleptic Gregorian; Howard Hinnant's algorithm). */
function daysFromCivil(y: number, m: number, d: number): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** The civil date of a day count since 1970-01-01. */
function civilFromDays(z0: number): { y: number; m: number; d: number } {
  const z = z0 + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return { y: yoe + era * 400 + (m <= 2 ? 1 : 0), m, d };
}

const pad = (n: number, width: number): string => String(n).padStart(width, "0");

/** "YYYY-MM-DD" of a day slot. */
function dateLabel(slot: number): string {
  const { y, m, d } = civilFromDays(slot - 1);
  return `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`;
}

/** The offset to use and whether it differs from what the caller passed. */
function resolveOffset(requested: number | undefined): { minutes: number; adjusted: boolean } {
  if (requested === undefined) return { minutes: 0, adjusted: false };
  if (!Number.isFinite(requested)) return { minutes: 0, adjusted: true };
  const minutes = Math.min(MAX_OFFSET, Math.max(MIN_OFFSET, Math.round(requested)));
  return { minutes, adjusted: minutes !== requested };
}

/**
 * The longest active run and the longest quiet run between two day slots (inclusive). Quiet runs
 * need an active day on both sides, so only days between the first and last active day count.
 */
function findRuns(counts: Uint32Array, from: number, to: number): Streaks {
  let active: { len: number; start: number } | null = null;
  let quiet: { len: number; start: number } | null = null;
  let runStart = -1; // start of the current active run
  let prev = -1; // the last active day seen
  for (let s = from; s <= to; s++) {
    if (counts[s]! === 0) continue;
    if (prev < 0 || s - prev > 1) {
      if (prev >= 0 && (quiet === null || s - prev - 1 > quiet.len)) quiet = { len: s - prev - 1, start: prev + 1 };
      runStart = s;
    }
    if (active === null || s - runStart + 1 > active.len) active = { len: s - runStart + 1, start: runStart };
    prev = s;
  }
  const run = (r: { len: number; start: number } | null): ActivityRun | null =>
    r === null ? null : { days: r.len, start: dateLabel(r.start), end: dateLabel(r.start + r.len - 1) };
  return { longestActive: run(active), longestQuiet: run(quiet) };
}

/** The busiest or quietest week; the earliest wins ties. */
function weekPeak(weeks: readonly { slot: number; count: number }[], pickMax: boolean): WeekPeak | null {
  if (weeks.length === 0) return null;
  let best = 0;
  for (let i = 1; i < weeks.length; i++) {
    if (pickMax ? weeks[i]!.count > weeks[best]!.count : weeks[i]!.count < weeks[best]!.count) best = i;
  }
  const count = weeks[best]!.count;
  let ties = 0;
  for (let i = 0; i < weeks.length; i++) if (i !== best && weeks[i]!.count === count) ties++;
  return { start: dateLabel(weeks[best]!.slot), count, ties };
}

function mixOf(kindCounts: Uint32Array | number[]): KindMix {
  const mix = { text: 0, image: 0, video: 0, note: 0, sticker: 0, other: 0, total: 0 } as KindMix;
  KIND_ORDER.forEach((k, i) => {
    mix[k] = kindCounts[i]!;
    mix.total += kindCounts[i]!;
  });
  return mix;
}

export function computeActivityCalendar(events: readonly CalendarEvent[], options: ActivityCalendarOptions): ActivityCalendarResult {
  const notes: ActivityCalendarNote[] = [];
  const { minutes: offset, adjusted } = resolveOffset(options.utcOffsetMinutes);
  const offsetMs = offset * MINUTE_MS;
  const now = options.now;

  // Counters live in typed arrays: per day and per day-and-kind. No object, Date or Set per event.
  const dayCounts = new Uint32Array(DAY_SLOTS);
  const dayKinds = new Uint32Array(DAY_SLOTS * KINDS);
  const allKinds = new Uint32Array(KINDS);
  const totals = { events: events.length, used: 0, undated: 0, future: 0, activeDays: 0 };
  let first: number | null = null;
  let last: number | null = null;
  let firstSlot = DAY_SLOTS;
  let lastSlot = -1;

  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const at = e?.at;
    if (typeof at !== "number" || !Number.isFinite(at) || at <= 0 || at > MAX_CALENDAR_TIME) {
      totals.undated++;
      continue;
    }
    if (!(at <= now)) {
      totals.future++;
      continue;
    }
    const slot = Math.floor((at + offsetMs) / DAY_MS) + 1; // the earliest shifted time is a day before the epoch
    const k = kindIndex(e?.kind);
    if (dayCounts[slot] === 0) totals.activeDays++;
    dayCounts[slot]!++;
    dayKinds[slot * KINDS + k]!++;
    allKinds[k]!++;
    totals.used++;
    if (slot < firstSlot) firstSlot = slot;
    if (slot > lastSlot) lastSlot = slot;
    if (first === null || at < first) first = at;
    if (last === null || at > last) last = at;
  }

  const used = totals.used;
  const mix = mixOf(allKinds);

  // Years and the mix per year come from the active days only (one date conversion per active day).
  const years: number[] = [];
  const mixByYear: YearMix[] = [];
  let defaultYear: number | null = null;
  if (used > 0) {
    const yearKinds = new Map<number, number[]>();
    for (let s = firstSlot; s <= lastSlot; s++) {
      if (dayCounts[s] === 0) continue;
      const y = civilFromDays(s - 1).y;
      let row = yearKinds.get(y);
      if (!row) yearKinds.set(y, (row = new Array<number>(KINDS).fill(0)));
      for (let k = 0; k < KINDS; k++) row[k]! += dayKinds[s * KINDS + k]!;
    }
    const lo = civilFromDays(firstSlot - 1).y;
    const hi = civilFromDays(lastSlot - 1).y;
    for (let y = lo; y <= hi; y++) {
      years.push(y);
      mixByYear.push({ year: y, ...mixOf(yearKinds.get(y) ?? new Array<number>(KINDS).fill(0)) });
    }
    defaultYear = hi;
  }

  // Which year to list.
  const requested = options.year;
  const validRequest = typeof requested === "number" && Number.isInteger(requested) && requested >= MIN_YEAR && requested <= MAX_YEAR;
  const year = validRequest ? requested : defaultYear;

  let calendar: YearCalendar | null = null;
  if (year !== null) {
    const yearFirst = daysFromCivil(year, 1, 1) + 1; // day slots
    const yearLast = daysFromCivil(year, 12, 31) + 1;
    // Today in the offset; a non-finite or huge `now` is clamped so a year is never listed past 2200.
    const todaySlot = Number.isNaN(now) ? -1 : Math.floor((Math.min(now, MAX_CALENDAR_TIME) + offsetMs) / DAY_MS) + 1;
    const listedLast = Math.min(yearLast, todaySlot, DAY_SLOTS - 1);

    const days: CalendarDay[] = [];
    const months: CalendarMonth[] = [];
    const yearKindCounts = new Array<number>(KINDS).fill(0);
    let total = 0;
    let activeDays = 0;
    for (let s = yearFirst; s <= listedLast; s++) {
      const count = s >= 0 ? dayCounts[s]! : 0;
      const date = dateLabel(s);
      days.push({ date, count });
      if (months.length === 0 || months[months.length - 1]!.month !== date.slice(0, 7)) months.push({ month: date.slice(0, 7), count: 0, activeDays: 0 });
      const month = months[months.length - 1]!;
      month.count += count;
      total += count;
      if (count > 0) {
        month.activeDays++;
        activeDays++;
        for (let k = 0; k < KINDS; k++) yearKindCounts[k]! += dayKinds[s * KINDS + k]!;
      }
    }

    // Complete Monday-to-Sunday weeks inside the year and inside the first-to-last active day period.
    const weeks: { slot: number; count: number }[] = [];
    if (used > 0) {
      const weekday = (slot: number) => modulo(slot - 1 + 4, 7); // 1970-01-01 was a Thursday; 0 is Sunday
      const firstMonday = yearFirst + modulo(1 - weekday(yearFirst), 7);
      for (let start = Math.max(firstMonday, firstSlot + modulo(1 - weekday(firstSlot), 7)); start + 6 <= Math.min(yearLast, lastSlot); start += 7) {
        let count = 0;
        for (let s = start; s < start + 7; s++) count += dayCounts[s]!;
        weeks.push({ slot: start, count });
      }
    }

    const inYear = used > 0 ? findRuns(dayCounts, Math.max(yearFirst, firstSlot), Math.min(yearLast, lastSlot)) : { longestActive: null, longestQuiet: null };
    const busiest = weekPeak(weeks, true);
    calendar = {
      year,
      total,
      activeDays,
      days,
      months,
      weeks: weeks.map((w) => ({ start: dateLabel(w.slot), count: w.count })),
      busiestWeek: busiest !== null && busiest.count > 0 ? busiest : null,
      quietestWeek: weeks.length >= 2 ? weekPeak(weeks, false) : null,
      streaks: inYear,
      mix: mixOf(yearKindCounts),
    };
    if (total === 0) notes.push({ code: "year-empty", params: { year } });
  }

  if (events.length === 0) notes.push({ code: "no-events", params: {} });
  else if (used === 0) notes.push({ code: "no-usable-events", params: {} });
  if (totals.undated > 0) notes.push({ code: "undated-skipped", params: { count: totals.undated } });
  if (totals.future > 0) notes.push({ code: "future-skipped", params: { count: totals.future } });
  if (used > 0 && used < CALENDAR_FEW_EVENTS) notes.push({ code: "few-events", params: { count: used } });
  if (used > 0 && mix.other / used > MANY_OTHER_KIND_SHARE) {
    notes.push({ code: "many-other-kind", params: { count: mix.other, percent: Math.round((mix.other / used) * 100) } });
  }
  if (requested !== undefined && !validRequest && year !== null) notes.push({ code: "year-adjusted", params: { year } });
  if (adjusted) notes.push({ code: "offset-adjusted", params: { minutes: offset } });

  return {
    utcOffsetMinutes: offset,
    totals,
    first,
    last,
    years,
    calendar,
    streaks: used > 0 ? findRuns(dayCounts, firstSlot, lastSlot) : { longestActive: null, longestQuiet: null },
    mix,
    mixByYear,
    notes,
  };
}
