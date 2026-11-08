/**
 * Accessibility check for the built dashboard. It looks at the real rendered page, in a headless browser, for the
 * things a person who uses a keyboard, a screen reader or a phone runs into first, and exits with 1 when it finds any:
 *
 *   unnamed-control     a link, button, field or switch with no accessible name
 *   positive-tabindex   a tabindex above 0, which changes the tab order
 *   text-contrast       text under 4.5:1 (3:1 for large text), measured against the composited background
 *   small-target        a control under 44 px on a phone width (links inside a sentence are exempt)
 *   h1-count            a page with no visible h1, or more than one
 *   missing-title       a page with no document title
 *   no-focus-ring       a Tab stop with no visible focus indicator (none, under 2 px, or under 3:1)
 *
 * Every page of the sample data is checked, in light and dark, at 360 px (a phone, with touch targets) and 1280 px,
 * and the start page again before any data is loaded. The sample is Snappy's built-in SYNTHETIC data; the page is
 * served on 127.0.0.1 only and the browser refuses every other address.
 *
 *   npm run build:dashboard
 *   PLAYWRIGHT_DIR=<folder with playwright installed> node tools/a11y-check/check.mjs [options]
 *
 * Options
 *   --routes a,b      only these hash routes, such as start,tools/friends-table (default: every menu page and every tool)
 *   --widths a,b      default 360,1280 (a width of 430 or less is drawn as a phone and checks target size)
 *   --themes light    default light,dark
 *   --tab-stops N     the most Tab stops to press on each page (default 60)
 *   --port N          local port for the static server (default 4349)
 *   --out FILE        also write the report to FILE
 *   --build           rebuild the dashboard first, so a stale copy is never checked
 *
 * Playwright is not a dependency of this repository. No other package is needed. axe-core would find more, but it is
 * a dependency: it is not added without the owner's say-so.
 */
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditPage, discoverRoutes, findPlaywright, loadSample, openPage, serveDashboard, settle, showTheme, summarize } from "./lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
/** Widths at and below this are drawn as a phone: a touch screen, and the target-size check. */
const TOUCH_MAX = 430;

export function parseArgs(argv) {
  const out = { routes: undefined, widths: [360, 1280], themes: ["light", "dark"], tabStops: 60, port: 4349, out: undefined, build: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value.`);
      return v;
    };
    if (a === "--routes") out.routes = value().split(",").map((r) => `#/${r.replace(/^#?\/?/, "")}`);
    else if (a === "--widths") out.widths = value().split(",").map(Number);
    else if (a === "--themes") out.themes = value().split(",");
    else if (a === "--tab-stops") out.tabStops = Number(value());
    else if (a === "--port") out.port = Number(value());
    else if (a === "--out") out.out = path.resolve(value());
    else if (a === "--build") out.build = true;
    else throw new Error(`Unknown option: ${a}`);
  }
  if (out.widths.some((w) => !Number.isFinite(w) || w < 200)) throw new Error("--widths takes pixel widths such as 360,1280.");
  if (out.themes.some((t) => t !== "light" && t !== "dark")) throw new Error("--themes takes light, dark or both.");
  if (!Number.isInteger(out.tabStops) || out.tabStops < 1) throw new Error("--tab-stops takes a whole number of 1 or more.");
  return out;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.build) {
    const built = spawnSync(process.execPath, [path.join(root, "apps", "dashboard", "build.mjs")], { stdio: "inherit" });
    if (built.status !== 0) throw new Error("The dashboard build failed.");
  }
  if (!existsSync(path.join(root, "apps", "dashboard", "dist", "index.html"))) throw new Error("The dashboard is not built. Run: npm run build:dashboard");
  const playwright = findPlaywright(root);
  if (playwright === null) throw new Error("Playwright was not found. Set PLAYWRIGHT_DIR. See the install steps in tools/mobile/ios-webkit.mjs.");

  const server = await serveDashboard(root, opts.port);
  const browser = await playwright.chromium.launch();
  const all = [];
  let checked = 0;
  try {
    // The pages to check are read from the built menu and hub, so a page or tool added later is covered without a change here.
    const probe = await openPage(browser, server.url, { viewport: { width: 1280, height: 800 } });
    await loadSample(probe.page);
    const routes = opts.routes ?? (await discoverRoutes(probe.page)).filter((r) => r !== "#/start");
    await probe.context.close();

    for (const theme of opts.themes) {
      for (const width of opts.widths) {
        const touch = width <= TOUCH_MAX;
        const { context, page } = await openPage(browser, server.url, {
          viewport: { width, height: 800 },
          colorScheme: theme,
          ...(touch ? { isMobile: true, hasTouch: true } : {}),
        });
        try {
          await showTheme(page, theme);
          const visit = async (hash, label) => {
            await page.evaluate((h) => {
              location.hash = h;
            }, hash);
            await page.mouse.move(0, 0);
            await settle(page);
            await page.waitForTimeout(300);
            const { found, facts } = await auditPage(page, { touch, tabLimit: opts.tabStops });
            checked++;
            const where = `${hash}${label} [${theme} ${width}]`;
            for (const finding of found) all.push({ where, route: hash, finding });
            return facts;
          };
          await visit("#/start", " (no data)");
          await loadSample(page);
          const titles = new Map();
          for (const hash of routes) {
            const facts = await visit(hash, "");
            if (titles.has(facts.title) && facts.title !== "") all.push({ where: `${hash} [${theme} ${width}]`, route: hash, finding: { check: "missing-title", sel: "title", text: facts.title, detail: `the same title as ${titles.get(facts.title)}, so the two pages cannot be told apart` } });
            titles.set(facts.title, hash);
          }
        } finally {
          await context.close();
        }
      }
    }
  } finally {
    await browser.close();
    server.stop();
  }

  const lines = summarize(all);
  const report = [...lines, "", `${checked} pages checked, ${all.length} findings${lines.length === all.length ? "" : ` (${lines.length} different)`}.`].join("\n");
  console.log(report);
  if (opts.out) writeFileSync(opts.out, report + "\n");
  process.exit(all.length > 0 ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
