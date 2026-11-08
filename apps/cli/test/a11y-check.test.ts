/**
 * The accessibility check in tools/a11y-check. The option reading is tested always. The measuring needs a browser, so
 * those tests run when Playwright can be found (set PLAYWRIGHT_DIR) and are skipped otherwise, as CI has no browser
 * installed. Each of them draws a small page that has the fault and expects the check to name it, and draws a clean
 * page and expects silence, so a check that stopped looking would fail here.
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const load = (name: string): Promise<any> => import(pathToFileURL(path.join(repo, "tools", "a11y-check", name)).href); // eslint-disable-line @typescript-eslint/no-explicit-any

interface Finding {
  check: string;
  sel: string;
  text: string;
  detail: string;
}

describe("option reading", () => {
  it("has the defaults the header describes", async () => {
    const { parseArgs } = await load("check.mjs");
    expect(parseArgs([])).toMatchObject({ widths: [360, 1280], themes: ["light", "dark"], tabStops: 60, routes: undefined, build: false });
  });

  it("reads routes with or without a leading hash and slash", async () => {
    const { parseArgs } = await load("check.mjs");
    expect(parseArgs(["--routes", "start,#/tools,/tools/friends-table"]).routes).toEqual(["#/start", "#/tools", "#/tools/friends-table"]);
  });

  it("refuses an unknown option, a missing value and nonsense numbers", async () => {
    const { parseArgs } = await load("check.mjs");
    expect(() => parseArgs(["--axe"])).toThrow(/Unknown option/);
    expect(() => parseArgs(["--widths"])).toThrow(/needs a value/);
    expect(() => parseArgs(["--widths", "wide"])).toThrow(/pixel widths/);
    expect(() => parseArgs(["--themes", "sepia"])).toThrow(/light, dark/);
    expect(() => parseArgs(["--tab-stops", "0"])).toThrow(/whole number/);
  });

  it("reports a finding repeated on many pages once, with where it was seen", async () => {
    const { summarize } = await load("lib.mjs");
    const finding = { check: "text-contrast", sel: "p.note", text: "Hi", detail: "3.10:1 is under 4.5:1 (16px)" };
    const lines: string[] = summarize([
      { where: "#/a [light 360]", route: "#/a", finding },
      { where: "#/b [light 360]", route: "#/b", finding: { ...finding, detail: "3.20:1 is under 4.5:1 (16px)" } },
      { where: "#/b [dark 360]", route: "#/b", finding: { ...finding, check: "small-target" } },
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("(2 places, 2 pages)");
    expect(lines[0]).toContain("#/a [light 360]");
  });
});

const GOOD = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Fine page</title>
<style>
  body { background: #fff; color: #111; font: 16px/1.5 sans-serif; margin: 8px; }
  a, button, input { min-height: 44px; min-width: 44px; display: inline-block; box-sizing: border-box; }
  :focus-visible { outline: 2px solid #111; outline-offset: 2px; }
</style></head><body>
<h1>Page</h1>
<button>Save</button> <a href="#x">Next page</a>
<label>Name <input type="text"></label>
<button aria-label="Close"><svg width="10" height="10" aria-hidden="true"></svg></button>
<p>Some text with <a href="#y" style="min-height:0;min-width:0;display:inline">an inline link</a> in it.</p>
</body></html>`;

const BAD = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<style>
  body { background: #fff; color: #111; font: 16px/1.5 sans-serif; }
  * { outline: none !important; }
  .faint { color: #bbb; }
</style></head><body>
<h1>One</h1><h1>Two</h1>
<button></button>
<a href="#x" tabindex="3">Go</a>
<p class="faint">Faint text on white</p>
<button style="width:20px;height:20px">x</button>
<button>Plain</button>
</body></html>`;

describe("measuring", async () => {
  const lib = await load("lib.mjs");
  const inpage = await load("inpage.mjs");
  const playwright = lib.findPlaywright(repo);
  let browser: any; // eslint-disable-line @typescript-eslint/no-explicit-any

  beforeAll(async () => {
    if (playwright !== null) browser = await playwright.chromium.launch();
  }, 60_000);
  afterAll(async () => {
    await browser?.close();
  });

  const checksOf = (found: Finding[]): string[] => [...new Set(found.map((f) => f.check))].sort();
  async function audit(html: string): Promise<Finding[]> {
    const page = await browser.newPage({ viewport: { width: 360, height: 700 }, hasTouch: true, isMobile: true });
    try {
      await page.setContent(html);
      return (await lib.auditPage(page, { touch: true, minTarget: 44, tabLimit: 20 })).found;
    } finally {
      await page.close();
    }
  }

  it.skipIf(playwright === null)("is silent on a page that has none of the faults", async () => {
    expect(await audit(GOOD)).toEqual([]);
  }, 60_000);

  it.skipIf(playwright === null)("names every kind of fault on a page that has them", async () => {
    const found = await audit(BAD);
    expect(checksOf(found)).toEqual(["h1-count", "missing-title", "no-focus-ring", "positive-tabindex", "small-target", "text-contrast", "unnamed-control"]);
    expect(found.find((f) => f.check === "h1-count")?.detail).toMatch(/2 visible h1/);
    expect(found.find((f) => f.check === "positive-tabindex")?.detail).toMatch(/tabindex=3/);
    expect(found.find((f) => f.check === "text-contrast")?.detail).toMatch(/under 4\.5:1/);
    expect(found.filter((f) => f.check === "small-target").map((f) => f.detail)).toContain("20 by 20 px, under 44");
  }, 60_000);

  it.skipIf(playwright === null)("passes a link inside a sentence, and judges a hidden check box by its label", async () => {
    const html = `<!doctype html><html lang="en"><head><title>T</title><style>body{background:#fff;color:#111;font:16px sans-serif} :focus-visible{outline:2px solid #111;outline-offset:2px}
      label.switch{display:inline-flex;align-items:center;min-height:44px;min-width:44px} label.switch input{position:absolute;opacity:0;width:1px;height:1px}</style></head>
      <body><h1>H</h1><p>Read <a href="#a">the guide</a> first.</p><label class="switch"><input type="checkbox"> Check for updates</label></body></html>`;
    const found = await audit(html);
    expect(found.filter((f) => f.check === "small-target")).toEqual([]);
    expect(found.filter((f) => f.check === "unnamed-control")).toEqual([]);
  }, 60_000);

  it.skipIf(playwright === null)("takes a small visible check box inside a large label as pressed through the label, and flags one with no label", async () => {
    const style = `<style>body{background:#fff;color:#111;font:16px sans-serif} :focus-visible{outline:2px solid #111;outline-offset:2px} label.row{display:flex;align-items:center;gap:8px;min-height:44px}</style>`;
    const ok = await audit(`<!doctype html><html lang="en"><head><title>T</title>${style}</head><body><h1>H</h1><label class="row"><input type="checkbox" style="width:24px;height:24px"> Show it</label></body></html>`);
    expect(ok.filter((f) => f.check === "small-target")).toEqual([]);
    const bad = await audit(`<!doctype html><html lang="en"><head><title>T</title>${style}</head><body><h1>H</h1><input type="checkbox" aria-label="Alone" style="width:24px;height:24px"></body></html>`);
    expect(bad.filter((f) => f.check === "small-target").map((f) => f.detail)).toEqual(["24 by 24 px, under 44"]);
  }, 60_000);

  it.skipIf(playwright === null)("does not measure targets on a wide screen, and reads contrast of large text at 3:1", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
    try {
      await page.setContent(`<!doctype html><html lang="en"><head><title>T</title><style>body{background:#fff;color:#111;font:16px sans-serif} .big{font-size:32px;color:#949494}</style></head>
        <body><h1 class="big">Large and light</h1><button style="width:20px;height:20px" aria-label="x"></button></body></html>`);
      const { found } = await page.evaluate(inpage.auditInPage, { touch: false, minTarget: 44 });
      expect(found).toEqual([]);
    } finally {
      await page.close();
    }
  }, 60_000);
});
