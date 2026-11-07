/**
 * Builds the dashboard into a temporary folder and checks the shipped file: one self-contained
 * page, a strict Content-Security-Policy whose hashes match the inline code, no stray URLs,
 * and byte-identical output from the same sources.
 */
import { createHash, webcrypto } from "node:crypto";
import fs, { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(path.join(tmpdir(), "snappy-build-"));
let html = "";
let htmlSecond = "";
let outDir = "";
let terminalWorker = "";

beforeAll(async () => {
  const build = (await import(pathToFileURL(path.join(root, "build.mjs")).href)) as { buildDashboard: (o: { outDir: string }) => Promise<{ file: string; outDir: string; terminalWorkerSource: string }> };
  const first = await build.buildDashboard({ outDir: path.join(tmp, "one") });
  const second = await build.buildDashboard({ outDir: path.join(tmp, "two") });
  outDir = first.outDir;
  terminalWorker = first.terminalWorkerSource;
  html = readFileSync(first.file, "utf8");
  htmlSecond = readFileSync(second.file, "utf8");
}, 60_000);

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const sha = (text: string): string => `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;
const csp = (): string => /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)?.[1] ?? "";
/** The inline scripts, in page order: the theme script in <head>, then the app. */
const scripts = (page: string): string[] => [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1] ?? "");
const directive = (name: string): string => csp().split(";").map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) ?? "";

describe("built file", () => {
  it("is one self-contained page that stays small", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    // Dark is the default theme: the page ships data-theme="dark" on <html>, so the first paint is dark.
    expect(html).toContain('<html lang="en" data-theme="dark">');
    expect(html).toContain('name="viewport"');
    // Two inline scripts: the few-line theme script in <head> (so a returning light-theme visitor never sees a dark frame) and the app.
    expect((html.match(/<script/g) ?? []).length).toBe(2);
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
    const [boot = "", script = ""] = scripts(html);
    const style = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? "";
    expect(scripts(html)).toHaveLength(2);
    expect(script.length).toBeGreaterThan(10_000);
    expect(boot.length).toBeGreaterThan(50);
    expect(boot.length).toBeLessThan(600);
    expect(style.length).toBeGreaterThan(10_000);
    expect(directive("script-src")).toBe(`script-src ${sha(boot)} ${sha(script)}`);
    expect(directive("style-src")).toBe(`style-src ${sha(style)}`);
  });

  it("has no inline style attributes anywhere in the markup or the sprite", () => {
    const body = html.replace(/<style>[\s\S]*?<\/style>/, "").replace(/<script>[\s\S]*?<\/script>/g, "");
    expect(body).not.toMatch(/\sstyle\s*=/i);
    expect(body).not.toMatch(/\son[a-z]+\s*=/i);
  });

  it("contains no http(s) URL except Snapchat profile links and the SVG namespace", () => {
    const urls = [...html.matchAll(/https?:\/\/[^\s"'`)<>\\]*/g)].map((m) => m[0]);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(url).toMatch(/^https:\/\/www\.snapchat\.com\/add\/$|^http:\/\/www\.w3\.org\/2000\/svg$/);
  });

  it("uses the violet accent from the tokens, and no off-brand accent color", () => {
    // The off-brand accent colors, by value, in any case and with or without the hash.
    expect(html).not.toMatch(/FF3D14|FF5A36|BA2900|FF7352|FF8A6E/i);
    expect(html).toMatch(/--accent:\s*#6b4dff/);
    expect(html).toMatch(/--accent:\s*#9b86ff/);
  });

  it("inlines the brand fonts (latin, the weights the brand uses) and the icon sprite", () => {
    expect((html.match(/@font-face/g) ?? []).length).toBe(12);
    expect((html.match(/data:font\/woff2;base64,/g) ?? []).length).toBe(12);
    for (const family of ["Bricolage Grotesque", "Atkinson Hyperlegible Next", "JetBrains Mono"]) expect(html).toContain(`@font-face{font-family:${family};`);
    for (const id of ["i-content-blind", "i-vanished", "i-one-way", "i-quiet", "i-memories", "i-queue", "i-seal", "i-import", "i-file-zip", "i-settings", "i-check", "i-copy", "i-external", "i-overview", "i-people", "i-snapshots", "i-guide", "i-photo", "i-video", "i-file", "i-file-missing", "i-calendar", "i-list", "i-storage", "i-device", "i-shield", "i-minus", "g-import", "g-overview", "g-empty", "g-memories", "g-privacy", "g-guide", "conf-high", "conf-medium", "conf-low", "logo-mark"]) {
      expect(html).toContain(`id="${id}"`);
    }
    // Fonts are the only external-looking resources, and they are data: URIs.
    expect([...html.matchAll(/url\(([^)]{0,20})/g)].every((m) => (m[1] ?? "").startsWith("data:"))).toBe(true);
  });

  it("defines the digits-only family Snappy Digits at four weights, and lists it first in the body and display stacks", () => {
    // Atkinson draws a slashed zero and has no switch for it, so the ten digits come from a Bricolage Grotesque subset.
    const faces = [...html.matchAll(/@font-face\{font-family:Snappy Digits;([^}]*)\}/g)].map((m) => m[1] ?? "");
    expect(faces).toHaveLength(4);
    expect(faces.map((f) => /font-weight:(\d+)/.exec(f)?.[1]).sort()).toEqual(["400", "500", "600", "700"]);
    for (const face of faces) {
      expect(face).toContain("unicode-range:U+0030-0039");
      expect(face).toContain("data:font/woff2;base64,");
      // A subset of ten glyphs, not a whole font: each file stays a few kilobytes.
      expect(/base64,([A-Za-z0-9+/=]+)/.exec(face)?.[1]?.length ?? 0).toBeLessThan(6000);
    }
    // The family is listed first, ahead of the real font, in both stacks (custom properties keep their quotes).
    expect(html).toMatch(/--font-body:[ ]*"Snappy Digits",[ ]*"Atkinson Hyperlegible Next",/);
    expect(html).toMatch(/--font-display:[ ]*"Snappy Digits",[ ]*"Bricolage Grotesque",/);
    // Usernames and code keep the mono face and its zero.
    expect(html).toMatch(/--font-mono:[ ]*"JetBrains Mono",/);
    expect(html).not.toMatch(/--font-mono:[ ]*"Snappy Digits"/);
  });

  it("credits the digits family in THIRD-PARTY-NOTICES.md as a subset of Bricolage Grotesque under the OFL", () => {
    const notices = fs.readFileSync(path.resolve(root, "..", "..", "THIRD-PARTY-NOTICES.md"), "utf8");
    expect(notices).toContain("Snappy Digits");
    expect(notices).toMatch(/subset/i);
    expect(notices).toContain("U+0030 to U+0039");
    expect(notices).toContain("SIL Open Font License");
    for (const weight of [400, 500, 600, 700]) expect(fs.existsSync(path.join(root, "fonts", `snappy-digits-${weight}.woff2`)), `fonts/snappy-digits-${weight}.woff2`).toBe(true);
  });

  it("keeps the source token stacks in step: Snappy Digits first in body and display, never in mono", () => {
    const tokens = fs.readFileSync(path.resolve(root, "..", "..", "brand", "tokens", "tokens.css"), "utf8");
    expect(/--font-body:\s*"Snappy Digits",\s*"Atkinson Hyperlegible Next"/.test(tokens)).toBe(true);
    expect(/--font-display:\s*"Snappy Digits",\s*"Bricolage Grotesque"/.test(tokens)).toBe(true);
    expect(/--font-mono:\s*"JetBrains Mono"/.test(tokens)).toBe(true);
  });

  it("runs a small theme script in <head> before the style and the page, on a hash, so a returning light visitor sees no dark frame", () => {
    const [boot = ""] = scripts(html);
    expect(html.indexOf("<script>")).toBeLessThan(html.indexOf("<style>"));
    expect(html.indexOf("<script>")).toBeLessThan(html.indexOf("<body"));
    expect(html.indexOf("Content-Security-Policy")).toBeLessThan(html.indexOf("<script>"));
    // It reads the one saved word and sets data-theme; it never writes, fetches or touches anything else.
    expect(boot).toContain("localStorage.getItem(\"snappy-theme\")");
    expect(boot).toMatch(/setAttribute\(\s*"data-theme"/);
    expect(boot).toMatch(/removeAttribute\(\s*"data-theme"/);
    expect(boot).not.toMatch(/setItem|fetch|XMLHttp|indexedDB|cookie|innerHTML|eval|style/);
    expect(boot).toMatch(/^try\{/);
    // Same key and the same three words as the app itself.
    const vault = fs.readFileSync(path.join(root, "src", "vault.ts"), "utf8");
    expect(/THEME_KEY = "([^"]+)"/.exec(vault)?.[1]).toBe("snappy-theme");
    const shell = fs.readFileSync(path.join(root, "src", "app-shell.ts"), "utf8");
    expect(shell).toContain('root.removeAttribute("data-theme")');
    expect(html).toContain('<html lang="en" data-theme="dark">');
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
  it("holds an orange-looking color value only as a token: the --orange-* palette, never anywhere else", () => {
    // Orange is a secondary color. Every color in the page that falls in the orange band (hue 12 to 48, saturated) must be
    // one of the values defined for --orange-* in the token sheet. The warning gold and every accent stay out of that band.
    const tokens = fs.readFileSync(path.resolve(root, "..", "..", "brand", "tokens", "tokens.css"), "utf8");
    const orangeTokens = new Set([...tokens.matchAll(/--orange-(?:fg|bg|border|solid):\s*(#[0-9a-fA-F]{6})/g)].map((m) => (m[1] ?? "").toLowerCase()));
    expect(orangeTokens.size).toBe(8);
    const colors = [...new Set([...html.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0].toLowerCase()))];
    expect(colors.length).toBeGreaterThan(10);
    for (const color of colors) {
      const { hue, saturation } = hueAndSaturation(color);
      const orangeish = saturation > 0.45 && hue >= 12 && hue <= 48;
      if (orangeish) expect(orangeTokens.has(color), `${color} looks orange and is not an --orange-* token`).toBe(true);
    }
  });

  it("never lets orange be the primary color: accent, link, focus ring and primary tokens are not orange", () => {
    const tokens = fs.readFileSync(path.resolve(root, "..", "..", "brand", "tokens", "tokens.css"), "utf8");
    for (const name of ["accent", "accent-hover", "accent-fg", "link", "focus-ring", "primary", "primary-hover"]) {
      const values = [...tokens.matchAll(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`, "g"))].map((m) => m[1] ?? "");
      expect(values.length, name).toBeGreaterThanOrEqual(2);
      for (const value of values) {
        const { hue, saturation } = hueAndSaturation(value);
        expect(saturation > 0.45 && hue >= 12 && hue <= 48, `--${name}: ${value} is orange`).toBe(false);
      }
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
    expect((html.match(/<script/g) ?? []).length).toBe(2);
    // The text of the reader's own failure reply: only the reader sends it as an object.
    expect(html).toContain('{type:"failed"}');
    expect(readdirSync(outDir).sort()).toEqual(["index.html", "licenses"]);
  });

  it("starts that code only from a blob: URL, and the page has no other way to load a script", () => {
    expect(html).toMatch(/createObjectURL\(new Blob\(\[/);
    // The command helper names these only in a list of features it removes; nothing on the page calls them.
    expect(html).not.toMatch(/importScripts\s*\(|new\s+SharedWorker/);
    expect(directive("script-src")).toMatch(/^script-src 'sha256-[A-Za-z0-9+/=]+' 'sha256-[A-Za-z0-9+/=]+'$/);
  });
});

describe("built file: the commands live in the helper, not on the page", () => {
  const marker = "Snappy stopped unexpectedly";
  const count = (text: string): number => text.split(marker).length - 1;

  it("carries the helper's code as text inside the one script, and the commands appear nowhere else", () => {
    expect(count(terminalWorker)).toBe(1);
    // Every occurrence on the page is inside the helper's own text: the page itself has no command table.
    expect(count(html)).toBe(count(terminalWorker));
    expect(html).toContain("Usage: snappy-export");
    expect((html.match(/<script/g) ?? []).length).toBe(2);
  });

  it("keeps the page under the size limit with the helper inside, and records how much it grew", () => {
    const bytes = Buffer.byteLength(html);
    // Measured when the helper was added: the page was 488 KB before and about 700 KB after. The fourteen
    // insight commands came in with the command line afterwards (the help overview lists them, so their code
    // travels in the helper even though the app does not run them): about 850 KB. A jump past a quarter more
    // than that means something large came in by accident.
    expect(bytes).toBeLessThan(1_050_000);
    expect(Buffer.byteLength(terminalWorker)).toBeLessThan(420_000);
  });
});

describe("built file: command helper", () => {
  it("holds the commands, so a Run can execute them in a worker", () => {
    expect(terminalWorker.length).toBeGreaterThan(100_000);
    // Text of the command line's own messages, so the commands really are in the helper.
    expect(terminalWorker).toContain("Snappy stopped unexpectedly");
    expect(terminalWorker).toContain("Usage: snappy-export");
    expect(terminalWorker).toContain("Stopped. Files already saved are kept.");
  });

  it("has no downloader: the network module is replaced by a stub, and nothing calls the network", () => {
    // The real downloader's own words are absent; the stub is what the helper carries.
    expect(terminalWorker).not.toContain("This is the only Snappy command that uses the network");
    expect(terminalWorker).not.toContain("redirect:\"manual\"");
    expect(terminalWorker).not.toMatch(/\bfetch\s*\(|new\s+XMLHttpRequest|new\s+WebSocket|new\s+EventSource|\.sendBeacon\s*\(|importScripts\s*\(|new\s+SharedWorker/);
    // The helper starts nothing else, and never reaches for Node.
    expect(terminalWorker).not.toMatch(/new\s+Worker\s*\(/);
    expect(terminalWorker).not.toMatch(/["'`]node:|\bBuffer\b|child_process|require\(|process\.(env|argv|exit)/);
    expect(terminalWorker).not.toMatch(/\bdocument\.[a-z]|\bwindow\.[a-z]|\blocalStorage\b|\bsessionStorage\b/);
  });

  it("removes the browser's network features before it runs anything", () => {
    expect(terminalWorker).toMatch(/XMLHttpRequest/); // named only to be removed, in the scrubber's list
    expect(terminalWorker.indexOf("XMLHttpRequest")).toBeLessThan(terminalWorker.indexOf("Snappy stopped unexpectedly") + terminalWorker.length);
  });

  it("runs as built: on a worker-like scope it scrubs the network features, then answers a run request", async () => {
    const posted: { type: string; text?: string; code?: number }[] = [];
    const scope: Record<string, unknown> = {
      WorkerGlobalScope: function WorkerGlobalScope() {},
      postMessage: (m: { type: string }) => void posted.push(m),
      setTimeout,
      clearTimeout,
      Blob,
      TextEncoder,
      TextDecoder,
      AbortController,
      crypto: webcrypto,
      atob,
      btoa,
      queueMicrotask,
      URL,
      navigator: { sendBeacon: () => true },
      fetch: () => "live",
      WebSocket: class {},
    };
    vm.createContext(scope);
    vm.runInContext(terminalWorker, scope);
    expect(scope.fetch).toBeUndefined();
    expect(scope.WebSocket).toBeUndefined();
    expect((scope.navigator as { sendBeacon?: unknown }).sendBeacon).toBeUndefined();
    (scope.onmessage as (e: { data: unknown }) => void)({ data: { type: "run", runId: "t", argv: ["help"], files: [], columns: 80, coarse: false, outCap: 1000 } });
    await new Promise((r) => setTimeout(r, 100));
    expect(posted.map((m) => m.type)).toEqual(["out", "exit"]);
    expect(posted[0]?.text).toContain("Usage: snappy-export <command>");
    expect(posted[1]?.code).toBe(0);
  });

  it("is one plain script: no module syntax, and no dynamic import", () => {
    expect(terminalWorker).not.toMatch(/^\s*(import|export)\s/m);
    expect(terminalWorker).not.toMatch(/\bimport\s*\(/);
  });
});

describe("the dist/index.html that is checked in", () => {
  const shipped = path.join(root, "dist", "index.html");
  const exists = fs.existsSync(shipped);

  it.skipIf(!exists)("has the same policy hashes as its own inline script and style, and the worker rule", () => {
    const page = fs.readFileSync(shipped, "utf8");
    const policy = /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(page)?.[1] ?? "";
    const [boot = "", script = ""] = scripts(page);
    const style = /<style>([\s\S]*?)<\/style>/.exec(page)?.[1] ?? "";
    expect(policy).toContain(`script-src ${sha(boot)} ${sha(script)}`);
    expect(policy).toContain(`style-src ${sha(style)}`);
    expect(policy).toContain("worker-src blob:");
    expect(policy).toContain("connect-src 'none'");
  });

  it.skipIf(!exists)("has no off-brand accent color value", () => {
    const page = fs.readFileSync(shipped, "utf8");
    expect(page).not.toMatch(/FF3D14|FF5A36|BA2900|FF7352|FF8A6E/i);
  });

  it("keeps the build and serve scripts free of off-brand colors and hard-coded accents", () => {
    for (const name of ["build.mjs", "serve.mjs"]) {
      const text = fs.readFileSync(path.join(root, name), "utf8");
      expect(text, name).not.toMatch(/FF3D14|FF5A36|BA2900|FF7352|FF8A6E/i);
      expect(text, name).not.toMatch(/#[0-9a-fA-F]{6}\b/);
    }
  });
});
