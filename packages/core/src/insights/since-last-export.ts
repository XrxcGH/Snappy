/**
 * Since your last export: what changed between the export in hand and the one saved before it.
 *
 * Inputs are the two friend-list snapshots (the current one is `snapshotFromExport(parsed)`, the
 * previous one comes from the decrypted history, see ledger/ledger.ts), plus optional metadata of the
 * current export: chat and Snap events and Memories. Nothing else is read. There is no field for
 * message text, names, places or the login history.
 *
 * Reuse: friends added, friends no longer listed, user deletions and requests accepted or vanished
 * all come from `diffSnapshots` (ledger/ledger.ts), so the wording of "no longer listed" matches the
 * ghost finder: the person may have removed you, or been removed, or closed the account. Someone the
 * USER blocked is split out, as findGhosts does.
 *
 * Pure and deterministic: no clock (take `now`), no I/O, no logging. Linear in the input.
 *
 * Privacy: usernames appear only in the deliberate rows (`friends.*`, `requests.*`). Counts, dates
 * and notes never hold one, and a note is a stable code plus numbers, never text.
 *
 * Defaults (documented here, none hidden):
 *  - Days between exports are CALENDAR days in `utcOffsetMinutes` (default 0, clamped to -720..840,
 *    rounded; a non-finite value means 0). Two exports on the same local day are 0 days apart.
 *  - If `previous` is newer than `current` the two are swapped and noted, so "since" always reads forward.
 *    The events and Memories belong to the export passed as `current`, which is then the OLDER one, so
 *    the period they would be measured against is one in which that export did not exist. Activity and
 *    Memories are therefore withheld (null) when the order was swapped; friends and requests still show.
 *  - New Memories are those whose capture date falls after the previous export and up to the current
 *    one. Capture dates, not upload dates: a photo imported later with an old date is not "new".
 *    Memories with no date, or a date after `now`, are left out and counted.
 *  - Activity compares the period since the previous export with the period of equal length just
 *    before it, using the current export's events. When the events do not reach back that far, the
 *    comparison is withheld (the counts since the last export are still given). Events with
 *    direction "unknown" are counted apart and never as sent or received. Group chats are included
 *    (counts only, there are no names in the result). Events with a missing time or a time after
 *    `now` are left out and counted.
 *  - More than half of a friend list (and at least 10 people) vanishing at once looks like a partial
 *    export, so it is noted (the same 50% the ghost finder uses).
 *  - A gap of 180 days or more is noted: anyone listed as gone may have left at any point in it.
 *  - "Still pending": a request in the previous snapshot that is neither a friend in the previous
 *    snapshot nor in the current one, and is still among the current sent requests.
 */
import type { Snapshot } from "../types.ts";
import { DAY_MS, normUser } from "../util.ts";
import { diffSnapshots } from "../ledger/ledger.ts";

export const SINCE_LAST_DEFAULTS = {
  /** A gap this long (calendar days) or longer gets the "long-gap" note. */
  longGapDays: 180,
  /** A friend list losing more than this share at once looks like a partial export... */
  massShare: 0.5,
  /** ...but only when the previous list had at least this many friends. */
  massMinFriends: 10,
} as const;

const MINUTE_MS = 60_000;
const MIN_OFFSET = -720;
const MAX_OFFSET = 840;

/** The only fields read from an event. A ChatEvent fits as is. */
export interface SinceEvent {
  direction?: string | null;
  /** Epoch ms. */
  at?: number | null;
}

/** The only field read from a Memory. A MemoryItem fits as is. */
export interface SinceMemory {
  /** Capture date, epoch ms; null or missing when unknown. */
  date?: number | null;
}

export interface SinceLastExportInput {
  /** The saved snapshot of the previous export. Absent on a first export. */
  previous?: Snapshot;
  /** The snapshot of the export in hand. */
  current: Snapshot;
  /** Snapshots taken between the two, whose deletion lists also explain disappearances. */
  between?: readonly Snapshot[];
  /** Metadata events of the current export (saved chats and Snaps). Withheld from the result if the snapshots had to be swapped. */
  events?: readonly SinceEvent[];
  /** Memories of the current export. Withheld from the result if the snapshots had to be swapped. */
  memories?: readonly SinceMemory[];
  /**
   * Memories count of the previous export, if the history ever records it (it does not yet; see
   * the report). Used only to show the change in the total.
   */
  previousMemoriesTotal?: number;
  /** Epoch ms "now". Required: nothing in core reads the clock. */
  now: number;
  /** Minutes east of UTC for calendar days. Default 0. */
  utcOffsetMinutes?: number;
}

/** One person in a list. `at` is the date named in the list's comment, or null when unknown. */
export interface SincePerson {
  username: string;
  at: number | null;
}

export interface SinceFriends {
  previousCount: number;
  currentCount: number;
  net: number;
  /** New friends. `at`: when the friendship began, if the export says. */
  added: SincePerson[];
  /** Listed before, not now, and not explained by you. They may have removed you or been removed. `at`: friends since. */
  disappeared: SincePerson[];
  /** Gone because you removed them. `at`: when you did. */
  removedByYou: SincePerson[];
  /** Gone from the friend list because you blocked them (not a sign they removed you). */
  blockedByYou: SincePerson[];
}

export interface SinceRequests {
  /** Requests you sent that became friends. `at`: when you sent it. */
  accepted: SincePerson[];
  /** Requests still waiting. `at`: when you sent it. */
  stillPending: SincePerson[];
  /** Requests that disappeared without becoming friends and without your action; they may have been declined. */
  vanished: SincePerson[];
}

export interface SinceMemories {
  total: number;
  /** Memories captured after the previous export, up to the current one. */
  newCount: number;
  /** Change in the total against the previous export; null when that total is unknown. */
  totalChange: number | null;
}

export interface DirectionCounts {
  sent: number;
  received: number;
  unknown: number;
}

export interface SinceActivity {
  /** Events after the previous export, up to the current one. */
  since: DirectionCounts;
  /** Events in the equal-length period before the previous export; null when the events do not reach back that far. */
  earlier: DirectionCounts | null;
  /** since minus earlier; null with `earlier`. */
  change: { sent: number; received: number } | null;
}

export type SinceNoteCode =
  | "no-previous-export" //          first export: nothing to compare
  | "unusable-snapshot-time" //      a snapshot has no usable time
  | "order-swapped" //               the "previous" snapshot was newer
  | "same-time" //                   both snapshots share one time: no period to measure
  | "same-day" //                    exported on the same calendar day
  | "long-gap" //                    {days}
  | "snapshot-time-in-future" //     {count}
  | "friends-may-have-left" //       {count}: removed you, were removed, or closed the account
  | "possible-partial-export" //     {count, previous}: too many gone at once
  | "blocked-excluded" //            {count}: gone because you blocked them
  | "requests-may-be-declined" //    {count}
  | "no-activity-data" //            no chat or Snap events
  | "earlier-period-not-covered" //  the events do not reach back before the previous export
  | "unusable-times-ignored" //      {count}: events with a missing or future time
  | "no-memories-data" //            no Memories to count
  | "memories-dates-unusable"; //    {undated, future}

export interface SinceNote {
  code: SinceNoteCode;
  params: Record<string, number>;
}

export interface SinceLastExport {
  /** False when there is nothing to compare (no previous export, or a snapshot without a time). */
  comparable: boolean;
  /** Times of the older and newer snapshot, epoch ms; null when not comparable. */
  previousAt: number | null;
  currentAt: number | null;
  /** Calendar days between them in the given offset; null when not comparable. */
  daysBetween: number | null;
  friends: SinceFriends | null;
  requests: SinceRequests | null;
  /** Null when no Memories were given. */
  memories: SinceMemories | null;
  /** Null when there are no events or no period to measure. */
  activity: SinceActivity | null;
  /** Every count in one place, for a one-line summary. Unknown ones are null. */
  counts: {
    added: number | null;
    disappeared: number | null;
    removedByYou: number | null;
    requestsAccepted: number | null;
    requestsPending: number | null;
    newMemories: number | null;
  };
  notes: SinceNote[];
}

// ------------------------------------------------------------------ helpers ---

const isTime = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function resolveOffset(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) return 0;
  return Math.min(MAX_OFFSET, Math.max(MIN_OFFSET, Math.round(requested)));
}

function keys(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const out = new Set<string>();
  for (const item of list) {
    if (typeof item !== "string") continue;
    const key = normUser(item);
    if (key !== "") out.add(key);
  }
  return [...out];
}

/** Re-key a record by normalised username; `merge` settles two spellings of one name. */
function rekey<T>(rec: unknown, merge: (a: T, b: T) => T): Record<string, T> {
  const map = new Map<string, T>();
  if (typeof rec === "object" && rec !== null) {
    for (const [name, value] of Object.entries(rec as Record<string, T>)) {
      const key = normUser(name);
      if (key === "") continue;
      map.set(key, map.has(key) ? merge(map.get(key) as T, value) : value);
    }
  }
  return Object.fromEntries(map);
}

const earliest = (a: number | undefined, b: number | undefined) => (a === undefined ? b : b === undefined ? a : Math.min(a, b));
const latestKnown = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.max(a, b));

/** A copy with every username normalised, so case-different duplicates cannot split or double count. */
function tidy(s: Snapshot): Snapshot {
  const blocked = keys(s.blocked);
  return {
    id: s.id,
    takenAt: s.takenAt,
    source: s.source,
    friends: keys(s.friends),
    sentRequests: keys(s.sentRequests),
    deleted: rekey<number | null>(s.deleted, latestKnown),
    friendSince: rekey<number | undefined>(s.friendSince, earliest),
    sentAt: rekey<number | undefined>(s.sentAt, earliest),
    ...(blocked.length > 0 ? { blocked } : {}),
  };
}

const byName = (a: SincePerson, b: SincePerson) => (a.username < b.username ? -1 : a.username > b.username ? 1 : 0);

function people(names: readonly string[], when: (key: string) => number | null | undefined): SincePerson[] {
  return names.map((username) => ({ username, at: when(username) ?? null })).sort(byName);
}

function lookup<T>(rec: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(rec, key) ? rec[key] : undefined;
}

function emptyResult(notes: SinceNote[], currentAt: number | null): SinceLastExport {
  return {
    comparable: false,
    previousAt: null,
    currentAt,
    daysBetween: null,
    friends: null,
    requests: null,
    memories: null,
    activity: null,
    counts: { added: null, disappeared: null, removedByYou: null, requestsAccepted: null, requestsPending: null, newMemories: null },
    notes,
  };
}

// --------------------------------------------------------------------- main ---

export function sinceLastExport(input: SinceLastExportInput): SinceLastExport {
  if (!isTime(input.now)) throw new TypeError("sinceLastExport: now must be a finite epoch ms value.");
  const now = input.now;
  const offsetMs = resolveOffset(input.utcOffsetMinutes) * MINUTE_MS;
  const notes: SinceNote[] = [];
  const note = (code: SinceNoteCode, params: Record<string, number> = {}) => notes.push({ code, params });

  if (!input.previous) {
    note("no-previous-export");
    return emptyResult(notes, isTime(input.current?.takenAt) ? input.current.takenAt : null);
  }
  if (!isTime(input.previous.takenAt) || !isTime(input.current?.takenAt)) {
    note("unusable-snapshot-time");
    return emptyResult(notes, isTime(input.current?.takenAt) ? input.current.takenAt : null);
  }

  // Oldest first, whatever the caller passed.
  let older = tidy(input.previous);
  let newer = tidy(input.current);
  let swapped = false;
  if (older.takenAt > newer.takenAt) {
    [older, newer] = [newer, older];
    swapped = true;
    note("order-swapped");
  }
  const prevAt = older.takenAt;
  const curAt = newer.takenAt;
  const span = curAt - prevAt;
  const daysBetween = Math.floor((curAt + offsetMs) / DAY_MS) - Math.floor((prevAt + offsetMs) / DAY_MS);

  if (span === 0) note("same-time");
  else if (daysBetween === 0) note("same-day");
  if (daysBetween >= SINCE_LAST_DEFAULTS.longGapDays) note("long-gap", { days: daysBetween });
  const inFuture = (prevAt > now ? 1 : 0) + (curAt > now ? 1 : 0);
  if (inFuture > 0) note("snapshot-time-in-future", { count: inFuture });

  // ---- friends and requests, from the existing diff ----
  const between = (input.between ?? []).map(tidy);
  const diff = diffSnapshots(older, newer, between);
  const blockedNow = new Set<string>([...(newer.blocked ?? []), ...between.flatMap((s) => s.blocked ?? [])]);
  const gone = diff.disappeared.filter((k) => !blockedNow.has(k));
  const blockedGone = diff.disappeared.filter((k) => blockedNow.has(k));

  const deletedAt = (k: string) => {
    for (const s of [newer, ...between]) {
      const v = lookup(s.deleted, k);
      if (typeof v === "number") return v;
    }
    return null;
  };
  const sentAt = (k: string) => earliest(lookup(older.sentAt, k), lookup(newer.sentAt, k));

  const friends: SinceFriends = {
    previousCount: older.friends.length,
    currentCount: newer.friends.length,
    net: newer.friends.length - older.friends.length,
    added: people(diff.added, (k) => lookup(newer.friendSince, k)),
    disappeared: people(gone, (k) => lookup(older.friendSince, k)),
    removedByYou: people(diff.removedByUser, deletedAt),
    blockedByYou: people(blockedGone, (k) => lookup(older.friendSince, k)),
  };

  const olderFriends = new Set(older.friends);
  const newerFriends = new Set(newer.friends);
  const newerSent = new Set(newer.sentRequests);
  const pending = older.sentRequests.filter((k) => !olderFriends.has(k) && !newerFriends.has(k) && newerSent.has(k));
  const requests: SinceRequests = {
    accepted: people(diff.requestsAccepted, sentAt),
    stillPending: people(pending, sentAt),
    vanished: people(diff.requestsVanished, sentAt),
  };

  if (gone.length > 0) note("friends-may-have-left", { count: gone.length });
  if (
    older.friends.length >= SINCE_LAST_DEFAULTS.massMinFriends &&
    diff.disappeared.length / older.friends.length > SINCE_LAST_DEFAULTS.massShare
  ) {
    note("possible-partial-export", { count: diff.disappeared.length, previous: older.friends.length });
  }
  if (blockedGone.length > 0) note("blocked-excluded", { count: blockedGone.length });
  if (requests.vanished.length > 0) note("requests-may-be-declined", { count: requests.vanished.length });

  // ---- Memories: counted by capture date ----
  let memories: SinceMemories | null = null;
  if (!input.memories || input.memories.length === 0) {
    note("no-memories-data");
  } else if (!swapped) {
    let newCount = 0;
    let undated = 0;
    let future = 0;
    for (const m of input.memories) {
      const d = m?.date;
      if (!isTime(d)) undated++;
      else if (d > now) future++;
      else if (d > prevAt && d <= curAt) newCount++;
    }
    const prevTotal = input.previousMemoriesTotal;
    memories = {
      total: input.memories.length,
      newCount,
      totalChange: typeof prevTotal === "number" && Number.isFinite(prevTotal) ? input.memories.length - prevTotal : null,
    };
    if (undated + future > 0) note("memories-dates-unusable", { undated, future });
  }

  // ---- activity: since the previous export against the period of equal length before it ----
  let activity: SinceActivity | null = null;
  if (!input.events || input.events.length === 0) {
    note("no-activity-data");
  } else if (span > 0 && !swapped) {
    const since = new Uint32Array(3); // sent, received, unknown
    const before = new Uint32Array(3);
    const earlierStart = prevAt - span;
    let first = Infinity;
    let unusable = 0;
    for (const e of input.events) {
      const at = e?.at;
      if (!isTime(at) || at > now) {
        unusable++;
        continue;
      }
      if (at < first) first = at;
      const slot = e.direction === "sent" ? 0 : e.direction === "received" ? 1 : 2;
      if (at > prevAt && at <= curAt) since[slot]!++;
      else if (at > earlierStart && at <= prevAt) before[slot]!++;
    }
    if (unusable > 0) note("unusable-times-ignored", { count: unusable });
    const counts = (a: Uint32Array): DirectionCounts => ({ sent: a[0]!, received: a[1]!, unknown: a[2]! });
    const reaches = first <= earlierStart;
    if (!reaches) note("earlier-period-not-covered");
    const sinceCounts = counts(since);
    const earlier = reaches ? counts(before) : null;
    activity = {
      since: sinceCounts,
      earlier,
      change: earlier ? { sent: sinceCounts.sent - earlier.sent, received: sinceCounts.received - earlier.received } : null,
    };
  }

  return {
    comparable: true,
    previousAt: prevAt,
    currentAt: curAt,
    daysBetween,
    friends,
    requests,
    memories,
    activity,
    counts: {
      added: friends.added.length,
      disappeared: friends.disappeared.length,
      removedByYou: friends.removedByYou.length,
      requestsAccepted: requests.accepted.length,
      requestsPending: requests.stillPending.length,
      newMemories: memories ? memories.newCount : null,
    },
    notes,
  };
}
