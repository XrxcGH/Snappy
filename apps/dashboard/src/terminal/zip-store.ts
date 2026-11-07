/**
 * A .zip made of stored (uncompressed) entries, built in the page from the files a command saved in the
 * virtual folder. Photos and videos are already compressed, so storing them costs nothing and keeps the
 * work to headers and a checksum. The result is a Blob of small header parts and the original byte
 * arrays: the bytes are not copied into a second array here. Each entry carries its modified time twice,
 * as DOS time and as the extended timestamp, so a rescued Memory keeps its capture time inside the
 * archive even where no file date can be set.
 *
 * Limits of this format without the zip64 extensions: 65,535 entries and 4 GiB in all. Beyond that the
 * caller says so calmly and the files are saved one by one.
 */
import { crc32 } from "@snappy-export/core";

export interface ZipEntry {
  /** The path inside the archive, with "/" separators and no leading slash. */
  path: string;
  bytes: Uint8Array;
  /** Modified time, epoch ms. 0 or an implausible value means "use the fallback". */
  mtimeMs: number;
}

export type ZipLimit = "entries" | "size";

export class ZipTooBigError extends Error {
  readonly limit: ZipLimit;

  constructor(limit: ZipLimit) {
    super(limit);
    this.name = "ZipTooBigError";
    this.limit = limit;
  }
}

export const MAX_ENTRIES = 65_535;
export const MAX_BYTES = 0xffff_ffff;

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
const FLAG_UTF8 = 0x0800;
const EXTRA_TIME = 9; // id (2) + size (2) + flags (1) + mtime (4)
const FIRST = Date.UTC(1980, 0, 1);
const LAST = Date.UTC(2107, 11, 31);

/** DOS date and time as UTC fields (the convention this tool reads them with). */
function dosFields(ms: number): { time: number; date: number } {
  const d = new Date(ms);
  return {
    time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1),
    date: ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
  };
}

function timeExtra(seconds: number): Uint8Array {
  const out = new Uint8Array(EXTRA_TIME);
  const view = new DataView(out.buffer);
  view.setUint16(0, 0x5455, true);
  view.setUint16(2, 5, true);
  out[4] = 1;
  view.setUint32(5, seconds >>> 0, true);
  return out;
}

/** Build the archive. `fallbackMs` stands in for any entry without a usable time. */
export function buildZip(entries: readonly ZipEntry[], fallbackMs: number): Blob {
  if (entries.length > MAX_ENTRIES) throw new ZipTooBigError("entries");
  const encoder = new TextEncoder();
  const names = entries.map((e) => encoder.encode(e.path));
  // The size is known before any checksum is computed: a total that cannot be stored is refused first.
  const total = entries.reduce((n, e, i) => n + 30 + 46 + 2 * (names[i] as Uint8Array).length + 2 * EXTRA_TIME + e.bytes.length, 22);
  if (total > MAX_BYTES) throw new ZipTooBigError("size");
  const parts: BlobPart[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const [index, entry] of entries.entries()) {
    const name = names[index] as Uint8Array;
    const ms = entry.mtimeMs >= FIRST && entry.mtimeMs <= LAST ? entry.mtimeMs : fallbackMs;
    const { time, date } = dosFields(Math.min(LAST, Math.max(FIRST, ms)));
    const extra = timeExtra(Math.floor(ms / 1000));
    const crc = crc32(entry.bytes);
    const size = entry.bytes.length;
    const local = new Uint8Array(30 + name.length + extra.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, LOCAL, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, FLAG_UTF8, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, extra.length, true);
    local.set(name, 30);
    local.set(extra, 30 + name.length);

    const record = new Uint8Array(46 + name.length + extra.length);
    const cv = new DataView(record.buffer);
    cv.setUint32(0, CENTRAL, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, FLAG_UTF8, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, name.length, true);
    cv.setUint16(30, extra.length, true);
    cv.setUint32(42, offset, true);
    record.set(name, 46);
    record.set(extra, 46 + name.length);
    central.push(record);

    offset += local.length + size;
    if (offset > MAX_BYTES) throw new ZipTooBigError("size");
    parts.push(local, entry.bytes as unknown as BlobPart);
  }

  const directorySize = central.reduce((n, r) => n + r.length, 0);
  if (offset + directorySize + 22 > MAX_BYTES) throw new ZipTooBigError("size");
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, END, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, directorySize, true);
  ev.setUint32(16, offset, true);
  parts.push(...(central as unknown as BlobPart[]), end);
  return new Blob(parts, { type: "application/zip" });
}
