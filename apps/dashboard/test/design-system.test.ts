/**
 * The color and graphics system: category and tint tokens exist in every theme and agree with
 * tokens.json, the contrast report passes, the stylesheet defines every scope and illustration
 * class, and the icon names in code are exactly the symbols in the sprite.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CATEGORY_ICON, categoryOfCandidate, scopeClass } from "../src/components/category.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (...parts: string[]): string => readFileSync(path.join(root, ...parts), "utf8");

const CATEGORIES = ["disappeared", "requests", "quiet", "cleanup", "memories"] as const;
const PARTS = ["fg", "bg", "border", "solid"] as const;

const tokensCss = read("brand", "tokens", "tokens.css");
const tokensJson = JSON.parse(read("brand", "tokens", "tokens.json")) as {
  category: Record<string, { light: Record<string, string>; dark: Record<string, string> }>;
  tint: { light: Record<string, string>; dark: Record<string, string> };
  orange: { light: Record<string, string>; dark: Record<string, string> };
};

/** The three theme blocks of tokens.css: light, OS dark, and the forced dark theme. */
function themeBlocks(): { light: string; osDark: string; forcedDark: string } {
  const media = tokensCss.indexOf("@media (prefers-color-scheme: dark)");
  const forced = tokensCss.indexOf(':root[data-theme="dark"] {');
  const light = tokensCss.indexOf(":root {");
  expect(light).toBeGreaterThanOrEqual(0);
  expect(media).toBeGreaterThan(light);
  expect(forced).toBeGreaterThan(media);
  return { light: tokensCss.slice(light, media), osDark: tokensCss.slice(media, forced), forcedDark: tokensCss.slice(forced) };
}

const valueIn = (block: string, name: string): string | undefined => new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})\\b`).exec(block)?.[1]?.toLowerCase();

describe("category and tint tokens", () => {
  const blocks = themeBlocks();

  it("defines every category color and violet tint in all three theme blocks, matching tokens.json", () => {
    for (const [theme, block] of [
      ["light", blocks.light],
      ["dark", blocks.osDark],
      ["dark", blocks.forcedDark],
    ] as const) {
      for (const cat of CATEGORIES) {
        for (const part of PARTS) {
          const expected = tokensJson.category[cat]?.[theme]?.[part];
          expect(expected, `${cat} ${part} ${theme} in tokens.json`).toBeDefined();
          if (cat === "memories") {
            // Memories rescue is the orange area: its tokens point at the --orange-* palette, which holds the values.
            expect(block, `--cat-memories-${part} (${theme})`).toContain(`--cat-memories-${part}: var(--orange-${part});`);
            expect(valueIn(block, `--orange-${part}`), `--orange-${part} (${theme})`).toBe(expected?.toLowerCase());
            expect(tokensJson.orange[theme][part]?.toLowerCase(), `orange ${part} ${theme} equals the Memories category`).toBe(expected?.toLowerCase());
          } else {
            expect(valueIn(block, `--cat-${cat}-${part}`), `--cat-${cat}-${part} (${theme})`).toBe(expected?.toLowerCase());
          }
        }
      }
      for (const n of ["1", "2", "3", "line"]) {
        const expected = tokensJson.tint[theme][n];
        expect(expected, `tint ${n} ${theme} in tokens.json`).toBeDefined();
        expect(valueIn(block, `--tint-violet-${n}`), `--tint-violet-${n} (${theme})`).toBe(expected?.toLowerCase());
      }
    }
  });

  it("keeps the cleanup category equal to the brand accent in every theme", () => {
    for (const block of [blocks.light, blocks.osDark, blocks.forcedDark]) {
      expect(valueIn(block, "--cat-cleanup-solid")).toBe(valueIn(block, "--accent"));
      expect(valueIn(block, "--cat-cleanup-fg")).toBe(valueIn(block, "--accent-fg"));
      expect(valueIn(block, "--tint-violet-2")).toBe(valueIn(block, "--cat-cleanup-bg"));
    }
  });

  it("passes the WCAG contrast report", () => {
    const run = spawnSync(process.execPath, [path.join(root, "brand", "tokens", "contrast.mjs")], { encoding: "utf8" });
    expect(run.status, run.stdout + run.stderr).toBe(0);
  });
});

describe("stylesheet", () => {
  const css = read("apps", "dashboard", "src", "styles.css");
  const sprite = read("brand", "icons", "icons.svg");

  it("defines every category scope and the neutral scope", () => {
    for (const cat of [...CATEGORIES, "neutral"]) expect(css).toMatch(new RegExp(`\\.cat-${cat}\\s*\\{`));
    // A scope paints with four variables and falls back to violet on the root.
    expect(css).toMatch(/:root\s*\{[^}]*--c-solid:\s*var\(--accent\)/);
  });

  it("lays tiles out on a subgrid, so titles, numbers, descriptions and actions share horizontal lines, all centered", () => {
    expect(css).toMatch(/\.tile\s*\{[^}]*grid-template-rows:\s*subgrid/);
    expect(css).toMatch(/\.tile\s*\{[^}]*grid-row:\s*span var\(--tile-rows\)/);
    expect(css).toMatch(/\.tile\s*\{[^}]*text-align:\s*center/);
    expect(css).toMatch(/\.tile\s*\{[^}]*justify-items:\s*center/);
    expect(css).toMatch(/\.tiles-findings\s*\{\s*--tile-rows:\s*5/);
    expect(css).toMatch(/\.tiles-stats\s*\{\s*--tile-rows:\s*3/);
    // The five findings are three across and then two wider ones: no hole in the grid.
    expect(css).toMatch(/\.tiles-findings \.tile:nth-child\(n\+4\)\s*\{\s*grid-column:\s*span 3/);
  });

  it("has a rule for every g-* class the spot illustrations use", () => {
    const classes = new Set<string>();
    for (const m of sprite.matchAll(/class="(g-[\w-]+)"/g)) classes.add(m[1] as string);
    expect(classes.size).toBeGreaterThan(5);
    for (const name of classes) expect(css, `.${name}`).toMatch(new RegExp(`\\.${name}\\s*\\{`));
  });
});

describe("icons", () => {
  const sprite = read("brand", "icons", "icons.svg");
  const iconSource = read("apps", "dashboard", "src", "components", "icon.ts");

  it("names exactly the i-* symbols in the sprite, so an icon can never be named without existing or exist without being usable", () => {
    const union = /export type IconName =([^;]+);/.exec(iconSource)?.[1] ?? "";
    const named = new Set([...union.matchAll(/"([\w-]+)"/g)].map((m) => m[1] as string));
    const inSprite = new Set([...sprite.matchAll(/<symbol id="i-([\w-]+)"/g)].map((m) => m[1] as string));
    expect([...named].sort()).toEqual([...inSprite].sort());
  });

  it("has a g-* symbol for every spot illustration name", () => {
    const union = /export type SpotName =([^;]+);/.exec(iconSource)?.[1] ?? "";
    const names = [...union.matchAll(/"([\w-]+)"/g)].map((m) => m[1] as string);
    expect(names.length).toBe(6);
    for (const name of names) expect(sprite).toContain(`<symbol id="g-${name}"`);
  });

  it("keeps every symbol free of style attributes, scripts and hard-coded colors", () => {
    const symbols = sprite.slice(sprite.indexOf("</defs>"));
    expect(symbols).not.toMatch(/\sstyle=/i);
    expect(symbols).not.toMatch(/<script|href="http|#[0-9a-fA-F]{6}\b/i);
  });
});

describe("category helpers", () => {
  it("maps candidate categories to finding areas", () => {
    expect(categoryOfCandidate("ghost")).toBe("disappeared");
    expect(categoryOfCandidate("one-way")).toBe("requests");
    expect(categoryOfCandidate("dormant")).toBe("quiet");
  });

  it("gives each of the five areas one icon, and a scope class named after it", () => {
    expect(Object.keys(CATEGORY_ICON).sort()).toEqual([...CATEGORIES].sort());
    expect(new Set(Object.values(CATEGORY_ICON)).size).toBe(5);
    expect(scopeClass("quiet")).toBe("cat-quiet");
    expect(scopeClass("neutral")).toBe("cat-neutral");
  });
});
