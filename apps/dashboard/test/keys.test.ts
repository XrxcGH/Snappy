/**
 * Keyboard shortcuts: ? lists them in a dialog, / jumps to the search box, g then a letter goes to a page. Each chord, what
 * is ignored (typing, Ctrl, Meta, Alt, repeats, capitals, an open dialog), the 1.5 second wait after g, and where focus
 * goes when the dialog closes. Rendered in the small fake DOM with a fake clock. Nothing is stored.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createActions } from "../src/actions.ts";
import { announce } from "../src/announce.ts";
import { buildShell } from "../src/app-shell.ts";
import { routes } from "../src/copy.ts";
import type { RouteId } from "../src/copy.ts";
import { shellCopy } from "../src/copy-shell.ts";
import { GO_KEYS, PENDING_MS, SHORTCUTS, installKeys, resetShortcuts } from "../src/keys.ts";
import { initialState } from "../src/reducer.ts";
import { createStore } from "../src/store.ts";
import type { VaultStore } from "../src/vault.ts";
import { testTerminal } from "./terminal-fixture.ts";
import { FakeElement, installFakeDom } from "./fake-dom.ts";

vi.mock("snappy:licenses", () => ({ licenses: [{ name: "Example", license: "MIT", copyright: "Example authors", text: "License text." }] }));
vi.mock("../src/announce.ts", () => ({ announce: vi.fn() }));

type KeyInit = Partial<{ key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; repeat: boolean; defaultPrevented: boolean; target: unknown }>;
interface Pressed {
  defaultPrevented: boolean;
}

let dom: ReturnType<typeof installFakeDom>;
let listeners: ((event: KeyboardEvent) => void)[];
let went: RouteId[];
let stop: () => void;
let search: FakeElement | null;

const target = {
  addEventListener: (_type: "keydown", fn: (event: KeyboardEvent) => void) => void listeners.push(fn),
  removeEventListener: (_type: "keydown", fn: (event: KeyboardEvent) => void) => void (listeners = listeners.filter((l) => l !== fn)),
};

function press(key: string, init: KeyInit = {}): Pressed {
  const event = { key, ctrlKey: false, metaKey: false, altKey: false, repeat: false, defaultPrevented: false, target: dom.body, ...init, preventDefault() { event.defaultPrevented = true; } };
  for (const fn of [...listeners]) fn(event as unknown as KeyboardEvent);
  return event;
}

const pill = (): FakeElement | null => dom.body.querySelector(".keys-pending");
const dialog = (): FakeElement | null => dom.body.querySelector("dialog.shortcuts");

beforeAll(() => {
  dom = installFakeDom();
  // The fake DOM has no <dialog> behavior; this is the part of it the code under test uses.
  const proto = FakeElement.prototype as unknown as { showModal: () => void; close: () => void };
  proto.showModal = function (this: FakeElement) {
    this.open = true;
  };
  proto.close = function (this: FakeElement) {
    if (!this.open) return;
    this.open = false;
    this.fire("close");
  };
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(announce).mockClear();
  listeners = [];
  went = [];
  search = null;
  dom.body.replaceChildren();
  (dom.document as { activeElement: unknown }).activeElement = null;
  stop = installKeys(target, { go: (route) => went.push(route), findSearch: () => search as unknown as HTMLElement | null });
});

afterEach(() => {
  stop();
  resetShortcuts();
  vi.useRealTimers();
});

describe("g then a letter", () => {
  it.each(Object.entries(GO_KEYS))("g %s goes to %s", (letter, route) => {
    expect(press("g").defaultPrevented).toBe(false);
    expect(press(letter).defaultPrevented).toBe(true);
    expect(went).toEqual([route]);
  });

  it("covers Overview, Cleanup, Tools, Memories, Settings and Start, and no letter twice", () => {
    expect(Object.values(GO_KEYS).sort()).toEqual(["cleanup", "memories", "overview", "settings", "start", "tools"]);
    for (const route of Object.values(GO_KEYS)) expect(routes[route]).toBeDefined();
  });

  it("shows a small status and says it once, and both go when the chord ends", () => {
    press("g");
    expect(pill()?.textContent).toBe(`g${shellCopy.goPendingStatus}`);
    expect(pill()?.getAttribute("aria-hidden")).toBe("true");
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith(shellCopy.goPendingAnnounce);
    press("o");
    expect(pill()).toBeNull();
    expect(announce).toHaveBeenCalledTimes(1);
  });

  it("gives up after 1.5 seconds: the status goes and a late letter does nothing", () => {
    press("g");
    vi.advanceTimersByTime(PENDING_MS - 1);
    expect(pill()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(pill()).toBeNull();
    press("o");
    expect(went).toEqual([]);
  });

  it("is cancelled by any other key, which is not swallowed", () => {
    press("g");
    const other = press("x");
    expect(other.defaultPrevented).toBe(false);
    expect(pill()).toBeNull();
    press("o");
    expect(went).toEqual([]);
  });

  it("a letter inside the wait goes once, and a second go needs a new g", () => {
    press("g");
    press("c");
    press("o");
    expect(went).toEqual(["cleanup"]);
  });
});

describe("u undoes the last Keep", () => {
  it("does nothing, and is not swallowed, when no toast is showing", () => {
    expect(press("u").defaultPrevented).toBe(false);
  });

  it("is listed with the other shortcuts", () => {
    expect(SHORTCUTS.some((s) => s.keys.join("") === "u" && s.label() === shellCopy.shortcutUndoKeep)).toBe(true);
  });
});

describe("what the shortcuts ignore", () => {
  const typing: [string, unknown][] = [
    ["an input", new FakeElement("input")],
    ["a textarea", new FakeElement("textarea")],
    ["a select", new FakeElement("select")],
    ["editable text", Object.assign(new FakeElement("div"), { isContentEditable: true })],
  ];
  it.each(typing)("%s: nothing happens", (_label, el) => {
    press("g", { target: el });
    press("o", { target: el });
    expect(went).toEqual([]);
    expect(pill()).toBeNull();
    expect(dialog()).toBeNull();
    press("?", { target: el });
    expect(dialog()).toBeNull();
    search = new FakeElement("input");
    expect(press("/", { target: el }).defaultPrevented).toBe(false);
    expect(search.focusCount).toBe(0);
  });

  it.each(["ctrlKey", "metaKey", "altKey"] as const)("holding %s: nothing happens", (modifier) => {
    press("g", { [modifier]: true });
    expect(pill()).toBeNull();
    press("?", { [modifier]: true });
    expect(dialog()).toBeNull();
  });

  it("a held key, a capital G and a key that was already handled do nothing", () => {
    press("g", { repeat: true });
    press("G");
    press("g", { defaultPrevented: true });
    expect(pill()).toBeNull();
    expect(announce).not.toHaveBeenCalled();
  });

  it("stopping the listener removes it, and a pending status with it", () => {
    press("g");
    stop();
    expect(listeners).toHaveLength(0);
    expect(pill()).toBeNull();
  });
});

describe("/ jumps to the search box", () => {
  it("focuses it and keeps the slash out of the box", () => {
    search = new FakeElement("input");
    expect(press("/").defaultPrevented).toBe(true);
    expect(search.focusCount).toBe(1);
  });

  it("does nothing, and leaves the browser's key alone, on a page with no search", () => {
    expect(press("/").defaultPrevented).toBe(false);
  });
});

describe("? lists the shortcuts", () => {
  const lines = (): string[] => (dialog() as FakeElement).querySelectorAll("dt").map((dt) => dt.textContent);

  it("opens a labelled modal dialog with every shortcut, one line each", () => {
    expect(press("?").defaultPrevented).toBe(true);
    const el = dialog() as FakeElement;
    expect(el.open).toBe(true);
    const title = el.querySelector(`#${el.getAttribute("aria-labelledby")}`) as FakeElement;
    expect(title.textContent).toBe(shellCopy.shortcutsTitle);
    expect(lines()).toHaveLength(SHORTCUTS.length);
    expect(lines()).toContain(`g ${shellCopy.unitThen} o`);
    const rows = el.querySelectorAll("dd").map((dd) => dd.textContent);
    expect(rows).toContain(shellCopy.shortcutGoTo(routes.cleanup.label));
    expect(rows).toContain(shellCopy.shortcutSearch);
    expect(el.querySelectorAll("kbd").length).toBe(SHORTCUTS.reduce((n, s) => n + s.keys.length, 0));
  });

  it("closes with Escape and with its Close button, and focus returns to what had it", () => {
    const opener = new FakeElement("button");
    dom.body.appendChild(opener);
    (dom.document as { activeElement: unknown }).activeElement = opener;
    press("?");
    const el = dialog() as FakeElement;
    el.fire("keydown", { key: "Escape" });
    expect(el.open).toBe(false);
    expect(FakeElement.lastFocused).toBe(opener);

    FakeElement.lastFocused = null;
    press("?");
    expect(el.open).toBe(true);
    (el.querySelector("button") as FakeElement).click();
    expect(el.open).toBe(false);
    expect(FakeElement.lastFocused).toBe(opener);
  });

  it("uses the browser's modal dialog, which keeps focus inside it", () => {
    press("?");
    expect((dialog() as FakeElement).tagName).toBe("dialog");
  });

  it("ignores every other shortcut while it is open, and opens only once", () => {
    press("?");
    press("g");
    press("o");
    press("?");
    expect(went).toEqual([]);
    expect(pill()).toBeNull();
    expect(dom.body.querySelectorAll("dialog.shortcuts")).toHaveLength(1);
  });
});

describe("where the shortcuts are offered", () => {
  it("the shell listens on the window and its footer has a Show shortcuts button that opens the list", () => {
    const added: string[] = [];
    const g = globalThis as Record<string, unknown>;
    g.window = { addEventListener: (type: string) => void added.push(type), removeEventListener: () => {}, scrollTo: () => {} };
    g.location = { hash: "#/start" };
    const noVault: VaultStore = { supported: () => false, read: async () => null, write: async () => {}, clear: async () => {} };
    const store = createStore(initialState());
    const actions = createActions(store, { vault: noVault, clock: () => 0, yieldToUi: async () => {}, saveTheme: () => {} });
    const root = new FakeElement("div");
    buildShell(root as unknown as HTMLElement, { store, actions, terminal: testTerminal() });
    expect(added).toContain("keydown");
    const footerButton = root.querySelector("footer.site-footer .footer-keys button") as FakeElement;
    expect(footerButton.textContent).toBe(shellCopy.showShortcutsButton);
    footerButton.click();
    expect(dialog()?.open).toBe(true);
  });
});
