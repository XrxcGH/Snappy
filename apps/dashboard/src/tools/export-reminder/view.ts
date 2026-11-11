import { insights } from "@snappy-export/core";
import { icon } from "../../components/icon.ts";
import { factList, section } from "../../components/layout.ts";
import { toolView } from "../../components/toolPage.ts";
import type { ToolNote, ToolUi } from "../../components/toolPage.ts";
import { h } from "../../dom.ts";
import type { Child } from "../../dom.ts";
import { formatDate } from "../../format.ts";
import { startingOffset, zoneOptions } from "../timezone.ts";
import type { ToolMeta } from "../types.ts";
import { copy } from "./copy.ts";
import { buildReminderFile, computeExportReminder, DEFAULT_PARAMS } from "./model.ts";
import type { ReminderParams, ReminderResult } from "./model.ts";

export const meta: ToolMeta = { id: "export-reminder", group: "your-export", category: "cleanup", icon: "calendar", needs: [] };

const num = (v: number | undefined): number => (typeof v === "number" ? v : 0);

/** The sentence for one of core's notes. Hedged: Snappy works from the dates it was given. */
function noteText(n: insights.exportReminder.ReminderNote, result: ReminderResult): string {
  switch (n.code) {
    case "no-last-export":
      return copy.noLastNote;
    case "last-export-invalid":
      return copy.invalidLastNote;
    case "last-export-in-future":
      return copy.futureLastNote;
    case "interval-adjusted":
      return copy.monthsAdjustedNote(num(n.params.used));
    case "time-adjusted":
      return copy.timeAdjustedNote;
    case "alarm-adjusted":
      return copy.alertAdjustedNote;
    case "offset-adjusted":
      return copy.zoneAdjustedNote;
    case "day-clamped":
      return copy.clampedNote;
    case "due-date-passed":
      return result.lastDayAt === null ? copy.passedNoDateNote : copy.passedNote;
    default:
      return copy.otherNote;
  }
}

const WARNINGS = new Set(["due-date-passed", "last-export-in-future"]);

/** Core reports every adjustment. A day moved to the last of a month, then to tomorrow, is only about tomorrow in the end. */
function notesFor(result: ReminderResult): insights.exportReminder.ReminderNote[] {
  const passed = result.notes.some((n) => n.code === "due-date-passed");
  return passed ? result.notes.filter((n) => n.code !== "day-clamped") : result.notes;
}

/**
 * The page opens in the zone the person's device is in (or the one chosen in Settings), read each time the page opens. A zone
 * picked on this page stays on this page: it is not remembered for the next one.
 */
const START: ReminderParams = Object.defineProperty({ ...DEFAULT_PARAMS }, "offset", { get: () => String(startingOffset()), enumerable: true, configurable: true });

/** A label above a field, the field, and a short help line under it. */
function field(id: string, label: string, help: string, control: Child): HTMLElement {
  return h("div", { class: "field" }, h("label", { class: "label", for: id }, label), control, h("p", { class: "caption", id: `${id}-help` }, help));
}

function textInput(id: string, type: string, value: string, narrow: boolean, onValue: (value: string) => void, extra: Record<string, string> = {}): HTMLElement {
  const input = h("input", { id, class: narrow ? "input input-narrow" : "input", type, value, autocomplete: "off", "aria-describedby": `${id}-help`, "data-key": id, ...extra });
  input.addEventListener("input", () => onValue(input.value));
  return input;
}

/** The settings. Built once, so typing keeps its place while only the result repaints. */
function controls(ui: ToolUi<ReminderParams>): HTMLElement {
  const p = ui.params;
  const zone = h(
    "select",
    { id: "reminder-zone", class: "input", "aria-describedby": "reminder-zone-help", "data-key": "reminder-zone" },
    ...zoneOptions(Number(p.offset)),
  );
  zone.addEventListener("change", () => ui.set({ offset: zone.value }));
  // The select draws no native arrow: the chevron is its own icon, like the select on the Cleanup page.
  const chevron = icon("chevron-right", 16);
  chevron.setAttribute("class", "icon select-chevron");
  return section(
    copy.settingsHeading,
    h(
      "div",
      { class: "form" },
      field("reminder-last", copy.lastExportHeader, copy.lastExportHelp, textInput("reminder-last", "date", p.lastExport, false, (lastExport) => ui.set({ lastExport }))),
      // The three small boxes share one row of equal columns (see styles.css), so they read as one group.
      h(
        "div",
        { class: "reminder-row" },
        field("reminder-months", copy.monthsHeader, copy.monthsHelp, textInput("reminder-months", "number", p.months, true, (months) => ui.set({ months }), { inputmode: "numeric", min: "1", max: "120" })),
        field("reminder-time", copy.timeHeader, copy.timeHelp, textInput("reminder-time", "time", p.time, true, (time) => ui.set({ time }))),
        field(
          "reminder-alert",
          copy.alertHeader,
          copy.alertHelp,
          textInput("reminder-alert", "number", p.alert, true, (alert) => ui.set({ alert }), { inputmode: "numeric", min: "0", max: "30", placeholder: copy.alertPlaceholder }),
        ),
      ),
      field("reminder-zone", copy.zoneHeader, copy.zoneHelp, h("div", { class: "select-wrap" }, zone, chevron)),
    ),
  );
}

const when = (result: ReminderResult): string => (result.timed === null ? copy.allDayLine : copy.timedLine(copy.unitClock(result.timed.hour, result.timed.minute), result.timed.durationMinutes));
const alertText = (days: number | null): string => (days === null ? copy.noAlertLine : days === 0 ? copy.sameDayLine : copy.alertBeforeLine(days));

export const view = toolView<ReminderResult, ReminderParams>({
  meta,
  copy,
  params: START,
  compute: computeExportReminder,
  summary: (result) => copy.doneAnnounce(formatDate(result.dueAt)),
  controls,
  render: (result) => [
    section(
      copy.reminderHeading,
      h("p", { class: "summary" }, copy.dueLine(formatDate(result.dueAt))),
      factList([
        { label: copy.lastExportFact, value: result.lastDayAt === null ? copy.unknownLine : formatDate(result.lastDayAt), icon: "file-zip" },
        { label: copy.waitFact, value: copy.months(result.intervalMonths), icon: "snapshots" },
        { label: copy.eventFact, value: when(result), icon: "calendar" },
        { label: copy.alertFact, value: alertText(result.alertDays), icon: "info" },
      ]),
    ),
  ],
  notes: (result): ToolNote[] => notesFor(result).map((n) => ({ kind: WARNINGS.has(n.code) ? "warning" : "info", text: noteText(n, result) })),
  download: { label: copy.downloadLabel, note: copy.downloadNote, build: buildReminderFile },
  command: "remind",
});
