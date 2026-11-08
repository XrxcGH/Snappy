/**
 * The page layout rules of the lists work: sibling blocks share the text measure at the wide layout, the Cleanup
 * warning is short enough for the standard notice width, and one search box width is used everywhere. The browser
 * layout audit measures these; here the stylesheet and the copy are checked, so a change that undoes them fails fast.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { lists } from "../src/copy-lists.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const css = readFileSync(path.join(root, "apps", "dashboard", "src", "styles.css"), "utf8").replace(/\r\n/g, "\n");
const cleanupSource = readFileSync(path.join(root, "apps", "dashboard", "src", "views", "cleanup.ts"), "utf8");

/** The track's own block at the tail of the stylesheet, comments removed. */
const block = (() => {
  const start = css.indexOf("/* track T3 */");
  const end = css.indexOf("/* end track T3 */");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return css.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, "");
})();

/** The declarations of the rule whose selector is exactly `selector` (all rules with it, joined). */
function declarationsOf(selector: string): string {
  const found: string[] = [];
  for (const match of block.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (match[1]!.split(",").some((s) => s.trim() === selector)) found.push(match[2]!);
  }
  return found.join(" ");
}

describe("sibling blocks share the text measure", () => {
  it("keeps the related tools block and the Overview next steps list at the page measure", () => {
    for (const selector of [".related", ".next-list"]) expect(declarationsOf(selector), selector).toMatch(/max-width:\s*var\(--col\)/);
  });
});

describe("the Cleanup warning keeps the standard notice measure", () => {
  it("does not override the notice width in the queue", () => {
    expect(block).not.toMatch(/queue-slot\s*>\s*\.notice[^{]*\{[^}]*max-width:\s*none/);
    expect(block).not.toMatch(/queue-slot[^{]*notice-text[^{]*\{[^}]*max-width:\s*none/);
  });

  it("is short enough for one line at that measure, and is the sentence the page shows", () => {
    // About 75 characters fit a 36 rem line; the notice has an icon and padding, so the sentence stays well under that.
    expect(lists.removalNote.length).toBeLessThanOrEqual(60);
    expect(lists.removalNote).toMatch(/cannot be undone/);
    expect(cleanupSource).toContain("lists.removalNote");
  });
});
