import { dataTable } from "../../components/dataTable.ts";
import { icon } from "../../components/icon.ts";
import { factList, section } from "../../components/layout.ts";
import { toolView } from "../../components/toolPage.ts";
import type { ToolNote, ToolUi } from "../../components/toolPage.ts";
import { h } from "../../dom.ts";
import { formatCount, formatDate } from "../../format.ts";
import type { ToolMeta } from "../types.ts";
import { OFFSETS, offsetLabel, startingOffset } from "../timezone.ts";
import { copy } from "./copy.ts";
import { computeMemoriesOnThisDay, DEFAULT_PARAMS } from "./model.ts";
import type { OnThisDayParams, OnThisDayResult, ResultNote } from "./model.ts";

export const meta: ToolMeta = { id: "memories-on-this-day", group: "memories", category: "memories", icon: "calendar", needs: ["memories"] };

/** Days either side to offer. */
const WINDOWS = [0, 1, 3, 7] as const;

/**
 * The page opens in the zone the person's device is in (or the one chosen in Settings), read each time the page opens. A zone
 * picked on this page stays on this page: it is not remembered for the next one.
 */
const START: OnThisDayParams = Object.defineProperty({ ...DEFAULT_PARAMS }, "offsetMinutes", { get: startingOffset, enumerable: true, configurable: true });

const num = (n: ResultNote, key: string): number => n.params[key] ?? 0;

/** The sentence for one note from core. Hedged: Snappy infers from the dates in the list. */
function noteOf(n: ResultNote): ToolNote {
  const count = num(n, "count");
  switch (n.code) {
    case "undated-items":
      return { kind: "info", text: copy.undatedNote(count) };
    case "future-dates-skipped":
      return { kind: "warning", text: copy.futureNote(count) };
    case "duplicate-ids-skipped":
      return { kind: "info", text: copy.duplicateNote(count) };
    case "invalid-ids-skipped":
      return { kind: "warning", text: copy.noIdNote(count) };
    case "no-dated-items":
      return { kind: "warning", text: copy.noDatesNote };
    case "invalid-target":
      return { kind: "warning", text: copy.invalidDayNote };
    case "window-adjusted":
      return { kind: "info", text: copy.windowNote(num(n, "windowDays")) };
    case "leap-day-folded":
      return { kind: "info", text: copy.leapNote(count) };
    case "offset-invalid":
      return { kind: "warning", text: copy.offsetInvalidNote };
    default:
      return { kind: "info", text: copy.otherNote };
  }
}

const dayText = (r: OnThisDayResult): string => formatDate(Date.UTC(r.target.year, r.target.month - 1, r.target.day));

/** A select with its label, drawn like the other selects: the chevron is its own icon, not the browser's arrow. */
function selectField(id: string, label: string, options: readonly [string, string][], value: string, onChange: (value: string) => void): HTMLElement {
  const select = h("select", { id, class: "input", "data-key": id }, ...options.map(([v, text]) => h("option", { value: v, selected: v === value }, text)));
  select.addEventListener("change", () => onChange(select.value));
  const chevron = icon("chevron-right", 16);
  chevron.setAttribute("class", "icon select-chevron");
  return h("div", { class: "field" }, h("label", { class: "label", for: id }, label), h("div", { class: "select-wrap" }, select, chevron));
}

function controls(ui: ToolUi<OnThisDayParams>): HTMLElement {
  const date = h("input", { id: "otd-date", class: "input", type: "date", value: ui.params.date, "aria-describedby": "otd-date-help", "data-key": "otd-date" });
  date.addEventListener("input", () => ui.set({ date: date.value }));
  return h(
    "div",
    { class: "filters" },
    h("div", { class: "field" }, h("label", { class: "label", for: "otd-date" }, copy.dateLabel), date, h("p", { id: "otd-date-help", class: "caption" }, copy.dateHelpNote)),
    selectField(
      "otd-window",
      copy.windowLabel,
      WINDOWS.map((d): [string, string] => [String(d), copy.unitWindow(d)]),
      String(ui.params.windowDays),
      (v) => ui.set({ windowDays: Number(v) }),
    ),
    selectField(
      "otd-offset",
      copy.zoneLabel,
      OFFSETS.map((m): [string, string] => [String(m), offsetLabel(m)]),
      String(ui.params.offsetMinutes),
      (v) => ui.set({ offsetMinutes: Number(v) }),
    ),
  );
}

function daySection(r: OnThisDayResult): HTMLElement {
  const near = r.windowDays > 0;
  return section(
    copy.dayHeading,
    h("p", {}, copy.lookingLine(dayText(r), r.isToday, r.windowDays)),
    h("p", {}, r.total === 0 ? copy.noneLine(near) : copy.foundLine(r.total, r.years.length, near)),
    r.total === 0
      ? null
      : dataTable(
          copy.dayCaption,
          [copy.yearHeader, copy.whenHeader, copy.memoriesHeader],
          r.years.map((y) => [String(y.year), copy.unitAgo(y.yearsAgo), copy.unitMemories(y.count)]),
        ),
  );
}

function yearsSection(r: OnThisDayResult): HTMLElement {
  const { counts } = r;
  return section(
    copy.yearsHeading,
    factList([
      { label: copy.datedLabel, value: formatCount(counts.dated), icon: "memories", scope: "memories" },
      { label: copy.spanLabel, value: r.firstYear !== null && r.lastYear !== null ? copy.unitYearSpan(r.firstYear, r.lastYear) : "-", icon: "calendar", scope: "memories" },
      { label: copy.leftOutLabel, value: formatCount(counts.undated + counts.future), icon: "minus", scope: "memories" },
    ]),
    dataTable(
      copy.yearsCaption,
      [copy.yearHeader, copy.memoriesHeader, copy.busiestHeader],
      r.byYear.map((y) => [String(y.year), copy.unitMemories(y.total), y.busiestMonth === null ? copy.unitNoBusiest : copy.unitBusiest(y.busiestMonth, y.busiestCount)]),
    ),
  );
}

function topDaysSection(r: OnThisDayResult): HTMLElement {
  return section(
    copy.topDaysHeading,
    dataTable(
      copy.topDaysCaption,
      [copy.dayHeader, copy.memoriesHeader, copy.yearsHeader],
      r.topDays.map((d) => [copy.unitMonthDay(d.month, d.day), copy.unitMemories(d.count), copy.unitYears(d.years)]),
    ),
  );
}

export const view = toolView<OnThisDayResult, OnThisDayParams>({
  meta,
  copy,
  params: START,
  compute: computeMemoriesOnThisDay,
  isEmpty: (r) => r.counts.dated === 0,
  summary: (r) => (r.counts.dated === 0 ? copy.emptyAnnounce : r.total === 0 ? copy.noneAnnounce(r.windowDays > 0) : copy.foundAnnounce(r.total, r.windowDays > 0)),
  controls,
  render: (r) => [daySection(r), yearsSection(r), topDaysSection(r)],
  notes: (r): ToolNote[] => [{ kind: "info", text: copy.offsetNote(offsetLabel(r.utcOffsetMinutes)) }, ...r.notes.map(noteOf)],
  command: "on-this-day",
});
