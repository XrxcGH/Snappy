import { insights } from "@snappy-export/core";
import { dataTable } from "../../components/dataTable.ts";
import { factList, section, subsection } from "../../components/layout.ts";
import { toolView } from "../../components/toolPage.ts";
import type { ToolNote } from "../../components/toolPage.ts";
import { h, setVar } from "../../dom.ts";
import { formatCount, formatDate, formatPercent } from "../../format.ts";
import type { ToolMeta } from "../types.ts";
import { calendarControls } from "./controls.ts";
import { copy } from "./copy.ts";
import { computeCalendar, DEFAULT_PARAMS } from "./model.ts";
import type { CalendarParams, CalendarView, YearView } from "./model.ts";

export const meta: ToolMeta = { id: "activity-calendar", group: "chats", category: "quiet", icon: "calendar", needs: ["chats"] };

type Streaks = insights.activityCalendar.Streaks;
type Run = insights.activityCalendar.ActivityRun | null;
type Mix = insights.activityCalendar.KindMix;

const num = (v: number | undefined): number => (typeof v === "number" ? v : 0);

/** The sentence for one note. Hedged: Snappy infers from kinds and times alone. */
function noteText(n: insights.activityCalendar.ActivityCalendarNote): string {
  switch (n.code) {
    case "no-events":
    case "no-usable-events":
      return copy.noneNote;
    case "undated-skipped":
      return copy.undatedNote(num(n.params.count));
    case "future-skipped":
      return copy.futureNote(num(n.params.count));
    case "few-events":
      return copy.fewNote(num(n.params.count));
    case "many-other-kind":
      return copy.otherKindNote(num(n.params.percent));
    case "year-adjusted":
      return copy.yearAdjustedNote(num(n.params.year));
    case "year-empty":
      return copy.yearEmptyNote(num(n.params.year));
    case "offset-adjusted":
      return copy.zoneNote;
    default:
      return copy.unknownNote;
  }
}

const isWarning = (code: insights.activityCalendar.ActivityCalendarNoteCode): boolean =>
  code === "no-events" || code === "no-usable-events" || code === "few-events" || code === "many-other-kind";

/** "2026-03-02" as "Mar 2, 2026". */
function dayText(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return y === undefined || m === undefined || d === undefined ? copy.noValue : formatDate(Date.UTC(y, m - 1, d));
}

function weekCell(peak: insights.activityCalendar.WeekPeak | null): string {
  return peak === null ? copy.unitNoWeek : copy.unitWeek(dayText(peak.start), peak.count, peak.ties > 0);
}

function glance({ result }: CalendarView): HTMLElement {
  const facts: Parameters<typeof factList>[0][number][] = [
    { label: copy.countedLabel, value: formatCount(result.totals.used), icon: "list" },
    { label: copy.activeDaysLabel, value: formatCount(result.totals.activeDays), icon: "calendar" },
  ];
  if (result.first !== null) facts.push({ label: copy.firstLabel, value: formatDate(result.first), icon: "calendar" });
  if (result.last !== null) facts.push({ label: copy.lastLabel, value: formatDate(result.last), icon: "calendar" });
  return factList(facts);
}

/** One row of a bar list: the name, a bar as long as its share of the largest count, and the count. */
function barRow(name: string, count: number, max: number): HTMLElement {
  const fill = h("span", { class: "meter-fill" });
  setVar(fill, "width", `${max > 0 ? Math.round((count / max) * 100) : 0}%`);
  return h("li", { class: "hbar" }, h("span", { class: "hbar-name" }, name), h("span", { class: "meter", "aria-hidden": "true" }, fill), h("span", { class: "hbar-count" }, formatCount(count)));
}

function barList(rows: readonly { name: string; count: number }[]): HTMLElement {
  const max = Math.max(0, ...rows.map((r) => r.count));
  return h("ul", { class: "card hbars" }, ...rows.map((r) => barRow(r.name, r.count, max)));
}

/** The year's days as a grid of squares, weeks in columns, with month names above and a legend below. Decorative: the tables hold the same counts. */
function heatGrid(v: YearView, used: number): HTMLElement {
  const { calendar } = v;
  const cells = v.levels.map((level, i) => {
    const cell = h("span", { class: `cal-cell lvl-${level}` });
    if (i === 0 && v.startRow > 0) setVar(cell, "grid-row-start", String(v.startRow + 1));
    return cell;
  });
  const months = h(
    "div",
    { class: "cal-months" },
    ...v.marks.map((m) => {
      const label = h("span", { class: "cal-month" }, copy.monthNames[m.month - 1] ?? "");
      setVar(label, "grid-column", `${m.column} / span 3`);
      return label;
    }),
  );
  setVar(months, "--cal-cols", String(v.columns));
  const weekdays = h("div", { class: "cal-weekdays" }, ...copy.weekdayShort.map((name, i) => {
    const label = h("span", { class: "cal-weekday" }, name);
    setVar(label, "grid-row", String(i * 2 + 1));
    return label;
  }));
  const board = h("div", { class: "cal-board" }, h("span", {}), months, weekdays, h("div", { class: "cal-grid" }, ...cells));
  const legend = h(
    "div",
    { class: "cal-legend", "aria-hidden": "true" },
    h("span", {}, copy.legendLess),
    ...[0, 1, 2, 3, 4].map((level) => h("span", { class: `cal-cell lvl-${level}` })),
    h("span", {}, copy.legendMore),
  );
  return h(
    "div",
    { class: "cal-wrap" },
    h("div", { class: "cal-scroll", role: "img", tabindex: "0", "aria-label": copy.gridFor(calendar.year, used, calendar.activeDays) }, board),
    legend,
    h("p", { class: "caption" }, copy.gridNote),
  );
}

function yearSection(v: CalendarView): HTMLElement | null {
  const y = v.year;
  if (y === null) return null;
  const cal = y.calendar;
  const rows: string[][] = [
    [copy.countedRow, copy.unitCounted(formatCount(cal.total))],
    [copy.activeDaysRow, copy.unitDays(cal.activeDays)],
  ];
  if (cal.total > 0) rows.push([copy.busiestWeekRow, weekCell(cal.busiestWeek)], [copy.quietestWeekRow, weekCell(cal.quietestWeek)]);
  return section(
    copy.yearHeading(cal.year),
    dataTable(copy.yearCaption, [copy.measureHeader, copy.valueHeader], rows),
    cal.total > 0 ? heatGrid(y, cal.total) : null,
  );
}

function monthsSection(v: CalendarView): HTMLElement | null {
  const cal = v.year?.calendar;
  if (cal === undefined || cal.total === 0) return null;
  return section(
    copy.monthHeading,
    barList(
      cal.months.map((m) => {
        const [year, month] = m.month.split("-");
        return { name: copy.unitMonth(Number(year), Number(month)), count: m.count };
      }),
    ),
  );
}

function runRow(name: string, run: Run): string[] {
  return run === null ? [name, copy.unitNoRun, copy.noValue, copy.noValue] : [name, copy.unitDays(run.days), copy.unitFrom(dayText(run.start)), copy.unitTo(dayText(run.end))];
}

/** A run table under its own small heading, so the all-time table and the year's can be told apart. */
function runsTable(caption: string, streaks: Streaks): HTMLElement {
  return subsection(
    caption,
    dataTable(caption, [copy.runHeader, copy.lengthHeader, copy.fromHeader, copy.toHeader], [runRow(copy.activeRunRow, streaks.longestActive), runRow(copy.quietRunRow, streaks.longestQuiet)]),
  );
}

function runsSection(v: CalendarView): HTMLElement {
  const cal = v.year?.calendar;
  return section(
    copy.runsHeading,
    runsTable(copy.allTimeRunsCaption, v.result.streaks),
    cal !== undefined && cal.total > 0 ? runsTable(copy.yearRunsCaption(cal.year), cal.streaks) : null,
    h("p", { class: "caption" }, copy.runsNote),
  );
}

function kindsSection(v: CalendarView): HTMLElement {
  const { mix } = v.result;
  const cal = v.year?.calendar;
  const showYear = cal !== undefined && cal.total > 0;
  const headers = [copy.kindHeader, copy.allTimeHeader, copy.shareHeader, ...(showYear ? [copy.yearColumnHeader(cal.year)] : [])];
  const rows = insights.activityCalendar.KIND_ORDER.map((kind) => {
    const row = [copy.kindNames[kind], copy.unitCounted(formatCount(mix[kind])), copy.unitOfTotal(formatPercent(mix.total > 0 ? mix[kind] / mix.total : 0))];
    if (showYear) row.push(copy.unitInYear(cal.year, formatCount((cal.mix as Mix)[kind])));
    return row;
  });
  return section(copy.kindsHeading, dataTable(copy.kindsCaption, headers, rows), h("p", { class: "caption" }, copy.otherNote));
}

function kindsByYearSection(v: CalendarView): HTMLElement | null {
  if (v.yearsShown.length === 0) return null;
  const kinds = insights.activityCalendar.KIND_ORDER;
  const headers = [copy.yearHeader, ...kinds.map((k) => copy.kindNames[k]), copy.totalHeader];
  const rows = v.yearsShown.map((m) => [String(m.year), ...kinds.map((k) => copy.unitKindCount(formatCount(m[k]), copy.kindNames[k].toLowerCase())), copy.unitInAll(formatCount(m.total))]);
  return section(
    copy.kindsByYearHeading,
    dataTable(copy.kindsByYearCaption, headers, rows),
    v.yearsShown.length < v.yearsTotal ? h("p", { class: "caption" }, copy.yearsShownLine(v.yearsShown.length, v.yearsTotal)) : null,
  );
}

export const view = toolView<CalendarView, CalendarParams>({
  meta,
  copy,
  params: DEFAULT_PARAMS,
  compute: computeCalendar,
  summary: ({ result }) => (result.totals.used === 0 ? copy.emptyAnnounce : copy.summaryAnnounce(result.totals.used, result.totals.activeDays)),
  isEmpty: ({ result }) => result.totals.used === 0,
  controls: calendarControls,
  render: (v) => [section(copy.glanceHeading, glance(v)), yearSection(v), monthsSection(v), runsSection(v), kindsSection(v), kindsByYearSection(v)],
  notes: ({ result }): ToolNote[] => result.notes.map((n): ToolNote => ({ kind: isWarning(n.code) ? "warning" : "info", text: noteText(n) })),
  command: "calendar",
});
