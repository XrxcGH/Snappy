import type { Candidate, Evidence, FriendRecord, ParsedExport } from "../types.ts";
import { DAY_MS, combineWeights, confidenceFromScore, formatDay, normUser } from "../util.ts";
import { daysText } from "./day-text.ts";

/**
 * Hard ceiling for one-way candidates. A sent request that was never accepted may simply
 * have been ignored, declined, or never seen, so even a very old request is not strong proof.
 */
const MAX_ONEWAY_SCORE = 0.7;

/** Piecewise-linear age -> weight anchors (days, weight). Flat outside the range. */
const AGE_ANCHORS: ReadonlyArray<readonly [number, number]> = [
  [14, 0.1], // young enough that the other person may just not have looked yet
  [60, 0.3],
  [180, 0.55], // strong, but combined with the base weight it stays under the cap
];

const NEVER_ACCEPTED_WEIGHT = 0.15;
const UNKNOWN_AGE_WEIGHT = 0.1;

function ageWeight(ageDays: number): number {
  const first = AGE_ANCHORS[0]!;
  const last = AGE_ANCHORS[AGE_ANCHORS.length - 1]!;
  if (ageDays <= first[0]) return first[1];
  if (ageDays >= last[0]) return last[1];
  for (let i = 1; i < AGE_ANCHORS.length; i++) {
    const [d1, w1] = AGE_ANCHORS[i]!;
    const [d0, w0] = AGE_ANCHORS[i - 1]!;
    if (ageDays <= d1) return w0 + ((w1 - w0) * (ageDays - d0)) / (d1 - d0);
  }
  return last[1];
}

function cmpKey(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Outgoing friend requests that never turned into a friendship.
 *
 * This is an inference only: Snapchat gives no signal about why a request is still open.
 * Requests to people who are current friends, were deleted by the user, or are blocked are
 * explained by other states and are excluded.
 *
 * Returns [] when the friends list is empty: a date-limited or broken export can drop the
 * friends section, which would make every accepted request look unanswered.
 */
export function findOneWay(parsed: ParsedExport, opts: { now: number; minAgeDays?: number }): Candidate[] {
  const minAgeDays = opts.minAgeDays ?? 14;
  const { friends, sentRequests, deletedFriends, blocked } = parsed.friends;
  if (friends.length === 0) return [];

  // Anyone already explained by another state is not a "never accepted" request.
  const excluded = new Set<string>();
  for (const list of [friends, deletedFriends, blocked]) {
    for (const r of list) excluded.add(normUser(r.username));
  }

  // One request per person; if the export lists duplicates keep the oldest send time.
  const byKey = new Map<string, FriendRecord>();
  for (const req of sentRequests) {
    const key = normUser(req.username);
    if (!key || excluded.has(key)) continue;
    const prev = byKey.get(key);
    const better =
      !prev ||
      (req.createdAt !== undefined && (prev.createdAt === undefined || req.createdAt < prev.createdAt));
    if (better) byKey.set(key, req);
  }

  const out: Candidate[] = [];
  for (const [key, req] of byKey) {
    const evidence: Evidence[] = [
      {
        signal: "request-never-accepted",
        detail:
          "You sent this person a friend request and they are not in your friends list. " +
          "They may have declined it, never seen it, or ignored it on purpose; this is not proof of anything.",
        weight: NEVER_ACCEPTED_WEIGHT,
        ...(req.createdAt !== undefined ? { at: req.createdAt } : {}),
      },
    ];

    if (req.createdAt === undefined) {
      evidence.push({
        signal: "unknown-request-age",
        detail: "The export does not say when this request was sent, so its age is unknown.",
        weight: UNKNOWN_AGE_WEIGHT,
      });
    } else {
      const ageDays = (opts.now - req.createdAt) / DAY_MS;
      // Too young (or dated in the future): the other person has had little chance to respond.
      if (ageDays < minAgeDays) continue;
      evidence.push({
        signal: "request-age",
        detail: `Request sent ${formatDay(req.createdAt)}, ${daysText(ageDays)} ago. Not accepted yet.`,
        weight: ageWeight(ageDays),
        at: req.createdAt,
      });
    }

    const score = Math.min(MAX_ONEWAY_SCORE, combineWeights(evidence.map((e) => e.weight)));
    out.push({
      key,
      category: "one-way",
      confidence: confidenceFromScore(score),
      score,
      evidence,
      protectedBy: [],
    });
  }

  // Strongest first; key as tie-break keeps output deterministic.
  return out.sort((a, b) => b.score - a.score || cmpKey(a.key, b.key));
}
