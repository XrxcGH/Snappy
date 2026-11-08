/**
 * The router puts a new page at the top and returns to where a page was scrolled to when the person goes Back or Forward to
 * it. The position map is session memory only. A fake window, history and location stand in for the browser: the history
 * keeps a list of entries with their states, so a link click (a new entry with no state) and Back or Forward (an old entry
 * with the state the router left on it) behave as they do in a browser.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createActions } from "../src/actions.ts";
import { initialState } from "../src/reducer.ts";
import { startRouter } from "../src/router.ts";
import type { Router } from "../src/router.ts";
import { createStore } from "../src/store.ts";
import type { VaultStore } from "../src/vault.ts";
import { testTerminal } from "./terminal-fixture.ts";
import { FakeElement, installFakeDom } from "./fake-dom.ts";

vi.mock("snappy:licenses", () => ({ licenses: [{ name: "Example", license: "MIT", copyright: "Example authors", text: "License text." }] }));

const noVault: VaultStore = { supported: () => false, read: async () => null, write: async () => {}, clear: async () => {} };

interface Entry {
  hash: string;
  state: unknown;
}

interface Browser {
  scrollY: number;
  scrolls: number[];
  entries: Entry[];
  at: number;
  restoration: string;
  listeners: Map<string, ((e?: unknown) => void)[]>;
  /** The person scrolls the page that is showing. */
  scrollTo(y: number): void;
  /** A link click or a typed address: a new entry with no state. */
  click(hash: string): void;
  back(): void;
  forward(): void;
}

let browser: Browser;
let router: Router;
let titles: string[];

const emit = (type: string): void => {
  for (const fn of browser.listeners.get(type) ?? []) fn();
};

function createBrowser(): Browser {
  const b: Browser = {
    scrollY: 0,
    scrolls: [],
    entries: [{ hash: "#/start", state: null }],
    at: 0,
    restoration: "auto",
    listeners: new Map(),
    scrollTo(y) {
      b.scrollY = y;
      emit("scroll");
    },
    click(hash) {
      b.entries.splice(b.at + 1, Infinity, { hash, state: null });
      b.at++;
      emit("hashchange");
    },
    back() {
      b.at--;
      emit("hashchange");
    },
    forward() {
      b.at++;
      emit("hashchange");
    },
  };
  const g = globalThis as Record<string, unknown>;
  g.window = {
    addEventListener: (type: string, fn: () => void) => void b.listeners.set(type, [...(b.listeners.get(type) ?? []), fn]),
    removeEventListener: (type: string, fn: () => void) => void b.listeners.set(type, (b.listeners.get(type) ?? []).filter((l) => l !== fn)),
    get scrollY() {
      return b.scrollY;
    },
    // What the router asks for, as the browser would do it (and the scroll event follows).
    scrollTo: (_x: number, y: number) => {
      b.scrolls.push(y);
      b.scrollY = y;
    },
  };
  g.location = {
    get hash() {
      return b.entries[b.at]?.hash ?? "";
    },
  };
  g.history = {
    get state() {
      return b.entries[b.at]?.state;
    },
    replaceState: (state: unknown, _title: string, url?: string) => {
      const entry = b.entries[b.at] as Entry;
      entry.state = state;
      if (url !== undefined) entry.hash = url;
    },
    set scrollRestoration(value: string) {
      b.restoration = value;
    },
    get scrollRestoration() {
      return b.restoration;
    },
  };
  return b;
}

beforeAll(() => {
  installFakeDom();
});

beforeEach(() => {
  browser = createBrowser();
  const store = createStore(initialState());
  const actions = createActions(store, { vault: noVault, clock: () => 0, yieldToUi: async () => {}, saveTheme: () => {} });
  const outlet = new FakeElement("div");
  titles = [];
  router = startRouter(outlet as unknown as HTMLElement, { store, actions, terminal: testTerminal() }, () => void titles.push(browser.entries[browser.at]?.hash ?? ""));
});

describe("scroll position", () => {
  it("opens the first page and every page reached by a link at the top", () => {
    expect(browser.scrolls).toEqual([0]);
    browser.scrollTo(1200);
    browser.click("#/overview");
    expect(browser.scrollY).toBe(0);
    expect(titles).toEqual(["#/start", "#/overview"]);
  });

  it("returns to where a page was scrolled to on Back, and to the other page's place on Forward", () => {
    browser.scrollTo(1200);
    browser.click("#/cleanup");
    browser.scrollTo(300);
    browser.click("#/overview");
    expect(browser.scrollY).toBe(0);

    browser.back();
    expect(browser.entries[browser.at]?.hash).toBe("#/cleanup");
    expect(browser.scrollY).toBe(300);

    browser.back();
    expect(browser.scrollY).toBe(1200);

    browser.forward();
    expect(browser.scrollY).toBe(300);
  });

  it("does not restore on a link click to a page that was visited before", () => {
    browser.click("#/cleanup");
    browser.scrollTo(800);
    browser.click("#/overview");
    browser.click("#/cleanup");
    expect(browser.scrollY).toBe(0);
  });

  it("returns to the top of a page that was never scrolled when Forward reaches it", () => {
    browser.scrollTo(500);
    browser.click("#/overview");
    browser.back();
    expect(browser.scrollY).toBe(500);
    // The overview was never scrolled, so Forward shows its top.
    browser.forward();
    expect(browser.scrollY).toBe(0);
  });

  it("takes over scroll restoration from the browser, and stops listening when stopped", () => {
    expect(browser.restoration).toBe("manual");
    router.stop();
    expect(browser.listeners.get("hashchange")).toEqual([]);
    expect(browser.listeners.get("scroll")).toEqual([]);
  });

  it("keeps the positions in memory only: nothing is written to storage", () => {
    const touched: string[] = [];
    (globalThis as Record<string, unknown>).localStorage = new Proxy({}, { get: (_t, key) => (touched.push(String(key)), undefined) });
    browser.scrollTo(900);
    browser.click("#/overview");
    browser.back();
    expect(touched).toEqual([]);
    delete (globalThis as Record<string, unknown>).localStorage;
  });
});
