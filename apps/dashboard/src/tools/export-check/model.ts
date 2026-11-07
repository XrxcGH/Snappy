/**
 * Export check: the pure step. It hands the export the dashboard already holds to core's exportCheck and
 * returns its result as it is: codes, counts and dates, never a username, file name or link.
 *
 * What the page cannot know that the command can: the zip directories (so, per-part empty or unreadable
 * files). The page passes the number of parts it read when it knows it, so "more parts may exist" still works.
 */
import { insights } from "@snappy-export/core";
import type { ToolData } from "../data.ts";

export type ExportCheck = insights.exportCheck.ExportCheck;

export interface ExportCheckResult {
  check: ExportCheck;
  /** The number of ZIP parts is known (a real import). For sample data it is not, and the page does not state it. */
  partsKnown: boolean;
}

export function computeExportCheck(data: ToolData): ExportCheckResult {
  const { parsed } = data;
  if (parsed === null) throw new Error("needs an export");
  const check = insights.exportCheck.checkExport({
    parsed,
    now: data.now,
    validation: [...data.issues],
    ...(data.parts !== null && { partCount: data.parts }),
  });
  return { check, partsKnown: data.parts !== null };
}
