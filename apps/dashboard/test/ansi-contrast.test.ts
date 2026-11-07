/**
 * Every color class the terminal output can carry must be readable on the output's own ground, the
 * sunken surface, in both themes (WCAG AA, 4.5 to 1 for text). The classes come from the stylesheet and
 * the colors from the design tokens, so a token change that breaks one fails here. A class whose pair
 * fails must use the plain text color instead.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ANSI_CLASSES } from "../src/terminal/ansi.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const tokens = JSON.parse(readFileSync(path.join(root, "brand", "tokens", "tokens.json"), "utf8")) as Record<string, any>;
const css = readFileSync(path.join(root, "apps", "dashboard", "src", "styles.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

const lin = (c: number): number => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
const luminance = (hex: string): number => {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * lin(r as number) + 0.7152 * lin(g as number) + 0.0722 * lin(b as number);
};
const ratio = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi as number) + 0.05) / ((lo as number) + 0.05);
};

type Theme = "light" | "dark";

/** The color a token has in a theme. */
function color(token: string, theme: Theme): string {
  const direct = tokens[theme][token];
  if (typeof direct === "string") return direct;
  const [group] = token.split("-");
  if (group === "orange") return tokens.orange[theme].fg;
  const semantic = tokens.semantic[group as string];
  if (semantic && token.endsWith("-fg")) return semantic[theme].fg;
  throw new Error(`no value for --${token}`);
}

/** The token each class paints its text with, read from the stylesheet. */
function tokenOf(className: string): string | undefined {
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (m[1] ?? "").split(",").map((s) => s.trim());
    if (!selectors.includes(`.${className}`)) continue;
    const found = /(?:^|[;\s])color:\s*var\(--([a-z-]+)\)/.exec(m[2] ?? "")?.[1];
    if (found !== undefined) return found;
  }
  return undefined;
}

describe("terminal output colors", () => {
  const COLOR_CLASSES = ANSI_CLASSES.filter((c) => c !== "ansi-bold");

  it("has a rule for every class the output can carry", () => {
    for (const cls of COLOR_CLASSES) expect(tokenOf(cls), cls).toBeDefined();
  });

  for (const theme of ["light", "dark"] as const) {
    it(`reads at 4.5 to 1 or better on the output ground in the ${theme} theme`, () => {
      const ground = color("surface-sunken", theme);
      const failing = COLOR_CLASSES.flatMap((cls) => {
        const token = tokenOf(cls) as string;
        const r = ratio(color(token, theme), ground);
        return r >= 4.5 ? [] : [`${cls} uses --${token}: ${r.toFixed(2)} to 1 on --surface-sunken (${theme}); use --text`];
      });
      expect(failing).toEqual([]);
    });
  }

  it("keeps the plain text readable too", () => {
    for (const theme of ["light", "dark"] as const) expect(ratio(color("text", theme), color("surface-sunken", theme))).toBeGreaterThan(7);
  });

  it("paints violet with the violet text token, orange with the orange text token, and status colors with the status tokens", () => {
    expect(tokenOf("ansi-violet")).toBe("accent-fg");
    expect(tokenOf("ansi-orange")).toBe("orange-fg");
    expect(tokenOf("ansi-ok")).toBe("success-fg");
    expect(tokenOf("ansi-warn")).toBe("warning-fg");
    expect(tokenOf("ansi-danger")).toBe("danger-fg");
    expect(tokenOf("ansi-info")).toBe("info-fg");
    expect(tokenOf("ansi-slate")).toBe("text-muted");
  });

  it("uses no hard-coded color in the output styles", () => {
    const block = css.slice(css.indexOf(".t-log {"), css.indexOf(".licenses {"));
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
  });
});
