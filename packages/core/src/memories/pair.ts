/**
 * Pair the Memories list (memories_history.json) with the media files bundled in the export.
 *
 * Blind to what the media shows: the only inputs are times, an id and a media kind taken from
 * file NAMES; no file is opened. Matching uses, best first:
 *   1. the stored UTC time of the zip entry == the item's Date, to the second (exact);
 *   2. DOS-only times (2-second resolution, the zipper's wall clock): the clock offset(s) are
 *      detected (quarter-hour steps, up to three of them, because a clock that observes daylight
 *      saving time has two), then a +/-2 s window is used;
 *   3. the day in the file name plus the media type, only for days with one item and one file.
 * Anything not provably one-to-one stays unmatched and is counted, never guessed.
 *
 * Pure and deterministic. Nothing here logs, throws or builds a message from a name or a path.
 */
import type { MemoryItem } from "../types.ts";

export interface MemoryMediaFile {
  path: string;
  /** 1-based position of the zip part the file came from, as given to classifyMemoryMedia. */
  part: number;
  role: "main" | "overlay" | "other";
  /** UUID from the file name, upper-case. */
  idInName?: string;
  /** YYYY-MM-DD prefix of the file name. */
  nameDay?: string;
  /** Best stored time: the UTC instant when known, else the DOS wall-clock reading (epoch ms). */
  timeMs?: number;
  timeKind: "utc" | "dos" | "none";
  size: number;
}

export interface PairingResult {
  pairs: {
    itemId: string;
    file: MemoryMediaFile;
    overlays: MemoryMediaFile[];
    method: "exact-time" | "time-tolerance" | "date-and-type";
  }[];
  unmatchedItemIds: string[];
  unmatchedFiles: MemoryMediaFile[];
  method: "utc-time" | "offset-time" | "date-type" | "none";
  /** The zipper's clock offset from UTC (wall clock = UTC + offsetHours); 0 unless method is offset-time. */
  offsetHours: number;
  /** Further offsets the clock had (daylight saving time moves it by an hour); empty unless method is offset-time. */
  extraOffsetHours: number[];
  summary: {
    items: number;
    mainFiles: number;
    paired: number;
    unmatchedItems: number;
    unmatchedFiles: number;
    overlays: number;
    /** Items that share a time or a day with files but could not be told apart, so were left unmatched. */
    ambiguous: number;
  };
}

type Kind = "image" | "video" | "unknown";

const IMAGE_EXT = new Set(["jpg", "jpeg", "png", "heic", "heif", "webp", "gif"]);
const VIDEO_EXT = new Set(["mp4", "mov", "m4v", "webm", "3gp"]);
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})(?!\d)/;

const extensionOf = (base: string): string => {
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
};

// ------------------------------------------------------------------ classify ---

/**
 * Describe the files under a folder named "memories" (any depth, any case) of one zip part.
 * HTML pages are skipped. The role comes from the suffix after the last "-" of the base name:
 * "main" and "overlay" are the two real kinds; thumbnails and anything unrecognized are "other".
 */
export function classifyMemoryMedia(
  entries: { name: string; size: number; mtimeUtcMs?: number; mtimeDosMs?: number }[],
  part: number,
): MemoryMediaFile[] {
  const out: MemoryMediaFile[] = [];
  for (const e of entries) {
    if (typeof e?.name !== "string") continue;
    const segments = e.name.replace(/\\/g, "/").split("/");
    const base = segments[segments.length - 1] as string;
    if (base === "" || !segments.slice(0, -1).some((s) => s.toLowerCase() === "memories")) continue;
    const ext = extensionOf(base);
    if (ext === "html" || ext === "htm") continue;

    const stem = ext === "" ? base : base.slice(0, base.length - ext.length - 1);
    const dash = stem.lastIndexOf("-");
    const suffix = dash < 0 ? "" : stem.slice(dash + 1).toLowerCase();
    const day = DAY_RE.exec(stem);
    const month = day === null ? 0 : Number(day[2]);
    const dayOfMonth = day === null ? 0 : Number(day[3]);

    const file: MemoryMediaFile = {
      path: e.name,
      part,
      role: suffix === "main" ? "main" : suffix === "overlay" ? "overlay" : "other",
      timeKind: "none",
      size: Number.isFinite(e.size) && e.size >= 0 ? e.size : 0,
    };
    const id = UUID_RE.exec(stem)?.[0];
    if (id !== undefined) file.idInName = id.toUpperCase();
    if (day !== null && month >= 1 && month <= 12 && dayOfMonth >= 1 && dayOfMonth <= 31) file.nameDay = day[0].slice(0, 10);
    if (Number.isFinite(e.mtimeUtcMs)) {
      file.timeMs = e.mtimeUtcMs as number;
      file.timeKind = "utc";
    } else if (Number.isFinite(e.mtimeDosMs)) {
      file.timeMs = e.mtimeDosMs as number;
      file.timeKind = "dos";
    }
    out.push(file);
  }
  return out;
}

// ------------------------------------------------------------ time matching ---

/** Ids sorted by a numeric key, with the keys alongside for binary search. */
interface Sorted {
  ids: number[];
  keys: Float64Array;
}

function sortBy(ids: number[], keyOf: ArrayLike<number>): Sorted {
  const sorted = ids.slice().sort((a, b) => (keyOf[a] as number) - (keyOf[b] as number) || a - b);
  return { ids: sorted, keys: Float64Array.from(sorted, (i) => keyOf[i] as number) };
}

const keep = (s: Sorted, pred: (id: number) => boolean): Sorted => {
  const ids = s.ids.filter(pred);
  const keys = new Float64Array(ids.length);
  let n = 0;
  s.ids.forEach((id, k) => {
    if (pred(id)) keys[n++] = s.keys[k] as number;
  });
  return { ids, keys };
};

/** First index whose key is >= x. */
function lower(keys: Float64Array, x: number): number {
  let lo = 0;
  let hi = keys.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((keys[mid] as number) < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** First index whose key is > x. */
function upper(keys: Float64Array, x: number): number {
  let lo = 0;
  let hi = keys.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((keys[mid] as number) <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** How many keys lie within +/-tol of t: found by two binary searches, so crowded times stay cheap. */
const within = (keys: Float64Array, t: number, tol: number): number => upper(keys, t + tol) - lower(keys, t - tol);

/** Largest tolerance (seconds) the DOS stage accepts: its 2 s resolution plus a second of clock skew. */
const DOS_TOLERANCE_S = 2;
const MIN_OFFSET_HOURS = -14;
const MAX_OFFSET_HOURS = 14;
/** Zones differ from UTC by whole hours, half hours (India) or 45 minutes (Nepal). */
const OFFSET_STEP_HOURS = 0.25;
/** A clock with daylight saving time has two offsets; a third allows for a zone change as well. */
const MAX_OFFSETS = 3;
/** Offsets are searched among this many files at most (evenly spread), so 100k files stay quick. */
const OFFSET_SAMPLE = 2000;

interface TimeMatch {
  pairs: [item: number, file: number][];
  ambiguous: number;
}

/**
 * Pair items with files whose times agree within `tol` seconds (0 = exact).
 * A pair needs a one-to-one neighborhood: pass 1 takes items and files that have exactly one
 * counterpart each. Pass 2 retries per media type (the extension against the item's type) and
 * still requires the whole neighborhood to hold equally many items and files, so a lone extra
 * item or file near the pair keeps it unmatched. Items left with a counterpart nearby are ambiguous.
 */
function matchByTime(items: Sorted, files: Sorted, itemKind: Kind[], fileKind: Kind[], tol: number): TimeMatch {
  const pairs: [number, number][] = [];
  const usedItem = new Set<number>();
  const usedFile = new Set<number>();

  const pass = (si: Sorted, sf: Sorted): void => {
    for (let k = 0; k < sf.ids.length; k++) {
      const t = sf.keys[k] as number;
      const first = lower(si.keys, t - tol);
      if (upper(si.keys, t + tol) - first !== 1) continue;
      const at = si.keys[first] as number;
      if (within(sf.keys, at, tol) !== 1) continue;
      if (within(items.keys, t, tol) !== within(files.keys, at, tol)) continue;
      pairs.push([si.ids[first] as number, sf.ids[k] as number]);
      usedItem.add(si.ids[first] as number);
      usedFile.add(sf.ids[k] as number);
    }
  };

  pass(items, files);
  for (const kind of ["image", "video"] as const) {
    pass(
      keep(items, (i) => !usedItem.has(i) && itemKind[i] === kind),
      keep(files, (f) => !usedFile.has(f) && fileKind[f] === kind),
    );
  }

  const restFiles = keep(files, (f) => !usedFile.has(f));
  let ambiguous = 0;
  items.ids.forEach((i, k) => {
    if (!usedItem.has(i) && within(restFiles.keys, items.keys[k] as number, tol) > 0) ambiguous++;
  });
  return { pairs, ambiguous };
}

/**
 * The offsets of the zipper's clock (wall clock = UTC + hours) that explain the DOS times, best
 * first, or [] when they do not clearly explain them. Offsets are picked greedily: the one that
 * matches the most files, then the one that matches the most of the files it did not explain, and
 * so on (at most MAX_OFFSETS; a cluster needs a few files of support). A clock that observes
 * daylight saving time shows two offsets in one archive, in any proportion, so no single winner is
 * required: the offsets must together explain at least half of the files. Meaningless times
 * (nothing near any item) explain none and are rejected instead of guessed at. Only a sample of
 * the files is searched; every file is then assigned to the offset that matches it.
 */
function detectOffsets(items: Sorted, dosSeconds: Float64Array): number[] {
  const stride = Math.max(1, Math.ceil(dosSeconds.length / OFFSET_SAMPLE));
  let rest: number[] = [];
  for (let k = 0; k < dosSeconds.length; k += stride) rest.push(dosSeconds[k] as number);
  const total = rest.length;
  const support = Math.max(2, Math.ceil(total * 0.05));
  const chosen: number[] = [];
  let explained = 0;
  while (chosen.length < MAX_OFFSETS && rest.length > 0) {
    let best: number | undefined;
    let bestCount = 0;
    for (let h = MIN_OFFSET_HOURS; h <= MAX_OFFSET_HOURS; h += OFFSET_STEP_HOURS) {
      let count = 0;
      for (const s of rest) if (within(items.keys, s - h * 3600, DOS_TOLERANCE_S) > 0) count++;
      if (count > bestCount) {
        bestCount = count;
        best = h;
      }
    }
    if (best === undefined || bestCount < Math.min(support, rest.length)) break;
    const h = best;
    chosen.push(h);
    explained += bestCount;
    rest = rest.filter((s) => within(items.keys, s - h * 3600, DOS_TOLERANCE_S) === 0);
  }
  return explained * 2 >= total ? chosen : [];
}

/** The offset among `offsets` at which this DOS time lands next to an item; the first offset when none does. */
function offsetOf(items: Sorted, offsets: number[], dosSecond: number): number {
  return offsets.find((h) => within(items.keys, dosSecond - h * 3600, DOS_TOLERANCE_S) > 0) ?? (offsets[0] as number);
}

/** Latest representable Date, in ms: toISOString throws beyond it. */
const MAX_DATE_MS = 8.64e15;

/**
 * Last resort when no usable times exist: the day in the file name plus the media type. Only a
 * day-and-type group with exactly one item and one file is paired.
 */
function matchByDay(items: MemoryItem[], itemKind: Kind[], datedIds: number[], files: MemoryMediaFile[], fileKind: Kind[], candidates: number[]): TimeMatch {
  const groups = new Map<string, { items: number[]; files: number[] }>();
  const group = (key: string) => {
    let g = groups.get(key);
    if (g === undefined) groups.set(key, (g = { items: [], files: [] }));
    return g;
  };
  for (const i of datedIds) group(`${new Date((items[i] as MemoryItem).date as number).toISOString().slice(0, 10)}|${itemKind[i]}`).items.push(i);
  for (const f of candidates) {
    const day = (files[f] as MemoryMediaFile).nameDay;
    if (day !== undefined) group(`${day}|${fileKind[f]}`).files.push(f);
  }
  const pairs: [number, number][] = [];
  let ambiguous = 0;
  for (const g of groups.values()) {
    if (g.items.length === 0 || g.files.length === 0) continue;
    if (g.items.length === 1 && g.files.length === 1) pairs.push([g.items[0] as number, g.files[0] as number]);
    else ambiguous += g.items.length;
  }
  return { pairs, ambiguous };
}

// ------------------------------------------------------------------- pairing ---

type PairMethod = PairingResult["pairs"][number]["method"];

interface Matches extends TimeMatch {
  pairMethod: PairMethod;
  method: PairingResult["method"];
  offsetHours: number;
  extraOffsetHours: number[];
}

const kindOfItem = (item: MemoryItem): Kind => (item?.mediaType === "image" || item?.mediaType === "video" ? item.mediaType : "unknown");

function kindOfFile(file: MemoryMediaFile): Kind {
  const ext = extensionOf(file.path.slice(Math.max(file.path.lastIndexOf("/"), file.path.lastIndexOf("\\")) + 1));
  return IMAGE_EXT.has(ext) ? "image" : VIDEO_EXT.has(ext) ? "video" : "unknown";
}

/** Does the file name carry a word after the id ("<id>-thumbnail"), as a rendition of a Memory does? */
function hasWordAfterId(file: MemoryMediaFile): boolean {
  const base = file.path.slice(Math.max(file.path.lastIndexOf("/"), file.path.lastIndexOf("\\")) + 1);
  const ext = extensionOf(base);
  const stem = ext === "" ? base : base.slice(0, base.length - ext.length - 1);
  return file.idInName !== undefined && !stem.toUpperCase().endsWith(file.idInName);
}

/** Pick the strongest evidence the files offer; fall back only when a stage finds nothing. */
function findMatches(items: MemoryItem[], files: MemoryMediaFile[], datedIds: number[], candidates: number[]): Matches {
  const itemKind = items.map(kindOfItem);
  const fileKind = files.map(kindOfFile);
  const none: Matches = { pairs: [], ambiguous: 0, pairMethod: "date-and-type", method: "none", offsetHours: 0, extraOffsetHours: [] };
  if (datedIds.length === 0 || candidates.length === 0) return none;

  const itemSecs = new Float64Array(items.length);
  for (const i of datedIds) itemSecs[i] = Math.floor(((items[i] as MemoryItem).date as number) / 1000);
  const sortedItems = sortBy(datedIds, itemSecs);
  const fileSecs = new Float64Array(files.length);
  for (const f of candidates) fileSecs[f] = Math.floor(((files[f] as MemoryMediaFile).timeMs ?? 0) / 1000);
  const ofKind = (kind: MemoryMediaFile["timeKind"]): number[] => candidates.filter((f) => (files[f] as MemoryMediaFile).timeKind === kind);

  // The exact stage needs most files to carry a real UTC time; it is self-validating, so any pair counts.
  const utc = ofKind("utc");
  const dos = ofKind("dos");
  if (utc.length * 2 > candidates.length) {
    const m = matchByTime(sortedItems, sortBy(utc, fileSecs), itemKind, fileKind, 0);
    if (m.pairs.length > 0) return { ...m, pairMethod: "exact-time", method: "utc-time", offsetHours: 0, extraOffsetHours: [] };
  } else if (dos.length > 0) {
    const offsets = detectOffsets(sortedItems, Float64Array.from(dos, (f) => fileSecs[f] as number));
    if (offsets.length > 0) {
      for (const f of dos) fileSecs[f] = (fileSecs[f] as number) - offsetOf(sortedItems, offsets, fileSecs[f] as number) * 3600;
      const m = matchByTime(sortedItems, sortBy(dos, fileSecs), itemKind, fileKind, DOS_TOLERANCE_S);
      if (m.pairs.length > 0) return { ...m, pairMethod: "time-tolerance", method: "offset-time", offsetHours: offsets[0] as number, extraOffsetHours: offsets.slice(1) };
    }
  }
  const m = matchByDay(items, itemKind, datedIds, files, fileKind, candidates);
  return m.pairs.length > 0 ? { ...m, pairMethod: "date-and-type", method: "date-type", offsetHours: 0, extraOffsetHours: [] } : { ...none, ambiguous: m.ambiguous };
}

/**
 * Pair memory items with the bundled media files. Items without a usable date are never paired.
 * Each item and file is used at most once; overlays join the main file with the same id in the
 * name. Companion files are left out of matching and of the unmatched list: a thumbnail or any
 * file with a word after its id ("<id>-thumbnail") is a rendition of a Memory, never the Memory
 * itself, whether or not its main file was supplied (a thumbnail paired as the Memory would be
 * saved under the Memory's name and keep the real file from ever being saved). The same main file
 * seen twice (the same id and stored time in two parts, or two exports of one account) is one
 * candidate. Deterministic: pairs and the unmatched lists follow input order.
 */
export function pairMemories(items: MemoryItem[], files: MemoryMediaFile[]): PairingResult {
  const datedIds: number[] = [];
  items.forEach((item, i) => {
    const date = item?.date;
    if (typeof date === "number" && Number.isFinite(date) && Math.abs(date) <= MAX_DATE_MS) datedIds.push(i);
  });

  // One candidate per copy of a main file (same id, same stored second): the first of equals.
  const copyKey = (f: MemoryMediaFile): string => `${f.idInName}|${f.timeMs === undefined ? "" : Math.floor(f.timeMs / 1000)}`;
  const firstCopy = new Map<string, number>();
  const mainIds = new Set<string>();
  files.forEach((f, i) => {
    if (f.role !== "main" || f.idInName === undefined) return;
    mainIds.add(f.idInName);
    if (!firstCopy.has(copyKey(f))) firstCopy.set(copyKey(f), i);
  });
  const candidates: number[] = [];
  const isCandidate = new Uint8Array(files.length);
  const overlaysById = new Map<string, number[]>();
  files.forEach((f, i) => {
    if (f.role === "overlay") {
      if (f.idInName === undefined) return;
      const list = overlaysById.get(f.idInName);
      if (list === undefined) overlaysById.set(f.idInName, [i]);
      else list.push(i);
    } else if (f.role === "main" ? f.idInName === undefined || firstCopy.get(copyKey(f)) === i : f.idInName === undefined || (!mainIds.has(f.idInName) && !hasWordAfterId(f))) {
      candidates.push(i);
      isCandidate[i] = 1;
    }
  });

  const found = findMatches(items, files, datedIds, candidates);
  found.pairs.sort((a, b) => a[0] - b[0]);

  const pairedItems = new Set<number>();
  const pairedFiles = new Set<number>();
  const attached = new Set<number>();
  const pairs: PairingResult["pairs"] = found.pairs.map(([i, f]) => {
    pairedItems.add(i);
    pairedFiles.add(f);
    const file = files[f] as MemoryMediaFile;
    // An overlay joins one main file only, even if two mains carry the same id.
    const overlayAt = file.idInName === undefined ? [] : (overlaysById.get(file.idInName) ?? []);
    if (file.idInName !== undefined) overlaysById.delete(file.idInName);
    overlayAt.forEach((o) => attached.add(o));
    return { itemId: (items[i] as MemoryItem).id, file, overlays: overlayAt.map((o) => files[o] as MemoryMediaFile), method: found.pairMethod };
  });

  const unmatchedFiles = files.filter((f, i) => (f.role === "overlay" ? !attached.has(i) : isCandidate[i] === 1 && !pairedFiles.has(i)));
  const unmatchedItemIds = items.flatMap((item, i) => (pairedItems.has(i) ? [] : [item?.id]));

  return {
    pairs,
    unmatchedItemIds,
    unmatchedFiles,
    method: found.method,
    offsetHours: found.offsetHours,
    extraOffsetHours: found.extraOffsetHours,
    summary: {
      items: items.length,
      mainFiles: candidates.length,
      paired: pairs.length,
      unmatchedItems: unmatchedItemIds.length,
      unmatchedFiles: unmatchedFiles.length,
      overlays: attached.size,
      ambiguous: found.ambiguous,
    },
  };
}

