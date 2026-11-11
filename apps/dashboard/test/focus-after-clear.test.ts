/**
 * Focus after a control that clears itself away: Clear filters, Clear checkmarks, the last Undo keep and the last
 * Remove on the keep list leave nothing to focus where they stood, so focus lands on a control nearby (the search box, or the box that adds a
 * name) and not on the page body or the repainted block. Rendered in the small fake DOM. Synthetic data only.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { analyze } from "../src/analysis.ts";
import { clearSearches, setSearchQuery } from "../src/components/listSearch.ts";
import type { State } from "../src/reducer.ts";
import type { View } from "../src/views/context.ts";
import { FakeElement } from "./fake-dom.ts";
import { all, byKey, mount, sampleStateOf } from "./lists-harness.ts";

vi.mock("../src/announce.ts", () => ({ announce: () => undefined }));

let cleanupView: View;
let sample: State;

beforeAll(async () => {
  ({ cleanupView } = (await import("../src/views/cleanup.ts")) as { cleanupView: View });
  sample = await sampleStateOf();
}, 120_000);

beforeEach(() => {
  clearSearches();
  FakeElement.lastFocused = null;
});

/** What a click does in a browser: the control has focus, then its handler runs. */
const press = (button: FakeElement): void => {
  (globalThis as unknown as { document: { activeElement: unknown } }).document.activeElement = button;
  button.click();
};

describe("focus after Clear filters", () => {
  it("lands in the search box when the filters leave nothing to show", () => {
    const { root, actions } = mount(cleanupView, sample);
    actions.setCleanupView({ category: "dormant", confidence: "high" });
    const clear = byKey(root, "clear-filters");
    expect(clear, "no match, so Clear filters is offered").toBeDefined();
    press(clear!);
    expect(byKey(root, "clear-filters")).toBeUndefined();
    expect(FakeElement.lastFocused).toBe(byKey(root, "search:queue"));
  });

  it("lands in the search box when only the search leaves nothing to show", () => {
    setSearchQuery("queue", "zzzz_nobody");
    const { root } = mount(cleanupView, sample);
    const clear = byKey(root, "clear-filters");
    expect(clear, "no match, so Clear filters is offered").toBeDefined();
    press(clear!);
    expect(byKey(root, "clear-filters")).toBeUndefined();
    expect(FakeElement.lastFocused).toBe(byKey(root, "search:queue"));
  });
});

describe("focus after Clear checkmarks", () => {
  it("lands in the search box once nothing is ticked", () => {
    const { root, actions } = mount(cleanupView, { ...sample, cleanup: { ...sample.cleanup, guided: true } });
    actions.toggleChecked(analyze(sample).queue.items[0]!.key);
    const clear = byKey(root, "clear-checks");
    expect(clear, "something is ticked, so Clear checkmarks is offered").toBeDefined();
    press(clear!);
    expect(byKey(root, "clear-checks")).toBeUndefined();
    expect(FakeElement.lastFocused).toBe(byKey(root, "search:queue"));
  });
});

describe("focus after the last Undo keep", () => {
  it("lands in the search box when no protected person is left to undo", () => {
    const { root, actions } = mount(cleanupView, sample);
    const key = analyze(sample).queue.items[0]!.key;
    actions.keep(key);
    const undo = byKey(root, `unkeep:${key}`);
    expect(undo, "kept, so Undo keep is offered in the Protected section").toBeDefined();
    press(undo!);
    expect(byKey(root, `unkeep:${key}`)).toBeUndefined();
    expect(FakeElement.lastFocused).toBe(byKey(root, "search:queue"));
  });

  it("stays on an Undo keep button while others are left", () => {
    const { root, actions } = mount(cleanupView, sample);
    const [first, second] = analyze(sample).queue.items;
    actions.keep(first!.key);
    actions.keep(second!.key);
    press(byKey(root, `unkeep:${first!.key}`)!);
    expect(String(FakeElement.lastFocused?.getAttribute("data-key"))).toMatch(/^unkeep:/);
  });
});

describe("focus after the last Remove on the keep list", () => {
  it("lands in the box that adds a name", () => {
    const { root, actions } = mount(cleanupView, sample);
    actions.keep("zed_friend");
    const remove = byKey(root, "keep-remove:zed_friend");
    expect(remove).toBeDefined();
    press(remove!);
    expect(all(root, "li.keep-row")).toHaveLength(0);
    expect(FakeElement.lastFocused).toBe(byKey(root, "keep-add"));
  });

  it("stays on a Remove button while names are left", () => {
    const { root, actions } = mount(cleanupView, sample);
    actions.keep("zed_friend");
    actions.keep("amy_friend");
    press(byKey(root, "keep-remove:zed_friend")!);
    expect(String(FakeElement.lastFocused?.getAttribute("data-key"))).toMatch(/^keep-remove:/);
  });
});
