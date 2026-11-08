import type { ExportIssue, FriendRecord, ParsedExport } from "../types.ts";
import { DAY_MS } from "../util.ts";
import { issue } from "./json-util.ts";

export interface ValidateHints {
  /** Friend count the user sees in the app, if they told us; used to spot a truncated export. */
  expectedFriendCount?: number;
  /** Epoch ms "now" (injected: core never reads the clock). Used to spot future timestamps when exportedAt is unknown. */
  now?: number;
  /**
   * Go on although the friends list is empty and removed friends are listed (the issue
   * `friends-empty-but-deleted` marks itself `overridable`): it is then a warning, not an error.
   * A front end sets it only when there is no saved history to compare with, because the error
   * protects a comparison between exports, and a first export has nothing to compare.
   */
  allowEmptyFriends?: boolean;
}

const COUNT_MISMATCH_RATIO = 0.05;
const COUNT_MISMATCH_MIN_DIFF = 3;
/** Clock/zone slack: zip times carry no zone, so exportedAt can be off by up to ~a day. */
const FUTURE_SLACK_MS = 2 * DAY_MS;
/** How much newer the oldest current friendship must be than the oldest sent/deleted record to look date-limited. */
const DATE_LIMIT_GAP_MS = 365 * DAY_MS;

const baseName = (p: string): string => p.slice(p.lastIndexOf("/") + 1).toLowerCase();

/**
 * Issue codes that explain, by themselves, why nothing (or not everything) could be read: a part
 * that is not a ZIP, a file inside it that cannot be opened, an export with no JSON files. When
 * one is present the notes that only follow from it ("no friends list", "history not found") are
 * left out, so the person gets one cause and one remedy, not five contradictory notices.
 */
const ROOT_CAUSE_CODES: ReadonlySet<string> = new Set([
  "zip-unreadable", "zip-entry-unreadable", "zip-encrypted", "zip-unsupported-method", "zip-entry-too-large", "nested-zip", "html-only-export",
]);

/** A data file that was found but could not be read as JSON: it explains an empty friends list on its own. */
const JSON_FAILURE_CODES: ReadonlySet<string> = new Set(["json-parse-failed", "json-too-complex", "json-too-large", "zip-json-too-large"]);

/** What went wrong at the root, in the words of what the person should do next. */
export type FailureClass =
  /** The ZIP file is password protected: open it with the password and save it again without one, or request the export again. */
  | "password"
  /** Part of the ZIP files could not be read: download them again. */
  | "unreadable"
  /** The ZIP file holds other ZIP files: unzip it once and choose the parts inside. */
  | "nested-zip"
  /** The export holds only HTML pages: request it again with JSON files. */
  | "html-only";

/**
 * The root cause among `issues` (the parse issues plus the output of validateExport), or
 * undefined when none applies. A password comes first (downloading again would not help), then a
 * damaged file (the first thing to do is to download that file again), then an HTML-only export.
 */
export function failureClass(issues: readonly { code: string }[]): FailureClass | undefined {
  const codes = new Set(issues.map((i) => i.code));
  if (codes.has("zip-encrypted")) return "password";
  for (const code of ["zip-unreadable", "zip-entry-unreadable", "zip-unsupported-method", "zip-entry-too-large"]) {
    if (codes.has(code)) return "unreadable";
  }
  if (codes.has("nested-zip")) return "nested-zip";
  if (codes.has("html-only-export")) return "html-only";
  return undefined;
}

function duplicateCount(list: FriendRecord[]): number {
  const seen = new Set<string>();
  let dupes = 0;
  for (const f of list) {
    if (seen.has(f.username)) dupes++;
    else seen.add(f.username);
  }
  return dupes;
}

function minOf(values: (number | undefined)[]): number | undefined {
  let min: number | undefined;
  for (const v of values) if (v !== undefined && (min === undefined || v < min)) min = v;
  return min;
}

type ExportIssueSource = Pick<ParsedExport, "friends" | "chats" | "memories">;

/** Count timestamps later than `limit` without building intermediate arrays (chat lists are large). */
function countFuture(parsed: ExportIssueSource, limit: number): number {
  let n = 0;
  const check = (t: number | undefined | null): void => {
    if (t !== undefined && t !== null && t > limit) n++;
  };
  const f = parsed.friends;
  for (const list of [f.friends, f.sentRequests, f.pendingRequests, f.blocked, f.ignored, f.hiddenSuggestions]) {
    for (const r of list) {
      check(r.createdAt);
      check(r.modifiedAt);
    }
  }
  for (const r of f.deletedFriends) {
    check(r.createdAt);
    check(r.modifiedAt);
    check(r.deletedAt);
  }
  for (const c of parsed.chats) check(c.at);
  for (const m of parsed.memories) check(m.date);
  return n;
}

/**
 * Whole-export sanity checks. Pure: returns new issues (callers combine them with
 * `parsed.issues`). Messages carry counts only, never usernames or other values.
 */
export function validateExport(parsed: ParsedExport, hints: ValidateHints = {}): ExportIssue[] {
  const out: ExportIssue[] = [];
  const f = parsed.friends;
  const names = parsed.fileList.map(baseName);

  const totalFriendRecords =
    f.friends.length + f.sentRequests.length + f.pendingRequests.length + f.deletedFriends.length +
    f.blocked.length + f.ignored.length + f.hiddenSuggestions.length;

  const hasJson = names.some((n) => n.endsWith(".json"));
  const hasHtml = names.some((n) => n.endsWith(".html"));
  if (hasHtml && !hasJson) {
    out.push(issue("error", "html-only-export", "This export has only HTML files. Request a new export and choose JSON."));
  }

  // One cause, one message: what only follows from it is not reported next to it.
  const explained = (hasHtml && !hasJson) || (parsed.issues ?? []).some((i) => ROOT_CAUSE_CODES.has(i.code));

  const found = parsed.issues ?? [];
  if (totalFriendRecords === 0) {
    const hasFriendsFile = names.includes("friends.json");
    if (explained || (hasFriendsFile && found.some((i) => JSON_FAILURE_CODES.has(i.code)))) {
      // The notice that explains it is already in the list.
    } else if (hasFriendsFile && found.some((i) => i.code === "friends-no-sections" || i.code === "friends-unexpected-shape")) {
      // friends.json is there: asking for the export again would not help, the layout is what Snappy does not know.
      out.push(issue("error", "friends-layout-unknown", "friends.json is in your export, but Snappy does not know its layout. Run the inspect command and share the shape."));
    } else {
      out.push(issue("error", "no-friends-section", "This export has no friends list, so Snappy cannot analyze it. Request it again with User information selected."));
    }
  } else if (f.friends.length === 0 && f.deletedFriends.length > 0) {
    const message = `The friends list is empty, but ${f.deletedFriends.length} removed ${f.deletedFriends.length === 1 ? "friend is" : "friends are"} listed. The export may be incomplete, so results may be wrong.`;
    out.push(hints.allowEmptyFriends === true ? issue("warning", "friends-empty-but-deleted", message) : { ...issue("error", "friends-empty-but-deleted", message), overridable: true });
  }

  const dupes = duplicateCount(f.friends) + duplicateCount(f.sentRequests);
  if (dupes > 0) {
    out.push(issue("warning", "duplicate-usernames", `${dupes} ${dupes === 1 ? "username appears" : "usernames appear"} more than once in your friends or sent requests.`));
  }

  const expected = hints.expectedFriendCount;
  if (expected !== undefined && Number.isFinite(expected) && expected >= 0) {
    const diff = Math.abs(f.friends.length - expected);
    if (diff >= COUNT_MISMATCH_MIN_DIFF && diff > expected * COUNT_MISMATCH_RATIO) {
      out.push(issue("warning", "friend-count-mismatch", `The export has ${f.friends.length} friends, not the ${expected} you expected. A date range may have limited it. Choose “All Time”.`));
    }
  }

  const oldestFriend = minOf(f.friends.map((r) => r.createdAt));
  const oldestOther = minOf([
    ...f.sentRequests.map((r) => r.createdAt),
    ...f.deletedFriends.flatMap((r) => [r.createdAt, r.deletedAt]),
  ]);
  if (oldestFriend !== undefined && oldestOther !== undefined && oldestFriend - oldestOther > DATE_LIMIT_GAP_MS) {
    const years = Math.round(((oldestFriend - oldestOther) / DAY_MS / 365) * 10) / 10;
    out.push(issue("warning", "possibly-date-limited", `Your friendships start ${years} years after your oldest records. A date range may have limited this export. Choose “All Time”.`));
  }

  const reference = parsed.exportedAt ?? hints.now;
  if (reference !== undefined) {
    const future = countFuture(parsed, reference + FUTURE_SLACK_MS);
    if (future > 0) {
      out.push(issue("warning", "future-timestamps", `${future} ${future === 1 ? "date is" : "dates are"} later than the export date, so some dates may be wrong.`));
    }
  }

  if (explained) return out;

  if (parsed.chats.length === 0 && !names.includes("chat_history.json") && !names.includes("saved_chat_history.json")) {
    out.push(issue("info", "chat-history-missing", "No chat history was found, so quiet friends cannot be checked."));
  }
  if (!names.includes("snap_history.json")) {
    out.push(issue("info", "snap-history-missing", "No Snap history was found. Friends you mostly Snap may look quieter than they are."));
  }
  if (parsed.memories.length === 0 && !names.includes("memories_history.json")) {
    out.push(issue("info", "memories-missing", "No Memories list was found, so Memories rescue is not available."));
  }
  return out;
}
