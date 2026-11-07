import { tools } from "../copy.ts";
import { h } from "../dom.ts";
import type { ToolDescriptor } from "../tools/types.ts";
import { chipIcon, scopeClass } from "./category.ts";
import { icon } from "./icon.ts";
import { slideIn } from "./layout.ts";

/**
 * Hub tile for one tool. Five rows, centered, the same in every tile: the icon tile, the name, one short line,
 * the status, and the Open action. The grid (`.tiles` in styles.css) shares those rows across the tiles of one
 * row, so everything lines up whatever a neighbor says. The whole tile is the link. The category color is paired
 * with the icon and the name, so it is never the only signal, and the status is words with an icon.
 *
 * `status` is the text for the tool's first missing need, or null when the tool is ready.
 */
export function toolTile(tool: ToolDescriptor, status: string | null, index: number): HTMLElement {
  const ready = status === null;
  return slideIn(
    h(
      "a",
      { class: `card card-link tile tool-tile ${scopeClass(tool.category)}`, href: `#/tools/${tool.id}` },
      chipIcon(tool.icon),
      h("h3", { class: "card-title tile-title" }, tool.title),
      h("p", { class: "tool-line" }, tool.oneLiner),
      h("p", { class: ready ? "tool-status tool-status-ready" : "tool-status" }, icon(ready ? "check" : "minus", 16), h("span", {}, status ?? tools.statusReady)),
      h("span", { class: "tile-action card-open" }, h("span", {}, tools.open), icon("chevron-right", 16)),
    ),
    index,
  );
}
