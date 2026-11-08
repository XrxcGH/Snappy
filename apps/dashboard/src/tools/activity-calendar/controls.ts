/**
 * The two inputs of the calendar: the time zone and the year. Built once per page, so a choice is never interrupted
 * when the result repaints. The year list is every year the export could hold, newest first, after "Latest year".
 */
import { icon } from "../../components/icon.ts";
import type { ToolUi } from "../../components/toolPage.ts";
import { h } from "../../dom.ts";
import { startingOffset, zoneOptions } from "../timezone.ts";
import { copy } from "./copy.ts";
import { yearChoices } from "./model.ts";
import type { CalendarParams } from "./model.ts";

/** The zone picked on this page earlier in the session, which the page keeps for itself; null until one is picked. */
let chosenZone: number | null = null;

/** Drop the pick (for tests). */
export const dropChosenZone = (): void => {
  chosenZone = null;
};

/** The zone the page opens in: the one picked here earlier in the session, else the device's (or the last one remembered). */
export const openingZone = (): number => chosenZone ?? startingOffset();

function field(id: string, label: string, help: string, select: HTMLElement): HTMLElement {
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

export function calendarControls(ui: ToolUi<CalendarParams>): HTMLElement {
  const zoneId = "calendar-zone";
  const zone = h(
    "select",
    { id: zoneId, class: "input", "data-key": zoneId, "aria-describedby": `${zoneId}-help` },
    ...zoneOptions(ui.params.utcOffsetMinutes),
  );
  zone.addEventListener("change", () => {
    const minutes = Number(zone.value);
    if (!Number.isFinite(minutes)) return;
    chosenZone = minutes;
    ui.set({ utcOffsetMinutes: minutes });
  });

  const yearId = "calendar-year";
  const year = h(
    "select",
    { id: yearId, class: "input", "data-key": yearId, "aria-describedby": `${yearId}-help` },
    h("option", { value: "", selected: ui.params.year === null }, copy.latestOption),
    ...yearChoices(ui.data).map((y) => h("option", { value: String(y), selected: y === ui.params.year }, String(y))),
  );
  year.addEventListener("change", () => {
    const chosen = year.value === "" ? null : Number(year.value);
    if (chosen === null || Number.isInteger(chosen)) ui.set({ year: chosen });
  });

  return h("div", { class: "controls" }, field(zoneId, copy.zoneLabel, copy.zoneHelp, zone), field(yearId, copy.yearLabel, copy.yearHelp, year));
}
