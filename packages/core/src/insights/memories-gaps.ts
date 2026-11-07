/**
 * "Memories timeline gaps" (pure, offline, deterministic).
 *
 * Input is the parsed Memories list; only each item's `date` (and its `id`, solely to skip exact
 * repeats) is read. The result carries counts, calendar months and machine-coded notes: no ids, no
 * file names, no paths, no text. A gap says "no Memories were found in these months", which may
 * simply mean nothing was saved then; it never says anything was lost.
 *
 * What it returns (`findMemoryGaps`)
 *  - `months`          a dense month-by-month count from the first to the last month with items
 *  - `gaps`            runs of empty months of at least `minGapMonths`, in date order, each tagged:
 *                        "middle"  between two months that have items
 *                        "start"   before the first item, back to the optional `since` date
 *                        "end"     after the last item, up to the reference date (see below)
 *  - `busiestMonth`    the single month with the most items
 *  - `busiestStretch`  the run of `stretchMonths` consecutive months with the most items
 *  - `counts`          dated / undated / future / repeated-id items
 *
 * Defaults (all overridable; invalid values fall back and say so in a note)
 *  - minGapMonths 2    a gap is at least 2 empty calendar months in a row (range 1..120)
 *  - stretchMonths 3   the busiest stretch is 3 months wide (range 1..24); a shorter range uses all of it
 *  - utcOffsetMinutes 0
 *
 * Conventions
 *  - Time is a parameter: `now` (epoch ms) is required, the clock is never read.
 *  - A memory belongs to the calendar month it falls in after adding the UTC offset (whole minutes
 *    within +-840; anything else is ignored with a note). A fixed offset ignores daylight saving.
 *  - Unusable dates (null, not finite, outside 1990..2100) are "undated"; dates after `now` are
 *    "future" (likely a wrong camera clock). Both are counted and left out of the months and gaps.
 *  - An id that repeats exactly is counted once (first wins); ids that differ by case are different.
 *    Items without an id are all kept.
 *  - Only whole empty months count: the month holding the boundary date (`since`, or the reference
 *    date) is partial, so it never counts toward a start or end gap.
 *  - The first item's month is the start of the range, so a "start" gap needs `since`: pass the
 *    earliest date the account is known to be active (for instance the oldest friendship date).
 *    Without it there is no start gap. Callers read that date themselves; nothing new is parsed here.
 *  - The reference date for an "end" gap is the earlier of `now` and `exportedAt`, so months after
 *    the export was made are never reported as a gap.
 *  - Export hint: a date range chosen for the export cuts the data at its start or end, never in the
 *    middle. When `issueCodes` (the `code` of the export's validation issues) include a "may be
 *    date-limited" code, "start" and "end" gaps carry `exportHint: true` and a note counts them.
 *    Only codes are read, never issue text.
 *  - Ties (busiest month, busiest stretch) go to the earliest. All ordering is by date.
 */

// ------------------------------------------------------------------ types ---

export interface MemoryGapsOptions {
  /** Epoch ms "now". Dates after it are counted as future. */
  now: number;
  /** Minutes east of UTC (e.g. -300 for UTC-5). Default 0. */
  utcOffsetMinutes?: number;
  /** Shortest gap to report, in empty calendar months. Default 2, whole number 1..120. */
  minGapMonths?: number;
  /** Width of the busiest stretch, in months. Default 3, whole number 1..24. */
  stretchMonths?: number;
  /** Earliest date (epoch ms) the account is known to have been active; enables a "start" gap. */
  since?: number;
  /** When the export was made (epoch ms), if known. Months after it are not a gap. */
  exportedAt?: number;
  /** Codes (never text) of the export's validation issues, used only for the date-limited hint. */
  issueCodes?: readonly string[];
}

/** A stable code plus whole-number params. The front end turns codes into wording. */
export interface GapNote {
  code:
    | "offset-invalid"
    | "now-invalid"
    | "min-gap-adjusted"
    | "stretch-adjusted"
    | "since-invalid"
    | "exported-at-invalid"
    | "exported-at-future"
    | "undated-items"
    | "future-dates-skipped"
    | "duplicate-ids-skipped"
    | "no-dated-items"
    | "single-month"
    | "no-gaps"
    | "gaps-may-be-quiet-time"
    | "gap-near-limited-export";
  params: Record<string, number>;
}

export interface YearMonth {
  year: number;
  /** 1..12 */
  month: number;
}

export interface MonthCount extends YearMonth {
  count: number;
}

export type GapKind = "start" | "middle" | "end";

export interface MemoryGap {
  kind: GapKind;
  /** First and last empty month of the gap (inclusive). */
  from: YearMonth;
  to: YearMonth;
  /** Empty calendar months in a row (at least `minGapMonths`). */
  months: number;
  /** True for a start or end gap when the export looks date-limited. */
  exportHint: boolean;
}

export interface BusiestStretch {
  from: YearMonth;
  to: YearMonth;
  /** Months in the stretch (`stretchMonths`, or fewer when the range is shorter). */
  months: number;
  count: number;
  /** Whole percent of all dated items (0..100). */
  sharePercent: number;
}

export interface MemoryGapCounts {
  /** Items given. */
  input: number;
  /** Items after exact repeated ids were dropped: dated + undated + future. */
  unique: number;
  /** In the months. */
  dated: number;
  undated: number;
  future: number;
  duplicateIds: number;
}

export interface MemoryGapRange {
  first: YearMonth;
  last: YearMonth;
  /** Calendar months from first to last, inclusive. */
  months: number;
  activeMonths: number;
  emptyMonths: number;
}

export interface MemoryGapsResult {
  /** The settings actually used. */
  utcOffsetMinutes: number;
  minGapMonths: number;
  stretchMonths: number;
  counts: MemoryGapCounts;
  /** Null when nothing is dated. */
  range: MemoryGapRange | null;
  /** Every month from the first to the last with items, oldest first (empty months included). */
  months: MonthCount[];
  /** Gaps of at least `minGapMonths`, in date order. */
  gaps: MemoryGap[];
  /** Months in the longest reported gap (0 when none). */
  longestGapMonths: number;
  busiestMonth: MonthCount | null;
  busiestStretch: BusiestStretch | null;
  notes: GapNote[];
}

// ---------------------------------------------------------------- helpers ---

/** Dates outside this window are garbage (same window as util.toMs). */
const DATE_LOW = Date.UTC(1990, 0, 1);
const DATE_HIGH = Date.UTC(2100, 0, 1);
/** Real UTC offsets run from -12:00 to +14:00. */
const MAX_OFFSET_MINUTES = 14 * 60;
const DEFAULT_MIN_GAP_MONTHS = 2;
const MAX_MIN_GAP_MONTHS = 120;
const DEFAULT_STRETCH_MONTHS = 3;
const MAX_STRETCH_MONTHS = 24;

/** Validation issue codes that say a date range may have cut the export (keep in step with export/validate.ts). */
const LIMITED_CODES: readonly string[] = ["friends-empty-but-deleted", "possibly-date-limited", "friend-count-mismatch"];

const isUsableDate = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= DATE_LOW && v <= DATE_HIGH;

/** Month number: year * 12 + (month - 1), after adding the offset. */
function monthKeyOf(ms: number, offsetMs: number): number {
  const d = new Date(ms + offsetMs);
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

const ymOf = (key: number): YearMonth => ({ year: Math.floor(key / 12), month: (key % 12) + 1 });

/** A whole number clamped to [1, max]; a note is added when the value had to change. */
function clampWhole(raw: number | undefined, fallback: number, max: number): { value: number; changed: boolean } {
  if (raw === undefined) return { value: fallback, changed: false };
  const v = Number.isFinite(raw) ? Math.min(Math.max(Math.floor(raw), 1), max) : fallback;
  return { value: v, changed: v !== raw };
}

// ------------------------------------------------------------------- main ---

/** Month-by-month counts, gaps, the busiest stretch and undated items. Linear in items plus months. */
export function findMemoryGaps(
  memories: ReadonlyArray<{ id?: string; date: number | null | undefined }>,
  opts: MemoryGapsOptions,
): MemoryGapsResult {
  const notes: GapNote[] = [];

  let offset = 0;
  const rawOffset = opts?.utcOffsetMinutes;
  if (rawOffset !== undefined) {
    if (Number.isFinite(rawOffset) && Math.abs(rawOffset) <= MAX_OFFSET_MINUTES) offset = Math.round(rawOffset);
    else notes.push({ code: "offset-invalid", params: {} });
  }
  const offsetMs = offset * 60_000;

  const now = opts?.now;
  const nowOk = typeof now === "number" && Number.isFinite(now);
  if (!nowOk) notes.push({ code: "now-invalid", params: {} });

  const gapOpt = clampWhole(opts?.minGapMonths, DEFAULT_MIN_GAP_MONTHS, MAX_MIN_GAP_MONTHS);
  if (gapOpt.changed) notes.push({ code: "min-gap-adjusted", params: { minGapMonths: gapOpt.value } });
  const stretchOpt = clampWhole(opts?.stretchMonths, DEFAULT_STRETCH_MONTHS, MAX_STRETCH_MONTHS);
  if (stretchOpt.changed) notes.push({ code: "stretch-adjusted", params: { stretchMonths: stretchOpt.value } });
  const minGap = gapOpt.value;
  const stretchWidth = stretchOpt.value;

  // Count items per month key.
  const seen = new Set<string>();
  const perMonth = new Map<number, number>();
  let undated = 0;
  let future = 0;
  let duplicateIds = 0;
  let unique = 0;
  let firstKey = Infinity;
  let lastKey = -Infinity;
  for (const m of memories) {
    const id = m?.id;
    if (typeof id === "string" && id !== "") {
      if (seen.has(id)) {
        duplicateIds++;
        continue;
      }
      seen.add(id);
    }
    unique++;
    const at = m?.date;
    if (!isUsableDate(at)) {
      undated++;
    } else if (nowOk && at > now) {
      future++;
    } else {
      const key = monthKeyOf(at, offsetMs);
      perMonth.set(key, (perMonth.get(key) ?? 0) + 1);
      if (key < firstKey) firstKey = key;
      if (key > lastKey) lastKey = key;
    }
  }
  const dated = unique - undated - future;

  if (undated) notes.push({ code: "undated-items", params: { count: undated } });
  if (future) notes.push({ code: "future-dates-skipped", params: { count: future } });
  if (duplicateIds) notes.push({ code: "duplicate-ids-skipped", params: { count: duplicateIds } });

  const counts: MemoryGapCounts = { input: memories.length, unique, dated, undated, future, duplicateIds };
  const base = { utcOffsetMinutes: offset, minGapMonths: minGap, stretchMonths: stretchWidth, counts };

  if (!dated) {
    notes.push({ code: "no-dated-items", params: {} });
    return { ...base, range: null, months: [], gaps: [], longestGapMonths: 0, busiestMonth: null, busiestStretch: null, notes };
  }

  // Dense month series.
  const series: MonthCount[] = [];
  for (let k = firstKey; k <= lastKey; k++) series.push({ ...ymOf(k), count: perMonth.get(k) ?? 0 });
  const monthsInRange = series.length;
  const activeMonths = perMonth.size;
  if (monthsInRange === 1) notes.push({ code: "single-month", params: {} });

  // Reference dates for the start and end gaps.
  let sinceKey: number | null = null;
  if (opts.since !== undefined) {
    if (isUsableDate(opts.since) && (!nowOk || opts.since <= now)) sinceKey = monthKeyOf(opts.since, offsetMs);
    else notes.push({ code: "since-invalid", params: {} });
  }
  let refMs: number | null = nowOk ? now : null;
  if (opts.exportedAt !== undefined) {
    if (!isUsableDate(opts.exportedAt)) notes.push({ code: "exported-at-invalid", params: {} });
    else if (nowOk && opts.exportedAt > now) notes.push({ code: "exported-at-future", params: {} });
    else refMs = refMs === null ? opts.exportedAt : Math.min(refMs, opts.exportedAt);
  }
  const refKey = refMs === null ? null : monthKeyOf(refMs, offsetMs);

  const limited = Array.isArray(opts.issueCodes) && opts.issueCodes.some((c) => LIMITED_CODES.includes(c));

  // Gaps, in date order.
  const gaps: MemoryGap[] = [];
  const push = (kind: GapKind, fromKey: number, toKey: number): void => {
    const months = toKey - fromKey + 1;
    if (months < minGap) return;
    gaps.push({ kind, from: ymOf(fromKey), to: ymOf(toKey), months, exportHint: limited && kind !== "middle" });
  };
  // Only whole months strictly between the boundary month and the first/last item month count.
  if (sinceKey !== null) push("start", sinceKey + 1, firstKey - 1);
  let runStart = -1;
  for (let k = firstKey + 1; k <= lastKey; k++) {
    if (!perMonth.has(k)) {
      if (runStart < 0) runStart = k;
    } else if (runStart >= 0) {
      push("middle", runStart, k - 1);
      runStart = -1;
    }
  }
  if (refKey !== null) push("end", lastKey + 1, refKey - 1);

  if (!gaps.length) notes.push({ code: "no-gaps", params: {} });
  else {
    notes.push({ code: "gaps-may-be-quiet-time", params: { count: gaps.length } });
    const hinted = gaps.filter((g) => g.exportHint).length;
    if (hinted) notes.push({ code: "gap-near-limited-export", params: { count: hinted } });
  }

  // Busiest month: earliest wins ties.
  let busiestMonth: MonthCount = series[0]!;
  for (const s of series) if (s.count > busiestMonth.count) busiestMonth = s;

  // Busiest stretch: sliding window; earliest wins ties.
  const width = Math.min(stretchWidth, monthsInRange);
  let sum = 0;
  for (let i = 0; i < width; i++) sum += series[i]!.count;
  let best = sum;
  let bestStart = 0;
  for (let i = width; i < monthsInRange; i++) {
    sum += series[i]!.count - series[i - width]!.count;
    if (sum > best) {
      best = sum;
      bestStart = i - width + 1;
    }
  }
  const stretch: BusiestStretch = {
    from: { year: series[bestStart]!.year, month: series[bestStart]!.month },
    to: { year: series[bestStart + width - 1]!.year, month: series[bestStart + width - 1]!.month },
    months: width,
    count: best,
    sharePercent: Math.round((best / dated) * 100),
  };

  return {
    ...base,
    range: {
      first: ymOf(firstKey),
      last: ymOf(lastKey),
      months: monthsInRange,
      activeMonths,
      emptyMonths: monthsInRange - activeMonths,
    },
    months: series,
    gaps,
    longestGapMonths: gaps.reduce((n, g) => Math.max(n, g.months), 0),
    busiestMonth: { ...busiestMonth },
    busiestStretch: stretch,
    notes,
  };
}
