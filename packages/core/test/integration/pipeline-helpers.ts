/** Shared full-pipeline runner for integration and privacy tests (synthetic data only). */
import {
  addSnapshot,
  buildCleanupQueue,
  emptyLedger,
  findDormant,
  findGhosts,
  findOneWay,
  parseExportZip,
  planMemories,
  serializeLedger,
  snapshotFromExport,
  syntheticExportZip,
  validateExport,
} from "../../src/index.ts";
import type {
  Candidate,
  CleanupQueue,
  ExportIssue,
  Ledger,
  MemoriesPlan,
  ParsedExport,
  Snapshot,
} from "../../src/index.ts";

export const FIXED_NOW = Date.UTC(2025, 5, 1, 12, 0, 0);

export interface PipelineResult {
  now: number;
  parsed1: ParsedExport;
  parsed2: ParsedExport;
  snap1: Snapshot;
  snap2: Snapshot;
  ledger: Ledger;
  ledger1: Ledger;
  serialized: string;
  validateIssues: ExportIssue[];
  ghosts: Candidate[];
  ghostsOneSnapshot: Candidate[];
  oneWay: Candidate[];
  dormant: Candidate[];
  queue: CleanupQueue;
  plan: MemoriesPlan;
}

export function runPipeline(opts: { seed?: number; friendCount?: number; allowlist?: string[] } = {}): PipelineResult {
  const now = FIXED_NOW;
  const base = { now, ...(opts.seed !== undefined ? { seed: opts.seed } : {}), ...(opts.friendCount !== undefined ? { friendCount: opts.friendCount } : {}) };
  const zip1 = syntheticExportZip({ ...base, phase: 1 });
  const zip2 = syntheticExportZip({ ...base, phase: 2 });
  const parsed1 = parseExportZip(zip1);
  const parsed2 = parseExportZip(zip2);
  const snap1 = snapshotFromExport(parsed1);
  const snap2 = snapshotFromExport(parsed2);
  const ledger1 = addSnapshot(emptyLedger(), snap1);
  const ledger = addSnapshot(ledger1, snap2);
  const validateIssues = [...validateExport(parsed1), ...validateExport(parsed2)];

  const ghosts = findGhosts(ledger.snapshots, { now });
  const ghostsOneSnapshot = findGhosts(ledger1.snapshots, { now });
  const oneWay = findOneWay(parsed2, { now });
  const dormant = findDormant(parsed2, { now });
  const queue = buildCleanupQueue([...ghosts, ...oneWay, ...dormant], parsed2.chats, {
    now,
    ...(opts.allowlist ? { allowlist: opts.allowlist } : {}),
  });
  const plan = planMemories(parsed2.memories, { now });
  return {
    now, parsed1, parsed2, snap1, snap2, ledger, ledger1,
    serialized: serializeLedger(ledger),
    validateIssues, ghosts, ghostsOneSnapshot, oneWay, dormant, queue, plan,
  };
}
