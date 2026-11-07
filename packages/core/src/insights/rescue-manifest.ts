/**
 * Memories rescue manifest and verify (pure, offline, deterministic).
 *
 * A manifest is a versioned list of every rescued item: an id, the saved file name as a path
 * relative to the output folder, the saved size, the capture time, the media type and whether
 * it has overlay files. `verifyRescue` compares a manifest with a listing of what is on disk
 * (name, size, modification time) and reports what is missing, extra, the wrong size or the
 * wrong time.
 *
 * Blind to content by construction:
 *  - Only allowlisted fields are copied. A record's other fields (zip paths, download links,
 *    anything an input happens to carry) are dropped at this boundary, so none can reach a manifest.
 *  - Saved names must look like names core generates ("2023/2023-04/2023-04-01_093000_image_0007.jpg"):
 *    plain segments, no "..", no drive letters, no backslashes. Anything else is skipped and counted.
 *  - No hashing and no file reads: matching uses names, sizes and times only.
 *  - Notes are codes with counts. They never contain a file name, id or any user value.
 *
 * Time is a parameter (`now`), never read from the clock. No file system, network or logging.
 *
 * Defaults, all documented where they are used:
 *  - time tolerance 2,000 ms (some file systems store only even seconds; same as the CLI's fixFileTime)
 *  - listed rows per category capped at 500 (counts are always complete)
 *  - capture times outside 1990..2100 or later than `now` are cleared (the item counts as undated)
 */
import type { MemoryMediaType, PlannedMemory } from "../types.ts";

export const RESCUE_MANIFEST_VERSION = 1;

/** Same plausible window as the rest of core (util.toMs, memories/plan). */
const DATE_LOW = Date.UTC(1990, 0, 1);
const DATE_HIGH = Date.UTC(2100, 0, 1);

/** Default allowed difference between a saved capture time and a file's modification time. */
export const DEFAULT_TIME_TOLERANCE_MS = 2000;
/** Default cap on rows listed per category in a verify result. */
export const DEFAULT_LIST_LIMIT = 500;

const MAX_PATH_LENGTH = 240;
const MAX_ID_LENGTH = 64;
const SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const ID_RE = /^[A-Za-z0-9_.:-]+$/;

// ------------------------------------------------------------------- types ---

/** What a wiring step hands in per rescued item. Extra fields are ignored. */
export interface RescueRecord {
  /** Item id (MemoryItem.id). Replaced by a neutral one when empty, odd or repeated. */
  id: string;
  /** Saved file name relative to the output folder, forward slashes (PlannedMemory.relativePath). */
  relativePath: string;
  /**
   * Size in bytes of the file AS SAVED. Not the zip's size: writing a date into a JPEG or MP4
   * header changes the size, so use the size after writing. Missing means "do not compare".
   */
  sizeBytes?: number | null;
  /** Capture time (epoch ms) the file was dated with; null or missing for an undated item. */
  date?: number | null;
  mediaType: MemoryMediaType;
  /** Saved names of the overlay files of this item, relative to the output folder. */
  overlays?: string[];
}

export interface ManifestItem {
  id: string;
  /** Saved file name relative to the output folder. */
  path: string;
  /** Saved size in bytes, or null when not recorded. */
  size: number | null;
  /** Capture time, epoch ms, or null for undated. */
  capturedAt: number | null;
  mediaType: MemoryMediaType;
  /** True when the item has at least one overlay file. */
  overlay: boolean;
  /** Saved names of the overlay files, sorted. */
  overlayFiles: string[];
}

export interface ManifestCounts {
  items: number;
  images: number;
  videos: number;
  unknown: number;
  overlayFiles: number;
  undated: number;
  withSize: number;
}

export interface RescueManifest {
  version: typeof RESCUE_MANIFEST_VERSION;
  /** The `now` passed to the builder (epoch ms), or null when it was not a finite number. */
  createdAt: number | null;
  counts: ManifestCounts;
  /** Sorted by saved name (lower-case, then exact), so output does not depend on input order. */
  items: ManifestItem[];
}

export type ManifestNoteCode =
  | "path-skipped" // an item whose saved name is not a plain relative name
  | "path-duplicate" // an item or overlay whose name repeats another (compared without case)
  | "overlay-skipped" // an overlay name that is not a plain relative name
  | "id-replaced" // an id that was empty, odd or repeated
  | "time-in-future" // a capture time later than now, cleared
  | "time-invalid" // a capture time that is not a plausible date, cleared
  | "size-missing"; // an item with no usable size (not compared when verifying)

export interface RescueNote<C extends string = string> {
  code: C;
  params: { count: number };
}

export interface BuildResult {
  manifest: RescueManifest;
  notes: RescueNote<ManifestNoteCode>[];
}

/** One file found on disk. `path` is relative to the output folder; backslashes are accepted. */
export interface DiskEntry {
  path: string;
  size: number;
  /** Modification time, epoch ms. */
  mtimeMs: number;
}

export interface VerifyOptions {
  /** Allowed time difference in ms. Default 2000. */
  timeToleranceMs?: number;
  /** Rows listed per category. Default 500. Counts are never capped. */
  listLimit?: number;
  /** Disk paths to leave out of the comparison (for example the manifest file itself). Case-insensitive. */
  ignore?: string[];
}

export type FileKind = "main" | "overlay";

export interface MissingRow {
  id: string;
  path: string;
  kind: FileKind;
}
export interface ExtraRow {
  path: string;
}
export interface SizeMismatchRow {
  id: string;
  path: string;
  expected: number;
  actual: number | null;
}
export interface TimeMismatchRow {
  id: string;
  path: string;
  kind: FileKind;
  expected: number;
  actual: number | null;
}

export type VerifyNoteCode =
  | "size-not-checked" // items with no recorded size
  | "time-not-checked" // files of undated items
  | "case-differs" // matched a disk file whose name differs only in letter case
  | "duplicate-disk-entry"; // the same path listed more than once on disk

export interface VerifyResult {
  /** True when nothing is missing, extra, the wrong size or the wrong time. */
  ok: boolean;
  /** Files the manifest expects (main files plus overlay files) and files on disk that were compared. */
  expectedFiles: number;
  diskFiles: number;
  counts: { matched: number; missing: number; extra: number; sizeMismatch: number; timeMismatch: number };
  missing: MissingRow[];
  extra: ExtraRow[];
  sizeMismatch: SizeMismatchRow[];
  timeMismatch: TimeMismatchRow[];
  /** True when any list was cut at `listLimit` (the counts are still complete). */
  truncated: boolean;
  notes: RescueNote<VerifyNoteCode>[];
}

// ----------------------------------------------------------------- helpers ---

/** Code-unit order: the same on every machine and locale. */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function isPlainPath(p: unknown): p is string {
  if (typeof p !== "string" || p.length === 0 || p.length > MAX_PATH_LENGTH) return false;
  for (const seg of p.split("/")) {
    if (!SEGMENT_RE.test(seg) || seg.endsWith(".")) return false;
  }
  return true;
}

function safeType(t: unknown): MemoryMediaType {
  return t === "image" || t === "video" ? t : "unknown";
}

function noteList<C extends string>(order: readonly C[], tally: Record<C, number>): RescueNote<C>[] {
  return order.filter((c) => tally[c] > 0).map((code) => ({ code, params: { count: tally[code] } }));
}

const BUILD_NOTE_ORDER: readonly ManifestNoteCode[] = [
  "path-skipped",
  "path-duplicate",
  "overlay-skipped",
  "id-replaced",
  "time-in-future",
  "time-invalid",
  "size-missing",
];

const emptyBuildTally = (): Record<ManifestNoteCode, number> => ({
  "path-skipped": 0,
  "path-duplicate": 0,
  "overlay-skipped": 0,
  "id-replaced": 0,
  "time-in-future": 0,
  "time-invalid": 0,
  "size-missing": 0,
});

/** A capture time that can be written into a manifest, or null (with the reason tallied). */
function cleanTime(value: unknown, now: number | null, tally: Record<ManifestNoteCode, number>): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < DATE_LOW || value > DATE_HIGH) {
    tally["time-invalid"]++;
    return null;
  }
  if (now !== null && value > now) {
    tally["time-in-future"]++;
    return null;
  }
  return value;
}

function cleanSize(value: unknown, tally: Record<ManifestNoteCode, number>): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  tally["size-missing"]++;
  return null;
}

interface Candidate {
  /** Position in the input, for neutral ids and a stable tiebreak. */
  index: number;
  rawId: unknown;
  path: string;
  size: unknown;
  date: unknown;
  mediaType: MemoryMediaType;
  overlays: unknown[];
}

/**
 * Shared by the builder and the parser: allowlist-project candidates, drop what is not a plain
 * name, resolve repeated names (first in sorted order wins) and ids, and sort.
 */
function assemble(candidates: Candidate[], now: number | null, tally: Record<ManifestNoteCode, number>): ManifestItem[] {
  const sorted = [...candidates].sort((a, b) => cmp(a.path.toLowerCase(), b.path.toLowerCase()) || cmp(a.path, b.path) || a.index - b.index);

  // Main names first, so an overlay can never push a main file out.
  const claimed = new Set<string>();
  const kept: Candidate[] = [];
  for (const c of sorted) {
    const key = c.path.toLowerCase();
    if (claimed.has(key)) {
      tally["path-duplicate"]++;
      continue;
    }
    claimed.add(key);
    kept.push(c);
  }

  const ids = new Set<string>();
  const items: ManifestItem[] = [];
  for (const c of kept) {
    let id = typeof c.rawId === "string" && c.rawId.length <= MAX_ID_LENGTH && ID_RE.test(c.rawId) ? c.rawId : "";
    if (id === "" || ids.has(id)) {
      tally["id-replaced"]++;
      id = `item-${c.index + 1}`;
      while (ids.has(id)) id += "x";
    }
    ids.add(id);

    const overlayFiles: string[] = [];
    for (const o of c.overlays) {
      if (!isPlainPath(o)) {
        tally["overlay-skipped"]++;
      } else if (claimed.has(o.toLowerCase())) {
        tally["path-duplicate"]++;
      } else {
        claimed.add(o.toLowerCase());
        overlayFiles.push(o);
      }
    }
    overlayFiles.sort((a, b) => cmp(a.toLowerCase(), b.toLowerCase()) || cmp(a, b));

    items.push({
      id,
      path: c.path,
      size: cleanSize(c.size, tally),
      capturedAt: cleanTime(c.date, now, tally),
      mediaType: c.mediaType,
      overlay: overlayFiles.length > 0,
      overlayFiles,
    });
  }
  return items;
}

function countItems(items: ManifestItem[]): ManifestCounts {
  const counts: ManifestCounts = { items: items.length, images: 0, videos: 0, unknown: 0, overlayFiles: 0, undated: 0, withSize: 0 };
  for (const it of items) {
    if (it.mediaType === "image") counts.images++;
    else if (it.mediaType === "video") counts.videos++;
    else counts.unknown++;
    counts.overlayFiles += it.overlayFiles.length;
    if (it.capturedAt === null) counts.undated++;
    if (it.size !== null) counts.withSize++;
  }
  return counts;
}

// ------------------------------------------------------------------- build ---

/**
 * Build a manifest from rescued records. `now` (epoch ms) is only used to clear capture times
 * that lie in the future and to stamp `createdAt`. Output is the same for any input order.
 */
export function buildRescueManifest(records: readonly RescueRecord[], opts: { now: number }): BuildResult {
  const now = typeof opts?.now === "number" && Number.isFinite(opts.now) ? opts.now : null;
  const tally = emptyBuildTally();
  const candidates: Candidate[] = [];
  (records ?? []).forEach((r, index) => {
    if (r === null || typeof r !== "object" || !isPlainPath(r.relativePath)) {
      tally["path-skipped"]++;
      return;
    }
    candidates.push({
      index,
      rawId: r.id,
      path: r.relativePath,
      size: r.sizeBytes,
      date: r.date,
      mediaType: safeType(r.mediaType),
      overlays: Array.isArray(r.overlays) ? r.overlays : [],
    });
  });
  const items = assemble(candidates, now, tally);
  const manifest: RescueManifest = { version: RESCUE_MANIFEST_VERSION, createdAt: now, counts: countItems(items), items };
  return { manifest, notes: noteList(BUILD_NOTE_ORDER, tally) };
}

/**
 * Records for the planned entries of a Memories rescue (pass only the ones that were saved).
 * `savedSizes` maps a relative path to the size on disk after writing; without it sizes are
 * left out, because the zip's size is not the saved size once a date is written into a header.
 *
 * Overlay names mirror apps/cli/src/memories-write.ts `overlayTarget`: the main name's stem plus
 * "-overlay" (then "-overlay-2", ...), with the stored extension when it is a plain token, else
 * "png". Only that vetted extension is taken from the stored name, never any other part of it.
 * A wiring step that knows the exact names it wrote can fill `overlays` itself instead.
 */
export function recordsFromPlan(entries: readonly PlannedMemory[], savedSizes?: ReadonlyMap<string, number>): RescueRecord[] {
  return entries.map((e) => {
    const main = e.relativePath;
    const dot = main.lastIndexOf(".");
    const stem = dot > main.lastIndexOf("/") ? main.slice(0, dot) : main;
    const overlays = (e.item.overlayPaths ?? []).map((stored, n) => {
      const ext = /\.([a-z0-9]{1,5})$/i.exec(typeof stored === "string" ? stored : "")?.[1]?.toLowerCase() ?? "png";
      return `${stem}-overlay${n > 0 ? `-${n + 1}` : ""}.${ext}`;
    });
    return {
      id: e.item.id,
      relativePath: main,
      sizeBytes: savedSizes?.get(main) ?? null,
      date: e.item.date,
      mediaType: e.item.mediaType,
      overlays,
    };
  });
}

// --------------------------------------------------------------- serialize ---

/**
 * Deterministic text: fixed key order, items sorted, one item per line, two-space indent, a
 * trailing newline. The same manifest always gives the same bytes.
 */
export function serializeRescueManifest(m: RescueManifest): string {
  const c = m.counts;
  const counts = `{"items":${c.items},"images":${c.images},"videos":${c.videos},"unknown":${c.unknown},"overlayFiles":${c.overlayFiles},"undated":${c.undated},"withSize":${c.withSize}}`;
  const rows = m.items.map(
    (it) =>
      "    " +
      JSON.stringify({
        id: it.id,
        path: it.path,
        size: it.size,
        capturedAt: it.capturedAt,
        mediaType: it.mediaType,
        overlay: it.overlay,
        overlayFiles: it.overlayFiles,
      }),
  );
  const items = rows.length === 0 ? "[]" : `[\n${rows.join(",\n")}\n  ]`;
  return `{\n  "version": ${m.version},\n  "createdAt": ${JSON.stringify(m.createdAt)},\n  "counts": ${counts},\n  "items": ${items}\n}\n`;
}

export type ParseErrorCode = "not-json" | "bad-shape" | "version-unsupported";

export type ParseResult =
  | { ok: true; manifest: RescueManifest; notes: RescueNote<ManifestNoteCode>[] }
  | { ok: false; code: ParseErrorCode };

/**
 * Read a manifest back. Strict about the version, tolerant about contents: every item goes
 * through the same checks as the builder (unsafe names are skipped and counted), counts are
 * recomputed, and unknown fields are dropped. Never throws and never echoes the input.
 */
export function parseRescueManifest(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, code: "not-json" };
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, code: "bad-shape" };
  const obj = raw as Record<string, unknown>;
  if (obj.version !== RESCUE_MANIFEST_VERSION) return { ok: false, code: typeof obj.version === "number" ? "version-unsupported" : "bad-shape" };
  if (!Array.isArray(obj.items)) return { ok: false, code: "bad-shape" };

  const tally = emptyBuildTally();
  const candidates: Candidate[] = [];
  obj.items.forEach((entry, index) => {
    const it = entry as Record<string, unknown> | null;
    if (it === null || typeof it !== "object" || !isPlainPath(it.path)) {
      tally["path-skipped"]++;
      return;
    }
    candidates.push({
      index,
      rawId: it.id,
      path: it.path,
      size: it.size,
      date: it.capturedAt,
      mediaType: safeType(it.mediaType),
      overlays: Array.isArray(it.overlayFiles) ? it.overlayFiles : [],
    });
  });
  // No `now` here: a stored time is not judged against a clock the reader may not share.
  const items = assemble(candidates, null, tally);
  const createdAt = typeof obj.createdAt === "number" && Number.isFinite(obj.createdAt) ? obj.createdAt : null;
  return { ok: true, manifest: { version: RESCUE_MANIFEST_VERSION, createdAt, counts: countItems(items), items }, notes: noteList(BUILD_NOTE_ORDER, tally) };
}

// ------------------------------------------------------------------ verify ---

function normDiskPath(p: string): string {
  let s = p.replace(/\\/g, "/");
  while (s.startsWith("./")) s = s.slice(2);
  return s;
}

/**
 * Compare a manifest with what is on disk. Linear in the size of both.
 *
 * Names match exactly first, then without regard to letter case (Windows and macOS file systems
 * ignore case); a case-only match still counts as present and is noted. A size is compared only
 * when the manifest has one, a time only for items with a capture time. Overlay files are
 * checked for presence and time (their size is not recorded). Disk files the manifest does not
 * list, other than `ignore`d ones, are extra.
 */
export function verifyRescue(manifest: RescueManifest, disk: readonly DiskEntry[], opts: VerifyOptions = {}): VerifyResult {
  const tol = typeof opts.timeToleranceMs === "number" && Number.isFinite(opts.timeToleranceMs) && opts.timeToleranceMs >= 0 ? opts.timeToleranceMs : DEFAULT_TIME_TOLERANCE_MS;
  const limit = typeof opts.listLimit === "number" && Number.isFinite(opts.listLimit) && opts.listLimit >= 0 ? Math.floor(opts.listLimit) : DEFAULT_LIST_LIMIT;
  const ignore = new Set((opts.ignore ?? []).map((p) => normDiskPath(p).toLowerCase()));
  const tally: Record<VerifyNoteCode, number> = { "size-not-checked": 0, "time-not-checked": 0, "case-differs": 0, "duplicate-disk-entry": 0 };

  // Disk side: normalise, sort for a deterministic pick, drop repeated paths.
  const listed = (disk ?? [])
    .filter((d) => d !== null && typeof d === "object" && typeof d.path === "string")
    .map((d) => ({ path: normDiskPath(d.path), size: d.size, mtimeMs: d.mtimeMs }))
    .filter((d) => !ignore.has(d.path.toLowerCase()))
    .sort((a, b) => cmp(a.path, b.path) || (Number(a.size) || 0) - (Number(b.size) || 0) || (Number(a.mtimeMs) || 0) - (Number(b.mtimeMs) || 0));
  type Disk = (typeof listed)[number];
  const exact = new Map<string, Disk>();
  const byLower = new Map<string, Disk[]>();
  for (const d of listed) {
    if (exact.has(d.path)) {
      tally["duplicate-disk-entry"]++;
      continue;
    }
    exact.set(d.path, d);
    const k = d.path.toLowerCase();
    const bucket = byLower.get(k);
    if (bucket) bucket.push(d);
    else byLower.set(k, [d]);
  }
  const used = new Set<Disk>();
  const find = (path: string): Disk | undefined => {
    const hit = exact.get(path);
    if (hit && !used.has(hit)) return hit;
    return byLower.get(path.toLowerCase())?.find((d) => !used.has(d));
  };

  const result: VerifyResult = {
    ok: true,
    expectedFiles: 0,
    diskFiles: exact.size,
    counts: { matched: 0, missing: 0, extra: 0, sizeMismatch: 0, timeMismatch: 0 },
    missing: [],
    extra: [],
    sizeMismatch: [],
    timeMismatch: [],
    truncated: false,
    notes: [],
  };
  const push = <T>(list: T[], row: T): void => {
    if (list.length < limit) list.push(row);
    else result.truncated = true;
  };

  const timeOff = (expected: number, d: Disk): boolean => !Number.isFinite(d.mtimeMs) || Math.abs(d.mtimeMs - expected) > tol;
  const check = (id: string, path: string, kind: FileKind, size: number | null, at: number | null): void => {
    result.expectedFiles++;
    const d = find(path);
    if (!d) {
      result.counts.missing++;
      push(result.missing, { id, path, kind });
      return;
    }
    used.add(d);
    result.counts.matched++;
    if (d.path !== path) tally["case-differs"]++;
    if (size !== null && d.size !== size) {
      result.counts.sizeMismatch++;
      push(result.sizeMismatch, { id, path, expected: size, actual: Number.isFinite(d.size) ? d.size : null });
    }
    if (at !== null && timeOff(at, d)) {
      result.counts.timeMismatch++;
      push(result.timeMismatch, { id, path, kind, expected: at, actual: Number.isFinite(d.mtimeMs) ? d.mtimeMs : null });
    }
  };

  for (const it of manifest.items) {
    if (it.size === null) tally["size-not-checked"]++;
    if (it.capturedAt === null) tally["time-not-checked"] += 1 + it.overlayFiles.length;
    check(it.id, it.path, "main", it.size, it.capturedAt);
    for (const o of it.overlayFiles) check(it.id, o, "overlay", null, it.capturedAt);
  }

  for (const d of exact.values()) {
    if (used.has(d)) continue;
    result.counts.extra++;
    push(result.extra, { path: d.path });
  }

  const c = result.counts;
  result.ok = c.missing === 0 && c.extra === 0 && c.sizeMismatch === 0 && c.timeMismatch === 0;
  result.notes = noteList(["size-not-checked", "time-not-checked", "case-differs", "duplicate-disk-entry"] as const, tally);
  return result;
}
