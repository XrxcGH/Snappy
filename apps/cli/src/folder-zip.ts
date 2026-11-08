/**
 * An export that a browser unzipped (Safari does, after a download) is a folder, not ZIP files. Snappy reads only the few
 * JSON files it uses from such a folder: no photos, videos or pages are opened. They are wrapped, in memory, into one small
 * ZIP file that holds them uncompressed under json/, and that file is read like a downloaded part, so every command
 * works on a folder as it does on ZIP files. A folder holds no Memories photos or videos, so a rescue has nothing to copy.
 */
import { crc32 } from "@snappy-export/core";
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

const LIMIT = 0xffffffff;

/**
 * The local header (before a file) or the central directory record (after all of them) of one stored entry. The two
 * share their fields, the central one's sitting two bytes further on. After the name comes the "extended timestamp"
 * field: the real UTC modified time, which the reader prefers to the DOS time (2 s steps, clamped to 1980 to 2107).
 */
function entryHead(central: boolean, name: Uint8Array, mtimeMs: number, crc: number, size: number, offset: number): Uint8Array {
  const s = central ? 2 : 0;
  const at = (central ? 46 : 30) + name.length;
  const out = new Uint8Array(at + 9);
  const v = new DataView(out.buffer);
  const d = new Date(Math.min(Math.max(mtimeMs, Date.UTC(1980, 0, 1)), Date.UTC(2107, 11, 31)));
  v.setUint32(0, central ? 0x02014b50 : 0x04034b50, true);
  v.setUint16(4, 20, true);
  v.setUint16(4 + s, 20, true);
  v.setUint16(10 + s, (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1), true);
  v.setUint16(12 + s, ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(), true);
  v.setUint32(14 + s, crc, true);
  v.setUint32(18 + s, size, true);
  v.setUint32(22 + s, size, true);
  v.setUint16(26 + s, name.length, true);
  v.setUint16(28 + s, 9, true);
  if (central) v.setUint32(42, offset, true);
  out.set(name, at - name.length);
  v.setUint16(at, 0x5455, true);
  v.setUint16(at + 2, 5, true);
  out[at + 4] = 1;
  v.setUint32(at + 5, Math.floor(mtimeMs / 1000) >>> 0, true);
  return out;
}

/** One ZIP file (stored, no compression) of the given files under json/. Throws for a file too large for a plain ZIP file. */
export function storedZip(files: readonly { base: string; bytes: Uint8Array; mtimeMs: number }[]): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const { base, bytes, mtimeMs } of files) {
    if (bytes.length > LIMIT || offset > LIMIT) throw new Error("too large");
    const name = encoder.encode(`json/${base}`);
    const crc = crc32(bytes);
    const local = entryHead(false, name, mtimeMs, crc, bytes.length, 0);
    central.push(entryHead(true, name, mtimeMs, crc, bytes.length, offset));
    chunks.push(local, bytes);
    offset += local.length + bytes.length;
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
