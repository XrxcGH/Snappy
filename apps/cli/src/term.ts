/**
 * Terminal styling and layout. Color is brand-driven and strictly optional: it is off for
 * NO_COLOR, --no-color, TERM=dumb and non-TTY output, and nothing is ever conveyed by color alone
 * (confidence is three bars plus a word, issues carry a text label).
 */
import { stripVTControlCharacters } from "node:util";
import type { Confidence } from "@snappy-export/core";
import { wrapText } from "./render.ts";

/**
 * The accent for dark grounds, as RGB, for terminals that advertise truecolor. It must equal
 * --brand-violet-on-dark in brand/tokens/tokens.css; a test reads the token file and compares.
 */
export const VIOLET_RGB = [155, 134, 255] as const;
/** ANSI 256-color index of the nearest violet, for every other color terminal. */
const VIOLET_256 = 99;
/**
 * The secondary color, orange, as RGB for truecolor terminals. It must equal --orange-fg in the dark
 * theme of brand/tokens/tokens.css; a test reads the token file and compares. Violet stays the
 * primary color: orange marks only the Memories rescue, and is never a status.
 */
export const ORANGE_RGB = [255, 154, 99] as const;
/** ANSI 256-color index of an orange, for every other color terminal (the 208 step of the color cube). */
const ORANGE_256 = 208;

export interface TermOptions {
  env: Readonly<Record<string, string | undefined>>;
  isTTY: boolean;
  columns: number;
  /** True when the user passed --no-color. */
  noColorFlag?: boolean;
}

export type Cell = string | { text: string; paint?: (s: string) => string };

export interface Column {
  header: string;
  align?: "left" | "right";
  /** One column per table may absorb the remaining width; its cells are shortened to fit. */
  flex?: boolean;
  /** With `flex`: continue long cells on the next lines instead of shortening them. */
  wrap?: boolean;
}

export interface Term {
  readonly color: boolean;
  readonly ascii: boolean;
  readonly columns: number;
  violet(s: string): string;
  /** The secondary highlight: the Memories rescue. Never a status, never the main color. */
  orange(s: string): string;
  bold(s: string): string;
  dim(s: string): string;
  ok(s: string): string;
  warn(s: string): string;
  danger(s: string): string;
  info(s: string): string;
  slate(s: string): string;
  /** Three bars plus the word: ▰▰▰ High, ▰▰▱ Medium, ▰▱▱ Low. */
  confidence(level: Confidence): Cell;
  /** A meter drawn from bars; `fraction` is clamped to 0..1. */
  meter(fraction: number, width: number): string;
  rule(width: number): string;
  /** Lines of a table, two-space gaps, no outer indent (callers indent). */
  table(columns: Column[], rows: Cell[][]): string[];
  banner(): string[];
}

/** NO_COLOR (any non-empty value) and --no-color always win; otherwise color needs a capable TTY. */
export function useColor(opts: TermOptions): boolean {
  if (opts.noColorFlag) return false;
  const noColor = opts.env.NO_COLOR;
  if (noColor !== undefined && noColor !== "") return false;
  const force = opts.env.FORCE_COLOR;
  if (force !== undefined && force !== "" && force !== "0") return true;
  return opts.isTTY && opts.env.TERM !== "dumb";
}

function supportsTruecolor(env: TermOptions["env"]): boolean {
  const v = (env.COLORTERM ?? "").toLowerCase();
  return v === "truecolor" || v === "24bit";
}

const textWidth = (s: string): number => Array.from(stripVTControlCharacters(s)).length;

/** Control characters (ESC, BEL, DEL, C1) and characters that reorder or hide text. */
const UNPRINTABLE = /[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g;

/**
 * Text that came from an export, made safe to print. Usernames are chosen by other people, so an
 * escape sequence in one could retitle the terminal, clear the screen or hide text. Each such
 * character shows as "?", the same as in the dashboard.
 */
export function printable(text: string): string {
  return text.replace(UNPRINTABLE, "?");
}

function shorten(text: string, width: number, ascii: boolean): string {
  const chars = Array.from(text);
  if (chars.length <= width) return text;
  const mark = ascii ? "..." : "…";
  return chars.slice(0, Math.max(0, width - mark.length)).join("") + mark;
}

export function createTerm(opts: TermOptions): Term {
  const color = useColor(opts);
  // SNAPPY_ASCII=1 swaps the block glyphs for plain characters (legacy Windows consoles).
  const ascii = opts.env.SNAPPY_ASCII === "1";
  const wrap = (code: string) => (s: string) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
  const violetCode = supportsTruecolor(opts.env) ? `38;2;${VIOLET_RGB.join(";")}` : `38;5;${VIOLET_256}`;
  const orangeCode = supportsTruecolor(opts.env) ? `38;2;${ORANGE_RGB.join(";")}` : `38;5;${ORANGE_256}`;

  const ok = wrap("32");
  const warn = wrap("33");
  const slate = wrap("90");
  const filled = ascii ? "#" : "▰";
  const empty = ascii ? "-" : "▱";

  const confidenceStyle: Record<Confidence, { bars: number; word: string; paint: (s: string) => string }> = {
    high: { bars: 3, word: "High", paint: ok },
    medium: { bars: 2, word: "Medium", paint: warn },
    low: { bars: 1, word: "Low", paint: slate },
  };

  const term: Term = {
    color,
    ascii,
    columns: opts.columns,
    violet: wrap(violetCode),
    orange: wrap(orangeCode),
    bold: wrap("1"),
    dim: wrap("2"),
    ok,
    warn,
    danger: wrap("31"),
    info: wrap("34"),
    slate,
    confidence(level) {
      const s = confidenceStyle[level];
      return { text: `${filled.repeat(s.bars)}${empty.repeat(3 - s.bars)} ${s.word}`, paint: s.paint };
    },
    meter(fraction, width) {
      const f = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
      const n = Math.round(f * width);
      return filled.repeat(n) + empty.repeat(width - n);
    },
    rule(width) {
      return (ascii ? "-" : "─").repeat(Math.max(0, width));
    },
    table(columns, rows) {
      const gap = 2;
      const plain = (c: Cell): string => printable(typeof c === "string" ? c : c.text);
      const natural = columns.map((col, i) => Math.max(textWidth(col.header), ...rows.map((r) => textWidth(plain(r[i] ?? "")))));
      const fixed = columns.reduce((sum, col, i) => (col.flex ? sum : sum + (natural[i] ?? 0)), 0);
      const room = opts.columns - fixed - gap * (columns.length - 1) - 2; // 2 = the caller's indent
      const widths = columns.map((col, i) => (col.flex ? Math.max(16, Math.min(natural[i] ?? 0, room)) : (natural[i] ?? 0)));

      const line = (cells: Cell[], header: boolean, row = 0): string =>
        columns
          .map((col, i) => {
            const cell = cells[i] ?? "";
            const width = widths[i] ?? 0;
            // A wrapping cell continues over several lines; every other column is blank after the first.
            const text = col.wrap && !header ? (wrapText(plain(cell), width)[row] ?? "") : row === 0 ? plain(cell) : "";
            const shown = shorten(text, width, ascii);
            const styled = header ? term.bold(shown) : typeof cell === "string" || !cell.paint ? shown : cell.paint(shown);
            const gapText = " ".repeat(width - textWidth(shown));
            return col.align === "right" ? gapText + styled : styled + gapText;
          })
          .join(" ".repeat(gap))
          .trimEnd();

      const rowLines = (cells: Cell[]): string[] => {
        const wrapped = columns.reduce((most, col, i) => (col.wrap ? Math.max(most, wrapText(plain(cells[i] ?? ""), widths[i] ?? 0).length) : most), 1);
        return Array.from({ length: wrapped }, (_, row) => line(cells, false, row));
      };

      const total = widths.reduce((a, b) => a + b, 0) + gap * (columns.length - 1);
      return [line(columns.map((c) => c.header), true), term.rule(total), ...rows.flatMap(rowLines)];
    },
    banner() {
      // The mark's five bars (lengths 44, 20, 40, 20, 44 of 64 units) at one column per 4 units.
      // Half blocks at each end echo the pill ends; the spine (third bar) is the one violet element.
      const bar = (offset: number, len: number): string =>
        " ".repeat(offset) + (ascii ? "#".repeat(len) : `▐${"█".repeat(len - 2)}▌`);
      const gutter = 18;
      const side = (row: string, text: string) => `${row}${" ".repeat(Math.max(2, gutter - textWidth(row)))}${text}`;
      return [
        bar(3, 11),
        bar(2, 5),
        side(term.violet(bar(3, 10)), term.bold("Snappy")),
        side(bar(9, 5), "Tidy your friend list and rescue your Memories."),
        bar(2, 11),
      ];
    },
  };
  return term;
}
