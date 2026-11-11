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

describe("the Overview findings below 80rem", () => {
  it("are three tiles and then two of the same width, centered under them", () => {
    const fourth = rulesFor(".tiles-findings .tile:nth-child(4):nth-last-child(2)");
    const fifth = rulesFor(".tiles-findings .tile:nth-child(5):last-child");
    expect(fourth.map((r) => r.body.trim())).toEqual(["grid-column: 2 / span 2;"]);
    expect(fifth.map((r) => r.body.trim())).toEqual(["grid-column: 4 / span 2;"]);
    // Both sit inside the range that ends where the row of five begins (80rem), so the desktop window (1152 to 1279 px) keeps three and two.
    for (const rule of [...fourth, ...fifth]) expect(rule.media).toEqual(["(min-width: 40rem) and (max-width: 79.99rem)"]);
    // Every tile of the row is two of the six columns, like the three above them.
    expect(rules.some((r) => r.selector === ".tiles-stats .tile" && /grid-column:\s*span 2/.test(r.body))).toBe(true);
    expect(rules.filter((r) => r.selector === ".tiles-findings .tile:nth-child(n+4)" && /span 3/.test(r.body))).toEqual([]);
  });

  it("puts the five across only from 80rem, where a tile is wide enough for its title on one line", () => {
    const across = rules.filter((r) => r.selector === ".tiles-findings" && /repeat\(5,/.test(r.body));
    expect(across).toHaveLength(1);
    expect(across[0]?.media).toEqual(["(min-width: 80rem)"]);
    const spans = rules.filter((r) => r.selector.startsWith(".tiles-findings .tile") && /grid-column:\s*span 1/.test(r.body));
    expect(spans.length).toBeGreaterThan(0);
    for (const rule of spans) expect(rule.media).toEqual(["(min-width: 80rem)"]);
  });
});

describe("the month and day bar lists", () => {
  it("keep the text measure on a wide screen, so a label is never 900 px from its value", () => {
    const measure = rules.filter((r) => r.selector === ".view :is(p, .plain-list, .point-list, .steps, .tool-notes, .mark-list, .mbars, .hbars)");
    expect(measure).toHaveLength(1);
    expect(measure[0]?.body).toMatch(/max-width:\s*var\(--col\)/);
    expect(measure[0]?.media.join(" ")).toMatch(/min-width:\s*72rem/);
  });
});

describe("a very long username", () => {
  it("breaks anywhere in a username, and a username in a table's name column or in a chip is at most 22 characters wide", () => {
    expect(declared(".username")).toMatch(/overflow-wrap:\s*anywhere/);
    const cell = rules.filter((r) => r.selector === ".view .table tbody th code.username");
    expect(cell).toHaveLength(1);
    // The name column never wraps (dates and short names), so the username inside it must opt in to wrapping.
    expect(cell[0]?.body).toMatch(/max-width:\s*22ch/);
    expect(cell[0]?.body).toMatch(/white-space:\s*normal/);
    expect(cell[0]?.body).toMatch(/display:\s*inline-block/);
    // break-word, not anywhere: "anywhere" lowers the column's minimum width, and the table would squeeze an ordinary name onto two lines.
    expect(cell[0]?.body).toMatch(/overflow-wrap:\s*break-word/);
    expect(cell[0]?.media.join(" ")).toMatch(/min-width:\s*40\.01rem/);
    expect(declared(".chip .username")).toMatch(/max-width:\s*22ch/);
    expect(declared(".chip .username")).toMatch(/display:\s*inline-block/);
  });

  it("does not let table cells break ordinary words, which would squeeze a column instead of scrolling the table", () => {
    for (const selector of [".table th", ".table td", ".table th, .table td"]) expect(declared(selector)).not.toMatch(/overflow-wrap:\s*anywhere/);
  });
});

describe("keyboard and focus rules", () => {
  it("lets the sticky menu scroll inside its own column in a short window", () => {
    const nav = rules.filter((r) => r.selector === ".nav" && /overflow-y:\s*auto/.test(r.body));
    expect(nav).toHaveLength(1);
    expect(nav[0]?.media).toEqual(["(min-width: 64rem)"]);
    expect(nav[0]?.body).toMatch(/max-height:\s*100vh/);
    expect(nav[0]?.body).toMatch(/overscroll-behavior:\s*contain/);
  });

  it("keeps a gutter on the left of the sidebar and the logo, so the ring of a menu link is not clipped below the shell's cap", () => {
    const nav = rules.filter((r) => r.selector === ".nav" && /overflow-y:\s*auto/.test(r.body) === false && r.media.join(" ") === "(min-width: 64rem)");
    expect(nav[0]?.body).toMatch(/padding:\s*var\(--space-6\) var\(--space-4\) var\(--space-6\) var\(--gutter\)/);
    const header = rules.filter((r) => r.selector === ".site-header-inner" && r.media.length > 0);
    for (const r of header) expect(r.body).not.toMatch(/padding-inline-start:\s*0/);
  });

  it("draws the focus ring of a disclosure inside its 44 px target, so it does not strike through the text above", () => {
    expect(declared(".disclosure:focus-visible")).toMatch(/outline-offset:\s*-2px/);
    // The target is still made with padding and a negative margin, so the ring must not be drawn outside it.
    expect(declared(".disclosure")).toMatch(/margin-block:\s*calc\(var\(--tap-pad\)\s*\*\s*-1\)/);
  });

  it("shows a 2 px ring on the main area when keyboard focus lands there after the skip link", () => {
    const ring = declared(".main:focus-visible");
    expect(ring).toMatch(/outline:\s*2px solid var\(--focus-ring\)/);
    expect(ring).not.toMatch(/outline:\s*none/);
  });
});

describe("states drawn with tokens", () => {
  it("colors the glyph of the current menu item with its area's text color, which keeps 3:1 on the active fill", () => {
    expect(declared('.nav-link[aria-current="page"].nav-link-cat .icon')).toMatch(/color:\s*var\(--c-fg\)/);
  });

  it("draws a button that cannot run yet in the muted pair, not faded by opacity", () => {
    const disabled = declared('.btn[aria-disabled="true"]');
    expect(disabled).toMatch(/background:\s*var\(--surface-sunken\)/);
    expect(disabled).toMatch(/color:\s*var\(--text-muted\)/);
    expect(disabled).not.toMatch(/opacity/);
    // The hover color of the variant must not win over it.
    expect(declared('.btn[aria-disabled="true"]:hover')).toMatch(/background:\s*var\(--surface-sunken\)/);
  });
});

describe("running text and titles", () => {
  it("keeps a caption to 70 characters, so the sample caption on Start is not 91", () => {
    expect(declared(".caption")).toMatch(/max-width:\s*70ch/);
  });

  it("balances a step title, balances the short list items (so none ends on one word alone), and sets step titles smaller in the three-card row", () => {
    expect(declared(".step-card > .section-title")).toMatch(/text-wrap:\s*balance/);
    expect(declared(".point-list li > span")).toMatch(/text-wrap:\s*balance/);
    expect(declared(".point-list li > span")).not.toMatch(/pretty/);
    const title = rules.filter((r) => r.selector === "div.step-list > .step-card > h2" && /font-size/.test(r.body));
    expect(title).toHaveLength(1);
    expect(title[0]?.body).toMatch(/font-size:\s*var\(--text-20\)/);
    expect(title[0]?.media).toEqual(["(min-width: 72rem)"]);
  });

  it("reads a numbered run of steps row by row (1, 2 then 3, 4), and lets a last odd step span the row", () => {
    const list = rulesFor("ol.step-list").map((r) => r.body).join(" ");
    expect(list).toMatch(/grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
    expect(list).not.toMatch(/grid-auto-flow:\s*column/);
    expect(list).not.toMatch(/grid-template-rows/);
    expect(declared("ol.step-list > .step-card:last-child:nth-child(odd)")).toMatch(/grid-column:\s*1\s*\/\s*-1/);
  });

  it("lists the licenses in one column, so no tile has a label on two lines beside tiles with one", () => {
    expect(declared(".licenses")).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    expect(rules.filter((r) => r.selector === ".licenses" && /repeat\(2/.test(r.body))).toEqual([]);
  });
});

describe("the command block header", () => {
  it("keeps Copy and Run beside the title from 360 px, and turns Copy into its icon alone below that", () => {
    expect(declared(".command-title")).toMatch(/flex:\s*1 1 6rem/);
    // Two lines of a long title are balanced, so the last line is never one word.
    expect(declared(".command-title")).toMatch(/text-wrap:\s*balance/);
    expect(declared(".command-actions")).toMatch(/flex:\s*none/);
    const narrow = rules.filter((r) => r.selector === ".command-actions .btn:first-child" && r.media.length === 1);
    expect(narrow).toHaveLength(1);
    // 22.49rem is just under 360 px.
    expect(narrow[0]?.media).toEqual(["(max-width: 22.49rem)"]);
    expect(narrow[0]?.body).toMatch(/width:\s*var\(--target-min\)/);
    expect(rules.some((r) => r.selector === ".command-actions .btn:first-child > span" && /clip-path:\s*inset\(50%\)/.test(r.body))).toBe(true);
  });
});

describe("the Settings theme control at about 500 percent zoom", () => {
  it("wraps its three buttons instead of holding the page wider than the window", () => {
    expect(declared(".segmented-theme")).toMatch(/flex-wrap:\s*wrap/);
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

describe("form rows line up at the top", () => {
  const read = (...parts: string[]): string => readFileSync(path.join(root, "apps", "dashboard", "src", ...parts), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

  it("keeps a field's label and control at its top, so a neighbor with a help line does not stretch it", () => {
    expect(declared(".field")).toMatch(/align-content:\s*start/);
  });

  it("starts every control of a row at the same top, however many help lines each has", () => {
    expect(declared(".filters")).toMatch(/align-items:\s*start/);
    expect(read("tools", "year-in-review", "styles.css")).toMatch(/\.year-controls\s*\{[^}]*align-items:\s*start/);
  });

  it("gives the storage planner's two fields the standard gap, not the tight one of a single small field", () => {
    expect(read("tools", "storage-planner", "controls.ts")).not.toMatch(/cap-form/);
  });

  it("makes the five facts of a row equal tiles (three, then two centered)", () => {
    expect(declared(".facts-n-5 .fact")).toMatch(/span 4/);
    expect(declared(".facts-n-5 .fact:nth-child(4)")).toMatch(/grid-column:\s*3 \/ span 4/);
    expect(declared(".facts-n-5 .fact:nth-child(5)")).toMatch(/grid-column:\s*7 \/ span 4/);
  });
});

describe("the Tools hub tile status", () => {
  it("keeps a gap above the status, so a two-line description never sits tight on it", () => {
    expect(declared(".tool-status")).toMatch(/margin:\s*var\(--space-2\) 0 0/);
  });

  it("gives the tools of Your export different icons, so the tiles side by side are not twins", () => {
    const tools = groupedTools().find((g) => g.group.id === "your-export")?.tools ?? [];
    expect(tools.length).toBeGreaterThan(1);
    expect(new Set(tools.map((t) => t.icon)).size).toBe(tools.length);
  });
});

describe("the Cleanup lists at three across", () => {
  const xwide = (selector: string): Rule[] => rulesFor(selector).filter((r) => r.media.some((q) => /min-width:\s*100rem/.test(q)));

  it("keeps a lone last card at one column (a span of two in six), never the whole row", () => {
    expect(declared(".candidate-list > :nth-child(n)")).toMatch(/grid-column:\s*span 2/);
    for (const list of [".candidate-list", ".guided-list"]) {
      expect(xwide(`${list} > :last-child:nth-child(3n + 1)`), `${list}: no rule for a lone last card`).toEqual([]);
    }
    const wide = rules.filter((r) => /^\.(?:candidate|guided)-list > /.test(r.selector) && r.media.some((q) => /min-width:\s*100rem/.test(q)));
    expect(wide.filter((r) => /grid-column:\s*1\s*\/\s*-1/.test(r.body))).toEqual([]);
  });

  it("lets the last two of a short row share it", () => {
    expect(xwide(".candidate-list > :last-child:nth-child(3n + 2)")[0]?.body).toMatch(/grid-column:\s*span 3/);
  });
});
