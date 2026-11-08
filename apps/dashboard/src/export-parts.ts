/**
 * Rules for the zip parts of one export. Snapchat names them mydata~<digits>.zip,
 * mydata~<digits>-2.zip, mydata~<digits>-3.zip and so on, and only the first holds the JSON
 * lists. A person can pick all parts at once, in any order.
 *
 * What a part is comes from what is inside it (the cheap directory listing: which files it holds),
 * not from its name: a part that holds the lists is the first part, whatever it is called. The name
 * only gives the order of the rest, and the digits after "mydata~" say which export a part belongs to,
 * so parts of two different exports are never merged into one.
 */
import { listZipEntries } from "@snappy-export/core";
import { blobReader } from "./blob-reader.ts";

export interface NamedPart {
  readonly name?: string;
}

/** "mydata~1.zip" -> base "mydata~1", part 1; "mydata~1-3.zip" and "mydata~1-part-3.zip" -> base "mydata~1", part 3. */
function partOf(name: string): { base: string; part: number } {
  const m = /^(.*?)(?:-part)?-(\d+)\.zip$/i.exec(name);
  return m ? { base: (m[1] as string).toLowerCase(), part: Number(m[2]) } : { base: name.replace(/\.zip$/i, "").toLowerCase(), part: 1 };
}

/** Base name first, then -2, -3 and so on. Other names keep a stable alphabetical order. Returns a new list. */
export function orderParts<T extends NamedPart>(files: readonly T[]): T[] {
  return files
    .map((file, index) => ({ file, index, ...partOf(file.name ?? "") }))
    .sort((a, b) => (a.base < b.base ? -1 : a.base > b.base ? 1 : a.part - b.part || a.index - b.index))
    .map((k) => k.file);
}

const LATER_PART = /^mydata~\d+-\d+\.zip$/i;

/**
 * True when every chosen file is named like a numbered later part of a Snapchat export (-2, -3, ...).
 * Used only for a file whose contents could not be listed; a readable part is judged by what it holds
 * (see checkParts). Deliberately strict about the name, so a zip with a different name is never refused on a guess.
 */
export function isLaterPartsOnly(files: readonly NamedPart[]): boolean {
  return files.length > 0 && files.every((f) => LATER_PART.test(f.name ?? ""));
}

/** The digits Snapchat puts after "mydata~": the moment the export was requested, the same in every part of one export. */
export function exportId(name: string | undefined): string | null {
  return /^mydata~(\d+)/i.exec(name ?? "")?.[1] ?? null;
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

const baseOf = (path: string): string => (path.split("/").pop() ?? "").toLowerCase();

/** Look at the directory of one part. Nothing inside is read; a damaged or unreadable part comes back as not listed. */
export async function scanPart(blob: Blob): Promise<PartScan> {
  const { entries } = await listZipEntries(blobReader(blob));
  const lower = entries.map((e) => e.name.toLowerCase());
  const pages = lower.some((n) => n.endsWith(".json") || (n.endsWith(".html") && !n.startsWith("memories/") && !n.includes("/memories/")));
  return { listed: entries.length > 0, friends: lower.some((n) => baseOf(n) === "friends.json"), pages };
}

export type PartsCheck<T> =
  /** Read these, in this order: the part with the lists first. */
  | { kind: "ok"; ordered: T[] }
  /** Only photo and video parts: the lists are in a part that was not chosen. */
  | { kind: "later-only" }
  /** Parts of different exports: the two smallest export numbers, as digits. */
  | { kind: "mixed"; ids: readonly [string, string] };

/**
 * Decide, from the names and the scans (in the same order as `files`), whether these parts can be read as one export.
 * Two exports are told apart by the digits in the names (a browser's "(1)" copy of a part keeps its number).
 * Parts that are only photos and videos are refused when nothing chosen holds the lists. A part that could not be listed is
 * judged by its name alone, so that reading it gives the person the real reason it failed.
 */
export function checkParts<T extends NamedPart>(files: readonly T[], scans: readonly PartScan[]): PartsCheck<T> {
  const ids = [...new Set(files.map((f) => exportId(f.name)).filter((id): id is string => id !== null))];
  if (ids.length > 1) {
    const sorted = ids.sort((a, b) => (a.length !== b.length ? a.length - b.length : a < b ? -1 : 1));
    return { kind: "mixed", ids: [sorted[0] as string, sorted[1] as string] };
  }

  const withScan = files.map((file, i) => ({ name: file.name, file, scan: scans[i] as PartScan }));
  const mediaOnly = withScan.every(({ file, scan }) => (scan.listed ? !scan.pages : LATER_PART.test(file.name ?? "")));
  if (withScan.length > 0 && mediaOnly) return { kind: "later-only" };

  const byName = orderParts(withScan);
  const first = byName.filter((p) => p.scan.friends);
  const rest = byName.filter((p) => !p.scan.friends);
  return { kind: "ok", ordered: [...first, ...rest].map((p) => p.file) };
}

/** A chosen or dropped thing, with what a browser says about a folder. */
export interface ChosenFile extends NamedPart {
  /** Set by a browser's folder chooser: the path inside the chosen folder. */
  readonly webkitRelativePath?: string;
}

/**
 * True when nothing chosen is a ZIP file and what was chosen looks like an export that was unzipped (Safari does that after a
 * download): a folder, files from inside a folder, JSON files, or a folder named like an export. `folder` is set by the drop
 * zone when a dropped item was a directory.
 */
export function looksUnzipped(files: readonly ChosenFile[], options: { folder?: boolean } = {}): boolean {
  if (options.folder === true) return true;
  return files.some((f) => {
    const name = f.name ?? "";
    return (f.webkitRelativePath ?? "") !== "" || /\.json$/i.test(name) || /^mydata~\d+$/i.test(name);
  });
}
