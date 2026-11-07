import type { insights } from "@snappy-export/core";
import { dataTable } from "../../components/dataTable.ts";
import type { PillKind } from "../../components/dataTable.ts";
import { factList, section } from "../../components/layout.ts";
import { toolView } from "../../components/toolPage.ts";
import type { ToolNote } from "../../components/toolPage.ts";
import { h } from "../../dom.ts";
import { formatCount, formatDate, formatMonth } from "../../format.ts";
import type { ToolMeta } from "../types.ts";
import { copy } from "./copy.ts";
import { computeFriendCountHistory, hasCurve } from "./model.ts";
import type { FriendCountResult } from "./model.ts";

export const meta: ToolMeta = { id: "friend-count-history", group: "friends", category: "requests", icon: "people", needs: ["export", "friends"] };

/** The most rows the page draws for each table. The summary and the notes cover the whole history. */
const MAX_MONTHS = 24;
const MAX_COMPARISONS = 12;

type Note = insights.friendCountHistory.FriendCountNote;

/** "2026-03" as "March 2026". Month labels from core are UTC. */
function monthText(label: string): string {
  const [year, month] = label.split("-").map(Number);
  return formatMonth(Date.UTC(year ?? 1970, (month ?? 1) - 1, 1));
}

const num = (n: Note, key: string): number => n.params[key] ?? 0;

/** The sentence for one note. Hedged: Snappy infers the curve from the dates in the files. */
function noteText(n: Note, savedHistory: boolean): string {
  switch (n.code) {
    case "no-dated-friendships":
      return copy.noDatesNote;
    case "curve-may-run-high":
      return copy.curveHighNote;
    case "undated-joins":
      return copy.undatedJoinsNote(num(n, "count"));
    case "undated-leaves":
      return copy.undatedLeavesNote(num(n, "count"));
    case "unusable-dates-ignored":
      return copy.badDatesNote(num(n, "count"));
    case "leave-before-join":
      return copy.leaveBeforeJoinNote(num(n, "count"));
    case "re-added-friends":
      return copy.reAddedNote(num(n, "count"));
    case "snapshots-ignored":
      return copy.badSnapshotsNote(num(n, "count"));
    case "no-snapshots":
      return savedHistory ? copy.noEarlierNote : copy.noSnapshotsNote;
    case "single-snapshot":
      return copy.oneSnapshotNote;
    case "sources-agree":
      return copy.agreeNote(num(n, "compared"));
    case "sources-disagree":
      return copy.disagreeNote(num(n, "disagreeing"), num(n, "compared"), num(n, "largestGap"));
    default:
      return copy.otherNote;
  }
}

/** The notes that ask the person to look; the rest are plain observations. */
const WARN = new Set(["no-dated-friendships", "undated-leaves", "unusable-dates-ignored", "leave-before-join", "snapshots-ignored", "sources-disagree"]);

function summarySection({ history }: FriendCountResult): HTMLElement {
  const { totals, best, worst } = history;
  return section(
    copy.summaryHeading,
    factList([
      { label: copy.nowHeader, value: formatCount(totals.currentCount ?? 0), icon: "people" },
      { label: copy.addedHeader, value: formatCount(totals.joined), icon: "import" },
      { label: copy.removedHeader, value: formatCount(totals.left), icon: "remove" },
      ...(best ? [{ label: copy.gainHeader, value: copy.unitGain(monthText(best.month), best.net), icon: "calendar" as const }] : []),
      ...(worst ? [{ label: copy.dropHeader, value: copy.unitDrop(monthText(worst.month), -worst.net), icon: "calendar" as const }] : []),
    ]),
  );
}

function monthsSection({ history }: FriendCountResult): HTMLElement {
  const shown = history.months.slice(-MAX_MONTHS);
  const rows = shown.map((m) => [
    m.partial ? copy.unitSoFar(monthText(m.month)) : monthText(m.month),
    copy.unitAdded(m.joined),
    copy.unitRemoved(m.left),
    copy.unitFriends(m.count ?? 0),
  ]);
  return section(
    copy.monthsHeading,
    dataTable(copy.monthsCaption, [copy.monthHeader, copy.monthAddedHeader, copy.monthRemovedHeader, copy.monthFriendsHeader], rows),
    shown.length < history.months.length ? h("p", { class: "caption" }, copy.monthsShownLine(shown.length, history.months.length)) : null,
  );
}

function compareSection({ history }: FriendCountResult): HTMLElement | null {
  if (history.comparisons.length === 0) return null;
  const shown = history.comparisons.slice(-MAX_COMPARISONS);
  const rows = shown.map((c) => [formatDate(c.takenAt), copy.unitSaved(c.snapshotCount), copy.unitCurve(c.curveCount), copy.unitGap(c.gap), c.disagrees ? copy.statuses.differs : copy.statuses.close]);
  const kinds: PillKind[] = shown.map((c) => (c.disagrees ? "no" : "yes"));
  return section(
    copy.compareHeading,
    dataTable(copy.compareCaption, [copy.savedOnHeader, copy.savedHeader, copy.curveHeader, copy.gapHeader, copy.resultHeader], rows, { pills: { column: 4, kinds } }),
    shown.length < history.comparisons.length ? h("p", { class: "caption" }, copy.comparisonsShownLine(shown.length, history.comparisons.length)) : null,
  );
}

export const view = toolView<FriendCountResult, Record<string, never>>({
  meta,
  copy,
  compute: computeFriendCountHistory,
  isEmpty: (r) => !hasCurve(r),
  summary: (r) => (hasCurve(r) ? copy.doneAnnounce(r.history.totals.currentCount ?? 0) : copy.emptyAnnounce),
  render: (r) => [summarySection(r), monthsSection(r), compareSection(r)],
  notes: (r): ToolNote[] => [
    ...(r.exportHasErrors ? [{ kind: "warning" as const, text: copy.exportErrorsNote }] : []),
    ...r.history.notes.map((n): ToolNote => ({ kind: WARN.has(n.code) ? "warning" : "info", text: noteText(n, r.savedHistory) })),
  ],
  command: "friend-count",
});
