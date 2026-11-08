/**
 * An export that a browser unzipped (Safari does, after a download) is a folder, not ZIP files. Snappy reads only the
 * few JSON files it uses from such a folder, and nothing else: no photos, videos or pages are opened. Those files are
 * wrapped, without copying, into one small ZIP file that holds them uncompressed under json/, and that file goes
 * through the same reader as a downloaded part: same progress, same checks, same Cancel. The wrapper lives in
 * memory only; the files themselves stay lazy Blobs until a byte range is asked for.
 */

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
  const rank = (f: FolderFile): [number, number, string] => [underJson(f.path) ? 0 : 1, f.path.split("/").length, f.path];
  const before = (a: FolderFile, b: FolderFile): boolean => {
    const ra = rank(a);
    const rb = rank(b);
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return (ra[i] as number | string) < (rb[i] as number | string);
    return false;
  };
  for (const file of files) {
    const base = baseOf(file.path);
    if (!DATA_NAMES.includes(base)) continue;
    const current = best.get(base);
    if (current === undefined || before(file, current)) best.set(base, file);
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

const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crcUpdate(crc: number, bytes: Uint8Array): number {
  let c = crc;
  for (let i = 0; i < bytes.length; i++) c = (CRC_TABLE[(c ^ (bytes[i] as number)) & 0xff] as number) ^ (c >>> 8);
  return c;
}

/** CRC-32 of a Blob, read in pieces so the file is never held whole. */
async function crcOf(blob: Blob): Promise<number> {
  let crc = 0xffffffff;
  const reader = blob.stream().getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    crc = crcUpdate(crc, value);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** DOS date and time of a moment in UTC (the same reading core gives them), clamped to what the format can hold. */
function dosOf(ms: number): { date: number; time: number } {
  const d = new Date(Math.min(Math.max(ms, Date.UTC(1980, 0, 1)), Date.UTC(2107, 11, 31)));
  return { date: ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(), time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1) };
}

/** A zeroed buffer of a plain ArrayBuffer, which is what a Blob part must be. */
const bytes = (n: number): Uint8Array<ArrayBuffer> => new Uint8Array(new ArrayBuffer(n));

/** The "extended timestamp" field: the real UTC modified time, which core prefers to the DOS time. */
function timestampField(ms: number): Uint8Array<ArrayBuffer> {
  const out = bytes(9);
  const view = new DataView(out.buffer);
  view.setUint16(0, 0x5455, true);
  view.setUint16(2, 5, true);
  out[4] = 1;
  view.setUint32(5, Math.floor(ms / 1000) >>> 0, true);
  return out;
}

const LIMIT = 0xffffffff;

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
  for (const file of files) {
    if (file.blob.size > LIMIT || offset > LIMIT) throw new Error("too large");
    const name = encoder.encode(`json/${baseOf(file.path)}`);
    const mtime = file.lastModified !== undefined && file.lastModified > 0 ? file.lastModified : now;
    const { date, time } = dosOf(mtime);
    const extra = timestampField(mtime);
    const crc = await crcOf(file.blob);

    const local = bytes(30 + name.length + extra.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, file.blob.size, true);
    lv.setUint32(22, file.blob.size, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, extra.length, true);
    local.set(name, 30);
    local.set(extra, 30 + name.length);

    const record = bytes(46 + name.length + extra.length);
    const cv = new DataView(record.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, file.blob.size, true);
    cv.setUint32(24, file.blob.size, true);
    cv.setUint16(28, name.length, true);
    cv.setUint16(30, extra.length, true);
    cv.setUint32(42, offset, true);
    record.set(name, 46);
    record.set(extra, 46 + name.length);
    central.push(record);

    parts.push(local, file.blob);
    offset += local.length + file.blob.size;
  }
  const directorySize = central.reduce((n, r) => n + r.length, 0);
  const end = bytes(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, central.length, true);
  ev.setUint16(10, central.length, true);
  ev.setUint32(12, directorySize, true);
  ev.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: "application/zip" });
}
