/**
 * The import status on Start: one full-width block above the three steps, brought into view and focused
 * when an import starts or fails, and a single cause when the files could not be read at all.
 * Rendered in the small fake DOM; layout does not exist there, so what is checked is where the block is
 * built and what the page was asked to do (scroll, focus). The real position is checked in a browser.
 */
import type { ExportIssue } from "@snappy-export/core";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Actions } from "../src/actions.ts";
import { start } from "../src/copy.ts";
import { Scope, runInScope } from "../src/reactive.ts";
import { initialState } from "../src/reducer.ts";
import { createStore } from "../src/store.ts";
import type { Store } from "../src/store.ts";
import { startView } from "../src/views/start.ts";
import { FakeElement, installFakeDom } from "./fake-dom.ts";
import { testTerminal } from "./terminal-fixture.ts";

vi.mock("../src/announce.ts", () => ({ announce: () => undefined }));

let doc: { activeElement: unknown };
const scrolls: { el: FakeElement; options: unknown }[] = [];

beforeAll(() => {
  doc = installFakeDom().document as { activeElement: unknown };
  const proto = FakeElement.prototype as unknown as { focus: () => void; scrollIntoView: (options?: unknown) => void };
  const focus = proto.focus;
  proto.focus = function (this: FakeElement) {
    focus.call(this);
    doc.activeElement = this;
  };
  proto.scrollIntoView = function (this: FakeElement, options?: unknown) {
    scrolls.push({ el: this, options });
  };
});

beforeEach(() => {
  scrolls.length = 0;
  doc.activeElement = null;
});

function page(): { view: FakeElement; store: Store } {
  const store = createStore(initialState());
  const view = runInScope(new Scope(true), () => startView({ store, actions: {} as Actions, terminal: testTerminal() })) as unknown as FakeElement;
  return { view, store };
}

const issue = (severity: ExportIssue["severity"], code: string, message: string): ExportIssue => ({ severity, code, message });

describe("where the import status is", () => {
  it("is built above the step cards, not inside one of them", () => {
    const { view, store } = page();
    store.dispatch({ type: "import-started", steps: 2, sample: false });
    const status = view.querySelector(".import-status") as FakeElement;
    expect(status).not.toBeNull();
    expect(view.querySelectorAll(".step-card .import-status")).toHaveLength(0);
    // Document order: the status comes before the list of steps.
    const order = view.descendants();
    expect(order.indexOf(status)).toBeLessThan(order.indexOf(view.querySelector(".step-list") as FakeElement));
    // It can take focus (tabindex -1) and has a name.
    expect(status.getAttribute("tabindex")).toBe("-1");
    expect(status.getAttribute("aria-label")).toBe("Import status");
  });

  it("shows nothing when no import has happened", () => {
    const { view } = page();
    expect(view.querySelector(".import-status")).toBeNull();
  });
});

describe("bringing the status to the person", () => {
  it("scrolls the progress into view and focuses it when an import starts", () => {
    const { view, store } = page();
    store.dispatch({ type: "import-started", steps: 3, sample: false });
    const status = view.querySelector(".import-status") as FakeElement;
    expect(scrolls).toEqual([{ el: status, options: { block: "nearest" } }]);
    expect(doc.activeElement).toBe(status);
  });

  it("scrolls and focuses the first error when an import fails, and not again for progress ticks", () => {
    const { view, store } = page();
    store.dispatch({ type: "import-started", steps: 2, sample: false });
    store.dispatch({ type: "import-progress", step: 1, fraction: 0.5 });
    expect(scrolls).toHaveLength(1);
    store.dispatch({ type: "import-failed", message: start.notZip });
    const status = view.querySelector(".import-status") as FakeElement;
    expect(status.textContent).toContain(start.notZip);
    expect(scrolls).toHaveLength(2);
    expect(scrolls[1]?.el).toBe(status);
    expect(doc.activeElement).toBe(status);
  });

  it("moves nothing when an import ends well", () => {
    const { store } = page();
    store.dispatch({ type: "import-started", steps: 1, sample: false });
    scrolls.length = 0;
    store.dispatch({ type: "import-reset" });
    expect(scrolls).toHaveLength(0);
  });
});

describe("what a failure says", () => {
  it("gives only the read error and the help link when the file could not be read at all", () => {
    const { view, store } = page();
    const read = issue("error", "zip-unreadable", "Snappy could not read this file as a ZIP file.");
    const noChats = issue("info", "no-chat-history", "No chat history was found in this export.");
    const noSnaps = issue("info", "no-snap-history", "No Snap history was found in this export.");
    const noFriends = issue("error", "no-friends-section", "This export has no friends list.");
    store.dispatch({ type: "import-failed", message: start.rejected, issues: [read, noFriends, noChats, noSnaps] });
    const status = view.querySelector(".import-status") as FakeElement;
    const text = status.textContent;
    expect(text).toContain(read.message);
    expect(text).not.toContain(start.rejected);
    expect(text).not.toContain(noChats.message);
    expect(text).not.toContain(noSnaps.message);
    expect(status.querySelectorAll(".notice")).toHaveLength(1);
    expect(status.querySelectorAll("a").map((a) => a.getAttribute("href"))).toEqual(["#/guide"]);
  });

  it("keeps the headline and every note when the files were read but the export is incomplete", () => {
    const { view, store } = page();
    const empty = issue("error", "friends-empty-but-deleted", "The friends list is empty.");
    const note = issue("info", "no-chat-history", "No chat history was found in this export.");
    store.dispatch({ type: "import-failed", message: start.rejected, issues: [empty, note] });
    const status = view.querySelector(".import-status") as FakeElement;
    expect(status.querySelectorAll(".notice")).toHaveLength(3);
    expect(status.textContent).toContain(start.rejected);
    expect(status.textContent).toContain(note.message);
  });

  it("leaves out the notes meant only for the inspect report", () => {
    const { view, store } = page();
    const hidden = { ...issue("info", "file-list-truncated", "Only part of the file list is shown."), hidden: true };
    store.dispatch({ type: "import-failed", message: start.rejected, issues: [issue("error", "friends-empty-but-deleted", "The friends list is empty."), hidden] });
    expect((view.querySelector(".import-status") as FakeElement).textContent).not.toContain(hidden.message);
  });
});
