import { dataTable } from "../../components/dataTable.ts";
import { factList, section, subsection } from "../../components/layout.ts";
import { toolView } from "../../components/toolPage.ts";
import type { ToolNote } from "../../components/toolPage.ts";
import { usernameText } from "../../components/usernameChip.ts";
import { toCsv } from "../../csv.ts";
import { h } from "../../dom.ts";
import { formatCount, formatDate } from "../../format.ts";
import type { ToolMeta } from "../types.ts";
import { copy } from "./copy.ts";
import { GROUPS, computeSinceLastExport, csvFileName, csvRows, isComparable, peopleByChange } from "./model.ts";
import type { ChangeKind, SinceNote, SinceResult } from "./model.ts";

export const meta: ToolMeta = { id: "since-last-export", group: "your-export", category: "cleanup", icon: "calendar", needs: ["export", "friends"] };

/** A long list would make a very long table, so the page shows the first rows of each list and says how many it left out. The CSV holds everyone. */
const ROWS_SHOWN = 25;

const num = (n: SinceNote, key: string): number => n.params[key] ?? 0;

/** The sentence for one note. Counts only, never a person. Hedged: Snappy infers from two lists. */
function noteText(n: SinceNote): string {
  const count = num(n, "count");
  switch (n.code) {
    case "order-swapped":
      return copy.orderNote;
    case "same-time":
      return copy.sameTimeNote;
    case "same-day":
      return copy.sameDayNote;
    case "long-gap":
      return copy.longGapNote(num(n, "days"));
    case "snapshot-time-in-future":
      return copy.futureTimeNote(count);
    case "friends-may-have-left":
      return copy.leftNote(count);
    case "possible-partial-export":
      return copy.partialNote(count, num(n, "previous"));
    case "blocked-excluded":
      return copy.blockedNote(count);
    case "requests-may-be-declined":
      return copy.declinedNote(count);
    case "no-activity-data":
      return copy.noActivityNote;
    case "earlier-period-not-covered":
      return copy.notCoveredNote;
    case "unusable-times-ignored":
      return copy.badTimesNote(count);
    case "no-memories-data":
      return copy.noMemoriesNote;
    case "memories-dates-unusable":
      return copy.badMemoryDatesNote(num(n, "undated") + num(n, "future"));
    default:
      return copy.otherNote;
  }
}

/** The notes that ask the person to look; the rest are plain observations. */
const WARN = new Set(["unusable-snapshot-time", "order-swapped", "snapshot-time-in-future", "possible-partial-export"]);

const HEADINGS: Record<ChangeKind, { heading: string; caption: string }> = {
  added: { heading: copy.addedHeading, caption: copy.addedCaption },
  "no-longer-listed": { heading: copy.leftHeading, caption: copy.leftCaption },
  "removed-by-you": { heading: copy.removedHeading, caption: copy.removedCaption },
  "blocked-by-you": { heading: copy.blockedHeading, caption: copy.blockedCaption },
  "request-accepted": { heading: copy.acceptedHeading, caption: copy.acceptedCaption },
  "request-pending": { heading: copy.pendingHeading, caption: copy.pendingCaption },
  "request-no-longer-listed": { heading: copy.vanishedHeading, caption: copy.vanishedCaption },
};

/** The cell that goes with a person's date, saying what the date is. */
function dateCell(kind: (typeof GROUPS)[number]["date"], at: number | null): string {
  if (at === null) return copy.noDateCell;
  const date = formatDate(at);
  return kind === "friends-since" ? copy.friendsSinceCell(date) : kind === "removed-on" ? copy.removedOnCell(date) : copy.sentOnCell(date);
}

/**
 * The first column of a result table names a person. dataTable writes plain text, so each name is put in the shared
 * username element: still text only, with invisible and direction-changing characters shown as question marks.
 */
function nameRows(table: HTMLElement, names: readonly string[]): HTMLElement {
  table.querySelectorAll("tbody th").forEach((th, i) => th.replaceChildren(usernameText(names[i] ?? "")));
  return table;
}

function glanceSection({ result }: SinceResult): HTMLElement {
  const { friends, requests, memories } = result;
  return section(
    copy.glanceHeading,
    factList([
      { label: copy.factDaysHeader, value: formatCount(result.daysBetween ?? 0), icon: "calendar" },
      { label: copy.factFriendsHeader, value: formatCount(friends?.currentCount ?? 0), icon: "people" },
      { label: copy.factAddedHeader, value: formatCount(friends?.added.length ?? 0), icon: "import" },
      { label: copy.factLeftHeader, value: formatCount(friends?.disappeared.length ?? 0), icon: "remove" },
      { label: copy.factAcceptedHeader, value: formatCount(requests?.accepted.length ?? 0), icon: "check" },
      ...(memories ? [{ label: copy.factMemoriesHeader, value: formatCount(memories.newCount), icon: "memories" as const }] : []),
    ]),
    h("p", {}, copy.compareLine(formatDate(result.previousAt ?? 0), formatDate(result.currentAt ?? 0), result.daysBetween ?? 0)),
  );
}

function peopleSection({ result }: SinceResult): HTMLElement {
  const by = peopleByChange(result);
  const tables = GROUPS.flatMap((g) => {
    const people = by[g.change];
    if (people.length === 0) return [];
    const shown = people.slice(0, ROWS_SHOWN);
    const table = dataTable(
      HEADINGS[g.change].caption,
      [copy.nameHeader, copy.dateHeader],
      shown.map((p) => [p.username, dateCell(g.date, p.at)]),
    );
    return [
      subsection(
        HEADINGS[g.change].heading,
        nameRows(table, shown.map((p) => p.username)),
        people.length > shown.length ? h("p", { class: "caption" }, copy.moreLine(people.length - shown.length)) : null,
      ),
    ];
  });
  return section(
    copy.friendsHeading,
    result.friends ? h("p", {}, copy.friendsLine(result.friends.previousCount, result.friends.currentCount)) : null,
    ...(tables.length === 0 ? [h("p", {}, copy.noChangeLine)] : tables),
  );
}

function memoriesSection({ result }: SinceResult): HTMLElement | null {
  const m = result.memories;
  return m ? section(copy.memoriesHeading, h("p", {}, copy.memoriesLine(m.total, m.newCount)), h("p", { class: "caption" }, copy.captureLine)) : null;
}

function activitySection({ result }: SinceResult): HTMLElement | null {
  const a = result.activity;
  if (!a) return null;
  const rows = [[copy.sinceRow, copy.sentCell(a.since.sent), copy.receivedCell(a.since.received), copy.unknownCell(a.since.unknown)]];
  if (a.earlier) rows.push([copy.earlierRow, copy.sentCell(a.earlier.sent), copy.receivedCell(a.earlier.received), copy.unknownCell(a.earlier.unknown)]);
  return section(
    copy.activityHeading,
    dataTable(copy.activityCaption, [copy.periodHeader, copy.sentHeader, copy.receivedHeader, copy.unknownHeader], rows),
    a.change ? h("p", {}, copy.changeLine(a.change.sent, a.change.received)) : null,
    a.change ? h("p", { class: "caption" }, copy.earlierLine) : null,
  );
}

export const view = toolView<SinceResult, Record<string, never>>({
  meta,
  copy,
  compute: computeSinceLastExport,
  isEmpty: (r) => !isComparable(r),
  summary: (r) => (isComparable(r) ? copy.doneAnnounce(r.result.counts.added ?? 0, r.result.counts.disappeared ?? 0) : copy.emptyAnnounce),
  render: (r) => [glanceSection(r), peopleSection(r), memoriesSection(r), activitySection(r)],
  notes: (r): ToolNote[] => [
    ...(r.exportHasErrors ? [{ kind: "warning" as const, text: copy.exportErrorsNote }] : []),
    ...(r.dateGuessed ? [{ kind: "info" as const, text: copy.dateGuessedNote }] : []),
    ...r.result.notes.map((n): ToolNote => ({ kind: WARN.has(n.code) ? "warning" : "info", text: noteText(n) })),
  ],
  download: {
    label: copy.downloadLabel,
    note: copy.downloadNote,
    build: ({ result }) => ({
      fileName: csvFileName(result),
      text: toCsv([copy.unitCsvName, copy.unitCsvChange, copy.unitCsvDate], csvRows(result)),
      mime: "text/csv",
    }),
  },
  command: "since",
});
