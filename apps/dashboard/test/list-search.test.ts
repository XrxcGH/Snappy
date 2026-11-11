/**
 * Search and sort on the finding lists and the Cleanup queue: the filter and sort models, the box (120 ms debounce,
 * Escape and Clear, focus stays), the "3 of 44 match" line, and the privacy rule that what is typed is a piece of a
 * username and lives in memory only. Fake clock; synthetic names only.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Candidate } from "@snappy-export/core";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { analyze, filterCandidates, matchesQuery, resetAnalysisCache, sortCandidates } from "../src/analysis.ts";
import { cleanup } from "../src/copy.ts";
import { lists } from "../src/copy-lists.ts";
import { clearSearches, searchQuery } from "../src/components/listSearch.ts";
import type { State } from "../src/reducer.ts";
import type { View } from "../src/views/context.ts";
import { FakeElement } from "./fake-dom.ts";
import { all, byLabel, mount, sampleStateOf, textOf } from "./lists-harness.ts";

const spoken: string[] = [];
vi.mock("../src/announce.ts", () => ({ announce: (m: string) => void spoken.push(m) }));

const candidate = (key: string, over: Partial<Candidate> = {}): Candidate => ({ key, category: "ghost", confidence: "medium", score: 0.5, evidence: [], protectedBy: [], ...over });
const dated = (at: number | undefined): Candidate["evidence"] => [{ signal: "s", detail: "Seen on a date.", weight: 1, ...(at === undefined ? {} : { at }) }];

describe("the filter and sort models", () => {
  it("matches part of a username as it is shown, ignoring case and surrounding spaces", () => {
    expect(matchesQuery("Sam_Quill", "quill")).toBe(true);
    expect(matchesQuery("sam_quill", "  AM_Q ")).toBe(true);
    expect(matchesQuery("sam_quill", "quillz")).toBe(false);
    expect(matchesQuery("sam_quill", "")).toBe(true);
    expect(matchesQuery("sam_quill", undefined)).toBe(true);
    // Hidden characters are shown as "?", so that is what a person can type.
    expect(matchesQuery("a‮b", "a?b")).toBe(true);
  });

  it("filters by query together with category and confidence", () => {
    const items = [candidate("amber", { category: "ghost" }), candidate("ambrose", { category: "dormant", confidence: "high" }), candidate("zed")];
    expect(filterCandidates(items, { category: "all", confidence: "all", query: "amb" }).map((c) => c.key)).toEqual(["amber", "ambrose"]);
    expect(filterCandidates(items, { category: "dormant", confidence: "all", query: "amb" }).map((c) => c.key)).toEqual(["ambrose"]);
    expect(filterCandidates(items, { category: "all", confidence: "all" })).toHaveLength(3);
  });

  it("sorts newest, oldest and by confidence, with undated people last and ties in their order", () => {
    const items = [
      candidate("a", { evidence: dated(100), confidence: "low", score: 0.2 }),
      candidate("b", { evidence: dated(300), confidence: "high", score: 0.9 }),
      candidate("c", { evidence: dated(undefined), confidence: "high", score: 0.95 }),
      candidate("d", { evidence: dated(200), confidence: "medium", score: 0.5 }),
      candidate("e", { evidence: dated(300), confidence: "low", score: 0.1 }),
    ];
    const keys = (order: Parameters<typeof sortCandidates>[1]): string[] => sortCandidates(items, order).map((c) => c.key);
    expect(keys("likely")).toEqual(["a", "b", "c", "d", "e"]);
    expect(keys("newest")).toEqual(["b", "e", "d", "a", "c"]);
    expect(keys("oldest")).toEqual(["a", "d", "b", "e", "c"]);
    expect(keys("confidence")).toEqual(["c", "b", "d", "a", "e"]);
    expect(sortCandidates(items, "likely")).not.toBe(items);
  });
});

let cleanupView: View;
let disappearedView: View;
let requestsView: View;
let quietView: View;
let sample: State;

beforeAll(async () => {
  ({ cleanupView } = (await import("../src/views/cleanup.ts")) as { cleanupView: View });
  ({ disappearedView, requestsView, quietView } = (await import("../src/views/findings.ts")) as { disappearedView: View; requestsView: View; quietView: View });
  sample = await sampleStateOf();
}, 120_000);
beforeEach(() => {
  vi.useFakeTimers();
  spoken.length = 0;
  clearSearches();
});
afterEach(() => vi.useRealTimers());

const searchBox = (root: FakeElement): FakeElement => all(root, "input[type=search]")[0]!;
const type = (root: FakeElement, text: string): void => {
  const box = searchBox(root);
  box.value = text;
  box.fire("input");
};
const rowNames = (root: FakeElement): string[] => all(root, "li.candidate").map((r) => textOf(all(r, ".username")[0]!));
const summary = (root: FakeElement): string => textOf(all(root, "p.summary")[0]!);

describe("search on the Cleanup queue", () => {
  it("has a labeled search box and a sort select", () => {
    const { root } = mount(cleanupView, sample);
    const box = searchBox(root);
    expect(box.getAttribute("id")).toBe("search-queue");
    expect(all(root, "label").some((l) => l.getAttribute("for") === "search-queue" && textOf(l) === lists.searchLabel)).toBe(true);
    expect(box.getAttribute("placeholder")).toBe(lists.searchPlaceholder);
    const sort = all(root, "select").find((s) => s.getAttribute("id") === "filter-sort")!;
    expect(all(sort, "option").map((o) => textOf(o))).toEqual(Object.values(lists.sortOptions));
  });

  it("narrows the rows after 120 ms of quiet, and says how many match", () => {
    const { root } = mount(cleanupView, sample);
    const total = analyze(sample).queue.items.length;
    const first = analyze(sample).queue.items[0]!.key;
    const part = first.slice(0, Math.min(first.length, 6));
    const expected = analyze(sample).queue.items.filter((c) => c.key.toLowerCase().includes(part.toLowerCase())).length;
    expect(expected).toBeGreaterThan(0);
    type(root, part);
    vi.advanceTimersByTime(119);
    expect(rowNames(root)).toHaveLength(Math.min(50, total));
    vi.advanceTimersByTime(1);
    expect(rowNames(root)).toHaveLength(Math.min(50, expected));
    expect(rowNames(root).every((n) => n.toLowerCase().includes(part.toLowerCase()))).toBe(true);
    expect(summary(root)).toBe(expected === total ? cleanup.summary(total, total) : cleanup.summary(expected, total));
    expect(spoken).toContain(summary(root));
    expect(searchQuery("queue")).toBe(part);
  });

  it("keeps the same search box, so focus stays in it while the list repaints", () => {
    const { root } = mount(cleanupView, sample);
    const box = searchBox(root);
    type(root, "zzz");
    vi.advanceTimersByTime(120);
    expect(searchBox(root)).toBe(box);
    expect(rowNames(root)).toHaveLength(0);
    expect(textOf(root)).toContain(lists.noMatchSearch);
  });

  it("empties with Escape and with Clear, and Escape does not reach the page", () => {
    const { root } = mount(cleanupView, sample);
    const total = analyze(sample).queue.items.length;
    type(root, "zzz");
    vi.advanceTimersByTime(120);
    let stopped = false;
    searchBox(root).fire("keydown", { key: "Escape", stopPropagation: () => (stopped = true) });
    expect(stopped).toBe(true);
    expect(searchBox(root).value).toBe("");
    expect(summary(root)).toBe(cleanup.summary(total, total));
    expect(rowNames(root).length).toBeGreaterThan(0);
    // Escape in an empty box is left to the page.
    stopped = false;
    searchBox(root).fire("keydown", { key: "Escape", stopPropagation: () => (stopped = true) });
    expect(stopped).toBe(false);

    type(root, "zzz");
    vi.advanceTimersByTime(120);
    const clear = all(root, "button").find((b) => b.getAttribute("aria-label") === lists.searchClearAria)!;
    expect(clear.hasAttribute("hidden")).toBe(false);
    clear.click();
    expect(searchBox(root).value).toBe("");
    expect(searchQuery("queue")).toBe("");
    expect(clear.hasAttribute("hidden")).toBe(true);
  });

  it("keeps a search that was just emptied empty when a filter changes before the box commits", () => {
    const { root, actions } = mount(cleanupView, sample);
    type(root, "zzz");
    vi.advanceTimersByTime(120);
    expect(rowNames(root)).toHaveLength(0);
    // Delete the text, then change a filter inside the 120 ms: the repaint must not bring "zzz" back.
    type(root, "");
    actions.setCleanupView({ category: "ghost" });
    vi.advanceTimersByTime(120);
    expect(searchBox(root).value).toBe("");
    expect(searchQuery("queue")).toBe("");
    expect(rowNames(root).length).toBeGreaterThan(0);
  });

  it("lets Clear filters win over text typed a moment before it", () => {
    const { root, store } = mount(cleanupView, { ...sample, cleanup: { ...sample.cleanup, category: "dormant" } });
    type(root, "zzz");
    vi.advanceTimersByTime(120);
    // More text, then Clear filters inside the 120 ms: the box being replaced must not store "zzzq" again.
    type(root, "zzzq");
    byLabel(root, lists.clearFiltersButton)!.click();
    vi.advanceTimersByTime(120);
    expect(store.get().cleanup.category).toBe("all");
    expect(searchQuery("queue")).toBe("");
    expect(searchBox(root).value).toBe("");
    expect(rowNames(root).length).toBeGreaterThan(0);
  });

  it("says what Newest signal and Oldest signal go by, and only while one of them is chosen", () => {
    const { root } = mount(cleanupView, sample);
    const sort = all(root, "select").find((s) => s.getAttribute("id") === "filter-sort")!;
    expect(textOf(root)).not.toContain(lists.sortNote);
    for (const order of ["newest", "oldest"]) {
      sort.value = order;
      sort.fire("change");
      expect(textOf(root)).toContain(lists.sortNote);
    }
    sort.value = "confidence";
    sort.fire("change");
    expect(textOf(root)).not.toContain(lists.sortNote);
  });

  it("brings everything back with Clear filters", () => {
    const { root, store } = mount(cleanupView, { ...sample, cleanup: { ...sample.cleanup, category: "dormant" } });
    type(root, "zzz");
    vi.advanceTimersByTime(120);
    const clear = byLabel(root, lists.clearFiltersButton)!;
    expect(clear).toBeDefined();
    clear.click();
    expect(store.get().cleanup.category).toBe("all");
    expect(searchQuery("queue")).toBe("");
    expect(searchBox(root).value).toBe("");
    expect(byLabel(root, lists.clearFiltersButton)).toBeUndefined();
    expect(rowNames(root).length).toBeGreaterThan(0);
  });

  it("sorts the rows by the chosen order and resets with the other filters", () => {
    const { root } = mount(cleanupView, sample);
    const items = analyze(sample).queue.items;
    const sort = all(root, "select").find((s) => s.getAttribute("id") === "filter-sort")!;
    sort.value = "confidence";
    sort.fire("change");
    const want = sortCandidates(items, "confidence").slice(0, 50).map((c) => c.key);
    expect(rowNames(root)).toEqual(want);
    sort.value = "likely";
    sort.fire("change");
    expect(rowNames(root)).toEqual(items.slice(0, 50).map((c) => c.key));
  });
});

describe("search on the finding lists", () => {
  it.each([
    ["Disappeared friends", () => disappearedView, (a: ReturnType<typeof analyze>) => a.ghosts],
    ["Unaccepted requests", () => requestsView, (a: ReturnType<typeof analyze>) => a.oneWay],
    ["Quiet friends", () => quietView, (a: ReturnType<typeof analyze>) => a.dormant],
  ])("%s has a search box that narrows its rows and says how many match", (_name, view, pick) => {
    const { root } = mount(view(), sample);
    const items = pick(analyze(sample));
    expect(items.length).toBeGreaterThan(1);
    expect(rowNames(root)).toHaveLength(Math.min(50, items.length));
    const part = items[0]!.key.slice(0, 5);
    const expected = items.filter((c) => c.key.toLowerCase().includes(part.toLowerCase())).length;
    type(root, part);
    vi.advanceTimersByTime(120);
    expect(rowNames(root)).toHaveLength(Math.min(50, expected));
    expect(summary(root)).toBe(lists.matchCount(expected, items.length));
    type(root, "zzz");
    vi.advanceTimersByTime(120);
    expect(rowNames(root)).toHaveLength(0);
    expect(textOf(root)).toContain(lists.noMatchSearch);
    expect(spoken).toContain(lists.noMatchSearch);
    type(root, "");
    vi.advanceTimersByTime(120);
    expect(rowNames(root)).toHaveLength(Math.min(50, items.length));
  });
});

describe("what is typed stays in memory", () => {
  const CANARY = "canary_user_8431";

  it("is not put in the address, the title or storage, and is forgotten with the analysis", () => {
    const { root } = mount(cleanupView, sample);
    (document as unknown as { title: string }).title = "Cleanup queue";
    const location = { hash: "#/cleanup", href: "http://localhost/#/cleanup" };
    (globalThis as { location?: unknown }).location = location;
    type(root, CANARY);
    vi.advanceTimersByTime(120);
    expect(searchQuery("queue")).toBe(CANARY);
    expect((document as unknown as { title: string }).title).toBe("Cleanup queue");
    expect(JSON.stringify(location)).not.toContain(CANARY);
    // Lock and Delete data reset the analysis; the search goes with it.
    resetAnalysisCache();
    expect(searchQuery("queue")).toBe("");
    delete (globalThis as { location?: unknown }).location;
  });

  it("has no storage, address or title access in the search code", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(path.join(here, "..", "src", "components", "listSearch.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB|\blocation\b|history\.|document\.title|cookie/);
  });
});
