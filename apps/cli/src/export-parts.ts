/**
 * Naming rules for the parts of one export. Snapchat splits a large export into zips named
 * mydata~<digits>.zip, mydata~<digits>-2.zip, mydata~<digits>-3.zip and so on; the first part holds
 * the JSON files. Windows shells do not expand wildcards for programs, so they are expanded here.
 */
import { CliError, fsError } from "./errors.ts";
import type { Io } from "./io.ts";

const hasWildcard = (name: string): boolean => /[*?]/.test(name);

/** The last segment of a path written with either kind of separator. */
const lastSegment = (path: string): string => path.split(/[\\/]/).pop() ?? "";

function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

/**
 * Replace every argument that has a wildcard in its file name ("mydata*.zip") with the .zip files
 * it matches. Other arguments pass through unchanged. A pattern that matches nothing is an error.
 */
export async function expandWildcards(io: Pick<Io, "fs" | "path">, args: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const arg of args) {
    if (!hasWildcard(io.path.basename(arg))) {
      out.push(arg);
      continue;
    }
    const folder = io.path.resolve(io.path.dirname(arg));
    let names: string[];
    try {
      names = (await io.fs.readDir(folder)).filter((d) => d.isFile).map((d) => d.name);
    } catch (e) {
      throw fsError(e, "read the folder", io.path.dirname(arg));
    }
    const pattern = wildcardToRegExp(io.path.basename(arg));
    const matches = names.filter((n) => pattern.test(n) && n.toLowerCase().endsWith(".zip") && !n.startsWith("._"));
    if (matches.length === 0) {
      throw new CliError("no-zips", `No .zip files match "${arg}". Check the folder and name, and put quotes around paths with spaces.`);
    }
    out.push(...matches.map((n) => io.path.join(folder, n)));
  }
  return out;
}

/** "mydata~1.zip" -> base "mydata~1", part 1; "mydata~1-3.zip" and "mydata~1-part-3.zip" -> base "mydata~1", part 3. */
function partOf(path: string): { base: string; part: number } {
  const m = /^(.*?)(?:-part)?-(\d+)\.zip$/i.exec(path);
  return m ? { base: (m[1] as string).toLowerCase(), part: Number(m[2]) } : { base: path.replace(/\.zip$/i, "").toLowerCase(), part: 1 };
}

/**
 * True when every file is a numbered later part of a Snapchat export (mydata~1-2.zip, -3, ...).
 * Those hold photos and videos only; the lists are in the first part. Strict about the name, so a
 * zip named any other way is never refused on a guess.
 */
export function isLaterPartsOnly(paths: string[]): boolean {
  return paths.length > 0 && paths.every((p) => /^mydata~\d+-\d+\.zip$/i.test(lastSegment(p)));
}

/** Order zips the way Snapchat numbers them: the base name first, then -2, -3 and so on. */
export function orderExportParts(paths: string[]): string[] {
  const keyed = paths.map((path) => ({ path, ...partOf(path) }));
  return keyed.sort((a, b) => (a.base < b.base ? -1 : a.base > b.base ? 1 : a.part - b.part)).map((k) => k.path);
}

/** The digits Snapchat puts after "mydata~": the moment the export was requested, the same in every part of one export. */
export function exportId(path: string): string | null {
  return /^mydata~(\d+)/i.exec(lastSegment(path))?.[1] ?? null;
}

/** What one part holds, from its directory listing alone. */
export interface PartScan {
  /** The directory could be read and has entries. */
  listed: boolean;
  /** It holds friends.json: the first part, whatever its name. */
  friends: boolean;
  /** It holds a JSON file, or an HTML page outside memories/ (a later part holds photos and videos and a memories page of its own, no more). */
  pages: boolean;
}

/** What the entry names of a part say it holds. */
export function scanNames(names: readonly string[]): PartScan {
  const lower = names.map((n) => n.toLowerCase());
  const pages = lower.some((n) => n.endsWith(".json") || (n.endsWith(".html") && !n.startsWith("memories/") && !n.includes("/memories/")));
  return { listed: names.length > 0, friends: lower.some((n) => (n.split("/").pop() ?? "") === "friends.json"), pages };
}

export type PartsCheck =
  /** Read these paths, in this order: the part with the lists first. */
  | { kind: "ok"; ordered: string[] }
  /** Only photo and video parts: the lists are in a part that was not chosen. */
  | { kind: "later-only" }
  /** Parts of different exports: the two smallest export numbers, as digits. */
  | { kind: "mixed"; ids: readonly [string, string] };

/**
 * Decide, from the paths and the scans (in the same order), whether these parts are one export, and in what order to read them.
 * Two exports are told apart by the digits in the names (a browser's "(1)" copy of a part keeps its number).
 * A part that could not be listed is judged by its name alone, so that reading it gives the person the real reason it failed.
 */
export function checkParts(paths: readonly string[], scans: readonly PartScan[]): PartsCheck {
  const ids = [...new Set(paths.map(exportId).filter((id): id is string => id !== null))];
  if (ids.length > 1) {
    const sorted = ids.sort((a, b) => (a.length !== b.length ? a.length - b.length : a < b ? -1 : 1));
    return { kind: "mixed", ids: [sorted[0] as string, sorted[1] as string] };
  }

  const mediaOnly = paths.every((p, i) => ((scans[i] as PartScan).listed ? !(scans[i] as PartScan).pages : /^mydata~\d+-\d+\.zip$/i.test(lastSegment(p))));
  if (paths.length > 0 && mediaOnly) return { kind: "later-only" };

  const byName = orderExportParts([...paths]);
  const first = byName.filter((p) => (scans[paths.indexOf(p)] as PartScan).friends);
  const rest = byName.filter((p) => !(scans[paths.indexOf(p)] as PartScan).friends);
  return { kind: "ok", ordered: [...first, ...rest] };
}
