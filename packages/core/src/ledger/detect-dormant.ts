import type { Candidate, Evidence, FriendRecord, ParsedExport } from "../types.ts";
import { DAY_MS, combineWeights, confidenceFromScore, formatDay, groupDigits, normUser } from "../util.ts";

/**
 * Hard ceiling for dormant candidates. Exports only contain SAVED chats, so silence in the
 * export is weak evidence of silence in real life. Keep below the "medium" threshold (0.45).
 */
const MAX_DORMANT_SCORE = 0.4;

const NO_CHATS_WEIGHT = 0.2;
const SILENCE_MIN_WEIGHT = 0.2; // silent for exactly `days`
const SILENCE_MAX_WEIGHT = 0.3; // silent for 3x `days` or more
const FRIENDSHIP_AGE_WEIGHT = 0.1;

function cmpKey(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Current friends with no saved 1:1 chat or Snap event (either direction) in the last `days` days.
 * Snaps arrive as the same events as chats, so a friend you only Snap is not quiet.
 *
 * Returns [] when the export has no chats or Snaps at all, or none of them is one-to-one: without
 * any activity data there is no basis for a judgement. (Conversations that were all filed as groups
 * mean the layout was probably misread; saying every friend is quiet would be a guess.) Friends whose creation date is unknown are skipped, because we cannot
 * show the friendship is older than the window (false negatives are preferred).
 */
export function findDormant(parsed: ParsedExport, opts: { now: number; days?: number }): Candidate[] {
  if (parsed.chats.length === 0) return [];

  const days = opts.days ?? 180;
  const windowMs = days * DAY_MS;
  // The export cannot know about anything after it was generated, so measure silence up to
  // that moment when it is earlier than `now`. This avoids calling people dormant just
  // because the export is stale.
  const asOf = Math.min(opts.now, parsed.exportedAt ?? opts.now);

  // Single pass: latest 1:1 event per person, and how far back the chat data reaches at all.
  const lastEvent = new Map<string, number>();
  let earliestAny = Infinity;
  for (const m of parsed.chats) {
    if (m.at < earliestAny) earliestAny = m.at;
    if (m.isGroup) continue;
    const key = normUser(m.conversation);
    const prev = lastEvent.get(key);
    if (prev === undefined || m.at > prev) lastEvent.set(key, m.at);
  }
  if (lastEvent.size === 0) return [];
  // A date-limited export holds only recent chats; if the data does not reach back across the
  // window, "no chats" for someone cannot be told apart from "chats were cut off".
  const coversWindow = earliestAny <= asOf - windowMs;

  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const friend of parsed.friends.friends) {
    const key = normUser(friend.username);
    if (!key || seen.has(key)) continue;
    seen.add(key);

    const last = lastEvent.get(key);
    if (last === undefined && !coversWindow) continue;
    const candidate = assess(friend, key, last, asOf, windowMs, days);
    if (candidate) out.push(candidate);
  }

  return out.sort((a, b) => b.score - a.score || cmpKey(a.key, b.key));
}

function assess(
  friend: FriendRecord,
  key: string,
  last: number | undefined,
  asOf: number,
  windowMs: number,
  days: number,
): Candidate | undefined {
  // Friendship must predate the window, otherwise there was never time to chat.
  if (friend.createdAt === undefined || asOf - friend.createdAt < windowMs) return undefined;
  // Any event inside the window (or later than the reference point) means not dormant.
  if (last !== undefined && asOf - last < windowMs) return undefined;

  const evidence: Evidence[] = [];
  if (last === undefined) {
    evidence.push({
      signal: "no-saved-chats",
      detail: "No saved one-to-one chat or Snap activity with this friend appears anywhere in the export.",
      weight: NO_CHATS_WEIGHT,
    });
  } else {
    const silentDays = (asOf - last) / DAY_MS;
    // Longer silence is slightly stronger, saturating at 3x the window.
    const t = Math.min(1, Math.max(0, (silentDays / days - 1) / 2));
    evidence.push({
      signal: "last-saved-chat-old",
      detail: `The most recent saved one-to-one chat or Snap activity with this friend is from ${formatDay(last)} (${groupDigits(silentDays)} days before the export).`,
      weight: SILENCE_MIN_WEIGHT + (SILENCE_MAX_WEIGHT - SILENCE_MIN_WEIGHT) * t,
      at: last,
    });
  }
  evidence.push({
    signal: "friendship-older-than-window",
    detail: `You have been friends since ${formatDay(friend.createdAt)}, longer than the ${days}-day window.`,
    weight: FRIENDSHIP_AGE_WEIGHT,
    at: friend.createdAt,
  });
  evidence.push({
    signal: "chat-history-only-covers-saved-chats",
    detail:
      "The export has only saved chats and Snap history, so you may have talked in ways it cannot show (unsaved chats, calls).",
    weight: 0,
  });

  const score = Math.min(MAX_DORMANT_SCORE, combineWeights(evidence.map((e) => e.weight)));
  return {
    key,
    category: "dormant",
    confidence: confidenceFromScore(score),
    score,
    evidence,
    protectedBy: [],
  };
}
