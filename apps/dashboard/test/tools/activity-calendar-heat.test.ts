/**
 * The activity calendar's day grid: a day with activity is easy to tell from the card in both themes (3:1, the minimum for a
 * graphic), each step is a stronger color than the one before, and the sentence under the grid says "stronger", which is true
 * of the light theme (darker) and the dark one (lighter).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { copy } from "../../src/tools/activity-calendar/copy.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const dashboard = path.resolve(here, "..", "..");
const css = readFileSync(path.join(dashboard, "src", "tools", "activity-calendar", "styles.css"), "utf8");
const tokens = JSON.parse(readFileSync(path.resolve(dashboard, "..", "..", "brand", "tokens", "tokens.json"), "utf8")) as Record<"light" | "dark", Record<string, string>>;

type Rgb = [number, number, number];
const rgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
const lin = (c: number): number => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
const lum = ([r, g, b]: Rgb): number => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a: Rgb, b: Rgb): number => {
  const [hi = 0, lo = 0] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** The background of `.cal-cell.lvl-N` in the tool's stylesheet, resolved for one theme: a token, or a color-mix of two tokens in srgb. */
function heat(level: number, theme: "light" | "dark"): Rgb {
  const rule = new RegExp(`\\.cal-cell\\.lvl-${level} \\{ background: ([^;]+);`).exec(css);
  expect(rule, `lvl-${level}`).not.toBeNull();
  const value = (rule as RegExpExecArray)[1] as string;
  const token = (name: string): Rgb => {
    const hex = tokens[theme][name];
    expect(hex, `--${name}`).toBeDefined();
    return rgb(hex as string);
  };
  const mix = /^color-mix\(in srgb, var\(--([a-z-]+)\) (\d+)%, var\(--([a-z-]+)\)\)$/.exec(value);
  if (mix) {
    const [a, b, share] = [token(mix[1] as string), token(mix[3] as string), Number(mix[2])];
    return [0, 1, 2].map((i) => Math.round(((a[i] as number) * share + (b[i] as number) * (100 - share)) / 100)) as Rgb;
  }
  const single = /^var\(--([a-z-]+)\)$/.exec(value);
  expect(single, `lvl-${level} background ${value}`).not.toBeNull();
  return token((single as RegExpExecArray)[1] as string);
}

describe("the heat steps", () => {
  for (const theme of ["light", "dark"] as const) {
    it(`start at 3:1 or more against the card and grow stronger with each step, in the ${theme} theme`, () => {
      const card = rgb(tokens[theme].surface as string);
      const ratios = [1, 2, 3, 4].map((level) => ratio(heat(level, theme), card));
      expect(ratios[0], "first step").toBeGreaterThanOrEqual(3);
      for (let i = 1; i < ratios.length; i++) expect(ratios[i] as number, `step ${i + 1}`).toBeGreaterThan(ratios[i - 1] as number);
    });
  }

  it("are described as a stronger color, not a darker one", () => {
    expect(copy.gridNote).toBe("Each square is one day. A stronger color means more.");
    expect(copy.gridNote).not.toMatch(/darker/i);
  });
});
