/**
 * Turning command-line paths into export readers: one or more .zip files, or a folder holding
 * the parts of one export. Zips are read through random-access readers, never loaded whole.
 */
import { listZipEntries, mergeParsedExports, parseExportFromReader } from "@snappy-export/core";
import type { ParsedExport } from "@snappy-export/core";
import { CliError, fsError } from "./errors.ts";
import { checkParts, expandWildcards, isLaterPartsOnly, orderExportParts, scanNames } from "./export-parts.ts";
import type { PartScan } from "./export-parts.ts";
import { findDataFiles, folderReader } from "./folder-zip.ts";
import { openFileReader } from "./fs-reader.ts";
import type { FileReader } from "./fs-reader.ts";
import type { Io } from "./io.ts";

type FsIo = Pick<Io, "fs" | "path">;

const isZip = (name: string): boolean => name.toLowerCase().endsWith(".zip");
const isJson = (name: string): boolean => name.toLowerCase().endsWith(".json");
/** A single JSON file is a piece of an export that was unzipped (Safari does that after a download). */
const UNZIPPED = "This is a file from an unzipped export. Point Snappy at the whole export folder, or at the ZIP files.";
/** Readers made from a folder, so the notes that only apply to a folder can be added. */
const folderReaders = new WeakSet<object>();

async function isFolder(io: Pick<Io, "fs">, path: string): Promise<boolean> {
  try {
    return (await io.fs.stat(path)).isDirectory;
  } catch {
    return false;
  }
}
/** In a folder of parts, skip the "._name.zip" sidecars macOS leaves next to files copied to other drives. */
const isPart = (name: string): boolean => isZip(name) && !name.startsWith("._");
const byName = (a: string, b: string): number => a.localeCompare(b, "en", { numeric: true });

/** Look at the directory of one zip. Nothing inside is read; a file that cannot be opened or listed comes back as not listed. */
async function scanPath(io: FsIo, path: string): Promise<PartScan> {
  let reader: FileReader | undefined;
  try {
    reader = await io.fs.openRead(path);
    return scanNames((await listZipEntries(reader)).entries.map((e) => e.name));
  } catch {
    return scanNames([]);
  } finally {
    await reader?.close().catch(() => undefined);
  }
}

/** Paths whose directory shows photos and videos only (or, unreadable, whose name says so). Set by resolveZipPaths, read by requireFirstPart. */
const mediaParts = new Map<string, boolean>();

/**
 * Expand wildcards, paths and folders into a de-duplicated list of .zip files in the order
 * Snapchat numbers the parts: the part that holds the lists first, then -2, -3. The order is not
 * cosmetic: a part's position is its number, and a Memories file is found again by that number.
 * What a part is comes from its directory, not its name. Parts of two different exports are refused.
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
      let entries;
      try {
        entries = await io.fs.readDir(path);
      } catch (e) {
        throw fsError(e, "read the folder", arg);
      }
      const names = entries.filter((d) => d.isFile && isPart(d.name)).map((d) => d.name);
      if (names.length === 0) {
        // A browser that unzips downloads (Safari does) leaves a folder with json/ inside, not the ZIP files: read that folder.
        if ((await findDataFiles(io, path)).length > 0) {
          found.push(path);
          continue;
        }
        throw new CliError("no-zips", `No .zip files in "${arg}". Put your export parts there, or name the files.`);
      }
      found.push(...names.sort(byName).map((n) => io.path.join(path, n)));
    } else if (isZip(path)) {
      found.push(path);
    } else if (isJson(path)) {
      throw new CliError("unzipped-export", UNZIPPED);
    } else {
      throw new CliError("not-zip", `"${arg}" is not a .zip file. Use the .zip you downloaded from Snapchat.`);
    }
  }
  const unique = [...new Set(found)];
  // A folder is a whole export on its own: read together with ZIP files it would be a second copy of the lists.
  if (unique.length > 1 && (await Promise.all(unique.map((path) => isFolder(io, path)))).some(Boolean)) {
    throw new CliError("mixed-inputs", "Give Snappy either the ZIP files or the unzipped folder, not both.");
  }
  const scans = await Promise.all(unique.map((path) => scanPath(io, path)));
  const check = checkParts(unique, scans);
  if (check.kind === "mixed") {
    throw new CliError("mixed-exports", `These ZIP files come from two different exports, ${check.ids[0]} and ${check.ids[1]}. Choose the parts of one export.`);
  }
  unique.forEach((path, i) => mediaParts.set(path, scans[i]?.listed === true ? scans[i]?.pages !== true : isLaterPartsOnly([path])));
  return check.kind === "ok" ? check.ordered : orderExportParts(unique);
}

/**
 * Later parts alone have no friends, chats or Memories list, so reading them would only report an
 * empty export. Say what to add instead.
 */
export function requireFirstPart(paths: string[]): void {
  // Judged by what each part holds when the paths came from resolveZipPaths, by name when they did not.
  const known = paths.length > 0 && paths.every((p) => mediaParts.has(p));
  if (known ? paths.every((p) => mediaParts.get(p) === true) : isLaterPartsOnly(paths)) {
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
export async function withReaders<T>(io: Pick<Io, "fs" | "path" | "signal">, paths: string[], fn: (readers: FileReader[]) => Promise<T>): Promise<T> {
  const readers: FileReader[] = [];
  try {
    for (const path of paths) {
      // A folder is an unzipped export: its few JSON files are read as if they were one ZIP file.
      if (await isFolder(io, path)) {
        const reader = await folderReader(io, path).catch((e: unknown) => {
          throw fsError(e, "read the folder", path);
        });
        folderReaders.add(reader);
        readers.push(reader);
      } else readers.push(await openFileReader(io, path));
    }
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
  const merged = parts.length === 1 ? (parts[0] as ParsedExport) : mergeParsedExports(parts);
  // A folder holds no photos or videos, and a rescue needs them: say so next to the Memories notes.
  return readers.some((r) => folderReaders.has(r))
    ? { ...merged, issues: [...merged.issues, { severity: "info", code: "folder-no-media", message: "This export was read from an unzipped folder, so it has no photos or videos. To rescue Memories, use the ZIP files." }] }
    : merged;
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
