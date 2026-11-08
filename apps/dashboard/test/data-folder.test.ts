/**
 * Settings, Saved data, desktop app only: the folder the app keeps its data in, as text with a Copy button and no link.
 * The folder is named by the shell on the platform object; the web build and an app that names none show nothing, and the
 * path never reaches the diagnostics. Fake DOM. The path is made up.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createActions } from "../src/actions.ts";
import { shellCopy } from "../src/copy-shell.ts";
import { dataFolder } from "../src/desktop-folder.ts";
import { buildDiagnostics } from "../src/diagnostics.ts";
import { setPlatform } from "../src/platform.ts";
import type { Platform } from "../src/platform.ts";
import { Scope, runInScope } from "../src/reactive.ts";
import { initialState } from "../src/reducer.ts";
import { createStore } from "../src/store.ts";
import { testTerminal } from "./terminal-fixture.ts";
import { FakeElement, installFakeDom } from "./fake-dom.ts";

vi.mock("snappy:licenses", () => ({ licenses: [] }));
vi.mock("../src/announce.ts", () => ({ announce: vi.fn() }));

const FOLDER = "C:\\Users\\example\\AppData\\Local\\com.snappy.export";
let settingsView: (typeof import("../src/views/settings.ts"))["settingsView"];
let clipboard: string[];

beforeAll(async () => {
  installFakeDom();
  ({ settingsView } = await import("../src/views/settings.ts"));
});
beforeEach(() => {
  clipboard = [];
  vi.stubGlobal("navigator", { userAgent: "x", clipboard: { writeText: async (text: string) => void clipboard.push(text) } });
});
afterEach(() => {
  setPlatform({});
  vi.unstubAllGlobals();
});

function open(): FakeElement {
  const store = createStore(initialState());
  const actions = createActions(store, { vault: { supported: () => false, read: async () => null, write: async () => {}, clear: async () => {} }, clock: () => 0, yieldToUi: async () => {}, saveTheme: () => {} });
  return runInScope(new Scope(true), () => settingsView({ store, actions, terminal: testTerminal() })) as unknown as FakeElement;
}
const desktop = (extra: object): Platform => ({ desktop: "windows", ...extra }) as Platform;

describe("the data folder in Settings", () => {
  it("shows the folder the app named, as text with a Copy button that copies exactly it", async () => {
    setPlatform(desktop({ dataFolder: FOLDER }));
    const root = open();
    expect(dataFolder()).toBe(FOLDER);
    expect((root.querySelector("code.data-folder-path") as FakeElement).textContent).toBe(FOLDER);
    expect(root.textContent).toContain(shellCopy.folderNote);
    // No link and no button that opens it: the app cannot open folders.
    expect(root.querySelectorAll("a").filter((a) => (a.getAttribute("href") ?? "").startsWith("file:"))).toEqual([]);
    const copy = root.querySelectorAll("button").find((b) => b.textContent === shellCopy.copyFolderButton) as FakeElement;
    copy.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(clipboard).toEqual([FOLDER]);
  });

  it("shows nothing in the web build, even if a path were set, and nothing when the app names none", () => {
    setPlatform({ dataFolder: FOLDER } as Platform);
    expect(open().querySelector("code.data-folder-path")).toBeNull();
    expect(dataFolder()).toBeNull();
    for (const bad of [undefined, "", "   ", 5]) {
      setPlatform(desktop({ dataFolder: bad }));
      expect(dataFolder(), String(bad)).toBeNull();
      expect(open().querySelector("code.data-folder-path")).toBeNull();
    }
  });

  it("never reaches the diagnostics", () => {
    const platform = desktop({ dataFolder: FOLDER });
    setPlatform(platform);
    expect(buildDiagnostics(initialState(), platform, { userAgent: "x" })).not.toMatch(/example|AppData|snappy\.export|[\\/]/);
  });
});
