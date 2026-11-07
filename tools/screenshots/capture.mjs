/**
 * Capture screenshots of the built dashboard, for the README and the docs.
 *
 * Every picture is made from Snappy's built-in SYNTHETIC sample data ("Use sample data"):
 * invented usernames, no real export, nothing from anyone's account. The page is served on
 * 127.0.0.1 only and the browser is set to refuse any other network request.
 *
 *   npm run build:dashboard
 *   PLAYWRIGHT_DIR=<folder with playwright installed> node tools/screenshots/capture.mjs [--out docs/images] [--port 4318]
 *
 * Dark is the dashboard's default, so a light picture is made by pressing the header toggle, and the theme is verified
 * (data-theme and the rendered background) before every capture: see theme.mjs. A "*-light.png" is really light.
 *
 * Playwright is not a dependency of this repository (see tools/mobile/ios-webkit.mjs for how to
 * install it anywhere and point at it). Writes, for each screen, a wide light and dark capture, plus a
 * phone-size capture of the most useful screens.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { showTheme } from "./theme.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCREENS = ["overview", "disappeared", "requests", "quiet", "cleanup", "memories", "privacy", "guide", "settings"];
const PHONE_SCREENS = ["overview", "cleanup", "memories"];

function parseArgs(argv) {
  const out = { out: path.join(root, "docs", "images"), port: 4318, only: undefined };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") out.out = path.resolve(argv[++i]);
    else if (argv[i] === "--port") out.port = Number(argv[++i]);
    else if (argv[i] === "--only") out.only = argv[++i].split(",");
    else throw new Error(`Unknown option: ${argv[i]}`);
  }
  return out;
}

function loadPlaywright() {
  for (const dir of [process.env.PLAYWRIGHT_DIR, root].filter(Boolean)) {
    try { return createRequire(path.join(path.resolve(dir), "noop.js"))("playwright"); } catch { /* next */ }
  }
  throw new Error("Playwright was not found. See the install steps in tools/mobile/ios-webkit.mjs.");
}

const portOpen = (port) => new Promise((resolve) => {
  const s = net.connect({ port, host: "127.0.0.1" });
  s.once("connect", () => { s.destroy(); resolve(true); });
  s.once("error", () => resolve(false));
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openWithSample(browser, url, contextOptions) {
  const context = await browser.newContext({ ...contextOptions, serviceWorkers: "block", reducedMotion: "reduce" });
  await context.route("**/*", (route) => (route.request().url().startsWith(url) ? route.continue() : route.abort()));
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "load" });
  await page.getByRole("button", { name: "Use sample data" }).click();
  await page.waitForFunction(() => !document.body.innerText.includes("Reading"), null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(600);
  return { context, page };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!existsSync(path.join(root, "apps", "dashboard", "dist", "index.html"))) throw new Error("The dashboard is not built. Run: npm run build:dashboard");
  const { chromium } = loadPlaywright();
  let server;
  if (!(await portOpen(opts.port))) {
    server = spawn(process.execPath, [path.join(root, "apps", "dashboard", "serve.mjs"), "--port", String(opts.port)], { stdio: "ignore" });
    for (let i = 0; i < 25 && !(await portOpen(opts.port)); i++) await sleep(200);
  }
  mkdirSync(opts.out, { recursive: true });
  const url = `http://127.0.0.1:${opts.port}/`;
  const browser = await chromium.launch();
  const screens = opts.only ?? SCREENS;
  try {
    for (const scheme of ["light", "dark"]) {
      const { context, page } = await openWithSample(browser, url, { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, colorScheme: scheme });
      await showTheme(page, scheme);
      for (const id of screens) {
        await page.evaluate((h) => { location.hash = h; }, `#/${id}`);
        await page.mouse.move(0, 0);
        await page.waitForTimeout(350);
        const file = path.join(opts.out, `${id}-${scheme}.png`);
        await page.screenshot({ path: file, fullPage: false });
        console.log("wrote", path.relative(root, file));
      }
      await context.close();
    }
    const phone = await openWithSample(browser, url, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: "light" });
    await showTheme(phone.page, "light");
    for (const id of PHONE_SCREENS.filter((s) => screens.includes(s))) {
      await phone.page.evaluate((h) => { location.hash = h; }, `#/${id}`);
      await phone.page.mouse.move(0, 0);
      await phone.page.waitForTimeout(350);
      const file = path.join(opts.out, `${id}-phone.png`);
      await phone.page.screenshot({ path: file, fullPage: false });
      console.log("wrote", path.relative(root, file));
    }
    await phone.context.close();
  } finally {
    await browser.close();
    server?.kill();
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
