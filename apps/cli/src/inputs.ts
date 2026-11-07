/**
 * Turning command-line paths into export readers: one or more .zip files, or a folder holding
 * the parts of one export. Zips are read through random-access readers, never loaded whole.
 */
import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { mergeParsedExports, parseExportFromReader } from "@snappy-export/core";
import type { ParsedExport } from "@snappy-export/core";
import { CliError, fsError } from "./errors.ts";
import { expandWildcards, isLaterPartsOnly, orderExportParts } from "./export-parts.ts";
import { openFileReader } from "./fs-reader.ts";
import type { FileReader } from "./fs-reader.ts";

const isZip = (name: string): boolean => name.toLowerCase().endsWith(".zip");
/** In a folder of parts, skip the "._name.zip" sidecars macOS leaves next to files copied to other drives. */
const isPart = (name: string): boolean => isZip(name) && !name.startsWith("._");
const byName = (a: string, b: string): number => a.localeCompare(b, "en", { numeric: true });

/**
 * Expand wildcards, paths and folders into a de-duplicated list of .zip files in the order
 * Snapchat numbers the parts (base name first, then -2, -3). The order is not cosmetic: a part's
 * position is its number, and a Memories file is found again by that number.
 */
export async function resolveZipPaths(args: string[]): Promise<string[]> {
  if (args.length === 0) {
    throw new CliError("no-input", "Snappy needs your export. Give it one or more .zip files, or a folder that holds the parts.");
  }
  const found: string[] = [];
  for (const arg of await expandWildcards(args)) {
    // An empty argument (an unset shell variable, say) would otherwise mean the current folder.
    if (arg.trim() === "") throw new CliError("no-input", "One of the paths is empty. Check the command and try again.");
    const path = resolve(arg);
    let info;
    try {
      info = await stat(path);
    } catch (e) {
      throw fsError(e, "open", arg);
    }
    if (info.isDirectory()) {
      let names: string[];
      try {
        names = (await readdir(path, { withFileTypes: true })).filter((d) => d.isFile() && isPart(d.name)).map((d) => d.name);
      } catch (e) {
        throw fsError(e, "read the folder", arg);
      }
      if (names.length === 0) {
        throw new CliError("no-zips", `There are no .zip files in "${arg}". Put the parts of your export there, or name the files directly.`);
      }
      found.push(...names.sort(byName).map((n) => join(path, n)));
    } else if (isZip(path)) {
      found.push(path);
    } else {
      throw new CliError("not-zip", `"${arg}" is not a .zip file. Snappy reads the .zip you downloaded from Snapchat.`);
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
      "These zips are later parts of an export (their names end in -2, -3 and so on). The lists Snappy reads are in the first part, the one with no number at the end of its name. Add it and run again.",
    );
  }
}

/** Open every path, run `fn`, and always close the handles. */
export async function withReaders<T>(paths: string[], fn: (readers: FileReader[]) => Promise<T>): Promise<T> {
  const readers: FileReader[] = [];
  try {
    for (const path of paths) readers.push(await openFileReader(path));
    return await fn(readers);
  } finally {
    await Promise.all(readers.map((r) => r.close()));
  }
}

/** Parse the readers as parts of one export, in export order (part 1 first), and merge them. */
export async function parseParts(readers: FileReader[]): Promise<ParsedExport> {
  const parts: ParsedExport[] = [];
  for (const [i, reader] of readers.entries()) parts.push(await parseExportFromReader(reader, { part: i + 1 }));
  return parts.length === 1 ? (parts[0] as ParsedExport) : mergeParsedExports(parts);
}

/** Newest modification time among the files, a fallback when an export carries no date. */
export async function newestMtime(paths: string[]): Promise<number | undefined> {
  let newest: number | undefined;
  for (const path of paths) {
    try {
      const { mtimeMs } = await stat(path);
      if (newest === undefined || mtimeMs > newest) newest = Math.floor(mtimeMs);
    } catch {
      // The file was readable a moment ago; a missing date is handled by the caller.
    }
  }
  return newest;
}
