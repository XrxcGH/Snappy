/**
 * Stopping and waiting on the Start page: Cancel while a file is read, the chooser out of reach while reading,
 * and after five seconds the note that large exports take a few minutes, with the time that has passed.
 * Rendered in the small fake DOM; the timers are fake.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Actions } from "../src/actions.ts";
import { startFlow } from "../src/copy-start.ts";
import { Scope, runInScope } from "../src/reactive.ts";
import { initialState } from "../src/reducer.ts";
import { createStore } from "../src/store.ts";
import type { Store } from "../src/store.ts";
import { startView } from "../src/views/start.ts";
import { FakeElement, installFakeDom } from "./fake-dom.ts";
import { testTerminal } from "./terminal-fixture.ts";

vi.mock("../src/announce.ts", () => ({ announce: () => undefined }));

let doc: { activeElement: unknown };
const scrolls: FakeElement[] = [];

beforeAll(() => {
  doc = installFakeDom().document as { activeElement: unknown };
  const proto = FakeElement.prototype as unknown as { focus: () => void; scrollIntoView: () => void };
  const focus = proto.focus;
  proto.focus = function (this: FakeElement) {
    focus.call(this);
    doc.activeElement = this;
  };
  proto.scrollIntoView = function (this: FakeElement) {
    scrolls.push(this);
  };
});

beforeEach(() => {
  scrolls.length = 0;
  doc.activeElement = null;
});

function page(actions: Partial<Actions> = {}): { view: FakeElement; store: Store } {
  const store = createStore(initialState());
  const view = runInScope(new Scope(true), () => startView({ store, actions: actions as Actions, terminal: testTerminal() })) as unknown as FakeElement;
  return { view, store };
}

const statusText = (view: FakeElement): string => view.querySelector(".status")?.textContent ?? "";

describe("Cancel", () => {
  it("is offered while a file is read, and calls the action when pressed", () => {
    let calls = 0;
    const { view, store } = page({ cancelImport: () => void calls++ });
    expect(view.querySelector("[data-key=cancel-import]")).toBeNull();
    store.dispatch({ type: "import-started", steps: 2, sample: false });
    const cancel = view.querySelector("[data-key=cancel-import]") as FakeElement;
    expect(cancel.textContent).toBe("Cancel");
    cancel.click();
    expect(calls).toBe(1);
  });

  it("is not offered for the sample, which is built in a moment", () => {
    const { view, store } = page();
    store.dispatch({ type: "import-started", steps: 3, sample: true });
    expect(view.querySelector(".import-status")).not.toBeNull();
    expect(view.querySelector("[data-key=cancel-import]")).toBeNull();
  });

  it("shows that it was stopped, in view and focused", () => {
    const { view, store } = page();
    store.dispatch({ type: "import-started", steps: 2, sample: false });
    scrolls.length = 0;
    store.dispatch({ type: "import-canceled", message: startFlow.stopped });
    const status = view.querySelector(".import-status") as FakeElement;
    expect(status.textContent).toContain(startFlow.stopped);
    expect(doc.activeElement).toBe(status);
    expect(scrolls).toEqual([status]);
  });
});

describe("the chooser while reading", () => {
  it("keeps the chooser, the folder button, the drop zone and the sample button out of reach, and gives them back afterwards", () => {
    const { view, store } = page();
    const disabled = (key: string): boolean => (view.querySelector(`[data-key=${key}]`) as FakeElement).hasAttribute("disabled");
    const busy = (): boolean => (view.querySelector(".dropzone") as FakeElement).classList.contains("dropzone-busy");
    expect([disabled("choose-files"), disabled("choose-folder"), disabled("try-sample"), busy()]).toEqual([false, false, false, false]);
    store.dispatch({ type: "import-started", steps: 2, sample: false });
    expect([disabled("choose-files"), disabled("choose-folder"), disabled("try-sample"), busy()]).toEqual([true, true, true, true]);
    store.dispatch({ type: "import-canceled", message: startFlow.stopped });
    expect([disabled("choose-files"), disabled("choose-folder"), disabled("try-sample"), busy()]).toEqual([false, false, false, false]);
  });
});

describe("on a long read", () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  const hidden = (view: FakeElement): number => view.querySelectorAll(".status .caption[hidden]").length;

  it("says nothing for five seconds, then that large exports take a few minutes, with the time that has passed", () => {
    const { view, store } = page();
    store.dispatch({ type: "import-started", steps: 2, sample: false, at: Date.now() });
    expect(hidden(view)).toBe(2);
    vi.advanceTimersByTime(4000);
    expect(hidden(view)).toBe(2);
    vi.advanceTimersByTime(2000);
    expect(hidden(view)).toBe(0);
    expect(statusText(view)).toContain(startFlow.slowHint);
    expect(statusText(view)).toContain("0:06 elapsed");
    vi.advanceTimersByTime(60_000);
    expect(statusText(view)).toContain("1:06 elapsed");
  });

  it("counts from when the import started, not from when the page was drawn", () => {
    const { view, store } = page();
    store.dispatch({ type: "import-started", steps: 2, sample: false, at: Date.now() - 125_000 });
    vi.advanceTimersByTime(1000);
    expect(statusText(view)).toContain("2:06 elapsed");
  });

  it("never starts a clock for the sample, and stops it when the read ends", () => {
    const { view, store } = page();
    store.dispatch({ type: "import-started", steps: 3, sample: true, at: Date.now() });
    vi.advanceTimersByTime(30_000);
    expect(statusText(view)).not.toContain("elapsed");
    store.dispatch({ type: "import-reset" });
    expect(vi.getTimerCount()).toBe(0);
    store.dispatch({ type: "import-started", steps: 2, sample: false, at: Date.now() });
    expect(vi.getTimerCount()).toBe(1);
    store.dispatch({ type: "import-canceled", message: startFlow.stopped });
    expect(vi.getTimerCount()).toBe(0);
  });
});
