import { h } from "../dom.ts";

/**
 * A table whose first column names each row. At phone width the stylesheet stacks every row, so
 * each cell carries its column's name in data-label (shown before the value), and the ARIA roles
 * keep the table's structure for screen readers once the elements are no longer displayed as a table.
 */
export function dataTable(caption: string, headers: readonly string[], rows: readonly (readonly string[])[]): HTMLElement {
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
        ...rows.map(([name = "", ...cells]) =>
          h(
            "tr",
            { role: "row" },
            h("th", { scope: "row", role: "rowheader" }, name),
            ...cells.map((text, i) => h("td", { role: "cell", "data-label": headers[i + 1] ?? "" }, text)),
          ),
        ),
      ),
    ),
  );
}
