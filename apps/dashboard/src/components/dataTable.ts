import { h } from "../dom.ts";
import type { Child } from "../dom.ts";
import { icon } from "./icon.ts";
import type { IconName } from "./icon.ts";

export type PillKind = "yes" | "optional" | "no";

const PILL_ICON: Record<PillKind, IconName> = { yes: "check", optional: "minus", no: "close" };

export interface DataTableOptions {
  /**
   * Show one column as pills. `column` is the table column, counted from 0 at the row-name column (so 1 is the
   * first column after the name); `kinds` has one entry per row, in row order. Each pill is
   * an icon plus the cell's own words, so the meaning never rests on color.
   */
  pills?: { column: number; kinds: readonly PillKind[] };
}

/**
 * A table whose first column names each row. At phone width the stylesheet stacks every row into a
 * card (the name, then its cells) and does not repeat the column names, and the ARIA roles keep the
 * table's structure for screen readers once the elements are no longer displayed as a table.
 */
export function dataTable(caption: string, headers: readonly string[], rows: readonly (readonly string[])[], options: DataTableOptions = {}): HTMLElement {
  const pills = options.pills;
  const cellContent = (text: string, cellIndex: number, rowIndex: number): Child => {
    const kind = pills && pills.column === cellIndex + 1 ? pills.kinds[rowIndex] : undefined;
    return kind ? h("span", { class: `pill pill-${kind}` }, icon(PILL_ICON[kind], 16), h("span", {}, text)) : text;
  };
  return h(
    "div",
    { class: "table-wrap" },
    h(
      "table",
      { class: "table", role: "table" },
      h("caption", { class: "table-caption" }, caption),
      h("thead", { role: "rowgroup" }, h("tr", { role: "row" }, ...headers.map((text) => h("th", { scope: "col", role: "columnheader" }, text)))),
      h(
        "tbody",
        { role: "rowgroup" },
        ...rows.map(([name = "", ...cells], rowIndex) =>
          h(
            "tr",
            { role: "row" },
            h("th", { scope: "row", role: "rowheader" }, name),
            ...cells.map((text, i) =>
              h("td", { role: "cell", class: pills && pills.column === i + 1 ? "cell-pill" : undefined }, cellContent(text, i, rowIndex)),
            ),
          ),
        ),
      ),
    ),
  );
}
