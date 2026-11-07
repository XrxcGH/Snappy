/**
 * Text and CSV export of the cleanup list. Usernames and evidence sentences end up in
 * spreadsheets, where a cell that starts with = + - @ is run as a formula, so every cell is
 * neutralized first (OWASP CSV injection guidance). Characters that reorder or hide text (right-to-left
 * overrides, zero-width spaces) become "?", exactly as they do on screen, so a spreadsheet shows the
 * same name the page did and two lookalike names stay distinguishable.
 */
import { neutralizeCell } from "@snappy-export/core";

/** Make a value safe as a spreadsheet cell: no control or invisible characters, no leading formula character. The one rule lives in core. */
export { neutralizeCell };

/** One quoted CSV field. Every field is quoted, so commas, quotes and apostrophes never need guessing. */
export function csvCell(value: string): string {
  return `"${neutralizeCell(value).replace(/"/g, '""')}"`;
}

/** Excel needs the byte order mark to read UTF-8; CRLF is what RFC 4180 specifies. */
export function toCsv(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const lines = [header, ...rows].map((row) => row.map(csvCell).join(","));
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

/** One name per line, for pasting into notes. Same neutralising as the CSV. */
export function linesText(values: readonly string[]): string {
  return values.map(neutralizeCell).join("\n") + (values.length > 0 ? "\n" : "");
}
