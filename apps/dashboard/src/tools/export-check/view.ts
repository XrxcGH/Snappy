import { insights } from "@snappy-export/core";
import { dataTable } from "../../components/dataTable.ts";
import type { PillKind } from "../../components/dataTable.ts";
import { section, stepCards } from "../../components/layout.ts";
import { notice } from "../../components/notice.ts";
import type { NoticeKind } from "../../components/notice.ts";
import { toolView } from "../../components/toolPage.ts";
import type { ToolNote } from "../../components/toolPage.ts";
import { h } from "../../dom.ts";
import { formatCount, formatDate } from "../../format.ts";
import type { ToolMeta } from "../types.ts";
import { copy } from "./copy.ts";
import { computeExportCheck } from "./model.ts";
import type { ExportCheck, ExportCheckResult } from "./model.ts";

type SectionId = insights.exportCheck.SectionId;

export const meta: ToolMeta = { id: "export-check", group: "your-export", category: "cleanup", icon: "check", needs: ["export"] };

const VERDICT: Record<insights.exportCheck.CheckStatus, { text: string; kind: NoticeKind }> = {
  ready: { text: copy.verdict.ready, kind: "success" },
  "ready-with-notes": { text: copy.verdict.readyWithNotes, kind: "info" },
  incomplete: { text: copy.verdict.incomplete, kind: "warning" },
  unusable: { text: copy.verdict.unusable, kind: "error" },
};

const num = (v: insights.exportCheck.ParamValue | undefined): number => (typeof v === "number" ? v : 0);
const sectionName = (v: insights.exportCheck.ParamValue | undefined): string => copy.sectionsInline[v as SectionId] ?? "list";

/** The sentence for one note. Hedged: Snappy infers from what is in the files. */
function noteText(n: insights.exportCheck.CheckNote): string {
  const count = num(n.params.count);
  switch (n.code) {
    case "html-only-export":
      return copy.htmlOnlyNote;
    case "no-parts":
      return copy.noPartsNote;
    case "duplicate-usernames":
      return copy.duplicateNote(count);
    case "friends-empty-but-deleted":
      return copy.friendsEmptyNote;
    case "possibly-date-limited":
      return copy.dateLimitedNote;
    case "friend-count-mismatch":
      return copy.friendCountNote;
    case "future-timestamps":
      return copy.futureStampsNote;
    case "dates-in-future":
      return copy.datesFutureNote(count, sectionName(n.params.section));
    case "dates-missing":
      return copy.datesMissingNote(count, sectionName(n.params.section));
    case "export-stale":
      return copy.staleNote(num(n.params.ageDays));
    case "export-aging":
      return copy.agingNote(num(n.params.ageDays));
    case "export-date-in-future":
      return copy.exportFutureNote;
    case "age-from-activity":
      return copy.fromActivityNote;
    case "memories-without-file":
      return copy.memoriesNoFileNote(count);
    case "memories-files-not-found":
      return copy.memoriesFilesNote;
    case "more-parts-may-exist":
      return copy.moreNote;
    default:
      return copy.otherNote;
  }
}

/** The sentence for one next step. */
function stepText(a: insights.exportCheck.CheckAction): string {
  switch (a.code) {
    case "add-export-files":
      return copy.addFilesStep;
    case "request-json-export":
      return copy.requestJsonStep;
    case "add-other-parts":
      return copy.addPartsStep;
    case "request-sections":
      return copy.requestSectionsStep((Array.isArray(a.params.sections) ? a.params.sections : []).map(sectionName).join(", "));
    case "choose-all-time":
      return copy.allTimeStep;
    case "request-newer-export":
      return copy.newerStep;
    case "check-export-date":
      return copy.checkDateStep;
    default:
      return copy.otherStep;
  }
}

const dateCell = (ms: number | null): string => (ms === null ? "-" : formatDate(ms));

function ageLine(age: insights.exportCheck.ExportAge): string {
  if (age.at === null) return copy.unknownDateLine;
  const when = formatDate(age.at);
  if (age.basis === "newest-activity") return copy.activityLine(when);
  return age.ageDays === null ? copy.madeOnlyLine(when) : copy.madeLine(when, copy.ago(age.ageDays));
}

/** A section that is there counts as yes; a missing optional one is optional; anything else is a no. */
function pillOf(s: insights.exportCheck.SectionCheck): PillKind {
  return s.status === "present" ? "yes" : s.need === "optional" ? "optional" : "no";
}

function foundSection({ check, partsKnown }: ExportCheckResult): HTMLElement {
  const rows = check.sections.map((s) => [copy.sections[s.id], copy.statuses[s.status], formatCount(s.count)]);
  return section(
    copy.foundHeading,
    partsKnown && check.parts.count > 0 ? h("p", { class: "caption" }, copy.partsLine(check.parts.count)) : null,
    dataTable(copy.foundCaption, [copy.sectionHeader, copy.statusHeader, copy.itemsHeader], rows, { pills: { column: 1, kinds: check.sections.map(pillOf) } }),
  );
}

function datesSection(check: ExportCheck): HTMLElement {
  const covered = (
    [
      [copy.records.chats, check.coverage.chats],
      [copy.records.snaps, check.coverage.snaps],
      [copy.records.memories, check.coverage.memories],
    ] as const
  ).filter(([, c]) => c.dated > 0);
  return section(
    copy.datesHeading,
    covered.length > 0
      ? dataTable(
          copy.datesCaption,
          [copy.recordsHeader, copy.fromHeader, copy.toHeader, copy.spanHeader],
          covered.map(([label, c]) => [label, dateCell(c.oldest), dateCell(c.newest), c.spanDays === null ? "-" : copy.span(c.spanDays)]),
        )
      : null,
    h("p", {}, ageLine(check.age)),
  );
}

export const view = toolView<ExportCheckResult, Record<string, never>>({
  meta,
  copy,
  compute: computeExportCheck,
  summary: ({ check }) => `${copy.doneAnnounce} ${VERDICT[check.status].text}`,
  render: (result) => {
    const { check } = result;
    const verdict = VERDICT[check.status];
    return [
      notice(verdict.kind, verdict.text),
      foundSection(result),
      datesSection(check),
      check.todo.length > 0 ? section(copy.todoHeading, stepCards(check.todo.map(stepText))) : null,
    ];
  },
  notes: ({ check }): ToolNote[] => check.notes.map((n) => ({ kind: n.severity === "info" ? "info" : "warning", text: noteText(n) })),
  command: "check",
});
