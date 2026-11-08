/**
 * Minimal zip central-directory reader. fflate does not surface entry modified
 * times, and we need two things before inflating anything: a trustworthy entry
 * count (a hostile count would make the extractor loop for ages) and the newest
 * mtime (to estimate when the export was generated). Only headers are read: no
 * entry data is touched.
 */

export interface ZipDirectoryInfo {
  entryCount: number;
  /** Newest mtime in epoch ms (plausible values only) of the .json files under json/, or of any entry when there are none. */
  newestMtime?: number;
}

const LOW = Date.UTC(1990, 0, 1);
const HIGH = Date.UTC(2100, 0, 1);

const plausible = (ms: number): boolean => Number.isFinite(ms) && ms >= LOW && ms <= HIGH;

/**
 * A data file of the export: a .json file under a folder named "json". Its stored time is when
 * Snapchat wrote the export; the photos and videos next to it keep the times they were taken or
 * saved, and a zipper that repacks the media stamps them "now". So these times date the export first.
 */
export function isJsonDataEntry(name: string): boolean {
  const path = name.replace(/\\/g, "/").toLowerCase();
  return path.endsWith(".json") && path.split("/").slice(0, -1).includes("json");
}

/** DOS date/time carries no zone; reading it as UTC keeps results deterministic (error < 1 day). */
function dosToMs(date: number, time: number): number {
  const month = (date >> 5) & 15;
  const day = date & 31;
  if (month < 1 || month > 12 || day < 1) return NaN;
  return Date.UTC(1980 + (date >> 9), month - 1, day, time >> 11, (time >> 5) & 63, (time & 31) * 2);
}

/** Read the "extended timestamp" (0x5455) extra field: a real UTC mtime, preferred over DOS time. */
function extendedMtime(view: DataView, start: number, end: number): number | undefined {
  let p = start;
  while (p + 4 <= end) {
    const id = view.getUint16(p, true);
    const size = view.getUint16(p + 2, true);
    const body = p + 4;
    if (id === 0x5455 && size >= 5 && body + 5 <= end && (view.getUint8(body) & 1) !== 0) {
      return view.getUint32(body + 1, true) * 1000;
    }
    p = body + size;
  }
  return undefined;
}

/**
 * Modified time of one central-directory record (epoch ms), or undefined when it is missing or
 * implausible. `record` is the offset of the record in `view`, `extraStart..extraEnd` its extra field.
 * Shared with the random-access reader (zip-reader.ts), which sees the directory in chunks.
 */
export function centralEntryMtime(view: DataView, record: number, extraStart: number, extraEnd: number): number | undefined {
  const mtime = extendedMtime(view, extraStart, extraEnd) ?? dosToMs(view.getUint16(record + 14, true), view.getUint16(record + 12, true));
  return plausible(mtime) ? mtime : undefined;
}

/** Number from a little-endian 64-bit field; sizes beyond 2^53 are irrelevant here and become Infinity-ish. */
export function u64(view: DataView, at: number): number {
  return view.getUint32(at, true) + view.getUint32(at + 4, true) * 4294967296;
}

/** True when the bytes just before `end` spell ".json" in any letter case. */
function endsWithJson(bytes: Uint8Array, end: number): boolean {
  const tail = ".json";
  if (end < tail.length) return false;
  for (let i = 0; i < tail.length; i++) {
    if (((bytes[end - tail.length + i] as number) | 0x20) !== tail.charCodeAt(i)) return false;
  }
  return true;
}

/**
 * Inspect the central directory. Returns undefined when it cannot be located or is
 * inconsistent; callers then rely on the zip library to produce its own failure.
 */
export function readZipDirectory(zip: Uint8Array, maxEntries: number): ZipDirectoryInfo | undefined {
  if (zip.length < 22) return undefined;
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);

  let eocd = zip.length - 22;
  while (view.getUint32(eocd, true) !== 0x06054b50) {
    if (eocd === 0 || zip.length - eocd > 65558) return undefined;
    eocd--;
  }

  let count = view.getUint16(eocd + 10, true);
  let dirOffset = view.getUint32(eocd + 16, true);
  if (eocd >= 20 && view.getUint32(eocd - 20, true) === 0x07064b50) {
    const z64 = u64(view, eocd - 12);
    if (z64 + 56 <= zip.length && view.getUint32(z64, true) === 0x06064b50) {
      count = u64(view, z64 + 32);
      dirOffset = u64(view, z64 + 48);
    }
  }
  if (count > maxEntries) return { entryCount: count };

  let newest: number | undefined;
  let newestJson: number | undefined;
  let p = dirOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > zip.length || view.getUint32(p, true) !== 0x02014b50) return undefined;
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const extraStart = p + 46 + nameLen;
    const next = extraStart + extraLen + commentLen;
    if (next > zip.length) return undefined;

    const mtime = centralEntryMtime(view, p, extraStart, extraStart + extraLen);
    if (mtime !== undefined) {
      if (newest === undefined || mtime > newest) newest = mtime;
      // Only a name that can be a data file is decoded (the check is on bytes first, so media names are never turned into strings).
      if ((newestJson === undefined || mtime > newestJson) && endsWithJson(zip, p + 46 + nameLen) && isJsonDataEntry(new TextDecoder().decode(zip.subarray(p + 46, p + 46 + nameLen)))) newestJson = mtime;
    }
    p = next;
  }
  const dated = newestJson ?? newest;
  return dated === undefined ? { entryCount: count } : { entryCount: count, newestMtime: dated };
}
