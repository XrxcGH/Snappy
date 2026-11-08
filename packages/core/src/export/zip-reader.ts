/**
 * Random-access zip reading for very large exports (multi-GB, multi-part, mostly media).
 *
 * Nothing here needs the archive in memory. A caller supplies a RandomAccessReader (a file
 * handle, a Blob slice, ...); this module asks it for:
 *   - the tail of the archive (end-of-central-directory, zip64 aware),
 *   - the central directory, in bounded chunks,
 *   - for the few entries a caller asks to open, the local header and exactly that entry's
 *     compressed bytes.
 * The data of every other entry (all media) is never requested, so memory stays proportional
 * to the entry list plus the (capped) JSON files, however big the archive is.
 *
 * Privacy: like the rest of core this does no I/O of its own and never puts an entry name or
 * any data into an error or issue message. Callers bring the reader.
 */
import { Inflate } from "fflate";
import type { MemoryMediaFile } from "../memories/pair.ts";
import type { ChatEvent, DeletedFriendRecord, ExportIssue, FriendRecord, MemoryItem, ParsedExport, ParsedFriends } from "../types.ts";
import { HISTORY_KEEP_FIELDS, HistoryReader, spellings } from "./chats.ts";
import { crc32 } from "./crc32.ts";
import { JsonStreamError, inflateSource, projectConversations } from "./json-stream.ts";
import type { JsonStreamErrorCode, ProjectedRecord } from "./json-stream.ts";
import { issue } from "./json-util.ts";
import { PAIRING_ISSUE_CODES, attachBundledMedia, sortBundledMedia } from "./memories.ts";
import {
  MAX_ENTRIES,
  MAX_JSON_FILE_BYTES,
  STREAMED_TARGETS,
  TARGET_NAMES,
  capFileList,
  combineMediaNotOpened,
  emptyParsed,
  finishExport,
  normPath,
  parseTargetJson,
  planJsonReads,
  splitListing,
  targetOf,
  usernamesOf,
  zipEncryptedIssue,
  zipEntryTooLargeIssue,
  zipEntryUnreadableIssue,
  zipUnsupportedMethodIssue,
  zipTooManyEntriesIssue,
  zipUnreadableIssue,
} from "./parse.ts";
import type { Entry, Outcome, Outcomes, PartLabel, Target, TargetValues } from "./parse.ts";
import { centralEntryMtime, u64 } from "./zip.ts";

// ------------------------------------------------------------------ readers ---

/** Read access to a byte source of known size. Ranges are half-open: [start, end). */
export interface RandomAccessReader {
  readonly size: number;
  read(start: number, end: number): Promise<Uint8Array>;
}

/**
 * Reader over bytes already in memory (tests, small zips). Returns views, not copies: callers
 * must not modify what they get back. An out-of-range request rejects with a RangeError.
 */
export function bytesReader(bytes: Uint8Array): RandomAccessReader {
  return {
    size: bytes.byteLength,
    read(start, end) {
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > bytes.byteLength) {
        return Promise.reject(new RangeError("read range is outside the byte source"));
      }
      return Promise.resolve(bytes.subarray(start, end));
    },
  };
}

/**
 * Checked read: validates the range against the declared size and the length of the answer, so
 * a lying size or a short read surfaces as an error here instead of as garbage later.
 */
async function readRange(reader: RandomAccessReader, start: number, end: number): Promise<Uint8Array> {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > reader.size) {
    throw new RangeError("read range is outside the archive");
  }
  if (end === start) return new Uint8Array(0);
  const bytes = await reader.read(start, end);
  if (bytes.byteLength !== end - start) throw new RangeError("the reader returned a short read");
  return bytes;
}

const viewOf = (bytes: Uint8Array): DataView => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

// ------------------------------------------------------------------ listing ---

export interface ZipEntryInfo {
  /** Name exactly as stored in the central directory. */
  name: string;
  /** Compression method: 0 stored, 8 deflate (others are listed but cannot be opened). */
  method: number;
  compressedSize: number;
  /** Uncompressed size as declared. Infinity when a zip64 field was missing. */
  size: number;
  localHeaderOffset: number;
  /** CRC-32 of the uncompressed data, as the central directory declares it; checked whenever the entry is read. */
  crc32?: number;
  /**
   * Stored modification time as a real UTC instant (epoch ms), from the extended-timestamp extra
   * field (0x5455). Absent when the archive has no such field or its value is implausible.
   */
  mtimeUtcMs?: number;
  /**
   * The 2-second DOS date/time read as UTC wall-clock numbers (Date.UTC of the raw fields), never
   * machine-local. It is the zipper's local clock, so it may be off by whole hours. Absent when
   * the raw fields are not a valid date.
   */
  mtimeDosMs?: number;
}

export interface ZipListing {
  entries: ZipEntryInfo[];
  issues: ExportIssue[];
  /** Newest plausible entry mtime in epoch ms (what parseExportZip reports as exportedAt). */
  newestMtime?: number;
}

const EOCD_SIGNATURE = 0x06054b50;
const EOCD_MIN_SIZE = 22;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_LOCATOR_SIZE = 20;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const ZIP64_EOCD_SIZE = 56;
const CENTRAL_SIGNATURE = 0x02014b50;
const CENTRAL_FIXED_SIZE = 46;
const MAX_COMMENT = 0xffff;
/** Window size when the end record is not the last 22 bytes (an archive comment follows it). */
const EOCD_SCAN_WINDOW = 1024;
/** The central directory is read this many bytes at a time. */
const DIRECTORY_CHUNK = 1024 * 1024;

const utf8 = new TextDecoder("utf-8");

/** Entry names are UTF-8 when general-purpose flag bit 11 is set, otherwise single-byte (as fflate reads them). */
function decodeName(bytes: Uint8Array, flags: number): string {
  if ((flags & 0x800) !== 0) return utf8.decode(bytes);
  let ascii = true;
  for (let i = 0; i < bytes.length && ascii; i++) ascii = (bytes[i] as number) < 0x80;
  if (ascii) return utf8.decode(bytes);
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i] as number);
  return out;
}

interface DirectoryLocation {
  offset: number;
  size: number;
  /** Declared entry count, or undefined when the 16-bit field is saturated without a zip64 record. */
  count: number | undefined;
}

/**
 * Find the end-of-central-directory record (EOCD). Normal archives have no trailing comment, so
 * the EOCD is exactly the last 22 bytes and that is all that is read. Only when it is not do we
 * scan backwards in small windows; in that (rare) case a window may reach a little before the
 * directory. A record whose comment ends exactly at the end of the file wins over one that merely
 * fits (a comment may itself contain something that looks like an end record).
 */
async function findEocd(reader: RandomAccessReader): Promise<{ at: number; record: DataView } | undefined> {
  const size = reader.size;
  const fits = (view: DataView, at: number, limit: number): number | undefined => {
    if (view.getUint32(at, true) !== EOCD_SIGNATURE) return undefined;
    const after = at + EOCD_MIN_SIZE + view.getUint16(at + 20, true);
    return after <= limit ? limit - after : undefined; // bytes left over after the comment
  };

  const last = await readRange(reader, size - EOCD_MIN_SIZE, size);
  if (fits(viewOf(last), 0, EOCD_MIN_SIZE) === 0) return { at: size - EOCD_MIN_SIZE, record: viewOf(last) };

  let fallback: { at: number; record: DataView } | undefined;
  const lowest = Math.max(0, size - (EOCD_MIN_SIZE + MAX_COMMENT));
  for (let windowEnd = size - EOCD_MIN_SIZE + 1; windowEnd > lowest; windowEnd -= EOCD_SCAN_WINDOW) {
    const windowStart = Math.max(lowest, windowEnd - EOCD_SCAN_WINDOW);
    // Candidates start in [windowStart, windowEnd); each needs 22 bytes, hence the extra tail.
    const bytes = await readRange(reader, windowStart, Math.min(size, windowEnd + EOCD_MIN_SIZE - 1));
    const view = viewOf(bytes);
    for (let p = windowEnd - 1 - windowStart; p >= 0; p--) {
      const left = fits(view, p, size - windowStart);
      if (left === undefined) continue;
      const found = { at: windowStart + p, record: new DataView(bytes.buffer, bytes.byteOffset + p, EOCD_MIN_SIZE) };
      if (left === 0) return found;
      fallback ??= found; // trailing bytes after the comment: tolerated only if nothing fits exactly
    }
  }
  return fallback;
}

/** Locate the central directory through the (zip64 aware) end record; undefined when there is none. */
async function locateDirectory(reader: RandomAccessReader): Promise<DirectoryLocation | undefined> {
  if (!Number.isSafeInteger(reader.size) || reader.size < EOCD_MIN_SIZE) return undefined;
  const eocd = await findEocd(reader);
  if (eocd === undefined) return undefined;
  const { at, record: end } = eocd;

  if (at >= ZIP64_LOCATOR_SIZE) {
    const locator = viewOf(await readRange(reader, at - ZIP64_LOCATOR_SIZE, at));
    const recordAt = u64(locator, 8);
    if (locator.getUint32(0, true) === ZIP64_LOCATOR_SIGNATURE && Number.isSafeInteger(recordAt) && recordAt + ZIP64_EOCD_SIZE <= at - ZIP64_LOCATOR_SIZE) {
      const record = viewOf(await readRange(reader, recordAt, recordAt + ZIP64_EOCD_SIZE));
      if (record.getUint32(0, true) === ZIP64_EOCD_SIGNATURE) {
        return { count: u64(record, 32), size: u64(record, 40), offset: u64(record, 48) };
      }
    }
  }
  const size32 = end.getUint32(12, true);
  const offset32 = end.getUint32(16, true);
  // Saturated offset/size fields mean "see the zip64 record", which was not found. A saturated
  // 16-bit count alone is fine (a directory with exactly 65535 entries): the count is then unknown.
  if (size32 === 0xffffffff || offset32 === 0xffffffff) return undefined;
  const count16 = end.getUint16(10, true);
  return { count: count16 === 0xffff ? undefined : count16, size: size32, offset: offset32 };
}

/** Values of the zip64 extended-information extra field for the sizes/offset that were saturated. */
function zip64Extra(view: DataView, start: number, end: number, want: { size: boolean; compressed: boolean; offset: boolean }): { size?: number; compressed?: number; offset?: number } {
  const out: { size?: number; compressed?: number; offset?: number } = {};
  let p = start;
  while (p + 4 <= end) {
    const id = view.getUint16(p, true);
    const len = view.getUint16(p + 2, true);
    const body = p + 4;
    if (id === 0x0001) {
      const stop = Math.min(end, body + len);
      let q = body;
      // Fields appear in this fixed order, each only when its 32-bit counterpart is saturated.
      if (want.size && q + 8 <= stop) { out.size = u64(view, q); q += 8; }
      if (want.compressed && q + 8 <= stop) { out.compressed = u64(view, q); q += 8; }
      if (want.offset && q + 8 <= stop) out.offset = u64(view, q);
      break;
    }
    p = body + len;
  }
  return out;
}

const SATURATED = 0xffffffff;

const TIME_LOW = Date.UTC(1990, 0, 1);
const TIME_HIGH = Date.UTC(2100, 0, 1);
const EXTENDED_TIMESTAMP_ID = 0x5455;
const NTFS_ID = 0x000a;
/** Milliseconds from 1601-01-01 (the NTFS epoch) to 1970-01-01. */
const NTFS_EPOCH_OFFSET_MS = 11_644_473_600_000;

/** Exact UTC mtime from an NTFS extra field (7-Zip stores it): reserved word, then tagged attributes, tag 1 = three FILETIMEs. */
function ntfsUtcMtime(view: DataView, body: number, len: number): number | undefined {
  let p = body + 4;
  const end = body + len;
  while (p + 4 <= end) {
    const tag = view.getUint16(p, true);
    const size = view.getUint16(p + 2, true);
    if (tag === 1 && size >= 8 && p + 4 + 8 <= end) {
      // 100 ns units; rounding to a whole millisecond removes the float error of a large number.
      const ms = Math.round((view.getUint32(p + 8, true) * 4294967296 + view.getUint32(p + 4, true)) / 10_000) - NTFS_EPOCH_OFFSET_MS;
      return ms >= TIME_LOW && ms <= TIME_HIGH ? ms : undefined;
    }
    p += 4 + size;
  }
  return undefined;
}

/**
 * UTC mtime from the extended-timestamp extra field (flags byte, then mtime when flag bit 0 is
 * set) or, failing that, the NTFS field, or undefined. Every read stays inside [start, end): a
 * field whose declared size runs past the extra data is malformed and ends the scan instead of
 * being trusted.
 */
function extendedUtcMtime(view: DataView, start: number, end: number): number | undefined {
  let p = start;
  let ntfs: number | undefined;
  while (p + 4 <= end) {
    const id = view.getUint16(p, true);
    const len = view.getUint16(p + 2, true);
    const body = p + 4;
    if (body + len > end) return undefined;
    if (id === EXTENDED_TIMESTAMP_ID && len >= 5 && (view.getUint8(body) & 1) !== 0) {
      const ms = view.getUint32(body + 1, true) * 1000;
      return ms >= TIME_LOW && ms <= TIME_HIGH ? ms : undefined;
    }
    if (id === NTFS_ID && ntfs === undefined) ntfs = ntfsUtcMtime(view, body, len);
    p = body + len;
  }
  return ntfs;
}

/** DOS date and time fields as UTC wall-clock numbers; undefined for fields that are not a real date. */
function dosWallClockMs(date: number, time: number): number | undefined {
  const month = (date >> 5) & 15;
  const day = date & 31;
  const hour = time >> 11;
  const minute = (time >> 5) & 63;
  const second = (time & 31) * 2;
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return undefined;
  const ms = Date.UTC(1980 + (date >> 9), month - 1, day, hour, minute, second);
  // Date.UTC rolls day 31 of a 30-day month into the next month: that is not a valid stored date.
  return new Date(ms).getUTCDate() === day ? ms : undefined;
}

/** How many local headers are read at the same time (each is a separate range read: latency, not bytes, is the cost). */
const LOCAL_READS_IN_FLIGHT = 24;

/** What the person sees while the local headers are read. */
export const LOCAL_TIME_PHASE = "Matching Memories to files";

/** Progress of the local-header pass: `done` of `total` files looked at. */
export interface LocalTimeProgress {
  phase: string;
  done: number;
  total: number;
}

/**
 * Local headers carry their own extra field, which is where some zippers put the extended
 * timestamp when the central directory has none. Reads one small header per entry that lacks a
 * UTC time (and passes `include`), never any entry data; use `include` to limit this to the
 * entries that matter. Up to 24 entries are looked at at once, so thousands of entries cost
 * their round trips divided by that, not one after the other. Returns new entry objects and
 * leaves the input alone; an entry whose header cannot be read or has no timestamp is returned
 * unchanged. `onDone` is told after each entry that was looked at.
 */
export async function addLocalHeaderTimes(
  reader: RandomAccessReader,
  entries: readonly ZipEntryInfo[],
  include: (entry: ZipEntryInfo) => boolean = () => true,
  onDone?: () => void,
): Promise<ZipEntryInfo[]> {
  const out: ZipEntryInfo[] = [...entries];
  const wanted: number[] = [];
  entries.forEach((entry, i) => {
    if (entry.mtimeUtcMs === undefined && include(entry)) wanted.push(i);
  });
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const at = next++;
      if (at >= wanted.length) return;
      const i = wanted[at] as number;
      out[i] = await withLocalHeaderTime(reader, entries[i] as ZipEntryInfo);
      onDone?.();
    }
  };
  await Promise.all(Array.from({ length: Math.min(LOCAL_READS_IN_FLIGHT, wanted.length) }, worker));
  return out;
}

async function withLocalHeaderTime(reader: RandomAccessReader, entry: ZipEntryInfo): Promise<ZipEntryInfo> {
  try {
    const at = entry.localHeaderOffset;
    const header = viewOf(await readRange(reader, at, at + LOCAL_FIXED_SIZE));
    if (header.getUint32(0, true) !== LOCAL_SIGNATURE) return entry;
    const extraAt = at + LOCAL_FIXED_SIZE + header.getUint16(26, true);
    const extra = viewOf(await readRange(reader, extraAt, extraAt + header.getUint16(28, true)));
    const mtimeUtcMs = extendedUtcMtime(extra, 0, extra.byteLength);
    return mtimeUtcMs === undefined ? entry : { ...entry, mtimeUtcMs };
  } catch {
    return entry; // a failing read costs only this entry's time
  }
}

/** A Memories media file: under a folder named "memories", and not one of its HTML pages. */
const isMemoryMedia = (e: ZipEntryInfo): boolean => {
  const segments = e.name.replace(/\\/g, "/").split("/");
  return segments.slice(0, -1).some((d) => d.toLowerCase() === "memories") && !/\.html?$/i.test(e.name);
};

/** How many Memories files are probed before concluding that the local headers hold no times either. */
const LOCAL_TIME_PROBE = 16;

/**
 * Memories pairing is exact only with a real UTC time, which some zippers write in the local
 * headers alone. When the central directory gives a Memories file none, look at the local
 * headers: a few files first, and the rest only if those showed that the headers do carry one, so
 * an archive without any pays for sixteen small reads, not two per file. Each file is looked at
 * once (the probe is not repeated), and `onProgress` counts them.
 */
async function withMemoryLocalTimes(
  reader: RandomAccessReader,
  entries: ZipEntryInfo[],
  onProgress?: (progress: LocalTimeProgress) => void,
): Promise<ZipEntryInfo[]> {
  const lacking = entries.filter((e) => e.mtimeUtcMs === undefined && isMemoryMedia(e));
  if (lacking.length === 0) return entries;
  const probe = new Set(lacking.slice(0, LOCAL_TIME_PROBE));
  const total = lacking.length;
  let done = 0;
  const count = (): void => {
    done += 1;
    onProgress?.({ phase: LOCAL_TIME_PHASE, done, total });
  };
  const probed = await addLocalHeaderTimes(reader, entries, (e) => probe.has(e), count);
  if (!probed.some((e, i) => e.mtimeUtcMs !== undefined && entries[i]?.mtimeUtcMs === undefined)) return entries;
  return addLocalHeaderTimes(reader, probed, (e) => isMemoryMedia(e) && !probe.has(e), count);
}

/**
 * List a zip's entries by reading ONLY the end-of-central-directory record and the central
 * directory (in bounded chunks); entry data is never read. Never throws: a damaged or
 * unreadable archive comes back as an error issue and an empty entry list (all or nothing, like
 * parseExportZip), a reader failure the same way.
 */
export async function listZipEntries(reader: RandomAccessReader, label: PartLabel = {}): Promise<ZipListing> {
  const fail = (...issues: ExportIssue[]): ZipListing => ({ entries: [], issues });
  try {
    const dir = await locateDirectory(reader);
    if (dir === undefined) return fail(zipUnreadableIssue(label));
    if (dir.count !== undefined && dir.count > MAX_ENTRIES) return fail(zipTooManyEntriesIssue(dir.count));
    const end = dir.offset + dir.size;
    if (!Number.isSafeInteger(end) || end > reader.size) return fail(zipUnreadableIssue(label));

    const entries: ZipEntryInfo[] = [];
    let newest: number | undefined;
    // `buf` holds directory bytes [bufStart, bufStart + buf.length); `p` is the next record.
    let buf: Uint8Array = new Uint8Array(0);
    let view = viewOf(buf);
    let bufStart = dir.offset;
    let p = dir.offset;
    const refill = async (need: number): Promise<void> => {
      buf = await readRange(reader, p, p + Math.min(end - p, Math.max(need, DIRECTORY_CHUNK)));
      view = viewOf(buf);
      bufStart = p;
    };

    while (end - p >= CENTRAL_FIXED_SIZE) {
      if (p + CENTRAL_FIXED_SIZE > bufStart + buf.length) await refill(CENTRAL_FIXED_SIZE);
      let at = p - bufStart;
      if (view.getUint32(at, true) !== CENTRAL_SIGNATURE) return fail(zipUnreadableIssue(label));
      const nameLen = view.getUint16(at + 28, true);
      const extraLen = view.getUint16(at + 30, true);
      const commentLen = view.getUint16(at + 32, true);
      const total = CENTRAL_FIXED_SIZE + nameLen + extraLen + commentLen;
      if (total > end - p) return fail(zipUnreadableIssue(label));
      if (p + total > bufStart + buf.length) {
        await refill(total);
        at = 0;
      }
      if (entries.length >= MAX_ENTRIES) return fail(zipTooManyEntriesIssue(entries.length + 1));

      const nameAt = at + CENTRAL_FIXED_SIZE;
      const extraAt = nameAt + nameLen;
      let compressedSize = view.getUint32(at + 20, true);
      let size = view.getUint32(at + 24, true);
      let localHeaderOffset = view.getUint32(at + 42, true);
      if (size === SATURATED || compressedSize === SATURATED || localHeaderOffset === SATURATED) {
        const z = zip64Extra(view, extraAt, extraAt + extraLen, {
          size: size === SATURATED,
          compressed: compressedSize === SATURATED,
          offset: localHeaderOffset === SATURATED,
        });
        // A saturated field with no zip64 value behind it is unusable: Infinity makes any open fail cleanly.
        if (size === SATURATED) size = z.size ?? Infinity;
        if (compressedSize === SATURATED) compressedSize = z.compressed ?? Infinity;
        if (localHeaderOffset === SATURATED) localHeaderOffset = z.offset ?? Infinity;
      }
      const info: ZipEntryInfo = {
        name: decodeName(buf.subarray(nameAt, extraAt), view.getUint16(at + 8, true)),
        method: view.getUint16(at + 10, true),
        compressedSize,
        size,
        localHeaderOffset,
        crc32: view.getUint32(at + 16, true),
      };
      // Set only when present, so entries without a stored time keep their original shape.
      const utcMs = extendedUtcMtime(view, extraAt, extraAt + extraLen);
      if (utcMs !== undefined) info.mtimeUtcMs = utcMs;
      const dosMs = dosWallClockMs(view.getUint16(at + 14, true), view.getUint16(at + 12, true));
      if (dosMs !== undefined) info.mtimeDosMs = dosMs;
      entries.push(info);

      const mtime = centralEntryMtime(view, at, extraAt, extraAt + extraLen);
      if (mtime !== undefined && (newest === undefined || mtime > newest)) newest = mtime;
      p += total;
    }

    const issues: ExportIssue[] = [];
    if (dir.count !== undefined && dir.count !== entries.length) {
      issues.push(issue("warning", "zip-entry-count-mismatch", `The ZIP file says it holds ${dir.count} items, but Snappy found ${entries.length}. It may be damaged.`));
    }
    return newest === undefined ? { entries, issues } : { entries, issues, newestMtime: newest };
  } catch {
    // The reader failed or lied about its size; its own message is not ours to repeat.
    return fail(zipUnreadableIssue(label));
  }
}

// ----------------------------------------------------------- opening entries ---

export type ZipEntryErrorCode = "unsupported-method" | "encrypted" | "too-large" | "corrupt";

const ENTRY_ERROR_TEXT: Record<ZipEntryErrorCode, string> = {
  "unsupported-method": "This archive entry uses an unsupported compression method.",
  encrypted: "This archive entry is encrypted.",
  "too-large": "This archive entry is larger than the allowed limit.",
  corrupt: "This archive entry is damaged or cannot be read.",
};

/** Thrown by readZipEntry. The message is fixed text: no entry name, no data, no reader error. */
export class ZipEntryError extends Error {
  readonly code: ZipEntryErrorCode;
  constructor(code: ZipEntryErrorCode) {
    super(ENTRY_ERROR_TEXT[code]);
    this.name = "ZipEntryError";
    this.code = code;
  }
}

/** Default per-entry cap: same as the largest JSON file parseExportZip will inflate. */
const DEFAULT_MAX_ENTRY_BYTES = MAX_JSON_FILE_BYTES;
const LOCAL_SIGNATURE = 0x04034b50;
const LOCAL_FIXED_SIZE = 30;
/**
 * Compressed bytes are fed to the inflater this many at a time, which bounds how much one
 * decompression bomb can expand before the declared size is found to be exceeded.
 */
const INFLATE_CHUNK = 32 * 1024;

/** The bytes, once they match the entry's declared CRC-32 (an entry that declares none is not checked). */
function verified(info: ZipEntryInfo, bytes: Uint8Array): Uint8Array {
  if (info.crc32 !== undefined && crc32(bytes) !== info.crc32) throw new ZipEntryError("corrupt");
  return bytes;
}

/**
 * Read one entry's bytes: its local header and exactly its compressed range, nothing else.
 * Supports stored (0) and deflate (8) and verifies the declared uncompressed size. Throws
 * ZipEntryError when the method is unsupported, the entry is encrypted, damaged or larger than
 * `maxBytes` (default 256 MiB). For stored entries the result may alias the reader's buffer.
 * The declared CRC-32 is verified, so a damaged download fails here ("corrupt") instead of
 * passing as good data.
 */
export async function readZipEntry(reader: RandomAccessReader, info: ZipEntryInfo, opts: { maxBytes?: number } = {}): Promise<Uint8Array> {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_ENTRY_BYTES;
  if (info.method !== 0 && info.method !== 8) throw new ZipEntryError("unsupported-method");
  // Order matters: an Infinity (unresolvable zip64) size is "too large", NaN or negative is "corrupt".
  if (info.size > maxBytes || info.compressedSize > maxBytes + (maxBytes >> 10) + 1024) throw new ZipEntryError("too-large");
  for (const n of [info.size, info.compressedSize, info.localHeaderOffset]) {
    if (!Number.isSafeInteger(n) || n < 0) throw new ZipEntryError("corrupt");
  }
  if (info.method === 0 && info.compressedSize !== info.size) throw new ZipEntryError("corrupt");

  try {
    const header = viewOf(await readRange(reader, info.localHeaderOffset, info.localHeaderOffset + LOCAL_FIXED_SIZE));
    if (header.getUint32(0, true) !== LOCAL_SIGNATURE) throw new ZipEntryError("corrupt");
    if ((header.getUint16(6, true) & 0x41) !== 0) throw new ZipEntryError("encrypted"); // bit 0 password, bit 6 strong
    const start = info.localHeaderOffset + LOCAL_FIXED_SIZE + header.getUint16(26, true) + header.getUint16(28, true);
    const end = start + info.compressedSize;
    if (end > reader.size) throw new ZipEntryError("corrupt");

    if (info.method === 0) return verified(info, await readRange(reader, start, end));

    const out = new Uint8Array(info.size);
    let written = 0;
    const inflater = new Inflate((chunk) => {
      // More output than declared: stop at once instead of expanding a bomb to the end.
      if (written + chunk.length > out.length) throw new ZipEntryError("corrupt");
      out.set(chunk, written);
      written += chunk.length;
    });
    let at = start;
    do {
      const next = Math.min(end, at + INFLATE_CHUNK);
      inflater.push(await readRange(reader, at, next), next === end);
      at = next;
    } while (at < end);
    if (written !== out.length) throw new ZipEntryError("corrupt");
    return verified(info, out);
  } catch (e) {
    if (e instanceof ZipEntryError) throw e;
    throw new ZipEntryError("corrupt"); // inflater errors and reader failures: neither message is repeated
  }
}

// ------------------------------------------------------------------ parsing ---

/**
 * Most entries one streamed history may hold. A heavy user has a few million; this leaves several
 * times that and stops a tiny hostile file (billions of records fit in a few MB of zip) from
 * exhausting the memory of the tab or process.
 */
const MAX_STREAMED_RECORDS = 20_000_000;

/** The notes parseJsonBytes gives for a file it cannot read, for a file that failed while streaming. */
const STREAM_FAILURES: Record<Exclude<JsonStreamErrorCode, "source">, { code: string; text: (label: string) => string }> = {
  malformed: { code: "json-parse-failed", text: (label) => `${label} is not valid JSON, so it was not read.` },
  depth: { code: "json-too-complex", text: (label) => `${label} has too many items to read safely, so it was not read.` },
  limit: { code: "json-too-large", text: (label) => `${label} is too large to read, so it was not read.` },
  encoding: { code: "json-unsupported-encoding", text: (label) => `${label} uses a text encoding Snappy does not support, so it was not read.` },
};

/**
 * Read a chat or Snap history through the streaming projector: one conversation entry at a time,
 * so memory stays flat however big the file is and message text is skipped without being decoded.
 * All or nothing, like parsing a whole file: a file that turns out to be damaged gives no events.
 * Throws (ZipEntryError and the like) when the entry cannot be read at all.
 */
async function streamHistory(reader: RandomAccessReader, info: ZipEntryInfo, target: "chats" | "snaps", known?: ReadonlySet<string>): Promise<Outcome<ChatEvent[]>> {
  const history = new HistoryReader(target === "chats" ? "chat" : "snap", known);
  let records = 0;
  try {
    for await (const { conversationKey, record } of projectConversations(inflateSource(reader, info), { keepFields: [...HISTORY_KEEP_FIELDS] })) {
      // Entries are kept as events, so a hostile file of tiny records must not grow them without end.
      if (++records > MAX_STREAMED_RECORDS) throw new JsonStreamError("limit");
      history.add(conversationKey, record);
    }
  } catch (e) {
    if (!(e instanceof JsonStreamError) || e.code === "source") throw e;
    const failure = STREAM_FAILURES[e.code];
    return { issues: [issue("error", failure.code, failure.text(TARGET_NAMES[target]))] };
  }
  const r = history.finish();
  return { value: r.chats, issues: r.issues };
}

/**
 * The fields of friends.json and memories_history.json that the parsers read, in every spelling the
 * parsers accept (case and separators). Display names, sources and locations are not among them,
 * so the streaming reader skips those values without decoding them.
 */
export const LIST_KEEP_FIELDS: Record<"friends" | "memories", string[]> = {
  friends: [
    ...spellings([["username"], ["user"], ["snapchat", "username"]]),
    ...spellings([["creation", "timestamp"], ["creation", "time"], ["creation", "date"], ["created", "at"], ["created"]]),
    ...spellings([["last", "modified", "timestamp"], ["last", "modified", "time"], ["last", "modified"], ["modified", "at"], ["modified"]]),
    ...spellings([["date", "deleted"], ["deleted", "date"], ["deleted", "at"], ["deletion", "timestamp"], ["deleted", "timestamp"], ["deleted"], ["date"]]),
  ],
  memories: [
    ...spellings([["date"], ["capture", "date"], ["created"], ["created", "at"]]),
    ...spellings([["media", "type"], ["type"]]),
    ...spellings([["media", "download", "url"]]),
    ...spellings([["download", "link"], ["download", "url"]]),
  ],
};

/** What stands in for a value that was skipped, so the parser sees a section of that kind and nothing of its content. */
const PLACEHOLDER: Record<string, unknown> = { string: "x", number: 0, boolean: true, null: null, object: {} };

/**
 * Read friends.json or memories_history.json through the streaming projector and hand the parser
 * what it would have found, minus every value outside its allowlist: the top-level object (or
 * list), one list of records per section, only the allowlisted fields in each record. A section
 * that is not a list becomes a placeholder of its kind, so the parser's notes about sections
 * (unknown, not a list, none found) stay the same. Display names and locations are skipped as
 * bytes and never decoded. All or nothing, like the histories.
 */
async function streamList<K extends "friends" | "memories">(reader: RandomAccessReader, info: ZipEntryInfo, target: K): Promise<Outcome<TargetValues[K]>> {
  const sections = new Map<string, unknown>();
  const bare: unknown[] = [];
  const seen: { top: string | null } = { top: null };
  let records = 0;
  try {
    const onKind = (key: string | null, kind: string): void => {
      if (key === null) seen.top = kind;
      else if (kind !== "array" || !Array.isArray(sections.get(key))) sections.set(key, kind === "array" ? [] : PLACEHOLDER[kind]);
    };
    // An entry that is not a record (a name on its own, null) is skipped unread, but the parser counts
    // it as unusable when it holds the whole file, so the same count is kept here: a null stands in for it.
    const onNonRecord = (key: string): void => {
      if (++records > MAX_STREAMED_RECORDS) throw new JsonStreamError("limit");
      const list = sections.get(key);
      if (Array.isArray(list)) list.push(null);
      else if (seen.top === "array") bare.push(null);
    };
    for await (const { conversationKey, record } of projectConversations(inflateSource(reader, info), { keepFields: LIST_KEEP_FIELDS[target], onKind, onNonRecord })) {
      if (++records > MAX_STREAMED_RECORDS) throw new JsonStreamError("limit");
      const list = sections.get(conversationKey);
      if (Array.isArray(list)) list.push(record);
      else if (seen.top === "array") bare.push(record); // a bare list of records has no section name
    }
  } catch (e) {
    if (!(e instanceof JsonStreamError) || e.code === "source") throw e;
    const failure = STREAM_FAILURES[e.code];
    return { issues: [issue("error", failure.code, failure.text(TARGET_NAMES[target]))] };
  }
  const { top } = seen;
  const json: unknown = top === "object" ? Object.fromEntries(sections) : top === "array" ? bare : top === null ? undefined : PLACEHOLDER[top];
  return parseTargetJson(target, json);
}

/** WinZip AES: the entry says method 99 and is encrypted, whatever the general purpose flag says. */
const AES_METHOD = 99;

/**
 * The notice for an entry that could not be read: the cause when the archive says it (password
 * protected, a compression method Snappy does not have, too large), the generic one otherwise.
 * Fixed text only: nothing from the reader or the entry's data.
 */
function entryFailureIssue(e: unknown, wanted: Entry, info: ZipEntryInfo, label: PartLabel): ExportIssue {
  if (e instanceof ZipEntryError) {
    if (e.code === "encrypted" || (e.code === "unsupported-method" && info.method === AES_METHOD)) return zipEncryptedIssue(label);
    if (e.code === "unsupported-method") return zipUnsupportedMethodIssue(label);
    if (e.code === "too-large") return zipEntryTooLargeIssue(wanted);
  }
  return zipEntryUnreadableIssue(wanted, label);
}

/**
 * parseExportZip for an archive behind a reader. Same rules and result shape: only the four
 * known data files are read; every other entry (all media, other JSON and HTML) is listed by
 * masked name only and its data is never requested. All four data files are streamed (no size
 * limit); message text, display names and locations are skipped as bytes and never decoded. The
 * Memories media files are listed with their stored times, never opened.
 * `opts.part` is this zip's 1-based position among the parts of the export (base name first,
 * then -2, -3): it travels with the files so a later extraction knows which zip to open.
 * `opts.name` is the person's own file name for this zip: when the zip or a file in it cannot be
 * read, the notice names it and (from `opts.part`) says whether the lists or only photos and
 * videos are affected. A password protected, unsupported or oversized entry gets its own notice.
 * `opts.onProgress` is told how many Memories files have had their local header looked at, with
 * the phase text "Matching Memories to files", when the central directory holds no UTC times (it
 * is never called otherwise). Never throws on bad input.
 */
export async function parseExportFromReader(
  reader: RandomAccessReader,
  opts: { part?: number; name?: string; onProgress?: (progress: LocalTimeProgress) => void } = {},
): Promise<ParsedExport> {
  const label: PartLabel = { ...(opts.name !== undefined && { name: opts.name }), ...(opts.part !== undefined && { part: opts.part }) };
  const { entries: listed, issues: listIssues, newestMtime } = await listZipEntries(reader, label);
  if (listIssues.some((i) => i.severity === "error")) return emptyParsed(listIssues);
  const entries = await withMemoryLocalTimes(reader, listed, opts.onProgress);

  const listing: Entry[] = entries.map((e) => ({
    name: e.name,
    path: normPath(e.name),
    size: e.size,
    ...(e.mtimeUtcMs !== undefined && { mtimeUtcMs: e.mtimeUtcMs }),
    ...(e.mtimeDosMs !== undefined && { mtimeDosMs: e.mtimeDosMs }),
  }));
  const issues = [...listIssues];
  const outcomes: Outcomes = {};
  // One entry at a time, so a corrupt or unsupported file costs only itself.
  for (const wanted of planJsonReads(listing, issues, STREAMED_TARGETS)) {
    const target = targetOf(wanted) as Target;
    const info = entries[listing.indexOf(wanted)] as ZipEntryInfo;
    try {
      if (target === "chats" || target === "snaps") outcomes[target] = await streamHistory(reader, info, target, usernamesOf(outcomes.friends?.value));
      else if (target === "friends") outcomes.friends = await streamList(reader, info, "friends");
      else outcomes.memories = await streamList(reader, info, "memories");
    } catch (e) {
      issues.push(entryFailureIssue(e, wanted, info, label));
    }
  }
  const { files, media } = splitListing(listing);
  return finishExport(files, media, outcomes, issues, newestMtime, opts.part ?? 1);
}

// ------------------------------------------------------------------ merging ---

/**
 * Union of several lists by key. The output order depends only on the SET of parts, never on the
 * order they are given in: items sort by their earliest position in any part, ties by key. So a
 * merge is order-independent, and merging a list with itself (or alone) keeps that list's order.
 * `combine` must be commutative and associative; `copy` clones the first-seen item.
 */
/**
 * Key of the n-th occurrence of `base` within one list: the first is `base`, a repeat gets a suffix.
 * Repeats inside one part stay separate records (a part holds what it holds), and only the same
 * occurrence in another part collapses with it, so merging [a] gives a back unchanged.
 */
function occurrenceKey(base: string, seenInList: Map<string, number>): string {
  const n = seenInList.get(base) ?? 0;
  seenInList.set(base, n + 1);
  return n === 0 ? base : `${base}\u0000#${n}`;
}

function unionBy<T>(
  lists: readonly (readonly T[])[],
  keyOf: (t: T, seenInList: Map<string, number>) => string,
  combine: (a: T, b: T) => T,
  copy: (t: T) => T = (t) => t,
): T[] {
  const slots = new Map<string, { item: T; rank: number }>();
  for (const list of lists) {
    const seenInList = new Map<string, number>();
    list.forEach((item, rank) => {
      const key = keyOf(item, seenInList);
      const slot = slots.get(key);
      if (slot === undefined) {
        slots.set(key, { item: copy(item), rank });
      } else {
        slot.item = combine(slot.item, item);
        if (rank < slot.rank) slot.rank = rank;
      }
    });
  }
  const byRankThenKey = (a: [string, { rank: number }], b: [string, { rank: number }]): number =>
    a[1].rank - b[1].rank || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  return [...slots.entries()].sort(byRankThenKey).map(([, slot]) => slot.item);
}

const earliest = (a?: number, b?: number): number | undefined => (a === undefined ? b : b === undefined ? a : Math.min(a, b));
const latest = (a?: number, b?: number): number | undefined => (a === undefined ? b : b === undefined ? a : Math.max(a, b));
const smaller = (a?: string, b?: string): string | undefined => (a === undefined ? b : b === undefined ? a : a < b ? a : b);
/** Drop undefined properties so merged records have the same shape as parsed ones. */
const compact = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

/** Same person in two parts: the earliest createdAt (the friendship started then), the latest modification. */
const mergeFriend = (a: FriendRecord, b: FriendRecord): FriendRecord =>
  compact({ username: a.username, createdAt: earliest(a.createdAt, b.createdAt), modifiedAt: latest(a.modifiedAt, b.modifiedAt) });
const mergeDeleted = (a: DeletedFriendRecord, b: DeletedFriendRecord): DeletedFriendRecord =>
  compact({ ...mergeFriend(a, b), deletedAt: latest(a.deletedAt, b.deletedAt) });
const cloneRecord = <T extends object>(r: T): T => ({ ...r });

const SEVERITY_RANK = { info: 0, warning: 1, error: 2 } as const;
/** Same note, same wording and (for the per-part counts) the same parts: parts with equal counts stay separate until they are added up. */
const issueKey = (i: ExportIssue): string => `${i.code}\u0000${i.message}${i.partCounts === undefined ? "" : `\u0000${JSON.stringify(i.partCounts)}`}`;

const mergeIssue = (a: ExportIssue, b: ExportIssue): ExportIssue => (SEVERITY_RANK[b.severity] > SEVERITY_RANK[a.severity] ? { ...a, severity: b.severity } : a);

const cloneMemory = (m: MemoryItem): MemoryItem => ({
  ...m,
  ...(m.overlayPaths !== undefined && { overlayPaths: [...m.overlayPaths] }),
  ...(m.overlayParts !== undefined && { overlayParts: [...m.overlayParts] }),
});

/**
 * Same memory (same id) in two parts: keep whatever either part knows, deterministically. The file
 * fields (zipPath, partIndex, overlayPaths, overlayParts) travel together from the part whose zipPath sorts first.
 */
function mergeMemory(a: MemoryItem, b: MemoryItem): MemoryItem {
  const known = (t: MemoryItem["mediaType"]) => t !== "unknown";
  const order = (m: MemoryItem): string => `${m.zipPath ?? "\uffff"}\u0000${String(m.partIndex ?? 0).padStart(9, "0")}\u0000${m.overlayPaths?.join("\u0001") ?? ""}\u0000${m.overlayParts?.join(",") ?? ""}`;
  const file = order(b) < order(a) ? b : a;
  return compact<MemoryItem>({
    id: a.id,
    date: a.date === null ? b.date : b.date === null ? a.date : Math.min(a.date, b.date),
    mediaType: a.mediaType === b.mediaType || !known(b.mediaType) ? a.mediaType : !known(a.mediaType) || b.mediaType < a.mediaType ? b.mediaType : a.mediaType,
    downloadUrl: smaller(a.downloadUrl, b.downloadUrl),
    zipPath: file.zipPath,
    partIndex: file.partIndex,
    overlayPaths: file.overlayPaths === undefined ? undefined : [...file.overlayPaths],
    overlayParts: file.overlayParts === undefined ? undefined : [...file.overlayParts],
    sizeBytes: latest(a.sizeBytes, b.sizeBytes),
  });
}

const mediaKey = (f: MemoryMediaFile): string => `${f.part}\u0000${f.path}`;

const TIME_KIND_RANK = { none: 0, dos: 1, utc: 2 } as const;
/** The same file seen twice (two different exports merged): the better stored time wins, whatever the order. */
const betterFile = (a: MemoryMediaFile, b: MemoryMediaFile): MemoryMediaFile => {
  const by = TIME_KIND_RANK[b.timeKind] - TIME_KIND_RANK[a.timeKind] || (b.timeMs ?? 0) - (a.timeMs ?? 0) || b.size - a.size;
  return by > 0 ? b : a;
};

/**
 * Identity of a chat event across parts. Two messages can share (conversation, direction, kind, at)
 * inside one part (same second), and those are real, separate events: the n-th occurrence of a key
 * within a part is a different identity from the first, so only repeats ACROSS parts collapse.
 */
const chatKey = (c: ChatEvent, seenInList: Map<string, number>): string =>
  occurrenceKey(`${c.conversation}\u0000${c.direction}\u0000${c.kind}\u0000${c.at}`, seenInList);

/** Friend lists repeat a username only when the export did (the check for that runs after the merge). */
const usernameKey = (r: { username: string }, seenInList: Map<string, number>): string => occurrenceKey(r.username, seenInList);

/**
 * Chat events of all parts. Only part 1 of a real export holds the histories, and keying millions
 * of events (a string, a slot and a map entry each) costs seconds and gigabytes for a union that
 * cannot change anything, so with at most one populated part its list is simply copied.
 */
function mergeChats(parts: readonly ParsedExport[]): ChatEvent[] {
  const populated = parts.filter((p) => p.chats.length > 0);
  if (populated.length <= 1) return populated[0] === undefined ? [] : [...populated[0].chats];
  return unionBy(populated.map((p) => p.chats), chatKey, (a) => a);
}

/**
 * Combine the parses of several zip parts of one export. Friends and requests are keyed by
 * username (earliest createdAt wins; a username repeated inside one part stays repeated, so the
 * duplicate check sees the same list whether the export has one zip or several), chats by
 * (conversation, direction, kind, at) with repeats inside one part kept, memories by id; exportedAt is the newest; issues are de-duplicated by code and message; file lists are
 * unioned and capped at 500. Order-independent and idempotent (merge of [a, a] equals a, merge
 * of [a] equals a). Inputs are not modified; chat events are shared with the inputs, not cloned.
 *
 * Memories media files (bundledMedia) are unioned by (part, path) and, when there are any, the
 * Memories list is paired with ALL of them again: no single part holds both the list (part 1) and
 * the files (parts 2 and 3), so pairing per part is only provisional. The notes about pairing are
 * replaced by the ones for the whole export.
 */
export function mergeParsedExports(parts: ParsedExport[]): ParsedExport {
  const friendList = (pick: (f: ParsedFriends) => FriendRecord[]): FriendRecord[] =>
    unionBy(parts.map((p) => pick(p.friends)), usernameKey, mergeFriend, cloneRecord);

  const friends: ParsedFriends = {
    friends: friendList((f) => f.friends),
    sentRequests: friendList((f) => f.sentRequests),
    pendingRequests: friendList((f) => f.pendingRequests),
    deletedFriends: unionBy(parts.map((p) => p.friends.deletedFriends), usernameKey, mergeDeleted, cloneRecord),
    blocked: friendList((f) => f.blocked),
    ignored: friendList((f) => f.ignored),
    hiddenSuggestions: friendList((f) => f.hiddenSuggestions),
  };

  const bundledMedia = sortBundledMedia(unionBy(parts.map((p) => p.bundledMedia ?? []), mediaKey, betterFile, cloneRecord));
  let memories = unionBy(parts.map((p) => p.memories), (m) => m.id, mergeMemory, cloneMemory);
  let pairing: ParsedExport["memoriesPairing"];
  const pairingIssues: ExportIssue[] = [];
  // Parses that never saw the files (or hand-made ones) keep what they carry; nothing is re-derived for them.
  const repair = bundledMedia.length > 0;
  if (repair) {
    const r = attachBundledMedia(memories, bundledMedia);
    memories = r.memories;
    pairing = r.pairing;
    pairingIssues.push(...r.issues);
  }

  const extraIssues: ExportIssue[] = [];
  const fileList = capFileList(unionBy(parts.map((p) => p.fileList), (name) => name, (a) => a), extraIssues);
  const issueLists = [...parts.map((p) => (repair ? p.issues.filter((i) => !PAIRING_ISSUE_CODES.has(i.code)) : p.issues)), extraIssues];

  const merged: ParsedExport = {
    friends,
    chats: mergeChats(parts),
    memories,
    fileList,
    issues: [...combineMediaNotOpened(unionBy(issueLists, issueKey, mergeIssue, cloneRecord)), ...pairingIssues],
  };
  if (bundledMedia.length > 0) merged.bundledMedia = bundledMedia;
  if (pairing !== undefined) merged.memoriesPairing = pairing;
  const exportedAt = parts.reduce<number | undefined>((acc, p) => latest(acc, p.exportedAt), undefined);
  if (exportedAt !== undefined) merged.exportedAt = exportedAt;
  return merged;
}
