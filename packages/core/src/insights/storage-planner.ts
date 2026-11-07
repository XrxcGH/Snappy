/**
 * Memories storage planner (offline, pure, content-blind).
 *
 * Builds on memories/plan.ts (duplicate removal and the storage meter) and adds totals by year,
 * type and zip part, how much fits under a storage goal, a download order, and size-capped
 * batches. Only dates, media types, sizes and zip part numbers are read. No username, URL or
 * path is copied into the result; the only item text in it is the opaque ids listed in `batches`.
 *
 * Defaults (all overridable):
 *  - Order: newest year first by default, so recent Memories are saved first. Undated items
 *    always last. Inside a year: images, then videos, then unknown (photos are
 *    small and many, so they cover the most memories per byte). Inside a type: oldest first.
 *  - Goal: the caller's bytes. A goal that is not a positive number falls back to the 5 GiB
 *    default that plan.ts uses (an unverified figure) and a note says so.
 *  - Batch size: 1 GiB. Batches are filled in download order and a new one starts when the next
 *    item would not fit (next-fit), so a batch never mixes distant years more than it must.
 *    An item larger than a batch gets its own batch, flagged `oversize`.
 *  - "Fits" is a prefix of the download order: items are taken until the first one that would
 *    pass the goal, then everything after is deferred. That is predictable and easy to explain.
 *  - Items without a known size cannot be budgeted: they are counted (so the total is a lower
 *    bound) but are left out of the fit and the batches.
 *  - A date that is missing, implausible, or later than `now` (when given) counts as undated.
 *
 * Nothing here reads the clock: `now` is a parameter. Results are deterministic.
 */
import type { MemoryItem, MemoryMediaType, StorageMeter } from "../types.ts";
import { planMemories } from "../memories/plan.ts";

export type StoragePlanOrder = "newest-first" | "oldest-first";

export interface StoragePlanOptions {
  /** Download order of years. Default "newest-first". */
  order?: StoragePlanOrder;
  /** Largest size of one batch, in bytes. Default 1 GiB. */
  batchBytes?: number;
  /** Epoch ms. Enables the future-date check and the meter's cap projection. */
  now?: number;
}

/** Counts and bytes for one group of memories. */
export interface PlanTally {
  items: number;
  /** Sum of the known sizes. A lower bound when `unsized` is above 0. */
  knownBytes: number;
  /** Items with no usable size. */
  unsized: number;
}

export type PlanFit = "all" | "part" | "none" | "unsized";

export interface PlanYearRow extends PlanTally {
  /** UTC year; null for undated items. */
  year: number | null;
  /** Share of all known bytes, 0..1. */
  share: number;
  byType: Record<MemoryMediaType, PlanTally>;
  fit: PlanFit;
  fitItems: number;
  fitBytes: number;
}

export interface PlanTypeRow extends PlanTally {
  type: MemoryMediaType;
  share: number;
}

export interface PlanPartRow extends PlanTally {
  /** 1-based zip part; null when the item is not tied to a bundled file. */
  part: number | null;
}

/** One (year, type) group, listed in download order. */
export interface PlanCell extends PlanTally {
  year: number | null;
  type: MemoryMediaType;
  fit: PlanFit;
  fitItems: number;
  fitBytes: number;
}

export interface PlanBatch {
  /** 1-based, in download order. */
  index: number;
  items: number;
  bytes: number;
  /** True when this single item is larger than the batch size. */
  oversize: boolean;
  /** Year of the first and the last item in download order (null: undated). */
  firstYear: number | null;
  lastYear: number | null;
  /** Zip parts the batch draws from, ascending. Empty when none is known. */
  parts: number[];
  /** Opaque memory ids in download order. */
  itemIds: string[];
}

/** Stable machine code plus numbers only, for the CLI and dashboard to word later. */
export interface PlanNote {
  code:
    | "empty"
    | "goal-defaulted"
    | "batch-size-defaulted"
    | "lower-bound"
    | "over-goal"
    | "undated-items"
    | "future-dates"
    | "oversize-items"
    | "duplicates-skipped";
  params: Record<string, number>;
}

export interface StoragePlan {
  goalBytes: number;
  batchBytes: number;
  order: StoragePlanOrder;
  totals: PlanTally & {
    /** Probable duplicates (by plan.ts) left out of every number here. */
    duplicatesSkipped: number;
    /** True when some sizes are unknown, so `knownBytes` is a floor. */
    isLowerBound: boolean;
  };
  /** Years in calendar order, undated last. */
  byYear: PlanYearRow[];
  /** Always image, video, unknown. */
  byType: PlanTypeRow[];
  /** Ascending by part, no-part last. */
  byPart: PlanPartRow[];
  /**
   * Covers items with a known size only. When `totals.isLowerBound` is true, `fitsAll` and
   * `fractionOfGoal` say nothing about the unsized items, so check the flag and the
   * `lower-bound` note before reading them as "everything fits".
   */
  fit: {
    fitsAll: boolean;
    items: number;
    bytes: number;
    deferredItems: number;
    deferredBytes: number;
    /** knownBytes / goal; above 1 means over the goal. */
    fractionOfGoal: number;
  };
  /** (year, type) groups in the order to download them. */
  priority: PlanCell[];
  /** Batches of the items that fit, each within `batchBytes` unless flagged oversize. */
  batches: PlanBatch[];
  /** Duplicate-free storage meter from plan.ts (growth and cap projection need `now`). */
  meter: StorageMeter;
  notes: PlanNote[];
}

const DEFAULT_BATCH_BYTES = 1024 ** 3;
const DATE_LOW = Date.UTC(1990, 0, 1);
const DATE_HIGH = Date.UTC(2100, 0, 1);
const TYPES: readonly MemoryMediaType[] = ["image", "video", "unknown"];
const TYPE_RANK: Record<MemoryMediaType, number> = { image: 0, video: 1, unknown: 2 };

interface Rec {
  id: string;
  year: number | null;
  date: number | null;
  type: MemoryMediaType;
  size: number | null;
  part: number | null;
  fit: boolean;
}

const tally = (): PlanTally => ({ items: 0, knownBytes: 0, unsized: 0 });

function add(t: PlanTally, size: number | null): void {
  t.items++;
  if (size === null) t.unsized++;
  else t.knownBytes += size;
}

const isPositive = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

function fitState(sized: number, fitted: number): PlanFit {
  return sized === 0 ? "unsized" : fitted === 0 ? "none" : fitted === sized ? "all" : "part";
}

/** Plain code-unit comparison: the same answer on every machine and locale. */
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
/** Numeric comparison where Infinity equals Infinity (a subtraction would give NaN). */
const num = (a: number, b: number): number => (a < b ? -1 : a > b ? 1 : 0);

export function planMemoryStorage(items: MemoryItem[], goalBytes: number, opts: StoragePlanOptions = {}): StoragePlan {
  const order: StoragePlanOrder = opts.order === "oldest-first" ? "oldest-first" : "newest-first";
  const now = typeof opts.now === "number" && Number.isFinite(opts.now) ? opts.now : undefined;
  const notes: PlanNote[] = [];

  // plan.ts removes probable duplicates and validates the goal (falling back to its default).
  const base = planMemories(items, { layout: "flat", capBytes: goalBytes, now });
  const goal = base.meter.capBytes;
  const batchBytes = isPositive(opts.batchBytes) ? opts.batchBytes : DEFAULT_BATCH_BYTES;
  if (!isPositive(goalBytes)) notes.push({ code: "goal-defaulted", params: {} });
  if (opts.batchBytes !== undefined && !isPositive(opts.batchBytes)) {
    notes.push({ code: "batch-size-defaulted", params: {} });
  }

  // One pass: normalize every item and fill the tallies.
  const recs: Rec[] = [];
  const totals = tally();
  const years = new Map<number | null, { row: PlanTally; byType: Record<MemoryMediaType, PlanTally> }>();
  const types: Record<MemoryMediaType, PlanTally> = { image: tally(), video: tally(), unknown: tally() };
  const parts = new Map<number | null, PlanTally>();
  const cells = new Map<string, PlanCell>();
  let futureDated = 0;

  for (const { item } of base.entries) {
    const type: MemoryMediaType = item.mediaType === "image" || item.mediaType === "video" ? item.mediaType : "unknown";
    const size = typeof item.sizeBytes === "number" && Number.isFinite(item.sizeBytes) && item.sizeBytes >= 0
      ? item.sizeBytes
      : null;
    const part = Number.isInteger(item.partIndex) && (item.partIndex as number) > 0 ? (item.partIndex as number) : null;

    let date: number | null = null;
    let year: number | null = null;
    if (typeof item.date === "number" && Number.isFinite(item.date) && item.date >= DATE_LOW && item.date <= DATE_HIGH) {
      if (now !== undefined && item.date > now) futureDated++;
      else {
        date = item.date;
        year = new Date(date).getUTCFullYear();
      }
    }

    recs.push({ id: item.id, year, date, type, size, part, fit: false });
    add(totals, size);
    add(types[type], size);
    let y = years.get(year);
    if (!y) years.set(year, (y = { row: tally(), byType: { image: tally(), video: tally(), unknown: tally() } }));
    add(y.row, size);
    add(y.byType[type], size);
    let p = parts.get(part);
    if (!p) parts.set(part, (p = tally()));
    add(p, size);
    const key = `${year}|${type}`;
    let c = cells.get(key);
    if (!c) {
      cells.set(key, (c = { year, type, ...tally(), fit: "unsized", fitItems: 0, fitBytes: 0 }));
    }
    add(c, size);
  }

  // Download order: year (newest or oldest first, undated last), type, date, id.
  const yearRank = (y: number | null): number => (y === null ? Infinity : order === "newest-first" ? -y : y);
  const sized = recs.filter((r) => r.size !== null);
  sized.sort(
    (a, b) =>
      num(yearRank(a.year), yearRank(b.year)) ||
      num(TYPE_RANK[a.type], TYPE_RANK[b.type]) ||
      num(a.date ?? Infinity, b.date ?? Infinity) ||
      cmp(a.id, b.id),
  );

  // Fit: a prefix of the download order, stopping at the first item that passes the goal.
  const yearFit = new Map<number | null, { items: number; bytes: number; sized: number }>();
  let used = 0;
  let open = true;
  let fitItems = 0;
  for (const r of sized) {
    const size = r.size as number;
    const yf = yearFit.get(r.year) ?? { items: 0, bytes: 0, sized: 0 };
    yearFit.set(r.year, yf);
    yf.sized++;
    const cell = cells.get(`${r.year}|${r.type}`) as PlanCell;
    if (open && used + size <= goal) {
      used += size;
      r.fit = true;
      fitItems++;
      yf.items++;
      yf.bytes += size;
      cell.fitItems++;
      cell.fitBytes += size;
    } else open = false;
  }

  // Batches: next-fit over the items that fit.
  const batches: PlanBatch[] = [];
  let cur: { rec: Rec[]; bytes: number } | null = null;
  const close = (): void => {
    if (!cur) return;
    const ys = cur.rec.map((r) => r.year);
    const ps = [...new Set(cur.rec.map((r) => r.part).filter((n): n is number => n !== null))].sort((a, b) => a - b);
    batches.push({
      index: batches.length + 1,
      items: cur.rec.length,
      bytes: cur.bytes,
      oversize: cur.rec.length === 1 && cur.bytes > batchBytes,
      firstYear: ys[0] ?? null,
      lastYear: ys[ys.length - 1] ?? null,
      parts: ps,
      itemIds: cur.rec.map((r) => r.id),
    });
    cur = null;
  };
  for (const r of sized) {
    if (!r.fit) continue;
    const size = r.size as number;
    if (cur && cur.bytes + size > batchBytes) close();
    if (!cur) cur = { rec: [], bytes: 0 };
    cur.rec.push(r);
    cur.bytes += size;
  }
  close();

  // Assemble rows.
  const share = (n: number): number => (totals.knownBytes > 0 ? n / totals.knownBytes : 0);
  const byYear: PlanYearRow[] = [...years.entries()]
    .sort(([a], [b]) => num(a ?? Infinity, b ?? Infinity))
    .map(([year, { row, byType }]) => {
      const yf = yearFit.get(year) ?? { items: 0, bytes: 0, sized: 0 };
      return {
        year,
        ...row,
        share: share(row.knownBytes),
        byType,
        fit: fitState(yf.sized, yf.items),
        fitItems: yf.items,
        fitBytes: yf.bytes,
      };
    });
  const byType: PlanTypeRow[] = TYPES.map((type) => ({ type, ...types[type], share: share(types[type].knownBytes) }));
  const byPart: PlanPartRow[] = [...parts.entries()]
    .sort(([a], [b]) => num(a ?? Infinity, b ?? Infinity))
    .map(([part, t]) => ({ part, ...t }));
  const priority = [...cells.values()].sort(
    (a, b) => num(yearRank(a.year), yearRank(b.year)) || num(TYPE_RANK[a.type], TYPE_RANK[b.type]),
  );
  for (const c of priority) c.fit = fitState(c.items - c.unsized, c.fitItems);

  const sizedCount = sized.length;
  const deferredItems = sizedCount - fitItems;
  const sizedBytes = totals.knownBytes;

  if (recs.length === 0) notes.push({ code: "empty", params: {} });
  if (totals.unsized > 0) notes.push({ code: "lower-bound", params: { unsized: totals.unsized } });
  if (deferredItems > 0) notes.push({ code: "over-goal", params: { deferredItems } });
  const undated = years.get(null)?.row.items ?? 0;
  if (undated - futureDated > 0) notes.push({ code: "undated-items", params: { items: undated - futureDated } });
  if (futureDated > 0) notes.push({ code: "future-dates", params: { items: futureDated } });
  const oversize = batches.filter((b) => b.oversize).length;
  if (oversize > 0) notes.push({ code: "oversize-items", params: { items: oversize } });
  if (base.duplicates.length > 0) notes.push({ code: "duplicates-skipped", params: { items: base.duplicates.length } });

  return {
    goalBytes: goal,
    batchBytes,
    order,
    totals: { ...totals, duplicatesSkipped: base.duplicates.length, isLowerBound: totals.unsized > 0 },
    byYear,
    byType,
    byPart,
    fit: {
      fitsAll: deferredItems === 0,
      items: fitItems,
      bytes: used,
      deferredItems,
      deferredBytes: sizedBytes - used,
      fractionOfGoal: sizedBytes / goal,
    },
    priority,
    batches,
    meter: base.meter,
    notes,
  };
}
