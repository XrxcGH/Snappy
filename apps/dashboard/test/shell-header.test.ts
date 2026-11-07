/**
 * The page frame and what it must never repeat: the header (logo, theme toggle, menu button), the
 * dark default, the toggle and the Settings control sharing one state, no session badge in the
 * header, the legal line once per page, no sentence or note repeated on one page, and no icon
 * left alone on its own line. Rendered in the small fake DOM, with the same router the page uses.
 * Synthetic sample data only.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createActions } from "../src/actions.ts";
import { buildShell, followTheme } from "../src/app-shell.ts";
import type { Shell } from "../src/app-shell.ts";
import { brand, routes, shell as shellCopy } from "../src/copy.ts";
import type { RouteId } from "../src/copy.ts";
import { initialState } from "../src/reducer.ts";
import type { State } from "../src/reducer.ts";
import { buildSampleWorkspace } from "../src/sample.ts";
import { startRouter } from "../src/router.ts";
import type { Router } from "../src/router.ts";
import { createStore } from "../src/store.ts";
import type { Store } from "../src/store.ts";
import type { VaultStore } from "../src/vault.ts";
import { FakeElement, installFakeDom } from "./fake-dom.ts";

vi.mock("snappy:licenses", () => ({ licenses: [{ name: "Example", license: "MIT", copyright: "Example authors", text: "License text." }] }));

const ROUTE_IDS = Object.keys(routes) as RouteId[];
const noVault: VaultStore = { supported: () => false, read: async () => null, write: async () => {}, clear: async () => {} };

interface Page {
  root: FakeElement;
  store: Store;
  saved: string[];
  html: FakeElement;
  go: (id: RouteId) => void;
  shell: Shell;
  router: Router;
}

let sample: Awaited<ReturnType<typeof buildSampleWorkspace>>;
let fakeDocument: { documentElement: FakeElement };
let hashListeners: (() => void)[] = [];
let prefersDark = false;

beforeAll(async () => {
  fakeDocument = installFakeDom().document as unknown as { documentElement: FakeElement };
  sample = await buildSampleWorkspace();
});

beforeEach(() => {
  hashListeners = [];
  prefersDark = false;
  const g = globalThis as Record<string, unknown>;
  g.window = {
    addEventListener: (type: string, fn: () => void) => void (type === "hashchange" && hashListeners.push(fn)),
    removeEventListener: () => {},
    scrollTo: () => {},
  };
  g.location = { hash: "#/start" };
  g.history = { replaceState: () => {} };
  g.matchMedia = () => ({ matches: prefersDark, addEventListener: () => {} });
});

/** A page the way main.ts builds it: shell, router and theme wiring over one store. */
function openPage(state: State = initialState()): Page {
  const store = createStore(state);
  const saved: string[] = [];
  const actions = createActions(store, { vault: noVault, clock: () => 0, yieldToUi: async () => {}, saveTheme: (t) => void saved.push(t) });
  const root = new FakeElement("div");
  const html = fakeDocument.documentElement;
  // The page ships data-theme="dark" in its HTML; the fake page starts the same way.
  html.setAttribute("data-theme", "dark");
  followTheme(store);
  const ctx = { store, actions };
  const shell = buildShell(root as unknown as HTMLElement, ctx);
  const router = startRouter(shell.outlet, ctx, shell.onRoute);
  const go = (id: RouteId): void => {
    (globalThis as { location: { hash: string } }).location.hash = `#/${id}`;
    for (const fn of hashListeners) fn();
  };
  return { root, store, saved, html, go, shell, router };
}

const toggleOf = (page: Page): FakeElement => {
  const toggle = page.root.querySelector("header.site-header .theme-toggle");
  if (!toggle) throw new Error("no theme toggle in the header");
  return toggle;
};
const click = (el: FakeElement): void => {
  for (const fn of el.listeners.get("click") ?? []) fn({});
};
const headerText = (page: Page): string => (page.root.querySelector("header.site-header") as FakeElement).textContent;

describe("header", () => {
  it.each(ROUTE_IDS)("%s: one row with the logo, the theme toggle and the menu button, and no status badge", (id) => {
    const page = openPage({ ...initialState(), sample });
    page.go(id);
    const header = page.root.querySelector("header.site-header") as FakeElement;
    // The band holds one inner row with the shell's width, so the logo and the toggle line up with the page below.
    expect(header.childNodes.filter((n) => n instanceof FakeElement).map((n) => (n as FakeElement).className)).toEqual(["site-header-inner"]);
    const inner = header.querySelector(".site-header-inner") as FakeElement;
    expect(inner.childNodes.filter((n) => n instanceof FakeElement).map((n) => (n as FakeElement).className)).toEqual(["brand", "header-actions"]);
    const actions = header.querySelector(".header-actions") as FakeElement;
    const kinds = actions.childNodes
      .filter((n): n is FakeElement => n instanceof FakeElement)
      .map((k) => (k.classList.contains("theme-toggle") ? "toggle" : k.classList.contains("menu-button") ? "menu" : "other"));
    expect(kinds).toEqual(["toggle", "menu"]);
    const toggle = toggleOf(page);
    expect(toggle.getAttribute("aria-label")).toBe(shellCopy.themeToLight);
    expect(toggle.getAttribute("type")).toBe("button");
    expect(toggle.querySelectorAll("svg")).toHaveLength(1);
    // The session and lock badges are gone from the header on every route.
    expect(header.querySelectorAll(".header-status, .status-pill")).toHaveLength(0);
    expect(headerText(page)).not.toMatch(/session only|nothing is saved|saved data is locked|sealed on this device|sealed history on/i);
  });

  it("is dark on a first visit, whatever the device prefers", () => {
    expect(initialState().theme).toBe("dark");
    prefersDark = false;
    const page = openPage();
    expect(page.html.getAttribute("data-theme")).toBe("dark");
    expect(toggleOf(page).getAttribute("aria-label")).toBe(shellCopy.themeToLight);
    prefersDark = true;
    const again = openPage();
    expect(again.html.getAttribute("data-theme")).toBe("dark");
  });

  it("switches the theme attribute, the icon and the accessible name when pressed, and says the current theme", () => {
    const page = openPage();
    const toggle = toggleOf(page);
    // aria-pressed states the current theme: pressed means the dark theme is on.
    const state = (): string | null => toggle.getAttribute("aria-pressed");
    expect(state()).toBe("true");
    expect(toggle.querySelector("use")?.getAttribute("href")).toBe("#i-sun");

    click(toggle);
    expect(page.html.getAttribute("data-theme")).toBe("light");
    expect(toggle.getAttribute("aria-label")).toBe(shellCopy.themeToDark);
    expect(state()).toBe("false");
    expect(toggle.querySelector("use")?.getAttribute("href")).toBe("#i-moon");
    expect(page.saved).toEqual(["light"]);

    click(toggle);
    expect(page.html.getAttribute("data-theme")).toBe("dark");
    expect(toggle.getAttribute("aria-label")).toBe(shellCopy.themeToLight);
    expect(page.saved).toEqual(["light", "dark"]);
  });

  it("shares one state with the Settings control, in both directions", () => {
    const page = openPage();
    page.go("settings");
    const group = (): FakeElement => page.root.querySelector(".segmented-theme") as FakeElement;
    const pressed = (): string[] => group().querySelectorAll("button").filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.textContent);
    expect(group().querySelectorAll("button").map((b) => b.textContent)).toEqual(["Dark", "Light", "Match device"]);
    expect(pressed()).toEqual(["Dark"]);

    click(toggleOf(page));
    expect(pressed()).toEqual(["Light"]);

    const matchDevice = group().querySelectorAll("button")[2] as FakeElement;
    prefersDark = true;
    click(matchDevice);
    expect(page.store.get().theme).toBe("system");
    expect(page.html.hasAttribute("data-theme")).toBe(false);
    expect(pressed()).toEqual(["Match device"]);
    // With "Match device" on a dark device, the toggle offers the light theme.
    expect(toggleOf(page).getAttribute("aria-label")).toBe(shellCopy.themeToLight);

    click(group().querySelectorAll("button")[0] as FakeElement);
    expect(page.html.getAttribute("data-theme")).toBe("dark");
    expect(page.saved).toEqual(["light", "system", "dark"]);
  });
});

describe("session and sealed-history status", () => {
  it("shows the session-only note on Start and in Settings, and nowhere else", () => {
    const page = openPage({ ...initialState(), sample });
    const where: RouteId[] = [];
    for (const id of ROUTE_IDS) {
      page.go(id);
      if (/not saved/i.test((page.shell.outlet as unknown as FakeElement).textContent)) where.push(id);
    }
    expect(where).toEqual(["start", "settings"]);
  });

  it("shows 'Sealed history on' on Settings only, and only while a sealed history is unlocked", () => {
    const page = openPage({ ...initialState(), sample });
    page.store.dispatch({ type: "vault", patch: { phase: "unlocked", hasSaved: true } });
    const where: RouteId[] = [];
    for (const id of ROUTE_IDS) {
      page.go(id);
      if (page.root.textContent.includes(shellCopy.sealedOn)) where.push(id);
    }
    expect(where).toEqual(["settings"]);
    page.store.dispatch({ type: "vault", patch: { phase: "session", hasSaved: false } });
    page.go("settings");
    expect(page.root.textContent).not.toContain(shellCopy.sealedOn);
  });
});

describe("sample-data strip", () => {
  it("is one slim line with a short Clear button that is named for what it clears", () => {
    const page = openPage({ ...initialState(), sample });
    const strip = page.root.querySelector(".banner-slim") as FakeElement;
    expect(strip).not.toBeNull();
    expect(strip.querySelectorAll("p")).toHaveLength(1);
    const clear = strip.querySelector("button") as FakeElement;
    expect(clear.textContent).toBe("Clear");
    expect(clear.getAttribute("aria-label")).toBe(shellCopy.clearSample);
    // The long words show from 640 px, the short words below it; the stylesheet swaps them.
    expect(strip.textContent).toBe(`${shellCopy.sampleStrip}${shellCopy.sampleStripShort}Clear`);
    expect(strip.querySelectorAll(".banner-long")).toHaveLength(1);
    expect(strip.querySelectorAll(".banner-short")).toHaveLength(1);
    expect(page.root.querySelector(".banner-slim")).not.toBeNull();
    expect(openPage().root.querySelector(".banner-slim")).toBeNull();
  });
});

/** Text of the blocks people read, one entry per block, skipping blocks that only wrap other blocks. */
/**
 * One row per person is data, not prose: its evidence sentences come from core and repeat a caveat
 * for each person (with different dates). The rows are left out; everything around them is checked.
 */
const inPersonRow = (el: FakeElement): boolean => {
  for (let n: FakeElement | null = el; n; n = n.parentNode) if (n.classList.contains("candidate") || n.classList.contains("guided-row")) return true;
  return false;
};
const BLOCK_TAGS = new Set(["p", "li", "td", "th", "h1", "h2", "h3", "h4", "summary", "dt", "dd", "label"]);
function blockTexts(root: FakeElement): string[] {
  const out: string[] = [];
  for (const el of root.descendants()) {
    if (!BLOCK_TAGS.has(el.tagName) || inPersonRow(el)) continue;
    if (el.descendants().some((d) => BLOCK_TAGS.has(d.tagName))) continue;
    const text = el.textContent.replace(/\s+/g, " ").trim();
    if (text !== "") out.push(text);
  }
  return out;
}

const wordCount = (s: string): number => s.split(/\s+/).filter(Boolean).length;
const sentencesOf = (text: string): string[] => text.split(/(?<=[.?!])\s+/).map((s) => s.trim()).filter(Boolean);

describe("one page, no repeats", () => {
  const states: [string, () => State][] = [
    ["with sample data", () => ({ ...initialState(), sample })],
    ["with no export yet", () => initialState()],
  ];

  describe.each(states)("%s", (_label, getState) => {
    it.each(ROUTE_IDS)("%s: the legal line appears once", (id) => {
      const page = openPage(getState());
      page.go(id);
      const count = page.root.textContent.split(brand.nonAffiliation).length - 1;
      expect(count, `${id}: legal line count`).toBe(1);
      expect(page.root.querySelector("footer.site-footer")?.textContent).toContain(brand.nonAffiliation);
    });

    it.each(ROUTE_IDS)("%s: no sentence of more than 8 words appears twice", (id) => {
      const page = openPage(getState());
      page.go(id);
      const seen = new Map<string, number>();
      const blocks = blockTexts(page.root);
      expect(blocks.length, "the page has text to check").toBeGreaterThan(5);
      for (const block of blocks) {
        for (const sentence of sentencesOf(block)) {
          if (wordCount(sentence) <= 8) continue;
          const key = sentence.toLowerCase();
          seen.set(key, (seen.get(key) ?? 0) + 1);
        }
      }
      expect([...seen].filter(([, n]) => n > 1).map(([s]) => s)).toEqual([]);
    });

    it.each(ROUTE_IDS)("%s: no two notices say the same thing, and at most two notices above the fold", (id) => {
      const page = openPage(getState());
      page.go(id);
      const outlet = page.shell.outlet as unknown as FakeElement;
      const notices = outlet.querySelectorAll(".notice");
      const texts = notices.map((n) => (n.querySelector(".notice-text") as FakeElement).textContent.replace(/\s+/g, " ").trim().toLowerCase());
      expect(new Set(texts).size, texts.join(" | ")).toBe(texts.length);
      // Above the fold: the notices that come before the first section heading.
      let early = 0;
      for (const el of outlet.descendants()) {
        if (el.tagName === "h2") break;
        if (el.classList.contains("notice")) early++;
      }
      expect(early).toBeLessThanOrEqual(2);
    });

    it.each(ROUTE_IDS)("%s: no icon sits alone on its own line", (id) => {
      const page = openPage(getState());
      page.go(id);
      const alone: string[] = [];
      for (const svg of page.root.querySelectorAll("svg")) {
        const cls = svg.getAttribute("class") ?? "";
        if (cls.includes("spot") || cls.includes("logo-mark") || cls.includes("sprite")) continue; // deliberate illustrations
        // An icon tile sits inside its heading or label: the row is whatever holds the tile.
        let row = svg.parentNode;
        if (row?.classList.contains("chip-icon")) row = row.parentNode;
        // The chevron at the end of a finding row belongs to a link that has its own words.
        if (row?.classList.contains("card-open")) continue;
        if (!row) continue;
        const text = row.textContent.trim();
        const named = row.tagName === "button" && (row.getAttribute("aria-label") ?? "") !== "";
        // A heading's chip sits inside the heading, so the heading's text is the row's text.
        if (text === "" && !named) alone.push(`${row.tagName}.${row.className}`);
      }
      expect(alone).toEqual([]);
    });
  });
});
