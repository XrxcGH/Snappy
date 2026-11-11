/**
 * Aggregate-only checks of an export's layout and of its Memories files, for people who need to
 * share what an export looks like without sharing anything in it.
 *
 *   layoutSummary    per-folder file counts, sizes, extensions and the masked SHAPE of file names
 *   memoryLinkCheck  can list entries be matched to files by an ID in their download links?
 *   memoryTimeCheck  do the times stored in the zip match the list's dates (UTC, or DOS plus a
 *                    clock offset, or two around daylight saving time)?
 *
 * Each returns plain numbers and fixed labels. No file name, link, date or other value from the
 * export is ever copied into a result: names become shapes (every letter and digit masked),
 * link parts become shapes, and anything outside a small fixed vocabulary becomes "(other)".
 *
 * Privacy: only zip indexes, the Memories list and the first bytes of each Memories entry (its
 * local header, for the stored time) are read. Media data is never requested.
 */
import { describeStructureFromReader, formatStructureReport } from "./inspect.ts";
import type { StructureReport } from "./inspect.ts";
import { isRecord, normKey } from "./json-util.ts";
import { KNOWN_DIRS, MEDIA_EXTENSIONS } from "./layout.ts";
import { normPath } from "./parse.ts";
import { classifyMemoryMedia, pairMemories } from "../memories/pair.ts";
import type { MemoryMediaFile, PairingResult } from "../memories/pair.ts";
import type { MemoryItem } from "../types.ts";
import { inflateSource, projectConversations } from "./json-stream.ts";
import type { ProjectedRecord } from "./json-stream.ts";
import { LIST_KEEP_FIELDS, listZipEntries } from "./zip-reader.ts";
import type { RandomAccessReader, ZipEntryInfo } from "./zip-reader.ts";

// ----------------------------------------------------------------- shared ---

export interface Count {
  label: string;
  count: number;
}

/** Memories files are read this many at a time (one small header read each). */
const HEADER_BATCH = 64;

const KNOWN_EXTENSIONS: ReadonlySet<string> = new Set([...MEDIA_EXTENSIONS, "json", "html", "htm", "txt", "csv", "xml", "css", "js", "pdf", "zip", "svg"]);
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
/** A UUID, or a run of 8+ hex characters with a digit in it (a short id): these are ids, never shown even as a pattern. */
const ID_TOKEN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|(?<![0-9a-z])(?=[0-9a-f]*\d)[0-9a-f]{8,}(?![0-9a-z])/gi;

const baseOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1);
const isFile = (path: string): boolean => path !== "" && !path.endsWith("/");

/** Extension from a fixed vocabulary. Anything else is "(other)", so a personal name can never become one. */
function extensionOf(path: string): string {
  const base = baseOf(path);
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "(none)";
  const ext = base.slice(dot + 1).toLowerCase();
  return KNOWN_EXTENSIONS.has(ext) ? ext : "(other)";
}

const stemOf = (base: string): string => {
  const dot = base.lastIndexOf(".");
  return dot > 0 && /^[A-Za-z0-9]{1,5}$/.test(base.slice(dot + 1)) ? base.slice(0, dot) : base;
};

const DIGIT = /\p{Nd}/u;
const UPPER = /\p{Lu}/u;
const LETTER = /\p{L}/u;
const MARK = /\p{M}/u;
const SAFE_PUNCTUATION = /[-_.~ ()]/;

/**
 * The pattern of a name with no value in it: digits become 9, upper-case letters A, every other
 * letter a, marks vanish, and anything but a few punctuation marks becomes "?". Works for any script.
 */
export function nameShape(text: string, maxLength = 60): string {
  let out = "";
  for (const ch of text) {
    if (out.length >= maxLength) break;
    if (DIGIT.test(ch)) out += "9";
    else if (UPPER.test(ch)) out += "A";
    else if (LETTER.test(ch)) out += "a";
    else if (MARK.test(ch)) continue;
    else out += SAFE_PUNCTUATION.test(ch) ? ch : "?";
  }
  return out;
}

/**
 * nameShape for a file name, with every id collapsed to "<uuid>" or "<hex>" first. Masking a
 * UUID letter by letter would still tell which of its hex characters are digits, about a quarter
 * of its random bits, so ids are never shaped, only recognized.
 */
function fileNameShape(text: string): string {
  let out = "";
  let last = 0;
  for (const m of text.matchAll(ID_TOKEN)) {
    out += nameShape(text.slice(last, m.index)) + (m[0].includes("-") ? "<uuid>" : "<hex>");
    last = (m.index ?? 0) + m[0].length;
  }
  return out + nameShape(text.slice(last));
}

const sizeText = (n: number): string => (n < 1000 ? `${n} bytes` : n >= 1000 ** 3 ? `${(n / 1000 ** 3).toFixed(1)} GB` : n >= 1000 ** 2 ? `${(n / 1000 ** 2).toFixed(1)} MB` : `${Math.round(n / 1000)} KB`);

function tally(): { bump(label: string): void; top(n: number): Count[] } {
  const map = new Map<string, number>();
  return {
    bump: (label) => void map.set(label, (map.get(label) ?? 0) + 1),
    top: (n) =>
      [...map]
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))
        .slice(0, n),
  };
}

const countsText = (counts: Count[], sep = " "): string => counts.map((c) => `${c.label}${sep}${c.count}`).join(", ");

/** The central directory of every part. A part that cannot be read has an empty list and is named in `unreadable` (0-based). */
export async function listParts(readers: RandomAccessReader[]): Promise<{ parts: ZipEntryInfo[][]; unreadable: number[] }> {
  const parts: ZipEntryInfo[][] = [];
  const unreadable: number[] = [];
  for (const [i, reader] of readers.entries()) {
    const { entries, issues } = await listZipEntries(reader);
    if (issues.some((x) => x.severity === "error")) {
      unreadable.push(i);
      parts.push([]);
    } else {
      parts.push(entries);
    }
  }
  return { parts, unreadable };
}

// ------------------------------------------------------------------ layout ---

export interface LayoutFolder {
  /** A known folder name, "(top level)" or "<folder-N>". Never a name from the export. */
  label: string;
  files: number;
  bytes: number;
  extensions: Count[];
  /** Files below the folder's first level. */
  inSubfolders: number;
  /** The most common masked file-name shapes (JSON and HTML pages are left out); each was seen at least MIN_SHAPE_COUNT times. */
  nameShapes: Count[];
  /** Files whose shape was seen fewer than MIN_SHAPE_COUNT times, so it is not listed: a rare shape could point at one file. */
  rareShapeFiles: number;
}

export interface LayoutSummary {
  parts: { files: number; folders: LayoutFolder[] }[];
}

const TOP_LEVEL = "(top level)";
const SHAPES_PER_FOLDER = 5;
/** A shape is listed only when this many files share it, so no listed shape singles out one file. */
const MIN_SHAPE_COUNT = 3;

/** Per-folder totals for each part. Folder names outside the known layout are numbered, never shown. */
export function layoutSummary(parts: ZipEntryInfo[][]): LayoutSummary {
  return {
    parts: parts.map((entries) => {
      const folders = new Map<string, { path: string; size: number }[]>();
      let files = 0;
      for (const e of entries) {
        const path = normPath(e.name);
        if (!isFile(path)) continue;
        files += 1;
        const segments = path.split("/");
        const top = segments.length > 1 ? (segments[0] as string) : TOP_LEVEL;
        const list = folders.get(top) ?? [];
        list.push({ path, size: e.size });
        folders.set(top, list);
      }

      let unknown = 0;
      const out: LayoutFolder[] = [...folders]
        .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
        .map(([top, list]) => {
          const label = top === TOP_LEVEL || KNOWN_DIRS.has(top.toLowerCase()) ? top.toLowerCase() : `<folder-${++unknown}>`;
          const exts = tally();
          const shapes = tally();
          let bytes = 0;
          let inSubfolders = 0;
          for (const f of list) {
            const ext = extensionOf(f.path);
            exts.bump(ext);
            bytes += Number.isFinite(f.size) ? f.size : 0;
            if (f.path.split("/").length > 2) inSubfolders += 1;
            if (ext !== "json" && ext !== "html" && ext !== "htm") {
              const base = baseOf(f.path);
              shapes.bump(`${fileNameShape(stemOf(base))}${ext.startsWith("(") ? "" : `.${ext}`}`);
            }
          }
          const common = shapes.top(Infinity).filter((c) => c.count >= MIN_SHAPE_COUNT);
          const rareShapeFiles = shapes.top(Infinity).reduce((n, c) => (c.count < MIN_SHAPE_COUNT ? n + c.count : n), 0);
          return { label, files: list.length, bytes, extensions: exts.top(Infinity), inSubfolders, nameShapes: common.slice(0, SHAPES_PER_FOLDER), rareShapeFiles };
        });
      return { files, folders: out };
    }),
  };
}

export function formatLayoutSummary(l: LayoutSummary): string {
  const out = ["Folder totals (names of files are never shown)"];
  l.parts.forEach((p, i) => {
    out.push(`part ${i + 1}: ${p.files} files`);
    for (const f of p.folders) {
      const subfolders = f.inSubfolders > 0 ? `, ${f.inSubfolders} in subfolders` : "";
      out.push(`  ${f.label}${f.label === TOP_LEVEL ? "" : "/"}  ${f.files} files, ${sizeText(f.bytes)}  [${countsText(f.extensions)}]${subfolders}`);
      for (const s of f.nameShapes) out.push(`      name shape ${s.count}x: ${s.label}`);
      if (f.rareShapeFiles > 0) out.push(`      ${f.rareShapeFiles} more with name shapes seen fewer than ${MIN_SHAPE_COUNT} times (not listed)`);
    }
  });
  return out.join("\n");
}

// ------------------------------------------------------------ memories list ---

/** The list of saved media inside a parsed memories_history.json: "Saved Media" if present, else its first list. */
export function memoriesListOf(root: unknown): unknown[] | undefined {
  if (Array.isArray(root)) return root;
  if (!isRecord(root)) return undefined;
  const saved = Object.keys(root).find((k) => normKey(k) === "savedmedia" && Array.isArray(root[k]));
  return (saved !== undefined ? root[saved] : Object.values(root).find(Array.isArray)) as unknown[] | undefined;
}

type MediaKind = "image" | "video" | "other" | "missing";

interface ListEntry {
  kind: MediaKind;
  /** Capture time in whole-second epoch ms, when the date is readable. */
  timeMs?: number;
  /** UTC calendar day (YYYY-MM-DD) of that time. */
  day?: string;
  /** Raw link values, read only to be measured and masked. */
  links: { field: string; value: unknown }[];
}

const LINK_FIELDS: { field: string; key: string }[] = [
  { field: "Download Link", key: "downloadlink" },
  { field: "Media Download URL", key: "mediadownloadurl" },
];

const DATE_TEXT = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?\s*(?:UTC|Z)?$/i;

function dateMs(value: unknown): number | undefined {
  const m = typeof value === "string" ? DATE_TEXT.exec(value.trim()) : null;
  if (!m) return undefined;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number) as [number, number, number, number, number, number];
  if (h > 23 || mi > 59 || s > 59) return undefined;
  const ms = Date.UTC(y, mo - 1, d, h, mi, s);
  return new Date(ms).getUTCDate() === d ? ms : undefined; // rejects a day the month does not have
}

function kindOfType(value: unknown): MediaKind {
  if (typeof value !== "string") return "missing";
  const t = value.toLowerCase();
  return /image|photo|picture/.test(t) ? "image" : /video|movie|clip/.test(t) ? "video" : "other";
}

function readListEntry(raw: unknown): ListEntry {
  const rec = isRecord(raw) ? raw : {};
  const byKey = new Map<string, unknown>();
  for (const k of Object.keys(rec)) {
    const n = normKey(k);
    if (n === "date" || n === "mediatype" || LINK_FIELDS.some((f) => f.key === n)) byKey.set(n, rec[k]);
  }
  const timeMs = dateMs(byKey.get("date"));
  const entry: ListEntry = {
    kind: kindOfType(byKey.get("mediatype")),
    links: LINK_FIELDS.map((f) => ({ field: f.field, value: byKey.get(f.key) })),
  };
  if (timeMs !== undefined) {
    entry.timeMs = timeMs;
    entry.day = new Date(timeMs).toISOString().slice(0, 10);
  }
  return entry;
}

// ------------------------------------------------------------ memory files ---

interface MemoryFileEntry {
  /** 0-based index of the zip part. */
  part: number;
  entry: ZipEntryInfo;
  file: MemoryMediaFile;
}

/** Media files under a memories folder, classified by pairing's own rules; HTML pages and archiver sidecars are skipped. */
function memoryFilesOf(parts: ZipEntryInfo[][]): MemoryFileEntry[] {
  const out: MemoryFileEntry[] = [];
  parts.forEach((entries, part) => {
    for (const entry of entries) {
      if (baseOf(normPath(entry.name)).startsWith("._")) continue;
      const [file] = classifyMemoryMedia([{ name: entry.name, size: entry.size }], part + 1);
      if (file !== undefined) out.push({ part, entry, file });
    }
  });
  return out;
}

// -------------------------------------------------------------- link check ---

export interface MemoryLinkCheck {
  entries: number;
  mediaFiles: number;
  distinctFileIds: number;
  /** Entries with at least one link field holding a non-empty text. */
  entriesWithLinkText: number;
  entriesWithId: number;
  matchedById: number;
  filesMatchedById: number;
  matchedByDate: number;
  idParameters: Count[];
  mediaTypes: Count[];
  /** Masked link shapes, e.g. "Download Link: empty". */
  linkPatterns: Count[];
}

const PARAM_NAME = /^[A-Za-z_]{1,12}$/;
const MAX_PARAMS = 8;
const MAX_PATH_SEGMENTS = 6;
const paramLabel = (name: string): string => (PARAM_NAME.test(name) ? name : "<param>");

/** A masked description of one link value: its kind, or the shape of each part of a URL. */
function linkPattern(field: string, value: unknown): { pattern: string; ids: { param: string; id: string }[] } {
  if (typeof value !== "string") return { pattern: `${field}: absent`, ids: [] };
  if (value.trim() === "") return { pattern: `${field}: empty`, ids: [] };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { pattern: `${field}: not a URL`, ids: [] };
  }
  const scheme = url.protocol === "https:" ? "https" : url.protocol === "http:" ? "http" : "other-scheme";
  const host = url.hostname.split(".").map((l) => nameShape(l, 12)).join(".");
  const path = url.pathname.split("/").slice(0, MAX_PATH_SEGMENTS + 1).map((seg) => (seg ? nameShape(seg, 24) : "")).join("/");
  const ids: { param: string; id: string }[] = [];
  const params: string[] = [];
  for (const [k, v] of url.searchParams) {
    if (params.length < MAX_PARAMS) params.push(`${paramLabel(k)}[${nameShape(v, 12)}, ${v.length} chars]`);
    for (const id of v.match(UUID) ?? []) ids.push({ param: paramLabel(k), id: id.toUpperCase() });
  }
  for (const id of url.pathname.match(UUID) ?? []) ids.push({ param: "<path>", id: id.toUpperCase() });
  // Described in words, not written as a URL, so a report never holds anything link-shaped.
  const parameters = params.length === 0 ? "no parameters" : `parameters ${params.join(" ")}`;
  return { pattern: `${field}: ${scheme} link, host ${host}, path ${path || "/"}, ${parameters}`, ids };
}

/**
 * Can each list entry be matched to its file by an ID that appears in both? Counts and masked
 * patterns only. `items` is the list from a parsed memories_history.json; `parts` the zip listings.
 */
export function memoryLinkCheck(items: unknown[], parts: ZipEntryInfo[][]): MemoryLinkCheck {
  const files = memoryFilesOf(parts);
  const fileIds = new Set(files.flatMap((f) => (f.file.idInName === undefined ? [] : [f.file.idInName])));
  const fileDays = new Set(files.flatMap((f) => (f.file.nameDay === undefined ? [] : [f.file.nameDay])));

  const patterns = tally();
  const idParams = tally();
  const types = tally();
  const usedIds = new Set<string>();
  let withText = 0;
  let withId = 0;
  let matchedById = 0;
  let matchedByDate = 0;

  for (const raw of items) {
    const entry = readListEntry(raw);
    types.bump(entry.kind);
    if (entry.day !== undefined && fileDays.has(entry.day)) matchedByDate += 1;
    let hasText = false;
    let hasId = false;
    let matched = false;
    for (const { field, value } of entry.links) {
      const { pattern, ids } = linkPattern(field, value);
      patterns.bump(pattern);
      if (typeof value === "string" && value.trim() !== "") hasText = true;
      for (const { param, id } of ids) {
        idParams.bump(param);
        hasId = true;
        if (fileIds.has(id)) {
          matched = true;
          usedIds.add(id);
        }
      }
    }
    if (hasText) withText += 1;
    if (hasId) withId += 1;
    if (matched) matchedById += 1;
  }

  return {
    entries: items.length,
    mediaFiles: files.length,
    distinctFileIds: fileIds.size,
    entriesWithLinkText: withText,
    entriesWithId: withId,
    matchedById,
    filesMatchedById: usedIds.size,
    matchedByDate,
    idParameters: idParams.top(5),
    mediaTypes: types.top(6),
    linkPatterns: patterns.top(4),
  };
}

export function formatMemoryLinkCheck(c: MemoryLinkCheck): string {
  const out = [
    "Memories link check (counts and patterns only; no values)",
    `  list entries: ${c.entries}; memory media files across parts: ${c.mediaFiles}; distinct IDs in file names: ${c.distinctFileIds}`,
    `  entries with a non-empty link value: ${c.entriesWithLinkText}`,
    `  entries whose link contains an ID: ${c.entriesWithId}; of those, matching a file by ID: ${c.matchedById}`,
    `  files matched by some entry's ID: ${c.filesMatchedById} of ${c.distinctFileIds}`,
    `  entries whose date matches the date prefix of some file (weaker check): ${c.matchedByDate}`,
    `  link parameter names that carry an ID: ${countsText(c.idParameters, " ") || "none"}`,
    `  media type values: ${countsText(c.mediaTypes) || "none"}`,
    "  link patterns (letters and digits masked; parameter names shown):",
    ...c.linkPatterns.map((p) => `    ${p.count}x ${p.label}`),
  ];
  if (c.entriesWithId === 0) out.push("  Result: no entry has an ID in its links, so links cannot pair entries with files.");
  return out.join("\n");
}

// -------------------------------------------------------------- time check ---

export type TimeVerdict = "direct" | "offset" | "fallback" | "none" | "no-files" | "no-list";

export interface MemoryTimeCheck {
  entries: number;
  entriesWithUnreadableDate: number;
  mediaFiles: number;
  unreadableHeaders: number;
  /** File roles by name suffix: main, overlay, other. */
  roles: Count[];
  filesWithUtc: number;
  filesWithDosOnly: number;
  mainFiles: number;
  distinctMainTimes: number;
  /** Stored-time UTC day compared with the day written in the file name. */
  dayVsName: { same: number; earlier: number; later: number; other: number };
  /** List entries that share their exact second with another entry. */
  entriesSharingASecond: number;
  /** What pairMemories makes of this export (the same step the rescue uses). */
  pairing: {
    method: PairingResult["method"];
    /** Clock offset (stored wall clock minus UTC) that pairing detected; 0 unless method is offset-time. */
    offsetHours: number;
    /** Further offsets of the same clock (daylight saving time moves it by an hour); empty unless method is offset-time. */
    extraOffsetHours: number[];
    paired: number;
    unmatchedItems: number;
    unmatchedFiles: number;
    overlays: number;
    ambiguous: number;
  };
  verdict: TimeVerdict;
}

interface StoredTime {
  /** UTC epoch ms from the extended-timestamp field. */
  utc?: number;
  /** DOS 2-second time read as if it were UTC (the zipper's local time zone is unknown). */
  dos?: number;
}

/**
 * The modified time in a zip entry's local header. Reads exactly the 30-byte fixed header and the
 * extra field, so not one byte of the entry's data is requested.
 */
async function storedTime(reader: RandomAccessReader, info: ZipEntryInfo): Promise<StoredTime | undefined> {
  const at = info.localHeaderOffset;
  if (!Number.isSafeInteger(at) || at < 0 || at + 30 > reader.size) return undefined;
  try {
    const head = await reader.read(at, at + 30);
    if (head.length < 30) return undefined;
    const v = new DataView(head.buffer, head.byteOffset, head.byteLength);
    if (v.getUint32(0, true) !== 0x04034b50) return undefined;
    const result: StoredTime = {};
    const time = v.getUint16(10, true);
    const date = v.getUint16(12, true);
    const month = (date >> 5) & 15;
    const day = date & 31;
    if (month >= 1 && month <= 12 && day >= 1) {
      result.dos = Date.UTC(((date >> 9) & 127) + 1980, month - 1, day, time >> 11, (time >> 5) & 63, (time & 31) * 2);
    }

    const extraStart = at + 30 + v.getUint16(26, true);
    const extraLength = v.getUint16(28, true);
    if (extraLength > 0 && extraStart + extraLength <= reader.size) {
      const extra = await reader.read(extraStart, extraStart + extraLength);
      const x = new DataView(extra.buffer, extra.byteOffset, extra.byteLength);
      for (let p = 0; p + 4 <= x.byteLength; p += 4 + x.getUint16(p + 2, true)) {
        const size = x.getUint16(p + 2, true);
        if (x.getUint16(p, true) === 0x5455 && size >= 5 && p + 9 <= x.byteLength && (x.getUint8(p + 4) & 1) !== 0) result.utc = x.getUint32(p + 5, true) * 1000;
      }
    }
    return result;
  } catch {
    return undefined; // a reader failure costs this one file, and its message is not ours to repeat
  }
}

/** Whole days from the file-name day to the stored-time day, bucketed. */
function dayBucket(storedMs: number, nameDay: string): keyof MemoryTimeCheck["dayVsName"] {
  const days = Math.round((Date.parse(`${new Date(storedMs).toISOString().slice(0, 10)}T00:00:00Z`) - Date.parse(`${nameDay}T00:00:00Z`)) / 86_400_000);
  return days === 0 ? "same" : days === -1 ? "earlier" : days === 1 ? "later" : "other";
}

const VERDICT_BY_METHOD: Record<PairingResult["method"], TimeVerdict> = {
  "utc-time": "direct",
  "offset-time": "offset",
  "date-type": "fallback",
  none: "none",
};

/**
 * Tests whether each memory file's stored time matches an entry's Date in memories_history.json
 * (the pairing that works when download links are empty). Reads each Memories entry's local
 * header for its stored time, then runs pairMemories, which also detects the clock offset(s)
 * when only DOS times (the zipper's local clock) are present. `parts` are the listings of
 * `readers`, in the same order.
 */
export async function memoryTimeCheck(readers: RandomAccessReader[], parts: ZipEntryInfo[][], items: unknown[]): Promise<MemoryTimeCheck> {
  const listed = items.map(readListEntry);
  const memoryItems: MemoryItem[] = listed.map((e, i) => ({ id: String(i), date: e.timeMs ?? null, mediaType: e.kind === "image" || e.kind === "video" ? e.kind : "unknown" }));
  const listTimes = listed.flatMap((e) => (e.timeMs === undefined ? [] : [e.timeMs]));

  const found = memoryFilesOf(parts);
  const files: MemoryMediaFile[] = [];
  let unreadable = 0;
  for (let i = 0; i < found.length; i += HEADER_BATCH) {
    const batch = found.slice(i, i + HEADER_BATCH);
    const times = await Promise.all(batch.map((f) => storedTime(readers[f.part] as RandomAccessReader, f.entry)));
    batch.forEach((f, k) => {
      const t = times[k];
      if (t === undefined || (t.utc === undefined && t.dos === undefined)) unreadable += 1;
      const stored: { name: string; size: number; mtimeUtcMs?: number; mtimeDosMs?: number } = { name: f.entry.name, size: f.entry.size };
      if (t?.utc !== undefined) stored.mtimeUtcMs = t.utc;
      else if (t?.dos !== undefined) stored.mtimeDosMs = t.dos;
      const [timed] = classifyMemoryMedia([stored], f.part + 1);
      files.push(timed ?? f.file);
    });
  }

  const mains = files.filter((f) => f.role === "main");
  const timedMains = mains.filter((f) => f.timeMs !== undefined);
  const roles = tally();
  for (const f of files) roles.bump(f.role);
  const dayVsName = { same: 0, earlier: 0, later: 0, other: 0 };
  for (const f of timedMains) if (f.nameDay !== undefined) dayVsName[dayBucket(f.timeMs as number, f.nameDay)] += 1;

  const counts = new Map<number, number>();
  for (const t of listTimes) counts.set(t, (counts.get(t) ?? 0) + 1);
  let sharing = 0;
  for (const n of counts.values()) if (n > 1) sharing += n;

  const pairing = pairMemories(memoryItems, files);
  return {
    entries: items.length,
    entriesWithUnreadableDate: items.length - listTimes.length,
    mediaFiles: files.length,
    unreadableHeaders: unreadable,
    roles: roles.top(6),
    filesWithUtc: files.filter((f) => f.timeKind === "utc").length,
    filesWithDosOnly: files.filter((f) => f.timeKind === "dos").length,
    mainFiles: mains.length,
    distinctMainTimes: new Set(timedMains.map((f) => f.timeMs)).size,
    dayVsName,
    entriesSharingASecond: sharing,
    pairing: {
      method: pairing.method,
      offsetHours: pairing.offsetHours,
      extraOffsetHours: pairing.extraOffsetHours,
      paired: pairing.summary.paired,
      unmatchedItems: pairing.summary.unmatchedItems,
      unmatchedFiles: pairing.summary.unmatchedFiles,
      overlays: pairing.summary.overlays,
      ambiguous: pairing.summary.ambiguous,
    },
    verdict: mains.length === 0 ? "no-files" : listTimes.length === 0 ? "no-list" : VERDICT_BY_METHOD[pairing.method],
  };
}

const VERDICT_TEXT: Record<TimeVerdict, string> = {
  direct: "stored times match the list's dates directly, so files can be paired by time.",
  offset: "stored times match the list's dates after a clock offset, so files can be paired by time with that offset applied.",
  fallback: "stored times do not match the list's dates, so pairing falls back to the date in the file name plus the media type, and Snappy says so.",
  none: "no file could be paired by time, or by date and type.",
  "no-files": "there are no Memories media files to pair.",
  "no-list": "the list has no readable dates.",
};

const PAIRING_METHOD_TEXT: Record<PairingResult["method"], string> = {
  "utc-time": "exact stored UTC time",
  "offset-time": "stored time with a clock offset",
  "date-type": "file-name date and media type",
  none: "none",
};

export function formatMemoryTimeCheck(c: MemoryTimeCheck): string {
  const p = c.pairing;
  const signed = (h: number): string => `${h >= 0 ? "+" : ""}${h} h`;
  const offset =
    p.method === "offset-time"
      ? `; ${Number.isInteger(p.offsetHours) ? "whole-hour " : ""}offset ${signed(p.offsetHours)} (stored clock minus UTC)${p.extraOffsetHours.length > 0 ? `, and ${p.extraOffsetHours.map(signed).join(", ")} where the clock changed (as around daylight saving time)` : ""}`
      : "";
  return [
    "Memories file-time check (counts only; no values)",
    `  list entries: ${c.entries} (${c.entriesWithUnreadableDate} with an unreadable date); memory media files: ${c.mediaFiles}${c.unreadableHeaders ? ` (${c.unreadableHeaders} with an unreadable stored time)` : ""}`,
    `  file roles by name suffix: ${countsText(c.roles) || "none"}`,
    `  files with an extended UTC timestamp: ${c.filesWithUtc}; DOS 2-second time only: ${c.filesWithDosOnly}`,
    `  distinct stored times among main files: ${c.distinctMainTimes} of ${c.mainFiles}`,
    `  stored-time day vs file-name day: same ${c.dayVsName.same}, one day earlier ${c.dayVsName.earlier}, one day later ${c.dayVsName.later}, other ${c.dayVsName.other}`,
    `  list entries that share their exact second with another entry (cannot be told apart by time alone): ${c.entriesSharingASecond}`,
    `  pairing method: ${PAIRING_METHOD_TEXT[p.method]}${offset}`,
    `  paired: ${p.paired} of ${c.entries} entries; entries without a file: ${p.unmatchedItems}; files without an entry: ${p.unmatchedFiles}; overlays attached: ${p.overlays}; left unmatched as ambiguous: ${p.ambiguous}`,
    `  Result: ${VERDICT_TEXT[c.verdict]}`,
  ].join("\n");
}

// ------------------------------------------------------------- orchestrator ---

export interface InspectOptions {
  /** Also print unknown field names that look harmless (review before sharing). */
  showKeys?: boolean;
  layout?: boolean;
  memoryLinks?: boolean;
  mtimeCheck?: boolean;
  /** Print only the requested checks, not the JSON structure. */
  checksOnly?: boolean;
}

export interface InspectOutput {
  /** The whole report, ending with a newline. Contains no value from the export. */
  text: string;
  /** False when nothing in the zips could be read (a caller may turn that into an exit code). */
  readable: boolean;
}

type MemoriesList = { status: "ok"; items: unknown[] } | { status: "missing" | "unreadable" };

/**
 * Find memories_history.json in any part, stream it and return its list of saved media: only the
 * date, type and link fields of each entry are decoded, so locations are never read. The list is
 * "Saved Media" when there is one, else the first list (or a bare list of entries).
 */
async function loadMemoriesList(readers: RandomAccessReader[], parts: ZipEntryInfo[][]): Promise<MemoriesList> {
  for (const [i, entries] of parts.entries()) {
    const entry = entries.find((e) => baseOf(normPath(e.name)).toLowerCase() === "memories_history.json");
    if (entry === undefined) continue;
    try {
      const lists = new Map<string, ProjectedRecord[]>();
      const source = inflateSource(readers[i] as RandomAccessReader, entry);
      for await (const { conversationKey, record } of projectConversations(source, { keepFields: LIST_KEEP_FIELDS.memories })) {
        const list = lists.get(conversationKey);
        if (list === undefined) lists.set(conversationKey, [record]);
        else list.push(record);
      }
      const saved = [...lists.keys()].find((k) => normKey(k) === "savedmedia");
      const list = lists.get(saved ?? [...lists.keys()][0] ?? "");
      return { status: "ok", items: list ?? [] };
    } catch {
      return { status: "unreadable" }; // neither the parser's message nor an entry error text is repeated
    }
  }
  return { status: "missing" };
}

const LIST_PROBLEM: Record<"missing" | "unreadable", string> = {
  missing: "memories_history.json was not found in these ZIP files.",
  unreadable: "memories_history.json could not be read as a list of saved media.",
};

/**
 * One report for one export: the JSON structure (unless `checksOnly`) followed by whichever
 * checks were asked for. `readers` are the zip parts in order (base, -2, -3).
 */
export async function inspectExport(readers: RandomAccessReader[], opts: InspectOptions = {}): Promise<InspectOutput> {
  const sections: string[] = [];
  let structure: StructureReport | undefined;
  let readable = true;
  const wantsChecks = opts.layout === true || opts.memoryLinks === true || opts.mtimeCheck === true;

  if (opts.checksOnly !== true) {
    structure = await describeStructureFromReader(readers, { showKeys: opts.showKeys === true });
    sections.push(formatStructureReport(structure).trimEnd());
    readable = !(structure.files.length === 0 && structure.notes.length > 0);
  }

  if (wantsChecks) {
    const { parts, unreadable } = await listParts(readers);
    if (opts.checksOnly === true) {
      readable = readers.length > 0 && unreadable.length < readers.length;
      const notes = unreadable.map((i) => `note: ${readers.length > 1 ? `part ${i + 1}: ` : ""}zip unreadable`);
      if (notes.length > 0) sections.push(notes.join("\n"));
    }
    if (opts.layout === true) sections.push(formatLayoutSummary(layoutSummary(parts)));
    if (opts.memoryLinks === true || opts.mtimeCheck === true) {
      const list = await loadMemoriesList(readers, parts);
      if (opts.memoryLinks === true) {
        sections.push(list.status === "ok" ? formatMemoryLinkCheck(memoryLinkCheck(list.items, parts)) : `Memories link check\n  ${LIST_PROBLEM[list.status]}`);
      }
      if (opts.mtimeCheck === true) {
        sections.push(list.status === "ok" ? formatMemoryTimeCheck(await memoryTimeCheck(readers, parts, list.items)) : `Memories file-time check\n  ${LIST_PROBLEM[list.status]}`);
      }
    }
  }
  return { text: sections.join("\n\n") + "\n", readable };
}
