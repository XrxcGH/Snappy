/**
 * Snap and chat habits: aggregate activity patterns from chat and Snap metadata.
 *
 * Privacy: the input is only a direction and a time per event. There is no field for a username,
 * a conversation or a kind, so the result cannot hold any per-person data, and notes carry a
 * stable code plus numbers only (never text, never user data).
 *
 * Pure and deterministic: no clock (take `now`), no randomness, no input-order dependence.
 * One pass to count, one sort for the median gap, so 10,000+ events are fast.
 *
 * Defaults (all documented here, none hidden):
 *  - utcOffsetMinutes: 0 (UTC). Valid range is -720..840 (UTC-12:00 to UTC+14:00); other values
 *    are clamped and noted. Fractional minutes are rounded. A non-finite offset means 0 (noted).
 *  - Weekday numbers follow JavaScript: 0 is Sunday, 6 is Saturday.
 *  - Events with a missing or non-finite time, a time at or before 0, or a time after
 *    MAX_EVENT_TIME (year 2200) are "undated"; events after `now` are "future". Both are left out of every pattern and only counted.
 *  - Direction "unknown" (or anything unrecognized) still counts as activity; it is only left out
 *    of the sent share.
 *  - Peaks: ties go to the lowest hour or weekday number and the earliest month. `ties` says how
 *    many other buckets share the same count, so a caller can word a tie honestly.
 *  - Months are listed without gaps from the first to the last active month (empty months are
 *    zero rows) in the caller's UTC offset.
 */

export type HabitDirection = "sent" | "received" | "unknown";

/** The only fields read. A ChatEvent fits as is (extra fields are ignored and never copied). */
export interface HabitEvent {
  direction?: HabitDirection | string | null;
  /** Epoch ms. Missing or invalid means "undated". */
  at?: number | null;
}

export interface HabitsOptions {
  /** Epoch ms "now" (injected for determinism). Events after it are not counted in patterns. */
  now: number;
  /** Minutes east of UTC for hour, weekday and month boundaries. Default 0. */
  utcOffsetMinutes?: number;
}

export interface DirectionCounts {
  total: number;
  sent: number;
  received: number;
  unknown: number;
}

export interface HourBucket extends DirectionCounts {
  /** 0..23 in the chosen offset. */
  hour: number;
}

export interface WeekdayBucket extends DirectionCounts {
  /** 0 is Sunday .. 6 is Saturday in the chosen offset. */
  weekday: number;
}

export interface MonthBucket extends DirectionCounts {
  /** "YYYY-MM" in the chosen offset. */
  month: string;
}

export interface Peak<K> {
  key: K;
  count: number;
  /** count divided by the events used, 0..1. */
  share: number;
  /** Number of other buckets with the same count. */
  ties: number;
}

export type HabitsNoteCode =
  | "no-events" // params: none
  | "no-usable-events" // params: none (events exist, but none is dated and not in the future)
  | "undated-skipped" // params: count
  | "future-skipped" // params: count
  | "few-events" // params: count (patterns are weak under FEW_EVENTS)
  | "many-unknown-direction" // params: count, percent
  | "offset-adjusted"; // params: minutes (the offset actually used)

export interface HabitsNote {
  code: HabitsNoteCode;
  params: Record<string, number>;
}

export interface HabitsResult {
  utcOffsetMinutes: number;
  /**
   * events = all given; used = dated and not in the future (what every pattern is built from).
   * total, sent, received and unknown count the used events.
   */
  totals: DirectionCounts & { events: number; used: number; undated: number; future: number };
  /** Always 24 rows, hour 0..23. */
  byHour: HourBucket[];
  /** Always 7 rows, weekday 0..6. */
  byWeekday: WeekdayBucket[];
  /** Gap-free, oldest first. Empty when nothing is usable. */
  byMonth: MonthBucket[];
  /** sent / (sent + received), 0..1; null when no event has a known direction. */
  sentShare: number | null;
  busiest: { hour: Peak<number> | null; weekday: Peak<number> | null; month: Peak<string> | null };
  /**
   * The quietest month is null unless at least two months are listed. A quietest bucket can have
   * count 0 (it only won the tie-break, see `ties`), and the first and last month may be partial,
   * so a caller should hedge or skip it rather than state it as a habit.
   */
  quietest: { hour: Peak<number> | null; weekday: Peak<number> | null; month: Peak<string> | null };
  /** Median time between consecutive used events in ms (0 for same-time events); null under 2 events. */
  medianGapMs: number | null;
  /** Distinct calendar days (in the chosen offset) with at least one used event. */
  activeDays: number;
  first: number | null;
  last: number | null;
  notes: HabitsNote[];
}

/** Under this many used events the patterns are noted as weak. */
export const FEW_EVENTS = 30;
/** Above this share of unknown direction the sent share is noted as unreliable. */
export const MANY_UNKNOWN_SHARE = 0.5;

/**
 * Latest time read (Jan 1, 2200 UTC). A later time is treated as undated, so a corrupt value or an
 * infinite `now` can never produce a huge month list or an invalid date.
 */
export const MAX_EVENT_TIME = Date.UTC(2200, 0, 1);

const MIN_OFFSET = -720;
const MAX_OFFSET = 840;
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Months and days are counted in arrays sized for every time that is read (January 1969 to the year 2200, plus the offset). */
const MONTH_ORIGIN = 1969 * 12;
const MONTH_SLOTS = (2201 - 1969) * 12;
const DAY_SLOTS = Math.floor(MAX_EVENT_TIME / DAY_MS) + 4;

const emptyCounts = (): DirectionCounts => ({ total: 0, sent: 0, received: 0, unknown: 0 });

/**
 * The k-th smallest value (0-based) of the array, which is rearranged. Wirth's selection: linear on average, and equal values
 * (many gaps are 0) cost nothing extra.
 */
function selectKth(a: Float64Array, k: number): number {
  let l = 0;
  let r = a.length - 1;
  while (l < r) {
    const x = a[k]!;
    let i = l;
    let j = r;
    do {
      while (a[i]! < x) i++;
      while (x < a[j]!) j--;
      if (i <= j) {
        const t = a[i]!;
        a[i] = a[j]!;
        a[j] = t;
        i++;
        j--;
      }
    } while (i <= j);
    if (j < k) l = i;
    if (k < i) r = j;
  }
  return a[k]!;
}

function modulo(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/** Peak of a bucket list; first bucket wins ties. Null when nothing was counted. */
function peak<B extends DirectionCounts, K>(
  rows: readonly B[],
  key: (b: B) => K,
  pickMax: boolean,
  used: number,
): Peak<K> | null {
  if (rows.length === 0 || used === 0) return null;
  let best = 0;
  for (let i = 1; i < rows.length; i++) {
    const better = pickMax ? rows[i]!.total > rows[best]!.total : rows[i]!.total < rows[best]!.total;
    if (better) best = i;
  }
  const count = rows[best]!.total;
  let ties = 0;
  for (let i = 0; i < rows.length; i++) if (i !== best && rows[i]!.total === count) ties++;
  return { key: key(rows[best]!), count, share: count / used, ties };
}

function monthLabel(index: number): string {
  const y = Math.floor(index / 12);
  return `${String(y).padStart(4, "0")}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** The offset to use and whether it differs from what the caller passed. */
function resolveOffset(requested: number | undefined): { minutes: number; adjusted: boolean } {
  if (requested === undefined) return { minutes: 0, adjusted: false };
  if (!Number.isFinite(requested)) return { minutes: 0, adjusted: true };
  const rounded = Math.round(requested);
  const minutes = Math.min(MAX_OFFSET, Math.max(MIN_OFFSET, rounded));
  return { minutes, adjusted: minutes !== requested };
}

export function computeHabits(events: readonly HabitEvent[], options: HabitsOptions): HabitsResult {
  const notes: HabitsNote[] = [];
  const { minutes: offset, adjusted } = resolveOffset(options.utcOffsetMinutes);
  const offsetMs = offset * MINUTE_MS;
  const now = options.now;

  // Counts live in typed arrays indexed by direction (0 sent, 1 received, 2 unknown), so a million events cost a few typed-array
  // writes each: no object per event, no Date per event (a day's month is worked out once), no Set of days.
  const hourCounts = new Uint32Array(24 * 3);
  const weekdayCounts = new Uint32Array(7 * 3);
  const monthCounts = new Uint32Array(MONTH_SLOTS * 3);
  const dayMonth = new Int32Array(DAY_SLOTS); // month slot + 1 of each day seen, 0 when the day has not been seen
  const sums = new Uint32Array(3);
  const totals = { ...emptyCounts(), events: events.length, used: 0, undated: 0, future: 0 };
  const times = new Float64Array(events.length);
  const dayOf = new Int32Array(events.length); // the day slot of each used time, for sorting the times by day
  const dayCounts = new Uint32Array(DAY_SLOTS);
  let usedCount = 0;
  let activeDays = 0;
  let first: number | null = null;
  let last: number | null = null;

  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const at = e?.at;
    if (typeof at !== "number" || !Number.isFinite(at) || at <= 0 || at > MAX_EVENT_TIME) {
      totals.undated++;
      continue;
    }
    if (!(at <= now)) {
      totals.future++;
      continue;
    }
    const direction = e?.direction;
    const d = direction === "sent" ? 0 : direction === "received" ? 1 : 2;
    const shifted = at + offsetMs;
    const day = Math.floor(shifted / DAY_MS);
    const hour = Math.floor((shifted - day * DAY_MS) / HOUR_MS);
    const weekday = modulo(day + 4, 7); // 1970-01-01 was a Thursday
    const dayIndex = day + 1; // the earliest shifted time is a day before the epoch
    let slot = dayMonth[dayIndex]!;
    if (slot === 0) {
      const dt = new Date(day * DAY_MS);
      slot = dt.getUTCFullYear() * 12 + dt.getUTCMonth() - MONTH_ORIGIN + 1;
      dayMonth[dayIndex] = slot;
      activeDays++;
    }
    sums[d]!++;
    hourCounts[hour * 3 + d]!++;
    weekdayCounts[weekday * 3 + d]!++;
    monthCounts[(slot - 1) * 3 + d]!++;
    dayCounts[dayIndex]!++;
    dayOf[usedCount] = dayIndex;
    times[usedCount++] = at;
    if (first === null || at < first) first = at;
    if (last === null || at > last) last = at;
  }
  totals.sent = sums[0]!;
  totals.received = sums[1]!;
  totals.unknown = sums[2]!;
  totals.total = usedCount;
  totals.used = usedCount;

  const countsOf = (counts: Uint32Array, at: number): DirectionCounts => {
    const sent = counts[at * 3]!;
    const received = counts[at * 3 + 1]!;
    const unknown = counts[at * 3 + 2]!;
    return { total: sent + received + unknown, sent, received, unknown };
  };
  const byHour: HourBucket[] = Array.from({ length: 24 }, (_, hour) => ({ hour, ...countsOf(hourCounts, hour) }));
  const byWeekday: WeekdayBucket[] = Array.from({ length: 7 }, (_, weekday) => ({ weekday, ...countsOf(weekdayCounts, weekday) }));

  const byMonth: MonthBucket[] = [];
  if (usedCount > 0) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = 0; k < MONTH_SLOTS; k++) {
      if (monthCounts[k * 3]! + monthCounts[k * 3 + 1]! + monthCounts[k * 3 + 2]! === 0) continue;
      if (k < lo) lo = k;
      if (k > hi) hi = k;
    }
    for (let k = lo; k <= hi; k++) byMonth.push({ month: monthLabel(k + MONTH_ORIGIN), ...countsOf(monthCounts, k) });
  }

  // The median gap between consecutive times. The times are put in order by days first (a counting pass) and only each day's few
  // times are sorted, then the gaps are found in place and the middle one is selected without sorting them (quickselect). That
  // keeps a million events to a fraction of a second.
  let medianGapMs: number | null = null;
  if (usedCount >= 2) {
    const starts = new Uint32Array(DAY_SLOTS + 1);
    for (let d = 0; d < DAY_SLOTS; d++) starts[d + 1] = starts[d]! + dayCounts[d]!;
    const next = starts.slice(0, DAY_SLOTS);
    const sorted = new Float64Array(usedCount);
    for (let i = 0; i < usedCount; i++) sorted[next[dayOf[i]!]!++] = times[i]!;
    for (let d = 0; d < DAY_SLOTS; d++) if (dayCounts[d]! > 1) sorted.subarray(starts[d], starts[d + 1]).sort();
    const n = usedCount - 1;
    for (let i = 0; i < n; i++) sorted[i] = sorted[i + 1]! - sorted[i]!;
    const gaps = sorted.subarray(0, n);
    const mid = n >> 1;
    const upper = selectKth(gaps, mid);
    if (n % 2 === 1) medianGapMs = upper;
    else {
      let lower = -Infinity;
      for (let i = 0; i < mid; i++) if (gaps[i]! > lower) lower = gaps[i]!;
      medianGapMs = Math.round((lower + upper) / 2);
    }
  }

  const known = totals.sent + totals.received;
  const used = totals.used;

  if (events.length === 0) notes.push({ code: "no-events", params: {} });
  else if (used === 0) notes.push({ code: "no-usable-events", params: {} });
  if (totals.undated > 0) notes.push({ code: "undated-skipped", params: { count: totals.undated } });
  if (totals.future > 0) notes.push({ code: "future-skipped", params: { count: totals.future } });
  if (used > 0 && used < FEW_EVENTS) notes.push({ code: "few-events", params: { count: used } });
  if (used > 0 && totals.unknown / used > MANY_UNKNOWN_SHARE) {
    notes.push({
      code: "many-unknown-direction",
      params: { count: totals.unknown, percent: Math.round((totals.unknown / used) * 100) },
    });
  }
  if (adjusted) notes.push({ code: "offset-adjusted", params: { minutes: offset } });

  return {
    utcOffsetMinutes: offset,
    totals,
    byHour,
    byWeekday,
    byMonth,
    sentShare: known > 0 ? totals.sent / known : null,
    busiest: {
      hour: peak(byHour, (b) => b.hour, true, used),
      weekday: peak(byWeekday, (b) => b.weekday, true, used),
      month: peak(byMonth, (b) => b.month, true, used),
    },
    quietest: {
      hour: peak(byHour, (b) => b.hour, false, used),
      weekday: peak(byWeekday, (b) => b.weekday, false, used),
      month: byMonth.length >= 2 ? peak(byMonth, (b) => b.month, false, used) : null,
    },
    medianGapMs,
    activeDays,
    first,
    last,
    notes,
  };
}
