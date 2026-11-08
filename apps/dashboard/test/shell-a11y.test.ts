/**
 * Keyboard and screen reader behavior of the app shell: Escape closes the phone menu from the Menu button, and the header
 * toggle has one fixed name.
 * Rendered in the small fake DOM. Synthetic data only.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createActions } from "../src/actions.ts";
import type { Actions } from "../src/actions.ts";
import { announce } from "../src/announce.ts";
import { buildShell, followTheme } from "../src/app-shell.ts";
import { settings, shell } from "../src/copy.ts";
import { shellCopy } from "../src/copy-shell.ts";
import { initialState } from "../src/reducer.ts";
import { Scope, runInScope } from "../src/reactive.ts";
import { createStore } from "../src/store.ts";
import type { Store } from "../src/store.ts";
import type { VaultStore } from "../src/vault.ts";
import { testTerminal } from "./terminal-fixture.ts";
import { FakeElement, installFakeDom } from "./fake-dom.ts";

vi.mock("snappy:licenses", () => ({ licenses: [{ name: "Example font", license: "OFL-1.1", copyright: "Example authors", text: "License text." }] }));
vi.mock("../src/announce.ts", () => ({ announce: vi.fn() }));

const noVault: VaultStore = { supported: () => false, read: async () => null, write: async () => {}, clear: async () => {} };

let dom: ReturnType<typeof installFakeDom>;

beforeAll(() => {
  dom = installFakeDom();
});

beforeEach(() => {
  vi.mocked(announce).mockClear();
  FakeElement.lastFocused = null;
  const g = globalThis as Record<string, unknown>;
  g.window = { addEventListener: () => {}, removeEventListener: () => {}, scrollTo: () => {} };
  g.location = { hash: "#/start" };
  g.matchMedia = () => ({ matches: false, addEventListener: () => {} });
  (dom.document as { activeElement: unknown }).activeElement = null;
  (dom.document.documentElement as unknown as FakeElement).setAttribute("data-theme", "dark");
});

afterEach(() => vi.unstubAllGlobals());

function makeActions(store: Store): Actions {
  return createActions(store, { vault: noVault, clock: () => 0, yieldToUi: async () => {}, saveTheme: () => {} });
}

function openShell(): { root: FakeElement; store: Store } {
  const store = createStore(initialState());
  followTheme(store);
  const root = new FakeElement("div");
  buildShell(root as unknown as HTMLElement, { store, actions: makeActions(store), terminal: testTerminal() });
  return { root, store };
}

async function openSettings(): Promise<{ root: FakeElement; store: Store }> {
  const { settingsView } = await import("../src/views/settings.ts");
  const store = createStore(initialState());
  const root = runInScope(new Scope(true), () => settingsView({ store, actions: makeActions(store), terminal: testTerminal() })) as unknown as FakeElement;
  return { root, store };
}

const buttonLabelled = (root: FakeElement, label: string): FakeElement => {
  const found = root.querySelectorAll("button").find((b) => b.textContent === label);
  if (!found) throw new Error(`no button ${label}`);
  return found;
};

describe("the phone menu (A11Y-09)", () => {
  it("closes with Escape from the Menu button, and keeps focus there", () => {
    const { root } = openShell();
    const menu = root.querySelector("button.menu-button") as FakeElement;
    const nav = root.querySelector("nav#site-nav") as FakeElement;
    menu.click();
    expect(nav.dataset.open).toBe("true");
    expect(menu.getAttribute("aria-expanded")).toBe("true");

    menu.fire("keydown", { key: "Escape" });
    expect(nav.dataset.open).toBe("false");
    expect(menu.getAttribute("aria-expanded")).toBe("false");
    expect(FakeElement.lastFocused).toBe(menu);
  });

  it("still closes with Escape inside the menu, and Escape on a closed menu does nothing", () => {
    const { root } = openShell();
    const menu = root.querySelector("button.menu-button") as FakeElement;
    const nav = root.querySelector("nav#site-nav") as FakeElement;
    menu.fire("keydown", { key: "Escape" });
    expect(FakeElement.lastFocused).toBeNull();
    menu.click();
    nav.fire("keydown", { key: "Escape" });
    expect(nav.dataset.open).toBe("false");
    expect(FakeElement.lastFocused).toBe(menu);
  });

  it("other keys do not close it", () => {
    const { root } = openShell();
    const menu = root.querySelector("button.menu-button") as FakeElement;
    menu.click();
    menu.fire("keydown", { key: "Enter" });
    expect((root.querySelector("nav#site-nav") as FakeElement).dataset.open).toBe("true");
  });
});

describe("the header theme toggle (A11Y-13)", () => {
  it("keeps one name whichever theme is on, says the state with aria-pressed, and announces the result", () => {
    const { root, store } = openShell();
    const toggle = root.querySelector("header .theme-toggle") as FakeElement;
    const state = (): [string | null, string | null] => [toggle.getAttribute("aria-label"), toggle.getAttribute("aria-pressed")];
    expect(state()).toEqual([shellCopy.themeToggleName, "true"]);
    toggle.click();
    expect(store.get().theme).toBe("light");
    expect(state()).toEqual([shellCopy.themeToggleName, "false"]);
    expect(announce).toHaveBeenLastCalledWith(shell.themeChangedLight);
    toggle.click();
    expect(state()).toEqual([shellCopy.themeToggleName, "true"]);
    expect(announce).toHaveBeenLastCalledWith(shell.themeChangedDark);
    expect(shellCopy.themeToggleName).toBe("Dark theme");
  });
});
