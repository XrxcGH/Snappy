/**
 * How a tool gets its data, in one place.
 *
 * Decision: a tool reads what the dashboard already holds, by reference, and computes on demand.
 *   - The import worker already hands the page a compact, metadata-only export (chat events are packed into
 *     typed arrays and unpacked once). Nothing is copied, re-sent or kept a second time for a tool.
 *   - A tool's `compute` is a pure function of ToolData (and its own small parameters). It runs when its page
 *     opens, after the page has painted (see run.ts), in one pass, and returns a small plain result: counts,
 *     dates and codes, plus names only where a result table is meant to show them.
 *   - Results are held one per tool and forgotten with the analysis cache, so Lock and Delete saved history clear them too.
 *
 * A pass that one day proves too heavy for the page moves into a worker task behind run.ts. Views and
 * models do not change, because they only ever see ToolData in and a plain result out.
 */
import { onAnalysisReset, sourceOf } from "../analysis.ts";
import type { FindingsSource } from "../analysis.ts";
import type { ExportIssue, Ledger, ParsedExport } from "@snappy-export/core";
import { activeWorkspace } from "../reducer.ts";
import type { State } from "../reducer.ts";
import type { ToolNeed } from "./types.ts";

export interface ToolData {
  /** This session's export, else the newest saved snapshot rebuilt into one (friends and requests only). Null when there is nothing. */
  readonly parsed: ParsedExport | null;
  readonly source: FindingsSource;
  /** Made-up sample data is showing. */
  readonly sample: boolean;
  /** Epoch ms for ages and "today". Fixed for sample data; core never reads a clock. */
  readonly now: number;
  /** The export's health notes from import (codes and counts, no export values). */
  readonly issues: readonly ExportIssue[];
  readonly ledger: Ledger;
  /** ZIP parts read for `parsed`, or null when unknown (sample data, saved history). */
  readonly parts: number | null;
  /** Snapchat's free storage cap in GB, as the person set it. */
  readonly capGiB: number;
  /** The last export that was added was refused. */
  readonly importFailed: boolean;
  /**
   * The snapshots in `ledger` are really saved: saving is on and unlocked, or the sample is showing. With saving off the ledger
   * only holds this session's imports, which are not saved history and must not be described or compared as if they were.
   */
  readonly savedHistory: boolean;
}

let last: { key: readonly unknown[]; data: ToolData } | undefined;

const sameKey = (a: readonly unknown[], b: readonly unknown[]): boolean => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));

/** Forget the held data. Called with the analysis reset, so a locked or wiped page keeps no export reachable here. */
export function resetToolData(): void {
  last = undefined;
}

onAnalysisReset(resetToolData);

/**
 * The data for the active workspace. One slot, keyed on the parts that matter, so editing the keep list
 * does not hand every tool "new" data, and an unchanged page gets the very same object back.
 */
export function toolData(state: State): ToolData {
  const ws = activeWorkspace(state);
  const { parsed, source } = sourceOf(ws.ledger, ws.latest);
  const sample = state.sample !== null;
  const importFailed = state.import.phase === "failed";
  const savedHistory = sample || state.vault.phase === "unlocked";
  const key = [parsed, source, sample, ws.now, ws.issues, ws.ledger, ws.parts, state.capGiB, importFailed, savedHistory] as const;
  if (last && sameKey(last.key, key)) return last.data;
  const data: ToolData = { parsed, source, sample, now: ws.now, issues: ws.issues, ledger: ws.ledger, parts: ws.parts ?? null, capGiB: state.capGiB, importFailed, savedHistory };
  last = { key, data };
  return data;
}

/** What a tool page or the hub repaints on: the active data, either workspace, the storage cap and whether an import failed. */
export const toolDeps = (s: State): readonly unknown[] => [s.sample, s.real, s.capGiB, s.import.phase, s.vault.phase];

/** The first need the data cannot meet, or null when the tool can run. An empty list is always met. */
export function unmetNeed(data: ToolData, needs: readonly ToolNeed[]): ToolNeed | null {
  if (needs.length === 0) return null;
  // Nothing at all is loaded: whatever the tool asks for, the first step is the same.
  if (data.parsed === null) return "export";
  if (needs.includes("export") && data.source !== "export") return "export";
  const p = data.parsed;
  if (needs.includes("friends") && p.friends.friends.length === 0) return "friends";
  if (needs.includes("chats") && p.chats.length === 0) return "chats";
  if (needs.includes("memories") && p.memories.length === 0) return "memories";
  return null;
}
