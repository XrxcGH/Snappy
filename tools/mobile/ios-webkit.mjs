/**
 * Check the built dashboard in Playwright's WebKit engine at iPhone screen sizes.
 *
 * WebKit is the engine inside iOS Safari, so this catches layout and script problems that only
 * show up there. It is NOT iOS: it has no iOS keyboard, safe-area insets or system fonts. For
 * the real thing, use Xcode's Simulator on a Mac.
 *
 * Everything stays on this computer. The dashboard is served on 127.0.0.1 only, and the browser
 * context is set to offline, so any attempt by the page to reach the network fails and is reported.
 *
 *   npm run build:dashboard
 *   node tools/mobile/ios-webkit.mjs [--out out/mobile] [--port 4317]
 *
 * Playwright is not a dependency of this repository. Install it anywhere and point at it:
 *   mkdir ~/pw && cd ~/pw && npm init -y && npm i playwright && npx playwright install webkit
 *   PLAYWRIGHT_DIR=~/pw node tools/mobile/ios-webkit.mjs
 * Exit code 0 when every check passes, 1 when any fails, 2 when it could not run.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { showTheme } from "../screenshots/theme.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PHONES = ["iPhone SE", "iPhone 13", "iPhone 15", "iPhone 15 Pro Max"];
const SCHEMES = ["light", "dark"];

function parseArgs(argv) {
  const out = { out: path.join(root, "out", "mobile"), port: 4317 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") out.out = path.resolve(argv[++i]);
    else if (argv[i] === "--port") out.port = Number(argv[++i]);
    else throw new Error(`Unknown option: ${argv[i]}`);
  }
  if (!Number.isInteger(out.port) || out.port < 1024 || out.port > 65535) throw new Error("--port must be 1024 to 65535");
  return out;
}

function loadPlaywright() {
  const dirs = [process.env.PLAYWRIGHT_DIR, root].filter(Boolean);
  for (const dir of dirs) {
    try {
      return createRequire(path.join(path.resolve(dir), "noop.js"))("playwright");
    } catch { /* try the next place */ }
  }
  throw new Error("Playwright was not found. See the install steps at the top of tools/mobile/ios-webkit.mjs.");
}

const portOpen = (port) => new Promise((resolve) => {
  const s = net.connect({ port, host: "127.0.0.1" });
  s.once("connect", () => { s.destroy(); resolve(true); });
  s.once("error", () => resolve(false));
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!existsSync(path.join(root, "apps", "dashboard", "dist", "index.html"))) throw new Error("The dashboard is not built. Run: npm run build:dashboard");
  const { webkit, devices } = loadPlaywright();

  let server;
  if (!(await portOpen(opts.port))) {
    server = spawn(process.execPath, [path.join(root, "apps", "dashboard", "serve.mjs"), "--port", String(opts.port)], { stdio: "ignore" });
    for (let i = 0; i < 25 && !(await portOpen(opts.port)); i++) await sleep(200);
  }
  mkdirSync(opts.out, { recursive: true });
  const url = `http://127.0.0.1:${opts.port}/`;
  const browser = await webkit.launch();
  let failures = 0;
  try {
    for (const name of PHONES) {
      const device = devices[name];
      if (!device) { console.log(`skip  ${name}: this Playwright has no such device`); continue; }
      for (const scheme of SCHEMES) {
        const context = await browser.newContext({ ...device, colorScheme: scheme, serviceWorkers: "block" });
        const blocked = [];
        const errors = [];
        // Allow only the page itself; anything else is a network attempt and is recorded and refused.
        await context.route("**/*", (route) => {
          if (route.request().url().startsWith(url)) return route.continue();
          blocked.push(route.request().url().split("?")[0]);
          return route.abort();
        });
        const page = await context.newPage();
        page.on("pageerror", (e) => errors.push(`script error: ${e.message}`));
        page.on("console", (m) => { if (m.type() === "error") errors.push(`console error: ${m.text()}`); });
        await page.goto(url, { waitUntil: "load" });
        await page.waitForTimeout(400);
        // Dark is the default whatever the device says, so each pass sets its theme with the header toggle (as a person would),
        // and the helper checks the page really rendered in that theme before anything is measured or photographed.
        try {
          await showTheme(page, scheme);
        } catch (e) {
          errors.push(e.message);
        }
        const { scrollWidth, innerWidth } = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
        }));
        const problems = [...errors];
        if (scrollWidth > innerWidth) problems.push(`sideways scroll: page is ${scrollWidth}px wide in a ${innerWidth}px window`);
        if (blocked.length) problems.push(`tried to reach the network: ${blocked.join(", ")}`);
        const shot = path.join(opts.out, `${name.replace(/\s+/g, "-").toLowerCase()}-${scheme}.png`);
        await page.screenshot({ path: shot, fullPage: false });
        // Then the same checks with the synthetic sample data loaded, so the stat and finding tiles (CSS subgrid) and the
        // Memories page are exercised on WebKit too, not only the Start page.
        try {
          await page.getByRole("button", { name: "Use sample data" }).click();
          await page.waitForFunction(() => !document.body.innerText.includes("Reading"), null, { timeout: 30000 }).catch(() => {});
          await page.waitForTimeout(600);
          for (const id of ["overview", "disappeared", "cleanup", "memories"]) {
            await page.evaluate((h) => { location.hash = h; }, `#/${id}`);
            await page.waitForTimeout(350);
            const w = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
            if (w.scrollWidth > w.innerWidth) problems.push(`sideways scroll on #/${id} with sample data: page is ${w.scrollWidth}px wide in a ${w.innerWidth}px window`);
            if (id === "overview") await page.screenshot({ path: shot.replace(/\.png$/, "-overview.png"), fullPage: false });
          }
        } catch (e) {
          problems.push(`sample data pass: ${e.message}`);
        }
        if (blocked.length && !problems.some((p) => p.startsWith("tried to reach the network"))) problems.push(`tried to reach the network: ${blocked.join(", ")}`);
        console.log(`${problems.length ? "FAIL" : "ok  "}  ${name}, ${scheme}, ${innerWidth}px${problems.length ? `\n        ${problems.join("\n        ")}` : ""}`);
        if (problems.length) failures++;
        await context.close();
      }
    }
  } finally {
    await browser.close();
    server?.kill();
  }
  console.log(`Screenshots: ${opts.out}`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(2);
});
