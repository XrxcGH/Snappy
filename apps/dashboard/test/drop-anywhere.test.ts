/**
 * Dropping files anywhere on the page: a note while files are dragged over the window, a drop goes to Start and runs the
 * shared import, drags of text are ignored, a busy page refuses, and the Start page's own drop zone is not run twice.
 * Handlers are tried on a stand-in window; the note is built in the small fake DOM.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startFlow } from "../src/copy-start.ts";
import { REFUSAL_MS, carriesFiles, installDropAnywhere } from "../src/drop-anywhere.ts";
import type { DropDeps, DropTarget } from "../src/drop-anywhere.ts";
import type { ImportFlow } from "../src/import-flow.ts";
import { FakeElement, installFakeDom } from "./fake-dom.ts";

const spoken: string[] = [];
vi.mock("../src/announce.ts", () => ({ announce: (m: string) => void spoken.push(m) }));

let body: FakeElement;
beforeAll(() => {
  body = installFakeDom().body;
});
beforeEach(() => {
  body.replaceChildren();
  spoken.length = 0;
});

interface Event {
  defaultPrevented: boolean;
  dataTransfer: { types: string[]; dropEffect: string; files: unknown[]; items: unknown[] } | null;
  preventDefault(): void;
}

const drag = (types: string[]): Event => {
  const e: Event = { defaultPrevented: false, dataTransfer: { types, dropEffect: "none", files: [], items: [] }, preventDefault: () => void (e.defaultPrevented = true) };
  return e;
};

function install(busy = false): { fire: (type: string, e: Event) => void; note: () => FakeElement; flows: unknown[]; toStart: number; stop: () => void; deps: DropDeps } {
  const handlers = new Map<string, ((e: never) => void)[]>();
  const target: DropTarget = {
    addEventListener: (type, fn) => void handlers.set(type, [...(handlers.get(type) ?? []), fn as never]),
    removeEventListener: (type, fn) => void handlers.set(type, (handlers.get(type) ?? []).filter((f) => f !== (fn as never))),
  };
  const flows: unknown[] = [];
  const state = { toStart: 0 };
  const flow: ImportFlow = { files: async () => undefined, folder: async () => undefined, drop: async (t) => void flows.push(t) };
  const deps: DropDeps = { flow, isBusy: () => busy, toStart: () => void state.toStart++ };
  const stop = installDropAnywhere(target, deps);
  return {
    fire: (type, e) => void (handlers.get(type) ?? []).forEach((fn) => fn(e as never)),
    note: () => body.querySelector(".drop-overlay") as FakeElement,
    flows,
    get toStart() {
      return state.toStart;
    },
    stop,
    deps,
  };
}

describe("carriesFiles", () => {
  it("is true for a drag that lists Files, and false for text, links and nothing", () => {
    expect(carriesFiles(drag(["Files"]) as unknown as DragEvent)).toBe(true);
    expect(carriesFiles(drag(["text/plain", "Files"]) as unknown as DragEvent)).toBe(true);
    expect(carriesFiles(drag(["text/plain"]) as unknown as DragEvent)).toBe(false);
    expect(carriesFiles({ dataTransfer: null } as unknown as DragEvent)).toBe(false);
  });
});

describe("the note over the window", () => {
  it("is built hidden, says what a drop does, and is out of the reading order", () => {
    const page = install();
    expect(page.note().hasAttribute("hidden")).toBe(true);
    expect(page.note().getAttribute("aria-hidden")).toBe("true");
    expect(page.note().textContent).toBe(startFlow.dropOverlayTitle);
    expect(startFlow.dropOverlayTitle).toBe("Drop your ZIP files to add them");
  });

  it("shows while files are dragged over, stays through nested enters and leaves, and hides when the drag leaves", () => {
    const page = install();
    page.fire("dragenter", drag(["Files"]));
    page.fire("dragenter", drag(["Files"]));
    expect(page.note().hasAttribute("hidden")).toBe(false);
    page.fire("dragleave", drag(["Files"]));
    expect(page.note().hasAttribute("hidden")).toBe(false);
    page.fire("dragleave", drag(["Files"]));
    expect(page.note().hasAttribute("hidden")).toBe(true);
  });

  it("does not show for a drag of text", () => {
    const page = install();
    page.fire("dragenter", drag(["text/plain"]));
    expect(page.note().hasAttribute("hidden")).toBe(true);
  });

  it("is removed with the handlers", () => {
    const page = install();
    page.stop();
    expect(body.querySelector(".drop-overlay")).toBeNull();
  });
});

describe("a drop", () => {
  it("goes to Start and runs the shared import, and hides the note", () => {
    const page = install();
    const enter = drag(["Files"]);
    page.fire("dragenter", enter);
    const drop = drag(["Files"]);
    page.fire("drop", drop);
    expect(page.toStart).toBe(1);
    expect(page.flows).toEqual([drop.dataTransfer]);
    expect(page.note().hasAttribute("hidden")).toBe(true);
    expect(drop.defaultPrevented).toBe(true);
  });

  it("keeps the browser from opening a dropped file, and from opening anything dragged over", () => {
    const page = install();
    const over = drag(["Files"]);
    page.fire("dragover", over);
    expect(over.defaultPrevented).toBe(true);
    expect(over.dataTransfer?.dropEffect).toBe("copy");
    const text = drag(["text/plain"]);
    page.fire("dragover", text);
    expect(text.defaultPrevented).toBe(true);
    expect(text.dataTransfer?.dropEffect).toBe("none");
  });

  it("ignores a drop of text, but still keeps the browser from acting on it", () => {
    const page = install();
    const drop = drag(["text/plain"]);
    page.fire("drop", drop);
    expect(drop.defaultPrevented).toBe(true);
    expect(page.toStart).toBe(0);
    expect(page.flows).toEqual([]);
  });

  it("is refused while a read or a command is running, and says so", () => {
    const page = install(true);
    page.fire("dragenter", drag(["Files"]));
    page.fire("drop", drag(["Files"]));
    expect(page.toStart).toBe(0);
    expect(page.flows).toEqual([]);
    expect(spoken).toEqual([startFlow.busy]);
    expect(page.note().hasAttribute("hidden")).toBe(true);
  });

  it("shows the refusal on screen for a few seconds, not only to a screen reader", () => {
    vi.useFakeTimers();
    try {
      const page = install(true);
      page.fire("drop", drag(["Files"]));
      const refusal = body.querySelector(".drop-refusal") as FakeElement;
      expect(refusal.textContent).toBe(startFlow.busy);
      expect(refusal.querySelectorAll("[role=status]")).toHaveLength(0);
      vi.advanceTimersByTime(REFUSAL_MS);
      expect(refusal.textContent).toBe("");
      page.stop();
      expect(body.querySelector(".drop-refusal")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("is not run twice when the Start page's own drop zone already took it", () => {
    const page = install();
    const drop = drag(["Files"]);
    drop.preventDefault(); // what the drop zone's handler does before the event reaches the window
    page.fire("drop", drop);
    expect(page.flows).toEqual([]);
    expect(page.toStart).toBe(0);
  });
});
