/**
 * Naming rules for the zip parts of one export. Snapchat names them mydata~<digits>.zip,
 * mydata~<digits>-2.zip, mydata~<digits>-3.zip and so on, and only the first holds the JSON
 * lists. A person can pick all parts at once, in any order, so the order is restored here by name.
 */

export interface NamedPart {
  readonly name?: string;
}

/** "mydata~1.zip" -> base "mydata~1", part 1; "mydata~1-3.zip" -> base "mydata~1", part 3. */
function partOf(name: string): { base: string; part: number } {
  const m = /^(.*?)-(\d+)\.zip$/i.exec(name);
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
 * True when every chosen file is a numbered later part of a Snapchat export (-2, -3, ...). Those
 * hold photos and videos only; the lists live in the first part. Deliberately strict about the
 * name, so a zip with a different name is never refused on a guess.
 */
export function isLaterPartsOnly(files: readonly NamedPart[]): boolean {
  return files.length > 0 && files.every((f) => LATER_PART.test(f.name ?? ""));
}
