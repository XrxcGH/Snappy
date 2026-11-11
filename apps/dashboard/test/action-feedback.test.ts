/**
 * Copy, Save and Open history give a visible note, not only a spoken one: a toast with the same sentence, and for a
 * failed copy or save a visible error. The sentence is spoken through the live region once; the toast is not a live
 * region. Fake clock; synthetic names only.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, common, terminal, tools } from "../src/copy.ts";
import { displayUsername } from "../src/safe.ts";
import { lists } from "../src/copy-lists.ts";
import { shellToastHost } from "../src/components/toast.ts";
import { clearSearches } from "../src/components/listSearch.ts";
import type { State } from "../src/reducer.ts";
import type { View } from "../src/views/context.ts";
import { installFakeDom } from "./fake-dom.ts";
import type { FakeElement } from "./fake-dom.ts";
import { all, byKey, byLabel, mount as mountView, sampleStateOf, textOf } from "./lists-harness.ts";
import { Scope, runInScope } from "../src/reactive.ts";
import { initialState } from "../src/reducer.ts";
import { createStore } from "../src/store.ts";
import { lists as listsCopy } from "../src/copy-lists.ts";
import { testTerminal } from "./terminal-fixture.ts";
import type { Actions } from "../src/actions.ts";

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
// Every page drawn here is left again after its test, so one page's toast host is never the next test's.
const scopes: Scope[] = [];
const mount: typeof mountView = (view, state) => {
  const mounted = mountView(view, state);
  scopes.push(mounted.scope);
  return mounted;
};
beforeEach(() => {
  spoken.length = 0;
  outcome.copy = true;
  outcome.save = true;
  clearSearches();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  for (const scope of scopes.splice(0)) scope.dispose();
});

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

  it("Copy username on a guided Clean-up row says which one, and a failure shows", async () => {
    const { root } = mount(views.queue!, { ...sample, cleanup: { ...sample.cleanup, guided: true } });
    const labeled = all(root, "button").find((b) => textOf(b) === listsCopy.copyUsernameButton)!;
    const name = (labeled.getAttribute("data-key") ?? "").slice("copy:".length);
    labeled.click();
    await flush();
    expect(textOf(toastOf(root)!)).toBe(common.copiedUsername(displayUsername(name)));
    outcome.copy = false;
    labeled.click();
    await flush();
    expect(textOf(toastOf(root)!)).toBe(common.copyFailed);
    expect(toastOf(root)!.getAttribute("class")).toContain("toast-error");
  });
});

describe("a page with no host of its own uses the shell's", () => {
  const draw = (build: () => unknown): { host: FakeElement; made: FakeElement } => {
    installFakeDom();
    const scope = new Scope(true);
    scopes.push(scope);
    const host = shellToastHost() as unknown as FakeElement;
    const made = runInScope(scope, build) as unknown as FakeElement;
    return { host, made };
  };

  it("shows a note for Copy on a command block, and for a failed copy", async () => {
    const { commandBlock } = await import("../src/components/commandBlock.ts");
    for (const copyOnly of [false, true]) {
      const { host, made } = draw(() => commandBlock({ store: createStore(initialState()), actions: {} as Actions, terminal: testTerminal() }, "help", { key: "tab", ...(copyOnly ? { copyOnly: true } : {}) }));
      const copy = byKey(made, "tab:copy")!;
      copy.click();
      await flush();
      expect(textOf(toastOf(host)!), copyOnly ? "copy-only" : "normal").toBe(terminal.copiedCommandAnnounce);
      outcome.copy = false;
      copy.click();
      await flush();
      expect(textOf(toastOf(host)!)).toBe(common.copyFailed);
      expect(toastOf(host)!.getAttribute("class")).toContain("toast-error");
      outcome.copy = true;
    }
  });

  it("shows a note for a saved or failed file offered outside a tool page", async () => {
    const { offerFile } = await import("../src/components/fileOffer.ts");
    const { host } = draw(() => null);
    offerFile({ fileName: "a.txt", text: "x", mime: "text/plain" });
    expect(textOf(toastOf(host)!)).toBe(tools.downloadSaved);
    outcome.save = false;
    offerFile({ fileName: "a.txt", text: "x", mime: "text/plain" });
    expect(textOf(toastOf(host)!)).toBe(tools.downloadFailedNote);
    expect(toastOf(host)!.getAttribute("class")).toContain("toast-error");
  });
});

describe("a note and a Keep toast", () => {
  const keepButton = (root: FakeElement): FakeElement => all(root, "button").find((b) => (b.getAttribute("data-key") ?? "").startsWith("keep:"))!;
  const undoOf = (root: FakeElement): FakeElement | undefined => byLabel(root, listsCopy.undoButton);

  it("a Copy or Save while Keep shows leaves Undo in place, and each goes at its own time", async () => {
    const { root, store } = mount(views.queue!, sample);
    keepButton(root).click();
    vi.advanceTimersByTime(3000);
    byLabel(root, cleanup.copyList)!.click();
    await flush();
    expect(all(root, ".toast")).toHaveLength(2);
    expect(undoOf(root)).toBeDefined();
    expect(textOf(all(root, ".toast")[1]!)).toBe(cleanup.listCopied);
    // Keep's eight seconds were not restarted by the note: it is gone five seconds on, the note three seconds later.
    vi.advanceTimersByTime(5000);
    expect(undoOf(root)).toBeUndefined();
    expect(textOf(toastOf(root)!)).toBe(cleanup.listCopied);
    vi.advanceTimersByTime(3000);
    expect(toastOf(root)).toBeUndefined();
    expect(store.get().sample?.allowlist).toHaveLength(1);
  });

  it("Undo still takes back the latest Keep after a note, and the count goes on", async () => {
    const { root, store } = mount(views.queue!, sample);
    keepButton(root).click();
    byLabel(root, cleanup.saveList)!.click();
    keepButton(root).click();
    expect(textOf(all(root, ".toast")[0]!)).toContain(listsCopy.keptCount(2));
    undoOf(root)!.click();
    expect(store.get().sample?.allowlist).toHaveLength(1);
    expect(textOf(toastOf(root)!)).toBe(cleanup.listSaved);
  });
});
