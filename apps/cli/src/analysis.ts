/**
 * The analysis itself: a pure function from a parsed export plus the ledger to a cleanup queue.
 * It touches no files and no clock ("now" is a parameter), so it is easy to test and reason about.
 */
import {
  buildCleanupQueue,
  diffSnapshots,
  findDormant,
  findGhosts,
  findOneWay,
} from "@snappy-export/core";
import type { Candidate, CandidateCategory, CleanupQueue, Confidence, Ledger, LedgerDiff, MemoriesPairing, ParsedExport } from "@snappy-export/core";

export interface AnalysisInput {
  /** The export being analyzed (all parts merged). */
  parsed: ParsedExport;
  /** Every snapshot on record, including the one made from `parsed`. */
  ledger: Ledger;
  /** Normalized usernames that must never appear in the queue. */
  allowlist: string[];
  now: number;
  minConfidence: Confidence;
}

export interface AnalysisResult {
  snapshotCount: number;
  latestTakenAt?: number;
  previousTakenAt?: number;
  /** What changed between the two newest snapshots, when there are at least two. */
  changes?: LedgerDiff;
  /** Disappeared friends need two exports to compare. */
  canFindDisappeared: boolean;
  queue: CleanupQueue;
  /** Chat and Snap events together: both count as activity with a friend. */
  counts: { friends: number; sentRequests: number; removedByYou: number; chatEvents: number; memories: number };
  /** How the Memories list fits the files in the zips (counts only); absent when the zips hold no Memories files. */
  memoriesPairing?: MemoriesPairing;
}

export function analyzeExport(input: AnalysisInput): AnalysisResult {
  const { parsed, ledger, now } = input;
  const snapshots = ledger.snapshots;
  const canFindDisappeared = snapshots.length >= 2;

  // The allowlist is NOT passed to the detectors: protected people stay visible (as a count)
  // in the queue instead of silently vanishing.
  const candidates: Candidate[] = [
    ...findGhosts(snapshots, { now }),
    ...findOneWay(parsed, { now }),
    ...findDormant(parsed, { now }),
  ];
  const queue = buildCleanupQueue(candidates, parsed.chats, {
    now,
    ...(parsed.exportedAt !== undefined && { exportedAt: parsed.exportedAt }),
    allowlist: input.allowlist,
    minConfidence: input.minConfidence,
  });

  const latest = snapshots[snapshots.length - 1];
  const previous = snapshots[snapshots.length - 2];
  return {
    snapshotCount: snapshots.length,
    latestTakenAt: latest?.takenAt,
    previousTakenAt: previous?.takenAt,
    changes: latest && previous ? diffSnapshots(previous, latest, snapshots.slice(0, -2)) : undefined,
    canFindDisappeared,
    queue,
    counts: {
      friends: parsed.friends.friends.length,
      sentRequests: parsed.friends.sentRequests.length,
      removedByYou: parsed.friends.deletedFriends.length,
      chatEvents: parsed.chats.length,
      memories: parsed.memories.length,
    },
    memoriesPairing: parsed.memoriesPairing,
  };
}

/**
 * User-facing names for the detectors' categories. The words follow the brand guide: the first
 * is a stable id for JSON and CSV, the second the feature name, the third a short table label.
 */
export const CATEGORY: Record<CandidateCategory, { id: string; feature: string; label: string }> = {
  ghost: { id: "disappeared", feature: "Disappeared friends", label: "Disappeared" },
  "one-way": { id: "not-accepted", feature: "Unaccepted requests", label: "Unaccepted" },
  dormant: { id: "quiet", feature: "Quiet friends", label: "Quiet" },
};

/** The most telling line of evidence: the heaviest signal that contributes to the score. */
export function evidenceSummary(candidate: Candidate): string {
  let best = candidate.evidence[0];
  for (const e of candidate.evidence) if (best === undefined || e.weight > best.weight) best = e;
  return best?.detail ?? "";
}
