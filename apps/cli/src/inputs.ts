/**
 * Turning command-line paths into export readers: one or more .zip files, or a folder holding
 * the parts of one export. Zips are read through random-access readers, never loaded whole.
 */
import { mergeParsedExports, parseExportFromReader } from "@snappy-export/core";
import type { ParsedExport } from "@snappy-export/core";
import { CliError, fsError } from "./errors.ts";
import { expandWildcards, isLaterPartsOnly, orderExportParts } from "./export-parts.ts";
import { openFileReader } from "./fs-reader.ts";
import type { FileReader } from "./fs-reader.ts";
import type { Io } from "./io.ts";

type FsIo = Pick<Io, "fs" | "path">;

const isZip = (name: string): boolean => name.toLowerCase().endsWith(".zip");
/** In a folder of parts, skip the "._name.zip" sidecars macOS leaves next to files copied to other drives. */
const isPart = (name: string): boolean => isZip(name) && !name.startsWith("._");
const byName = (a: string, b: string): number => a.localeCompare(b, "en", { numeric: true });

/**
 * Expand wildcards, paths and folders into a de-duplicated list of .zip files in the order
 * Snapchat numbers the parts (base name first, then -2, -3). The order is not cosmetic: a part's
 * position is its number, and a Memories file is found again by that number.
 */
export async function resolveZipPaths(io: FsIo, args: string[]): Promise<string[]> {
  if (args.length === 0) {
    throw new CliError("no-input", "Give Snappy your export: one or more .zip files, or a folder with every part.");
  }
  const found: string[] = [];
  for (const arg of await expandWildcards(io, args)) {
    // An empty argument (an unset shell variable, say) would otherwise mean the current folder.
    if (arg.trim() === "") throw new CliError("no-input", "One of the paths is empty. Check the command and try again.");
    const path = io.path.resolve(arg);
    let info;
    try {
      info = await io.fs.stat(path);
    } catch (e) {
      throw fsError(e, "open", arg);
    }
    if (info.isDirectory) {
      let names: string[];
      try {
        names = (await io.fs.readDir(path)).filter((d) => d.isFile && isPart(d.name)).map((d) => d.name);
      } catch (e) {
        throw fsError(e, "read the folder", arg);
      }
      if (names.length === 0) {
        throw new CliError("no-zips", `No .zip files in "${arg}". Put your export parts there, or name the files.`);
      }
      found.push(...names.sort(byName).map((n) => io.path.join(path, n)));
    } else if (isZip(path)) {
      found.push(path);
    } else {
      throw new CliError("not-zip", `"${arg}" is not a .zip file. Use the .zip you downloaded from Snapchat.`);
    }
  }
  return orderExportParts([...new Set(found)]);
}

/**
 * Later parts alone have no friends, chats or Memories list, so reading them would only report an
 * empty export. Say what to add instead.
 */
export function requireFirstPart(paths: string[]): void {
  if (isLaterPartsOnly(paths)) {
    throw new CliError(
      "later-parts-only",
      "These ZIP files are later parts (names end in -2, -3). Add the first part, which holds the lists, and run again.",
    );
  }
}

/**
 * A stop request ends the command here, before anything is reported. Reads that were cut off look like
 * damaged files to the parser, which turns them into issues; those must never be shown as findings.
 */
export function throwIfStopped(io: Pick<Io, "signal">): void {
  if (io.signal?.aborted === true) throw new CliError("canceled", "Stopped. Nothing was changed.", 130);
}

/** Open every path, run `fn`, and always close the handles. A stop request during `fn` ends in a calm stop, not in its result. */
export async function withReaders<T>(io: Pick<Io, "fs" | "signal">, paths: string[], fn: (readers: FileReader[]) => Promise<T>): Promise<T> {
  const readers: FileReader[] = [];
  try {
    for (const path of paths) readers.push(await openFileReader(io, path));
    const result = await fn(readers);
    throwIfStopped(io);
    return result;
  } finally {
    await Promise.all(readers.map((r) => r.close()));
  }
}

/** Parse the readers as parts of one export, in export order (part 1 first), and merge them. */
export async function parseParts(readers: FileReader[], io: Pick<Io, "signal">): Promise<ParsedExport> {
  const parts: ParsedExport[] = [];
  for (const [i, reader] of readers.entries()) {
    parts.push(await parseExportFromReader(reader, { part: i + 1 }));
    throwIfStopped(io);
  }
  return parts.length === 1 ? (parts[0] as ParsedExport) : mergeParsedExports(parts);
}

/** Newest modification time among the files, a fallback when an export carries no date. */
export async function newestMtime(io: Pick<Io, "fs">, paths: string[]): Promise<number | undefined> {
  let newest: number | undefined;
  for (const path of paths) {
    try {
      const { mtimeMs } = await io.fs.stat(path);
      if (newest === undefined || mtimeMs > newest) newest = Math.floor(mtimeMs);
    } catch {
      // The file was readable a moment ago; a missing date is handled by the caller.
    }
  }
  return newest;
}
