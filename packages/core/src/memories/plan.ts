/**
 * Memories planning + storage meter (Tier A, offline, pure).
 *
 * Turns the parsed memory list into (a) a collision-free relative output path per item,
 * (b) a list of probable duplicates, and (c) a storage meter against a cap.
 *
 * Nothing here reads the clock: "now" is always a parameter.
 */
import type {
  MemoriesPlan,
  MemoriesPlanOptions,
  MemoryItem,
  MemoryMediaType,
  PlannedMemory,
  StorageMeter,
} from "../types.ts";
import { DAY_MS } from "../util.ts";

/**
 * Default storage cap: 5 GiB.
 * UNVERIFIED policy figure (the free-tier Memories allowance is not confirmed anywhere we
 * can check offline and may change), so it is always overridable via `capBytes`.
 */
const DEFAULT_CAP_BYTES = 5 * 1024 ** 3;
const DEFAULT_LOOKBACK_DAYS = 365;
/** Minimum observed history before a growth rate is trusted. */
const MIN_GROWTH_SPAN_DAYS = 30;

/** Dates outside this window are treated as garbage (same window as util.toMs). */
const DATE_LOW = Date.UTC(1990, 0, 1);
const DATE_HIGH = Date.UTC(2100, 0, 1);

type Layout = NonNullable<MemoriesPlanOptions["layout"]>;

/** Extra, optional knobs the contract's MemoriesPlanOptions does not carry. */
type PlanOptions = MemoriesPlanOptions & { now?: number; lookbackDays?: number };

function isValidDate(d: number | null | undefined): d is number {
  return typeof d === "number" && Number.isFinite(d) && d >= DATE_LOW && d <= DATE_HIGH;
}

function isKnownSize(n: number | undefined): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0;
}

/** A size usable as an identity key: an empty (size 0) file is a failed extraction, not a fingerprint. */
function isIdentifyingSize(n: number | undefined): n is number {
  return isKnownSize(n) && n > 0;
}

function safeType(t: unknown): MemoryMediaType {
  return t === "image" || t === "video" ? t : "unknown";
}

/**
 * File extension for the output file. The zipPath extension wins when it is a plain
 * [a-z0-9]{1,5} token; anything else (traversal junk, odd characters, long suffixes) falls
 * back to the media type, so no input-derived text beyond a vetted token reaches the path.
 */
function extensionFor(item: MemoryItem): string {
  const zp = item.zipPath;
  if (typeof zp === "string") {
    const base = zp.slice(Math.max(zp.lastIndexOf("/"), zp.lastIndexOf("\\")) + 1);
    const dot = base.lastIndexOf(".");
    if (dot >= 0) {
      const ext = base.slice(dot + 1).toLowerCase();
      if (/^[a-z0-9]{1,5}$/.test(ext)) return ext;
    }
  }
  const type = safeType(item.mediaType);
  return type === "image" ? "jpg" : type === "video" ? "mp4" : "bin";
}

/**
 * Folder and file name for an item in one pass: formatting a date is the hot spot at 100k
 * items, so it is done once. Names are "YYYY-MM-DD_HHMMSS_<type>_<ordinal>.<ext>" in UTC,
 * or "undated_<type>_<ordinal>.<ext>" without a usable date.
 */
function locate(item: MemoryItem, ordinal: number, layout: Layout): { folder: string; name: string } {
  const n = Number.isFinite(ordinal) ? Math.min(Math.max(Math.floor(ordinal), 0), Number.MAX_SAFE_INTEGER) : 0;
  const tail = `_${safeType(item.mediaType)}_${String(n).padStart(4, "0")}.${extensionFor(item)}`;
  if (!isValidDate(item.date)) return { folder: "undated", name: `undated${tail}` };

  const iso = new Date(item.date).toISOString(); // 1990..2100 guarantees a 4-digit year
  const day = iso.slice(0, 10);
  const name = `${day}_${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}${tail}`;
  if (layout === "flat") return { folder: "", name };
  const year = iso.slice(0, 4);
  return { folder: layout === "year" ? year : `${year}/${iso.slice(0, 7)}`, name };
}

/**
 * File name only: "YYYY-MM-DD_HHMMSS_<type>_<ordinal>.<ext>" (UTC), or
 * "undated_<type>_<ordinal>.<ext>". Every name starts with a digit or "undated", so it can
 * never be a reserved Windows device name (CON, NUL, ...), and no input text except the
 * vetted extension is embedded.
 */
export function memoryFileName(item: MemoryItem, ordinal: number): string {
  return locate(item, ordinal, "flat").name;
}

function plannedPath(item: MemoryItem, ordinal: number, layout: Layout): string {
  const { folder, name } = locate(item, ordinal, layout);
  return folder ? `${folder}/${name}` : name;
}

/**
 * Reserve `path` in `used`, appending -2, -3, ... before the extension on collision.
 * Comparison is case-insensitive because Windows and macOS file systems are.
 */
export function claimUniquePath(used: Set<string>, path: string): string {
  if (!used.has(path.toLowerCase())) {
    used.add(path.toLowerCase());
    return path;
  }
  const slash = path.lastIndexOf("/");
  const dot = path.lastIndexOf(".");
  const hasExt = dot > slash + 1;
  const stem = hasExt ? path.slice(0, dot) : path;
  const ext = hasExt ? path.slice(dot) : "";
  for (let n = 2; ; n++) {
    const candidate = `${stem}-${n}${ext}`;
    if (!used.has(candidate.toLowerCase())) {
      used.add(candidate.toLowerCase());
      return candidate;
    }
  }
}

interface Indexed {
  item: MemoryItem;
  /** 1-based position in the input; used as the ordinal so names are stable across re-plans. */
  ordinal: number;
}

interface DedupeResult {
  originals: Indexed[];
  duplicates: { entry: Indexed; of: MemoryItem }[];
}

/**
 * Split items into originals and duplicates in one pass (O(n)).
 *
 * Two items are duplicates when they share (a) the same non-empty download URL, (b) the same
 * zip path, or (c) date + media type + size, ALL present (and the size above zero; MemoryItem
 * carries no location, so lat/lon cannot be part of the key). The earliest-listed item
 * is the original. Matching is exact on purpose: we cannot verify which query parameters of a
 * Snapchat download URL are volatile (expiry/signature) versus identifying (media id), and
 * stripping the wrong one would merge distinct memories. A missed duplicate costs a few MB;
 * a false merge hides someone's photo from the plan.
 *
 * A duplicate's other keys are registered against its original too, so chains collapse to
 * the single earliest item.
 */
function dedupe(items: MemoryItem[]): DedupeResult {
  const originals: Indexed[] = [];
  const duplicates: { entry: Indexed; of: MemoryItem }[] = [];
  const owners = new Map<string, MemoryItem>();

  items.forEach((item, i) => {
    const keys: string[] = [];
    const url = typeof item.downloadUrl === "string" ? item.downloadUrl.trim() : "";
    if (url) keys.push(`u:${url}`);
    const zp = typeof item.zipPath === "string" ? item.zipPath.trim().replace(/\\/g, "/") : "";
    if (zp) keys.push(`z:${zp}`);
    const type = safeType(item.mediaType);
    if (isValidDate(item.date) && type !== "unknown" && isIdentifyingSize(item.sizeBytes)) {
      keys.push(`c:${item.date}|${type}|${item.sizeBytes}`);
    }

    let original: MemoryItem | undefined;
    for (const k of keys) {
      original = owners.get(k);
      if (original) break;
    }
    const entry = { item, ordinal: i + 1 };
    if (original) {
      duplicates.push({ entry, of: original });
    } else {
      original = item;
      originals.push(entry);
    }
    for (const k of keys) if (!owners.has(k)) owners.set(k, original);
  });

  return { originals, duplicates };
}

function buildMeter(
  originals: Indexed[],
  opts: { capBytes?: number; now?: number; lookbackDays?: number },
): StorageMeter {
  const capBytes = typeof opts.capBytes === "number" && Number.isFinite(opts.capBytes) && opts.capBytes > 0
    ? opts.capBytes
    : DEFAULT_CAP_BYTES;
  const lookbackDays =
    typeof opts.lookbackDays === "number" && Number.isFinite(opts.lookbackDays) && opts.lookbackDays > 0
      ? opts.lookbackDays
      : DEFAULT_LOOKBACK_DAYS;
  const now = typeof opts.now === "number" && Number.isFinite(opts.now) ? opts.now : undefined;

  let knownBytes = 0;
  let unknownSizeCount = 0;
  let newestDated = -Infinity;
  for (const { item } of originals) {
    if (isKnownSize(item.sizeBytes)) knownBytes += item.sizeBytes;
    else unknownSizeCount++;
    if (isValidDate(item.date) && item.date > newestDated) newestDated = item.date;
  }

  // Without an injected "now" we cannot say when the cap will be hit, but we can still
  // measure the growth rate relative to the newest memory.
  const reference = now ?? (newestDated > -Infinity ? newestDated : undefined);

  let growthBytesPerDay: number | null = null;
  if (reference !== undefined) {
    const windowStart = reference - lookbackDays * DAY_MS;
    let bytes = 0;
    let earliest = Infinity;
    // Only sized items feed both numerator and span so an unsized memory cannot skew the rate.
    for (const { item } of originals) {
      if (!isValidDate(item.date) || !isKnownSize(item.sizeBytes)) continue;
      if (item.date < windowStart || item.date > reference) continue; // future dates = clock junk
      bytes += item.sizeBytes;
      if (item.date < earliest) earliest = item.date;
    }
    // Span runs to the reference, not to the newest item: someone who stopped saving months
    // ago gets a lower (calmer) rate rather than an inflated one.
    const spanDays = earliest === Infinity ? 0 : (reference - earliest) / DAY_MS;
    if (spanDays >= MIN_GROWTH_SPAN_DAYS) growthBytesPerDay = bytes / spanDays;
  }

  // Already at/over the cap => null; fractionOfCap >= 1 conveys it.
  let projectedCapAt: number | null = null;
  if (now !== undefined && growthBytesPerDay !== null && growthBytesPerDay > 0 && knownBytes < capBytes) {
    const at = Math.round(now + ((capBytes - knownBytes) / growthBytesPerDay) * DAY_MS);
    // A date past 2100 is noise, not a forecast.
    if (Number.isFinite(at) && at <= DATE_HIGH) projectedCapAt = at;
  }

  return { knownBytes, unknownSizeCount, capBytes, fractionOfCap: knownBytes / capBytes, projectedCapAt, growthBytesPerDay };
}

/** Storage meter over non-duplicate items. `capBytes` defaults to an UNVERIFIED 5 GiB. */
export function storageMeter(
  items: MemoryItem[],
  opts: { capBytes?: number; now?: number; lookbackDays?: number } = {},
): StorageMeter {
  return buildMeter(dedupe(items).originals, opts);
}

/**
 * Plan output paths, duplicates, counts and the storage meter for a memory list.
 * Pass `now` (and optionally `lookbackDays`) to get a cap projection in `meter`.
 */
export function planMemories(items: MemoryItem[], opts: PlanOptions = {}): MemoriesPlan {
  const layout: Layout = opts.layout === "flat" || opts.layout === "year" ? opts.layout : "year-month";
  const { originals, duplicates } = dedupe(items);

  const used = new Set<string>();
  const entries: PlannedMemory[] = [];
  const counts = { total: originals.length, images: 0, videos: 0, unknown: 0, withDate: 0 };

  for (const { item, ordinal } of originals) {
    entries.push({ item, relativePath: claimUniquePath(used, plannedPath(item, ordinal, layout)) });

    const type = safeType(item.mediaType);
    if (type === "image") counts.images++;
    else if (type === "video") counts.videos++;
    else counts.unknown++;
    if (isValidDate(item.date)) counts.withDate++;
  }

  // Duplicates get a path too (for reporting), reserved in the same namespace so a later
  // "keep duplicates" option could never collide with an original.
  const dupEntries: PlannedMemory[] = duplicates.map(({ entry, of }) => ({
    item: entry.item,
    relativePath: claimUniquePath(used, plannedPath(entry.item, entry.ordinal, layout)),
    duplicateOf: of.id,
  }));

  const meter = buildMeter(originals, { capBytes: opts.capBytes, now: opts.now, lookbackDays: opts.lookbackDays });
  return { entries, duplicates: dupEntries, meter, counts };
}
