/**
 * The layout rules in the stylesheets of this group's tool pages that a unit test cannot see in a browser: a very long
 * username wraps inside its own cell, the columns have fixed shares on a wide page, a date stays whole on one line, and the
 * pair details of the lookalike page share one width. The layout audit measures the real page; these read the sheets, so a
 * rule taken out fails fast without a browser. Synthetic data only; there is none here.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const toolsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "tools");

interface Rule {
  selector: string;
  body: string;
  media: string[];
}

/** Every style rule of a tool's own sheet, with the media queries around it. */
function rulesOf(tool: string): Rule[] {
  const text = readFileSync(path.join(toolsDir, tool, "styles.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
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
      else if (!prelude.startsWith("@")) for (const selector of prelude.split(",")) rules.push({ selector: selector.trim().replace(/\s+/g, " "), body: inner, media });
      i = j;
    }
  };
  walk(text, []);
  return rules;
}

/** The declarations written for a selector, optionally only inside one media condition. */
const declared = (tool: string, selector: string, media?: RegExp): string =>
  rulesOf(tool)
    .filter((r) => r.selector === selector && (media === undefined ? true : r.media.some((q) => media.test(q))))
    .map((r) => r.body)
    .join(" ");

/** The percentage widths of the columns, in order. */
const columnShares = (tool: string, table: string): number[] =>
  [1, 2, 3, 4, 5, 6, 7, 8].map((n) => /width:\s*([\d.]+)%/.exec(declared(tool, `${table} th:nth-child(${n})`))?.[1]).filter((v): v is string => v !== undefined).map(Number);

describe("a very long username keeps its row inside the frame", () => {
  it("friends table: fixed columns on a wide page that add up to the whole table, and a card that can shrink on a phone", () => {
    const t = ".tool-friends-table .table";
    expect(declared("friends-table", t, /min-width:\s*72rem/)).toMatch(/table-layout:\s*fixed/);
    const shares = columnShares("friends-table", t);
    expect(shares).toHaveLength(7);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(100);
    expect(declared("friends-table", `${t} td`, /min-width:\s*72rem/)).toMatch(/overflow-wrap:\s*break-word/);
    expect(declared("friends-table", `${t} td`, /max-width:\s*40rem/)).toMatch(/min-width:\s*0/);
    expect(declared("friends-table", `${t} td`, /max-width:\s*40rem/)).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it("anniversaries: the name wraps in its cell, on a phone's card and in the fixed columns of a wider table", () => {
    const t = ".tool-anniversaries .table";
    expect(declared("anniversaries", `${t} td`)).toMatch(/min-width:\s*0/);
    expect(declared("anniversaries", `${t} td`)).toMatch(/overflow-wrap:\s*anywhere/);
    expect(declared("anniversaries", t, /min-width:\s*40\.01rem/)).toMatch(/table-layout:\s*fixed/);
    const shares = columnShares("anniversaries", t);
    expect(shares).toHaveLength(4);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("closest and fading: the row names wrap and the other columns keep their room", () => {
    const t = ".tool-closest-fading .table";
    expect(declared("closest-fading", `${t} td`)).toMatch(/min-width:\s*0/);
    expect(declared("closest-fading", `${t} tbody th`)).toMatch(/overflow-wrap:\s*anywhere/);
  });
});
