/**
 * Copy, Save and Open history give a visible note, not only a spoken one: a toast with the same sentence, and for a
 * failed copy or save a visible error. The sentence is spoken through the live region once; the toast is not a live
 * region. Fake clock; synthetic names only.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, common } from "../src/copy.ts";
import { lists } from "../src/copy-lists.ts";
import { clearSearches } from "../src/components/listSearch.ts";
import type { State } from "../src/reducer.ts";
import type { View } from "../src/views/context.ts";
import type { FakeElement } from "./fake-dom.ts";
import { all, byKey, byLabel, mount, sampleStateOf, textOf } from "./lists-harness.ts";

const spoken: string[] = [];
const outcome = { copy: true, save: true };
vi.mock("../src/announce.ts", () => ({ announce: (m: string) => void spoken.push(m) }));
vi.mock("../src/download.ts", () => ({ saveTextFile: () => outcome.save }));
vi.mock("../src/clipboard.ts", () => ({ copyText: async () => outcome.copy }));

let views: Record<string, View>;
let sample: State;

beforeAll(async () => {
  const { disappearedView } = (await import("../src/views/findings.ts")) as Record<string, View>;
  const { cleanupView } = (await import("../src/views/cleanup.ts")) as Record<string, View>;
  const { overviewView } = (await import("../src/views/overview.ts")) as unknown as { overviewView: View };
  views = { ghost: disappearedView!, queue: cleanupView!, overview: overviewView! };
  sample = await sampleStateOf();
}, 120_000);
beforeEach(() => {
  spoken.length = 0;
  outcome.copy = true;
  outcome.save = true;
  clearSearches();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

const toastOf = (root: FakeElement): FakeElement | undefined => all(root, ".toast")[0];
const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("a visible note after Copy, Save and Open", () => {
  it.each(["ghost", "queue"])("%s: Copy list and Save list say so on the page", async (key) => {
    const { root } = mount(views[key]!, sample);
    byLabel(root, cleanup.copyList)!.click();
    await flush();
    expect(textOf(toastOf(root)!)).toBe(cleanup.listCopied);
    expect(spoken).toContain(cleanup.listCopied);
    byLabel(root, cleanup.saveList)!.click();
    expect(textOf(toastOf(root)!)).toBe(cleanup.listSaved);
    expect(toastOf(root)!.querySelectorAll("button")).toHaveLength(0);
  });

  it("a note holds no live region of its own, and goes after eight seconds", () => {
    const { root } = mount(views.ghost!, sample);
    byLabel(root, cleanup.saveList)!.click();
    for (const el of [toastOf(root)!, ...toastOf(root)!.descendants()]) {
      expect(el.getAttribute("aria-live")).toBeNull();
      expect(el.getAttribute("role")).not.toBe("status");
      expect(el.getAttribute("role")).not.toBe("alert");
    }
    vi.advanceTimersByTime(8000);
    expect(toastOf(root)).toBeUndefined();
  });

  it("a failed copy and a failed save show the error, marked as one", async () => {
    const { root } = mount(views.ghost!, sample);
    outcome.copy = false;
    byLabel(root, cleanup.copyList)!.click();
    await flush();
    expect(textOf(toastOf(root)!)).toBe(common.copyFailed);
    expect(toastOf(root)!.getAttribute("class")).toContain("toast-error");
    expect(spoken).toContain(common.copyFailed);
    outcome.save = false;
    byLabel(root, cleanup.saveList)!.click();
    expect(textOf(toastOf(root)!)).toBe(cleanup.saveFailed);
    expect(toastOf(root)!.getAttribute("class")).toContain("toast-error");
  });

  it("Copy username says which one", async () => {
    const { root } = mount(views.queue!, sample);
    const copyButton = all(root, "button").find((b) => (b.getAttribute("data-key") ?? "").startsWith("copy:"))!;
    const name = (copyButton.getAttribute("data-key") ?? "").slice("copy:".length);
    copyButton.click();
    await flush();
    expect(textOf(toastOf(root)!)).toContain("Copied ");
    expect(textOf(toastOf(root)!)).toContain(name.slice(0, 4));
  });

  it("Copy summary on the Overview says so", async () => {
    const { root } = mount(views.overview!, sample);
    expect(byKey(root, "copy-summary")).toBeDefined();
    byKey(root, "copy-summary")!.click();
    await flush();
    expect(textOf(toastOf(root)!)).toBe(lists.summaryCopied);
  });
});
