import { DAY_MS, normUser } from "../util.ts";

/**
 * Reply speed: how fast you and your friends answer each other in 1:1 chats.
 *
 * Metadata only: it reads each event's conversation, group flag, direction and time, nothing else
 * (a ChatEvent fits as is; extra fields are ignored and never copied). These are inferences from
 * SAVED chats and Snaps; an export can miss messages, so a reply time is a hint, never a fact.
 *
 * What counts as a reply: with one person, take the events whose direction is known, in time order.
 * When the direction flips (received then sent, or sent then received) that flip is a reply, and its
 * time is the gap from the LAST event before the flip to the first event after it. A burst of
 * messages in a row is therefore one turn. Names: `you` is YOU replying to THEM (how long you took
 * to answer); `them` is THEM replying to YOU.
 *
 * Direction "unknown" (or anything unrecognized) is never counted: it is not a reply and it does
 * not split or bridge a turn, it is skipped and counted in a note. Group chats are left out and
 * only counted. Events with a missing or non-finite time, a time at or before 0, or a time after
 * `now` are left out and only counted.
 *
 * Defaults (all documented here, none hidden):
 *  - maxReplyHours 24: a flip with a longer gap is a new conversation, not a reply (counted in a note).
 *  - minReplies 5: a person's side (and an hour of the day) gets median and 90th percentile only
 *    from this many replies; below it the number of replies is shown and the times are null.
 *  - topN 3: the fastest and slowest lists show up to this many people, and never more than half of
 *    those with enough replies, so the two lists cannot show the same person.
 *  - utcOffsetMinutes 0: minutes east of UTC for the hour of day of a reply. Valid range is
 *    -720..840; other values are clamped and noted, fractions are rounded, non-finite means 0.
 *  - A flip at the very same millisecond is not a reply (the order is unknowable); it is counted.
 *  - Median of an even count is the mean of the middle two, rounded to a whole millisecond. The 90th
 *    percentile is the nearest rank, so it is always a time that really happened.
 *  - Hours are the hour of the REPLY (when the answer was sent), in the chosen offset.
 *
 * Pure and deterministic: no clock (take `now`), no randomness, no input-order dependence. Each
 * person's events are one typed sort, so 10,000+ people and 100,000+ events are fast.
 */

export const REPLY_SPEED_DEFAULTS = {
  maxReplyHours: 24,
  minReplies: 5,
  topN: 3,
  utcOffsetMinutes: 0,
} as const;

/** Valid UTC offsets, in minutes east of UTC (UTC-12:00 to UTC+14:00). */
const MIN_OFFSET = -720;
const MAX_OFFSET = 840;
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/** The only fields read. */
export interface ReplyEvent {
  conversation: string;
  isGroup?: boolean;
  direction?: string | null;
  /** Epoch ms. */
  at?: number | null;
}

export interface ReplySpeedOptions {
  /** Epoch ms "now" (injected; the module never reads a clock). Later events are left out. */
  now: number;
  /** Usernames of current friends. When given, only these people are considered. */
  friends?: readonly string[];
  /** Longest gap, in hours, that still counts as a reply. Default 24. */
  maxReplyHours?: number;
  /** Replies needed before a person (or an hour) gets times. Default 5. */
  minReplies?: number;
  /** Length of the fastest and slowest lists. Default 3. */
  topN?: number;
  /** Minutes east of UTC for the hour of day. Default 0. */
  utcOffsetMinutes?: number;
}

/** Median and 90th percentile reply time in milliseconds. */
export interface ReplySpread {
  medianMs: number;
  p90Ms: number;
}

/** All replies of one side, no minimum applied: `replies` tells how much to trust the times. */
export interface ReplyTotals extends ReplySpread {
  replies: number;
}

/** One person. Usernames appear only in rows like this one. */
export interface ReplyFriendRow {
  username: string;
  /** Your replies to them, and theirs to you, always counted. */
  youReplies: number;
  themReplies: number;
  /** Times for each side, null below the minimum number of replies. */
  you: ReplySpread | null;
  them: ReplySpread | null;
}

/** A person in a fastest or slowest list. */
export interface ReplyRank extends ReplySpread {
  username: string;
  replies: number;
}

export interface ReplyHourRow {
  /** 0..23 in the chosen offset, the hour the reply was sent. */
  hour: number;
  youReplies: number;
  themReplies: number;
  /** Median reply time, null below the minimum number of replies. */
  youMedianMs: number | null;
  themMedianMs: number | null;
}

export type ReplySpeedNoteCode =
  | "invalid-now" // params: none
  | "no-events" // params: none
  | "no-one-to-one-events" // params: none
  | "no-replies-found" // params: none
  | "events-without-time" // params: count
  | "events-in-future" // params: count
  | "events-without-person" // params: count
  | "group-events-skipped" // params: count
  | "events-direction-unknown" // params: count
  | "people-not-in-friends" // params: count
  | "turns-after-window" // params: count (a flip slower than the window)
  | "turns-at-same-time" // params: count
  | "people-below-minimum" // params: count (had replies, none enough for times)
  | "few-replies-overall" // params: count (the smaller side), minimum
  | "offset-adjusted"; // params: minutes (the offset actually used)

/** A stable code with whole-number params only. Never carries user data. */
export interface ReplySpeedNote {
  code: ReplySpeedNoteCode;
  params: Record<string, number>;
}

export interface ReplySpeedReport {
  /** Reference time used (epoch ms), or null when `now` was unusable. */
  asOf: number | null;
  /** Settings actually used. */
  windowMs: number;
  minReplies: number;
  utcOffsetMinutes: number;
  /** Every reply by each side, null when there were none. */
  overall: { you: ReplyTotals | null; them: ReplyTotals | null };
  /** People with enough replies on at least one side. Most replies first, then username. */
  friends: ReplyFriendRow[];
  /** Median-based. fastest: quickest first; slowest: slowest first. Only people with enough replies on that side. */
  fastest: { you: ReplyRank[]; them: ReplyRank[] };
  slowest: { you: ReplyRank[]; them: ReplyRank[] };
  /** Always 24 rows, hour 0 first. */
  byHour: ReplyHourRow[];
  summary: { people: number; peopleWithReplies: number; peopleListed: number; youReplies: number; themReplies: number };
  notes: ReplySpeedNote[];
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function num(v: number | undefined, fallback: number, min: number, max = Infinity): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

/** Median of an ascending list (mean of the middle two when even, rounded). */
function median(sorted: Float64Array): number {
  const n = sorted.length;
  const mid = n >> 1;
  return n % 2 ? (sorted[mid] as number) : Math.round(((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2);
}

/** Nearest-rank 90th percentile of an ascending list, in integer math (no float rounding surprises). */
function p90(sorted: Float64Array): number {
  return sorted[Math.floor((9 * sorted.length + 9) / 10) - 1] as number;
}

function sortedGaps(gaps: number[]): Float64Array {
  return Float64Array.from(gaps).sort();
}

function spread(gaps: number[]): ReplySpread {
  const s = sortedGaps(gaps);
  return { medianMs: median(s), p90Ms: p90(s) };
}

export function findReplySpeed(events: readonly ReplyEvent[], opts: ReplySpeedOptions): ReplySpeedReport {
  const D = REPLY_SPEED_DEFAULTS;
  const windowMs = num(opts.maxReplyHours, D.maxReplyHours, 0) * HOUR_MS;
  const minReplies = Math.max(1, Math.floor(num(opts.minReplies, D.minReplies, 1)));
  const topN = Math.min(20, Math.max(1, Math.floor(num(opts.topN, D.topN, 1))));
  const rawOffset = typeof opts.utcOffsetMinutes === "number" && Number.isFinite(opts.utcOffsetMinutes) ? Math.round(opts.utcOffsetMinutes) : 0;
  const offset = Math.min(MAX_OFFSET, Math.max(MIN_OFFSET, rawOffset));

  const notes: ReplySpeedNote[] = [];
  const add = (code: ReplySpeedNoteCode, params: Record<string, number>) => notes.push({ code, params });
  const addCount = (code: ReplySpeedNoteCode, count: number) => {
    if (count > 0) add(code, { count });
  };

  const hours: ReplyHourRow[] = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    youReplies: 0,
    themReplies: 0,
    youMedianMs: null,
    themMedianMs: null,
  }));
  const empty = (asOf: number | null, why: ReplySpeedNote[]): ReplySpeedReport => ({
    asOf,
    windowMs,
    minReplies,
    utcOffsetMinutes: offset,
    overall: { you: null, them: null },
    friends: [],
    fastest: { you: [], them: [] },
    slowest: { you: [], them: [] },
    byHour: hours,
    summary: { people: 0, peopleWithReplies: 0, peopleListed: 0, youReplies: 0, themReplies: 0 },
    notes: why,
  });

  if (!Number.isFinite(opts.now)) return empty(null, [{ code: "invalid-now", params: {} }]);
  if (events.length === 0) return empty(opts.now, [{ code: "no-events", params: {} }]);

  let noTime = 0;
  let future = 0;
  let noPerson = 0;
  let groups = 0;
  let unknownDir = 0;
  // Per person, one number per event: at * 2 + (1 when sent). One numeric sort puts them in time
  // order whatever the input order was (at the same millisecond, received comes first).
  const people = new Map<string, number[]>();

  for (const e of events) {
    if (e.isGroup || String(e.conversation ?? "").startsWith("group:")) {
      groups++;
      continue;
    }
    const at = e.at;
    if (typeof at !== "number" || !Number.isFinite(at) || at <= 0) {
      noTime++;
      continue;
    }
    if (at > opts.now) {
      future++;
      continue;
    }
    const key = normUser(e.conversation);
    if (!key) {
      noPerson++;
      continue;
    }
    if (e.direction !== "sent" && e.direction !== "received") {
      unknownDir++;
      continue;
    }
    let list = people.get(key);
    if (!list) {
      list = [];
      people.set(key, list);
    }
    list.push(Math.floor(at) * 2 + (e.direction === "sent" ? 1 : 0));
  }

  const allowed = opts.friends ? new Set(opts.friends.map(normUser)) : null;
  const overallYou: number[] = [];
  const overallThem: number[] = [];
  const hourYou: number[][] = Array.from({ length: 24 }, () => []);
  const hourThem: number[][] = Array.from({ length: 24 }, () => []);
  const rows: ReplyFriendRow[] = [];
  const medians = new Map<string, { you: ReplyRank | null; them: ReplyRank | null }>();
  let notFriends = 0;
  let withReplies = 0;
  let belowMin = 0;
  let late = 0;
  let sameTime = 0;
  let considered = 0;

  for (const [username, list] of people) {
    if (allowed && !allowed.has(username)) {
      notFriends++;
      continue;
    }
    considered++;
    const sorted = Float64Array.from(list).sort();
    const you: number[] = [];
    const them: number[] = [];
    let prev = sorted[0] as number;
    for (let i = 1; i < sorted.length; i++) {
      const cur = sorted[i] as number;
      const curDir = cur % 2;
      const curAt = (cur - curDir) / 2;
      const prevDir = prev % 2;
      if (curDir !== prevDir) {
        const gap = curAt - (prev - prevDir) / 2;
        if (gap <= 0) sameTime++;
        else if (gap > windowMs) late++;
        else {
          // The hour of the reply, in the chosen offset.
          const hour = Math.floor((((((curAt + offset * MINUTE_MS) % DAY_MS) + DAY_MS) % DAY_MS)) / HOUR_MS);
          if (curDir === 1) {
            you.push(gap);
            overallYou.push(gap);
            (hourYou[hour] as number[]).push(gap);
          } else {
            them.push(gap);
            overallThem.push(gap);
            (hourThem[hour] as number[]).push(gap);
          }
        }
      }
      prev = cur;
    }
    if (you.length + them.length === 0) continue;
    withReplies++;

    const youOk = you.length >= minReplies ? spread(you) : null;
    const themOk = them.length >= minReplies ? spread(them) : null;
    if (!youOk && !themOk) {
      belowMin++;
      continue;
    }
    rows.push({ username, youReplies: you.length, themReplies: them.length, you: youOk, them: themOk });
    medians.set(username, {
      you: youOk && { username, replies: you.length, ...youOk },
      them: themOk && { username, replies: them.length, ...themOk },
    });
  }

  rows.sort((x, y) => y.youReplies + y.themReplies - (x.youReplies + x.themReplies) || cmp(x.username, y.username));

  // Fastest and slowest by median (then 90th percentile, then username), per side.
  const rank = (side: "you" | "them") => {
    const list: ReplyRank[] = [];
    for (const m of medians.values()) if (m[side]) list.push(m[side] as ReplyRank);
    const fast = (a: ReplyRank, b: ReplyRank) => a.medianMs - b.medianMs || a.p90Ms - b.p90Ms || cmp(a.username, b.username);
    const slow = (a: ReplyRank, b: ReplyRank) => b.medianMs - a.medianMs || b.p90Ms - a.p90Ms || cmp(a.username, b.username);
    const k = Math.min(topN, list.length >> 1);
    return { fastest: [...list].sort(fast).slice(0, k), slowest: [...list].sort(slow).slice(0, k) };
  };
  const ry = rank("you");
  const rt = rank("them");

  for (let h = 0; h < 24; h++) {
    const row = hours[h] as ReplyHourRow;
    const y = hourYou[h] as number[];
    const t = hourThem[h] as number[];
    row.youReplies = y.length;
    row.themReplies = t.length;
    if (y.length >= minReplies) row.youMedianMs = spread(y).medianMs;
    if (t.length >= minReplies) row.themMedianMs = spread(t).medianMs;
  }

  const totals = (gaps: number[]): ReplyTotals | null => (gaps.length ? { replies: gaps.length, ...spread(gaps) } : null);

  // Noted when a given offset was not used as is: not a number, fractional or out of range.
  if (opts.utcOffsetMinutes !== undefined && opts.utcOffsetMinutes !== offset) add("offset-adjusted", { minutes: offset });
  if (people.size === 0 && groups > 0) add("no-one-to-one-events", {});
  addCount("group-events-skipped", groups);
  addCount("events-without-time", noTime);
  addCount("events-in-future", future);
  addCount("events-without-person", noPerson);
  addCount("events-direction-unknown", unknownDir);
  addCount("people-not-in-friends", notFriends);
  addCount("turns-after-window", late);
  addCount("turns-at-same-time", sameTime);
  addCount("people-below-minimum", belowMin);
  if (overallYou.length + overallThem.length === 0) {
    if (considered > 0) add("no-replies-found", {});
  } else {
    const smaller = Math.min(overallYou.length, overallThem.length);
    if (smaller < minReplies) add("few-replies-overall", { count: smaller, minimum: minReplies });
  }

  return {
    asOf: opts.now,
    windowMs,
    minReplies,
    utcOffsetMinutes: offset,
    overall: { you: totals(overallYou), them: totals(overallThem) },
    friends: rows,
    fastest: { you: ry.fastest, them: rt.fastest },
    slowest: { you: ry.slowest, them: rt.slowest },
    byHour: hours,
    summary: {
      people: considered,
      peopleWithReplies: withReplies,
      peopleListed: rows.length,
      youReplies: overallYou.length,
      themReplies: overallThem.length,
    },
    notes,
  };
}
