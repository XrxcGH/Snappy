import { common, overview, routes } from "../copy.ts";
import { h } from "../dom.ts";
import { CATEGORY_ICON, chipIcon, scopeClass } from "./category.ts";
import type { CategoryId } from "./category.ts";
import { icon } from "./icon.ts";
import { slideIn } from "./layout.ts";
import type { RouteId } from "../copy.ts";

export interface FindingCardOptions {
  scope: CategoryId;
  route: RouteId;
  /** The number, already formatted. Omit it when there is nothing to count yet and give `status` instead. */
  figure?: string;
  /** Plain words shown under the name where the number would count (for example, that a second export is needed). */
  status?: string;
  /** What the number counts. */
  unit?: string;
  /** A small extra line, such as how many people are protected. */
  note?: string;
  /** Position in the list, for the first-paint slide-in. */
  index: number;
}

/**
 * Overview tile for one finding area. Everything is centered, in the same five rows in every tile: the category icon
 * tile, the area's name, the key figure in the area's color, what the figure counts, and the Open action. The grid
 * (see `.tiles` in styles.css) shares those rows across the tiles of one row, so the names, figures, descriptions and
 * actions line up whatever the tile above or beside them says. The whole tile is the link. The color is paired with the
 * icon and the area's name, so it is never the only signal.
 */
export function findingCard(options: FindingCardOptions): HTMLElement {
  const words = options.unit ?? options.status ?? "";
  const label = routes[options.route].label;
  return slideIn(
    h(
      "a",
      { class: `card card-link finding tile ${scopeClass(options.scope)}`, href: `#/${options.route}` },
      chipIcon(CATEGORY_ICON[options.scope]),
      h("h3", { class: "card-title tile-title" }, label),
      // With nothing to count yet the number row holds a dash, so the rows still line up. It is decoration: the words below say why.
      options.figure !== undefined ? h("p", { class: "finding-figure" }, options.figure) : h("p", { class: "finding-figure finding-none", "aria-hidden": "true" }, common.noFigure),
      h(
        "div",
        { class: "finding-text" },
        words ? h("p", { class: options.figure !== undefined ? "finding-unit" : "finding-status finding-unit" }, words) : null,
        options.note ? h("p", { class: "finding-unit" }, options.note) : null,
      ),
      h("span", { class: "tile-action card-open" }, h("span", {}, overview.openFinding), icon("chevron-right", 16)),
    ),
    options.index,
  );
}
