import { announce } from "../announce.ts";
import { common, routes, tools } from "../copy.ts";
import { hubSearch } from "../copy-tools.ts";
import { h } from "../dom.ts";
import type { Child } from "../dom.ts";
import { button, routeLink } from "../components/button.ts";
import { pageHeader, section } from "../components/layout.ts";
import { notice } from "../components/notice.ts";
import { toolTile } from "../components/toolTile.ts";
import { onDispose, region } from "../reactive.ts";
import { toolData, toolDeps, unmetNeed } from "../tools/data.ts";
import { groupedTools } from "../tools/registry.ts";
import type { View } from "./context.ts";

/** Quiet time after the last key before the count is spoken. */
const ANNOUNCE_MS = 400;

/** Every typed word must be in the tool's title or its one line, in any order and any case. Nothing typed matches every tool. */
export function matchesTool(tool: { title: string; oneLiner: string }, query: string): boolean {
  const text = `${tool.title} ${tool.oneLiner}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== "")
    .every((word) => text.includes(word));
}

/**
 * The Tools hub: every tool as a tile, in groups, each saying whether it is ready for the export on this page. A "Find a tool"
 * field above them narrows the tiles by title and one-liner as you type. What is typed is a piece of a tool's name: it is kept in
 * this page only, never in the address, the title or storage. It is a plain type="search" input, so a page-wide "/" can find it.
 */
export const toolsView: View = ({ store }) => {
  let query = "";
  let sections: HTMLElement[] = [];
  const all = groupedTools().flatMap(({ tools: members }) => members);
  const byId = new Map(all.map((tool) => [tool.id, tool]));

  const count = h("p", { class: "caption hub-count" });
  count.hidden = true;
  const none = h("p", { class: "hub-none" }, hubSearch.none);
  none.hidden = true;

  /** Show only the tiles that match, size each group's columns for what is left, and hide a group with none. Returns how many show. */
  const filter = (): number => {
    let shown = 0;
    for (const group of sections) {
      let visible = 0;
      for (const tile of group.querySelectorAll<HTMLElement>("a.tile")) {
        const tool = byId.get((tile.getAttribute("href") ?? "").replace("#/tools/", ""));
        const match = tool === undefined || matchesTool(tool, query);
        tile.hidden = !match;
        if (match) visible++;
      }
      // The count picks the column spans, so a group of two, five or seven has no hole in its last row.
      const grid = group.querySelector(".tiles");
      if (grid) grid.className = grid.className.replace(/tiles-n-\d+/, `tiles-n-${Math.min(Math.max(visible, 1), 7)}`);
      group.hidden = visible === 0;
      shown += visible;
    }
    count.hidden = query.trim() === "";
    count.textContent = count.hidden ? "" : hubSearch.count(shown, all.length);
    none.hidden = shown !== 0;
    return shown;
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const input = h("input", {
    id: "tool-search",
    class: "input",
    type: "search",
    autocomplete: "off",
    spellcheck: "false",
    autocapitalize: "off",
    placeholder: hubSearch.placeholder,
    "data-key": "tool-search",
  });
  const clear = button({ label: hubSearch.clear, ariaLabel: hubSearch.clearAria, key: "tool-search-clear" });
  clear.hidden = true;
  const changed = (): void => {
    query = input.value;
    clear.hidden = query === "";
    const shown = filter();
    clearTimeout(timer);
    timer = query.trim() === "" ? undefined : setTimeout(() => announce(shown === 0 ? hubSearch.none : hubSearch.count(shown, all.length)), ANNOUNCE_MS);
  };
  const reset = (): void => {
    input.value = "";
    changed();
    input.focus();
  };
  input.addEventListener("input", changed);
  input.addEventListener("keydown", (event) => {
    if ((event as KeyboardEvent).key !== "Escape" || input.value === "") return;
    // Escape empties the field first; the page's own Escape handling (the phone menu) is not also triggered.
    event.stopPropagation();
    event.preventDefault();
    reset();
  });
  clear.addEventListener("click", reset);
  onDispose(() => clearTimeout(timer));

  const field = h(
    "div",
    { class: "field list-search tool-search" },
    h("label", { class: "label", for: "tool-search" }, hubSearch.label),
    h("div", { class: "search-row" }, input, clear),
    count,
  );

  return h(
    "div",
    { class: "view" },
    pageHeader(routes.tools.title, tools.lead, { icon: "tools" }),
    field,
    region(store, toolDeps, (s) => {
      const drawn = render(toolData(s));
      sections = drawn.sections;
      // A repaint of the tiles (the data changed) keeps the words typed so far.
      filter();
      return [drawn.noExport, ...drawn.sections, none];
    }),
  );
};

function render(data: ReturnType<typeof toolData>): { noExport: Child; sections: HTMLElement[] } {
  let index = 0;
  const sections = groupedTools().map(({ group, tools: members }) =>
    section(
      tools.groups[group.id],
      // The count picks the column spans, so a group of two, five or seven has no hole in its last row.
      h(
        "div",
        { class: `tiles tiles-tools tiles-n-${Math.min(members.length, 7)}` },
        ...members.map((tool) => {
          const need = unmetNeed(data, tool.needs);
          return toolTile(tool, need === null ? null : tools.statusNeeds[need], index++);
        }),
      ),
    ),
  );
  return {
    noExport: data.source === "none" ? notice("info", tools.noExportNote, { extra: [h("div", { class: "actions" }, routeLink("start", common.addExport, "primary"))] }) : null,
    sections,
  };
}
