import { common, routes, tools } from "../copy.ts";
import { h } from "../dom.ts";
import type { Child } from "../dom.ts";
import { routeLink } from "../components/button.ts";
import { pageHeader, section } from "../components/layout.ts";
import { notice } from "../components/notice.ts";
import { toolTile } from "../components/toolTile.ts";
import { region } from "../reactive.ts";
import { toolData, toolDeps, unmetNeed } from "../tools/data.ts";
import { groupedTools } from "../tools/registry.ts";
import type { View } from "./context.ts";

/** The Tools hub: every tool as a tile, in groups, each saying whether it is ready for the export on this page. */
export const toolsView: View = ({ store }) =>
  h("div", { class: "view" }, pageHeader(routes.tools.title, tools.lead, { icon: "tools" }), region(store, toolDeps, (s) => render(toolData(s))));

function render(data: ReturnType<typeof toolData>): Child[] {
  let index = 0;
  const groups = groupedTools().map(({ group, tools: members }) =>
    section(
      tools.groups[group.id],
      // The count picks the column spans, so a group of two or five has no hole in its last row.
      h(
        "div",
        { class: `tiles tiles-tools tiles-n-${Math.min(members.length, 6)}` },
        ...members.map((tool) => {
          const need = unmetNeed(data, tool.needs);
          return toolTile(tool, need === null ? null : tools.statusNeeds[need], index++);
        }),
      ),
    ),
  );
  return [data.source === "none" ? notice("info", tools.noExportNote, { extra: [h("div", { class: "actions" }, routeLink("start", common.addExport, "primary"))] }) : null, ...groups];
}
