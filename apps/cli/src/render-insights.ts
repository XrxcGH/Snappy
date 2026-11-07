/** Small output pieces the insight commands share, so every one of them looks like the rest of Snappy. */
import type { ExportIssueSeverity } from "@snappy-export/core";
import { plural } from "./format.ts";
import { PRIVACY_RESULTS, renderIssues } from "./render.ts";
import type { Term } from "./term.ts";

/** One observation for the person. `code` is the stable short word shown with --verbose. */
export interface NoteLine {
  severity: ExportIssueSeverity;
  code: string;
  text: string;
}

/**
 * Notes under their own heading, in the same style as the notes in `analyze`: errors first, each
 * with a text label. Returns no lines at all when there are no notes.
 */
export function renderNotes(notes: NoteLine[], term: Term, opts: { heading: string; verbose?: boolean }): string[] {
  if (notes.length === 0) return [];
  const lines = renderIssues(
    notes.map((n) => ({ severity: n.severity, code: n.code, message: n.text, source: "your export" })),
    term,
    opts.verbose === true,
  );
  return [term.bold(opts.heading), ...lines.slice(1)];
}

/** A heading and its indented lines, followed by a blank line. */
export function section(term: Term, heading: string, lines: string[]): string[] {
  return [term.bold(heading), ...lines.map((l) => (l === "" ? l : `  ${l}`)), ""];
}

/** The closing line every result carries. `lines` is the finished text without it. */
export function finish(lines: string[]): string {
  const body = lines.at(-1) === "" ? lines : [...lines, ""];
  return [...body, PRIVACY_RESULTS].join("\n") + "\n";
}

/** "today", "1 day ago", "12 days ago". */
export function daysAgo(days: number): string {
  return days <= 0 ? "today" : `${plural(days, "day")} ago`;
}

/** JSON for --json: two-space indent and a final line break, like `analyze --json`. */
export function jsonText(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}
