import type { FriendRecord, ParsedFriends } from "../types.ts";
import { normUser } from "../util.ts";

/**
 * Blocked, ignored and hidden suggestion review.
 *
 * Snappy only helps the user LOOK at these three lists: it never blocks, unblocks or changes
 * anything. The result is structured data (counts, dates, stable codes). The CLI and dashboard
 * turn the codes into short, hedged wording ("may be worth a look"), never as facts.
 *
 * Privacy: usernames appear ONLY in `entries` and `conflicts` rows, which exist to list people.
 * Notes and review steps carry codes and counts only.
 *
 * Defaults (all deterministic; time is the `now` parameter, no clock is read):
 *  - An entry's date is its `createdAt`, else its `modifiedAt`.
 *  - A date that is missing, not a positive finite number, or after `now` is not used for
 *    oldest/newest. Future dates are counted apart (`futureCount`) so the UI can hedge.
 *  - The same person listed twice in one list (any letter case) counts once; the oldest valid
 *    date is kept and the extra rows are counted in `caseDuplicates`.
 *  - Entries are ordered oldest first (long-standing choices are the likeliest to be worth a
 *    second look), undated last, ties broken by username.
 *  - A conflict is a person who is in more than one list, or who is also a current friend, a
 *    pending request or a sent request. Review order puts conflicts first, then blocked,
 *    ignored and hidden suggestions, skipping empty lists.
 */

export type ReviewListId = "blocked" | "ignored" | "hiddenSuggestions";
export type ConflictKind = "multiple-lists" | "also-friend" | "also-pending" | "also-sent";

/** The slice of ParsedFriends this module reads. Every list may be absent. */
export type BlockedReviewInput = Partial<
  Pick<ParsedFriends, "blocked" | "ignored" | "hiddenSuggestions" | "friends" | "pendingRequests" | "sentRequests">
>;

export interface ReviewEntry {
  /** Normalised username. */
  username: string;
  /** Usable date (ms), when there is one. */
  at?: number;
  /** Every review list this person is in, in list order. */
  lists: ReviewListId[];
  /** Conflict kinds that apply to this person (empty when none). */
  conflicts: ConflictKind[];
}

export interface ReviewList {
  id: ReviewListId;
  /** People in the list (case duplicates merged). */
  count: number;
  /** Extra rows merged because the same person was listed more than once. */
  caseDuplicates: number;
  oldestAt: number | null;
  newestAt: number | null;
  datedCount: number;
  undatedCount: number;
  /** Entries whose date is after `now`; not used for oldest/newest. */
  futureCount: number;
  entries: ReviewEntry[];
}

export interface ReviewConflict {
  username: string;
  lists: ReviewListId[];
  kinds: ConflictKind[];
}

export interface ReviewStep {
  kind: "conflicts" | "list";
  /** Set when kind is "list". */
  list?: ReviewListId;
  /** Stable code the wording layer maps to a short title. */
  code: "review-conflicts" | "review-blocked" | "review-ignored" | "review-hidden-suggestions";
  count: number;
}

export interface ReviewNote {
  code:
    | "no-entries"
    | "list-empty"
    | "undated-entries"
    | "future-dated-entries"
    | "case-duplicates"
    | "blank-entries"
    | "conflicts-found"
    | "friends-list-empty";
  /** Counts and list ids only; never user data. */
  params: Record<string, number | string>;
}

export interface BlockedReview {
  generatedAt: number;
  /** Always three lists, in the order blocked, ignored, hiddenSuggestions. */
  lists: ReviewList[];
  conflicts: ReviewConflict[];
  reviewOrder: ReviewStep[];
  totals: { people: number; conflicts: number };
  notes: ReviewNote[];
}

const LIST_IDS: readonly ReviewListId[] = ["blocked", "ignored", "hiddenSuggestions"];
const STEP_CODE: Record<ReviewListId, ReviewStep["code"]> = {
  blocked: "review-blocked",
  ignored: "review-ignored",
  hiddenSuggestions: "review-hidden-suggestions",
};

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function validAt(v: number | undefined): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined;
}

function keySet(list: FriendRecord[] | undefined): Set<string> {
  const s = new Set<string>();
  for (const r of list ?? []) {
    const k = normUser(r.username);
    if (k) s.add(k);
  }
  return s;
}

interface Folded {
  at?: number;
  future: boolean;
  rows: number;
}

export function reviewBlocked(input: BlockedReviewInput, opts: { now: number }): BlockedReview {
  const { now } = opts;
  const friends = keySet(input.friends);
  const pending = keySet(input.pendingRequests);
  const sent = keySet(input.sentRequests);

  // Pass 1: fold each list to one row per person.
  const folded = new Map<ReviewListId, Map<string, Folded>>();
  const blankByList = new Map<ReviewListId, number>();
  const membership = new Map<string, ReviewListId[]>();
  for (const id of LIST_IDS) {
    const rows = new Map<string, Folded>();
    let blank = 0;
    for (const r of input[id] ?? []) {
      const key = normUser(r.username);
      if (!key) {
        blank++;
        continue;
      }
      const raw = validAt(r.createdAt) ?? validAt(r.modifiedAt);
      const future = raw !== undefined && raw > now;
      const at = raw !== undefined && !future ? raw : undefined;
      const prev = rows.get(key);
      if (!prev) {
        rows.set(key, { at, future, rows: 1 });
        const m = membership.get(key);
        if (m) m.push(id);
        else membership.set(key, [id]);
      } else {
        prev.rows++;
        if (at !== undefined && (prev.at === undefined || at < prev.at)) prev.at = at;
        // A usable date wins over a future one for the same person.
        prev.future = prev.at === undefined && (prev.future || future);
      }
    }
    folded.set(id, rows);
    blankByList.set(id, blank);
  }

  // Conflicts, once per person.
  const conflicts: ReviewConflict[] = [];
  const conflictKinds = new Map<string, ConflictKind[]>();
  for (const [key, lists] of membership) {
    const kinds: ConflictKind[] = [];
    if (lists.length > 1) kinds.push("multiple-lists");
    if (friends.has(key)) kinds.push("also-friend");
    if (pending.has(key)) kinds.push("also-pending");
    if (sent.has(key)) kinds.push("also-sent");
    conflictKinds.set(key, kinds);
    if (kinds.length) conflicts.push({ username: key, lists, kinds });
  }
  conflicts.sort((a, b) => cmp(a.username, b.username));

  // Pass 2: build the list rows.
  const lists: ReviewList[] = [];
  for (const id of LIST_IDS) {
    const rows = folded.get(id)!;
    const entries: ReviewEntry[] = [];
    let oldestAt: number | null = null;
    let newestAt: number | null = null;
    let dated = 0;
    let future = 0;
    let dupes = 0;
    for (const [username, f] of rows) {
      dupes += f.rows - 1;
      if (f.at !== undefined) {
        dated++;
        if (oldestAt === null || f.at < oldestAt) oldestAt = f.at;
        if (newestAt === null || f.at > newestAt) newestAt = f.at;
      } else if (f.future) future++;
      entries.push({
        username,
        ...(f.at !== undefined ? { at: f.at } : {}),
        lists: membership.get(username)!,
        conflicts: conflictKinds.get(username)!,
      });
    }
    entries.sort((a, b) => {
      if (a.at !== undefined && b.at !== undefined && a.at !== b.at) return a.at - b.at;
      if ((a.at === undefined) !== (b.at === undefined)) return a.at === undefined ? 1 : -1;
      return cmp(a.username, b.username);
    });
    lists.push({
      id,
      count: entries.length,
      caseDuplicates: dupes,
      oldestAt,
      newestAt,
      datedCount: dated,
      undatedCount: entries.length - dated - future,
      futureCount: future,
      entries,
    });
  }

  const reviewOrder: ReviewStep[] = [];
  if (conflicts.length) reviewOrder.push({ kind: "conflicts", code: "review-conflicts", count: conflicts.length });
  for (const l of lists) {
    if (l.count) reviewOrder.push({ kind: "list", list: l.id, code: STEP_CODE[l.id], count: l.count });
  }

  const notes: ReviewNote[] = [];
  const total = lists.reduce((n, l) => n + l.count, 0);
  if (total === 0) notes.push({ code: "no-entries", params: {} });
  for (const l of lists) {
    if (l.count === 0 && total > 0) notes.push({ code: "list-empty", params: { list: l.id } });
    if (l.undatedCount) notes.push({ code: "undated-entries", params: { list: l.id, count: l.undatedCount } });
    if (l.futureCount) notes.push({ code: "future-dated-entries", params: { list: l.id, count: l.futureCount } });
    if (l.caseDuplicates) notes.push({ code: "case-duplicates", params: { list: l.id, count: l.caseDuplicates } });
    const blank = blankByList.get(l.id) ?? 0;
    if (blank) notes.push({ code: "blank-entries", params: { list: l.id, count: blank } });
  }
  if (conflicts.length) notes.push({ code: "conflicts-found", params: { count: conflicts.length } });
  // An empty friends list may mean a date-limited export, so "also a friend" checks say little.
  if (total > 0 && friends.size === 0) notes.push({ code: "friends-list-empty", params: {} });

  return {
    generatedAt: now,
    lists,
    conflicts,
    reviewOrder,
    totals: { people: membership.size, conflicts: conflicts.length },
    notes,
  };
}
