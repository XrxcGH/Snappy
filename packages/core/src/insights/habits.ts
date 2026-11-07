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

const emptyCounts = (): DirectionCounts => ({ total: 0, sent: 0, received: 0, unknown: 0 });

function bump(c: DirectionCounts, d: HabitDirection): void {
  c.total++;
  c[d]++;
}

function toDirection(v: unknown): HabitDirection {
  return v === "sent" || v === "received" ? v : "unknown";
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

  const byHour: HourBucket[] = Array.from({ length: 24 }, (_, hour) => ({ hour, ...emptyCounts() }));
  const byWeekday: WeekdayBucket[] = Array.from({ length: 7 }, (_, weekday) => ({ weekday, ...emptyCounts() }));
  const monthCounts = new Map<number, DirectionCounts>();
  const days = new Set<number>();
  const totals = { ...emptyCounts(), events: events.length, used: 0, undated: 0, future: 0 };
  const times: number[] = [];
  let first: number | null = null;
  let last: number | null = null;

  for (const e of events) {
    const at = e?.at;
    if (typeof at !== "number" || !Number.isFinite(at) || at <= 0 || at > MAX_EVENT_TIME) {
      totals.undated++;
      continue;
    }
    if (!(at <= now)) {
      totals.future++;
      continue;
    }
    const d = toDirection(e.direction);
    const shifted = at + offsetMs;
    const day = Math.floor(shifted / DAY_MS);
    const hour = Math.floor(modulo(shifted, DAY_MS) / HOUR_MS);
    const weekday = modulo(day + 4, 7); // 1970-01-01 was a Thursday
    const dt = new Date(shifted);
    const monthIndex = dt.getUTCFullYear() * 12 + dt.getUTCMonth();

    bump(totals, d);
    bump(byHour[hour]!, d);
    bump(byWeekday[weekday]!, d);
    let m = monthCounts.get(monthIndex);
    if (!m) monthCounts.set(monthIndex, (m = emptyCounts()));
    bump(m, d);
    days.add(day);
    times.push(at);
    if (first === null || at < first) first = at;
    if (last === null || at > last) last = at;
  }
  totals.used = totals.total;

  const byMonth: MonthBucket[] = [];
  if (monthCounts.size > 0) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const k of monthCounts.keys()) {
      if (k < lo) lo = k;
      if (k > hi) hi = k;
    }
    for (let k = lo; k <= hi; k++) byMonth.push({ month: monthLabel(k), ...(monthCounts.get(k) ?? emptyCounts()) });
  }

  let medianGapMs: number | null = null;
  if (times.length >= 2) {
    const sorted = Float64Array.from(times).sort();
    const gaps = new Float64Array(sorted.length - 1);
    for (let i = 1; i < sorted.length; i++) gaps[i - 1] = sorted[i]! - sorted[i - 1]!;
    gaps.sort();
    const mid = gaps.length >> 1;
    medianGapMs = gaps.length % 2 === 1 ? gaps[mid]! : Math.round((gaps[mid - 1]! + gaps[mid]!) / 2);
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
    activeDays: days.size,
    first,
    last,
    notes,
  };
}
