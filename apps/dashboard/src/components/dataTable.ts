import { common } from "../copy.ts";
import { h } from "../dom.ts";
import type { Child } from "../dom.ts";
import { icon } from "./icon.ts";
import type { IconName } from "./icon.ts";

export type PillKind = "yes" | "optional" | "no";

const PILL_ICON: Record<PillKind, IconName> = { yes: "check", optional: "minus", no: "close" };

/**
 * A cell that says what it holds in its own words, for the stacked cards on a phone ("Added Nov 25, 2024", "46 total"). `value` is
 * what the column header already names; `before` and `after` are the words around it, written with their own space ("Added ", " total").
 * On a wide page the table has real column headers, so the stylesheet hides those words and only the value shows.
 */
export interface CellParts {
  readonly value: string;
  readonly before?: string;
  readonly after?: string;
}

/**
 * A cell that shows the bare value and keeps the full phrase for assistive technology: `text` is "27", `label` is "Sent: 27".
 * A wide page, whose column header already says "Sent", draws the value alone and a screen reader hears the phrase. A phone,
 * where rows stack into cards with no column names, draws the phrase instead.
 */
export interface CellLabeled {
  readonly text: string;
  readonly label: string;
}

/** What a table cell may be: plain text, a value with the words around it, or a bare value with a full phrase for assistive technology. */
export type TableCell = string | CellParts | CellLabeled;

const isLabeled = (cell: CellParts | CellLabeled): cell is CellLabeled => "label" in cell;

/**
 * Marks which part of a cell's full text is its value, so the copy keeps one complete string ("Added Nov 25, 2024") and the
 * table can hide the rest where a column header says it. Text that does not hold the value stays one plain string.
 */
export function cellAround(full: string, value: string): TableCell {
  const at = value === "" ? -1 : full.indexOf(value);
  if (at < 0) return full;
  const before = full.slice(0, at);
  const after = full.slice(at + value.length);
  return { value, ...(before === "" ? {} : { before }), ...(after === "" ? {} : { after }) };
}

/** The full text of a cell, as a phone shows it. */
export function cellText(cell: TableCell): string {
  if (typeof cell === "string") return cell;
  return isLabeled(cell) ? cell.label : `${cell.before ?? ""}${cell.value}${cell.after ?? ""}`;
}

/**
 * The nodes of a cell: the value, with its surrounding words in spans that the stylesheet hides once the table has column headers.
 * A labeled cell is the bare value (hidden from assistive technology, which hears the phrase) and the phrase (out of sight on a
 * wide page, shown on a phone in place of the value).
 */
export function cellNodes(cell: TableCell): Child[] {
  if (typeof cell === "string") return [cell];
  if (isLabeled(cell)) return [h("span", { class: "cell-short", "aria-hidden": "true" }, cell.text), h("span", { class: "cell-long sr-only" }, cell.label)];
  return [cell.before ? h("span", { class: "cell-extra" }, cell.before) : null, cell.value, cell.after ? h("span", { class: "cell-extra" }, cell.after) : null];
}

/**
 * Makes a table frame a named, focusable region while it scrolls sideways, so a keyboard user can scroll it with the arrow keys and a
 * screen reader hears what it is. A frame whose table fits (every table on a phone, where rows stack) stays a plain block with no extra
 * tab stop. Where ResizeObserver does not exist the frame is left as it is.
 */
export function scrollRegion(wrap: HTMLElement, caption: string, labelFor: (caption: string) => string = common.scrollTableFor): HTMLElement {
  if (typeof ResizeObserver === "undefined") return wrap;
  const sync = (): void => {
    if (wrap.scrollWidth > wrap.clientWidth + 1) {
      wrap.setAttribute("tabindex", "0");
      wrap.setAttribute("role", "region");
      wrap.setAttribute("aria-label", labelFor(caption));
    } else {
      wrap.removeAttribute("tabindex");
      wrap.removeAttribute("role");
      wrap.removeAttribute("aria-label");
    }
  };
  const observer = new ResizeObserver(sync);
  observer.observe(wrap);
  const table = wrap.firstElementChild;
  if (table) observer.observe(table);
  return wrap;
}

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
 * table's structure for screen readers once the elements are no longer displayed as a table. A table that
 * is wider than its column scrolls inside its frame, which then becomes a labeled region (see scrollRegion).
 */
export function dataTable(caption: string, headers: readonly string[], rows: readonly (readonly TableCell[])[], options: DataTableOptions = {}): HTMLElement {
  const pills = options.pills;
  const cellContent = (cell: TableCell, cellIndex: number, rowIndex: number): Child[] => {
    const kind = pills && pills.column === cellIndex + 1 ? pills.kinds[rowIndex] : undefined;
    return kind ? [h("span", { class: `pill pill-${kind}` }, icon(PILL_ICON[kind], 16), h("span", {}, cellText(cell)))] : cellNodes(cell);
  };
  return scrollRegion(
    h(
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
              h("th", { scope: "row", role: "rowheader" }, cellText(name)),
              ...cells.map((cell, i) =>
                h("td", { role: "cell", class: pills && pills.column === i + 1 ? "cell-pill" : undefined }, ...cellContent(cell, i, rowIndex)),
              ),
            ),
          ),
        ),
      ),
    ),
    caption,
  );
}
