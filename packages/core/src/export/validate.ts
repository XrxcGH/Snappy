import type { ExportIssue, FriendRecord, ParsedExport } from "../types.ts";
import { DAY_MS } from "../util.ts";
import { issue } from "./json-util.ts";

export interface ValidateHints {
  /** Friend count the user sees in the app, if they told us; used to spot a truncated export. */
  expectedFriendCount?: number;
  /** Epoch ms "now" (injected: core never reads the clock). Used to spot future timestamps when exportedAt is unknown. */
  now?: number;
}

const COUNT_MISMATCH_RATIO = 0.05;
const COUNT_MISMATCH_MIN_DIFF = 3;
/** Clock/zone slack: zip times carry no zone, so exportedAt can be off by up to ~a day. */
const FUTURE_SLACK_MS = 2 * DAY_MS;
/** How much newer the oldest current friendship must be than the oldest sent/deleted record to look date-limited. */
const DATE_LIMIT_GAP_MS = 365 * DAY_MS;

const baseName = (p: string): string => p.slice(p.lastIndexOf("/") + 1).toLowerCase();

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
    out.push(issue("error", "html-only-export", "This export contains only HTML files. Request a new export from Snapchat and choose the JSON format, then try again."));
  }

  if (totalFriendRecords === 0) {
    out.push(issue("error", "no-friends-section", "No friend list was found in this export, so nothing can be analyzed. Re-request the export in JSON format and make sure Friends is included."));
  } else if (f.friends.length === 0 && f.deletedFriends.length > 0) {
    out.push(issue("error", "friends-empty-but-deleted", `The friends list is empty but ${f.deletedFriends.length} deleted friend${f.deletedFriends.length === 1 ? " is" : "s are"} listed. The export is probably incomplete; do not trust results from it.`));
  }

  const dupes = duplicateCount(f.friends) + duplicateCount(f.sentRequests);
  if (dupes > 0) {
    out.push(issue("warning", "duplicate-usernames", `${dupes} duplicate username${dupes === 1 ? "" : "s"} found within the friends or sent-request lists.`));
  }

  const expected = hints.expectedFriendCount;
  if (expected !== undefined && Number.isFinite(expected) && expected >= 0) {
    const diff = Math.abs(f.friends.length - expected);
    if (diff >= COUNT_MISMATCH_MIN_DIFF && diff > expected * COUNT_MISMATCH_RATIO) {
      out.push(issue("warning", "friend-count-mismatch", `The export lists ${f.friends.length} friends but ${expected} were expected. A date range chosen when the export was requested may have truncated the friends list; re-request it with "All Time" before trusting any results.`));
    }
  }

  const oldestFriend = minOf(f.friends.map((r) => r.createdAt));
  const oldestOther = minOf([
    ...f.sentRequests.map((r) => r.createdAt),
    ...f.deletedFriends.flatMap((r) => [r.createdAt, r.deletedAt]),
  ]);
  if (oldestFriend !== undefined && oldestOther !== undefined && oldestFriend - oldestOther > DATE_LIMIT_GAP_MS) {
    const years = Math.round(((oldestFriend - oldestOther) / DAY_MS / 365) * 10) / 10;
    out.push(issue("warning", "possibly-date-limited", `The oldest current friendship is about ${years} years newer than the oldest sent or deleted record. The export may have been limited to a date range; re-request it with "All Time".`));
  }

  const reference = parsed.exportedAt ?? hints.now;
  if (reference !== undefined) {
    const future = countFuture(parsed, reference + FUTURE_SLACK_MS);
    if (future > 0) {
      out.push(issue("warning", "future-timestamps", `${future} timestamp${future === 1 ? " is" : "s are"} later than the export date; the data or its dates may be unreliable.`));
    }
  }

  if (parsed.chats.length === 0 && !names.includes("chat_history.json")) {
    out.push(issue("info", "chat-history-missing", "No chat history file was found; reply and one-way analysis will be unavailable."));
  }
  if (!names.includes("snap_history.json")) {
    out.push(issue("info", "snap-history-missing", "No Snap history file was found, so Snaps are not counted and friends you mostly Snap may look quieter than they are."));
  }
  if (parsed.memories.length === 0 && !names.includes("memories_history.json")) {
    out.push(issue("info", "memories-missing", "No Memories file was found; Memories rescue will be unavailable."));
  }
  return out;
}
