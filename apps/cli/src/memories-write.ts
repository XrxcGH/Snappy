/**
 * Writing one rescued Memory to disk: path safety, capture-date embedding, file time.
 * Media is opaque. The only things touched are the file's header structure (by core's
 * embedJpegDate and patchMp4Dates, chosen by sniffing magic bytes, never by extension) and the
 * file's modification time. An overlay file is not even that: its bytes are written as stored.
 */
import { mkdir, readFile, rename, stat, unlink, utimes } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { embedJpegDate, patchMp4Dates, sniffMediaType } from "@snappy-export/core";
import { atomicWrite } from "./ledger-store.ts";

/** Files bigger than this keep their bytes untouched (the date goes into the file time only). */
const MAX_PATCH_BYTES = 512 * 1024 * 1024;

/**
 * Resolve a planned relative path inside the output folder. Core builds these paths from dates
 * and ordinals, but the check is cheap and the cost of a traversal is high, so it is verified here.
 */
export function targetInside(outDir: string, relativePath: string): string | undefined {
  if (relativePath === "" || relativePath.includes("\0")) return undefined;
  const root = resolve(outDir);
  const target = resolve(root, ...relativePath.split("/"));
  const rel = relative(root, target);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return undefined;
  return target;
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Where the bytes come from: already in memory, or a completed ".part" file. */
export type MediaSource = { bytes: Uint8Array } | { partPath: string };

export type DateStatus = "embedded" | "file-time-only" | "none";

/** The bytes to write, or the finished download to move into place untouched. */
async function load(source: MediaSource, dateMs: number | null): Promise<Uint8Array | { moveFrom: string }> {
  if ("bytes" in source) return source.bytes;
  // Too large to patch in memory, or no date to write: the download is simply renamed.
  if (dateMs === null || (await stat(source.partPath)).size > MAX_PATCH_BYTES) return { moveFrom: source.partPath };
  return readFile(source.partPath);
}

/**
 * Put a Memory at `target`. With a capture date, JPEG and MP4 headers get the date and every
 * file gets it as its modification time; other types are copied byte for byte.
 */
export async function placeMedia(target: string, source: MediaSource, dateMs: number | null): Promise<DateStatus> {
  try {
    return await place(target, source, dateMs);
  } catch (e) {
    // A finished download that could not be put in place would otherwise stay behind, whole.
    if ("partPath" in source) await unlink(source.partPath).catch(() => undefined);
    throw e;
  }
}

/**
 * Where a Memory's overlay goes: next to the main file, with "-overlay" (then "-overlay-2", ...)
 * before the extension. The extension is the stored one when it is a plain token, so no other
 * text from the export reaches a file name.
 */
export function overlayTarget(mainTarget: string, ordinal: number, storedName: string): string {
  const ext = /\.([a-z0-9]{1,5})$/i.exec(storedName)?.[1]?.toLowerCase() ?? "png";
  const dot = mainTarget.lastIndexOf(".");
  const stem = dot > mainTarget.lastIndexOf("/") && dot > mainTarget.lastIndexOf("\\") ? mainTarget.slice(0, dot) : mainTarget;
  return `${stem}-overlay${ordinal > 1 ? `-${ordinal}` : ""}.${ext}`;
}

/** The capture time as the file's modification time. Best effort: a file system that rejects it still holds the right bytes. */
async function setFileTime(target: string, dateMs: number | null): Promise<void> {
  if (dateMs === null) return;
  const when = new Date(dateMs);
  await utimes(target, when, when).catch(() => undefined);
}

/**
 * Make an existing file's modification time the capture time again (a run that stopped, or a
 * file system that refused it once, leaves the wrong one). True when it had to be changed and now
 * is right; a second of difference is tolerated, since some file systems store only even seconds.
 */
export async function fixFileTime(target: string, dateMs: number | null): Promise<boolean> {
  if (dateMs === null) return false;
  const off = async (): Promise<boolean> => Math.abs((await stat(target)).mtimeMs - dateMs) > 2000;
  if (!(await off())) return false;
  await setFileTime(target, dateMs);
  return !(await off());
}

/** Put an overlay at `target`: the bytes exactly as stored, with the capture time as file time. */
export async function placeOverlay(target: string, bytes: Uint8Array, dateMs: number | null): Promise<void> {
  await atomicWrite(target, bytes, { sync: false });
  await setFileTime(target, dateMs);
}

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && Buffer.compare(a, b) === 0;

async function place(target: string, source: MediaSource, dateMs: number | null): Promise<DateStatus> {
  await mkdir(dirname(target), { recursive: true });

  let status: DateStatus = dateMs === null ? "none" : "file-time-only";
  const loaded = await load(source, dateMs);
  if (loaded instanceof Uint8Array) {
    let out = loaded;
    if (dateMs !== null) {
      const type = sniffMediaType(loaded);
      if (type === "jpeg") out = embedJpegDate(loaded, dateMs);
      else if (type === "mp4") out = patchMp4Dates(loaded, dateMs);
      // Core hands back an unchanged copy for a header it cannot use or a date out of range: say so.
      if (!sameBytes(out, loaded)) status = "embedded";
    }
    await atomicWrite(target, out, { sync: false });
    if ("partPath" in source) await unlink(source.partPath).catch(() => undefined);
  } else {
    await rename(loaded.moveFrom, target);
  }

  await setFileTime(target, dateMs);
  return status;
}
