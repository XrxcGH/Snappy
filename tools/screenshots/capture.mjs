/**
 * Capture screenshots of the built dashboard, for the README and the docs.
 *
 * Every picture is made from Snappy's built-in SYNTHETIC sample data ("Use sample data"): invented usernames
 * such as ghost_1, no real export, nothing from anyone's account. The page is served on 127.0.0.1 only and the
 * browser is headless and set to refuse any other network request, so nothing opens on your screen.
 *
 *   npm run build:dashboard
 *   PLAYWRIGHT_DIR=<folder with playwright installed> node tools/screenshots/capture.mjs [--out out/screenshots] [--port 4318] [--only name,name]
 *
 * Writes full-resolution PNG files to --out (default out/screenshots, which git ignores):
 *   desktop-<screen>-<light|dark>.png   1440 by 900, one pixel per pixel
 *   phone-<screen>-<light|dark>.png     390 by 844 at 2x, a phone-size Chromium window
 * tools/screenshots/compose.mjs turns these into the small images in docs/images. `npm run screenshots` runs both.
 *
 * Dark is the dashboard's default, so a light picture is made by pressing the header toggle, and the theme is verified
 * (data-theme and the rendered background) before every capture: see theme.mjs. A "...-light" picture is really light.
 *
 * Playwright is not a dependency of this repository (see tools/mobile/ios-webkit.mjs for how to install it anywhere and
 * point at it).
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { showTheme } from "./theme.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * One entry per picture: its file name, the page it shows and an optional step that gets the page ready.
 * "start" is taken before the sample data is loaded, because that is the page a new person sees.
 */
const DESKTOP = [
  { name: "start", hash: "#/start", beforeSample: true },
  { name: "overview", hash: "#/overview" },
  { name: "unaccepted-requests", hash: "#/requests" },
  { name: "cleanup-queue", hash: "#/cleanup" },
  { name: "memories-rescue", hash: "#/memories" },
  { name: "tools-hub", hash: "#/tools" },
  { name: "tool-friends-table", hash: "#/tools/friends-table" },
  { name: "tool-year-in-review", hash: "#/tools/year-in-review" },
  { name: "terminal-demo-run", hash: "#/guide", prepare: runDemo },
  { name: "privacy", hash: "#/privacy" },
  { name: "settings", hash: "#/settings" },
];
const PHONE = [
  { name: "overview", hash: "#/overview" },
  { name: "tools-hub", hash: "#/tools" },
  { name: "cleanup-queue", hash: "#/cleanup" },
  { name: "tool-year-in-review", hash: "#/tools/year-in-review", scrollTo: "At a glance" },
];

function parseArgs(argv) {
  const out = { out: path.join(root, "out", "screenshots"), port: 4318, only: undefined };
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
/** A tool computes after its page has painted, so a picture waits until nothing on the page is busy. */
const settle = (page) => page.waitForFunction(() => document.querySelector("[aria-busy]") === null, null, { timeout: 15000 }).catch(() => {});

/** The Export guide's "Try it on invented data" command: press Run, wait for it to finish, and bring its output into view. */
async function runDemo(page) {
  const run = page.getByRole("button", { name: /Run command: try it on invented data/i });
  await run.scrollIntoViewIfNeeded();
  await run.click();
  await page.waitForFunction(() => /Exit code 0/.test(document.body.innerText), null, { timeout: 60000 });
  await page.waitForTimeout(400);
  // The block's own heading sits just under the top edge, and its whole output stays in view.
  await page.evaluate(() => {
    const block = [...document.querySelectorAll(".command")].find((el) => /Try it on invented data/.test(el.innerText));
    if (block) window.scrollTo(0, window.scrollY + block.getBoundingClientRect().top - 24);
  });
  await page.waitForTimeout(250);
}

/** Scroll so the heading with this text sits just under the top edge: a phone picture then shows results, not only the controls. */
async function scrollToHeading(page, text) {
  await page.evaluate((t) => {
    const heading = [...document.querySelectorAll("h2, h3")].find((el) => el.textContent.trim() === t);
    if (heading) window.scrollTo(0, window.scrollY + heading.getBoundingClientRect().top - 24);
  }, text);
  await page.waitForTimeout(250);
}

/** A page with a browser context that can reach only the dashboard on 127.0.0.1. */
async function openPage(browser, url, contextOptions) {
  const context = await browser.newContext({ ...contextOptions, serviceWorkers: "block", reducedMotion: "reduce" });
  await context.route("**/*", (route) => (route.request().url().startsWith(url) ? route.continue() : route.abort()));
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "load" });
  return { context, page };
}

async function loadSample(page) {
  await page.getByRole("button", { name: "Use sample data" }).click();
  await page.waitForFunction(() => !document.body.innerText.includes("Reading"), null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(600);
}

/** Take one picture: go to the page, let it settle, and write the PNG. */
async function shoot(page, shot, file) {
  await page.evaluate((h) => { location.hash = h; }, shot.hash);
  await page.mouse.move(0, 0);
  await settle(page);
  await page.waitForTimeout(350);
  if (shot.prepare) await shot.prepare(page);
  if (shot.scrollTo) await scrollToHeading(page, shot.scrollTo);
  // Every picture after the sample data is loaded must say so on the page ("Sample data" banner), or nothing is written.
  if (!shot.beforeSample && !(await page.evaluate(() => document.body.innerText.includes("Sample data")))) {
    throw new Error(`${shot.hash} does not show the Sample data banner, so it may not be synthetic. No picture was written for it.`);
  }
  await page.screenshot({ path: file, fullPage: false });
  console.log("wrote", path.relative(root, file));
}

async function pass(browser, url, opts, { prefix, shots, scheme, contextOptions }) {
  const wanted = shots.filter((s) => !opts.only || opts.only.includes(`${prefix}-${s.name}`) || opts.only.includes(prefix));
  if (wanted.length === 0) return;
  const { context, page } = await openPage(browser, url, { ...contextOptions, colorScheme: scheme });
  try {
    await showTheme(page, scheme);
    for (const shot of wanted.filter((s) => s.beforeSample)) await shoot(page, shot, path.join(opts.out, `${prefix}-${shot.name}-${scheme}.png`));
    await loadSample(page);
    for (const shot of wanted.filter((s) => !s.beforeSample)) await shoot(page, shot, path.join(opts.out, `${prefix}-${shot.name}-${scheme}.png`));
  } finally {
    await context.close();
  }
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
  try {
    for (const scheme of ["light", "dark"]) {
      await pass(browser, url, opts, { prefix: "desktop", shots: DESKTOP, scheme, contextOptions: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 } });
      await pass(browser, url, opts, { prefix: "phone", shots: PHONE, scheme, contextOptions: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } });
    }
  } finally {
    await browser.close();
    server?.kill();
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
