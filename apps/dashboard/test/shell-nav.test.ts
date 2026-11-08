/**
 * The sidebar's groups. Memories rescue finds nothing to review, so it has its own "Memories" group instead of sitting
 * under Findings, between the findings and the help pages. Every page appears once, and every group has a name.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createActions } from "../src/actions.ts";
import { NAV, buildShell } from "../src/app-shell.ts";
import { routes, shell } from "../src/copy.ts";
import { shellCopy } from "../src/copy-shell.ts";
import { initialState } from "../src/reducer.ts";
import { createStore } from "../src/store.ts";
import type { VaultStore } from "../src/vault.ts";
import { testTerminal } from "./terminal-fixture.ts";
import { FakeElement, installFakeDom } from "./fake-dom.ts";

vi.mock("snappy:licenses", () => ({ licenses: [] }));

let root: FakeElement;

beforeAll(() => {
  installFakeDom();
  const g = globalThis as Record<string, unknown>;
  g.window = { addEventListener: () => {}, removeEventListener: () => {}, scrollTo: () => {} };
  g.location = { hash: "#/start" };
  const noVault: VaultStore = { supported: () => false, read: async () => null, write: async () => {}, clear: async () => {} };
  const store = createStore(initialState());
  const actions = createActions(store, { vault: noVault, clock: () => 0, yieldToUi: async () => {}, saveTheme: () => {} });
  root = new FakeElement("div");
  buildShell(root as unknown as HTMLElement, { store, actions, terminal: testTerminal() });
});

describe("the menu groups", () => {
  it("puts Memories rescue in its own Memories group, after Findings and before the help pages", () => {
    expect(NAV.map((g) => g.label?.text ?? null)).toEqual([null, shell.navFindings, shellCopy.navMemories, shell.navMore]);
    const ids = (label: string): string[] => NAV.find((g) => g.label?.text === label)?.items.map((i) => i.id) ?? [];
    expect(ids(shell.navFindings)).toEqual(["disappeared", "requests", "quiet", "cleanup"]);
    expect(ids(shellCopy.navMemories)).toEqual(["memories"]);
    expect(ids(shell.navMore)).toEqual(["guide", "privacy", "settings"]);
    expect(shellCopy.navMemories.length).toBeLessThanOrEqual(20);
  });

  it("lists every page once, and keeps the Memories color on its icon", () => {
    const all = NAV.flatMap((g) => g.items.map((i) => i.id));
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual(Object.keys(routes).sort());
    const link = root.querySelector('nav a[href="#/memories"]') as FakeElement;
    expect(link.classList.contains("cat-memories")).toBe(true);
    expect(link.textContent).toBe(routes.memories.label);
  });

  it("draws a named list for each group, in order", () => {
    const nav = root.querySelector("nav#site-nav") as FakeElement;
    const lists = nav.querySelectorAll("ul");
    const named = lists.map((ul) => {
      const id = ul.getAttribute("aria-labelledby");
      return id === null ? null : (nav.descendants().find((el) => el.getAttribute("id") === id)?.textContent ?? null);
    });
    expect(named).toEqual([null, shell.navFindings, shellCopy.navMemories, shell.navMore]);
    const memories = lists[2] as FakeElement;
    expect(memories.querySelectorAll("a").map((a) => a.getAttribute("href"))).toEqual(["#/memories"]);
  });
});
