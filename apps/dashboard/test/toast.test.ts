/**
 * The toast after Keep: a visible sentence with Undo for eight seconds, paused while the pointer or focus is on it,
 * one at a time with a running count, Undo for the latest only, and no username except through displayUsername.
 * Fake clock; synthetic names only.
 */
import type { Candidate } from "@snappy-export/core";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { common } from "../src/copy.ts";
import { lists } from "../src/copy-lists.ts";
import { undoToast } from "../src/components/toast.ts";
import { displayUsername } from "../src/safe.ts";
import { Scope, runInScope } from "../src/reactive.ts";
import type { State } from "../src/reducer.ts";
import type { View } from "../src/views/context.ts";
import { FakeElement, installFakeDom } from "./fake-dom.ts";
import { all, byLabel, mount, sampleStateOf, textOf } from "./lists-harness.ts";

const spoken: string[] = [];
vi.mock("../src/announce.ts", () => ({ announce: (m: string) => void spoken.push(m) }));

let cleanupView: View;
let disappearedView: View;
let sample: State;

beforeAll(async () => {
  ({ cleanupView } = (await import("../src/views/cleanup.ts")) as { cleanupView: View });
  ({ disappearedView } = (await import("../src/views/findings.ts")) as { disappearedView: View });
  sample = await sampleStateOf();
}, 120_000);
beforeEach(() => {
  spoken.length = 0;
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

const keepButtons = (root: FakeElement): FakeElement[] => all(root, "button").filter((b) => (b.getAttribute("data-key") ?? "").startsWith("keep:"));
const toastOf = (root: FakeElement): FakeElement | undefined => all(root, ".toast")[0];
const nameOfKeep = (button: FakeElement): string => (button.getAttribute("data-key") ?? "").slice("keep:".length);

describe("the Keep toast", () => {
  it("shows the sentence and an Undo button after Keep, and speaks the same sentence once", () => {
    const { root, store } = mount(cleanupView, sample);
    expect(toastOf(root)).toBeUndefined();
    const first = keepButtons(root)[0]!;
    const name = nameOfKeep(first);
    first.click();
    const toast = toastOf(root);
    expect(toast, "a toast after Keep").toBeDefined();
    expect(textOf(toast!)).toContain(common.kept(displayUsername(name)));
    expect(byLabel(toast!, lists.undoButton)?.getAttribute("aria-label")).toBe(common.unkeepFor(displayUsername(name)));
    expect(store.get().sample?.allowlist).toEqual([name]);
    // The sentence is spoken through the live region, and the toast is not a live region of its own.
    expect(spoken.filter((m) => m === common.kept(displayUsername(name)))).toHaveLength(1);
    for (const el of [toast!, ...toast!.descendants()]) {
      expect(el.getAttribute("aria-live")).toBeNull();
      expect(el.getAttribute("role")).not.toBe("status");
      expect(el.getAttribute("role")).not.toBe("alert");
    }
  });

  it("puts the person back with Undo and focuses their row again", () => {
    const { root, store } = mount(cleanupView, sample);
    const first = keepButtons(root)[0]!;
    const name = nameOfKeep(first);
    first.click();
    byLabel(toastOf(root)!, lists.undoButton)!.click();
    expect(store.get().sample?.allowlist).toEqual([]);
    expect(toastOf(root)).toBeUndefined();
    expect(spoken).toContain(common.unkept(displayUsername(name)));
    const back = keepButtons(root).find((b) => nameOfKeep(b) === name);
    expect(back, "the row is back").toBeDefined();
    expect(FakeElement.lastFocused).toBe(back);
  });

  it("takes the latest Keep back from one key press, wherever focus is, and does nothing without a toast", () => {
    const { root, store } = mount(cleanupView, sample);
    expect(undoToast(), "no toast yet").toBe(false);
    const first = keepButtons(root)[0]!;
    const name = nameOfKeep(first);
    first.click();
    expect(store.get().sample?.allowlist).toEqual([name]);
    expect(undoToast()).toBe(true);
    expect(store.get().sample?.allowlist).toEqual([]);
    expect(toastOf(root)).toBeUndefined();
    expect(FakeElement.lastFocused).toBe(keepButtons(root).find((b) => nameOfKeep(b) === name));
    expect(undoToast(), "the toast is gone").toBe(false);
  });

  it("stays eight seconds, then goes", () => {
    const { root } = mount(cleanupView, sample);
    keepButtons(root)[0]!.click();
    vi.advanceTimersByTime(7999);
    expect(toastOf(root)).toBeDefined();
    vi.advanceTimersByTime(1);
    expect(toastOf(root)).toBeUndefined();
  });

  it("holds its time while the pointer or focus is on it, and goes after the time that was left", () => {
    const { root } = mount(cleanupView, sample);
    keepButtons(root)[0]!.click();
    vi.advanceTimersByTime(5000);
    toastOf(root)!.fire("mouseenter");
    vi.advanceTimersByTime(60_000);
    expect(toastOf(root), "held by the pointer").toBeDefined();
    toastOf(root)!.fire("mouseleave");
    vi.advanceTimersByTime(2999);
    expect(toastOf(root)).toBeDefined();
    vi.advanceTimersByTime(1);
    expect(toastOf(root)).toBeUndefined();

    keepButtons(root)[0]!.click();
    toastOf(root)!.fire("focusin");
    vi.advanceTimersByTime(60_000);
    expect(toastOf(root), "held by focus").toBeDefined();
    toastOf(root)!.fire("focusout");
    vi.advanceTimersByTime(8000);
    expect(toastOf(root)).toBeUndefined();
  });

  it("shows one toast at a time with a running count, and Undo takes back the latest only", () => {
    const { root, store } = mount(cleanupView, sample);
    const names: string[] = [];
    for (let i = 0; i < 3; i++) {
      const button = keepButtons(root)[0]!;
      names.push(nameOfKeep(button));
      button.click();
      vi.advanceTimersByTime(1000);
    }
    expect(all(root, ".toast")).toHaveLength(1);
    expect(textOf(toastOf(root)!)).toContain(lists.keptCount(3));
    byLabel(toastOf(root)!, lists.undoButton)!.click();
    expect(store.get().sample?.allowlist).toEqual([...names.slice(0, 2)].sort());
    // A Keep after the toast went starts again at one.
    keepButtons(root)[0]!.click();
    expect(textOf(toastOf(root)!)).not.toContain(lists.keptCount(2));
  });

  it("adds how many are kept to the summary line of the queue", () => {
    const { root } = mount(cleanupView, sample);
    const summary = (): string => textOf(all(root, "p.summary")[0]!);
    expect(summary()).not.toContain("kept");
    const total = summary();
    keepButtons(root)[0]!.click();
    expect(summary()).toMatch(/, 1 kept$/);
    keepButtons(root)[0]!.click();
    expect(summary()).toMatch(/, 2 kept$/);
    expect(summary()).not.toBe(total);
  });

  it("appears on the finding pages too, and is gone when the page is left", () => {
    const { root, scope } = mount(disappearedView, sample);
    const first = keepButtons(root)[0]!;
    first.click();
    expect(toastOf(root)).toBeDefined();
    scope.dispose();
    expect(toastOf(root)).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("writes the username only through displayUsername, and never into the title", () => {
    installFakeDom();
    const tricky = "bad‮name​";
    const candidate: Candidate = { key: tricky, category: "ghost", confidence: "high", score: 0.9, evidence: [{ signal: "x", detail: "Missing from your latest export.", weight: 1 }], protectedBy: [] };
    const title = "Cleanup queue";
    (document as unknown as { title: string }).title = title;
    return import("../src/components/candidateRow.ts").then(async ({ candidateRow }) => {
      const { toastHost } = await import("../src/components/toast.ts");
      const kept: string[] = [];
      const wrapper = runInScope(new Scope(true), () => {
        const host = toastHost();
        const row = candidateRow({ candidate, actions: { keep: (u) => void kept.push(u), unkeep: () => undefined } });
        return { host, row };
      });
      const keep = all(wrapper.row as unknown as FakeElement, "button").find((b) => (b.getAttribute("data-key") ?? "").startsWith("keep:"))!;
      keep.click();
      const text = (wrapper.host as unknown as FakeElement).textContent;
      expect(kept).toEqual([tricky]);
      expect(text).toContain("bad?name? is on your keep list.");
      expect(text).not.toMatch(/[‮​]/);
      expect(text.includes(tricky)).toBe(false);
      expect((document as unknown as { title: string }).title).toBe(title);
      expect(spoken.every((m) => !/[‮​]/.test(m))).toBe(true);
    });
  });
});

describe("the Keep toast after its time is up", () => {
  it("starts counting again and leaves the U key with nothing to press", () => {
    vi.useFakeTimers();
    try {
      const { root, store } = mount(cleanupView, sample);
      keepButtons(root)[0]!.click();
      vi.advanceTimersByTime(9000);
      expect(toastOf(root)).toBeUndefined();
      expect(undoToast(), "no toast, nothing to undo").toBe(false);
      expect(store.get().sample?.allowlist).toHaveLength(1);
      keepButtons(root)[0]!.click();
      expect(toastOf(root)?.textContent ?? "").not.toMatch(/2 people/);
    } finally {
      vi.useRealTimers();
    }
  });
});
