/**
 * Builds the dashboard into a temporary folder and checks the shipped file: one self-contained
 * page, a strict Content-Security-Policy whose hashes match the inline code, no stray URLs,
 * and byte-identical output from the same sources.
 */
import { createHash } from "node:crypto";
import fs, { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(path.join(tmpdir(), "snappy-build-"));
let html = "";
let htmlSecond = "";
let outDir = "";

beforeAll(async () => {
  const build = (await import(pathToFileURL(path.join(root, "build.mjs")).href)) as { buildDashboard: (o: { outDir: string }) => Promise<{ file: string; outDir: string }> };
  const first = await build.buildDashboard({ outDir: path.join(tmp, "one") });
  const second = await build.buildDashboard({ outDir: path.join(tmp, "two") });
  outDir = first.outDir;
  html = readFileSync(first.file, "utf8");
  htmlSecond = readFileSync(second.file, "utf8");
}, 60_000);

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const sha = (text: string): string => `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;
const csp = (): string => /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)?.[1] ?? "";
const directive = (name: string): string => csp().split(";").map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) ?? "";

describe("built file", () => {
  it("is one self-contained page that stays small", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('name="viewport"');
    expect((html.match(/<script/g) ?? []).length).toBe(1);
    expect((html.match(/<style/g) ?? []).length).toBe(1);
    expect(html).not.toMatch(/<script[^>]*\ssrc=/i);
    expect(html).not.toMatch(/<link[^>]*rel=["']?stylesheet/i);
    expect(html).not.toMatch(/<(img|iframe|object|embed|video|audio|source|form)\b/i);
    expect(html).not.toMatch(/\s(src|srcset|action)="(?!data:)/i);
    expect(Buffer.byteLength(html)).toBeLessThan(1_000_000);
  });

  it("ships the strict Content-Security-Policy as a meta tag, ahead of any script or style", () => {
    expect(html.indexOf("Content-Security-Policy")).toBeLessThan(html.indexOf("<style"));
    expect(html.indexOf("Content-Security-Policy")).toBeLessThan(html.indexOf("<script"));
    expect(directive("default-src")).toBe("default-src 'none'");
    expect(directive("connect-src")).toBe("connect-src 'none'");
    expect(directive("form-action")).toBe("form-action 'none'");
    expect(directive("base-uri")).toBe("base-uri 'none'");
    expect(directive("frame-src")).toBe("frame-src 'none'");
    expect(directive("object-src")).toBe("object-src 'none'");
    expect(directive("worker-src")).toBe("worker-src blob:");
    expect(directive("font-src")).toBe("font-src data:");
    expect(directive("img-src")).toBe("img-src data:");
    // The one allowance beyond data: is a blob: worker, and connect-src stays closed for the page and for that worker.
    expect(csp()).not.toMatch(/unsafe-inline|unsafe-eval|\*|https?:|child-src/);
    expect(csp().match(/blob:/g)).toHaveLength(1);
    expect(csp()).toContain("connect-src 'none'");
  });

  it("pins the inline script and style by hash, matching the exact inlined text", () => {
    const script = /<script>([\s\S]*)<\/script>/.exec(html)?.[1] ?? "";
    const style = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? "";
    expect(script.length).toBeGreaterThan(10_000);
    expect(style.length).toBeGreaterThan(10_000);
    expect(directive("script-src")).toBe(`script-src ${sha(script)}`);
    expect(directive("style-src")).toBe(`style-src ${sha(style)}`);
  });

  it("has no inline style attributes anywhere in the markup or the sprite", () => {
    const body = html.replace(/<style>[\s\S]*?<\/style>/, "").replace(/<script>[\s\S]*<\/script>/, "");
    expect(body).not.toMatch(/\sstyle\s*=/i);
    expect(body).not.toMatch(/\son[a-z]+\s*=/i);
  });

  it("contains no http(s) URL except Snapchat profile links and the SVG namespace", () => {
    const urls = [...html.matchAll(/https?:\/\/[^\s"'`)<>\\]*/g)].map((m) => m[0]);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(url).toMatch(/^https:\/\/www\.snapchat\.com\/add\/$|^http:\/\/www\.w3\.org\/2000\/svg$/);
  });

  it("has no orange or vermilion, and uses the violet accent from the tokens", () => {
    expect(html).not.toMatch(/orange|vermilion/i);
    // The off-brand accent colors, by value, in any case and with or without the hash.
    expect(html).not.toMatch(/FF3D14|FF5A36|BA2900|FF7352|FF8A6E/i);
    expect(html).toMatch(/--accent:\s*#6b4dff/);
    expect(html).toMatch(/--accent:\s*#9b86ff/);
  });

  it("inlines the brand fonts (latin, the weights the brand uses) and the icon sprite", () => {
    expect((html.match(/@font-face/g) ?? []).length).toBe(8);
    expect((html.match(/data:font\/woff2;base64,/g) ?? []).length).toBe(8);
    for (const family of ["Bricolage Grotesque", "Atkinson Hyperlegible Next", "JetBrains Mono"]) expect(html).toContain(`@font-face{font-family:${family};`);
    for (const id of ["i-content-blind", "i-vanished", "i-one-way", "i-quiet", "i-memories", "i-queue", "i-seal", "i-import", "i-file-zip", "i-settings", "i-check", "i-copy", "i-external", "conf-high", "conf-medium", "conf-low", "logo-mark"]) {
      expect(html).toContain(`id="${id}"`);
    }
    // Fonts are the only external-looking resources, and they are data: URIs.
    expect([...html.matchAll(/url\(([^)]{0,20})/g)].every((m) => (m[1] ?? "").startsWith("data:"))).toBe(true);
  });

  it("carries the skip link target, live regions and the license texts for the fonts", () => {
    expect(html).toContain('id="live-polite"');
    expect(html).toContain('id="live-assertive"');
    expect(html).toContain("Skip to main content");
    for (const name of ["Bricolage Grotesque", "Atkinson Hyperlegible Next", "JetBrains Mono", "SIL Open Font License 1.1", "fflate"]) expect(html).toContain(name);
    expect(readdirSync(path.join(outDir, "licenses")).sort()).toEqual(["atkinson-hyperlegible-next-OFL.txt", "bricolage-grotesque-OFL.txt", "fflate-MIT.txt", "jetbrains-mono-OFL.txt"]);
  });

  it("is deterministic: the same sources build to the same bytes", () => {
    expect(htmlSecond).toBe(html);
    for (const name of readdirSync(path.join(outDir, "licenses"))) {
      expect(readFileSync(path.join(tmp, "two", "licenses", name), "utf8")).toBe(readFileSync(path.join(outDir, "licenses", name), "utf8"));
    }
  });
});

/** Hue in degrees (0-360) and saturation (0-1) of a #rrggbb color. */
function hueAndSaturation(hex: string): { hue: number; saturation: number } {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return { hue: 0, saturation: 0 };
  const hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { hue: (hue * 60 + 360) % 360, saturation: max === 0 ? 0 : d / max };
}

describe("built file: brand colors", () => {
  it("holds no orange-looking color value, apart from the amber of the warning status colors", () => {
    // Amber is a status color in the tokens (--warning-*), not the accent; everything else must not look orange.
    const tokens = fs.readFileSync(path.resolve(root, "..", "..", "brand", "tokens", "tokens.css"), "utf8");
    const warning = new Set(
      tokens
        .split("\n")
        .filter((line) => /--warning-/.test(line))
        .flatMap((line) => [...line.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0].toLowerCase())),
    );
    expect(warning.size).toBeGreaterThan(0);
    const colors = [...new Set([...html.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0].toLowerCase()))].filter((c) => !warning.has(c));
    expect(colors.length).toBeGreaterThan(10);
    for (const color of colors) {
      const { hue, saturation } = hueAndSaturation(color);
      const orange = saturation > 0.45 && hue >= 12 && hue <= 48;
      expect(orange, `${color} looks orange`).toBe(false);
    }
  });

  it("writes every hex color only in the inlined token sheet, never in the app's own styles or code", () => {
    const tokens = fs.readFileSync(path.resolve(root, "..", "..", "brand", "tokens", "tokens.css"), "utf8");
    const allowed = new Set([...tokens.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0].toLowerCase()));
    const used = [...new Set([...html.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0].toLowerCase()))];
    expect(used.filter((c) => !allowed.has(c))).toEqual([]);
  });
});

describe("built file: background reader", () => {
  it("carries the reader's code as text inside the one script, not as a second script or file", () => {
    expect((html.match(/<script/g) ?? []).length).toBe(1);
    // The text of the reader's own failure reply: only the reader sends it as an object.
    expect(html).toContain('{type:"failed"}');
    expect(readdirSync(outDir).sort()).toEqual(["index.html", "licenses"]);
  });

  it("starts that code only from a blob: URL, and the page has no other way to load a script", () => {
    expect(html).toMatch(/createObjectURL\(new Blob\(\[/);
    expect(html).not.toMatch(/importScripts|new SharedWorker/);
    expect(directive("script-src")).toMatch(/^script-src 'sha256-[A-Za-z0-9+/=]+'$/);
  });
});

describe("the dist/index.html that is checked in", () => {
  const shipped = path.join(root, "dist", "index.html");
  const exists = fs.existsSync(shipped);

  it.skipIf(!exists)("has the same policy hashes as its own inline script and style, and the worker rule", () => {
    const page = fs.readFileSync(shipped, "utf8");
    const policy = /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(page)?.[1] ?? "";
    const script = /<script>([\s\S]*)<\/script>/.exec(page)?.[1] ?? "";
    const style = /<style>([\s\S]*?)<\/style>/.exec(page)?.[1] ?? "";
    expect(policy).toContain(`script-src ${sha(script)}`);
    expect(policy).toContain(`style-src ${sha(style)}`);
    expect(policy).toContain("worker-src blob:");
    expect(policy).toContain("connect-src 'none'");
  });

  it.skipIf(!exists)("has no orange, by name or by value", () => {
    const page = fs.readFileSync(shipped, "utf8");
    expect(page).not.toMatch(/orange|vermilion/i);
    expect(page).not.toMatch(/FF3D14|FF5A36|BA2900|FF7352|FF8A6E/i);
  });

  it("keeps the build and serve scripts free of off-brand colors and hard-coded accents", () => {
    for (const name of ["build.mjs", "serve.mjs"]) {
      const text = fs.readFileSync(path.join(root, name), "utf8");
      expect(text, name).not.toMatch(/orange|vermilion|FF3D14|FF5A36|BA2900|FF7352|FF8A6E/i);
      expect(text, name).not.toMatch(/#[0-9a-fA-F]{6}\b/);
    }
  });
});
