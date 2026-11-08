/**
 * The two inputs of the anniversaries page: how far ahead to look, and milestones only. Built once per page,
 * so the controls keep focus while only the result repaints. They hold no export value and write no words:
 * every label comes from copy.ts.
 */
import { icon } from "../../components/icon.ts";
import { h } from "../../dom.ts";
import type { ToolUi } from "../../components/toolPage.ts";
import { copy } from "./copy.ts";
import type { AnniversaryParams } from "./model.ts";

export function controls(ui: ToolUi<AnniversaryParams>): HTMLElement {
  const select = h(
    "select",
    { id: "anniversaries-window", class: "input", "data-key": "anniversaries-window" },
    ...copy.windowOptions.map((o) => h("option", { value: String(o.days), selected: o.days === ui.params.windowDays }, o.label)),
  );
  select.addEventListener("change", () => ui.set({ windowDays: Number(select.value) }));
  // The select draws no native arrow: the chevron is its own icon, as in the other selects.
  const chevron = icon("chevron-right", 16);
  chevron.setAttribute("class", "icon select-chevron");

  const box = h("input", { type: "checkbox", class: "check-input", checked: ui.params.milestonesOnly, "data-key": "anniversaries-milestones", "aria-describedby": "anniversaries-milestones-help" });
  box.addEventListener("change", () => ui.set({ milestonesOnly: box.checked }));

  return h(
    "div",
    { class: "controls", role: "group", "aria-label": copy.controlsLabel },
    h("div", { class: "field" }, h("label", { class: "label", for: "anniversaries-window" }, copy.windowLabel), h("div", { class: "select-wrap" }, select, chevron)),
    h("div", { class: "field" }, h("label", { class: "check" }, box, h("span", {}, copy.milestonesLabel)), h("p", { class: "caption", id: "anniversaries-milestones-help" }, copy.milestonesHelp)),
  );
}
