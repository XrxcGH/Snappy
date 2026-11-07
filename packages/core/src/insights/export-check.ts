/**
 * Export check: is this Snapchat export complete enough to use, and what should the person do if
 * not? Pure and deterministic. It reads no files and no clock (`now` is a parameter), and it builds
 * on results that already exist instead of parsing anything again:
 *
 *   parsed      the ParsedExport (counts, dates, file names, bundled media, pairing)
 *   validation  the issues from validateExport (export/validate.ts), optional
 *   layout      layoutSummary(...) from export/layout-report.ts, optional (part and file counts)
 *   structure   the StructureReport from export/inspect.ts, optional (file notes, unreadable zips)
 *   partCount / unreadableParts   readers.length and listParts(...).unreadable, optional
 *
 * Output is data: stable machine codes with numeric params and fixed section ids. There is no
 * prose. The result never holds a username, a file name, a link or any other value from the
 * export: only counts, dates (epoch ms) and codes defined in this file. Validation issues are
 * passed on by an allowlist of codes, never by message, so nothing a parser wrote is repeated.
 *
 * Default thresholds (all in this file, none are Snapchat rules):
 *   - an export is "fresh" up to 30 days old, "aging" up to 90 days and "stale" after that
 *   - a date later than `now` plus 2 days is a "future" date: it is counted and left out of the
 *     oldest/newest range (zip times carry no zone, so a small slack is allowed)
 *   - Snaps and saved chats share one event list; an event whose kind is IMAGE or VIDEO is a Snap
 *     (see ChatEvent.kind), everything else counts as a chat
 */
import type { ExportIssue, ExportIssueSeverity, ParsedExport } from "../types.ts";
import type { LayoutSummary } from "../export/layout-report.ts";
import type { StructureReport } from "../export/inspect.ts";
import { DAY_MS, normUser } from "../util.ts";

// ------------------------------------------------------------------- types ---

export type SectionId = "friends" | "chat_history" | "snap_history" | "memories_list" | "memories_files";
/** How much the rest of Snappy depends on the section. Only required and recommended ones affect the status. */
export type SectionNeed = "required" | "recommended" | "optional";
/** "empty" means the file is there but holds nothing Snappy can use. */
export type SectionStatus = "present" | "empty" | "missing" | "unreadable";

export interface SectionCheck {
  id: SectionId;
  need: SectionNeed;
  status: SectionStatus;
  /** Items found: distinct friends, chat events, Snaps, Memories entries or bundled Memories files. */
  count: number;
}

export interface PartsCheck {
  /** Zip parts given to the check (0 when nothing was given). */
  count: number;
  /** Parts that could not be read. */
  unreadable: number;
  /** Readable parts that hold no files (only known when a layout summary was given). */
  empty: number;
}

/** Dates found in one kind of record. Epoch ms; null when no usable date. */
export interface DateCoverage {
  count: number;
  /** Items with a usable date in the past (the range below is built from these). */
  dated: number;
  /** Items with no usable date. */
  undated: number;
  /** Items dated later than now (plus slack); left out of the range. */
  future: number;
  oldest: number | null;
  newest: number | null;
  /** Whole days from oldest to newest, or null. */
  spanDays: number | null;
}

export type AgeLevel = "fresh" | "aging" | "stale" | "future" | "unknown";

export interface ExportAge {
  /** Where the age comes from: the export's own time, or (a lower bound) its newest dated item. */
  basis: "export-time" | "newest-activity" | "none";
  at: number | null;
  /** Whole days between `at` and now; null when unknown or in the future. */
  ageDays: number | null;
  level: AgeLevel;
}

export type CheckStatus = "ready" | "ready-with-notes" | "incomplete" | "unusable";

export type ParamValue = number | string | string[];

export interface CheckNote {
  code: string;
  severity: ExportIssueSeverity;
  params: Record<string, ParamValue>;
}

export interface CheckAction {
  code: string;
  params: Record<string, ParamValue>;
}

export interface ExportCheckInput {
  parsed: Pick<ParsedExport, "friends" | "chats" | "memories" | "fileList"> & Partial<Pick<ParsedExport, "exportedAt" | "bundledMedia" | "memoriesPairing">>;
  /** Epoch ms "now" (injected: core never reads the clock). */
  now: number;
  /** Output of validateExport; only the codes in PASSED_ON are used. */
  validation?: ExportIssue[];
  layout?: LayoutSummary;
  structure?: StructureReport;
  /**
   * Number of zip parts, e.g. readers.length. Falls back to the layout, then to 1 when files exist.
   * The "more parts may exist" hint is only given when the count (or a layout) was supplied.
   */
  partCount?: number;
  /** 0-based indexes of unreadable parts, e.g. listParts(readers).unreadable. */
  unreadableParts?: number[];
}

export interface ExportCheck {
  status: CheckStatus;
  parts: PartsCheck;
  sections: SectionCheck[];
  coverage: { chats: DateCoverage; snaps: DateCoverage; memories: DateCoverage };
  age: ExportAge;
  /** Observations, most serious first (stable order). */
  notes: CheckNote[];
  /** What to do, in order. Empty when nothing is needed. */
  todo: CheckAction[];
}

// --------------------------------------------------------------- constants ---

const FUTURE_SLACK_MS = 2 * DAY_MS;
const FRESH_DAYS = 30;
const AGING_DAYS = 90;

/** Validation codes passed on (as notes); every other code is dropped. Chat/Snap/Memories "missing" are covered by sections. */
const PASSED_ON: ReadonlySet<string> = new Set([
  "friends-empty-but-deleted",
  "possibly-date-limited",
  "friend-count-mismatch",
  "duplicate-usernames",
  "future-timestamps",
]);
/** The passed-on codes that mean a date range or truncation may have cut the export short. */
const LIMITED_CODES: readonly string[] = ["friends-empty-but-deleted", "possibly-date-limited", "friend-count-mismatch"];

/** Structure-report remarks that mean the file could not be read as data. */
const UNREADABLE_FILE_NOTES: ReadonlySet<string> = new Set(["unparseable json", "could not be decompressed"]);

const FILE_PATTERNS: Record<"friends" | "chat_history" | "snap_history" | "memories_list", RegExp> = {
  friends: /^friends\.json$/,
  chat_history: /^chat_history(?:[_-]\d{1,3})?\.json$/,
  snap_history: /^snap_history(?:[_-]\d{1,3})?\.json$/,
  memories_list: /^memories_history(?:[_-]\d{1,3})?\.json$/,
};

const SEVERITY_RANK: Record<ExportIssueSeverity, number> = { error: 0, warning: 1, info: 2 };

// ----------------------------------------------------------------- helpers ---

const baseOf = (path: string): string => path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1).toLowerCase();

const isUsableTime = (t: unknown): t is number => typeof t === "number" && Number.isFinite(t) && t > 0;

const isSnapKind = (kind: string): boolean => {
  const k = typeof kind === "string" ? kind.toUpperCase() : "";
  return k === "IMAGE" || k === "VIDEO";
};

/** One-pass accumulator for a DateCoverage: no arrays, no argument spreads, so any list size is fine. */
function coverageBuilder(limit: number): { add(t: number | null | undefined): void; done(): DateCoverage } {
  let count = 0;
  let undated = 0;
  let future = 0;
  let dated = 0;
  let oldest: number | null = null;
  let newest: number | null = null;
  return {
    add(t) {
      count += 1;
      if (!isUsableTime(t)) undated += 1;
      else if (t > limit) future += 1;
      else {
        dated += 1;
        if (oldest === null || t < oldest) oldest = t;
        if (newest === null || t > newest) newest = t;
      }
    },
    done: () => ({
      count,
      dated,
      undated,
      future,
      oldest,
      newest,
      spanDays: oldest === null || newest === null ? null : Math.floor((newest - oldest) / DAY_MS),
    }),
  };
}

function sectionStatus(count: number, listed: boolean, unreadable: boolean): SectionStatus {
  return count > 0 ? "present" : unreadable ? "unreadable" : listed ? "empty" : "missing";
}

function ageLevel(ageDays: number): AgeLevel {
  return ageDays <= FRESH_DAYS ? "fresh" : ageDays <= AGING_DAYS ? "aging" : "stale";
}

// ------------------------------------------------------------------- check ---

/** Completeness check of one export. See the module comment for inputs, thresholds and privacy. */
export function checkExport(input: ExportCheckInput): ExportCheck {
  const { parsed } = input;
  const hasNow = Number.isFinite(input.now);
  const limit = hasNow ? input.now + FUTURE_SLACK_MS : Number.POSITIVE_INFINITY;

  // ---- parts
  // The count is "known" only when the caller gave it (or a layout); the fallback of one part is a
  // guess and must not trigger the "more parts may exist" hint.
  const partCountKnown = input.partCount !== undefined || input.layout !== undefined;
  const rawCount = input.partCount ?? input.layout?.parts.length ?? (parsed.fileList.length > 0 ? 1 : 0);
  const partCount = Number.isFinite(rawCount) ? Math.max(0, Math.floor(rawCount)) : 0;
  const unreadableSet = new Set<number>();
  for (const i of input.unreadableParts ?? []) if (Number.isInteger(i) && i >= 0 && i < partCount) unreadableSet.add(i);
  if (input.unreadableParts === undefined && input.structure !== undefined) {
    // Fallback: the structure report says "part N: zip unreadable" (N counts from 1; a single zip
    // has no prefix). Mark the part the note names, not the first few.
    for (const x of input.structure.notes) {
      if (!/zip unreadable|too many entries/.test(x)) continue;
      const m = /^part (\d{1,6}): /.exec(x);
      const i = m === null ? 0 : Number(m[1]) - 1;
      if (i >= 0 && i < partCount) unreadableSet.add(i);
    }
  }
  let emptyParts = 0;
  input.layout?.parts.forEach((p, i) => {
    if (p.files === 0 && !unreadableSet.has(i)) emptyParts += 1;
  });
  const parts: PartsCheck = { count: partCount, unreadable: unreadableSet.size, empty: emptyParts };

  // ---- file names (system names only; the list is already masked by the parser)
  const listed = { friends: false, chat_history: false, snap_history: false, memories_list: false };
  const brokenFile = { friends: false, chat_history: false, snap_history: false, memories_list: false };
  let hasJson = false;
  let hasHtml = false;
  const seeName = (path: string): void => {
    const base = baseOf(path);
    if (base.endsWith(".json")) hasJson = true;
    else if (base.endsWith(".html") || base.endsWith(".htm")) hasHtml = true;
    for (const key of Object.keys(FILE_PATTERNS) as (keyof typeof FILE_PATTERNS)[]) if (FILE_PATTERNS[key].test(base)) listed[key] = true;
  };
  for (const name of parsed.fileList) seeName(name);
  for (const f of input.structure?.files ?? []) {
    seeName(f.name);
    if (f.note !== undefined && UNREADABLE_FILE_NOTES.has(f.note)) {
      const base = baseOf(f.name);
      for (const key of Object.keys(FILE_PATTERNS) as (keyof typeof FILE_PATTERNS)[]) if (FILE_PATTERNS[key].test(base)) brokenFile[key] = true;
    }
  }
  const htmlOnly = hasHtml && !hasJson;

  // ---- counts and date coverage, one pass per list
  const friendsLists = parsed.friends;
  const distinctFriends = new Set<string>();
  for (const f of friendsLists.friends) distinctFriends.add(normUser(f.username));
  const otherFriendRecords =
    friendsLists.sentRequests.length + friendsLists.pendingRequests.length + friendsLists.deletedFriends.length +
    friendsLists.blocked.length + friendsLists.ignored.length + friendsLists.hiddenSuggestions.length;
  // Same definition as validateExport: repeats in friends plus repeats in sent requests (here also
  // ignoring case, as the rest of Snappy matches usernames).
  const distinctSent = new Set<string>();
  for (const f of friendsLists.sentRequests) distinctSent.add(normUser(f.username));
  const duplicateFriends =
    friendsLists.friends.length - distinctFriends.size + (friendsLists.sentRequests.length - distinctSent.size);

  const chats = coverageBuilder(limit);
  const snaps = coverageBuilder(limit);
  for (const e of parsed.chats) (isSnapKind(e.kind) ? snaps : chats).add(e.at);
  const memories = coverageBuilder(limit);
  for (const m of parsed.memories) memories.add(m.date);
  const coverage = { chats: chats.done(), snaps: snaps.done(), memories: memories.done() };

  // ---- sections
  // A front end that forgot the file list after pairing (forgetMediaHandles) still holds the pairing counts. Pairing is
  // only made when the zip directories listed media files, so its counts say the same thing: how many were found.
  const pairing = parsed.memoriesPairing;
  const mediaCount = parsed.bundledMedia?.length ?? (pairing === undefined ? 0 : pairing.mainFiles + pairing.overlays);
  const sections: SectionCheck[] = [
    { id: "friends", need: "required", status: friendsStatus(), count: distinctFriends.size },
    { id: "chat_history", need: "recommended", status: sectionStatus(coverage.chats.count, listed.chat_history, brokenFile.chat_history), count: coverage.chats.count },
    { id: "snap_history", need: "recommended", status: sectionStatus(coverage.snaps.count, listed.snap_history, brokenFile.snap_history), count: coverage.snaps.count },
    { id: "memories_list", need: "recommended", status: sectionStatus(coverage.memories.count, listed.memories_list, brokenFile.memories_list), count: coverage.memories.count },
    { id: "memories_files", need: "optional", status: mediaCount > 0 ? "present" : "missing", count: mediaCount },
  ];
  function friendsStatus(): SectionStatus {
    if (distinctFriends.size > 0) return "present";
    if (otherFriendRecords > 0) return "empty";
    return sectionStatus(0, listed.friends, brokenFile.friends);
  }
  const byId = (id: SectionId): SectionCheck => sections.find((s) => s.id === id) as SectionCheck;
  const friendsSection = byId("friends");

  // ---- age
  const age = exportAge(input, coverage, hasNow);

  // ---- notes
  const notes: CheckNote[] = [];
  const note = (code: string, severity: ExportIssueSeverity, params: Record<string, ParamValue> = {}): void => {
    // One note per code, and per section for the date notes.
    if (!notes.some((n) => n.code === code && n.params.section === params.section)) notes.push({ code, severity, params });
  };
  if (htmlOnly) note("html-only-export", "error");
  if (parts.count === 0) note("no-parts", "error");
  if (parts.unreadable > 0) note("parts-unreadable", "error", { count: parts.unreadable });
  if (parts.empty > 0) note("parts-empty", "warning", { count: parts.empty });
  if (duplicateFriends > 0) note("duplicate-usernames", "warning", { count: duplicateFriends });
  const passed = new Map<string, ExportIssueSeverity>();
  for (const i of input.validation ?? []) if (PASSED_ON.has(i.code) && !passed.has(i.code)) passed.set(i.code, i.severity);
  for (const code of PASSED_ON) {
    const severity = passed.get(code);
    if (severity !== undefined) note(code, severity === "info" ? "warning" : severity);
  }
  for (const [section, c] of [["chat_history", coverage.chats], ["snap_history", coverage.snaps], ["memories_list", coverage.memories]] as const) {
    if (c.future > 0) note("dates-in-future", "warning", { section, count: c.future });
    if (c.undated > 0) note("dates-missing", "info", { section, count: c.undated });
  }
  if (age.level === "stale") note("export-stale", "warning", { ageDays: age.ageDays as number });
  else if (age.level === "aging") note("export-aging", "info", { ageDays: age.ageDays as number });
  else if (age.level === "future") note("export-date-in-future", "warning");
  if (age.basis === "newest-activity") note("age-from-activity", "info");
  const memoriesList = byId("memories_list");
  const unmatched = parsed.memoriesPairing?.unmatchedItems ?? 0;
  if (unmatched > 0) note("memories-without-file", "info", { count: unmatched });
  if (memoriesList.status === "present" && mediaCount === 0) note("memories-files-not-found", "info");
  if (partCountKnown && parts.count === 1 && memoriesList.status === "present" && (mediaCount === 0 || unmatched > 0)) note("more-parts-may-exist", "warning");
  const ordered = notes
    .map((n, index) => ({ n, index }))
    .sort((a, b) => SEVERITY_RANK[a.n.severity] - SEVERITY_RANK[b.n.severity] || a.index - b.index)
    .map((x) => x.n);

  // ---- status
  const noReadableParts = parts.count === 0 || parts.unreadable >= parts.count;
  const noFriendsData = friendsSection.status !== "present" && otherFriendRecords === 0;
  const gaps = sections.filter((s) => s.need !== "optional" && s.status !== "present");
  const limited = LIMITED_CODES.some((c) => passed.has(c));
  let status: CheckStatus;
  if (noReadableParts || htmlOnly || noFriendsData) status = "unusable";
  else if (gaps.length > 0 || parts.unreadable > 0 || parts.empty > 0 || limited || friendsSection.status !== "present") status = "incomplete";
  else if (notes.some((n) => n.severity !== "info")) status = "ready-with-notes";
  else status = "ready";

  // ---- what to do, in order
  const todo: CheckAction[] = [];
  const act = (code: string, params: Record<string, ParamValue> = {}): void => void todo.push({ code, params });
  if (parts.count === 0 || noReadableParts) act("add-export-files");
  if (htmlOnly) act("request-json-export");
  if (parts.unreadable > 0 && !noReadableParts) act("reread-parts", { count: parts.unreadable });
  if (parts.count === 1 && notes.some((n) => n.code === "more-parts-may-exist")) act("add-other-parts");
  const toRequest = gaps.filter((s) => s.status === "missing" || s.status === "unreadable").map((s) => s.id);
  if (toRequest.length > 0 && !htmlOnly && !noReadableParts) act("request-sections", { sections: toRequest });
  if (limited) act("choose-all-time");
  if (age.level === "stale" && age.basis === "export-time") act("request-newer-export");
  else if (age.level === "future") act("check-export-date");

  return { status, parts, sections, coverage, age, notes: ordered, todo };
}

function exportAge(input: ExportCheckInput, coverage: ExportCheck["coverage"], hasNow: boolean): ExportAge {
  const unknown: ExportAge = { basis: "none", at: null, ageDays: null, level: "unknown" };
  if (!hasNow) return unknown;
  const exportedAt = input.parsed.exportedAt;
  let basis: ExportAge["basis"] = "none";
  let at: number | null = null;
  if (isUsableTime(exportedAt)) {
    basis = "export-time";
    at = exportedAt;
  } else {
    for (const c of [coverage.chats, coverage.snaps, coverage.memories]) if (c.newest !== null && (at === null || c.newest > at)) at = c.newest;
    if (at !== null) basis = "newest-activity";
  }
  if (at === null) return unknown;
  const diff = input.now - at;
  if (diff < -FUTURE_SLACK_MS) return { basis, at, ageDays: null, level: "future" };
  const ageDays = Math.max(0, Math.floor(diff / DAY_MS));
  return { basis, at, ageDays, level: ageLevel(ageDays) };
}
