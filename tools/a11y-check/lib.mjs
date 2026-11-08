/**
 * What the accessibility check needs outside the page: finding Playwright, serving the built dashboard on
 * 127.0.0.1, walking the Tab key, and writing the report. The in-page measuring is in inpage.mjs.
 *
 * Playwright is not a dependency of this repository (see tools/mobile/ios-webkit.mjs for how to install it anywhere
 * and point PLAYWRIGHT_DIR at it).
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { auditInPage, describeFocus } from "./inpage.mjs";

/** The playwright package from PLAYWRIGHT_DIR, from the repository, or null when there is none. */
export function findPlaywright(root) {
  for (const dir of [process.env.PLAYWRIGHT_DIR, root].filter(Boolean)) {
    try {
      return createRequire(path.join(path.resolve(dir), "noop.js"))("playwright");
    } catch {
      /* try the next place */
    }
  }
  return null;
}

const portOpen = (port) =>
  new Promise((resolve) => {
    const s = net.connect({ port, host: "127.0.0.1" });
    s.once("connect", () => {
      s.destroy();
      resolve(true);
    });
    s.once("error", () => resolve(false));
  });
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Serve apps/dashboard/dist on 127.0.0.1 (or use the server already on that port). Returns the address and a stop function. */
export async function serveDashboard(root, port) {
  let child;
  if (!(await portOpen(port))) {
    child = spawn(process.execPath, [path.join(root, "apps", "dashboard", "serve.mjs"), "--port", String(port)], { stdio: "ignore" });
    for (let i = 0; i < 25 && !(await portOpen(port)); i++) await sleep(200);
    if (!(await portOpen(port))) throw new Error(`The dashboard server did not start on port ${port}.`);
  }
  return { url: `http://127.0.0.1:${port}/`, stop: () => child?.kill() };
}

/** A page whose browser context can reach only the address given (nothing else on the network). */
export async function openPage(browser, url, contextOptions) {
  const context = await browser.newContext({ ...contextOptions, serviceWorkers: "block", reducedMotion: "reduce" });
  await context.route("**/*", (route) => (route.request().url().startsWith(url) ? route.continue() : route.abort()));
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "load" });
  return { context, page };
}

/** Put the page in "light" or "dark" with the header toggle, and check that the attribute changed. */
export async function showTheme(page, scheme) {
  const read = () => page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  if ((await read()) !== scheme) {
    await page.locator("header button[aria-pressed]").first().click();
    await page.waitForTimeout(250);
  }
  const now = await read();
  if (now !== scheme) throw new Error(`The header toggle did not switch the page to the ${scheme} theme (data-theme is ${now}).`);
}

export async function loadSample(page) {
  await page.getByRole("button", { name: "Use sample data" }).click();
  await page.waitForFunction(() => !document.body.innerText.includes("Reading"), null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(600);
}

/** A tool computes after its page has painted, so a page is read once nothing on it is busy. */
export const settle = (page) => page.waitForFunction(() => document.querySelector("[aria-busy]") === null, null, { timeout: 15000 }).catch(() => {});

/** Every page the menu offers, then every tool on the hub: the hash routes to check, in order. Read from the built page, so a new tool is covered. */
export async function discoverRoutes(page) {
  await page.evaluate(() => {
    location.hash = "#/tools";
  });
  await settle(page);
  return page.evaluate(() => {
    const hrefs = (selector) => [...document.querySelectorAll(selector)].map((a) => a.getAttribute("href"));
    const menu = hrefs('nav a[href^="#/"], header a[href^="#/"]').filter((h) => /^#\/[a-z-]+$/.test(h));
    const tools = hrefs('main a[href^="#/tools/"]');
    return [...new Set([...menu, ...tools])];
  });
}

/**
 * Press Tab through the page and report every stop that shows no focus ring. Stops when the focus comes back to a
 * control already visited, leaves the page, or `limit` stops have been made.
 */
export async function tabStops(page, limit) {
  const found = [];
  await page.evaluate(() => {
    // Put the keyboard's starting point at the top of the page, as a person who has just opened it has it, so the
    // skip link and the menu are stops too. (After a route change the browser would carry on from the page heading.)
    window.scrollTo(0, 0);
    document.body.setAttribute("tabindex", "-1");
    document.body.focus({ preventScroll: true });
    document.body.removeAttribute("tabindex");
    window.__a11ySeen = new WeakSet();
  });
  let stops = 0;
  for (let i = 0; i < limit; i++) {
    await page.keyboard.press("Tab");
    // A ring that eases in is read once it has arrived.
    await page.waitForTimeout(150);
    const info = await page.evaluate(describeFocus);
    if (info.none || info.seen) break;
    stops++;
    if (!info.ring) found.push({ check: "no-focus-ring", sel: info.sel, text: info.text, detail: info.detail });
  }
  return { found, stops };
}

/** All checks for the page as it is now. `touch` turns on the target-size check. */
export async function auditPage(page, { touch, minTarget = 44, tabLimit = 60 }) {
  const { found, facts } = await page.evaluate(auditInPage, { touch, minTarget });
  const focus = await tabStops(page, tabLimit);
  return { found: [...found, ...focus.found], facts: { ...facts, tabStops: focus.stops } };
}

/** One line per finding, with where it was found. */
export function formatFinding(where, f) {
  const text = f.text ? ` "${f.text}"` : "";
  return `${where}  ${f.check}  ${f.sel}${text}  ${f.detail}`;
}

/** Findings that repeat on every page (the menu, the header) are shown once, with the number of pages they were found on. */
export function summarize(all) {
  const byKey = new Map();
  for (const { where, route, finding } of all) {
    const key = `${finding.check}|${finding.sel}|${finding.text}|${finding.detail.replace(/[\d.]+/g, "#")}`;
    const entry = byKey.get(key) ?? { finding, wheres: [], routes: new Set() };
    entry.wheres.push(where);
    entry.routes.add(route);
    byKey.set(key, entry);
  }
  return [...byKey.values()].map(({ finding, wheres, routes }) => `${formatFinding(wheres[0], finding)}${wheres.length > 1 ? `  (${wheres.length} places, ${routes.size} pages)` : ""}`);
}
