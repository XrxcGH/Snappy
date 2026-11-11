import { insights } from "@snappy-export/core";
import { dataTable } from "../../components/dataTable.ts";
import type { TableCell } from "../../components/dataTable.ts";
import { columns, factList, section, subsection } from "../../components/layout.ts";
import { icon } from "../../components/icon.ts";
import { toolView } from "../../components/toolPage.ts";
import type { ToolNote, ToolUi } from "../../components/toolPage.ts";
import { h, setVar } from "../../dom.ts";
import { formatCount, formatDateIn, formatPercent } from "../../format.ts";
import type { View } from "../../views/context.ts";
import { startingOffset, zoneCaption, zoneOptions } from "../timezone.ts";
import type { ToolMeta } from "../types.ts";
import { copy } from "./copy.ts";
import { computeHabits, DEFAULT_PARAMS } from "./model.ts";
import type { HabitsParams, HabitsView, Peak } from "./model.ts";

export const meta: ToolMeta = { id: "habits", group: "chats", category: "quiet", icon: "snapshots", needs: ["chats"] };

const num = (v: number | undefined): number => (typeof v === "number" ? v : 0);

/** The sentence for one note. Hedged: Snappy infers from times and directions alone. */
function noteText(n: insights.habits.HabitsNote): string {
  const count = num(n.params.count);
  switch (n.code) {
    case "no-events":
    case "no-usable-events":
      return copy.noneNote;
    case "undated-skipped":
      return copy.undatedNote(count);
    case "future-skipped":
      return copy.futureNote(count);
    case "few-events":
      return copy.fewNote(count);
    case "many-unknown-direction":
      return copy.unknownNote(num(n.params.percent));
    case "offset-adjusted":
      return copy.zoneNote;
    default:
      return copy.otherNote;
  }
}

const isWarning = (code: insights.habits.HabitsNoteCode): boolean => code === "no-events" || code === "no-usable-events" || code === "few-events" || code === "many-unknown-direction";

/** "YYYY-MM" as "Mar 2026". */
function monthText(key: string | number | null): string {
  if (typeof key !== "string") return copy.noValue;
  const [year, month] = key.split("-");
  return copy.unitMonth(Number(year), Number(month)) || copy.noValue;
}

const hourText = (key: number | string | null): string => (typeof key === "number" ? copy.unitHour(key) || copy.noValue : copy.noValue);
const weekdayText = (key: number | string | null): string => (typeof key === "number" ? (copy.weekdays[key] ?? copy.noValue) : copy.noValue);

function peakRow(pattern: string, noun: string, peak: Peak, text: (key: number | string | null) => string): TableCell[] {
  const busiest = text(peak.busiest);
  const named = peak.tied ? copy.unitTied(busiest) : busiest;
  const quietest = text(peak.quietest);
  const share = formatPercent(peak.share);
  return [
    pattern,
    { text: named, label: copy.unitBusiestAt(named) },
    { text: share, label: copy.unitPeakShare(share, noun) },
    quietest === copy.noValue ? { text: copy.noQuietestCell, label: copy.unitNoQuietest } : { text: quietest, label: copy.unitQuietestAt(quietest) },
  ];
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

function glance({ result }: HabitsView, offsetMinutes: number): HTMLElement {
  const { totals } = result;
  const facts: Parameters<typeof factList>[0][number][] = [
    { label: copy.countedLabel, value: formatCount(totals.used), icon: "list" },
    { label: copy.activeDaysLabel, value: formatCount(result.activeDays), icon: "calendar" },
  ];
  if (result.first !== null) facts.push({ label: copy.firstLabel, value: formatDateIn(result.first, offsetMinutes), icon: "calendar" });
  if (result.last !== null) facts.push({ label: copy.lastLabel, value: formatDateIn(result.last, offsetMinutes), icon: "calendar" });
  if (result.medianGapMs !== null) facts.push({ label: copy.gapLabel, value: copy.unitGap(result.medianGapMs) || copy.noValue, icon: "queue" });
  return factList(facts);
}

function busiest(v: HabitsView): HTMLElement {
  const rows: TableCell[][] = [];
  if (v.hour) rows.push(peakRow(copy.hourPattern, copy.unitHourNoun, v.hour, hourText));
  if (v.weekday) rows.push(peakRow(copy.weekdayPattern, copy.unitWeekdayNoun, v.weekday, weekdayText));
  if (v.month) rows.push(peakRow(copy.monthPattern, copy.unitMonthNoun, v.month, monthText));
  return section(copy.busiestHeading, dataTable(copy.busiestCaption, [copy.patternHeader, copy.busiestHeader, copy.shareHeader, copy.quietestHeader], rows));
}

function direction({ result }: HabitsView): HTMLElement {
  const { totals } = result;
  const used = totals.used;
  const row = (name: string, n: number): TableCell[] => {
    const share = formatPercent(used > 0 ? n / used : 0);
    return [name, { text: formatCount(n), label: copy.unitCounted(formatCount(n)) }, { text: share, label: copy.unitOfTotal(share) }];
  };
  return section(
    copy.directionHeading,
    dataTable(copy.directionCaption, [copy.directionHeader, copy.countHeader, copy.shareHeader], [row(copy.sentRow, totals.sent), row(copy.receivedRow, totals.received), row(copy.unknownRow, totals.unknown)]),
    result.sentShare === null ? null : h("p", {}, copy.sentLine(Math.round(result.sentShare * 100))),
  );
}

function offsetField(ui: ToolUi<HabitsParams>): HTMLElement {
  const id = "habits-zone";
  const select = h(
    "select",
    { id, class: "input", "data-key": "habits-zone", "aria-describedby": `${id}-help` },
    ...zoneOptions(ui.params.utcOffsetMinutes),
  );
  select.addEventListener("change", () => {
    const minutes = Number(select.value);
    if (!Number.isFinite(minutes)) return;
    chosenZone = minutes;
    ui.set({ utcOffsetMinutes: minutes });
  });
  // The select draws no native arrow: the chevron is its own icon.
  const chevron = icon("chevron-right", 16);
  chevron.setAttribute("class", "icon select-chevron");
  return h(
    "div",
    { class: "field" },
    h("label", { class: "label", for: id }, copy.zoneLabel),
    h("div", { class: "select-wrap" }, select, chevron),
    h("p", { class: "caption", id: `${id}-help` }, copy.zoneHelp),
  );
}

/** The zone picked on this page earlier in the session, which the page keeps for itself; null until one is picked. */
let chosenZone: number | null = null;

/** Drop the pick (for tests). */
export const dropChosenZone = (): void => {
  chosenZone = null;
};

/** The zone the page opens in: the one picked here earlier in the session, else the device's (or the last one remembered). */
const openingZone = (): number => chosenZone ?? startingOffset();

const page = (params: HabitsParams): View =>
  toolView<HabitsView, HabitsParams>({
    meta,
    copy,
    params,
    compute: computeHabits,
    summary: ({ result }) => (result.totals.used === 0 ? copy.emptyAnnounce : copy.summaryAnnounce(result.totals.used, result.activeDays)),
    isEmpty: ({ result }) => result.totals.used === 0,
    controls: offsetField,
    render: (v, ui) => {
      const { result } = v;
      return [
        section(copy.glanceHeading, glance(v, ui.params.utcOffsetMinutes), zoneCaption(ui.params.utcOffsetMinutes)),
        busiest(v),
        direction(v),
        // The three bar lists are independent: two columns on a wide screen.
        columns(
          section(copy.hourHeading, barList(result.byHour.map((b) => ({ name: copy.unitHour(b.hour), count: b.total })))),
          section(copy.weekdayHeading, barList(result.byWeekday.map((b) => ({ name: copy.weekdays[b.weekday] ?? copy.noValue, count: b.total })))),
          v.months.length > 0
            ? section(
                copy.monthHeading,
                barList(
                  v.months.map((m) => {
                    const [year, month] = m.month.split("-");
                    return { name: copy.unitMonth(Number(year), Number(month)), count: m.total };
                  }),
                ),
                v.months.length < v.monthsTotal ? h("p", { class: "caption" }, copy.monthsShownLine(v.months.length, v.monthsTotal)) : null,
              )
            : null,
        ),
      ];
    },
    notes: ({ result }): ToolNote[] => [
      ...result.notes.map((n): ToolNote => ({ kind: isWarning(n.code) ? "warning" : "info", text: noteText(n) })),
      ...(result.byMonth.length >= 2 ? [{ kind: "info", text: copy.partialNote } as const] : []),
    ],
    command: "habits",
  });

export const view: View = (ctx) => page({ ...DEFAULT_PARAMS, utcOffsetMinutes: openingZone() })(ctx);
