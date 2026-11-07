import { dataTable } from "../../components/dataTable.ts";
import { factList, section } from "../../components/layout.ts";
import { toolView } from "../../components/toolPage.ts";
import type { ToolNote } from "../../components/toolPage.ts";
import { h } from "../../dom.ts";
import { formatCount, formatDate } from "../../format.ts";
import { displayUsername } from "../../safe.ts";
import type { ToolMeta } from "../types.ts";
import { controls } from "./controls.ts";
import { copy } from "./copy.ts";
import { DEFAULT_PARAMS, computeAnniversaries } from "./model.ts";
import type { AnniversariesResult, AnniversaryNote, AnniversaryParams, AnniversaryRow } from "./model.ts";

export const meta: ToolMeta = { id: "anniversaries", group: "friends", category: "requests", icon: "calendar", needs: ["friends"] };

/** The most rows the table shows. A longer list is trimmed with a line that says so, so the page stays light. */
const ROW_LIMIT = 50;

const num = (n: AnniversaryNote): number => n.params.count ?? 0;

/** The sentence for one note from core. Counts only, never a name. */
function noteText(n: AnniversaryNote): string {
  switch (n.code) {
    case "export-date-caveat":
      return copy.caveatNote;
    case "created-at-missing":
      return copy.missingNote(num(n));
    case "created-at-future":
      return copy.futureNote(num(n));
    case "duplicate-usernames":
      return copy.duplicateNote(num(n));
    case "invalid-username":
      return copy.invalidNote(num(n));
    default:
      return copy.nowInvalidNote;
  }
}

/** "2027-02-28" as a date that reads like the rest of the app. Days are UTC calendar days. */
function dayText(on: string): string {
  const [y = 0, m = 1, d = 1] = on.split("-").map(Number);
  return formatDate(Date.UTC(y, m - 1, d));
}

/** The date names the row (the list is in date order); the username is a cell, written as text with invisible characters hidden. */
const rowCells = (r: AnniversaryRow): string[] => [dayText(r.on), displayUsername(r.username), copy.yearsCell(r.years, r.milestone), copy.whenCell(r.daysUntil)];

function upcomingSection(result: AnniversariesResult): HTMLElement {
  const shown = result.rows.slice(0, ROW_LIMIT);
  return section(
    copy.upcomingHeading,
    dataTable(copy.upcomingCaption, [copy.dateHeader, copy.friendHeader, copy.reachesHeader, copy.whenHeader], shown.map(rowCells)),
    shown.length < result.rows.length ? h("p", { class: "caption" }, copy.moreLine(shown.length, result.rows.length)) : null,
  );
}

export const view = toolView<AnniversariesResult, AnniversaryParams>({
  meta,
  copy,
  params: DEFAULT_PARAMS,
  compute: computeAnniversaries,
  summary: (r) => (r.rows.length === 0 ? copy.noneAnnounce(r.windowDays) : copy.foundAnnounce(r.rows.length, r.windowDays)),
  isEmpty: (r) => r.rows.length === 0,
  controls,
  render: (r) => [
    section(
      copy.glanceHeading,
      factList([
        { label: copy.upcomingFact, value: formatCount(r.upcoming), icon: "calendar" },
        { label: copy.milestoneFact, value: formatCount(r.milestones), icon: "check" },
        { label: copy.datedFact, value: formatCount(r.dated), icon: "people" },
      ]),
    ),
    upcomingSection(r),
  ],
  notes: (r): ToolNote[] => [
    ...r.notes.map((n): ToolNote => ({ kind: n.code === "export-date-caveat" ? "info" : "warning", text: noteText(n) })),
    ...(r.leapShifted ? [{ kind: "info", text: copy.leapNote } as const] : []),
  ],
  command: "anniversaries",
});
