/**
 * Structure-only description of a Snapchat export. Lets a user show us the SHAPE of their
 * real data (so parsers can be corrected) without exposing one personal value.
 *
 * By default the output is built exclusively from: (a) strings defined in this file
 * (vocabulary, labels, type names, bucket labels), (b) allowlisted system file names,
 * (c) bucketed counts. No string from the export is ever copied into the report, and the only
 * exact numbers are the byte sizes of non-media files (media sizes are bucketed).
 *
 * The one opt-in exception is `showKeys`: it also prints unknown key names that pass
 * safeKey(). safeKey() rejects identifier-shaped keys (usernames, ids, numbers, anything with
 * "@" or "+"), but it cannot tell a plain-words group title or display name from a field name, so
 * a showKeys report MUST be reviewed before it is shared (the report itself says so).
 * Media bytes are never read: only their length is used. Neither are the values of any JSON file in
 * the reader-based report: every one is walked as a byte stream that reports field names and value
 * kinds only, so message text, locations and account values are never decoded (and the files may
 * be of any size). Files whose name or section names say login, location, purchase, support, My AI,
 * ad, account or device data are not described at all: the report lists the allowlisted file name
 * and the words "not described", with no field names, counts or sizes, and such a file named by
 * its path is not even opened.
 */
import { unzipSync } from "fflate";
import { KNOWN_DIRS, KNOWN_STEMS, MEDIA_EXTENSIONS } from "./layout.ts";
import { readZipDirectory } from "./zip.ts";
import { JsonStreamError, inflateSource, projectShapes } from "./json-stream.ts";
import { listZipEntries } from "./zip-reader.ts";
import type { RandomAccessReader, ZipEntryInfo } from "./zip-reader.ts";

// ------------------------------------------------------------------- types ---

export type StructureKind = "object" | "array" | "string" | "number" | "boolean" | "null" | "union";

export interface StructureNode {
  kind: StructureKind;
  /** Arrays: bucketed element-count range (min === max for a single array). */
  size?: { min: string; max: string };
  /** Objects: fields sorted by label. Labels are vocabulary keys, "<key>" or a dynamic-map label. */
  fields?: { key: string; node: StructureNode }[];
  /** Arrays: every element's structure merged into one node (absent for empty arrays). */
  items?: StructureNode;
  /** Unions: the distinct kinds seen at this position, sorted. */
  options?: StructureNode[];
}

export interface StructureFile {
  /** Allowlisted system name, or a mask such as "<file-3>.json" / "<media-1>.jpg". */
  name: string;
  kind: "json" | "html" | "media" | "other";
  /** Exact size for non-media files. */
  sizeBytes?: number;
  /** Media size is bucketed; the exact size of a photo/video is not our business. */
  sizeBucket?: string;
  /** Fixed-text remark, e.g. "unparseable json". Never contains a snippet. */
  note?: string;
  /** JSON files: merged structure. */
  structure?: StructureNode;
  /** HTML files: tag-name histogram with bucketed counts, sorted by tag. */
  tags?: { tag: string; count: string }[];
}

/** Files a report deliberately did not open or list: only how many there were. */
export interface LeftOutCounts {
  html: number;
  media: number;
  other: number;
}

export interface StructureReport {
  showKeys: boolean;
  files: StructureFile[];
  /** Report-level remarks (fixed text), e.g. an unreadable zip. */
  notes: string[];
  /** Present when HTML, media and other files were counted instead of described (the reader-based report). */
  leftOut?: LeftOutCounts;
}

export interface DescribeOptions {
  /** Also print unknown key names that look harmless (dynamic maps still collapse). Default false. */
  showKeys?: boolean;
}

// ------------------------------------------------------------- vocabulary ---

/** Key names the export is known (or expected) to use. Matched case-insensitively. */
const VOCABULARY = new Map(
  [
    // friends.json
    "Friends", "Friend Requests Sent", "Friend Requests Received", "Friend Requests", "Blocked Users",
    "Deleted Friends", "Ignored Snapchatters", "Pending Requests", "Hidden Friend Suggestions",
    "Username", "Display Name", "Creation Timestamp", "Last Modified Timestamp", "Source", "Date",
    "Timestamp", "Category",
    // chat_history.json
    "From", "Media Type", "Created", "Content", "Conversation Title", "IsSender", "IsSaved",
    "Created(microseconds)", "Saved Chat History", "Received Saved Chat History", "Sent Saved Chat History",
    "Text", "Type",
    // memories_history.json
    "Saved Media", "Location", "Download Link", "Media Download Url", "Media Download URL",
    "Latitude", "Longitude",
    // other sections that commonly appear in the export
    "Account Information", "Basic Information", "Login History", "Device Information", "Account History",
    "Display Name Change", "Email Change", "Mobile Number Change", "Password Change", "Snap History",
    "Story History", "Spotlight History", "Search History", "Terms History", "Subscriptions",
    "Shopping History", "Orders", "Connected Apps", "Bitmoji", "Snap Map Places", "Official Stories",
    "Ranking", "Support Notes", "Talk History", "Web Interactions", "Community Lenses", "Snap AI",
    "Email Campaign History", "In-App Surveys", "Location History", "User Profile", "Status", "Value",
    "Name", "Id", "ID", "URL", "Url", "Link", "Title", "Description", "Count", "Version", "Language",
    "Country", "Region", "Device", "Platform", "Time", "Start Time", "End Time", "Duration",
  ].map((k) => [k.toLowerCase(), k] as const),
);

// The layout vocabulary lives in layout.ts (shared with parse.ts); re-exported for existing importers.
export { KNOWN_DIRS, KNOWN_STEMS };

const KNOWN_HTML_TAGS = new Set([
  "a", "abbr", "article", "aside", "b", "body", "br", "button", "caption", "code", "col", "colgroup",
  "div", "em", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "head", "header", "hr", "html",
  "i", "img", "input", "label", "li", "link", "main", "meta", "nav", "ol", "option", "p", "pre",
  "script", "section", "select", "small", "span", "strong", "style", "sub", "sup", "svg", "table",
  "tbody", "td", "textarea", "tfoot", "th", "thead", "title", "tr", "u", "ul",
]);

// ------------------------------------------------------------------ limits ---

const MAX_DEPTH = 12;
/** More unknown keys than this, with same-shaped values, is treated as a dynamic map (usernames, ids). */
const DYNAMIC_MAP_MIN_KEYS = 8;
const MAX_KEY_LENGTH = 40;
/** Bigger text files are listed but not parsed (also bounds zip-bomb inflation). */
const MAX_TEXT_BYTES = 256 * 1024 * 1024;
/**
 * Total declared size of the text entries describeZipStructure will inflate. Every selected
 * entry is held in memory at once, so the per-file cap alone would let many near-cap entries
 * (a few MB of zip) exhaust memory. Entries past the budget are listed as "not read".
 */
const MAX_TOTAL_TEXT_BYTES = 512 * 1024 * 1024;
/** Same entry-count cap as parseExportZip: real exports hold tens of thousands of files. */
const MAX_ZIP_ENTRIES = 500_000;

const COUNT_BUCKETS = ["0", "1-9", "10-99", "100-999", "1000-9999", "10000+"];

function countBucket(n: number): string {
  if (n <= 0) return "0";
  const index = Math.min(COUNT_BUCKETS.length - 1, String(Math.floor(n)).length);
  return COUNT_BUCKETS[index] ?? "10000+";
}

function mediaSizeBucket(bytes: number): string {
  if (bytes < 10_000) return "<10 KB";
  if (bytes < 1_000_000) return "10 KB-1 MB";
  if (bytes < 10_000_000) return "1-10 MB";
  if (bytes < 100_000_000) return "10-100 MB";
  return ">=100 MB";
}

// -------------------------------------------------------- structure building ---

function scalarKind(v: unknown): StructureKind {
  if (v === null) return "null";
  if (typeof v === "string") return "string";
  if (typeof v === "number") return "number";
  if (typeof v === "boolean") return "boolean";
  return "null"; // undefined / non-JSON values cannot come out of JSON.parse
}

/**
 * A user key is printable (showKeys only) when it is short plain text with no identifier-like
 * shape. Digits are rejected outright: usernames and ids carry them ("bob99"), field names
 * almost never do. Plain words still pass, so a title such as "Weekend Crew" is not caught here;
 * describeValue() additionally hides the keys of record lists (see there), and the module comment
 * explains why a showKeys report must be reviewed before sharing.
 */
function safeKey(key: string): boolean {
  return (
    key.length <= MAX_KEY_LENGTH &&
    /^[\p{L}][\p{L} _.\-:()]*$/u.test(key)
  );
}

/**
 * A list of objects under an unknown key is what a conversation (key = username or group title)
 * or a record section looks like. Its key is never printed, even with showKeys: the record
 * field names underneath still are, which is the part that helps fix a parser.
 */
function isRecordList(v: unknown): boolean {
  return Array.isArray(v) && v.some((el) => typeof el === "object" && el !== null && !Array.isArray(el));
}

function bucketIndex(label: string): number {
  return COUNT_BUCKETS.indexOf(label);
}

function mergeSameKind(a: StructureNode, b: StructureNode): StructureNode {
  if (a.kind === "object") {
    const byKey = new Map<string, StructureNode>();
    for (const f of [...(a.fields ?? []), ...(b.fields ?? [])]) {
      const prev = byKey.get(f.key);
      byKey.set(f.key, prev ? mergeNodes(prev, f.node) : f.node);
    }
    return { kind: "object", fields: sortedFields(byKey) };
  }
  if (a.kind === "array") {
    const out: StructureNode = { kind: "array" };
    if (a.size && b.size) {
      out.size = {
        min: bucketIndex(a.size.min) <= bucketIndex(b.size.min) ? a.size.min : b.size.min,
        max: bucketIndex(a.size.max) >= bucketIndex(b.size.max) ? a.size.max : b.size.max,
      };
    }
    const items = a.items && b.items ? mergeNodes(a.items, b.items) : (a.items ?? b.items);
    if (items) out.items = items;
    return out;
  }
  return a;
}

/** Merge two structures; differing kinds become a union (one option per kind). */
function mergeNodes(a: StructureNode, b: StructureNode): StructureNode {
  const byKind = new Map<StructureKind, StructureNode>();
  for (const n of [...(a.kind === "union" ? (a.options ?? []) : [a]), ...(b.kind === "union" ? (b.options ?? []) : [b])]) {
    const prev = byKind.get(n.kind);
    byKind.set(n.kind, prev ? mergeSameKind(prev, n) : n);
  }
  if (byKind.size === 1) return [...byKind.values()][0] as StructureNode;
  return { kind: "union", options: [...byKind.values()].sort((x, y) => compare(x.kind, y.kind)) };
}

function mergeAll(nodes: StructureNode[]): StructureNode | undefined {
  let acc: StructureNode | undefined;
  for (const n of nodes) acc = acc ? mergeNodes(acc, n) : n;
  return acc;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortedFields(byKey: Map<string, StructureNode>): { key: string; node: StructureNode }[] {
  return [...byKey.entries()].sort((x, y) => compare(x[0], y[0])).map(([key, node]) => ({ key, node }));
}

function sameShape(nodes: StructureNode[]): boolean {
  const kinds = new Set(nodes.map((n) => n.kind).filter((k) => k !== "null"));
  return kinds.size <= 1;
}

function describeValue(v: unknown, depth: number, showKeys: boolean): StructureNode {
  if (Array.isArray(v)) {
    const bucket = countBucket(v.length);
    const node: StructureNode = { kind: "array", size: { min: bucket, max: bucket } };
    if (depth >= MAX_DEPTH) return node;
    const items = mergeAll(v.map((el) => describeValue(el, depth + 1, showKeys)));
    if (items) node.items = items;
    return node;
  }
  if (typeof v !== "object" || v === null) return { kind: scalarKind(v) };
  if (depth >= MAX_DEPTH) return { kind: "object" };
  const children = Object.entries(v).map(([key, value]) => ({ key, node: describeValue(value, depth + 1, showKeys), hidden: isRecordList(value) }));
  return objectNode(children, showKeys);
}

/** One field of an object: its key, the structure of its value, and whether the key must never be printed. */
interface Child {
  key: string;
  node: StructureNode;
  hidden: boolean;
}

/** The structure of an object from its fields: vocabulary keys by name, the rest as "<key>" or a dynamic map. */
function objectNode(children: Child[], showKeys: boolean): StructureNode {
  const byLabel = new Map<string, StructureNode>();
  const add = (label: string, node: StructureNode) => {
    const prev = byLabel.get(label);
    byLabel.set(label, prev ? mergeNodes(prev, node) : node);
  };

  const unknownKeys: string[] = [];
  const unknownNodes: StructureNode[] = [];
  const unknownPrintable: boolean[] = [];
  for (const { key, node, hidden } of children) {
    const canonical = VOCABULARY.get(key.toLowerCase());
    if (canonical !== undefined) {
      add(canonical, node);
    } else {
      unknownKeys.push(key);
      unknownNodes.push(node);
      unknownPrintable.push(showKeys && safeKey(key) && !hidden);
    }
  }

  if (unknownNodes.length > DYNAMIC_MAP_MIN_KEYS && sameShape(unknownNodes)) {
    // Dynamic map (usernames, ids, timestamps as keys): the keys ARE the personal data.
    add(`<dynamic keys x ${countBucket(unknownNodes.length)}>`, mergeAll(unknownNodes) as StructureNode);
  } else {
    unknownNodes.forEach((node, i) => {
      const key = unknownKeys[i] as string;
      add(unknownPrintable[i] ? key : "<key>", node);
    });
  }
  return { kind: "object", fields: sortedFields(byLabel) };
}

function describeHtml(bytes: Uint8Array): { tag: string; count: string }[] {
  // latin1 never fails on odd bytes; only ASCII tag names are matched, text is discarded unread.
  const text = new TextDecoder("latin1").decode(bytes);
  const counts = new Map<string, number>();
  for (const m of text.matchAll(/<([A-Za-z][A-Za-z0-9-]*)/g)) {
    const name = (m[1] as string).toLowerCase();
    const tag = KNOWN_HTML_TAGS.has(name) ? name : "<other>";
    counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()].sort((x, y) => compare(x[0], y[0])).map(([tag, n]) => ({ tag, count: countBucket(n) }));
}

// ----------------------------------------------------------------- entries ---

interface Entry {
  path: string;
  size: number;
  /** Present only for json/html entries we may read. */
  bytes?: Uint8Array;
  /** Fixed-text remark used instead of the default when no bytes are present. */
  note?: string;
  /** A JSON file described by streaming: `structure` (or `note`, when that failed) is final and no bytes were held. */
  streamed?: boolean;
  structure?: StructureNode;
  /** A file of a kind the report never describes: only its allowlisted name and a fixed remark are printed. */
  sensitive?: boolean;
}

function splitName(path: string): { dirs: string[]; stem: string; ext: string } {
  const parts = path.split("/");
  const base = parts.pop() ?? "";
  const dot = base.lastIndexOf(".");
  const hasExt = dot > 0 && /^[A-Za-z0-9]{1,6}$/.test(base.slice(dot + 1));
  return {
    dirs: parts,
    stem: hasExt ? base.slice(0, dot) : base,
    ext: hasExt ? base.slice(dot + 1).toLowerCase() : "",
  };
}

function kindOf(ext: string): StructureFile["kind"] {
  if (ext === "json") return "json";
  if (ext === "html" || ext === "htm") return "html";
  return MEDIA_EXTENSIONS.has(ext) ? "media" : "other";
}

/** Allowlisted layout name, normalised to lower case; undefined if it might be personal. */
function knownName(dirs: string[], stem: string, ext: string): string | undefined {
  if (!dirs.every((d) => KNOWN_DIRS.has(d.toLowerCase()))) return undefined;
  const m = /^(.*?)(?:[_-]\d{1,3})?$/.exec(stem.toLowerCase());
  if (!m || !KNOWN_STEMS.has(m[1] as string)) return undefined;
  return [...dirs.map((d) => d.toLowerCase()), `${stem.toLowerCase()}.${ext}`].join("/");
}

/** Fixed remark for a file the report never describes. */
const NOT_DESCRIBED = "not described";

/**
 * Words that mark a file or a section as login, location, purchase, support, My AI, ad, account or
 * device data: the kinds of data the contract says are never read. Matched on whole words of a
 * file name or a section name ("Login History", "location_history", "LoginHistory").
 */
const SENSITIVE_WORDS: ReadonlySet<string> = new Set([
  "login", "logins", "signin", "location", "locations", "gps", "geo", "places",
  "purchase", "purchases", "shopping", "order", "orders", "payment", "payments", "billing", "subscription", "subscriptions",
  "support", "ai", "ad", "ads", "advertising", "advertisement", "advertisements",
  "account", "email", "phone", "mobile", "password", "device", "devices", "survey", "surveys",
  "profile", "search", "talk", "interactions", "display", "bio", "caption", "captions",
]);

/** True when `name` (a file name or a section name) says it holds data the report must not describe. */
export function isSensitiveName(name: string): boolean {
  const words = name
    .replace(/\.[A-Za-z0-9]{1,6}$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w !== "");
  return words.some((w) => SENSITIVE_WORDS.has(w) || w.startsWith("advertis"));
}

/** True when a parsed document's top-level section names say it is a kind the report never describes. */
function hasSensitiveSection(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).some(isSensitiveName);
}

/** A JSON entry whose own file name says it is a kind the report never describes (it is not opened). */
function isSensitivePath(path: string): boolean {
  return isSensitiveName(path.slice(path.lastIndexOf("/") + 1));
}

function describeEntries(entries: Entry[], showKeys: boolean, notes: string[]): StructureReport {
  const normalised = entries
    .map((e) => ({ ...e, path: e.path.replace(/\\/g, "/").replace(/^(\.?\/)+/, "") }))
    .filter((e) => e.path !== "" && !e.path.endsWith("/"))
    // Sorted so masks are numbered the same way whatever order the caller listed files in.
    .sort((a, b) => compare(a.path, b.path));

  let fileNo = 0;
  let mediaNo = 0;
  const files: StructureFile[] = [];

  for (const e of normalised) {
    const { dirs, stem, ext } = splitName(e.path);
    const kind = kindOf(ext);

    if (kind === "media") {
      mediaNo += 1;
      files.push({ name: `<media-${mediaNo}>.${ext}`, kind, sizeBucket: mediaSizeBucket(e.size) });
      continue;
    }

    let name: string | undefined;
    if (kind === "json" || kind === "html") name = knownName(dirs, stem, ext);
    if (name === undefined) {
      fileNo += 1;
      name = kind === "other" ? `<file-${fileNo}>` : `<file-${fileNo}>.${ext}`;
    }
    if (kind === "json" && (e.sensitive === true || isSensitivePath(e.path))) {
      files.push({ name, kind, note: NOT_DESCRIBED }); // no size, no counts, no field names
      continue;
    }
    const file: StructureFile = { name, kind, sizeBytes: e.size };

    if (e.streamed) {
      if (e.structure !== undefined) file.structure = e.structure;
      if (e.note !== undefined) file.note = e.note;
    } else if (kind === "json" || kind === "html") {
      if (e.size > MAX_TEXT_BYTES) {
        file.note = "too large to describe";
      } else if (!e.bytes) {
        file.note = e.note ?? "not read";
      } else if (kind === "html") {
        file.tags = describeHtml(e.bytes);
      } else {
        try {
          const text = new TextDecoder("utf-8").decode(e.bytes).replace(/^﻿/, "");
          const value: unknown = JSON.parse(text);
          if (hasSensitiveSection(value)) {
            files.push({ name, kind, note: NOT_DESCRIBED });
            continue;
          }
          file.structure = describeValue(value, 0, showKeys);
        } catch {
          file.note = "unparseable json"; // never include the parser message: it can quote the input
        }
      }
    }
    files.push(file);
  }
  return { showKeys, files, notes };
}

// -------------------------------------------------------------- public API ---

/**
 * Describe an already-extracted export (path -> bytes). Media bytes are never read, only
 * their length, so callers may pass empty placeholders for media if they wish.
 */
export function describeStructure(files: Record<string, Uint8Array>, opts: DescribeOptions = {}): StructureReport {
  const entries = Object.entries(files).map(([path, bytes]) => ({ path, size: bytes.length, bytes }));
  return describeEntries(entries, opts.showKeys === true, []);
}

/** fflate filter that selects only the first entry of each wanted name (duplicate names are never inflated twice). */
function firstOccurrence(wanted: (name: string) => boolean): (f: { name: string }) => boolean {
  const seen = new Set<string>();
  return (f) => {
    if (!wanted(f.name) || seen.has(f.name)) return false;
    seen.add(f.name);
    return true;
  };
}

/**
 * Describe a zip directly, inflating only .json/.html entries (media stays compressed and unread).
 * Bounded like parseExportZip: an entry-count cap, a per-file cap and a TOTAL size budget; and
 * one entry that cannot be decompressed only loses its own structure, not the whole report.
 */
export function describeZipStructure(zip: Uint8Array, opts: DescribeOptions = {}): StructureReport {
  const showKeys = opts.showKeys === true;
  const unreadable = (note: string): StructureReport => ({ showKeys, files: [], notes: [note] });

  const dir = readZipDirectory(zip, MAX_ZIP_ENTRIES);
  if (dir === undefined) return unreadable("zip unreadable");
  if (dir.entryCount > MAX_ZIP_ENTRIES) return unreadable("zip has too many entries to describe");

  // Pass 1: names and declared sizes only (the filter never selects anything).
  const listed: { path: string; size: number }[] = [];
  try {
    unzipSync(zip, {
      filter: (f) => {
        listed.push({ path: f.name, size: f.originalSize });
        return false;
      },
    });
  } catch {
    return unreadable("zip unreadable");
  }

  const { selected, overBudget } = chooseTextEntries(listed);

  // Pass 2: one call for speed; if any entry is corrupt, retry entry by entry so the rest survive.
  const inflated: Record<string, Uint8Array> = {};
  const failed = new Set<string>();
  try {
    Object.assign(inflated, unzipSync(zip, { filter: firstOccurrence((name) => selected.has(name)) }));
  } catch {
    for (const name of selected) {
      try {
        Object.assign(inflated, unzipSync(zip, { filter: firstOccurrence((n) => n === name) }));
      } catch {
        failed.add(name);
      }
    }
  }

  return describeEntries(withReadResults(listed, (path) => inflated[path], failed, overBudget), showKeys, []);
}

/**
 * Choose what to read: text entries within the per-file cap, until the total budget is spent.
 * A name that occurs twice is selected once (first occurrence), so what is charged is what is read.
 */
function chooseTextEntries(listed: { path: string; size: number }[]): { selected: Set<string>; overBudget: Set<string> } {
  const selected = new Set<string>();
  const overBudget = new Set<string>();
  let budget = MAX_TOTAL_TEXT_BYTES;
  for (const { path, size } of listed) {
    if (!/\.(json|html?)$/i.test(path) || size > MAX_TEXT_BYTES || selected.has(path)) continue;
    if (size > budget) {
      overBudget.add(path);
      continue;
    }
    budget -= size;
    selected.add(path);
  }
  return { selected, overBudget };
}

/** Attach what the read pass produced (bytes, or a fixed-text reason there are none) to each listed entry. */
function withReadResults(
  listed: { path: string; size: number }[],
  bytesOf: (path: string) => Uint8Array | undefined,
  failed: ReadonlySet<string>,
  overBudget: ReadonlySet<string>,
): Entry[] {
  return listed.map(({ path, size }) => {
    const bytes = bytesOf(path);
    if (bytes) return { path, size, bytes };
    if (failed.has(path)) return { path, size, note: "could not be decompressed" };
    if (overBudget.has(path)) return { path, size, note: "not read (size budget reached)" };
    return { path, size };
  });
}

/** The two per-conversation histories: described as conversations, whose keys are never printed or judged. */
const isHistoryFile = (path: string): boolean => /^(?:chat|snap|saved_chat)_history\.json$/i.test(path.slice(path.lastIndexOf("/") + 1));

/** Fixed remarks for a file that could not be described. */
const STREAM_NOTES = { malformed: "unparseable json", depth: "too large to describe", limit: "too large to describe", source: "could not be decompressed", encoding: "unsupported text encoding" } as const;

/**
 * Describe a JSON file by streaming it: lists of records as their field names and value kinds
 * (under keys that are never printed unless they are vocabulary), other top-level values by
 * kind. Values (message text, names, places) are skipped as bytes and never decoded, whatever the
 * size of the file. A file whose top-level or section names say login, location, purchase,
 * support, My AI, ad, account or device data is dropped from the result entirely (`sensitive`);
 * the two histories are exempt from that check because their keys are conversation names.
 */
async function describeStreamed(reader: RandomAccessReader, info: ZipEntryInfo, showKeys: boolean, history: boolean): Promise<Pick<Entry, "structure" | "note" | "sensitive">> {
  const conversations = new Map<number, { key: string; count: number; fields: Map<string, Set<string>> }>();
  const topLevel = new Map<string, Set<string>>();
  const onKind = (key: string | null, kind: string): void => {
    if (key === null) return;
    const seen = topLevel.get(key);
    if (seen === undefined) topLevel.set(key, new Set([kind]));
    else seen.add(kind);
  };
  try {
    for await (const { conversation, conversationKey, kinds } of projectShapes(inflateSource(reader, info), { onKind })) {
      let c = conversations.get(conversation);
      if (c === undefined) conversations.set(conversation, (c = { key: conversationKey, count: 0, fields: new Map() }));
      c.count++;
      for (const [name, kind] of Object.entries(kinds)) {
        const seen = c.fields.get(name);
        if (seen === undefined) c.fields.set(name, new Set([kind]));
        else seen.add(kind);
      }
    }
  } catch (e) {
    return { note: e instanceof JsonStreamError ? STREAM_NOTES[e.code] : STREAM_NOTES.source };
  }
  if (!history && [...topLevel.keys(), ...[...conversations.values()].map((c) => c.key)].some(isSensitiveName)) {
    return { sensitive: true, note: NOT_DESCRIBED };
  }
  const children: Child[] = [...conversations.values()].map((c) => {
    const bucket = countBucket(c.count);
    const fields: Child[] = [...c.fields].map(([key, kinds]) => ({ key, hidden: false, node: mergeAll([...kinds].map((kind) => ({ kind: kind as StructureKind }))) as StructureNode }));
    return { key: c.key, hidden: true, node: { kind: "array", size: { min: bucket, max: bucket }, items: objectNode(fields, showKeys) } };
  });
  if (!history) {
    // Top-level values that hold no records (a list of text, a number, an object): their kind only.
    const filed = new Set(children.map((c) => c.key));
    for (const [key, kinds] of topLevel) {
      if (!filed.has(key)) children.push({ key, hidden: false, node: mergeAll([...kinds].map((kind) => ({ kind: kind as StructureKind }))) as StructureNode });
    }
  }
  return { structure: objectNode(children, showKeys) };
}

/**
 * Describe one or more zip parts through random-access readers (multi-GB, multi-part exports).
 * Only the central directories and the .json entries are read. HTML pages are not opened and
 * media and other files are not listed: they are only counted (`leftOut`), because their names
 * and bytes are the personal part of an export. Limits and masking match describeZipStructure,
 * with the size budget shared across all parts. An unreadable part adds a fixed-text note and
 * the other parts are still described.
 */
export async function describeStructureFromReader(readers: RandomAccessReader[], opts: DescribeOptions = {}): Promise<StructureReport> {
  const notes: string[] = [];
  const json: { path: string; size: number; reader: RandomAccessReader; info: ZipEntryInfo }[] = [];
  const leftOut: LeftOutCounts = { html: 0, media: 0, other: 0 };
  let entryTotal = 0;

  for (const [i, reader] of readers.entries()) {
    const part = readers.length > 1 ? `part ${i + 1}: ` : "";
    const { entries, issues } = await listZipEntries(reader);
    if (issues.some((x) => x.severity === "error")) {
      notes.push(part + (issues.some((x) => x.code === "zip-too-many-entries") ? "zip has too many entries to describe" : "zip unreadable"));
    } else if (entryTotal + entries.length > MAX_ZIP_ENTRIES) {
      notes.push(part + "zip has too many entries to describe");
    } else {
      entryTotal += entries.length;
      for (const info of entries) {
        const path = info.name.replace(/\\/g, "/");
        if (path.endsWith("/")) continue;
        const kind = kindOf(splitName(path).ext);
        if (kind !== "json") leftOut[kind] += 1;
        else json.push({ path: info.name, size: info.size, reader, info });
      }
    }
  }

  const showKeys = opts.showKeys === true;
  const entries: Entry[] = [];
  // Streamed: no size cap and no share of the budget, because nothing is held. A file named for a
  // kind the report never describes is not opened at all.
  const done = new Set<string>();
  for (const { path, size, reader, info } of json) {
    if (done.has(path)) continue;
    done.add(path);
    if (isSensitivePath(path)) entries.push({ path, size, sensitive: true });
    else entries.push({ path, size, streamed: true, ...(await describeStreamed(reader, info, showKeys, isHistoryFile(path))) });
  }
  const report = describeEntries(entries, showKeys, notes);
  return { ...report, leftOut };
}

function renderNode(label: string | null, node: StructureNode, depth: number, out: string[]): void {
  const pad = "  ".repeat(depth);
  const prefix = label === null ? "" : `${label}: `;
  switch (node.kind) {
    case "object":
      out.push(`${pad}${prefix}object${node.fields?.length ? "" : " (no fields)"}`);
      for (const f of node.fields ?? []) renderNode(f.key, f.node, depth + 1, out);
      return;
    case "array": {
      const s = node.size;
      const size = !s ? "?" : s.min === s.max ? s.min : `${s.min} to ${s.max}`;
      out.push(`${pad}${prefix}array[${size}]`);
      if (node.items) renderNode("[item]", node.items, depth + 1, out);
      return;
    }
    case "union":
      out.push(`${pad}${prefix}one of`);
      for (const o of node.options ?? []) renderNode(null, o, depth + 1, out);
      return;
    default:
      out.push(`${pad}${prefix}${node.kind}`);
  }
}

/**
 * Plain-text report. Without `showKeys` it contains no value from the export and is safe to
 * paste anywhere; with `showKeys` it may contain plain-word key names, so review it first.
 */
export function formatStructureReport(r: StructureReport): string {
  const out: string[] = [
    "Snappy export structure report (names, types, and bucketed counts only; no values)",
    r.showKeys
      ? "key names: vocabulary plus plain-word names (dynamic maps collapsed). Review before sharing: a group title or display name made of plain words can appear here."
      : "key names: known vocabulary only",
    `files: ${r.files.length}`,
  ];
  for (const n of r.notes) out.push(`note: ${n}`);
  for (const f of r.files) {
    out.push("");
    const size = f.sizeBytes !== undefined ? `${f.sizeBytes} bytes` : (f.sizeBucket ?? "");
    out.push(`${f.name}  [${size === "" ? f.kind : `${f.kind}, ${size}`}]`);
    if (f.note) out.push(`  ${f.note}`);
    if (f.structure) renderNode(null, f.structure, 1, out);
    if (f.tags) {
      if (f.tags.length === 0) out.push("  (no tags)");
      for (const t of f.tags) out.push(`  ${t.tag}: ${t.count}`);
    }
  }
  if (r.leftOut) {
    out.push("", `Left out on purpose: ${r.leftOut.html} HTML, ${r.leftOut.media} photo/video/audio and ${r.leftOut.other} other ${r.leftOut.other === 1 ? "file" : "files"} (not opened).`);
  }
  return out.join("\n") + "\n";
}
