import { failureClass, validateExport, visibleIssues } from "@snappy-export/core";
import type { ExportIssue, ParsedExport } from "@snappy-export/core";

const SEVERITY_ORDER: Record<ExportIssue["severity"], number> = { error: 0, warning: 1, info: 2 };

/** Errors first, then warnings, then notes; stable within a severity. */
export function sortIssues(issues: readonly ExportIssue[]): ExportIssue[] {
  return issues
    .map((issue, index) => ({ issue, index }))
    .sort((a, b) => SEVERITY_ORDER[a.issue.severity] - SEVERITY_ORDER[b.issue.severity] || a.index - b.index)
    .map((x) => x.issue);
}

/** The issues that say why files could not be read at all (damaged, password protected, a ZIP of ZIP files, no JSON). */
export function unreadableIssues(issues: readonly ExportIssue[] | undefined): ExportIssue[] {
  return visibleIssues(issues ?? []).filter((i) => failureClass([i]) !== undefined);
}

/** What a failed import says aloud: the cause shown on the page when the files could not be read, otherwise the headline. */
export function spokenFailure(imp: { message?: string; issues?: readonly ExportIssue[] }, fallback: string): string {
  const causes = unreadableIssues(imp.issues);
  return causes.length > 0 ? causes.map((i) => i.message).join(" ") : (imp.message ?? fallback);
}

/** Parse issues plus whole-export checks (friend count, date range), without duplicates. */
export function exportHealth(parsed: ParsedExport, hints: { expectedFriendCount?: number; now: number; allowEmptyFriends?: boolean }): ExportIssue[] {
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
