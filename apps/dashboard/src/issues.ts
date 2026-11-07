import { validateExport } from "@snappy-export/core";
import type { ExportIssue, ParsedExport } from "@snappy-export/core";

const SEVERITY_ORDER: Record<ExportIssue["severity"], number> = { error: 0, warning: 1, info: 2 };

/** Errors first, then warnings, then notes; stable within a severity. */
export function sortIssues(issues: readonly ExportIssue[]): ExportIssue[] {
  return issues
    .map((issue, index) => ({ issue, index }))
    .sort((a, b) => SEVERITY_ORDER[a.issue.severity] - SEVERITY_ORDER[b.issue.severity] || a.index - b.index)
    .map((x) => x.issue);
}

/** Parse issues plus whole-export checks (friend count, date range), without duplicates. */
export function exportHealth(parsed: ParsedExport, hints: { expectedFriendCount?: number; now: number }): ExportIssue[] {
  const seen = new Set<string>();
  const out: ExportIssue[] = [];
  for (const issue of [...parsed.issues, ...validateExport(parsed, hints)]) {
    const id = `${issue.code}\n${issue.message}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(issue);
  }
  return sortIssues(out);
}
