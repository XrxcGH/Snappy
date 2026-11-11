/**
 * Where the update banner sits and how the Updates card is spaced, as far as the source shows it. The built page is measured
 * in headless Chromium by test/e2e-ui/update-ui.check.mjs (the heading does not move when a banner appears, the banner lines
 * up with the content column, the card has one 16 px gap).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const css = readFileSync(path.join(here, "..", "src", "update.css"), "utf8");
const ui = readFileSync(path.join(here, "..", "src", "update-ui.ts"), "utf8");
const rule = (selector: string): string => new RegExp(`(?:^|\\n)${selector.replace(/[.[\]:()*\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";

describe("the update banner takes no room at the top of the page", () => {
  it("floats over the window, out of the flow, instead of sitting above the page heading", () => {
    const slot = rule(".update-slot");
    expect(slot).toMatch(/position:\s*fixed/);
    expect(slot).toMatch(/bottom:/);
    expect(slot).not.toMatch(/margin:[^;]*gap-section/);
  });

  it("keeps room for itself at the end of the page, scrolls focus clear of itself and leaves the toast above it", () => {
    expect(css).toMatch(/body:has\(\.update-slot:not\(:empty\)\)\s*\{\s*padding-bottom:/);
    expect(css).toMatch(/html:has\(\.update-slot:not\(:empty\)\)\s*\{\s*scroll-padding-bottom:/);
    expect(css).toMatch(/\.toast-host\s*\{\s*bottom:/);
  });

  it("is lined up with the content column by measuring it, and its height is published", () => {
    expect(ui).toMatch(/"--update-left"/);
    expect(ui).toMatch(/"--update-width"/);
    expect(ui).toMatch(/"--update-slot-h"/);
    expect(css).toMatch(/left:\s*var\(--update-left/);
    expect(css).toMatch(/width:\s*var\(--update-width/);
  });

  it("uses tokens only, with a z-index below the toast's", () => {
    expect(rule(".update-slot")).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
    expect(Number(/z-index:\s*(\d+)/.exec(rule(".update-slot"))?.[1])).toBeLessThan(30);
  });
});

describe("the update banner's place in the keyboard order", () => {
  it("is put right after the skip link, ahead of the header, menu and page, not inside the main area", () => {
    expect(ui).toMatch(/skip-link/);
    expect(ui).toMatch(/if \(skip\) skip\.after\(slot\);\s*else /);
  });

  it("is described in update.css as right after the skip link", () => {
    expect(css).not.toMatch(/first in the document/);
    expect(css).toMatch(/right after the skip link/);
  });
});

describe("the Updates card spacing", () => {
  it("adds no margin of its own under the Check now row: the card's own 16 px gap is the only space", () => {
    expect(css).not.toMatch(/\.update-card\s+\.actions\s*\{[^}]*margin/);
  });
});
