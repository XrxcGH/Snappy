/**
 * Privacy tune-up: the pure step. The checklist reads nothing from the export, so the result is the list of
 * settings from core with the person's marks applied. Marks arrive as "tool-id:item-id" ticks (the dashboard's
 * session or saved-history mechanism), and only the ones for this tool are used.
 */
import { insights } from "@snappy-export/core";
import type { ToolData } from "../data.ts";

export type PrivacyTuneup = insights.privacyTuneup.TuneupResult;

const PREFIX = "privacy-tuneup:";

/** The checklist with nothing marked: the sections and settings in display order. */
export function computePrivacyTuneup(data: ToolData): PrivacyTuneup {
  return insights.privacyTuneup.buildPrivacyTuneup([], data.now);
}

/** The checklist with these ticks applied as "done". Ticks for other tools and unknown settings are left out. */
export function applyMarks(ticks: readonly string[], now: number): PrivacyTuneup {
  const known = new Set(insights.privacyTuneup.PRIVACY_TUNEUP_ITEMS.map((i) => i.id));
  const entries = ticks
    .filter((t) => t.startsWith(PREFIX))
    .map((t) => ({ id: t.slice(PREFIX.length), state: "done" as const }))
    .filter((e) => known.has(e.id));
  return insights.privacyTuneup.buildPrivacyTuneup(entries, now);
}
