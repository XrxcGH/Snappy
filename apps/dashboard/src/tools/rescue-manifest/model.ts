/**
 * Rescue manifest: the pure step. It plans the export's Memories the way the command does (same folder layout),
 * turns the plan into records and hands them to core's rescueManifest. The result holds the manifest and the
 * notes by code. Nothing here is text, and the manifest holds only names Snappy generates, never an export link.
 *
 * Sizes are left out on purpose: a size must be the size of the saved file, which only a folder can tell.
 */
import { insights, planMemories } from "@snappy-export/core";
import type { ToolData } from "../data.ts";

export type RescueManifest = insights.rescueManifest.RescueManifest;
export type RescueNote = insights.rescueManifest.RescueNote<insights.rescueManifest.ManifestNoteCode>;

export interface RescueManifestResult {
  manifest: RescueManifest;
  notes: RescueNote[];
  /** Memories in the plan, before any item was left out of the manifest. */
  planned: number;
  /** Memories that look like repeats of another by metadata, which the plan leaves out. */
  repeats: number;
}

export function computeRescueManifest(data: ToolData): RescueManifestResult {
  const { parsed } = data;
  if (parsed === null) throw new Error("needs an export");
  const plan = planMemories(parsed.memories, { layout: "year-month" });
  const records = insights.rescueManifest.recordsFromPlan(plan.entries);
  const { manifest, notes } = insights.rescueManifest.buildRescueManifest(records, { now: data.now });
  return { manifest, notes, planned: plan.entries.length, repeats: plan.duplicates.length };
}

/** The exact file text. Called only when the download button is pressed. */
export const manifestText = (result: RescueManifestResult): string => insights.rescueManifest.serializeRescueManifest(result.manifest);
