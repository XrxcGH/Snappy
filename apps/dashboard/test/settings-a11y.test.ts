/**
 * Keyboard and screen reader behavior of Settings: the license texts can be reached by keyboard and have a name, Escape cancels
 * the delete confirmation, and the theme buttons say what they did and keep focus when they are redrawn.
 * Rendered in the small fake DOM. Synthetic data only.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createActions } from "../src/actions.ts";
import type { Actions } from "../src/actions.ts";
import { announce } from "../src/announce.ts";
import { buildShell, followTheme } from "../src/app-shell.ts";
import { settings, shell } from "../src/copy.ts";
import { shellCopy } from "../src/copy-shell.ts";
import { initialState } from "../src/reducer.ts";
import { Scope, runInScope } from "../src/reactive.ts";
import { createStore } from "../src/store.ts";
import type { Store } from "../src/store.ts";
import type { VaultStore } from "../src/vault.ts";
import { testTerminal } from "./terminal-fixture.ts";
import { FakeElement, installFakeDom } from "./fake-dom.ts";

vi.mock("snappy:licenses", () => ({ licenses: [{ name: "Example font", license: "OFL-1.1", copyright: "Example authors", text: "License text." }] }));
vi.mock("../src/announce.ts", () => ({ announce: vi.fn() }));

const noVault: VaultStore = { supported: () => false, read: async () => null, write: async () => {}, clear: async () => {} };

let dom: ReturnType<typeof installFakeDom>;

beforeAll(() => {
  dom = installFakeDom();
});

beforeEach(() => {
  vi.mocked(announce).mockClear();
  FakeElement.lastFocused = null;
  const g = globalThis as Record<string, unknown>;
  g.window = { addEventListener: () => {}, removeEventListener: () => {}, scrollTo: () => {} };
  g.location = { hash: "#/start" };
  g.matchMedia = () => ({ matches: false, addEventListener: () => {} });
  (dom.document as { activeElement: unknown }).activeElement = null;
  (dom.document.documentElement as unknown as FakeElement).setAttribute("data-theme", "dark");
});

afterEach(() => vi.unstubAllGlobals());

function makeActions(store: Store): Actions {
  return createActions(store, { vault: noVault, clock: () => 0, yieldToUi: async () => {}, saveTheme: () => {} });
}

function openShell(): { root: FakeElement; store: Store } {
  const store = createStore(initialState());
  followTheme(store);
  const root = new FakeElement("div");
  buildShell(root as unknown as HTMLElement, { store, actions: makeActions(store), terminal: testTerminal() });
  return { root, store };
}

async function openSettings(): Promise<{ root: FakeElement; store: Store }> {
  const { settingsView } = await import("../src/views/settings.ts");
  const store = createStore(initialState());
  const root = runInScope(new Scope(true), () => settingsView({ store, actions: makeActions(store), terminal: testTerminal() })) as unknown as FakeElement;
  return { root, store };
}

const buttonLabelled = (root: FakeElement, label: string): FakeElement => {
  const found = root.querySelectorAll("button").find((b) => b.textContent === label);
  if (!found) throw new Error(`no button ${label}`);
  return found;
};

describe("Settings", () => {
  it("makes each license text a named region that the keyboard can reach (A11Y-11)", async () => {
    const { root } = await openSettings();
    const pre = root.querySelector("details.license pre") as FakeElement;
    expect(pre.getAttribute("tabindex")).toBe("0");
    expect(pre.getAttribute("role")).toBe("region");
    // Its name is read from two elements that are on the page: "License text for", then the library's name in the summary.
    const ids = (pre.getAttribute("aria-labelledby") ?? "").split(" ");
    expect(ids).toHaveLength(2);
    const nameOf = (id: string): string => (root.descendants().find((el) => el.getAttribute("id") === id) as FakeElement).textContent;
    expect(ids.map(nameOf)).toEqual([shellCopy.licenseTextLabel, "Example font"]);
    expect(ids.map(nameOf).join(" ")).toBe("License text for Example font");
  });

  it("cancels the delete confirmation with Escape, as Cancel does, and keeps focus on Delete data (A11Y-21)", async () => {
    const { root } = await openSettings();
    buttonLabelled(root, settings.deleteButton).click();
    const confirm = root.querySelector(".confirm") as FakeElement;
    expect(confirm).not.toBeNull();
    // Focus starts on the safe choice.
    expect((FakeElement.lastFocused as FakeElement).textContent).toBe(settings.deleteCancel);

    confirm.fire("keydown", { key: "Enter" });
    expect(root.querySelector(".confirm")).not.toBeNull();

    confirm.fire("keydown", { key: "Escape" });
    expect(root.querySelector(".confirm")).toBeNull();
    expect((FakeElement.lastFocused as FakeElement).getAttribute("data-key")).toBe("delete-start");
    expect(root.textContent).toContain(settings.deleteBody);
    expect(announce).not.toHaveBeenCalled();
  });

  it("says which theme turned on when a Settings theme button is pressed, and keeps focus on that button (A11Y-23)", async () => {
    const { root, store } = await openSettings();
    const group = (): FakeElement => root.querySelector(".segmented-theme") as FakeElement;
    const light = buttonLabelled(group(), settings.themes.light);
    (dom.document as { activeElement: unknown }).activeElement = light;
    light.click();
    expect(store.get().theme).toBe("light");
    expect(announce).toHaveBeenLastCalledWith(shell.themeChangedLight);
    // The control was drawn again, and focus is on the new copy of the same button.
    const after = FakeElement.lastFocused as FakeElement;
    expect(after).not.toBe(light);
    expect(after.getAttribute("data-key")).toBe("theme:light");
    expect(group().contains(after)).toBe(true);
    expect(after.getAttribute("aria-pressed")).toBe("true");

    buttonLabelled(group(), settings.themes.dark).click();
    expect(announce).toHaveBeenLastCalledWith(shell.themeChangedDark);
    buttonLabelled(group(), settings.themes.system).click();
    expect(announce).toHaveBeenLastCalledWith(shellCopy.themeMatchAnnounce);
    expect(announce).toHaveBeenCalledTimes(3);
  });
});
