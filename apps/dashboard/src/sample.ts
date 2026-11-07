/**
 * Sample data for "Try with sample data": two made-up exports, 120 days apart, built in the
 * browser from core's synthetic generator. Nothing here comes from a real account.
 */
import { addSnapshot, bytesReader, emptyLedger, mergeParsedExports, parseExportFromReader, snapshotFromExport, syntheticExportZip } from "@snappy-export/core";
import type { ParsedExport } from "@snappy-export/core";
import { exportHealth } from "./issues.ts";
import type { Workspace } from "./reducer.ts";

/** Fixed so the sample looks the same every day: Nov 6, 2026, noon UTC. */
export const SAMPLE_NOW = Date.UTC(2026, 10, 6, 12, 0, 0);

async function parseZip(zip: Uint8Array): Promise<ParsedExport> {
  return mergeParsedExports([await parseExportFromReader(bytesReader(zip))]);
}

export async function buildSampleWorkspace(onStep: (step: number) => Promise<void> | void = () => {}): Promise<Workspace> {
  await onStep(0);
  const earlier = await parseZip(syntheticExportZip({ now: SAMPLE_NOW, phase: 1, realisticMemories: true }));
  await onStep(1);
  const later = await parseZip(syntheticExportZip({ now: SAMPLE_NOW, phase: 2, realisticMemories: true }));
  await onStep(2);

  let ledger = emptyLedger();
  for (const parsed of [earlier, later]) ledger = addSnapshot(ledger, snapshotFromExport(parsed));
  return { latest: later, ledger, allowlist: [], checkedOff: [], issues: exportHealth(later, { now: SAMPLE_NOW }), now: SAMPLE_NOW };
}
