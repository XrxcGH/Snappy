/**
 * Layout rules of the Start page that a fake DOM cannot measure are pinned here from the style sheet: the friend count
 * box is wide enough for its placeholder, and the Start page's rules sit only in its own marked block at the end.
 * (The real widths are measured in a browser by the layout audit.)
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "styles.css"), "utf8");
const block = /\/\* track T2 \*\/([\s\S]*?)\/\* end track T2 \*\//.exec(css)?.[1] ?? "";

const remOf = (value: string): number => Number(/([\d.]+)rem/.exec(value)?.[1] ?? Number.NaN);
const rule = (selector: string): string => new RegExp(`${selector.replace(/[.#]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(block)?.[1] ?? "";

describe("the Start page's block of the style sheet", () => {
  it("exists once, opened and closed", () => {
    expect(css.match(/\/\* track T2 \*\//g)).toHaveLength(1);
    expect(css.match(/\/\* end track T2 \*\//g)).toHaveLength(1);
  });

  it("makes the friend count box wide enough for its placeholder", () => {
    const body = rule("#friend-count.input-narrow");
    expect(body).not.toBe("");
    // 9rem (the shared narrow width) cut "For example, 150" to "For example, 15"; 11rem and more holds it.
    expect(remOf(/max-width:\s*([^;]+);/.exec(body)?.[1] ?? "")).toBeGreaterThanOrEqual(11);
  });

  it("makes the folder row's line as tall as its button, so the gap above the row stays on the spacing scale", () => {
    // Centered in a taller row, a shorter line starts lower than the row: the layout audit then measures an off-scale gap (27.5 px) above it.
    const body = rule(".folder-row > p");
    expect(body).toMatch(/min-height:\s*var\(--target-min\)/);
    expect(body).toMatch(/align-items:\s*center/);
    expect(body).toMatch(/margin:\s*0/);
  });

  it("lays the import status out full width above the steps, and styles only classes the Start page builds", () => {
    expect(rule(".import-status")).toMatch(/min-width:\s*0/);
    for (const selector of [".dropzone-busy", ".folder-row", ".sample-row", ".latest-line", ".drop-overlay"]) expect(block, selector).toContain(selector);
  });
});
