/**
 * The layout and accessibility rules of the stylesheet that a browser would show but a unit test cannot see: where the
 * wide layout starts, how many tiles a row of the Tools hub holds, and the rules that keep a long name, a color setting
 * or the keyboard from breaking a page. The browser layout audit measures the real page; these tests read the stylesheet,
 * so a change that undoes a rule fails fast without a browser.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { groupedTools } from "../src/tools/registry.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const raw = readFileSync(path.join(root, "apps", "dashboard", "src", "styles.css"), "utf8").replace(/\r\n/g, "\n");
const css = raw.replace(/\/\*[\s\S]*?\*\//g, "");

interface Rule {
  /** One selector of the rule's list, whitespace collapsed. */
  selector: string;
  body: string;
  /** The media conditions the rule sits in, outermost first. */
  media: string[];
}

/** Every style rule of a stylesheet text (comments already removed), with the media queries around it. */
function parseRules(text: string): Rule[] {
  const rules: Rule[] = [];
  const walk = (src: string, media: string[]): void => {
    let i = 0;
    while (i < src.length) {
      const open = src.indexOf("{", i);
      if (open < 0) break;
      const prelude = src.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      while (j < src.length && depth > 0) {
        if (src[j] === "{") depth++;
        else if (src[j] === "}") depth--;
        j++;
      }
      const inner = src.slice(open + 1, j - 1);
      if (prelude.startsWith("@media")) walk(inner, [...media, prelude.slice(6).trim()]);
      else if (!prelude.startsWith("@")) {
        for (const selector of prelude.split(/,(?![^(]*\))/)) rules.push({ selector: selector.trim().replace(/\s+/g, " "), body: inner, media });
      }
      i = j;
    }
  };
  walk(text, []);
  return rules;
}

const rules = parseRules(css);
const rulesFor = (selector: string): Rule[] => rules.filter((r) => r.selector === selector);
const declared = (selector: string): string => rulesFor(selector).map((r) => r.body).join(" ");

describe("the wide layout starts at the desktop app's default window", () => {
  it("names 72rem (1152 px) as the wide breakpoint, so the 1180 px window gets the wide layout", () => {
    expect(raw).toMatch(/--bp-wide:\s*72rem/);
    const content = rules.find((r) => r.selector === ":root" && /--content-w:\s*var\(--col-wide\)/.test(r.body));
    expect(content?.media).toEqual(["(min-width: 72rem)"]);
    // The desktop window is 1180 px wide: 73.75rem is past the breakpoint.
    expect(1180 / 16).toBeGreaterThan(72);
  });
});

/** The spans a Tools hub group of `count` tiles gets in the wide layout, tile by tile, from the stylesheet's own rules. */
function wideSpans(count: number): number[] {
  const klass = `tiles-n-${Math.min(count, 7)}`;
  const spans: number[] = [];
  for (let index = 1; index <= count; index++) {
    let span = 0;
    for (const rule of rules) {
      const m = /^\.tiles-tools(?:\.(tiles-n-\d))? \.tile:nth-child\((n|n\+(\d+)|-n\+(\d+))\)$/.exec(rule.selector);
      if (m === null) continue;
      if (!rule.media.some((q) => /min-width:\s*72rem/.test(q))) continue;
      if (m[1] !== undefined && m[1] !== klass) continue;
      const mine = m[2] === "n" || (m[3] !== undefined && index >= Number(m[3])) || (m[4] !== undefined && index <= Number(m[4]));
      const value = /grid-column:\s*span (\d+)/.exec(rule.body);
      if (mine && value !== null) span = Number(value[1]);
    }
    spans.push(span);
  }
  return spans;
}

/** Fill rows of twelve columns, the way grid auto-placement does, and return the tile count of each row and its filled columns. */
function rowsOf(spans: number[]): { tiles: number; columns: number }[] {
  const rows: { tiles: number; columns: number }[] = [];
  let current = { tiles: 0, columns: 0 };
  for (const span of spans) {
    if (current.columns + span > 12) {
      rows.push(current);
      current = { tiles: 0, columns: 0 };
    }
    current.tiles++;
    current.columns += span;
  }
  if (current.tiles > 0) rows.push(current);
  return rows;
}

describe("the Tools hub rows", () => {
  const groups = groupedTools().map((g) => ({ id: g.group.id, count: g.tools.length }));

  it("is a grid of twelve columns from the wide layout, at every wide width", () => {
    const grid = rulesFor(".tiles-tools").filter((r) => /grid-template-columns:\s*repeat\(12,/.test(r.body));
    expect(grid).toHaveLength(1);
    expect(grid[0]?.media).toEqual(["(min-width: 72rem)"]);
    // Nothing narrows it again at the next step up, so 1280 and 1920 have the same rows as 1152.
    expect(rules.filter((r) => r.selector.startsWith(".tiles-tools") && r.media.some((q) => /min-width:\s*100rem/.test(q)))).toEqual([]);
  });

  it("fills every row of every group and leaves no group ending on a lone tile", () => {
    expect(groups.length).toBeGreaterThan(0);
    for (const { id, count } of groups) {
      const spans = wideSpans(count);
      expect(spans.every((s) => s > 0), `${id}: every tile has a span`).toBe(true);
      const rows = rowsOf(spans);
      for (const row of rows) expect(row.columns, `${id} (${count} tiles): a row of ${row.tiles} fills the 12 columns`).toBe(12);
      if (count > 1) expect(rows[rows.length - 1]?.tiles, `${id} (${count} tiles): the last row`).toBeGreaterThan(1);
    }
  });

  it("lays out four as four across, five as three and two, seven as four and three, two as two", () => {
    expect(rowsOf(wideSpans(4)).map((r) => r.tiles)).toEqual([4]);
    expect(rowsOf(wideSpans(5)).map((r) => r.tiles)).toEqual([3, 2]);
    expect(rowsOf(wideSpans(7)).map((r) => r.tiles)).toEqual([4, 3]);
    expect(rowsOf(wideSpans(2)).map((r) => r.tiles)).toEqual([2]);
    expect(rowsOf(wideSpans(3)).map((r) => r.tiles)).toEqual([3]);
    expect(rowsOf(wideSpans(1)).map((r) => r.tiles)).toEqual([1]);
  });

  it("uses one column count for every group below the wide layout", () => {
    // Between 30rem and the wide layout every tile is two across; no count picks its own spans.
    const narrow = rules.filter((r) => /^\.tiles-tools/.test(r.selector) && r.media.every((q) => !/min-width:\s*(?:72|80|100)rem/.test(q)));
    expect(narrow.filter((r) => /tiles-n-[2-9]/.test(r.selector))).toEqual([]);
    expect(narrow.filter((r) => /min-width:\s*40rem/.test(r.media.join(" ")))).toEqual([]);
    expect(declared(".tiles-tools .tile")).toMatch(/grid-column:\s*span 3/);
  });
});

describe("the Overview findings below the wide layout", () => {
  it("are three tiles and then two of the same width, centered under them", () => {
    const fourth = rulesFor(".tiles-findings .tile:nth-child(4):nth-last-child(2)");
    const fifth = rulesFor(".tiles-findings .tile:nth-child(5):last-child");
    expect(fourth.map((r) => r.body.trim())).toEqual(["grid-column: 2 / span 2;"]);
    expect(fifth.map((r) => r.body.trim())).toEqual(["grid-column: 4 / span 2;"]);
    // Both sit inside the range that ends where the wide layout (five across) begins.
    for (const rule of [...fourth, ...fifth]) expect(rule.media).toEqual(["(min-width: 40rem) and (max-width: 71.99rem)"]);
    // Every tile of the row is two of the six columns, like the three above them.
    expect(rules.some((r) => r.selector === ".tiles-stats .tile" && /grid-column:\s*span 2/.test(r.body))).toBe(true);
    expect(rules.filter((r) => r.selector === ".tiles-findings .tile:nth-child(n+4)" && /span 3/.test(r.body))).toEqual([]);
  });
});

describe("forced colors (Windows high contrast)", () => {
  const forced = (selector: string): string => rules.filter((r) => r.selector === selector && r.media.length === 1 && /forced-colors:\s*active/.test(r.media[0] ?? "")).map((r) => r.body).join(" ");

  it("draws the track of a progress bar or meter with a border and no shadow, and fills it with the system highlight", () => {
    for (const selector of [".progress", ".meter"]) {
      expect(forced(selector), selector).toMatch(/border:\s*1px solid CanvasText/);
      expect(forced(selector), selector).toMatch(/box-shadow:\s*none/);
    }
    for (const selector of [".progress-fill", ".meter-fill", ".progress-slide"]) {
      expect(forced(selector), selector).toMatch(/background:\s*Highlight/);
      expect(forced(selector), selector).toMatch(/forced-color-adjust:\s*none/);
    }
  });

  it("shows the pressed segment of a choice in the highlight colors", () => {
    expect(forced('.segmented .btn[aria-pressed="true"]')).toMatch(/background:\s*Highlight[^}]*color:\s*HighlightText/);
  });

  it("gives every activity square a border, and the two busiest levels the highlight (beating the tool's own rules)", () => {
    expect(forced(".cal-cell")).toMatch(/border:\s*1px solid CanvasText/);
    const busy = forced(".cal-wrap :is(.cal-board, .cal-legend) .cal-cell:is(.lvl-3, .lvl-4)");
    expect(busy).toMatch(/background:\s*Highlight/);
    expect(busy).toMatch(/forced-color-adjust:\s*none/);
  });
});
