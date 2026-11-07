import type { ParsedFriends } from "../types.ts";
import { MAX_USERNAME_LENGTH, normUser } from "../util.ts";

/**
 * Lookalike usernames: a safety check over friends, pending and sent requests, and the blocked list.
 *
 * It finds pairs of DIFFERENT usernames that look alike enough to be mixed up, so the person can
 * double-check someone before trusting them. Lookalikes are common and prove nothing: two real
 * people can have "mike_t" and "mike.t". The CLI and dashboard turn the codes into short, hedged
 * wording ("may be worth a second look"), never as an accusation. Snappy never fetches, opens or
 * contacts anything: this works on the usernames in the export and nothing else.
 *
 * Privacy: usernames appear ONLY in `pairs` rows, which exist to list the people. Notes, totals and
 * reasons are codes and counts only.
 *
 * How pairs are found (no all-pairs scan): each person gets bucket keys, and only people who share
 * a bucket are compared. There are two kinds of key:
 *  - Skeleton keys: the username after a subset of four transforms, applied in this order:
 *      separators   removes "." "_" "-"
 *      digits       drops trailing digits (only when 3 or more characters remain)
 *      look-alikes  0 to o, 1 and i to l, 5 to s, "rn" to m, "vv" to w
 *      repeats      collapses runs of one character ("aaron" and "aron")
 *    There are 15 non-empty subsets. A pair is explained by the SMALLEST subset that makes the two
 *    names equal, and the reasons are named after the transforms in it. A skeleton shorter than 3
 *    characters is never a match.
 *  - Edit keys: the name and every name made by deleting one character, for names of 6 to 40
 *    characters. Two names that share an edit key may be one edit apart (a changed, added, dropped
 *    or swapped neighbouring character), which is Damerau-Levenshtein distance 1; a shared key only
 *    nominates the pair and the distance is then checked. A difference in digits alone is a numbered
 *    name, left to the digits transform. Both names must
 *    be at least 6 characters long, because short names differ by one character all the time.
 *
 * Defaults (all deterministic; the only time value is `now`, used for `generatedAt`):
 *  - Usernames are compared after normUser (trimmed, lower-case). The same person in one list
 *    twice (any letter case) counts once; extra rows are counted in a note. The same person in
 *    several lists is still one person, and is never paired with themselves.
 *  - Names longer than MAX_USERNAME_LENGTH are skipped and counted in a note.
 *  - A bucket with more than 25 people is a numbered family ("fan_1" to "fan_90"), not a lookalike:
 *    it is skipped, and the people in such buckets are counted in a note.
 *  - Score is 0..1: reason weights combine as 1 - product(1 - weight), then +0.1 when a context
 *    applies, capped at 1 and rounded to 2 decimals. Level: high at 0.8 or more, medium at 0.5
 *    or more, otherwise low.
 *  - Pairs are ordered by score (highest first), then by username. At most `maxPairs` (default 200)
 *    are returned; totals count every pair at or above `minScore` (default 0).
 */

export type LookalikeListId = "friends" | "pendingRequests" | "sentRequests" | "blocked";

export type LookalikeReason =
  /** Same after swapping look-alike characters (0/o, 1/l/i, 5/s, rn/m, vv/w). */
  | "lookalike-swap"
  /** Same once ".", "_" and "-" are removed. */
  | "separator-differs"
  /** Same once repeated letters are collapsed. */
  | "repeated-characters"
  /** One name is the other with digits added at the end. */
  | "appended-digits"
  /** Same name with different trailing digits (often a numbered family or a birth year). */
  | "digits-differ"
  /** One character added, dropped, changed or swapped with its neighbour (names of 6+ characters). */
  | "one-edit";

export type LookalikeContext =
  /** One is an incoming request and the other is already a friend. */
  | "pending-resembles-friend"
  /** One is on the blocked list and the other is somebody who is not only blocked. */
  | "resembles-blocked";

export type LookalikeLevel = "low" | "medium" | "high";

/** The slice of ParsedFriends this module reads. Every list may be absent. */
export type LookalikeUsernamesInput = Partial<
  Pick<ParsedFriends, "friends" | "pendingRequests" | "sentRequests" | "blocked">
>;

export interface LookalikeOptions {
  /** Epoch ms "now"; only stamped on the result. */
  now: number;
  /** Drop pairs scoring below this. Default 0. */
  minScore?: number;
  /** Most pairs to return. Default 200. */
  maxPairs?: number;
}

export interface LookalikePair {
  /** Normalised usernames, `a` sorts before `b`. */
  a: string;
  b: string;
  /** Lists each person is in, in list order. */
  aLists: LookalikeListId[];
  bLists: LookalikeListId[];
  /** Why they look alike, in a fixed order. Never empty. */
  reasons: LookalikeReason[];
  contexts: LookalikeContext[];
  /** 0..1 */
  score: number;
  level: LookalikeLevel;
}

export interface LookalikeNote {
  code:
    | "no-people"
    | "no-lookalikes"
    | "lookalikes-found"
    | "list-truncated"
    | "case-duplicates"
    | "blank-entries"
    | "overlong-entries"
    | "crowded-groups";
  /** Counts only; never user data. */
  params: Record<string, number>;
}

export interface LookalikeUsernames {
  generatedAt: number;
  /** Best first, at most `maxPairs`. */
  pairs: LookalikePair[];
  totals: {
    /** Different usernames compared. */
    people: number;
    /** Pairs at or above `minScore`, before the `maxPairs` cut. */
    pairs: number;
    byLevel: Record<LookalikeLevel, number>;
  };
  notes: LookalikeNote[];
}

const LIST_IDS: readonly LookalikeListId[] = ["friends", "pendingRequests", "sentRequests", "blocked"];

const DEFAULT_MAX_PAIRS = 200;
/** Buckets above this many people are numbered families, not lookalikes. */
const MAX_BUCKET = 25;
const MIN_SKELETON = 3;
const MIN_EDIT_LENGTH = 6;
const MAX_EDIT_LENGTH = 40;
const CONTEXT_BONUS = 0.1;

const SEP = 1;
const DIGITS = 2;
const LOOK = 4;
const REPEAT = 8;
/** Non-empty transform subsets, smallest first, so a pair is explained by the fewest transforms. */
const MASKS: readonly number[] = [1, 2, 4, 8, 3, 5, 6, 9, 10, 12, 7, 11, 13, 14, 15];
const MASK_RANK = new Map(MASKS.map((m, i) => [m, i] as const));

const WEIGHT: Record<LookalikeReason, number> = {
  "lookalike-swap": 0.9,
  "separator-differs": 0.6,
  "repeated-characters": 0.6,
  "appended-digits": 0.5,
  "one-edit": 0.5,
  "digits-differ": 0.25,
};
const REASON_ORDER: readonly LookalikeReason[] = [
  "lookalike-swap",
  "separator-differs",
  "repeated-characters",
  "appended-digits",
  "digits-differ",
  "one-edit",
];

const LOOK_CHAR: Record<string, string> = { "0": "o", "1": "l", i: "l", "5": "s" };

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Splits trailing digits off a name; nothing is split when fewer than 3 characters would remain. */
function splitDigits(s: string): { base: string; suffix: string } {
  let i = s.length;
  while (i > 0) {
    const c = s.charCodeAt(i - 1);
    if (c < 48 || c > 57) break;
    i--;
  }
  return i >= MIN_SKELETON && i < s.length ? { base: s.slice(0, i), suffix: s.slice(i) } : { base: s, suffix: "" };
}

const stripSeparators = (s: string) => s.replace(/[._-]+/g, "");

function skeleton(name: string, mask: number): string {
  let s = name;
  if (mask & SEP) s = stripSeparators(s);
  if (mask & DIGITS) s = splitDigits(s).base;
  if (mask & LOOK) s = s.replace(/rn/g, "m").replace(/vv/g, "w").replace(/[01i5]/g, (c) => LOOK_CHAR[c]!);
  if (mask & REPEAT) s = s.replace(/(.)\1+/g, "$1");
  return s;
}

/** Names the transforms in `mask` as reason codes (sorted by REASON_ORDER). */
function reasonsFor(mask: number, a: string, b: string): LookalikeReason[] {
  const out: LookalikeReason[] = [];
  if (mask & LOOK) out.push("lookalike-swap");
  if (mask & SEP) out.push("separator-differs");
  if (mask & REPEAT) out.push("repeated-characters");
  if (mask & DIGITS) {
    const sa = mask & SEP ? stripSeparators(a) : a;
    const sb = mask & SEP ? stripSeparators(b) : b;
    const addedToOne = (splitDigits(sa).suffix === "") !== (splitDigits(sb).suffix === "");
    out.push(addedToOne ? "appended-digits" : "digits-differ");
  }
  return out.sort((x, y) => REASON_ORDER.indexOf(x) - REASON_ORDER.indexOf(y));
}

/** True when `a` and `b` are exactly one edit apart: one character changed, added, dropped or swapped with its neighbour. */
function oneEditApart(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (i === a.length && i === b.length) return false;
  if (a.length === b.length) {
    return a.slice(i + 1) === b.slice(i + 1) || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
  }
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : b.slice(i + 1) === a.slice(i);
}

const withoutDigits = (s: string) => s.replace(/\d+/g, "");

/**
 * The name itself and every name made by deleting one character. Two names one edit apart always
 * share a key, but sharing a key is not enough (deleting different characters can leave the same
 * name), so a shared key only nominates the pair and `oneEditApart` decides.
 */
function editKeys(name: string): Set<string> {
  const keys = new Set([name]);
  for (let i = 0; i < name.length; i++) keys.add(name.slice(0, i) + name.slice(i + 1));
  return keys;
}

interface Person {
  username: string;
  lists: LookalikeListId[];
}

function levelOf(score: number): LookalikeLevel {
  return score >= 0.8 ? "high" : score >= 0.5 ? "medium" : "low";
}

export function findLookalikeUsernames(input: LookalikeUsernamesInput, opts: LookalikeOptions): LookalikeUsernames {
  const minScore = Number.isFinite(opts.minScore) ? Math.max(0, opts.minScore!) : 0;
  const maxPairs = Number.isFinite(opts.maxPairs) ? Math.max(0, Math.floor(opts.maxPairs!)) : DEFAULT_MAX_PAIRS;

  // Fold every list to one row per person.
  const byName = new Map<string, LookalikeListId[]>();
  let blank = 0;
  let overlong = 0;
  let caseDuplicates = 0;
  for (const id of LIST_IDS) {
    const seen = new Set<string>();
    for (const r of input[id] ?? []) {
      const key = normUser(r.username);
      if (!key) {
        blank++;
        continue;
      }
      if (key.length > MAX_USERNAME_LENGTH) {
        overlong++;
        continue;
      }
      if (seen.has(key)) {
        caseDuplicates++;
        continue;
      }
      seen.add(key);
      const m = byName.get(key);
      if (m) m.push(id);
      else byName.set(key, [id]);
    }
  }
  const people: Person[] = [...byName]
    .map(([username, lists]) => ({ username, lists }))
    .sort((x, y) => cmp(x.username, y.username));

  // Bucket by skeleton and edit keys.
  const buckets = new Map<string, number[]>();
  const put = (key: string, i: number) => {
    const b = buckets.get(key);
    if (b) b.push(i);
    else buckets.set(key, [i]);
  };
  people.forEach((p, i) => {
    for (const mask of MASKS) {
      const s = skeleton(p.username, mask);
      if (s.length >= MIN_SKELETON) put(`s${mask}:${s}`, i);
    }
    if (p.username.length >= MIN_EDIT_LENGTH && p.username.length <= MAX_EDIT_LENGTH) {
      for (const k of editKeys(p.username)) put(`e:${k}`, i);
    }
  });

  // Compare people who share a bucket. A pair keeps its smallest explaining mask; 0 means edit only.
  const n = people.length;
  const found = new Map<number, number>();
  const crowded = new Set<number>();
  for (const [key, members] of buckets) {
    if (members.length < 2) continue;
    if (members.length > MAX_BUCKET) {
      for (const i of members) crowded.add(i);
      continue;
    }
    const mask = key.startsWith("e:") ? 0 : Number(key.slice(1, key.indexOf(":")));
    const names = mask === 0 ? members.map((i) => people[i]!.username) : [];
    for (let x = 0; x < members.length; x++) {
      for (let y = x + 1; y < members.length; y++) {
        const i = members[x]!;
        const j = members[y]!;
        if (mask === 0) {
          // Digit-only differences are numbered names ("fan_12", "fan_13"): left to the digits transform.
          const a = names[x]!;
          const b = names[y]!;
          if (!oneEditApart(a, b) || withoutDigits(a) === withoutDigits(b)) continue;
        }
        const pk = i < j ? i * n + j : j * n + i;
        const prev = found.get(pk);
        if (prev === undefined) found.set(pk, mask);
        else if (mask !== 0 && (prev === 0 || MASK_RANK.get(mask)! < MASK_RANK.get(prev)!)) found.set(pk, mask);
      }
    }
  }

  // Score and explain.
  const pairs: LookalikePair[] = [];
  for (const [pk, mask] of found) {
    const A = people[Math.floor(pk / n)]!;
    const B = people[pk % n]!;
    const reasons: LookalikeReason[] = mask === 0 ? ["one-edit"] : reasonsFor(mask, A.username, B.username);
    const contexts: LookalikeContext[] = [];
    const isFriend = (p: Person) => p.lists.includes("friends");
    const isPending = (p: Person) => p.lists.includes("pendingRequests");
    const isBlocked = (p: Person) => p.lists.includes("blocked");
    const notOnlyBlocked = (p: Person) => p.lists.some((l) => l !== "blocked");
    if ((isPending(A) && isFriend(B)) || (isPending(B) && isFriend(A))) contexts.push("pending-resembles-friend");
    if ((isBlocked(A) && notOnlyBlocked(B)) || (isBlocked(B) && notOnlyBlocked(A))) contexts.push("resembles-blocked");

    let keep = 1;
    for (const r of reasons) keep *= 1 - WEIGHT[r];
    const raw = 1 - keep + (contexts.length ? CONTEXT_BONUS : 0);
    const score = Math.round(Math.min(1, raw) * 100) / 100;
    if (score < minScore) continue;
    pairs.push({ a: A.username, b: B.username, aLists: A.lists, bLists: B.lists, reasons, contexts, score, level: levelOf(score) });
  }
  pairs.sort((x, y) => y.score - x.score || cmp(x.a, y.a) || cmp(x.b, y.b));

  const byLevel: Record<LookalikeLevel, number> = { low: 0, medium: 0, high: 0 };
  for (const p of pairs) byLevel[p.level]++;
  const total = pairs.length;
  const shown = pairs.slice(0, maxPairs);

  const notes: LookalikeNote[] = [];
  if (n === 0) notes.push({ code: "no-people", params: {} });
  else if (total === 0) notes.push({ code: "no-lookalikes", params: {} });
  else notes.push({ code: "lookalikes-found", params: { count: total } });
  if (shown.length < total) notes.push({ code: "list-truncated", params: { shown: shown.length, total } });
  if (caseDuplicates) notes.push({ code: "case-duplicates", params: { count: caseDuplicates } });
  if (blank) notes.push({ code: "blank-entries", params: { count: blank } });
  if (overlong) notes.push({ code: "overlong-entries", params: { count: overlong } });
  if (crowded.size) notes.push({ code: "crowded-groups", params: { people: crowded.size } });

  return { generatedAt: opts.now, pairs: shown, totals: { people: n, pairs: total, byLevel }, notes };
}
