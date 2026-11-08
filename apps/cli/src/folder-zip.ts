/**
 * An export that a browser unzipped (Safari does, after a download) is a folder, not ZIP files. Snappy reads only the few
 * JSON files it uses from such a folder: no photos, videos or pages are opened. They are wrapped, in memory, into one small
 * ZIP file that holds them uncompressed under json/, and that file is read like a downloaded part, so every command
 * works on a folder as it does on ZIP files. A folder holds no Memories photos or videos, so a rescue has nothing to copy.
 */
import type { FileReader } from "./fs-reader.ts";
import type { Io } from "./io.ts";

type FsIo = Pick<Io, "fs" | "path">;

/** The names Snappy reads (lower case). The usual name of the chat history wins over its alias. */
const DATA_NAMES = ["friends.json", "chat_history.json", "saved_chat_history.json", "snap_history.json", "memories_history.json"];

/** The data files of a folder: under its json/ folder first, else directly in it. A media folder is never searched. */
export async function findDataFiles(io: FsIo, dir: string): Promise<{ path: string; base: string }[]> {
  const top = await io.fs.readDir(dir);
  const jsonDir = top.find((e) => e.isDirectory && e.name.toLowerCase() === "json");
  const inJson = jsonDir ? await io.fs.readDir(io.path.join(dir, jsonDir.name)) : [];
  const pick = (entries: { name: string; isFile: boolean }[], folder: string): { path: string; base: string }[] =>
    DATA_NAMES.flatMap((base) => {
      const found = entries.find((e) => e.isFile && e.name.toLowerCase() === base);
      return found ? [{ path: io.path.join(folder, found.name), base }] : [];
    });
  const first = pick(inJson, jsonDir ? io.path.join(dir, jsonDir.name) : dir);
  const seen = new Set(first.map((f) => f.base));
  return [...first, ...pick(top, dir).filter((f) => !seen.has(f.base))];
}

/** True when the folder holds a json/ folder or any of the data files directly: it looks like an unzipped export. */
export async function looksLikeExportFolder(io: FsIo, dir: string): Promise<boolean> {
  const top = await io.fs.readDir(dir);
  return top.some((e) => (e.isDirectory && e.name.toLowerCase() === "json") || (e.isFile && DATA_NAMES.includes(e.name.toLowerCase())));
}

const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = (CRC_TABLE[(c ^ (bytes[i] as number)) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosOf(ms: number): { date: number; time: number } {
  const d = new Date(Math.min(Math.max(ms, Date.UTC(1980, 0, 1)), Date.UTC(2107, 11, 31)));
  return { date: ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(), time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1) };
}

/** The "extended timestamp" field: the real UTC modified time, which the reader prefers to the DOS time. */
function timestampField(ms: number): Uint8Array {
  const out = new Uint8Array(9);
  const view = new DataView(out.buffer);
  view.setUint16(0, 0x5455, true);
  view.setUint16(2, 5, true);
  out[4] = 1;
  view.setUint32(5, Math.floor(ms / 1000) >>> 0, true);
  return out;
}

const LIMIT = 0xffffffff;

/** One ZIP file (stored, no compression) of the given files under json/. Throws for a file too large for a plain ZIP file. */
export function storedZip(files: readonly { base: string; bytes: Uint8Array; mtimeMs: number }[]): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    if (file.bytes.length > LIMIT || offset > LIMIT) throw new Error("too large");
    const name = encoder.encode(`json/${file.base}`);
    const extra = timestampField(file.mtimeMs);
    const { date, time } = dosOf(file.mtimeMs);
    const crc = crc32(file.bytes);

    const local = new Uint8Array(30 + name.length + extra.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, file.bytes.length, true);
    lv.setUint32(22, file.bytes.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, extra.length, true);
    local.set(name, 30);
    local.set(extra, 30 + name.length);

    const record = new Uint8Array(46 + name.length + extra.length);
    const cv = new DataView(record.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, file.bytes.length, true);
    cv.setUint32(24, file.bytes.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint16(30, extra.length, true);
    cv.setUint32(42, offset, true);
    record.set(name, 46);
    record.set(extra, 46 + name.length);
    central.push(record);

    chunks.push(local, file.bytes);
    offset += local.length + file.bytes.length;
  }
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, central.length, true);
  ev.setUint16(10, central.length, true);
  ev.setUint32(12, central.reduce((n, r) => n + r.length, 0), true);
  ev.setUint32(16, offset, true);

  const all = [...chunks, ...central, end];
  const out = new Uint8Array(all.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of all) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** A reader over the data files of an unzipped export folder, as if they were one ZIP file. */
export async function folderReader(io: FsIo, dir: string): Promise<FileReader> {
  const found = await findDataFiles(io, dir);
  const files = [];
  for (const { path, base } of found) files.push({ base, bytes: await io.fs.readFile(path), mtimeMs: Math.floor((await io.fs.stat(path)).mtimeMs) });
  const zip = storedZip(files);
  return {
    size: zip.length,
    read: async (start, end) => zip.subarray(start, Math.min(end, zip.length)),
    close: async () => undefined,
  };
}
