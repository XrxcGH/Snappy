/**
 * Safety checklist: the pure step. The checklist is self-reported, so the only thing computed from the export is
 * two counts (blocked people and pending requests) that become hints on two items. The result holds no username.
 * Progress is a separate pure function of the marks, because marks change after the result is computed.
 */
import { insights } from "@snappy-export/core";
import type { ToolData } from "../data.ts";

export type SafetyItemId = insights.safetyChecklist.SafetyItemId;
export type SafetyProgress = insights.safetyChecklist.SafetyProgress;

/** Marks are stored as "<tool id>:<item id>". */
export const MARK_PREFIX = "safety-checklist:";

export interface SafetyHint {
  kind: "blocked" | "pending";
  count: number;
}

export interface SafetyChecklistResult {
  /** The items in display order, each with a count-based hint from the export when there is one. */
  items: { id: SafetyItemId; hint?: SafetyHint }[];
  /** An export is loaded, so the counts mean something. */
  hasExport: boolean;
}

export function computeSafetyChecklist(data: ToolData): SafetyChecklistResult {
  const friends = data.parsed?.friends;
  const built = insights.safetyChecklist.buildSafetyChecklist({ now: data.now, ...(friends !== undefined && { friends }) });
  return {
    items: built.items.map((item) => {
      const hint: SafetyHint | undefined = item.hint && { kind: item.hint.code === "blocked-entries" ? "blocked" : "pending", count: item.hint.params.count ?? 0 };
      return { id: item.id, ...(hint !== undefined && { hint }) };
    }),
    hasExport: data.parsed !== null,
  };
}

/** Progress for the marks the person made, read from the saved or session ticks. Other tools' marks are ignored. */
export function safetyProgress(ticks: readonly string[], now: number): SafetyProgress {
  const marks = Object.fromEntries(ticks.filter((t) => t.startsWith(MARK_PREFIX)).map((t) => [t.slice(MARK_PREFIX.length), true]));
  return insights.safetyChecklist.buildSafetyChecklist({ now, ticks: marks }).progress;
}
