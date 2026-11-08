/**
 * Where a tool lives: #/tools is the hub and #/tools/<id> a tool, the menu keeps one Tools item that stays marked
 * inside a tool, a tool that does not exist is the hub, and no existing route changed. The registry is replaced by
 * two made-up tools here, so these tests do not depend on which real tools exist.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createActions } from "../../src/actions.ts";
import { NAV, buildShell } from "../../src/app-shell.ts";
import { routes } from "../../src/copy.ts";
import { isAllowedHref } from "../../src/safe.ts";
import { hashFor, parseLocation, parseRoute } from "../../src/route-parse.ts";
import { initialState } from "../../src/reducer.ts";
import { startRouter } from "../../src/router.ts";
import { createStore } from "../../src/store.ts";
import { testTerminal } from "../terminal-fixture.ts";
import { FakeElement, installFakeDom } from "../fake-dom.ts";

vi.mock("snappy:licenses", () => ({ licenses: [{ name: "Example", license: "MIT", copyright: "Example authors", text: "License text." }] }));

// Two made-up tools stand in for the registry, so these tests do not depend on which real tools exist.
vi.mock("../../src/tools/registry.ts", async () => {
  const { h } = await import("../../src/dom.ts");
  const stub = (id: string, title: string, group: string): unknown => ({
    id,
    title,
    oneLiner: "Does one thing.",
    group,
    category: "cleanup",
    icon: "check",
    needs: [],
    view: () => h("div", { class: "view" }, h("h1", { id: "page-title", tabindex: "-1" }, title)),
  });
  const DEMO = [stub("demo-tool", "Demo tool", "your-export"), stub("other-tool", "Other tool", "friends")] as { id: string }[];
  return {
    TOOLS: DEMO,
    GROUPS: [],
    toolById: (id: string) => DEMO.find((t) => t.id === id),
    groupedTools: () => [
      { group: { id: "your-export", category: "cleanup" }, tools: [DEMO[0]] },
      { group: { id: "friends", category: "requests" }, tools: [DEMO[1]] },
    ],
  };
});

describe("parseLocation", () => {
  it("reads a tool from #/tools/<id> and the hub from #/tools, with or without a trailing slash", () => {
    expect(parseLocation("#/tools")).toEqual({ id: "tools", tool: null });
    expect(parseLocation("#/tools/")).toEqual({ id: "tools", tool: null });
    expect(parseLocation("#/tools/export-check")).toEqual({ id: "tools", tool: "export-check" });
    expect(parseLocation("#/tools/friend-count-history")).toEqual({ id: "tools", tool: "friend-count-history" });
  });

  it("keeps every page that existed, and sends anything else to Start", () => {
    for (const id of Object.keys(routes)) expect(parseLocation(`#/${id}`)).toEqual({ id, tool: null });
    expect(parseLocation("")).toEqual({ id: "start", tool: null });
    expect(parseLocation("#/nope")).toEqual({ id: "start", tool: null });
    expect(parseLocation("#/overview/export-check")).toEqual({ id: "start", tool: null });
    expect(parseLocation("#/tools/a/b")).toEqual({ id: "start", tool: null });
    expect(parseLocation("#/tools/Export")).toEqual({ id: "start", tool: null });
    expect(parseLocation("#/tools/-x")).toEqual({ id: "start", tool: null });
    expect(parseLocation("#main")).toBeNull();
  });

  it("says a tool's page belongs to Tools, and writes hashes back the same way", () => {
    expect(parseRoute("#/tools/export-check")).toBe("tools");
    expect(parseRoute("#/tools")).toBe("tools");
    expect(hashFor({ id: "tools", tool: "export-check" })).toBe("#/tools/export-check");
    expect(hashFor({ id: "tools", tool: null })).toBe("#/tools");
    expect(hashFor({ id: "cleanup", tool: null })).toBe("#/cleanup");
  });
});

describe("links to a tool", () => {
  it("are allowed in the page, and only in this one shape", () => {
    for (const ok of ["#/tools", "#/tools/export-check", "#/tools/friend-count-history", "#/tools/a1"]) expect(isAllowedHref(ok), ok).toBe(true);
    for (const bad of ["#/tools/", "#/tools/a/b", "#/tools/Export", "#/tools/-x", "#/other/x", "#/tools/x?y=1", "#/tools/../start", "javascript:alert(1)"]) expect(isAllowedHref(bad), bad).toBe(false);
  });
});

describe("the menu", () => {
  it("has one Tools item, after Overview, and never one per tool", () => {
    const items = NAV.flatMap((g) => g.items);
    expect(items.filter((i) => i.id === "tools")).toHaveLength(1);
    const first = NAV[0]?.items.map((i) => i.id);
    expect(first).toEqual(["start", "overview", "tools"]);
    expect(items).toHaveLength(Object.keys(routes).length);
    expect(routes.tools.label).toBe("Tools");
    expect(routes.tools.title).toBe(routes.tools.label);
  });
});

let hashListeners: (() => void)[] = [];
let replaced: string[] = [];
let fakeDocument: { documentElement: FakeElement; title: string };
beforeAll(() => {
  fakeDocument = installFakeDom().document as unknown as typeof fakeDocument;
});
beforeEach(() => {
  hashListeners = [];
  replaced = [];
  const g = globalThis as Record<string, unknown>;
  g.window = { addEventListener: (t: string, fn: () => void) => void (t === "hashchange" && hashListeners.push(fn)), removeEventListener: () => {}, scrollTo: () => {} };
  g.location = { hash: "#/start" };
  // Only calls that rewrite the address count: the router also marks the entry it shows (state only, no address).
  g.history = { replaceState: (_s: unknown, _t: string, url?: string) => void (url !== undefined && replaced.push(url)) };
  g.matchMedia = () => ({ matches: false, addEventListener: () => {} });
});

function open(hash: string): { root: FakeElement; go: (h: string) => void; current: () => string | null } {
  (globalThis as { location: { hash: string } }).location.hash = hash;
  const store = createStore(initialState());
  const actions = createActions(store, { vault: { supported: () => false, read: async () => null, write: async () => {}, clear: async () => {} }, clock: () => 0, yieldToUi: async () => {}, saveTheme: () => {} });
  const root = new FakeElement("div");
  const ctx = { store, actions, terminal: testTerminal() };
  const shell = buildShell(root as unknown as HTMLElement, ctx);
  startRouter(shell.outlet, ctx, shell.onRoute);
  return {
    root,
    go: (h) => {
      (globalThis as { location: { hash: string } }).location.hash = h;
      for (const fn of hashListeners) fn();
    },
    current: () => root.querySelectorAll("nav a").find((a) => a.getAttribute("aria-current") === "page")?.textContent ?? null,
  };
}

describe("the router", () => {
  it("shows the hub at #/tools, with Tools marked and one tile per tool", () => {
    const page = open("#/tools");
    expect(page.root.querySelector("h1")?.textContent).toBe("Tools");
    expect(page.current()).toBe("Tools");
    expect(fakeDocument.title).toBe("Tools · Snappy");
    expect(page.root.querySelectorAll("a.tool-tile").map((a) => a.getAttribute("href"))).toEqual(["#/tools/demo-tool", "#/tools/other-tool"]);
    expect(replaced).toEqual([]);
  });

  it("shows a tool at #/tools/<id> under its own title, with Tools still marked", () => {
    const page = open("#/tools/other-tool");
    expect(page.root.querySelector("h1")?.textContent).toBe("Other tool");
    expect(page.current()).toBe("Tools");
    expect(fakeDocument.title).toBe("Other tool · Snappy");
    expect(replaced).toEqual([]);
  });

  it("moves between the hub, a tool and another page, keeping the marked item right", () => {
    const page = open("#/overview");
    expect(page.current()).toBe("Overview");
    page.go("#/tools/demo-tool");
    expect(page.current()).toBe("Tools");
    expect(page.root.querySelector("h1")?.textContent).toBe("Demo tool");
    page.go("#/tools");
    expect(page.root.querySelector("h1")?.textContent).toBe("Tools");
    page.go("#/cleanup");
    expect(page.current()).toBe("Cleanup queue");
    expect(fakeDocument.title).toBe("Cleanup queue · Snappy");
  });

  it("treats a tool that does not exist as the hub and says so in the address", () => {
    const page = open("#/tools/nope");
    expect(page.root.querySelector("h1")?.textContent).toBe("Tools");
    expect(replaced).toEqual(["#/tools"]);
    expect(page.current()).toBe("Tools");
  });

  it("writes a tidy address for #/tools/ and for a malformed one", () => {
    open("#/tools/");
    expect(replaced).toEqual(["#/tools"]);
    replaced = [];
    const page = open("#/tools/a/b");
    expect(replaced).toEqual(["#/start"]);
    expect(page.root.querySelector("h1")?.textContent).toBe("Start");
  });
});
