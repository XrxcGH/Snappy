/**
 * The cleanup list as CSV or plain text. Contains usernames, categories, confidence and core's evidence sentence; nothing
 * else. The profile link column is empty when profileLinks is false (sample names, or a shell that has links off).
 */
import type { Candidate } from "@snappy-export/core";
import { categories, cleanup, common } from "./copy.ts";
import { linesText, toCsv } from "./csv.ts";
import { headlineEvidence } from "./evidence.ts";
import { safeProfileUrl } from "./safe.ts";

export function queueToCsv(items: readonly Candidate[], profileLinks = true): string {
  const rows = items.map((c) => [
    c.key,
    categories[c.category].label,
    common.confidenceWord[c.confidence],
    headlineEvidence(c.evidence)?.detail ?? "",
    (profileLinks ? safeProfileUrl(c.key) : null) ?? "",
  ]);
  return toCsv(cleanup.csvHeader, rows);
}

export function queueToText(items: readonly Candidate[]): string {
  return linesText(items.map((c) => c.key));
}
