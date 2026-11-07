/**
 * Naming rules for the parts of one export. Snapchat splits a large export into zips named
 * mydata~<digits>.zip, mydata~<digits>-2.zip, mydata~<digits>-3.zip and so on; the first part holds
 * the JSON files. Windows shells do not expand wildcards for programs, so they are expanded here.
 */
import { readdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { CliError, fsError } from "./errors.ts";

const hasWildcard = (name: string): boolean => /[*?]/.test(name);

function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

/**
 * Replace every argument that has a wildcard in its file name ("mydata*.zip") with the .zip files
 * it matches. Other arguments pass through unchanged. A pattern that matches nothing is an error.
 */
export async function expandWildcards(args: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const arg of args) {
    if (!hasWildcard(basename(arg))) {
      out.push(arg);
      continue;
    }
    const folder = resolve(dirname(arg));
    let names: string[];
    try {
      names = (await readdir(folder, { withFileTypes: true })).filter((d) => d.isFile()).map((d) => d.name);
    } catch (e) {
      throw fsError(e, "read the folder", dirname(arg));
    }
    const pattern = wildcardToRegExp(basename(arg));
    const matches = names.filter((n) => pattern.test(n) && n.toLowerCase().endsWith(".zip") && !n.startsWith("._"));
    if (matches.length === 0) {
      throw new CliError("no-zips", `No .zip files match "${arg}". Check the folder and the name, and put quotes around a path that contains spaces.`);
    }
    out.push(...matches.map((n) => join(folder, n)));
  }
  return out;
}

/** "mydata~1.zip" -> base "mydata~1", part 1; "mydata~1-3.zip" -> base "mydata~1", part 3. */
function partOf(path: string): { base: string; part: number } {
  const m = /^(.*?)-(\d+)\.zip$/i.exec(path);
  return m ? { base: (m[1] as string).toLowerCase(), part: Number(m[2]) } : { base: path.replace(/\.zip$/i, "").toLowerCase(), part: 1 };
}

/**
 * True when every file is a numbered later part of a Snapchat export (mydata~1-2.zip, -3, ...).
 * Those hold photos and videos only; the lists are in the first part. Strict about the name, so a
 * zip named any other way is never refused on a guess.
 */
export function isLaterPartsOnly(paths: string[]): boolean {
  return paths.length > 0 && paths.every((p) => /^mydata~\d+-\d+\.zip$/i.test(basename(p)));
}

/** Order zips the way Snapchat numbers them: the base name first, then -2, -3 and so on. */
export function orderExportParts(paths: string[]): string[] {
  const keyed = paths.map((path) => ({ path, ...partOf(path) }));
  return keyed.sort((a, b) => (a.base < b.base ? -1 : a.base > b.base ? 1 : a.part - b.part)).map((k) => k.path);
}
