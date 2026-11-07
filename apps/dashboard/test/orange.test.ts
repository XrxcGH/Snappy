/**
 * Orange is a SECONDARY color. Violet is the primary brand accent. These tests keep orange where it belongs:
 * it exists only as the --orange-* tokens (and the Memories rescue tokens that point at them), the stylesheet
 * paints with it in two places only (the Memories scope and one small illustration highlight), and it is never
 * hard-coded, never the accent, never in the logo, a primary button, a link, a focus ring or the selection color.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (...parts: string[]): string => readFileSync(path.join(root, ...parts), "utf8");
const css = read("apps", "dashboard", "src", "styles.css").replace(/\/\*[\s\S]*?\*\//g, "");
const tokens = read("brand", "tokens", "tokens.css");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name === "dist") return [];
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe("orange stays secondary", () => {
  it("is painted only by the Memories scope and the one illustration highlight", () => {
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: (m[1] ?? "").trim(), body: m[2] ?? "" }));
    const users = rules.filter((r) => /--orange-|--cat-memories-/.test(r.body));
    expect(users.length).toBeGreaterThan(0);
    for (const rule of users) expect(rule.selector, `rule using orange: ${rule.selector}`).toMatch(/^\.cat-memories$|^\.g-orange$/);
  });

  it("is never named in an accent, link, focus, selection or primary-button rule", () => {
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = (m[1] ?? "").trim();
      const body = m[2] ?? "";
      if (/btn-primary|::selection|:focus-visible|^a\b|\.logo|\.skip-link|\.brand|\.step-num|\.nav-link/.test(selector)) {
        expect(body, selector).not.toMatch(/orange|--cat-memories/);
      }
    }
  });

  it("keeps the logo, the favicon and the app icon free of orange tokens", () => {
    for (const file of walk(path.join(root, "brand", "logo")).filter((f) => f.endsWith(".svg"))) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/orange/i);
    }
  });

  it("is defined only in the token files, as hex values in --orange-*", () => {
    const sources = [
      ...walk(path.join(root, "apps", "dashboard", "src")),
      path.join(root, "apps", "dashboard", "build.mjs"),
      path.join(root, "apps", "dashboard", "serve.mjs"),
      ...walk(path.join(root, "brand", "icons")).filter((f) => f.endsWith(".svg")),
    ];
    const tokenValues = [...tokens.matchAll(/--orange-(?:fg|bg|border|solid):\s*(#[0-9a-fA-F]{6})/g)].map((m) => (m[1] ?? "").toLowerCase());
    expect(tokenValues).toHaveLength(12); // four values in each of the three theme blocks
    for (const file of sources) {
      const text = readFileSync(file, "utf8").toLowerCase();
      for (const value of tokenValues) expect(text, file).not.toContain(value);
    }
  });

  it("has an orange palette in tokens.json that matches the Memories rescue category", () => {
    const json = JSON.parse(read("brand", "tokens", "tokens.json")) as { orange: Record<string, Record<string, string>>; category: { memories: Record<string, Record<string, string>> } };
    expect(json.orange).toEqual(json.category.memories);
  });
});
