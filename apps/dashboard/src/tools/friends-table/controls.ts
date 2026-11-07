/**
 * The inputs of the friends table: the order, which hint to show and the start of a username. Built once per page, so
 * typing is never interrupted when the result repaints. They hold no export value and write no words: every label comes
 * from copy.ts, and a username start goes to the filter as typed text, never into the page as markup.
 */
import { button } from "../../components/button.ts";
import { icon } from "../../components/icon.ts";
import type { ToolUi } from "../../components/toolPage.ts";
import { h } from "../../dom.ts";
import { copy } from "./copy.ts";
import { MAX_PREFIX, SHOW_FILTERS, SORT_ORDERS, orderIdOf } from "./model.ts";
import type { FriendsTableParams, ShowFilter } from "./model.ts";

/** A select with its own chevron, as in the other tools. */
function selectField(id: string, label: string, options: readonly { value: string; text: string; selected: boolean }[], onChange: (value: string) => void): HTMLElement {
  const select = h(
    "select",
    { id, class: "input", "data-key": id },
    ...options.map((o) => h("option", { value: o.value, selected: o.selected }, o.text)),
  );
  select.addEventListener("change", () => onChange(select.value));
  const chevron = icon("chevron-right", 16);
  chevron.setAttribute("class", "icon select-chevron");
  return h("div", { class: "field" }, h("label", { class: "label", for: id }, label), h("div", { class: "select-wrap" }, select, chevron));
}

export function controls(ui: ToolUi<FriendsTableParams>): HTMLElement {
  const order = orderIdOf(ui.params);
  const sort = selectField(
    "friends-table-sort",
    copy.sortLabel,
    SORT_ORDERS.map((o) => ({ value: o.id, text: copy.sortLabels[o.id], selected: o.id === order })),
    (value) => {
      const chosen = SORT_ORDERS.find((o) => o.id === value);
      if (chosen !== undefined) ui.set({ sort: chosen.sort, desc: chosen.desc });
    },
  );
  const show = selectField(
    "friends-table-show",
    copy.showLabel,
    SHOW_FILTERS.map((value) => ({ value, text: copy.showLabels[value], selected: value === ui.params.show })),
    (value) => {
      const chosen = SHOW_FILTERS.find((v): v is ShowFilter => v === value);
      if (chosen !== undefined) ui.set({ show: chosen });
      syncClear();
    },
  );
  const showSelect = show.querySelector("select") as HTMLSelectElement;

  const input = h("input", {
    id: "friends-table-starts",
    class: "input input-narrow",
    type: "text",
    autocomplete: "off",
    autocapitalize: "off",
    spellcheck: "false",
    maxlength: MAX_PREFIX,
    value: ui.params.prefix,
    "data-key": "friends-table-starts",
  });
  // Clear filters resets the two filters (not the order) and sits out of sight until one is on, so there is always a way back from "no friends match".
  const clear = button({
    label: copy.clearButton,
    variant: "quiet",
    key: "friends-table-clear",
    onclick: () => {
      input.value = "";
      showSelect.value = "all";
      ui.set({ show: "all", prefix: "" });
      syncClear();
    },
  });
  const syncClear = (): void => {
    if (ui.params.show === "all" && ui.params.prefix === "") clear.setAttribute("hidden", "");
    else clear.removeAttribute("hidden");
  };
  const apply = (): void => {
    if (input.value.trim() !== ui.params.prefix) ui.set({ prefix: input.value.trim() });
    syncClear();
  };
  const form = h(
    "form",
    { class: "form", novalidate: true },
    h(
      "div",
      { class: "field" },
      h("label", { class: "label", for: "friends-table-starts" }, copy.startsLabel),
      h("div", { class: "field-row" }, input, button({ label: copy.applyButton, type: "submit", key: "friends-table-apply" }), clear),
    ),
  );
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    apply();
  });

  syncClear();
  return h("div", { class: "controls", role: "group", "aria-label": copy.controlsLabel }, sort, show, form);
}
