/**
 * The warning status and the Medium confidence chip share one hue family. It must read as gold, never as
 * amber or orange, in the light and the dark theme, and for the text, the tint and the border alike. Orange is
 * a secondary color for the Memories rescue area (see orange.test.ts), and it has to stay clearly apart from this
 * gold. The layout audit repeats the check on the rendered page and measures the distance.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as copy from "../src/copy.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const tokens = readFileSync(path.resolve(here, "..", "..", "..", "brand", "tokens", "tokens.css"), "utf8");

function hue(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

describe("warning colors", () => {
  const lines = tokens.split("\n").filter((l) => /--warning-(fg|bg|border):/.test(l));

  it("are defined for the light theme and for both dark blocks", () => {
    expect(lines).toHaveLength(3);
  });

  it("sit in the gold band (hue 50 to 70), clear of the secondary orange (8 to 48) and of Snapchat's bright yellow", () => {
    for (const line of lines) {
      const colors = [...line.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0]);
      expect(colors).toHaveLength(3);
      for (const color of colors) {
        const h = hue(color);
        expect(h, `${color} in ${line.trim()}`).toBeGreaterThanOrEqual(50);
        expect(h, `${color} in ${line.trim()}`).toBeLessThanOrEqual(70);
      }
    }
  });

  it("are the colors of the Medium confidence chip too", () => {
    expect(tokens).toMatch(/--conf-medium-fg: var\(--warning-fg\); --conf-medium-bg: var\(--warning-bg\); --conf-medium-border: var\(--warning-border\);/);
  });
});

describe("what the copy says about saving", () => {
  const all = JSON.stringify([copy.start, copy.settings, copy.privacy, copy.vaultMessages]);

  it("never claims that nothing is saved, because the theme choice is remembered in this browser", () => {
    expect(all).not.toMatch(/nothing is saved/i);
    expect(all).not.toMatch(/as one word/i);
  });

  it("says the same exact thing about the theme choice on Settings and on Privacy", () => {
    expect(copy.settings.themeNote).toBe(copy.themeNote);
    expect(copy.privacy.themeNote).toBe(copy.themeNote);
    expect(copy.themeNote).toMatch(/remembered in this browser/);
    expect(copy.themeNote).toMatch(/apart from your history/);
  });

  it("says that results are not saved, in the same words, on Start and in Settings", () => {
    expect(copy.start.sessionOnlyTitle).toBe("Results not saved");
    expect(copy.settings.storageSession).toMatch(/results are not saved/i);
    expect(copy.privacy.sealBody[0]).toMatch(/memory only/);
  });
});
