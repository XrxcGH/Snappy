/**
 * A list built through the dom helper says it is a list. Safari and VoiceOver stop treating a list as one when its
 * bullets are removed, and the menu groups, the candidate rows and most other lists of the app have none.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createActions } from "../src/actions.ts";
import { buildShell } from "../src/app-shell.ts";
import { h } from "../src/dom.ts";
import { initialState } from "../src/reducer.ts";
import { createStore } from "../src/store.ts";
import type { VaultStore } from "../src/vault.ts";
import { testTerminal } from "./terminal-fixture.ts";
import { FakeElement, installFakeDom } from "./fake-dom.ts";

vi.mock("snappy:licenses", () => ({ licenses: [{ name: "Example", license: "MIT", copyright: "Example authors", text: "License text." }] }));

beforeAll(() => {
  installFakeDom();
});

describe("lists made through h()", () => {
  it("get role=list, whatever else they carry", () => {
    expect(h("ul").getAttribute("role")).toBe("list");
    expect(h("ul", { class: "nav-group", "aria-labelledby": "x" }, h("li", {}, "one")).getAttribute("role")).toBe("list");
  });

  it("keep a role that was set on purpose, and other elements get none", () => {
    expect(h("ul", { role: "menu" }).getAttribute("role")).toBe("menu");
    expect(h("ol").hasAttribute("role")).toBe(false);
    expect(h("div").hasAttribute("role")).toBe(false);
    expect(h("li").hasAttribute("role")).toBe(false);
  });

  it("covers every list in the app shell, including the menu groups", async () => {
    const g = globalThis as Record<string, unknown>;
    g.window = { addEventListener: () => {}, removeEventListener: () => {}, scrollTo: () => {} };
    g.location = { hash: "#/start" };
    const noVault: VaultStore = { supported: () => false, read: async () => null, write: async () => {}, clear: async () => {} };
    const store = createStore(initialState());
    const actions = createActions(store, { vault: noVault, clock: () => 0, yieldToUi: async () => {}, saveTheme: () => {} });
    const root = new FakeElement("div");
    buildShell(root as unknown as HTMLElement, { store, actions, terminal: testTerminal() });
    const lists = root.querySelectorAll("ul");
    expect(lists.length).toBeGreaterThanOrEqual(3);
    expect(lists.filter((ul) => ul.getAttribute("role") !== "list")).toEqual([]);
  });
});
