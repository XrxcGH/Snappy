import type { insights } from "@snappy-export/core";
import { dataTable } from "../../components/dataTable.ts";
import type { TableCell } from "../../components/dataTable.ts";
import { factList, section, stat, statGrid } from "../../components/layout.ts";
import { icon } from "../../components/icon.ts";
import { toolView } from "../../components/toolPage.ts";
import type { ToolNote, ToolUi } from "../../components/toolPage.ts";
import { h, setVar } from "../../dom.ts";
import { formatCount, formatDate, formatPercent } from "../../format.ts";
import { offsetLabel, OFFSETS, startingOffset } from "../timezone.ts";
import type { ToolMeta } from "../types.ts";
import { copy } from "./copy.ts";
import { availableYears, computeYear, DEFAULT_PARAMS } from "./model.ts";
import type { YearParams, YearView } from "./model.ts";

export const meta: ToolMeta = { id: "year-in-review", group: "your-export", category: "cleanup", icon: "calendar", needs: ["export"] };

type Note = insights.yearInReview.YearNote;
type Counts = insights.yearInReview.DirectionCounts;

const num = (v: number | undefined): number => (typeof v === "number" ? v : 0);

/** The sentence for one note. Hedged: Snappy infers from dates and directions alone. */
function noteText(n: Note): string {
  const count = num(n.params.count);
  switch (n.code) {
    case "no-data":
      return copy.noDataNote;
    case "year-invalid":
      return copy.yearInvalidNote;
    case "no-activity-data":
      return copy.noActivityDataNote;
    case "no-friend-dates":
      return copy.noFriendDatesNote;
    case "no-removal-dates":
      return copy.noRemovalDatesNote;
    case "no-memories":
      return copy.noMemoriesNote;
    case "no-activity-in-year":
      return copy.noActivityInYearNote(num(n.params.year));
    case "few-events":
      return copy.fewNote(count);
    case "many-unknown-direction":
      return copy.unknownNote(num(n.params.percent));
    case "year-in-progress":
      return copy.progressNote(num(n.params.year));
    case "undated-skipped":
      return copy.undatedNote(count);
    case "future-skipped":
      return copy.futureNote(count);
    case "offset-adjusted":
      return copy.zoneNote;
    default:
      return copy.otherNote;
  }
}

const WARNINGS: readonly Note["code"][] = ["no-data", "no-activity-data", "no-activity-in-year", "few-events", "many-unknown-direction"];

/** "2026-03-14" as "Mar 14, 2026". */
function dayText(day: string): string {
  const [y = 0, m = 1, d = 1] = day.split("-").map(Number);
  return formatDate(Date.UTC(y, m - 1, d));
}

/** A tile's number, or a dash when the export has nothing to count it from. */
const tileValue = (n: number | null | undefined): string => (typeof n === "number" ? formatCount(n) : copy.noValue);

function glance({ tiles }: YearView): HTMLElement {
  return section(
    copy.glanceHeading,
    statGrid(
      stat(copy.chatsLabel, tileValue(tiles.chats), { icon: "snapshots", accent: true }),
      stat(copy.activeDaysLabel, tileValue(tiles.activeDays), { icon: "calendar" }),
      stat(copy.memoriesLabel, tileValue(tiles.memories), { icon: "memories" }),
      stat(copy.newFriendsLabel, tileValue(tiles.newFriends), { icon: "people" }),
      stat(copy.removedLabel, tileValue(tiles.removedFriends), { icon: "remove" }),
      stat(copy.gapLabel, tiles.gapDays === null ? copy.noValue : copy.unitGapDays(tiles.gapDays), { icon: "queue" }),
    ),
  );
}

function busiest({ activity }: YearView): HTMLElement | null {
  if (activity === null) return null;
  // Each cell shows the bare value its column names; a screen reader, and a phone with no column names, get the phrase.
  // A month is short in the table cell ("Mar") and long in the phrase a screen reader hears ("March is busiest").
  const row = (pattern: string, short: string, name: string, tied: boolean, peak: { count: number; share: number }): TableCell[] => {
    const busiestName = tied ? copy.unitTied(name) : name;
    return [
      pattern,
      { text: tied ? copy.unitTied(short) : short, label: copy.unitBusiestAt(busiestName) },
      { text: formatCount(peak.count), label: copy.unitCounted(formatCount(peak.count)) },
      { text: formatPercent(peak.share), label: copy.unitOfYear(formatPercent(peak.share)) },
    ];
  };
  const rows: TableCell[][] = [];
  const month = activity.busiestMonth;
  if (month !== null) rows.push(row(copy.monthPattern, copy.months[month.key - 1] ?? copy.noValue, copy.monthsLong[month.key - 1] ?? copy.noValue, month.ties > 0, month));
  const day = activity.busiestDay;
  if (day !== null) rows.push(row(copy.dayPattern, dayText(day.key), dayText(day.key), day.ties > 0, day));
  if (rows.length === 0) return null;
  return section(copy.busiestHeading, dataTable(copy.busiestCaption, [copy.patternHeader, copy.busiestHeader, copy.countHeader, copy.shareHeader], rows));
}

function dates({ activity }: YearView): HTMLElement | null {
  if (activity === null) return null;
  const facts: Parameters<typeof factList>[0][number][] = [];
  if (activity.firstDay !== null) facts.push({ label: copy.firstLabel, value: dayText(activity.firstDay), icon: "calendar" });
  if (activity.lastDay !== null) facts.push({ label: copy.lastLabel, value: dayText(activity.lastDay), icon: "calendar" });
  const gap = activity.longestQuietGap;
  if (gap !== null) facts.push({ label: copy.quietLabel, value: copy.unitRange(dayText(gap.startDay), dayText(gap.endDay)), icon: "queue" });
  return facts.length === 0 ? null : section(copy.datesHeading, factList(facts));
}

function direction({ activity }: YearView): HTMLElement | null {
  if (activity === null) return null;
  const row = (name: string, c: Counts): TableCell[] => [
    name,
    { text: formatCount(c.total), label: copy.unitTotal(formatCount(c.total)) },
    { text: formatCount(c.sent), label: copy.unitSent(formatCount(c.sent)) },
    { text: formatCount(c.received), label: copy.unitReceived(formatCount(c.received)) },
    { text: formatCount(c.unknown), label: copy.unitUnknown(formatCount(c.unknown)) },
  ];
  return section(
    copy.directionHeading,
    dataTable(
      copy.directionCaption,
      [copy.typeHeader, copy.totalHeader, copy.sentHeader, copy.receivedHeader, copy.unknownHeader],
      [row(copy.snapsRow, activity.snaps), row(copy.chatsRow, activity.chats), row(copy.bothRow, activity.total)],
    ),
  );
}

/** One row of a bar list: the month, a bar as long as its share of the largest count, and the count. */
function barRow(name: string, count: number, max: number): HTMLElement {
  const fill = h("span", { class: "meter-fill" });
  setVar(fill, "width", `${max > 0 ? Math.round((count / max) * 100) : 0}%`);
  return h("li", { class: "mbar" }, h("span", { class: "mbar-name" }, name), h("span", { class: "meter", "aria-hidden": "true" }, fill), h("span", { class: "mbar-count" }, formatCount(count)));
}

function barList(counts: readonly number[]): HTMLElement {
  const max = Math.max(0, ...counts);
  return h("ul", { class: "card mbars" }, ...copy.months.map((name, i) => barRow(name, counts[i] ?? 0, max)));
}

function months({ activity }: YearView): HTMLElement | null {
  return activity === null ? null : section(copy.monthHeading, barList(activity.byMonth.map((m) => m.total)));
}

function memoryMonths({ memories }: YearView): HTMLElement | null {
  return memories === null ? null : section(copy.memoriesMonthHeading, barList(memories.byMonth.map((m) => m.total)));
}

/** A select with the shared chevron: the same markup the other tools use for a choice of one. */
function selectField(id: string, label: string, help: string, options: { value: string; text: string; selected: boolean }[], onChange: (value: string) => void): HTMLElement {
  const select = h(
    "select",
    { id, class: "input", "data-key": id, "aria-describedby": `${id}-help` },
    ...options.map((o) => h("option", { value: o.value, selected: o.selected }, o.text)),
  );
  select.addEventListener("change", () => onChange(select.value));
  // The select draws no native arrow: the chevron is its own icon.
  const chevron = icon("chevron-right", 16);
  chevron.setAttribute("class", "icon select-chevron");
  return h(
    "div",
    { class: "field" },
    h("label", { class: "label", for: id }, label),
    h("div", { class: "select-wrap" }, select, chevron),
    h("p", { class: "caption", id: `${id}-help` }, help),
  );
}

function controls(ui: ToolUi<YearParams>): HTMLElement {
  const years = availableYears(ui.data);
  const yearField = selectField(
    "year-in-review-year",
    copy.yearLabel,
    copy.yearHelp,
    [{ value: "", text: copy.latestLabel, selected: ui.params.year === null }, ...years.map((y) => ({ value: String(y), text: String(y), selected: y === ui.params.year }))],
    (value) => {
      const year = Number(value);
      ui.set({ year: value !== "" && Number.isInteger(year) ? year : null });
    },
  );
  const zoneField = selectField(
    "year-in-review-zone",
    copy.zoneLabel,
    copy.zoneHelp,
    OFFSETS.map((minutes) => ({ value: String(minutes), text: offsetLabel(minutes), selected: minutes === ui.params.utcOffsetMinutes })),
    (value) => {
      const minutes = Number(value);
      if (Number.isFinite(minutes)) ui.set({ utcOffsetMinutes: minutes });
    },
  );
  return h("div", { class: "year-controls" }, yearField, zoneField);
}

/**
 * The page opens in the zone the person's device is in (or the one chosen in Settings), read each time the page opens. A zone
 * picked on this page stays on this page: it is not remembered for the next one.
 */
const START: YearParams = Object.defineProperty({ ...DEFAULT_PARAMS }, "utcOffsetMinutes", { get: startingOffset, enumerable: true, configurable: true });

export const view = toolView<YearView, YearParams>({
  meta,
  copy,
  params: START,
  compute: computeYear,
  summary: ({ result, activity }) =>
    result.year === null ? copy.emptyAnnounce : activity === null ? copy.quietAnnounce(result.year) : copy.summaryAnnounce(result.year, activity.total.total),
  isEmpty: ({ result }) => result.year === null,
  controls,
  render: (v) => [glance(v), busiest(v), dates(v), direction(v), months(v), memoryMonths(v)],
  notes: ({ result, activity, tiles }): ToolNote[] => [
    ...result.notes.map((n): ToolNote => ({ kind: WARNINGS.includes(n.code) ? "warning" : "info", text: noteText(n) })),
    ...(activity !== null ? [{ kind: "info", text: copy.savedChatsNote } as const] : []),
    ...((tiles.newFriends ?? 0) > 0 ? [{ kind: "info", text: copy.currentFriendsNote } as const] : []),
  ],
  // The command's entry in the catalog (terminal/commands.ts) is added when the tool is registered.
  command: "year-in-review",
});
