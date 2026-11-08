/**
 * Export parsing entry point (ALLOWLIST projection; content-blind).
 *
 * What gets opened, and what never does:
 *  - Only friends.json, chat_history.json, snap_history.json and memories_history.json are ever
 *    decompressed or decoded. Every other entry (other JSON, HTML, media) is
 *    listed by name and size only; from a zip, its bytes are never inflated. The Memories media
 *    files are listed too, with their sizes and stored times (all that pairing them needs).
 *  - Each parser projects through an allowlist, so unlisted fields (message text,
 *    display names, locations, group titles) are dropped at the boundary.
 *  - Issues carry codes, fixed file labels and counts, never data values.
 */
import { unzipSync } from "fflate";
import { classifyMemoryMedia } from "../memories/pair.ts";
import type { ChatEvent, ExportIssue, MemoriesPairing, MemoryItem, ParsedExport, ParsedFriends } from "../types.ts";
import { parseChatHistoryJson, parseSnapHistoryJson } from "./chats.ts";
import { KNOWN_DIRS, KNOWN_STEMS, MEDIA_EXTENSIONS } from "./layout.ts";
import { emptyFriends, parseFriendsJson } from "./friends.ts";
import { issue, parseJsonBytes } from "./json-util.ts";
import { attachBundledMedia, parseMemoriesJson, sortBundledMedia } from "./memories.ts";
import { readZipDirectory } from "./zip.ts";

export { parseFriendsJson, parseChatHistoryJson, parseSnapHistoryJson, parseMemoriesJson };
export { validateExport, failureClass, visibleIssues } from "./validate.ts";
export type { FailureClass } from "./validate.ts";

/** Entry-count cap: real exports hold tens of thousands of media files, not millions. */
export const MAX_ENTRIES = 500_000;
/**
 * Zip-bomb guards. Both stay well under V8's maximum string length (about 512M characters):
 * a file that big would be fully inflated first and only then fail to decode.
 * Per-file cap: the largest single JSON file we will inflate.
 */
export const MAX_JSON_FILE_BYTES = 256 * 1024 * 1024;
/** Total declared size of the JSON we are willing to inflate across the (at most four) files. */
const MAX_JSON_BYTES = 512 * 1024 * 1024;
/**
 * A file that is streamed (see STREAMED_TARGETS) is never held whole, so the limits above do not
 * apply to it; this only bounds what one entry may declare.
 */
const MAX_STREAMED_JSON_BYTES = 16 * 1024 ** 3;
const MAX_FILE_LIST = 500;

export const TARGET_NAMES = {
  friends: "friends.json",
  chats: "chat_history.json",
  snaps: "snap_history.json",
  memories: "memories_history.json",
} as const;
/** @internal */
export type Target = keyof typeof TARGET_NAMES;

/** Other file names that hold the same data as a target (lower case). The name in TARGET_NAMES wins when both exist. */
const TARGET_ALIASES: { readonly [K in Target]?: readonly string[] } = {
  chats: ["saved_chat_history.json"],
};

/** Every lower-case file name a target is read from, its own first. */
const namesOf = (target: Target): readonly string[] => [TARGET_NAMES[target], ...(TARGET_ALIASES[target] ?? [])];

/**
 * The files a reader front end streams instead of parsing in memory: all four. The two histories
 * are by far the biggest and hold the message text; the friends and Memories lists hold display
 * names and locations. Streamed, none of those values is ever decoded: only the allowlisted
 * fields are.
 * @internal
 */
export const STREAMED_TARGETS: ReadonlySet<Target> = new Set<Target>(["chats", "snaps", "friends", "memories"]);

/** @internal Shared with zip-reader.ts; not part of the package API. */
export interface Entry {
  /** Name exactly as stored (used to select the entry for inflation). */
  name: string;
  /** Forward-slash path without leading "./" or "/". */
  path: string;
  size: number;
  /** Stored UTC modification time (epoch ms), when the archive has one. */
  mtimeUtcMs?: number;
  /** Stored DOS modification time read as UTC wall-clock numbers, when it is a real date. */
  mtimeDosMs?: number;
}

/** @internal */
export function normPath(name: string): string {
  return name.replace(/\\/g, "/").replace(/^(?:\.?\/)+/, "");
}

/** @internal */
export const baseName = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

function isJunk(path: string): boolean {
  // Archivers add resource-fork shadows that are not part of the export.
  return path === "" || path.endsWith("/") || path.startsWith("__MACOSX/") || baseName(path).startsWith("._");
}

function isMedia(path: string): boolean {
  const ext = /\.([a-z0-9]{2,5})$/i.exec(path)?.[1]?.toLowerCase();
  return ext !== undefined && MEDIA_EXTENSIONS.has(ext);
}

/** True when a path runs through a folder named "json": where Snapchat puts the data files. */
const underJsonFolder = (path: string): boolean => path.split("/").slice(0, -1).some((d) => d.toLowerCase() === "json");

/**
 * A file under a "json" folder wins, then the shallowest, then the alphabetically first, so a stray
 * copy of a data file name elsewhere (in the chat media, say) never shadows the real file.
 */
function pickTargets(entries: Entry[]): Map<Target, Entry> {
  const chosen = new Map<Target, Entry>();
  // An alias (saved_chat_history.json) is read only when the usual name is not there at all.
  const rank = (e: Entry, target: Target): [number, number, number, string] => [
    baseName(e.path).toLowerCase() === TARGET_NAMES[target] ? 0 : 1,
    underJsonFolder(e.path) ? 0 : 1,
    e.path.split("/").length,
    e.path,
  ];
  const before = (a: Entry, b: Entry, target: Target): boolean => {
    const ra = rank(a, target);
    const rb = rank(b, target);
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return (ra[i] as number | string) < (rb[i] as number | string);
    return false;
  };
  for (const e of entries) {
    const base = baseName(e.path).toLowerCase();
    for (const target of Object.keys(TARGET_NAMES) as Target[]) {
      if (!namesOf(target).includes(base)) continue;
      const cur = chosen.get(target);
      if (!cur || before(e, cur, target)) chosen.set(target, e);
    }
  }
  return chosen;
}

/**
 * ParsedExport.fileList must hold SYSTEM file names only: a directory or file name can carry
 * a username, a group title or other personal text (e.g. per-conversation HTML pages). Only
 * names of the known export layout are kept; anything else is replaced by a placeholder
 * that keeps the (alphanumeric) extension of json/html files, which validateExport needs.
 */
function maskFileList(paths: string[]): string[] {
  let n = 0;
  return paths.map((path) => {
    const parts = path.split("/");
    const base = parts.pop() ?? "";
    const dirs = parts.map((d) => (KNOWN_DIRS.has(d.toLowerCase()) ? d.toLowerCase() : "<dir>"));
    const dot = base.lastIndexOf(".");
    const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
    const stem = dot > 0 ? base.slice(0, dot).toLowerCase() : base.toLowerCase();
    const known = /^(.*?)(?:[_-]\d{1,3})?$/.exec(stem)?.[1];
    const okExt = ext === "json" || ext === "html" || ext === "htm";
    if (okExt && known !== undefined && KNOWN_STEMS.has(known)) return [...dirs, `${stem}.${ext}`].join("/");
    n += 1;
    return [...dirs, okExt ? `<file-${n}>.${ext}` : `<file-${n}>`].join("/");
  });
}

/**
 * Cut a masked file list to `max` entries without losing what validateExport reads from it
 * (is there any JSON? any HTML? a chat_history.json / memories_history.json?). Cutting by zip
 * position would drop json/ files that sort after hundreds of html/ pages and trigger a false
 * "html-only export" error, so known data files come first, then other JSON, then HTML, then the
 * rest; each group keeps its zip order.
 */
function truncateFileList(list: string[], max: number): string[] {
  const rank = (name: string): number => {
    const base = name.slice(name.lastIndexOf("/") + 1).toLowerCase();
    const isPlaceholder = base.startsWith("<file-");
    if (base.endsWith(".json")) return isPlaceholder ? 1 : 0;
    if (base.endsWith(".html") || base.endsWith(".htm")) return 2;
    return 3;
  };
  return list
    .map((name, i) => ({ name, i, r: rank(name) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .slice(0, max)
    .map((x) => x.name);
}

/**
 * Apply the MAX_FILE_LIST cap, adding the info issue when something was cut. Shared with
 * mergeParsedExports, whose union of several parts can exceed the cap again.
 * @internal
 */
export function capFileList(list: string[], issues: ExportIssue[]): string[] {
  if (list.length <= MAX_FILE_LIST) return list;
  // Only the inspect report can use this one; the person has nothing to do about it.
  issues.push({ ...issue("info", "file-list-truncated", `The file list was cut to ${MAX_FILE_LIST} of ${list.length} entries.`), hidden: true });
  return truncateFileList(list, MAX_FILE_LIST);
}

/**
 * The note that media files were listed but not opened, for the counts of one or more ZIP parts
 * (by part number). One note holds the total, however many parts there are.
 * @internal
 */
export function mediaNotOpenedIssue(partCounts: Record<number, number>): ExportIssue {
  const total = Object.values(partCounts).reduce((n, c) => n + c, 0);
  return {
    ...issue("info", "media-not-opened", `Snappy listed ${total} media ${total === 1 ? "file" : "files"} by name and size only. It did not open ${total === 1 ? "it" : "them"}.`),
    partCounts: { ...partCounts },
  };
}

/**
 * Replace every media-not-opened note in `issues` by one that adds the parts up (a part that is
 * seen twice counts once). The note keeps the place of the first one. @internal
 */
export function combineMediaNotOpened(issues: ExportIssue[]): ExportIssue[] {
  const counts: Record<number, number> = {};
  let first = -1;
  issues.forEach((i, at) => {
    if (i.code !== "media-not-opened") return;
    if (first < 0) first = at;
    for (const [part, n] of Object.entries(i.partCounts ?? {})) counts[Number(part)] = Math.max(counts[Number(part)] ?? 0, n);
  });
  if (first < 0) return issues;
  return issues.flatMap((i, at) => (i.code !== "media-not-opened" ? [i] : at === first ? [mediaNotOpenedIssue(counts)] : []));
}

/**
 * With no photos or videos in the ZIP files at all, "no file or link" is not a sign that part of the
 * export is missing: the export holds the list and nothing else (the minimal request in the guide).
 * That is a note about what the export holds, not a warning.
 */
function listOnlyNote(i: ExportIssue): ExportIssue {
  return i.code === "memories-no-media-source"
    ? issue("info", "memories-list-only", "These ZIP files hold the Memories list but no photos or videos. Add other parts, or choose Export your Memories.")
    : i;
}

/** @internal */
export function emptyParsed(issues: ExportIssue[]): ParsedExport {
  return { friends: emptyFriends(), chats: [], memories: [], fileList: [], issues };
}

// Fixed-text issues shared by every zip front end, so all of them report a bad archive identically.
/**
 * Which ZIP file a notice is about: the person's own file name for it (the caller knows it, core
 * does not) and its 1-based position among the parts of the export. Both are optional; without a
 * name the notices keep their generic wording.
 */
export interface PartLabel {
  name?: string;
  part?: number;
}

const MAX_SHOWN_NAME = 80;

/** Control, escape, zero-width and direction-changing code points: never repeated in a notice. */
const hiddenChar = (c: number): boolean =>
  c <= 0x1f || (c >= 0x7f && c <= 0x9f) || c === 0x61c || (c >= 0x200b && c <= 0x200f) || (c >= 0x2028 && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069) || c === 0xfeff;

/**
 * A file name that is safe to repeat in a notice: the last path segment, without control,
 * escape or direction-changing characters, cut to a sensible length. Undefined when nothing
 * readable is left. It is the person's own file name, never a value from inside the export.
 */
export function shownFileName(name: string | undefined): string | undefined {
  if (name === undefined) return undefined;
  const base = name.slice(Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\")) + 1);
  const clean = [...base].filter((ch) => !hiddenChar(ch.codePointAt(0) as number)).join("").trim();
  if (clean === "") return undefined;
  return clean.length > MAX_SHOWN_NAME ? `${clean.slice(0, MAX_SHOWN_NAME - 1)}…` : clean;
}

/** @internal */
export function zipUnreadableIssue(label: PartLabel = {}): ExportIssue {
  const name = shownFileName(label.name);
  if (name === undefined) return issue("error", "zip-unreadable", "Snappy could not read this file as a ZIP file.");
  // Part 1 holds the lists; the later parts hold photos and videos, so say which one is at stake.
  const effect =
    label.part === undefined
      ? "Download it again."
      : label.part <= 1
        ? "It holds your lists, so download it again."
        : "It most likely holds only photos and videos, so your lists are not affected. Download it again to include them.";
  return issue("error", "zip-unreadable", `Snappy could not read ${name} as a ZIP file. ${effect}`);
}
/** @internal */
export const zipTooManyEntriesIssue = (count: number): ExportIssue =>
  issue("error", "zip-too-many-entries", `This ZIP file lists ${count} items, more than the ${MAX_ENTRIES} Snappy opens.`);
/** @internal */
export function zipEntryUnreadableIssue(e: Entry, label: PartLabel = {}): ExportIssue {
  const name = shownFileName(label.name);
  return issue("error", "zip-entry-unreadable", `Snappy could not open ${baseName(e.path)} inside ${name === undefined ? "the ZIP file" : name}.`);
}
/** @internal A password protected (or AES encrypted) ZIP file. */
export function zipEncryptedIssue(label: PartLabel = {}): ExportIssue {
  const name = shownFileName(label.name);
  return issue("error", "zip-encrypted", `${name === undefined ? "This ZIP file" : name} is password protected. Snappy cannot open it.`);
}
/** @internal */
export function zipUnsupportedMethodIssue(label: PartLabel = {}): ExportIssue {
  const name = shownFileName(label.name);
  return issue("error", "zip-unsupported-method", `${name === undefined ? "This ZIP file" : name} uses a compression method Snappy does not support.`);
}
/** @internal */
export const zipEntryTooLargeIssue = (e: Entry): ExportIssue =>
  issue("error", "zip-entry-too-large", `${baseName(e.path)} is too large for Snappy to open.`);

/** Which known data file an entry is, by its file name. @internal */
export function targetOf(e: Entry): Target | undefined {
  const base = baseName(e.path).toLowerCase();
  return (Object.keys(TARGET_NAMES) as Target[]).find((t) => namesOf(t).includes(base));
}

/**
 * From a full listing, pick the (at most four) known data files worth reading and enforce the
 * zip-bomb limits on their declared sizes; a file over a limit is skipped with an issue. Targets in
 * `streamed` are read without holding them whole, so only the declared-size bound applies to them.
 * @internal Shared by parseExportZip and parseExportFromReader.
 */
export function planJsonReads(listing: Entry[], issues: ExportIssue[], streamed: ReadonlySet<Target> = new Set()): Entry[] {
  const candidates = listing.filter((e) => !isJunk(e.path) && !isMedia(e.path));
  let budget = MAX_JSON_BYTES;
  const wanted: Entry[] = [];
  for (const [target, e] of pickTargets(candidates)) {
    const isStreamed = streamed.has(target);
    if (e.size > (isStreamed ? MAX_STREAMED_JSON_BYTES : MAX_JSON_FILE_BYTES) || (!isStreamed && e.size > budget)) {
      issues.push(issue("error", "zip-json-too-large", `${baseName(e.path)} is too large to open safely and was skipped.`));
      continue;
    }
    if (!isStreamed) budget -= e.size;
    wanted.push(e);
  }
  // Parts saved from a cloud drive or a mail app often arrive inside one more ZIP file.
  if (wanted.length === 0 && candidates.some((e) => /\.zip$/i.test(e.path))) {
    issues.push(issue("error", "nested-zip", "This ZIP holds other ZIP files. Unzip it once and choose the parts inside."));
  }
  return wanted;
}

/** Split a listing into data files and media files; junk entries are dropped. @internal */
export function splitListing(entries: Entry[]): { files: Entry[]; media: Entry[] } {
  const files: Entry[] = [];
  const media: Entry[] = [];
  for (const e of entries) {
    if (isJunk(e.path)) continue;
    (isMedia(e.path) ? media : files).push(e);
  }
  return { files, media };
}

/** The values the known data files produce. @internal */
export interface TargetValues {
  friends: ParsedFriends;
  chats: ChatEvent[];
  snaps: ChatEvent[];
  memories: MemoryItem[];
}

/** What reading one data file gave: its notes (always) and its value (unless the file could not be read). @internal */
export interface Outcome<T> {
  value?: T;
  issues: ExportIssue[];
}

/** Outcomes of the data files that were read; absent when a file was not there or could not be opened. @internal */
export type Outcomes = { [K in Target]?: Outcome<TargetValues[K]> };

const PARSERS: { [K in Target]: (json: unknown, known?: ReadonlySet<string>) => { value: TargetValues[K]; issues: ExportIssue[] } } = {
  friends: (json) => {
    const r = parseFriendsJson(json);
    return { value: r.friends, issues: r.issues };
  },
  chats: (json, known) => {
    const r = parseChatHistoryJson(json, known);
    return { value: r.chats, issues: r.issues };
  },
  snaps: (json, known) => {
    const r = parseSnapHistoryJson(json, known);
    return { value: r.chats, issues: r.issues };
  },
  memories: (json) => {
    const r = parseMemoriesJson(json);
    return { value: r.memories, issues: r.issues };
  },
};

/**
 * The usernames in the friends file that a conversation can be with: current and removed friends,
 * requests, blocked and ignored people (not the hidden suggestions). Undefined without a friends
 * file. Lets the chat parsers tell a one-to-one chat from a group when the layout does not.
 * @internal
 */
export function usernamesOf(friends: ParsedFriends | undefined): ReadonlySet<string> | undefined {
  if (friends === undefined) return undefined;
  const out = new Set<string>();
  for (const list of [friends.friends, friends.deletedFriends, friends.sentRequests, friends.pendingRequests, friends.blocked, friends.ignored]) {
    for (const r of list) out.add(r.username);
  }
  return out.size > 0 ? out : undefined;
}

/** Parse a data file that is already JSON (or a projection of it holding only allowlisted fields). Never throws. @internal */
export function parseTargetJson<K extends Target>(target: K, json: unknown, known?: ReadonlySet<string>): Outcome<TargetValues[K]> {
  const parsed = PARSERS[target](json, known);
  return { value: parsed.value, issues: parsed.issues };
}

/** Decode and parse one data file held in memory. Never throws. @internal */
export function parseTarget<K extends Target>(target: K, bytes: Uint8Array, known?: ReadonlySet<string>): Outcome<TargetValues[K]> {
  const r = parseJsonBytes(TARGET_NAMES[target], bytes);
  if (r.value === undefined) return { issues: r.issues };
  const parsed = PARSERS[target](r.value, known);
  return { value: parsed.value, issues: [...r.issues, ...parsed.issues] };
}

/**
 * Combine what the data files gave with the directory listing into a ParsedExport. `part` is the
 * 1-based position of this zip among the parts of the export. The Memories media files of the part
 * are paired with the Memories list here; mergeParsedExports pairs again once all parts are known.
 * @internal
 */
export function finishExport(
  files: Entry[],
  media: Entry[],
  outcomes: Outcomes,
  issues: ExportIssue[],
  exportedAt: number | undefined,
  part: number,
): ParsedExport {
  for (const target of ["friends", "chats", "snaps", "memories"] as const) issues.push(...(outcomes[target]?.issues ?? []));

  // Only files under a memories/ folder may be linked to memories; chat media must never be matched by date.
  const bundled = sortBundledMedia(classifyMemoryMedia(media, part));
  let memories = outcomes.memories?.value ?? [];
  const pairingIssues: ExportIssue[] = [];
  let pairing: MemoriesPairing | undefined;
  if (outcomes.memories?.value !== undefined) {
    const r = attachBundledMedia(memories, bundled);
    memories = r.memories;
    pairing = r.pairing;
    // No Memories folder in this part: entries with no link are not lost files, the export just holds the list.
    pairingIssues.push(...(bundled.length === 0 ? r.issues.map(listOnlyNote) : r.issues));
  }

  if (media.length > 0) issues.push(mediaNotOpenedIssue({ [part]: media.length }));
  const fileList = capFileList(maskFileList(files.map((e) => e.path)), issues);
  // Last, so that mergeParsedExports can replace them by the notes for the whole export.
  issues.push(...pairingIssues);

  const parsed: ParsedExport = {
    friends: outcomes.friends?.value ?? emptyFriends(),
    chats: [...(outcomes.chats?.value ?? []), ...(outcomes.snaps?.value ?? [])],
    memories,
    fileList,
    issues,
  };
  if (bundled.length > 0) parsed.bundledMedia = bundled;
  if (pairing !== undefined) parsed.memoriesPairing = pairing;
  if (exportedAt !== undefined) parsed.exportedAt = exportedAt;
  return parsed;
}

/**
 * Parse the chosen files (all held in memory) and project them into a ParsedExport.
 * @internal
 */
export function assemble(
  entries: Entry[],
  read: (entry: Entry) => Uint8Array | undefined,
  issues: ExportIssue[],
  exportedAt: number | undefined,
  part = 1,
): ParsedExport {
  const { files, media } = splitListing(entries);
  const targets = pickTargets(files);
  const outcomes: Outcomes = {};
  for (const target of Object.keys(TARGET_NAMES) as Target[]) {
    const entry = targets.get(target);
    const bytes = entry && read(entry);
    if (bytes) (outcomes as Record<Target, unknown>)[target] = parseTarget(target, bytes, usernamesOf(outcomes.friends?.value));
  }
  return finishExport(files, media, outcomes, issues, exportedAt, part);
}

/** Parse an export from already-extracted files (path -> bytes). Never throws on malformed user data. */
export function parseExportFiles(files: Record<string, Uint8Array>): ParsedExport {
  const byPath = new Map<string, Uint8Array>();
  const entries: Entry[] = [];
  for (const name of Object.keys(files)) {
    const bytes = files[name];
    if (!bytes || !ArrayBuffer.isView(bytes)) continue;
    const path = normPath(name);
    byPath.set(path, bytes);
    entries.push({ name, path, size: bytes.byteLength });
  }
  return assemble(entries, (e) => byPath.get(e.path), [], undefined);
}

/**
 * Parse a "Download My Data" zip. Entry names and sizes come from the central
 * directory; only the (at most three) known JSON files are inflated, so media and
 * every other file stay compressed and unread. Never throws.
 */
export function parseExportZip(zip: Uint8Array): ParsedExport {
  const dir = readZipDirectory(zip, MAX_ENTRIES);
  if (dir === undefined) {
    return emptyParsed([zipUnreadableIssue()]);
  }
  if (dir.entryCount > MAX_ENTRIES) return emptyParsed([zipTooManyEntriesIssue(dir.entryCount)]);

  const listing: Entry[] = [];
  try {
    // The filter never selects anything: this pass only lists names and sizes.
    unzipSync(zip, {
      filter: (info) => {
        listing.push({ name: info.name, path: normPath(info.name), size: info.originalSize });
        return false;
      },
    });
  } catch {
    return emptyParsed([zipUnreadableIssue()]);
  }

  const issues: ExportIssue[] = [];
  const wanted = planJsonReads(listing, issues);

  // Each file is inflated on its own, so one corrupt or unsupported entry costs only that file.
  // Only the FIRST entry of a name is selected: the size check above covered that entry, and a zip
  // that repeats a name must not get the later (unchecked) copies inflated or parsed instead.
  const inflated: Record<string, Uint8Array> = {};
  for (const e of wanted) {
    let taken = false;
    try {
      Object.assign(
        inflated,
        unzipSync(zip, {
          filter: (info) => {
            if (info.name !== e.name || taken) return false;
            taken = true;
            return true;
          },
        }),
      );
    } catch {
      issues.push(zipEntryUnreadableIssue(e));
    }
  }
  return assemble(listing, (e) => inflated[e.name], issues, dir.newestMtime);
}
