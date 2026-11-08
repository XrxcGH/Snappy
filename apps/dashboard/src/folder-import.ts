/**
 * An export that a browser unzipped (Safari does, after a download) is a folder, not ZIP files. Snappy reads only the
 * few JSON files it uses from such a folder, and nothing else: no photos, videos or pages are opened. Those files are
 * wrapped, without copying, into one small ZIP file that holds them uncompressed under json/, and that file goes
 * through the same reader as a downloaded part: same progress, same checks, same Cancel. The wrapper lives in
 * memory only; the files themselves stay lazy Blobs until a byte range is asked for.
 */

import { Crc32 } from "@snappy-export/core";

/** A file found in a chosen or dropped folder. `path` is relative to the folder, with "/" between names. */
export interface FolderFile {
  path: string;
  blob: Blob;
  /** The file's own modified time in ms. It dates the export, as the time inside a ZIP file does. */
  lastModified?: number;
}

/** The names Snappy reads (lower case). The usual name of the chat history wins over its alias. */
const DATA_NAMES = ["friends.json", "chat_history.json", "saved_chat_history.json", "snap_history.json", "memories_history.json"];

/** Folders that hold only photos, videos and pages. A dropped folder is never walked into them. */
export const MEDIA_FOLDERS = new Set(["chat_media", "memories", "shared_story", "html", "snap_media", "bitmoji"]);

const baseOf = (path: string): string => (path.split("/").pop() ?? "").toLowerCase();
const underJson = (path: string): boolean => path.toLowerCase().split("/").slice(0, -1).includes("json");

/** Files of a folder that look like the unzipped export: any of the JSON data files, wherever they sit. */
export function hasDataFiles(files: readonly FolderFile[]): boolean {
  return files.some((f) => DATA_NAMES.includes(baseOf(f.path)));
}

/**
 * The one file for each data name, as the reader would choose from a ZIP file: under a folder called json first, then the
 * shallowest, then by path. A stray file with the same name deeper down (in a media folder) is left out.
 */
export function pickDataFiles(files: readonly FolderFile[]): FolderFile[] {
  const best = new Map<string, FolderFile>();
  // Sorts as: under json/ first, then the fewer folders deep (depth is padded, so it compares as a number), then the path.
  const rank = (f: FolderFile): string => `${underJson(f.path) ? 0 : 1}${String(f.path.split("/").length).padStart(4, "0")}${f.path}`;
  for (const file of files) {
    const base = baseOf(file.path);
    const current = best.get(base);
    if (DATA_NAMES.includes(base) && (current === undefined || rank(file) < rank(current))) best.set(base, file);
  }
  return DATA_NAMES.flatMap((name) => best.get(name) ?? []);
}

/** The files of a folder chosen with a browser's folder chooser, named by their path inside the chosen folder. */
export function folderFilesFromInput(files: readonly (Blob & { name?: string; webkitRelativePath?: string; lastModified?: number })[]): FolderFile[] {
  return files.map((f) => {
    const full = (f.webkitRelativePath ?? "") !== "" ? (f.webkitRelativePath as string) : (f.name ?? "");
    // The first name is the chosen folder itself.
    const parts = full.split("/");
    return { path: parts.length > 1 ? parts.slice(1).join("/") : full, blob: f, lastModified: f.lastModified };
  });
}

/** The few parts of the File System API the walk below uses, so it can be tried without a browser. */
export interface DirEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?(ok: (file: File) => void, fail: (e: unknown) => void): void;
  createReader?(): { readEntries(ok: (entries: DirEntry[]) => void, fail: (e: unknown) => void): void };
}

const MAX_DEPTH = 3;

/** Walk dropped folders for the data files only: not into the media folders, and not deeper than the export's own layout. */
export async function folderFilesFromEntries(roots: readonly DirEntry[]): Promise<FolderFile[]> {
  const out: FolderFile[] = [];
  const readAll = async (dir: DirEntry): Promise<DirEntry[]> => {
    const reader = dir.createReader?.();
    if (reader === undefined) return [];
    const all: DirEntry[] = [];
    for (;;) {
      // A reader hands out its entries in batches and says it is finished with an empty one.
      const batch = await new Promise<DirEntry[]>((ok, fail) => reader.readEntries(ok, fail));
      if (batch.length === 0) return all;
      all.push(...batch);
    }
  };
  const visit = async (entry: DirEntry, path: string, depth: number): Promise<void> => {
    if (entry.isFile) {
      if (!DATA_NAMES.includes(entry.name.toLowerCase()) || entry.file === undefined) return;
      const file = await new Promise<File>((ok, fail) => (entry.file as NonNullable<DirEntry["file"]>)(ok, fail));
      out.push({ path, blob: file, lastModified: file.lastModified });
      return;
    }
    if (!entry.isDirectory || depth > MAX_DEPTH || MEDIA_FOLDERS.has(entry.name.toLowerCase())) return;
    for (const child of await readAll(entry)) await visit(child, `${path}/${child.name}`, depth + 1);
  };
  for (const root of roots) {
    if (root.isFile) await visit(root, root.name, 0);
    // The folder's own name is not part of the path inside it.
    else for (const child of await readAll(root)) await visit(child, child.name, 1);
  }
  return out;
}

// ----------------------------------------------------------------------------------------------- the wrapper ---

/** CRC-32 of a Blob, read in pieces so the file is never held whole. */
async function crcOf(blob: Blob): Promise<number> {
  const crc = new Crc32();
  const reader = blob.stream().getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return crc.digest();
    crc.update(value);
  }
}

const LIMIT = 0xffffffff;

/**
 * The local header (before a file) or the central directory record (after all of them) of one stored entry, as bytes of a
 * plain ArrayBuffer (what a Blob part must be). The two share their fields, the central one's sitting two bytes further
 * on. After the name comes the "extended timestamp" field: the real UTC modified time, which core prefers to the DOS
 * time (2 s steps in UTC, the same reading core gives them, clamped to 1980 to 2107).
 */
function entryHead(central: boolean, name: Uint8Array, mtimeMs: number, crc: number, size: number, offset: number): Uint8Array<ArrayBuffer> {
  const s = central ? 2 : 0;
  const at = (central ? 46 : 30) + name.length;
  const out = new Uint8Array(new ArrayBuffer(at + 9));
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

/**
 * One ZIP file (stored, no compression) holding the data files under json/. The bytes of the files are not copied: the
 * result is a Blob whose parts are the small headers and the files themselves. Rejects when a file is too large for a
 * plain ZIP file (4 GB), which no real export file is.
 */
export async function wrapAsZip(files: readonly FolderFile[], now: number): Promise<Blob> {
  const encoder = new TextEncoder();
  const parts: BlobPart[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  for (const { path, blob, lastModified } of files) {
    if (blob.size > LIMIT || offset > LIMIT) throw new Error("too large");
    const name = encoder.encode(`json/${baseOf(path)}`);
    const mtime = lastModified !== undefined && lastModified > 0 ? lastModified : now;
    const crc = await crcOf(blob);
    const local = entryHead(false, name, mtime, crc, blob.size, 0);
    central.push(entryHead(true, name, mtime, crc, blob.size, offset));
    parts.push(local, blob);
    offset += local.length + blob.size;
  }
  const end = new Uint8Array(new ArrayBuffer(22));
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, central.length, true);
  ev.setUint16(10, central.length, true);
  ev.setUint32(12, central.reduce((n, r) => n + r.length, 0), true);
  ev.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: "application/zip" });
}
