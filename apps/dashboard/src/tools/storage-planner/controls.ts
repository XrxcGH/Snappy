/**
 * The two inputs of the planner: the storage goal and which year to save first. Built once per page, so typing is
 * never interrupted when the result repaints. A goal that is not a sensible number is refused on the spot and
 * never reaches the plan.
 */
import { button } from "../../components/button.ts";
import { icon } from "../../components/icon.ts";
import type { ToolUi } from "../../components/toolPage.ts";
import { h } from "../../dom.ts";
import { parseCapGiB } from "../../parse-input.ts";
import { copy } from "./copy.ts";
import type { StoragePlannerParams } from "./model.ts";

export function storageControls(ui: ToolUi<StoragePlannerParams>): HTMLElement {
  const shownGoal = ui.params.goalGiB ?? ui.data.capGiB;
  const input = h("input", {
    id: "storage-goal",
    class: "input input-narrow",
    type: "text",
    inputmode: "decimal",
    autocomplete: "off",
    value: String(shownGoal),
    "aria-describedby": "storage-goal-help storage-goal-error",
    "data-key": "storage-goal",
  });
  const error = h("p", { class: "field-error", id: "storage-goal-error", role: "alert" });

  const select = h(
    "select",
    { id: "storage-order", class: "input", "data-key": "storage-order" },
    h("option", { value: "newest-first", selected: ui.params.order === "newest-first" }, copy.newestLine),
    h("option", { value: "oldest-first", selected: ui.params.order === "oldest-first" }, copy.oldestLine),
  );
  select.addEventListener("change", () => ui.set({ order: select.value === "oldest-first" ? "oldest-first" : "newest-first" }));
  const chevron = icon("chevron-right", 16);
  chevron.setAttribute("class", "icon select-chevron");

  const form = h(
    "form",
    { class: "form", novalidate: true },
    h(
      "div",
      { class: "field" },
      h("label", { class: "label", for: "storage-goal" }, copy.goalHeader),
      h("div", { class: "field-row" }, input, button({ label: copy.updateButton, type: "submit", key: "storage-goal-submit" })),
      h("p", { id: "storage-goal-help" }, copy.goalHelp),
      error,
    ),
    h("div", { class: "field" }, h("label", { class: "label", for: "storage-order" }, copy.orderHeader), h("div", { class: "select-wrap" }, select, chevron)),
  );
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const gib = parseCapGiB(input.value);
    if (gib === undefined) {
      input.setAttribute("aria-invalid", "true");
      error.textContent = copy.goalError;
      input.focus();
      return;
    }
    input.removeAttribute("aria-invalid");
    error.textContent = "";
    ui.set({ goalGiB: gib });
  });
  return form;
}
