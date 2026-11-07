/**
 * Turns a workspace into everything the views show. Pure, and memoised on object identity so
 * that keeping one person recomputes only the queue, and editing the storage cap recomputes
 * only the Memories plan.
 */
import { buildCleanupQueue, diffSnapshots, findDormant, findGhosts, findOneWay, planMemories } from "@snappy-export/core";
import type { Candidate, CleanupQueue, LedgerDiff, MemoriesPlan, ParsedExport, Snapshot } from "@snappy-export/core";
import { gibToBytes } from "./format.ts";
import type { State, Workspace } from "./reducer.ts";
import { activeWorkspace } from "./reducer.ts";

export type FindingsSource = "export" | "ledger" | "none";

export interface Analysis {
  workspace: Workspace;
  /** Made-up sample data is showing: nothing here may point at a real account. */
  sample: boolean;
  snapshotCount: number;
  /** Where friend lists, requests and memories come from: this session's export, the newest saved snapshot, or nothing. */
  source: FindingsSource;
  parsed: ParsedExport | null;
  /** The export carried chat metadata, which Quiet friends needs. */
  hasChats: boolean;
  ghosts: Candidate[];
  oneWay: Candidate[];
  dormant: Candidate[];
  queue: CleanupQueue;
  /** Changes between the two newest snapshots, when there are two. */
  lastDiff: LedgerDiff | null;
  plan: MemoriesPlan | null;
}

const has = (record: Record<string, number | undefined | null>, key: string): boolean => Object.hasOwn(record, key);

/**
 * A saved snapshot holds friends, requests, deletions and blocks, which is all the one-way
 * detector reads. This lets a freshly unlocked ledger show "Requests no one accepted" before
 * any export is added. Chats and memories are never stored, so they stay empty.
 */
export function parsedFromSnapshot(snap: Snapshot): ParsedExport {
  return {
    friends: {
      friends: snap.friends.map((username) => ({ username, createdAt: has(snap.friendSince, username) ? snap.friendSince[username] : undefined })),
      sentRequests: snap.sentRequests.map((username) => ({ username, createdAt: has(snap.sentAt, username) ? snap.sentAt[username] : undefined })),
      pendingRequests: [],
      deletedFriends: Object.keys(snap.deleted).map((username) => ({ username, deletedAt: snap.deleted[username] ?? undefined })),
      blocked: (snap.blocked ?? []).map((username) => ({ username })),
      ignored: [],
      hiddenSuggestions: [],
    },
    chats: [],
    memories: [],
    exportedAt: snap.takenAt,
    fileList: [],
    issues: [],
  };
}

/** Clears every memo below. Each holds its last arguments and result, so each can hold the whole export. */
const resets: (() => void)[] = [];

/**
 * Forget the last analysis. Called when the page is locked or wiped, because the memos keep the
 * unsealed export (usernames, chat metadata) reachable until the next analysis replaces it, and
 * pages like Settings never run one.
 */
export function resetAnalysisCache(): void {
  for (const reset of resets) reset();
}

/** One-slot memo keyed by argument identity. */
function memoLast<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  let lastArgs: A | undefined;
  let lastResult: R | undefined;
  resets.push(() => {
    lastArgs = undefined;
    lastResult = undefined;
  });
  return (...args: A): R => {
    if (lastArgs && lastArgs.length === args.length && lastArgs.every((a, i) => a === args[i])) return lastResult as R;
    const result = fn(...args);
    lastResult = result;
    lastArgs = args;
    return result;
  };
}

interface Detected {
  parsed: ParsedExport | null;
  source: FindingsSource;
  ghosts: Candidate[];
  oneWay: Candidate[];
  dormant: Candidate[];
  lastDiff: LedgerDiff | null;
}

const detect = memoLast((ledger: Workspace["ledger"], latest: ParsedExport | null, now: number): Detected => {
  const snaps = ledger.snapshots;
  const newestSnapshot = snaps[snaps.length - 1];
  const parsed = latest ?? (newestSnapshot ? parsedFromSnapshot(newestSnapshot) : null);
  const source: FindingsSource = latest ? "export" : newestSnapshot ? "ledger" : "none";

  const previous = snaps[snaps.length - 2];
  return {
    parsed,
    source,
    ghosts: findGhosts(snaps, { now }),
    oneWay: parsed ? findOneWay(parsed, { now }) : [],
    dormant: parsed ? findDormant(parsed, { now }) : [],
    lastDiff: previous && newestSnapshot ? diffSnapshots(previous, newestSnapshot, []) : null,
  };
});

const queueFor = memoLast((det: Detected, allowlist: string[], now: number): CleanupQueue =>
  buildCleanupQueue([...det.ghosts, ...det.oneWay, ...det.dormant], det.parsed?.chats ?? [], { now, allowlist, ...(det.parsed?.exportedAt !== undefined && { exportedAt: det.parsed.exportedAt }) }),
);

const planFor = memoLast((parsed: ParsedExport | null, capGiB: number, now: number): MemoriesPlan | null =>
  parsed && parsed.memories.length > 0 ? planMemories(parsed.memories, { capBytes: gibToBytes(capGiB), now }) : null,
);

export function analyze(state: State): Analysis {
  const ws = activeWorkspace(state);
  const det = detect(ws.ledger, ws.latest, ws.now);
  return {
    workspace: ws,
    sample: state.sample !== null,
    snapshotCount: ws.ledger.snapshots.length,
    source: det.source,
    parsed: det.parsed,
    hasChats: (det.parsed?.chats.length ?? 0) > 0,
    ghosts: det.ghosts,
    oneWay: det.oneWay,
    dormant: det.dormant,
    queue: queueFor(det, ws.allowlist, ws.now),
    lastDiff: det.lastDiff,
    plan: planFor(det.parsed, state.capGiB, ws.now),
  };
}

/** Candidates in the queue (removable or protected), by username, for showing protection next to category lists. */
export function protectionByUser(queue: CleanupQueue): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const c of queue.protectedItems) map.set(c.key, c.protectedBy);
  return map;
}

export interface QueueFilter {
  category: "all" | Candidate["category"];
  confidence: "all" | Candidate["confidence"];
}

/** Queue items that match the chosen category and confidence. */
export function filterCandidates(items: readonly Candidate[], filter: QueueFilter): Candidate[] {
  return items.filter((c) => (filter.category === "all" || c.category === filter.category) && (filter.confidence === "all" || c.confidence === filter.confidence));
}
