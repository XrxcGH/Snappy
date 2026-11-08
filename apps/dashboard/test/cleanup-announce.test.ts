/**
 * Filter and mode changes on Cleanup are announced once, through the page's live region, after the list repaints. The
 * count line and the guided progress are plain paragraphs, not live regions of their own (a region that did not exist
 * before its text is often not spoken, and a second one would speak the same change twice).
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { analyze } from "../src/analysis.ts";
import { cleanup } from "../src/copy.ts";
import { lists } from "../src/copy-lists.ts";
import { clearSearches } from "../src/components/listSearch.ts";
import type { State } from "../src/reducer.ts";
import type { View } from "../src/views/context.ts";
import type { FakeElement } from "./fake-dom.ts";
import { all, byLabel, mount, sampleStateOf } from "./lists-harness.ts";

const spoken: string[] = [];
vi.mock("../src/announce.ts", () => ({ announce: (m: string) => void spoken.push(m) }));

let cleanupView: View;
let sample: State;

beforeAll(async () => {
  ({ cleanupView } = (await import("../src/views/cleanup.ts")) as { cleanupView: View });
  sample = await sampleStateOf();
}, 120_000);
beforeEach(() => {
  spoken.length = 0;
  clearSearches();
});

const select = (root: FakeElement, id: string): FakeElement => all(root, "select").find((s) => s.getAttribute("id") === id)!;
const choose = (root: FakeElement, id: string, value: string): void => {
  const el = select(root, id);
  el.value = value;
  el.fire("change");
};
const queue = (): ReturnType<typeof analyze>["queue"]["items"] => analyze(sample).queue.items;

describe("announcing filter and mode changes", () => {
  it("has no live region inside the page for the count line, in either mode", () => {
    for (const guided of [false, true]) {
      const { root } = mount(cleanupView, { ...sample, cleanup: { ...sample.cleanup, guided } });
      // The command block further down has its own status line for choosing files; the queue itself has none.
      const slot = all(root, ".queue-slot")[0]!;
      expect(all(slot, "[role=status]").length, guided ? "guided" : "review").toBe(0);
      expect(all(slot, "[aria-live]").length, guided ? "guided" : "review").toBe(0);
      expect(all(slot, "p.summary").length).toBeGreaterThan(0);
    }
  });

  it("announces the new count once when the category changes", () => {
    const { root } = mount(cleanupView, sample);
    choose(root, "filter-category", "ghost");
    const n = queue().filter((c) => c.category === "ghost").length;
    expect(spoken).toEqual([cleanup.summary(n, queue().length)]);
  });

  it("announces the new count once when the confidence changes", () => {
    const { root } = mount(cleanupView, sample);
    choose(root, "filter-confidence", "medium");
    const n = queue().filter((c) => c.confidence === "medium").length;
    expect(spoken).toEqual([cleanup.summary(n, queue().length)]);
  });

  it("says so when the choice leaves no one", () => {
    const { root } = mount(cleanupView, sample);
    choose(root, "filter-confidence", "high");
    choose(root, "filter-category", "dormant");
    const none = queue().filter((c) => c.category === "dormant" && c.confidence === "high").length === 0;
    if (none) expect(spoken[spoken.length - 1]).toBe(cleanup.noMatch);
    else expect(spoken[spoken.length - 1]).toMatch(/match$/);
  });

  it("announces the progress when the mode becomes guided, and the count when it goes back", () => {
    const { root } = mount(cleanupView, sample);
    byLabel(root, cleanup.modeGuided)!.click();
    expect(spoken).toEqual([cleanup.progressText(0, queue().length)]);
    spoken.length = 0;
    byLabel(root, cleanup.modeReview)!.click();
    expect(spoken).toEqual([cleanup.summary(queue().length, queue().length)]);
  });

  it("announces the whole queue again with Clear filters", () => {
    const { root } = mount(cleanupView, { ...sample, cleanup: { ...sample.cleanup, category: "dormant", confidence: "high" } });
    const box = all(root, "input[type=search]")[0]!;
    vi.useFakeTimers();
    box.value = "zzz";
    box.fire("input");
    vi.advanceTimersByTime(120);
    vi.useRealTimers();
    spoken.length = 0;
    byLabel(root, lists.clearFiltersButton)!.click();
    expect(spoken).toEqual([cleanup.summary(queue().length, queue().length)]);
  });

  it("speaks one message when a guided row is marked done", () => {
    const { root } = mount(cleanupView, { ...sample, cleanup: { ...sample.cleanup, guided: true } });
    const first = queue()[0]!.key;
    const box = all(root, "input[type=checkbox]").find((c) => c.getAttribute("data-key") === `done:${first}`)!;
    box.checked = true;
    box.fire("change");
    expect(spoken).toHaveLength(1);
    expect(spoken[0]).toContain(cleanup.progressText(1, queue().length));
    expect(all(all(root, ".queue-slot")[0]!, "[role=status]").length).toBe(0);
  });
});
