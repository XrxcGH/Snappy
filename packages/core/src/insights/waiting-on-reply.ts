import type { ChatEvent } from "../types.ts";
import { DAY_MS, normUser } from "../util.ts";

/**
 * People waiting on a reply, and one-sided chats.
 *
 * Metadata only: it reads each event's conversation, direction and time, nothing else. These are
 * inferences from SAVED chats and Snaps; an export can miss messages, so every row is a hint to
 * check in the app, never a fact about the person.
 *
 * Direction "unknown" is never counted as sent or received. If the newest event with a person has
 * an unknown direction, we cannot tell who spoke last, so that person is left out of the waiting
 * lists (and counted in a note). Group chats are left out and only counted.
 *
 * Pure and deterministic: time comes in as `now`. Linear in the number of events.
 */

/** Documented defaults. */
export const WAITING_DEFAULTS = {
  /** Received with nothing sent back for at least this many days => waiting on you. */
  waitingOnYouDays: 3,
  /** Sent with no reply for at least this many days => waiting on them (people reply slower than we hope). */
  waitingOnThemDays: 7,
  /** Waits older than this many days are not listed: after this long it is more of a quiet chat. */
  maxWaitDays: 90,
  /** The one-sided check looks back this many days from the reference time. */
  windowDays: 90,
  /** One direction must hold at least this share of the known events in the window. */
  dominantShare: 0.85,
  /** Fewer known (sent or received) events than this in the window => too little to judge. */
  minEvents: 10,
} as const;

export interface WaitingOptions {
  /** Epoch ms "now" (injected; the module never reads a clock). */
  now: number;
  /**
   * When the export was generated. Waits are measured up to the earlier of this and `now`, so an
   * old export does not make everyone look like they have waited for months. Default: `now`.
   */
  exportedAt?: number;
  /** Usernames of current friends. When given, only these people are considered. */
  friends?: readonly string[];
  waitingOnYouDays?: number;
  waitingOnThemDays?: number;
  maxWaitDays?: number;
  windowDays?: number;
  dominantShare?: number;
  minEvents?: number;
}

/** One person in a waiting list. Usernames appear only in rows like this one. */
export interface WaitingPerson {
  username: string;
  /** Time of the last event, epoch ms. */
  since: number;
  /** Whole days from `since` to the reference time. */
  days: number;
}

export interface OneSidedPerson {
  username: string;
  /** Who sends most of the known events in the window. */
  dominant: "you" | "them";
  /** Known events in the window, by direction. Unknown-direction events are counted apart. */
  sent: number;
  received: number;
  unknown: number;
  /** Share of known events held by the dominant side, 0..1 rounded to 2 places. */
  share: number;
}

export type WaitingNoteCode =
  | "invalid-now"
  | "no-events"
  | "no-one-to-one-events"
  | "events-without-time"
  | "events-in-future"
  | "events-without-person"
  | "group-events-skipped"
  | "people-not-in-friends"
  | "people-last-direction-unknown"
  | "people-last-event-tied"
  | "people-wait-too-old"
  | "people-one-sided-direction-unreliable";

/** A stable code with whole-number counts only. Never carries user data. */
export interface WaitingNote {
  code: WaitingNoteCode;
  params: Record<string, number>;
}

export interface WaitingReport {
  /** Reference time actually used (epoch ms), or null when `now` was unusable. */
  asOf: number | null;
  /** They wrote last and you have not answered. Longest wait first, then username. */
  waitingOnYou: WaitingPerson[];
  /** You wrote last and they have not answered. Longest wait first, then username. */
  waitingOnThem: WaitingPerson[];
  /** One direction dominates in the window. Highest share first, then more events, then username. */
  oneSided: OneSidedPerson[];
  summary: { people: number; waitingOnYou: number; waitingOnThem: number; oneSided: number };
  notes: WaitingNote[];
}

interface Acc {
  lastSent: number;
  lastReceived: number;
  lastUnknown: number;
  sent: number;
  received: number;
  unknown: number;
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function num(v: number | undefined, fallback: number, min: number, max = Infinity): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

export function findWaitingOnReply(events: readonly ChatEvent[], opts: WaitingOptions): WaitingReport {
  const empty = (asOf: number | null, notes: WaitingNote[]): WaitingReport => ({
    asOf,
    waitingOnYou: [],
    waitingOnThem: [],
    oneSided: [],
    summary: { people: 0, waitingOnYou: 0, waitingOnThem: 0, oneSided: 0 },
    notes,
  });

  if (!Number.isFinite(opts.now)) return empty(null, [{ code: "invalid-now", params: {} }]);
  if (events.length === 0) return empty(opts.now, [{ code: "no-events", params: {} }]);

  const D = WAITING_DEFAULTS;
  const youDays = num(opts.waitingOnYouDays, D.waitingOnYouDays, 0);
  const themDays = num(opts.waitingOnThemDays, D.waitingOnThemDays, 0);
  const maxDays = num(opts.maxWaitDays, D.maxWaitDays, 0);
  const windowMs = num(opts.windowDays, D.windowDays, 0) * DAY_MS;
  const share = num(opts.dominantShare, D.dominantShare, 0.5, 1);
  const minEvents = Math.max(1, Math.floor(num(opts.minEvents, D.minEvents, 1)));
  const asOf = Math.min(opts.now, Number.isFinite(opts.exportedAt) ? (opts.exportedAt as number) : opts.now);
  const windowStart = asOf - windowMs;

  let noTime = 0;
  let future = 0;
  let noPerson = 0;
  let groups = 0;
  const people = new Map<string, Acc>();

  // Single pass: newest event per direction, plus window counts.
  for (const e of events) {
    if (e.isGroup || String(e.conversation ?? "").startsWith("group:")) {
      groups++;
      continue;
    }
    const at = e.at;
    if (typeof at !== "number" || !Number.isFinite(at)) {
      noTime++;
      continue;
    }
    if (at > asOf) {
      future++;
      continue;
    }
    const key = normUser(e.conversation);
    if (!key) {
      noPerson++;
      continue;
    }
    let a = people.get(key);
    if (!a) {
      a = { lastSent: -Infinity, lastReceived: -Infinity, lastUnknown: -Infinity, sent: 0, received: 0, unknown: 0 };
      people.set(key, a);
    }
    const inWindow = at > windowStart;
    if (e.direction === "sent") {
      if (at > a.lastSent) a.lastSent = at;
      if (inWindow) a.sent++;
    } else if (e.direction === "received") {
      if (at > a.lastReceived) a.lastReceived = at;
      if (inWindow) a.received++;
    } else {
      if (at > a.lastUnknown) a.lastUnknown = at;
      if (inWindow) a.unknown++;
    }
  }

  const allowed = opts.friends ? new Set(opts.friends.map(normUser)) : null;
  const waitingOnYou: WaitingPerson[] = [];
  const waitingOnThem: WaitingPerson[] = [];
  const oneSided: OneSidedPerson[] = [];
  let notFriends = 0;
  let unknownLast = 0;
  let tied = 0;
  let tooOld = 0;
  let unreliable = 0;
  let considered = 0;

  for (const [username, a] of people) {
    if (allowed && !allowed.has(username)) {
      notFriends++;
      continue;
    }
    considered++;

    // Who spoke last? Only decidable when the newest event has a known direction.
    const lastKnown = Math.max(a.lastSent, a.lastReceived);
    if (lastKnown === -Infinity || a.lastUnknown >= lastKnown) {
      unknownLast++;
    } else if (a.lastSent === a.lastReceived) {
      tied++;
    } else {
      const theyLast = a.lastReceived > a.lastSent;
      const ageDays = (asOf - lastKnown) / DAY_MS;
      if (ageDays >= (theyLast ? youDays : themDays)) {
        if (ageDays > maxDays) tooOld++;
        else (theyLast ? waitingOnYou : waitingOnThem).push({ username, since: lastKnown, days: Math.floor(ageDays) });
      }
    }

    // One-sided: known events in the window; unknown-direction events stay out of both sides.
    const known = a.sent + a.received;
    if (known < minEvents) continue;
    if (a.unknown > known) {
      unreliable++;
      continue;
    }
    const top = Math.max(a.sent, a.received);
    if (a.sent !== a.received && top / known >= share) {
      oneSided.push({
        username,
        dominant: a.sent > a.received ? "you" : "them",
        sent: a.sent,
        received: a.received,
        unknown: a.unknown,
        share: Math.round((top / known) * 100) / 100,
      });
    }
  }

  const byWait = (x: WaitingPerson, y: WaitingPerson) => x.since - y.since || cmp(x.username, y.username);
  waitingOnYou.sort(byWait);
  waitingOnThem.sort(byWait);
  oneSided.sort(
    (x, y) => y.share - x.share || y.sent + y.received - (x.sent + x.received) || cmp(x.username, y.username),
  );

  const notes: WaitingNote[] = [];
  const add = (code: WaitingNoteCode, count: number) => {
    if (count > 0) notes.push({ code, params: { count } });
  };
  if (people.size === 0 && groups > 0) notes.push({ code: "no-one-to-one-events", params: {} });
  add("group-events-skipped", groups);
  add("events-without-time", noTime);
  add("events-in-future", future);
  add("events-without-person", noPerson);
  add("people-not-in-friends", notFriends);
  add("people-last-direction-unknown", unknownLast);
  add("people-last-event-tied", tied);
  add("people-wait-too-old", tooOld);
  add("people-one-sided-direction-unreliable", unreliable);

  return {
    asOf,
    waitingOnYou,
    waitingOnThem,
    oneSided,
    summary: {
      people: considered,
      waitingOnYou: waitingOnYou.length,
      waitingOnThem: waitingOnThem.length,
      oneSided: oneSided.length,
    },
    notes,
  };
}
