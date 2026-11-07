/**
 * What each view builds, checked in a small fake DOM: every page has its icon chip and one h1,
 * category pages carry their scope class, the key components appear, no element has an inline
 * style or event-handler attribute, every graphic is decorative, and every symbol a view uses
 * exists in the sprite. Synthetic sample data only.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Actions } from "../src/actions.ts";
import { common, guide, overview, routes, start } from "../src/copy.ts";
import { initialState } from "../src/reducer.ts";
import type { State } from "../src/reducer.ts";
import { Scope, runInScope } from "../src/reactive.ts";
import { buildSampleWorkspace } from "../src/sample.ts";
import { createStore } from "../src/store.ts";
import type { View } from "../src/views/context.ts";
import { FakeElement, installFakeDom } from "./fake-dom.ts";

// The license texts come from a virtual module the build provides.
vi.mock("snappy:licenses", () => ({ licenses: [{ name: "Example", license: "MIT", copyright: "Example authors", text: "License text." }] }));

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const sprite = readFileSync(path.join(root, "brand", "icons", "icons.svg"), "utf8");
const symbolIds = new Set([...sprite.matchAll(/<symbol id="([\w-]+)"/g)].map((m) => m[1] as string));

let sampleState: State;
let emptyState: State;
const views: Record<string, View> = {};

beforeAll(async () => {
  installFakeDom();
  const sample = await buildSampleWorkspace();
  sampleState = { ...initialState(), sample };
  emptyState = initialState();
  const load = async <T>(file: string): Promise<T> => (await import(`../src/views/${file}.ts`)) as T;
  const [ov, fi, cl, me, gu, pr, se, st] = await Promise.all([
    load<{ overviewView: View }>("overview"),
    load<{ disappearedView: View; requestsView: View; quietView: View }>("findings"),
    load<{ cleanupView: View }>("cleanup"),
    load<{ memoriesView: View }>("memories"),
    load<{ guideView: View }>("guide"),
    load<{ privacyView: View }>("privacy"),
    load<{ settingsView: View }>("settings"),
    load<{ startView: View }>("start"),
  ]);
  Object.assign(views, {
    overview: ov.overviewView,
    disappeared: fi.disappearedView,
    requests: fi.requestsView,
    quiet: fi.quietView,
    cleanup: cl.cleanupView,
    memories: me.memoriesView,
    guide: gu.guideView,
    privacy: pr.privacyView,
    settings: se.settingsView,
    start: st.startView,
  });
});

function render(name: string, state: State): FakeElement {
  const view = views[name];
  if (!view) throw new Error(`no view ${name}`);
  const store = createStore(state);
  return runInScope(new Scope(true), () => view({ store, actions: {} as Actions })) as unknown as FakeElement;
}

const has = (el: FakeElement, cls: string): boolean => el.classList.contains(cls);
const all = (el: FakeElement, selector: string): FakeElement[] => el.querySelectorAll(selector);

const CATEGORY_VIEWS = { disappeared: "disappeared", requests: "requests", quiet: "quiet", cleanup: "cleanup", memories: "memories" } as const;
const ALL_VIEWS = ["overview", "disappeared", "requests", "quiet", "cleanup", "memories", "guide", "privacy", "settings", "start"] as const;

describe.each([
  ["with sample data", () => sampleState],
  ["with no export yet", () => emptyState],
])("every view %s", (_label, getState) => {
  it.each(ALL_VIEWS)("%s: one h1, an icon chip in the header, and no inline styles or handler attributes", (name) => {
    const el = render(name, getState());
    expect(has(el, "view")).toBe(true);
    const h1s = all(el, "h1");
    expect(h1s).toHaveLength(1);
    expect(h1s[0]?.getAttribute("id")).toBe("page-title");
    expect(h1s[0]?.getAttribute("tabindex")).toBe("-1");
    const header = all(el, "header")[0];
    expect(header, "page header").toBeDefined();
    expect(all(header as FakeElement, ".chip-icon").length, "icon chip in header").toBe(1);
    for (const node of el.descendants()) {
      expect(node.hasAttribute("style"), `${node.tagName}.${node.className} has a style attribute`).toBe(false);
      for (const attr of node.attrs.keys()) expect(attr, `${node.tagName} handler attribute`).not.toMatch(/^on/i);
    }
  });

  it.each(ALL_VIEWS)("%s: every graphic is decorative and points at a symbol in the sprite", (name) => {
    const el = render(name, getState());
    const svgs = all(el, "svg");
    expect(svgs.length).toBeGreaterThan(0);
    for (const svg of svgs) {
      expect(svg.getAttribute("aria-hidden")).toBe("true");
      expect(svg.getAttribute("focusable")).toBe("false");
      const use = svg.childNodes[0] as FakeElement;
      const href = use.getAttribute("href") ?? "";
      expect(href).toMatch(/^#(i|g|conf)-|^#logo-mark$/);
      expect(symbolIds.has(href.slice(1)), `symbol ${href}`).toBe(true);
    }
  });
});

describe("category pages", () => {
  it.each(Object.entries(CATEGORY_VIEWS))("%s carries its scope class and heading", (name, id) => {
    const el = render(name, sampleState);
    expect(has(el, `cat-${id}`)).toBe(true);
    const header = all(el, "header")[0] as FakeElement;
    expect(has(header, `cat-${id}`)).toBe(true);
    expect(all(el, "h1")[0]?.textContent).toBe(routes[name as keyof typeof routes].title);
  });

  it("gives each finding page a left bar, tag-free rows and a quiet note", () => {
    for (const name of ["disappeared", "requests", "quiet"]) {
      const el = render(name, sampleState);
      const rows = all(el, "li.candidate");
      expect(rows.length, name).toBeGreaterThan(0);
      for (const row of rows) {
        expect(has(row, "bar-left")).toBe(true);
        expect(all(row, ".cat-tag"), "no category tag on single-category pages").toHaveLength(0);
      }
      const notes = all(el, ".notice-info");
      expect(notes.length).toBeGreaterThan(0);
      for (const note of notes) expect(has(note, "notice-quiet")).toBe(true);
    }
  });

  it("shows the changes since the last export as one short list of facts, the first one in the area's color", () => {
    const rows = all(render("disappeared", sampleState), "dl.facts .fact");
    expect(rows).toHaveLength(4);
    expect(has(rows[0] as FakeElement, "cat-disappeared")).toBe(true);
    for (const row of rows.slice(1)) expect(has(row, "cat-neutral")).toBe(true);
  });

  it("tags every cleanup row with its own category, icon and label", () => {
    const el = render("cleanup", sampleState);
    const rows = all(el, "li.candidate");
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const tag = all(row, ".cat-tag")[0];
      expect(tag, "category tag").toBeDefined();
      expect(all(tag as FakeElement, "svg")).toHaveLength(1);
      expect(tag?.textContent.length).toBeGreaterThan(3);
      expect([...row.classList.contains("cat-disappeared") ? ["x"] : [], ...row.classList.contains("cat-requests") ? ["x"] : [], ...row.classList.contains("cat-quiet") ? ["x"] : []]).toHaveLength(1);
    }
    // Two notices at most: what protects people, and what removing cannot undo.
    const notices = all(el, ".notice");
    expect(notices.length).toBeGreaterThan(0);
    expect(notices.length).toBeLessThanOrEqual(2);
  });

  it("shows the Memories counts as stone stat cards, and no section heading has an icon chip", () => {
    const el = render("memories", sampleState);
    const cards = all(el, ".stat-card");
    expect(cards.length).toBeGreaterThanOrEqual(6);
    for (const card of cards) expect(has(card, "cat-memories")).toBe(true);
    // Page headers carry no illustration, so the lead has the same width as every paragraph below it.
    expect(all(el, "svg.spot")).toHaveLength(0);
    // One style for every section heading: plain text, in every view.
    expect(all(el, "h2.section-title .chip-icon")).toHaveLength(0);
  });

  it("draws an illustration in every empty state", () => {
    for (const name of ["overview", "disappeared", "requests", "quiet", "cleanup", "memories"]) {
      const el = render(name, emptyState);
      const empty = all(el, ".empty")[0];
      expect(empty, `${name} empty state`).toBeDefined();
      expect(all(empty as FakeElement, "svg.spot"), `${name} spot`).toHaveLength(1);
      expect(has(empty as FakeElement, "empty-spot")).toBe(true);
    }
  });
});

describe("Overview", () => {
  it("shows five finding cards in order, each a link with its icon tile, figure and unit", () => {
    const el = render("overview", sampleState);
    const cards = all(el, "a.finding");
    expect(cards.map((c) => c.getAttribute("href"))).toEqual(["#/disappeared", "#/requests", "#/quiet", "#/cleanup", "#/memories"]);
    expect(cards.map((c) => [...["disappeared", "requests", "quiet", "cleanup", "memories"].filter((id) => has(c, `cat-${id}`))][0])).toEqual(["disappeared", "requests", "quiet", "cleanup", "memories"]);
    for (const card of cards) {
      expect(all(card, ".chip-icon")).toHaveLength(1);
      expect(all(card, "h3")[0]?.textContent.length).toBeGreaterThan(3);
      expect(all(card, ".finding-figure")[0]?.textContent).toMatch(/^[\d,]+$/);
      expect(all(card, ".finding-unit")[0]?.textContent.length).toBeGreaterThan(3);
    }
  });

  it("shows three neutral stat cards and a collapsible health group", () => {
    const el = render("overview", sampleState);
    const stats = all(el, "dl.stats .stat-card");
    expect(stats).toHaveLength(3);
    for (const card of stats) expect(has(card, "cat-neutral")).toBe(true);
    const group = all(el, "details.health-group")[0];
    expect(group, "health group").toBeDefined();
    const badges = all(group as FakeElement, ".badge");
    for (const badge of badges) {
      expect(all(badge, "svg")).toHaveLength(1);
      expect(badge.textContent).toMatch(/\d+ (error|warning|note)/);
    }
    expect(all(group as FakeElement, "summary h2")[0]?.textContent).toBe(overview.healthHeading);
  });

  it("shows either a figure or a plain status on a card, never both", () => {
    const el = render("overview", sampleState);
    const first = all(el, "a.finding")[0] as FakeElement;
    expect(all(first, ".finding-figure").length + all(first, ".finding-status").length).toBe(1);
  });

  it("builds every finding as a tile with the same five parts in the same order, so the grid can line them up", () => {
    const el = render("overview", sampleState);
    const grid = all(el, ".tiles-findings")[0] as FakeElement;
    expect(grid, "findings grid").toBeDefined();
    const tiles = all(grid, "a.tile");
    expect(tiles).toHaveLength(5);
    for (const tile of tiles) {
      // icon tile, title, number, description, action: the rows the subgrid shares across a row of tiles
      expect((tile.childNodes.filter((n): n is FakeElement => n instanceof FakeElement)).map((c) => c.classList.contains("chip-icon") ? "icon" : c.tagName === "h3" ? "title" : c.classList.contains("finding-figure") ? "figure" : c.classList.contains("finding-text") ? "text" : c.classList.contains("tile-action") ? "action" : "?")).toEqual(["icon", "title", "figure", "text", "action"]);
      expect(all(tile, ".tile-action")[0]?.textContent).toBe(overview.openFinding);
    }
  });

  it("shows its counts in a stat grid of tiles, each with its icon tile above its one-line label", () => {
    const el = render("overview", sampleState);
    const grid = all(el, "dl.tiles-stats")[0] as FakeElement;
    expect(grid, "stat grid").toBeDefined();
    const tiles = all(grid, ".tile");
    expect(tiles).toHaveLength(3);
    for (const tile of tiles) {
      expect(all(tile, "dt .chip-icon")).toHaveLength(1);
      expect(all(tile, "dd.stat-value")).toHaveLength(1);
    }
  });
});

describe("Start", () => {
  it("builds the hero with the title chip and the trust pills, and no illustration", () => {
    const el = render("start", emptyState);
    const hero = all(el, "header.hero")[0] as FakeElement;
    expect(all(hero, "svg.spot")).toHaveLength(0);
    expect(all(hero, ".trust-row .pill").map((p) => p.textContent)).toEqual([...start.trustChips]);

    for (const pill of all(hero, ".trust-row .pill")) expect(all(pill, "svg")).toHaveLength(1);
  });

  it("numbers the three steps with a decorative badge and a screen-reader prefix", () => {
    const el = render("start", emptyState);
    const steps = all(el, ".step-list section.step-card");
    expect(steps).toHaveLength(3);
    steps.forEach((step, i) => {
      expect(all(step, ".step-num")[0]?.getAttribute("aria-hidden")).toBe("true");
      expect(all(step, ".step-num")[0]?.textContent).toBe(String(i + 1));
      expect(all(step, ".sr-only")[0]?.textContent).toBe(common.stepPrefix(i + 1));
    });
    expect(steps.map((s) => all(s, "h2")[0]?.textContent)).toEqual([`${common.stepPrefix(1)}${start.exportHeading}`, `${common.stepPrefix(2)}${start.countHeading}`, `${common.stepPrefix(3)}${start.addHeading}`]);
  });
});

describe("Export guide", () => {
  it("shows the select column as pills with an icon and the cell's words, and the after-steps as cards", () => {
    const el = render("guide", sampleState);
    const pills = all(el, "td .pill");
    expect(pills.map((p) => [...p.classList.contains("pill-yes") ? ["yes"] : [], ...p.classList.contains("pill-optional") ? ["optional"] : [], ...p.classList.contains("pill-no") ? ["no"] : []][0])).toEqual([...guide.tickKinds]);
    for (const pill of pills) {
      expect(all(pill, "svg")).toHaveLength(1);
      expect(pill.textContent.length).toBeGreaterThan(1);
    }
    expect(all(el, "ol.step-list li.step-card")).toHaveLength(guide.afterSteps.length);
    expect(all(el, "svg.spot")).toHaveLength(0);
  });
});

describe("Privacy and Settings", () => {
  it("has no illustration, and gives no section heading an icon chip", () => {
    const el = render("privacy", sampleState);
    expect(all(el, ".seal-icon")).toHaveLength(0);
    expect(all(el, "svg.spot")).toHaveLength(0);
    expect(all(el, "h2.section-title .chip-icon")).toHaveLength(0);
    expect(all(el, "h2.section-title").length).toBeGreaterThanOrEqual(4);
  });

  it("gives no Settings section heading an icon chip", () => {
    const el = render("settings", sampleState);
    expect(all(el, "h2.section-title .chip-icon")).toHaveLength(0);
    expect(all(el, "h2.section-title").length).toBeGreaterThanOrEqual(3);
  });
});
