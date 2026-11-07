import type { ChatEvent, FriendRecord, ParsedExport } from "../types.ts";
import { DAY_MS, normUser } from "../util.ts";

/**
 * Closest and fading friends.
 *
 * Both lists come from saved chats and Snaps only (the same events `findDormant` reads), so they
 * describe the export, not the friendship. Only one-to-one events with current friends count.
 *
 *  - Closest: a transparent recent-activity score. Every event in the recent window (default 90
 *    days) adds a weight that halves every `halfLifeDays` (default 30), whatever its direction.
 *    The score is the sum of those weights, shown split by direction so a screen can explain it.
 *  - Fading: friends with enough activity in the window before the recent one (days 90 to 180
 *    back by default) whose recent volume fell by at least `minDropFraction` (default 0.6, so
 *    the recent window holds 40% or less of the earlier count).
 *
 * Time is measured back from the earlier of `now` and `exportedAt`, like the quiet-friends check,
 * so an old export is not read as a long silence. Pure and deterministic: no clock, no I/O.
 */

export interface ClosestFadingOptions {
  /** Epoch ms "now" (injected for determinism). */
  now: number;
  /** Length of each of the two windows in days. Default 90. */
  windowDays?: number;
  /** Days after which an event counts half as much in the score. Default 30. */
  halfLifeDays?: number;
  /** Most friends in the closest list. Default 10. */
  topCount?: number;
  /** Fewest recent events to appear in the closest list. Default 3. */
  minClosestEvents?: number;
  /** Fewest events in the earlier window for a friend to count as "was active". Default 8. */
  minEarlierEvents?: number;
  /** Smallest drop (0..1) from the earlier to the recent window to count as fading. Default 0.6. */
  minDropFraction?: number;
}

/** The slice of a parsed export this module reads (a `ParsedExport` fits as is). */
export interface ClosestFadingInput {
  friends: { friends: FriendRecord[] };
  chats: ChatEvent[];
  exportedAt?: ParsedExport["exportedAt"];
}

export interface ClosestFadingSettings {
  windowDays: number;
  halfLifeDays: number;
  topCount: number;
  minClosestEvents: number;
  minEarlierEvents: number;
  minDropFraction: number;
}

export const DEFAULT_CLOSEST_FADING_SETTINGS: Readonly<ClosestFadingSettings> = {
  windowDays: 90,
  halfLifeDays: 30,
  topCount: 10,
  minClosestEvents: 3,
  minEarlierEvents: 8,
  minDropFraction: 0.6,
};

/** Score parts by direction; `score` is their sum, so a screen can show where it came from. */
export interface ClosestFriend {
  /** Normalised username (listed on purpose: this row is about a person). */
  key: string;
  /** 1-based position in the closest list. */
  rank: number;
  /** Sum of the recency weights of all recent events. Higher means more recent activity. */
  score: number;
  /** score divided by the top score, 0..1, for bars. */
  relativeScore: number;
  /** Events in the recent window, by direction. */
  events: { total: number; sent: number; received: number; unknown: number };
  /** The score split by direction (the three add up to `score`, to within rounding of about 1e-6). */
  weighted: { sent: number; received: number; unknown: number };
  /** Time of the newest event in the recent window. */
  lastAt: number;
}

export interface FadingFriend {
  key: string;
  earlierEvents: number;
  recentEvents: number;
  /** 1 - recent / earlier, 0..1. 1 means no events in the recent window. */
  dropFraction: number;
  /** True when the recent window has no events at all. */
  stopped: boolean;
  /** Newest event time in either window; the earlier window has events, so it is always set. */
  lastAt: number;
}

/**
 * Stable note codes (params hold counts and numbers only, never user data):
 *  - invalid-reference-time: `now` was not a finite number (a bad export date is ignored); nothing was computed.
 *  - no-activity-data: the export has no chat or Snap events at all.
 *  - no-one-to-one-activity: it has events, but none is one-to-one (all are group events).
 *  - measured-to-export-date {daysBeforeNow}: the export is older than `now`; windows end at it.
 *  - history-starts-inside-earlier-window: the oldest event of a current friend is newer than the
 *    earlier window's start, so earlier counts may be too low and fewer friends can show as
 *    fading. Events with people who are not friends do not count towards this.
 *  - future-events-ignored {count}, undated-events-ignored {count}: events with no usable time.
 *  - non-friend-events-ignored {count}: one-to-one events with people not on the friends list.
 */
export type ClosestFadingNoteCode =
  | "invalid-reference-time"
  | "no-activity-data"
  | "no-one-to-one-activity"
  | "measured-to-export-date"
  | "history-starts-inside-earlier-window"
  | "future-events-ignored"
  | "undated-events-ignored"
  | "non-friend-events-ignored";

export interface ClosestFadingNote {
  code: ClosestFadingNoteCode;
  params: Record<string, number>;
}

export interface ClosestFadingResult {
  /** The moment the windows end at. */
  asOf: number;
  /** What the result rests on, so wording can hedge: the export holds saved chats and Snaps only. */
  basis: "saved-chats-and-snaps";
  settings: ClosestFadingSettings;
  /** Highest score first; ties by more events, then username. */
  closest: ClosestFriend[];
  /** Biggest drop first; ties by more earlier events, then username. */
  fading: FadingFriend[];
  notes: ClosestFadingNote[];
  counts: {
    friends: number;
    /** Friends with at least one event in the recent window. */
    withRecentActivity: number;
    /** Events of current friends inside the two windows. */
    eventsUsed: number;
  };
}

interface Acc {
  recent: number;
  earlier: number;
  sent: number;
  received: number;
  unknown: number;
  wSent: number;
  wReceived: number;
  wUnknown: number;
  /** Newest event per window (-Infinity if none). */
  lastRecent: number;
  lastEarlier: number;
}

function newAcc(): Acc {
  return {
    recent: 0, earlier: 0, sent: 0, received: 0, unknown: 0,
    wSent: 0, wReceived: 0, wUnknown: 0, lastRecent: -Infinity, lastEarlier: -Infinity,
  };
}

function positive(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}

/** A whole number of at least 1: a fraction such as 0.5 must not floor to 0 and pass everyone. */
function positiveInt(value: number | undefined, fallback: number): number {
  return Math.max(1, Math.floor(positive(value, fallback)));
}

/** Scores are sums of floats; rounding keeps results identical whatever order events arrive in. */
function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function findClosestAndFading(input: ClosestFadingInput, opts: ClosestFadingOptions): ClosestFadingResult {
  const d = DEFAULT_CLOSEST_FADING_SETTINGS;
  const settings: ClosestFadingSettings = {
    windowDays: positive(opts.windowDays, d.windowDays),
    halfLifeDays: positive(opts.halfLifeDays, d.halfLifeDays),
    topCount: positiveInt(opts.topCount, d.topCount),
    minClosestEvents: positiveInt(opts.minClosestEvents, d.minClosestEvents),
    minEarlierEvents: positiveInt(opts.minEarlierEvents, d.minEarlierEvents),
    minDropFraction: Math.min(1, positive(opts.minDropFraction, d.minDropFraction)),
  };
  const notes: ClosestFadingNote[] = [];
  // A missing or non-finite export date is ignored; only an invalid `now` makes the result invalid.
  const exportedAt = typeof input.exportedAt === "number" && Number.isFinite(input.exportedAt) ? input.exportedAt : opts.now;
  const asOf = Math.min(opts.now, exportedAt);
  const empty = (friends: number): ClosestFadingResult => ({
    asOf: Number.isFinite(asOf) ? asOf : 0,
    basis: "saved-chats-and-snaps",
    settings,
    closest: [],
    fading: [],
    notes,
    counts: { friends, withRecentActivity: 0, eventsUsed: 0 },
  });

  if (!Number.isFinite(asOf)) {
    notes.push({ code: "invalid-reference-time", params: {} });
    return empty(0);
  }
  if (asOf < opts.now) {
    notes.push({ code: "measured-to-export-date", params: { daysBeforeNow: Math.floor((opts.now - asOf) / DAY_MS) } });
  }

  // Current friends, de-duplicated by normalised name (case-only duplicates are one friend).
  const accs = new Map<string, Acc>();
  for (const f of input.friends.friends) {
    const key = normUser(f.username);
    if (key && !accs.has(key)) accs.set(key, newAcc());
  }
  if (input.chats.length === 0) {
    notes.push({ code: "no-activity-data", params: {} });
    return empty(accs.size);
  }

  const windowMs = settings.windowDays * DAY_MS;
  const halfLifeMs = settings.halfLifeDays * DAY_MS;
  const earlierStart = asOf - 2 * windowMs;
  const recentStart = asOf - windowMs;
  let future = 0;
  let undated = 0;
  let nonFriend = 0;
  let oneToOne = 0;
  let used = 0;
  let earliestUsable = Infinity;

  // One pass over the events.
  for (const e of input.chats) {
    if (e.isGroup || e.conversation.startsWith("group:")) continue;
    oneToOne++;
    if (typeof e.at !== "number" || !Number.isFinite(e.at)) {
      undated++;
      continue;
    }
    if (e.at > asOf) {
      future++;
      continue;
    }
    const acc = accs.get(normUser(e.conversation));
    if (!acc) {
      nonFriend++;
      continue;
    }
    if (e.at < earliestUsable) earliestUsable = e.at;
    if (e.at <= earlierStart) continue;
    used++;
    if (e.at <= recentStart) {
      acc.earlier++;
      if (e.at > acc.lastEarlier) acc.lastEarlier = e.at;
      continue;
    }
    const w = Math.pow(0.5, (asOf - e.at) / halfLifeMs);
    acc.recent++;
    if (e.at > acc.lastRecent) acc.lastRecent = e.at;
    if (e.direction === "sent") {
      acc.sent++;
      acc.wSent += w;
    } else if (e.direction === "received") {
      acc.received++;
      acc.wReceived += w;
    } else {
      acc.unknown++;
      acc.wUnknown += w;
    }
  }

  if (oneToOne === 0) notes.push({ code: "no-one-to-one-activity", params: {} });
  if (future > 0) notes.push({ code: "future-events-ignored", params: { count: future } });
  if (undated > 0) notes.push({ code: "undated-events-ignored", params: { count: undated } });
  if (nonFriend > 0) notes.push({ code: "non-friend-events-ignored", params: { count: nonFriend } });
  if (earliestUsable !== Infinity && earliestUsable > earlierStart) {
    notes.push({ code: "history-starts-inside-earlier-window", params: {} });
  }

  const rows: Omit<ClosestFriend, "rank" | "relativeScore">[] = [];
  const fading: FadingFriend[] = [];
  let withRecentActivity = 0;
  for (const [key, a] of accs) {
    if (a.recent > 0) withRecentActivity++;
    if (a.recent >= settings.minClosestEvents) {
      rows.push({
        key,
        score: round6(a.wSent + a.wReceived + a.wUnknown),
        events: { total: a.recent, sent: a.sent, received: a.received, unknown: a.unknown },
        weighted: { sent: round6(a.wSent), received: round6(a.wReceived), unknown: round6(a.wUnknown) },
        lastAt: a.lastRecent,
      });
    }
    if (a.earlier >= settings.minEarlierEvents) {
      const drop = 1 - a.recent / a.earlier;
      if (drop >= settings.minDropFraction) {
        fading.push({
          key,
          earlierEvents: a.earlier,
          recentEvents: a.recent,
          dropFraction: round6(drop),
          stopped: a.recent === 0,
          lastAt: Math.max(a.lastRecent, a.lastEarlier),
        });
      }
    }
  }

  rows.sort((x, y) => y.score - x.score || y.events.total - x.events.total || cmp(x.key, y.key));
  const top = rows.slice(0, settings.topCount);
  const best = top[0]?.score ?? 0;
  const closest: ClosestFriend[] = top.map((r, i) => ({
    ...r,
    rank: i + 1,
    relativeScore: best > 0 ? round6(r.score / best) : 0,
  }));
  fading.sort((x, y) => y.dropFraction - x.dropFraction || y.earlierEvents - x.earlierEvents || cmp(x.key, y.key));

  return {
    asOf,
    basis: "saved-chats-and-snaps",
    settings,
    closest,
    fading,
    notes,
    counts: { friends: accs.size, withRecentActivity, eventsUsed: used },
  };
}
