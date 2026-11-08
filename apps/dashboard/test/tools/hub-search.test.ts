/**
 * "Find a tool" on the Tools hub: a search field that narrows the tiles by title and one-liner, resizes each group's grid for
 * what is left, hides a group with nothing, says the count politely, clears on Escape, and keeps what was typed for as long
 * as the page is open and not a moment longer. The registry is replaced by made-up tools with distinct names.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hubSearch } from "../../src/copy-tools.ts";
import type { State } from "../../src/reducer.ts";
import { matchesTool, toolsView } from "../../src/views/tools.ts";
import type { FakeElement } from "../fake-dom.ts";
import { render, sampleState } from "./harness.ts";

const said: string[] = [];
vi.mock("../../src/announce.ts", () => ({ announce: (text: string) => void said.push(text) }));
vi.mock("../../src/tools/registry.ts", () => {
  const stub = (id: string, title: string, oneLiner: string, group: string, category: string): unknown => ({ id, title, oneLiner, group, category, icon: "check", needs: [], view: () => null });
  const list = [
    stub("export-check", "Export check", "Shows what your export holds.", "your-export", "cleanup"),
    stub("export-reminder", "Export reminder", "Reminds you to export again.", "your-export", "cleanup"),
    stub("friends-backup", "Friends backup", "Saves your friend list as a file.", "friends", "requests"),
    stub("closest-fading", "Closest and fading", "Shows who you talk to most.", "friends", "requests"),
    stub("anniversaries", "Friendship anniversaries", "Finds friendship dates.", "friends", "requests"),
    stub("habits", "Chat and Snap habits", "Shows your busiest hours.", "chats", "quiet"),
    stub("storage-planner", "Storage planner", "Plans room for your Memories.", "memories", "memories"),
  ] as { group: string }[];
  const order = ["your-export", "friends", "chats", "memories"];
  return {
    TOOLS: list,
    GROUPS: [],
    toolById: () => undefined,
    groupedTools: () => order.map((id) => ({ group: { id }, tools: list.filter((t) => t.group === id) })),
  };
});

let sample: State;
beforeAll(async () => {
  sample = await sampleState();
}, 120_000);
beforeEach(() => {
  said.length = 0;
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

const sections = (root: FakeElement): FakeElement[] => root.querySelectorAll("section.section");
const shownTiles = (root: FakeElement): string[] => root.querySelectorAll("a.tile").filter((t) => !t.hidden).map((t) => t.querySelector("h3")?.textContent ?? "");
const searchInput = (root: FakeElement): FakeElement => root.querySelector("#tool-search") as FakeElement;
const type = (root: FakeElement, text: string): void => {
  const input = searchInput(root);
  input.value = text;
  input.fire("input");
};

describe("matchesTool", () => {
  const tool = { title: "Friends backup", oneLiner: "Saves your friend list as a file." };
  it("matches every typed word in the title or the line, in any order and any case", () => {
    expect(matchesTool(tool, "")).toBe(true);
    expect(matchesTool(tool, "   ")).toBe(true);
    expect(matchesTool(tool, "BACKUP")).toBe(true);
    expect(matchesTool(tool, "list friends")).toBe(true);
    expect(matchesTool(tool, "backup file")).toBe(true);
    expect(matchesTool(tool, "backup photo")).toBe(false);
    expect(matchesTool(tool, "zzz")).toBe(false);
  });
});

describe("the field", () => {
  it("is a labeled search input above the groups, with no Clear showing until something is typed", () => {
    const { root } = render(toolsView, sample);
    const input = searchInput(root);
    expect(input.getAttribute("type")).toBe("search");
    expect(root.querySelector("label[for=tool-search]")?.textContent).toBe(hubSearch.label);
    expect(input.getAttribute("autocomplete")).toBe("off");
    const all = root.descendants();
    expect(all.indexOf(input)).toBeLessThan(all.indexOf(sections(root)[0] as FakeElement));
    const clear = root.querySelector(".search-row button") as FakeElement;
    expect(clear.hidden).toBe(true);
    expect(root.querySelector(".hub-count")?.hidden).toBe(true);
    expect(shownTiles(root)).toHaveLength(7);
  });
});

describe("typing", () => {
  it("shows only the matching tiles, hides a group with none and sizes the grid of a group for what is left", () => {
    const { root } = render(toolsView, sample);
    type(root, "export");
    expect(shownTiles(root)).toEqual(["Export check", "Export reminder"]);
    expect(sections(root).map((s) => s.hidden)).toEqual([false, true, true, true]);
    type(root, "friend");
    expect(shownTiles(root)).toEqual(["Friends backup", "Friendship anniversaries"]);
    expect(sections(root).map((s) => s.hidden)).toEqual([true, false, true, true]);
    expect((sections(root)[1] as FakeElement).querySelector(".tiles")?.className).toBe("tiles tiles-tools tiles-n-2");
    // A match in the one-liner counts too.
    type(root, "hours");
    expect(shownTiles(root)).toEqual(["Chat and Snap habits"]);
    expect((sections(root)[2] as FakeElement).querySelector(".tiles")?.className).toBe("tiles tiles-tools tiles-n-1");
  });

  it("puts the count on the page and says it once, a moment after the typing stops", () => {
    const { root } = render(toolsView, sample);
    type(root, "e");
    type(root, "ex");
    type(root, "exp");
    const count = root.querySelector(".hub-count") as FakeElement;
    expect(count.hidden).toBe(false);
    expect(count.textContent).toBe(hubSearch.count(2, 7));
    expect(said).toEqual([]);
    vi.advanceTimersByTime(500);
    expect(said).toEqual([hubSearch.count(2, 7)]);
  });

  it("says so when no tool matches, hides every group, and offers the way back", () => {
    const { root } = render(toolsView, sample);
    type(root, "zzzzzz");
    expect(shownTiles(root)).toEqual([]);
    expect(sections(root).every((s) => s.hidden)).toBe(true);
    const none = root.querySelector(".hub-none") as FakeElement;
    expect(none.hidden).toBe(false);
    expect(none.textContent).toBe(hubSearch.none);
    vi.advanceTimersByTime(500);
    expect(said).toEqual([hubSearch.none]);
  });

  it("brings everything back, and says nothing, when the field is emptied", () => {
    const { root } = render(toolsView, sample);
    type(root, "habits");
    type(root, "");
    vi.advanceTimersByTime(500);
    expect(shownTiles(root)).toHaveLength(7);
    expect(sections(root).every((s) => !s.hidden)).toBe(true);
    expect((sections(root)[1] as FakeElement).querySelector(".tiles")?.className).toBe("tiles tiles-tools tiles-n-3");
    expect(root.querySelector(".hub-count")?.hidden).toBe(true);
    expect(root.querySelector(".hub-none")?.hidden).toBe(true);
    expect(said).toEqual([]);
  });

  it("clears with Escape, which stays with the field, and with the Clear button, and puts focus back in the field", () => {
    const { root } = render(toolsView, sample);
    type(root, "habits");
    let stopped = false;
    searchInput(root).fire("keydown", { key: "Escape", stopPropagation: () => (stopped = true) });
    expect(stopped).toBe(true);
    expect(searchInput(root).value).toBe("");
    expect(shownTiles(root)).toHaveLength(7);

    type(root, "habits");
    const clear = root.querySelector(".search-row button") as FakeElement;
    expect(clear.hidden).toBe(false);
    expect(clear.getAttribute("aria-label")).toBe(hubSearch.clearAria);
    expect(clear.getAttribute("aria-label")?.startsWith(clear.textContent)).toBe(true);
    clear.click();
    expect(searchInput(root).value).toBe("");
    expect(shownTiles(root)).toHaveLength(7);
    expect(clear.hidden).toBe(true);
  });

  it("does not take Escape when the field is already empty, so the page's own Escape still works", () => {
    const { root } = render(toolsView, sample);
    let stopped = false;
    searchInput(root).fire("keydown", { key: "Escape", stopPropagation: () => (stopped = true) });
    expect(stopped).toBe(false);
  });

  it("keeps what was typed when the tiles repaint because the export changed", async () => {
    const r = render(toolsView, sample);
    type(r.root, "habits");
    r.store.dispatch({ type: "import-failed", message: "x" });
    expect(shownTiles(r.root)).toEqual(["Chat and Snap habits"]);
    expect(sections(r.root).map((s) => s.hidden)).toEqual([true, true, false, true]);
  });

  it("keeps the words in the page only: nothing in the address, the title or storage", () => {
    const stored: string[] = [];
    vi.stubGlobal("localStorage", { setItem: (_k: string, v: string) => void stored.push(v), getItem: () => null, removeItem: () => undefined });
    const { root } = render(toolsView, sample);
    type(root, "habits");
    vi.advanceTimersByTime(500);
    expect(stored).toEqual([]);
    expect(document.title).not.toContain("habits");
    vi.unstubAllGlobals();
  });
});
