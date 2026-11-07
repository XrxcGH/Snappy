/** The cleanup list as CSV or plain text. Contains usernames, categories, confidence and core's evidence sentence; nothing else. */
import type { Candidate } from "@snappy-export/core";
import { categories, cleanup, common } from "./copy.ts";
import { linesText, toCsv } from "./csv.ts";
import { headlineEvidence } from "./evidence.ts";
import { safeProfileUrl } from "./safe.ts";

export function queueToCsv(items: readonly Candidate[]): string {
  const rows = items.map((c) => [
    c.key,
    categories[c.category].label,
    common.confidenceWord[c.confidence],
    headlineEvidence(c.evidence)?.detail ?? "",
    safeProfileUrl(c.key) ?? "",
  ]);
  return toCsv(cleanup.csvHeader, rows);
}

export function queueToText(items: readonly Candidate[]): string {
  return linesText(items.map((c) => c.key));
}
