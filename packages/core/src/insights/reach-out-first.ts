import type { ChatEvent } from "../types.ts";
import { normUser } from "../util.ts";

/**
 * Who reaches out first.
 *
 * Each 1:1 conversation is cut into exchanges: a new exchange starts at the first event, and again
 * whenever at least `gapHours` pass with no event at all. The sender of an exchange's first event is
 * who reached out. This counts, per person, how often you did and how often they did.
 *
 * Metadata only: it reads each event's conversation, direction and time, nothing else. It reflects
 * only the saved chats and Snaps in the export; messages that were never saved can hide the real
 * first move, so a result is a hint, never a fact about the person.
 *
 * Direction "unknown" is never counted for either side. Unknown events still prove activity, so they
 * keep an exchange going, but an exchange that opens with one (or with a sent and a received event at
 * the very same instant) has no known starter: it is counted apart and left out of every share.
 * Group chats are left out and only counted.
 *
 * Pure and deterministic: time comes in as `now`, nothing is read from a clock or the machine's time
 * zone (a gap is a plain length of time, so a UTC offset does not change the result). Input order does
 * not matter. Sorting each person's events makes it O(n log n) overall.
 */

/** Documented defaults. */
export const REACH_OUT_DEFAULTS = {
  /** Silence of at least this many hours between two events starts a new exchange. */
  gapHours: 6,
  /** A person needs at least this many exchanges with a known starter to be listed as "mostly". */
  minExchanges: 5,
  /** One side must have started at least this share of the known exchanges to be "mostly". */
  mostlyShare: 0.7,
} as const;

const HOUR_MS = 60 * 60 * 1000;

export interface ReachOutOptions {
  /** Epoch ms "now" (injected; the module never reads a clock). */
  now: number;
  /**
   * When the export was generated. Events after the earlier of this and `now` are ignored as
   * "in the future". Default: `now`.
   */
  exportedAt?: number;
  /** Usernames of current friends. When given, only these people are considered. */
  friends?: readonly string[];
  gapHours?: number;
  minExchanges?: number;
  mostlyShare?: number;
}

/** One person. Usernames appear only in rows like this one. */
export interface ReachOutPerson {
  username: string;
  /** Exchanges with a known starter (byYou + byThem). */
  exchanges: number;
  /** Exchanges you started. */
  byYou: number;
  /** Exchanges they started. */
  byThem: number;
  /** Exchanges whose starter could not be told. Never part of a share. */
  unknown: number;
  /** Share of known exchanges you started, 0..1 rounded to 2 places; null when none are known. */
  youShare: number | null;
}

export type ReachOutNoteCode =
  | "invalid-now"
  | "no-events"
  | "no-one-to-one-events"
  | "group-events-skipped"
  | "events-without-time"
  | "events-in-future"
  | "events-without-person"
  | "people-not-in-friends"
  | "exchanges-starter-unknown"
  | "exchanges-starter-tied"
  | "people-too-few-exchanges"
  | "people-starter-unreliable";

/** A stable code with whole-number counts only. Never carries user data. */
export interface ReachOutNote {
  code: ReachOutNoteCode;
  params: Record<string, number>;
}

export interface ReachOutReport {
  /** Reference time actually used (epoch ms), or null when `now` was unusable. */
  asOf: number | null;
  /** The settings actually used, after falling back to defaults for unusable values. */
  settings: { gapHours: number; minExchanges: number; mostlyShare: number };
  /** Every considered person with at least one exchange. Most exchanges first, then username. */
  people: ReachOutPerson[];
  /** They mostly start the exchanges. Highest share started by them first, then exchanges, then username. */
  mostlyThem: ReachOutPerson[];
  /** You mostly start the exchanges. Highest share started by you first, then exchanges, then username. */
  mostlyYou: ReachOutPerson[];
  /** All considered people together. youShare is null when no exchange has a known starter. */
  overall: { exchanges: number; byYou: number; byThem: number; unknown: number; youShare: number | null };
  summary: { people: number; mostlyThem: number; mostlyYou: number };
  notes: ReachOutNote[];
}

const SENT = 0;
const RECEIVED = 1;
const UNKNOWN = 2;
const TIED = 3;

interface Acc {
  at: number[];
  dir: number[];
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const round2 = (x: number): number => Math.round(x * 100) / 100;

function num(v: number | undefined, fallback: number, min: number, max = Infinity): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

export function findWhoReachesOutFirst(events: readonly ChatEvent[], opts: ReachOutOptions): ReachOutReport {
  const D = REACH_OUT_DEFAULTS;
  const gapHours = num(opts.gapHours, D.gapHours, 1 / 60);
  const minExchanges = Math.max(1, Math.floor(num(opts.minExchanges, D.minExchanges, 1)));
  const mostlyShare = num(opts.mostlyShare, D.mostlyShare, 0.5, 1);
  const settings = { gapHours, minExchanges, mostlyShare };
  const empty = (asOf: number | null, notes: ReachOutNote[]): ReachOutReport => ({
    asOf,
    settings,
    people: [],
    mostlyThem: [],
    mostlyYou: [],
    overall: { exchanges: 0, byYou: 0, byThem: 0, unknown: 0, youShare: null },
    summary: { people: 0, mostlyThem: 0, mostlyYou: 0 },
    notes,
  });

  if (!Number.isFinite(opts.now)) return empty(null, [{ code: "invalid-now", params: {} }]);
  if (events.length === 0) return empty(opts.now, [{ code: "no-events", params: {} }]);

  const gapMs = gapHours * HOUR_MS;
  const asOf = Math.min(opts.now, Number.isFinite(opts.exportedAt) ? (opts.exportedAt as number) : opts.now);

  let noTime = 0;
  let future = 0;
  let noPerson = 0;
  let groups = 0;
  const byPerson = new Map<string, Acc>();

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
    let a = byPerson.get(key);
    if (!a) {
      a = { at: [], dir: [] };
      byPerson.set(key, a);
    }
    a.at.push(at);
    a.dir.push(e.direction === "sent" ? SENT : e.direction === "received" ? RECEIVED : UNKNOWN);
  }

  const allowed = opts.friends ? new Set(opts.friends.map(normUser)) : null;
  const people: ReachOutPerson[] = [];
  let notFriends = 0;
  let unknownStarts = 0;
  let tiedStarts = 0;

  for (const [username, a] of byPerson) {
    if (allowed && !allowed.has(username)) {
      notFriends++;
      continue;
    }
    const order = a.at.map((_, i) => i).sort((x, y) => a.at[x]! - a.at[y]!);
    let byYou = 0;
    let byThem = 0;
    let unknown = 0;
    let prev = -Infinity;
    let startAt = -Infinity;
    let startDir = UNKNOWN;
    let open = false;
    // Closes the exchange being built: files its starter under you, them or unknown.
    const close = () => {
      if (!open) return;
      if (startDir === SENT) byYou++;
      else if (startDir === RECEIVED) byThem++;
      else {
        unknown++;
        if (startDir === TIED) tiedStarts++;
        else unknownStarts++;
      }
    };
    for (const i of order) {
      const at = a.at[i]!;
      const d = a.dir[i]!;
      if (!open || at - prev >= gapMs) {
        close();
        open = true;
        startAt = at;
        startDir = d;
      } else if (at === startAt && d !== startDir && startDir !== TIED) {
        // Two events at the very first instant that disagree: who moved first cannot be told.
        startDir = TIED;
      }
      prev = at;
    }
    close();
    const known = byYou + byThem;
    people.push({ username, exchanges: known, byYou, byThem, unknown, youShare: known ? round2(byYou / known) : null });
  }

  let tooFew = 0;
  let unreliable = 0;
  const mostlyYou: ReachOutPerson[] = [];
  const mostlyThem: ReachOutPerson[] = [];
  for (const p of people) {
    if (p.exchanges < minExchanges) {
      tooFew++;
      continue;
    }
    if (p.unknown > p.exchanges) {
      unreliable++;
      continue;
    }
    if (p.byYou > p.byThem && p.byYou / p.exchanges >= mostlyShare) mostlyYou.push(p);
    else if (p.byThem > p.byYou && p.byThem / p.exchanges >= mostlyShare) mostlyThem.push(p);
  }

  const total = (p: ReachOutPerson) => p.exchanges + p.unknown;
  const youRatio = (p: ReachOutPerson) => p.byYou / p.exchanges;
  const themRatio = (p: ReachOutPerson) => p.byThem / p.exchanges;
  people.sort((x, y) => total(y) - total(x) || cmp(x.username, y.username));
  mostlyYou.sort((x, y) => youRatio(y) - youRatio(x) || y.exchanges - x.exchanges || cmp(x.username, y.username));
  mostlyThem.sort((x, y) => themRatio(y) - themRatio(x) || y.exchanges - x.exchanges || cmp(x.username, y.username));

  let sumYou = 0;
  let sumThem = 0;
  let sumUnknown = 0;
  for (const p of people) {
    sumYou += p.byYou;
    sumThem += p.byThem;
    sumUnknown += p.unknown;
  }
  const knownAll = sumYou + sumThem;

  const notes: ReachOutNote[] = [];
  const add = (code: ReachOutNoteCode, count: number) => {
    if (count > 0) notes.push({ code, params: { count } });
  };
  if (byPerson.size === 0 && groups > 0) notes.push({ code: "no-one-to-one-events", params: {} });
  add("group-events-skipped", groups);
  add("events-without-time", noTime);
  add("events-in-future", future);
  add("events-without-person", noPerson);
  add("people-not-in-friends", notFriends);
  add("exchanges-starter-unknown", unknownStarts);
  add("exchanges-starter-tied", tiedStarts);
  add("people-too-few-exchanges", tooFew);
  add("people-starter-unreliable", unreliable);

  return {
    asOf,
    settings,
    people,
    mostlyThem,
    mostlyYou,
    overall: {
      exchanges: knownAll,
      byYou: sumYou,
      byThem: sumThem,
      unknown: sumUnknown,
      youShare: knownAll ? round2(sumYou / knownAll) : null,
    },
    summary: { people: people.length, mostlyThem: mostlyThem.length, mostlyYou: mostlyYou.length },
    notes,
  };
}
