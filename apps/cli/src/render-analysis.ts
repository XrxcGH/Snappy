/** Text, JSON and CSV renderings of an analysis. Usernames are the only personal values in any of them. */
import type { Candidate } from "@snappy-export/core";
import { CATEGORY, evidenceSummary } from "./analysis.ts";
import type { AnalysisResult } from "./analysis.ts";
import { formatCount, formatDate, plural } from "./format.ts";
import { PRIVACY_IMPORT, PRIVACY_RESULTS, describePairing, renderIssues, wrapText } from "./render.ts";
import type { LabeledIssue } from "./render.ts";
import type { Term } from "./term.ts";

export interface TextOptions {
  term: Term;
  issues: LabeledIssue[];
  /** Most rows to print in the queue table; 0 prints all. */
  limit: number;
  /** "saved" when the ledger was written, "skipped" for --no-save. */
  ledger: "saved" | "skipped";
  csvPath?: string;
}

export function renderAnalysisText(result: AnalysisResult, opts: TextOptions): string {
  const { term } = opts;
  const { queue, counts } = result;
  const out: string[] = [...renderIssues(opts.issues, term), ""];

  out.push(term.bold("Your export"));
  out.push(
    `  ${plural(counts.friends, "friend")}, ${plural(counts.sentRequests, "request")} you sent, ${plural(counts.removedByYou, "friend")} you removed.`,
  );
  out.push(
    counts.chatEvents > 0
      ? "  Saved chats and Snaps count as recent activity. Snappy uses only who, when and direction, never message text or media."
      : "  No chat or Snap history is included, so recent activity cannot protect anyone and quiet friends cannot be found.",
  );
  if (counts.memories > 0) {
    const memories =
      result.memoriesPairing !== undefined
        ? describePairing(result.memoriesPairing)
        : `${plural(counts.memories, "Memory", "Memories")} listed. These zips hold no Memories files, so none can be matched yet.`;
    for (const line of wrapText(memories, term.columns - 4)) out.push(`  ${line}`);
  }
  out.push(`  ${plural(result.snapshotCount, "export")} on record${result.latestTakenAt !== undefined ? `, newest from ${formatDate(result.latestTakenAt)}` : ""}.`);
  out.push("");

  out.push(term.bold("What changed"));
  if (result.changes && result.previousTakenAt !== undefined) {
    const c = result.changes;
    out.push(`  Since your export from ${formatDate(result.previousTakenAt)}:`);
    out.push(
      `  ${formatCount(c.disappeared.length)} disappeared, ${formatCount(c.removedByUser.length)} removed by you, ${formatCount(c.added.length)} new, ${formatCount(c.requestsAccepted.length)} requests accepted.`,
    );
  } else {
    for (const line of wrapText(
      "Snappy has one export on record, so it cannot tell who has disappeared yet. Export your data again in a few weeks, with the same settings, and run snappy-export analyze on it. Snappy compares the two.",
      term.columns - 4,
    )) {
      out.push(`  ${line}`);
    }
  }
  out.push("");

  const s = queue.summary;
  out.push(term.bold("Cleanup queue"));
  out.push(
    `  ${CATEGORY.ghost.feature}: ${formatCount(s.byCategory.ghost)}   ${CATEGORY["one-way"].feature}: ${formatCount(s.byCategory["one-way"])}   ${CATEGORY.dormant.feature}: ${formatCount(s.byCategory.dormant)}`,
  );
  if (queue.items.length === 0) {
    out.push("  Nothing to review right now.");
  } else {
    const shown = opts.limit > 0 ? queue.items.slice(0, opts.limit) : queue.items;
    // The one violet element in this view: the key figure.
    out.push(`  ${term.violet(formatCount(queue.items.length))} ${queue.items.length === 1 ? "friend" : "friends"} to review, most likely first.`);
    out.push("");
    const table = term.table(
      [{ header: "Friend" }, { header: "Type" }, { header: "Confidence" }, { header: "Why", flex: true, wrap: true }],
      shown.map((c) => [c.key, CATEGORY[c.category].label, term.confidence(c.confidence), evidenceSummary(c)]),
    );
    for (const line of table) out.push(`  ${line}`);
    if (shown.length < queue.items.length) {
      out.push("");
      out.push(`  ${plural(queue.items.length - shown.length, "more friend")} not shown. Use --csv or --json for the full list.`);
    }
  }
  out.push("");
  if (s.byCategory.ghost > 0) {
    out.push("  Disappeared means missing from your newest export. They may have removed you, or their account may be gone.", "");
  }
  out.push(
    s.protectedCount > 0
      ? `  ${plural(s.protectedCount, "friend")} protected (recent activity or on your allowlist) and left out of the queue.`
      : "  No friends are protected right now. Use snappy-export keep to protect friends you never want to remove.",
  );
  out.push("");

  if (opts.csvPath !== undefined) out.push(`CSV saved: ${opts.csvPath}`);
  out.push(opts.ledger === "saved" ? "Ledger sealed with your passphrase." : "The ledger was not read or written, as you asked.");
  out.push("Confidence is an estimate from your exports, not from anything Snapchat told us. Removing is always your call.");
  out.push(PRIVACY_IMPORT);
  out.push(PRIVACY_RESULTS);
  return out.join("\n") + "\n";
}

const round = (n: number): number => Math.round(n * 100) / 100;

function jsonCandidate(c: Candidate): object {
  return {
    username: c.key,
    category: CATEGORY[c.category].id,
    confidence: c.confidence,
    score: round(c.score),
    evidence: c.evidence.map((e) => ({ signal: e.signal, detail: e.detail, weight: round(e.weight) })),
  };
}

export interface JsonOptions {
  issues: LabeledIssue[];
  ledger: "saved" | "skipped";
  generatedAt: number;
}

/** Machine-readable result. No personal data other than usernames. */
export function analysisToJson(result: AnalysisResult, opts: JsonOptions): string {
  const { queue } = result;
  return (
    JSON.stringify(
      {
        generatedAt: new Date(opts.generatedAt).toISOString(),
        issues: opts.issues.map((i) => ({ severity: i.severity, code: i.code, message: i.message, source: i.source })),
        exportsOnRecord: result.snapshotCount,
        counts: result.counts,
        memoriesPairing: result.memoriesPairing ?? null,
        changes: result.changes
          ? {
              disappeared: result.changes.disappeared.length,
              removedByYou: result.changes.removedByUser.length,
              added: result.changes.added.length,
              requestsAccepted: result.changes.requestsAccepted.length,
              requestsVanished: result.changes.requestsVanished.length,
            }
          : null,
        disappearedFriendsAvailable: result.canFindDisappeared,
        summary: {
          total: queue.summary.total,
          review: queue.items.length,
          protected: queue.summary.protectedCount,
          byCategory: {
            [CATEGORY.ghost.id]: queue.summary.byCategory.ghost,
            [CATEGORY["one-way"].id]: queue.summary.byCategory["one-way"],
            [CATEGORY.dormant.id]: queue.summary.byCategory.dormant,
          },
          byConfidence: queue.summary.byConfidence,
        },
        queue: queue.items.map(jsonCandidate),
        protected: queue.protectedItems.map((c) => ({ ...jsonCandidate(c), protectedBy: c.protectedBy })),
        ledger: opts.ledger,
      },
      null,
      2,
    ) + "\n"
  );
}

/**
 * One CSV cell. Spreadsheets run a cell that begins with = + - @ (or tab / carriage return) as a
 * formula, and usernames are attacker-influenced, so such cells get a leading single quote.
 */
export function csvCell(value: string | number): string {
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The removable queue as CSV: username, category, confidence, score. */
export function queueToCsv(result: AnalysisResult): string {
  const rows = result.queue.items.map((c) => [c.key, CATEGORY[c.category].id, c.confidence, round(c.score).toFixed(2)]);
  return [["username", "category", "confidence", "score"], ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
