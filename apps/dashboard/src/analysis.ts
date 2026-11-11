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
import { displayUsername } from "./safe.ts";

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
 * detector reads. This lets a freshly unlocked ledger show "Unaccepted requests" before
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

/** Lets a cache outside this file (the tools' results) be forgotten together with the analysis, on Lock and Delete saved history. */
export function onAnalysisReset(reset: () => void): void {
  resets.push(reset);
}

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

/** What the findings and the tools read: this session's export, else the newest saved snapshot rebuilt into one. */
export const sourceOf = memoLast((ledger: Workspace["ledger"], latest: ParsedExport | null): { parsed: ParsedExport | null; source: FindingsSource } => {
  const newestSnapshot = ledger.snapshots[ledger.snapshots.length - 1];
  return {
    parsed: latest ?? (newestSnapshot ? parsedFromSnapshot(newestSnapshot) : null),
    source: latest ? "export" : newestSnapshot ? "ledger" : "none",
  };
});

const detect = memoLast((ledger: Workspace["ledger"], latest: ParsedExport | null, now: number): Detected => {
  const snaps = ledger.snapshots;
  const newestSnapshot = snaps[snaps.length - 1];
  const { parsed, source } = sourceOf(ledger, latest);

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
  /** Part of a username to look for. Empty or absent: no search. */
  query?: string;
}

/** True when `query` is empty, or appears in the username as it is shown (case does not matter). */
export function matchesQuery(username: string, query: string | undefined): boolean {
  const wanted = (query ?? "").trim().toLowerCase();
  return wanted === "" || displayUsername(username).toLowerCase().includes(wanted);
}

/** Queue items that match the chosen category, confidence and username search. */
export function filterCandidates(items: readonly Candidate[], filter: QueueFilter): Candidate[] {
  return items.filter((c) => (filter.category === "all" || c.category === filter.category) && (filter.confidence === "all" || c.confidence === filter.confidence) && matchesQuery(c.key, filter.query));
}

/** "likely" is the order the queue arrives in (highest score first). The others re-sort; ties keep that order. Newest and oldest use the date of a person's latest signal, which the row does not show, so the menu says "signal". */
export type QueueSort = "likely" | "newest" | "oldest" | "confidence";

const CONFIDENCE_RANK: Record<Candidate["confidence"], number> = { high: 3, medium: 2, low: 1 };

/** The newest date among a person's evidence, or undefined when none of it is dated. */
function newestEvidence(c: Candidate): number | undefined {
  let latest: number | undefined;
  for (const e of c.evidence) if (typeof e.at === "number" && Number.isFinite(e.at) && (latest === undefined || e.at > latest)) latest = e.at;
  return latest;
}

/** A sorted copy. People with no dated evidence go last for newest and oldest. */
export function sortCandidates(items: readonly Candidate[], order: QueueSort): Candidate[] {
  const copy = [...items];
  if (order === "likely") return copy;
  if (order === "confidence") return copy.sort((a, b) => CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence] || b.score - a.score);
  const sign = order === "newest" ? -1 : 1;
  return copy.sort((a, b) => {
    const x = newestEvidence(a);
    const y = newestEvidence(b);
    if (x === undefined || y === undefined) return x === y ? 0 : x === undefined ? 1 : -1;
    return sign * (x - y);
  });
}
