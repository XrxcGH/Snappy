/**
 * Builds the dashboard into ONE self-contained file, dist/index.html, that works from file://
 * with no network: the TypeScript bundle, the CSS (brand tokens first), the icon sprite and the
 * woff2 fonts (base64) are all inlined. The page ships a strict Content-Security-Policy whose
 * script and style hashes are computed here from the exact inlined text.
 *
 * The build is deterministic: no timestamps, no random ids, sorted inputs. Same sources, same bytes.
 *
 *   node build.mjs [--out <dir>]      (default: dist next to this file)
 */
import { build as esbuild, transform } from "esbuild";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const require = createRequire(import.meta.url);

/** Latin subsets and only the weights the brand uses (docs/BRAND.md section 5). */
const FONTS = [
  { pkg: "bricolage-grotesque", family: "Bricolage Grotesque", weights: [600, 700], short: "Bricolage Grotesque" },
  { pkg: "atkinson-hyperlegible-next", family: "Atkinson Hyperlegible Next", weights: [400, 500, 600, 700], short: "Atkinson Hyperlegible Next" },
  { pkg: "jetbrains-mono", family: "JetBrains Mono", weights: [400, 500], short: "JetBrains Mono" },
];

/** The weights the digits-only family is cut at. */
const DIGIT_WEIGHTS = [400, 500, 600, 700];

const sha256 = (text) => `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;

function packageDir(name) {
  return path.dirname(require.resolve(`${name}/package.json`));
}

/** The OFL text refers to web pages; the dashboard has no links but Snapchat profiles, so the scheme is dropped from the embedded copy. */
const defang = (text) => text.replace(/\s*\(https?:\/\/[^)]*\)/gi, "").replace(/https?:\/\//gi, "").replace(/\r\n/g, "\n");

async function fontCss() {
  const faces = [];
  for (const font of FONTS) {
    const dir = packageDir(`@fontsource/${font.pkg}`);
    for (const weight of font.weights) {
      const woff2 = await readFile(path.join(dir, "files", `${font.pkg}-latin-${weight}-normal.woff2`));
      faces.push(
        `@font-face{font-family:"${font.family}";font-style:normal;font-weight:${weight};font-display:swap;` +
          `src:url(data:font/woff2;base64,${woff2.toString("base64")}) format("woff2")}`,
      );
    }
  }
  // Atkinson Hyperlegible Next draws a slashed zero and has no plain-zero feature (its GSUB table offers only ccmp,
  // frac, locl, pnum and tnum). So the ten digits 0 to 9 come from "Snappy Digits", a digits-only family cut from
  // Bricolage Grotesque (whose zero is plain) at weights 400, 500, 600 and 700 by fonts/make-snappy-digits.py (fontTools
  // pyftsubset, U+0030-0039, tnum and pnum kept). The family is listed FIRST in --font-body and --font-display
  // (brand/tokens/tokens.css), so only digits switch and every letter stays Atkinson or Bricolage. Usernames and code
  // stay in JetBrains Mono, where the slashed zero keeps 0 and O apart.
  for (const weight of DIGIT_WEIGHTS) {
    const woff2 = await readFile(path.join(here, "fonts", `snappy-digits-${weight}.woff2`));
    faces.push(
      `@font-face{font-family:"Snappy Digits";font-style:normal;font-weight:${weight};font-display:swap;unicode-range:U+0030-0039;` +
        `src:url(data:font/woff2;base64,${woff2.toString("base64")}) format("woff2")}`,
    );
  }
  return faces.join("\n");
}

/** License texts for the About screen (virtual module) and the licenses folder (unmodified files). */
async function licenseData() {
  const entries = [];
  const files = [];
  for (const font of FONTS) {
    const text = await readFile(path.join(packageDir(`@fontsource/${font.pkg}`), "LICENSE"), "utf8");
    const copyright = defang(text.split(/\r?\n/).find((line) => line.startsWith("Copyright")) ?? "").replace(/\s+\S+\[wght\]\.ttf: Copyright.*$/, "");
    entries.push({ name: font.short, license: "SIL Open Font License 1.1", copyright, text: defang(text) });
    files.push({ name: `${font.pkg}-OFL.txt`, text });
  }
  const mit = await readFile(path.join(packageDir("fflate"), "LICENSE"), "utf8");
  entries.push({ name: "fflate", license: "MIT License", copyright: defang(mit.split(/\r?\n/).find((line) => line.startsWith("Copyright")) ?? ""), text: defang(mit) });
  files.push({ name: "fflate-MIT.txt", text: mit });
  return { entries, files };
}

/** The shared icon sprite, without its inline <style> and style attribute (the CSP forbids both), plus the logo mark. */
async function spriteMarkup() {
  let sprite = await readFile(path.join(repoRoot, "brand", "icons", "icons.svg"), "utf8");
  sprite = sprite
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<defs>[\s\S]*?<\/defs>/, "")
    // Rules must match the symbol content itself: inside <use>, ancestors such as .sprite are invisible to selectors.
    .replace(/class="s"/g, 'class="ic-s"')
    .replace(/class="f"/g, 'class="ic-f"')
    .replace(/<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" style="display:none">/, '<svg xmlns="http://www.w3.org/2000/svg" class="sprite" width="0" height="0" aria-hidden="true" focusable="false">');
  if (/style=|<style/.test(sprite)) throw new Error("The icon sprite still contains inline styles.");

  const mark = await readFile(path.join(repoRoot, "brand", "logo", "snappy-mark.svg"), "utf8");
  const bars = [...mark.matchAll(/<rect [^>]*\/>/g)].map((m) => m[0]);
  if (bars.length !== 5) throw new Error("Expected five bars in snappy-mark.svg.");
  // The spine (third bar) is the accent; the others follow the text color. Colors come from CSS tokens.
  const symbol = bars
    .map((rect, i) => rect.replace(/\s*fill="[^"]*"/, "").replace("<rect ", `<rect class="${i === 2 ? "logo-spine" : "logo-bar"}" `))
    .join("");
  const logo = `<symbol id="logo-mark" viewBox="0 0 64 64">${symbol}</symbol>`;
  return sprite.replace("</svg>", `${logo}</svg>`).trim();
}

const cspFor = (scriptHashes, styleHash) =>
  [
    "default-src 'none'",
    `script-src ${scriptHashes.join(" ")}`,
    `style-src ${styleHash}`,
    "font-src data:",
    "img-src data:",
    "connect-src 'none'",
    // The background reader starts from a blob: URL made by this page's own code. Nothing broader.
    "worker-src blob:",
    "form-action 'none'",
    "base-uri 'none'",
    "frame-src 'none'",
    "object-src 'none'",
  ].join("; ");

const bundleOptions = {
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: ["es2022"],
  minify: true,
  legalComments: "none",
  charset: "ascii",
  logLevel: "warning",
  define: { "process.env.NODE_ENV": '"production"' },
  alias: { "@snappy-export/core": path.join(repoRoot, "packages", "core", "src", "index.ts") },
};

/** Bundle a worker entry (a file under src/) into one minified IIFE string. */
async function bundleWorker(entry, plugins = []) {
  const result = await esbuild({ ...bundleOptions, entryPoints: [path.join(here, "src", entry)], plugins });
  const output = result.outputFiles[0];
  if (!output) throw new Error(`esbuild produced no output for ${entry}.`);
  return output.text;
}

/**
 * The command helper's build leaves the command line's downloader out: that one module is the only
 * place the command line uses the network, and the app makes no connection at all. Its import is
 * answered with a stub of the same names that can only refuse (src/terminal/stubs).
 */
const stubDownloader = {
  name: "snappy-stub-downloader",
  setup(b) {
    b.onResolve({ filter: /memories-download\.ts$/ }, (args) => {
      if (!args.resolveDir.replaceAll("\\", "/").includes("/apps/cli/src")) return undefined;
      return { path: path.join(here, "src", "terminal", "stubs", "memories-download.stub.ts") };
    });
  },
};

/** The command helper (src/terminal/worker.ts): the commands, run in a worker, with no downloader. */
const bundleTerminalWorker = () => bundleWorker(path.join("terminal", "worker.ts"), [stubDownloader]);

/** Bundle the page's entry file (src/main.ts, or a shell's own entry that imports it) into one minified IIFE string. The workers' code travels inside it as text. */
async function bundleScript(licenses, workerSource, terminalWorkerSource, entry) {
  // "<" is escaped so the text can never contain a sequence that ends the inline script early.
  const asText = (value) => JSON.stringify(value).replace(/</g, "\\u003c");
  const virtualModules = {
    "snappy:licenses": `export const licenses = ${asText(licenses)};`,
    "snappy:worker": `export const workerSource = ${asText(workerSource)};`,
    "snappy:terminal-worker": `export const terminalWorkerSource = ${asText(terminalWorkerSource)};`,
  };
  const virtualPlugin = {
    name: "snappy-virtual",
    setup(b) {
      b.onResolve({ filter: /^snappy:(licenses|worker|terminal-worker)$/ }, (args) => ({ path: args.path, namespace: "snappy-virtual" }));
      b.onLoad({ filter: /.*/, namespace: "snappy-virtual" }, (args) => ({ contents: virtualModules[args.path], loader: "js" }));
    },
  };
  const result = await esbuild({ ...bundleOptions, entryPoints: [entry], plugins: [virtualPlugin] });
  const output = result.outputFiles[0];
  if (!output) throw new Error("esbuild produced no output.");
  return output.text;
}

/**
 * A tool may carry its own rules in src/tools/<id>/styles.css. They are appended after styles.css, in folder-name
 * order, so the build stays deterministic. Every selector in one must start with .tool-<id> (a test checks it),
 * so a tool can only style its own page.
 */
async function toolStyles() {
  const base = path.join(here, "src", "tools");
  const folders = (await readdir(base, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  const sheets = [];
  for (const id of folders) {
    try {
      sheets.push(await readFile(path.join(base, id, "styles.css"), "utf8"));
    } catch {
      // This tool has no sheet of its own.
    }
  }
  return sheets.join("\n");
}

/**
 * `entry` lets a native shell bundle its own entry file, which sets the platform (src/platform.ts) and then
 * imports src/main.ts, in place of the plain web one. The page, its policy and its checks are the same.
 */
export async function buildDashboard({ outDir = path.join(here, "dist"), entry = path.join(here, "src", "main.ts") } = {}) {
  const [{ entries, files }, fonts, tokens, own, tools, sprite, template, favicon] = await Promise.all([
    licenseData(),
    fontCss(),
    readFile(path.join(repoRoot, "brand", "tokens", "tokens.css"), "utf8"),
    readFile(path.join(here, "src", "styles.css"), "utf8"),
    toolStyles(),
    spriteMarkup(),
    readFile(path.join(here, "src", "index.html"), "utf8"),
    readFile(path.join(repoRoot, "brand", "logo", "snappy-favicon.svg")),
  ]);

  const style = (await transform(`${fonts}\n${tokens}\n${own}\n${tools}`, { loader: "css", minify: true, legalComments: "none" })).code;
  const workerSource = await bundleWorker("import-worker.ts");
  const terminalWorkerSource = await bundleTerminalWorker();
  const script = await bundleScript(entries, workerSource, terminalWorkerSource, entry);
  // A tiny script in <head> applies a remembered theme before the first paint. Its hash goes in the policy too.
  const themeBoot = (await transform(await readFile(path.join(here, "src", "theme-boot.js"), "utf8"), { loader: "js", minify: true, legalComments: "none" })).code.trim();
  if (/<\/script|<!--/i.test(themeBoot)) throw new Error("The theme script contains a sequence that could end the inline script early.");
  if (/<\/script|<!--/i.test(script)) throw new Error("The bundle contains a sequence that could end the inline script early.");
  if (/<\/style/i.test(style)) throw new Error("The stylesheet contains a sequence that could end the inline style early.");

  const values = {
    CSP: cspFor([sha256(themeBoot), sha256(script)], sha256(style)),
    THEME_BOOT: themeBoot,
    FAVICON: `data:image/svg+xml;base64,${favicon.toString("base64")}`,
    STYLE: style,
    SPRITE: sprite,
    SCRIPT: script,
  };
  // One pass with a function replacer: inserted text is never re-scanned, and "$" in it is never special.
  const html = template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (!Object.hasOwn(values, key)) throw new Error(`Unknown placeholder ${key}`);
    return values[key];
  });

  await rm(outDir, { recursive: true, force: true });
  await mkdir(path.join(outDir, "licenses"), { recursive: true });
  await writeFile(path.join(outDir, "index.html"), html);
  for (const file of files) await writeFile(path.join(outDir, "licenses", file.name), file.text);

  return { outDir, file: path.join(outDir, "index.html"), bytes: Buffer.byteLength(html), csp: values.CSP, workerSource, terminalWorkerSource };
}

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const out = argValue("--out");
  const result = await buildDashboard(out ? { outDir: path.resolve(out) } : {});
  console.log(`Built ${result.file} (${(result.bytes / 1024).toFixed(0)} KB). For development, run: npm run serve -w @snappy-export/dashboard`);
}
