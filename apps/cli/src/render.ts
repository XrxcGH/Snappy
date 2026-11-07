/** Shared output pieces: fixed brand lines, word wrapping, and the export-check section. */
import type { ExportIssue, MemoriesPairing } from "@snappy-export/core";
import { formatCount, plural } from "./format.ts";
import type { Term } from "./term.ts";

export const NOT_AFFILIATED =
  "Snappy is an independent tool. It is not affiliated with, endorsed by, or sponsored by Snap Inc. Snapchat is a trademark of Snap Inc.";
export const PRIVACY_IMPORT =
  "Your export stays on this device. Snappy reads friend names and dates, and skips messages, photos, and locations.";
export const PRIVACY_RESULTS = "Nothing here has left your device.";

/**
 * How the Memories list fits the files in the export, as plain sentences. Counts and the matching
 * method only: nothing here names a file or an entry.
 */
export function describePairing(p: MemoriesPairing): string {
  const how =
    p.method === "utc-time"
      ? " by exact capture time"
      : p.method === "offset-time"
        ? p.extraOffsetHours === undefined
          ? ` by capture time, allowing for a ${Math.abs(p.offsetHours)}-hour clock difference`
          : ` by capture time, allowing for clock differences of ${[p.offsetHours, ...p.extraOffsetHours].map((h) => Math.abs(h)).join(" and ")} hours (as around daylight saving time)`
        : p.method === "date-type"
          ? " by date and type only"
          : "";
  const out = [`${formatCount(p.paired)} of ${plural(p.items, "Memory", "Memories")} ${p.paired === 1 ? "is" : "are"} matched to a file in your zips${how}.`];
  if (p.unmatchedItems > 0) out.push(`${formatCount(p.unmatchedItems)} ${p.unmatchedItems === 1 ? "has" : "have"} no file in them.`);
  if (p.ambiguous > 0) out.push(`${formatCount(p.ambiguous)} could not be told apart from another one and ${p.ambiguous === 1 ? "was" : "were"} left unmatched.`);
  if (p.overlays > 0) out.push(`${plural(p.overlays, "overlay file")} came with them.`);
  if (p.unmatchedFiles > 0) out.push(`${plural(p.unmatchedFiles, "file")} in the zips matched no entry.`);
  return out.join(" ");
}

/** An export issue plus which export it came from ("your export", "earlier export 1"). */
export interface LabeledIssue extends ExportIssue {
  source: string;
}

export function wrapText(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line !== "" && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line === "" ? word : `${line} ${word}`;
    }
  }
  if (line !== "") lines.push(line);
  return lines;
}

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 } as const;

/** Errors first, then warnings, then notes. Each carries a text label, so color is never the only cue. */
export function renderIssues(issues: LabeledIssue[], term: Term): string[] {
  const out: string[] = [term.bold("Export check")];
  if (issues.length === 0) return [...out, "  No problems found in the export."];

  const sorted = [...issues].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const paint = { error: term.danger, warning: term.warn, info: term.info } as const;
  const label = { error: "Error", warning: "Warning", info: "Note" } as const;
  const indent = " ".repeat(11);
  const width = Math.max(40, term.columns - indent.length - 1);
  for (const issue of sorted) {
    const [first = "", ...rest] = wrapText(issue.message, width);
    const where = issue.source === "your export" ? "" : ` (${issue.source})`;
    out.push(`  ${paint[issue.severity](label[issue.severity].padEnd(8))} ${first}`);
    for (const line of rest) out.push(`${indent}${line}`);
    out.push(`${indent}${term.dim(`code: ${issue.code}${where}`)}`);
  }
  return out;
}
