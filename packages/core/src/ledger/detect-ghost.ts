/**
 * Ghost detection: former friends who are missing from the latest export and whom the user
 * did not remove. Snapchat sends no "unadded you" signal, so everything here is inference;
 * the scoring is deliberately modest and the evidence always says what we cannot rule out.
 */
import type { Candidate, Evidence, Snapshot } from "../types.ts";
import { DAY_MS, combineWeights, confidenceFromScore, formatDay, groupDigits, normUser } from "../util.ts";

// Signal weights. With a single prior snapshot the maximum combined score is ~0.66, below
// the 0.75 "high" band: one export diff cannot distinguish an unadd from a deleted account.
const W_ABSENT = 0.45;
const W_WAS_FRIEND = 0.15;
const W_WAS_FRIEND_MAX = 0.2; // reached after 4+ sightings
const W_NOT_DELETED = 0.2;
const W_LONG_FRIENDSHIP = 0.1;
const W_CONFIRMED_TWICE = 0.15;
const W_CONFIRMED_OFTEN = 0.25;

const LONG_FRIENDSHIP_MS = 365 * DAY_MS;
/** Snapshots closer together than this are re-imports of the same data, not new confirmation. */
const MIN_CONFIRMATION_GAP_MS = DAY_MS;
/** More than this share of the previous friend list vanishing at once looks like a bad export. */
const MASS_DISAPPEARANCE_RATIO = 0.5;
const SUSPECT_SCORE_CAP = 0.3;

interface Sighting {
  /** Number of independent snapshots (before the latest) that listed the user as a friend. */
  count: number;
  /** takenAt of the last snapshot that was counted (same-day re-imports are not counted again). */
  lastCountedAt: number;
  /** Index of the last snapshot that listed them. */
  lastIdx: number;
  /** Earliest known friendship start across all sightings. */
  since?: number;
}

export function findGhosts(snapshots: Snapshot[], opts: { now: number; exclude?: string[] }): Candidate[] {
  if (snapshots.length < 2) return [];
  const sorted = [...snapshots].sort((a, b) => a.takenAt - b.takenAt);
  const lastIdx = sorted.length - 1;
  const latest = sorted[lastIdx]!;
  const excluded = new Set((opts.exclude ?? []).map(normUser));

  // A deletion recorded in ANY snapshot explains the absence for good: the export's
  // deleted list can age out entries, so we must not forget older records.
  const deletedEver = new Set<string>();
  for (const snap of sorted) for (const key of Object.keys(snap.deleted)) deletedEver.add(key);

  // Someone the USER blocked also leaves the friends list, and not because they unadded the user.
  // findOneWay excludes blocked users too; keep the two detectors in agreement.
  for (const snap of sorted) for (const key of snap.blocked ?? []) excluded.add(normUser(key));

  // One pass: record who was a friend when, and flag snapshots that look like bad exports.
  const sightings = new Map<string, Sighting>();
  const suspectReason: (string | undefined)[] = [];
  let latestFriends = new Set<string>();
  // Each snapshot is judged against the last one that looked trustworthy, not merely the previous
  // one: otherwise a truncated export repeated (20 -> 6 -> 5 friends) is flagged once and then
  // accepted as the new normal.
  let baseline: Set<string> | undefined;
  for (let i = 0; i <= lastIdx; i++) {
    const snap = sorted[i]!;
    const friends = new Set(snap.friends);
    const reason = baseline ? suspectExport(baseline, friends, deletedEver) : undefined;
    suspectReason.push(reason);
    if (reason === undefined) baseline = friends;
    if (i < lastIdx) {
      for (const key of friends) {
        const s = sightings.get(key) ?? { count: 0, lastCountedAt: -Infinity, lastIdx: i };
        // Near-duplicate snapshots are re-imports of the same data, not new sightings.
        if (s.count === 0 || snap.takenAt - s.lastCountedAt >= MIN_CONFIRMATION_GAP_MS) {
          s.count++;
          s.lastCountedAt = snap.takenAt;
        }
        s.lastIdx = i;
        const since = Object.hasOwn(snap.friendSince, key) ? snap.friendSince[key] : undefined;
        if (typeof since === "number" && Number.isFinite(since)) s.since = Math.min(s.since ?? Infinity, since);
        sightings.set(key, s);
      }
    } else {
      latestFriends = friends;
    }
  }
  const latestSuspect = suspectReason[lastIdx];
  // A ui-scan reads the friends screen and cannot see what the user deleted, so its empty
  // `deleted` map proves nothing. Deletions are only observable through an export.
  let lastExportIdx = -1;
  sorted.forEach((snap, i) => {
    if (snap.source !== "ui-scan") lastExportIdx = i;
  });

  const pending: [string, Sighting][] = [];
  for (const entry of sightings) {
    const [key] = entry;
    if (!latestFriends.has(key) && !deletedEver.has(key) && !excluded.has(key)) pending.push(entry);
  }
  const cutoff = looksLikeCutoff(pending, latest);

  const out: Candidate[] = [];
  for (const [key, s] of pending) {

    // Independent later snapshots in which they stay absent. Bad-looking exports and
    // same-day re-imports are not evidence of anything, so they are not counted.
    let absences = 0;
    let lastCountedAt = -Infinity;
    for (let j = s.lastIdx + 1; j <= lastIdx; j++) {
      if (suspectReason[j] !== undefined) continue;
      const at = sorted[j]!.takenAt;
      if (absences === 0 || at - lastCountedAt >= MIN_CONFIRMATION_GAP_MS) {
        absences++;
        lastCountedAt = at;
      }
    }

    const lastSeen = sorted[s.lastIdx]!;
    // Only a snapshot taken after they were last seen can have recorded a deletion of them.
    const deletionsObservable = lastExportIdx > s.lastIdx;
    const evidence: Evidence[] = [
      {
        signal: "absent-from-latest-export",
        detail: `Not in the friends list of the latest export (${formatDay(latest.takenAt)}).`,
        weight: W_ABSENT,
        at: latest.takenAt,
      },
      {
        signal: "was-friend-in-earlier-export",
        detail: `Listed as a friend in ${s.count} earlier export${s.count === 1 ? "" : "s"}; last seen ${formatDay(lastSeen.takenAt)}.`,
        // Seeing someone repeatedly makes "they really were a friend" more certain.
        weight: s.count >= 3 ? Math.min(W_WAS_FRIEND_MAX, W_WAS_FRIEND + 0.025 * (s.count - 2)) : W_WAS_FRIEND,
        at: lastSeen.takenAt,
      },
      deletionsObservable
        ? {
            signal: "not-deleted-by-you",
            detail: sorted.length === 2 ? "Neither export shows you removing this friend, so the reason is unknown." : `None of the ${sorted.length} exports shows you removing this friend, so the reason is unknown.`,
            weight: W_NOT_DELETED,
          }
        : {
            signal: "deletions-not-observable",
            detail:
              "The saved lists since this person was last seen cannot show friends you removed yourself, so you may have removed them. Confidence is capped at low.",
            weight: 0,
          },
    ];
    if (s.since !== undefined && opts.now - s.since > LONG_FRIENDSHIP_MS) {
      evidence.push({
        signal: "long-friendship",
        detail: `Friends since ${formatDay(s.since)}, more than a year before this analysis.`,
        weight: W_LONG_FRIENDSHIP,
        at: s.since,
      });
    }
    if (absences >= 2) {
      evidence.push({
        signal: "absent-in-multiple-later-exports",
        detail: `Still missing in ${absences} independent later exports.`,
        weight: absences >= 3 ? W_CONFIRMED_OFTEN : W_CONFIRMED_TWICE,
      });
    }
    evidence.push(
      {
        signal: "cannot-rule-out-account-deletion",
        detail:
          "Snapchat gives no signal when someone removes you. They may have removed you or closed their account, and a renamed account looks the same in an export.",
        weight: 0,
      },
      {
        signal: "cannot-rule-out-date-range",
        detail:
          "The latest export may have used a narrower date range than the earlier ones, which would hide older friends. Request a new export with “All Time” to be sure.",
        weight: 0,
      },
    );
    if (latestSuspect !== undefined) {
      evidence.push({ signal: "mass-disappearance", detail: latestSuspect, weight: 0 });
    }
    if (cutoff) {
      evidence.push({
        signal: "looks-like-date-range-cutoff",
        detail:
          "Every missing friend is older than every friend still listed, which is the pattern a date-limited export produces. Confidence is capped at low.",
        weight: 0,
      });
    }

    const combined = combineWeights(evidence.map((e) => e.weight));
    const capped = latestSuspect !== undefined || cutoff || !deletionsObservable;
    const score = capped ? Math.min(combined, SUSPECT_SCORE_CAP) : combined;
    out.push({
      key,
      category: "ghost",
      confidence: confidenceFromScore(score),
      score,
      evidence,
      protectedBy: [],
    });
  }

  return out.sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/**
 * Explain why `cur` looks like a broken export relative to `prev`, or undefined if it
 * looks plausible. Friends the user removed themselves do not count as "vanished".
 */
function suspectExport(prev: Set<string>, cur: Set<string>, deletedEver: Set<string>): string | undefined {
  if (cur.size === 0) {
    return "This export lists no friends at all, which usually means a broken or incomplete export rather than everyone leaving. Confidence is capped at low.";
  }
  if (prev.size === 0) return undefined;
  let vanished = 0;
  for (const key of prev) if (!cur.has(key) && !deletedEver.has(key)) vanished++;
  if (vanished / prev.size <= MASS_DISAPPEARANCE_RATIO) return undefined;
  return `${groupDigits(vanished)} of ${groupDigits(prev.size)} friends from the previous export are missing at once, which is more likely a partial export than that many people removing you. Confidence is capped at low.`;
}

/**
 * True when every candidate's friendship began before the oldest friendship still listed in
 * the latest export: the shape of an export cut off at some start date, not of people leaving.
 * Unknown start dates cannot prove the pattern, so they never trigger it.
 */
function looksLikeCutoff(candidates: [string, Sighting][], latest: Snapshot): boolean {
  if (candidates.length === 0) return false;
  let oldestRemaining = Infinity;
  for (const key of latest.friends) {
    const since = Object.hasOwn(latest.friendSince, key) ? latest.friendSince[key] : undefined;
    if (typeof since === "number" && Number.isFinite(since) && since < oldestRemaining) oldestRemaining = since;
  }
  if (oldestRemaining === Infinity) return false;
  return candidates.every(([, s]) => s.since !== undefined && s.since < oldestRemaining);
}

