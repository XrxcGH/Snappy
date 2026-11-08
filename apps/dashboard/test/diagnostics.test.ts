/**
 * Copy diagnostics, the repository address and What's new in Settings. The diagnostics text is checked for its exact
 * shape, for what it must never hold (usernames, privacy canaries, dates), and for what a locked history shows (no
 * counts). The Settings control is rendered in the small fake DOM. Synthetic data only.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CANARIES, syntheticExportZip } from "@snappy-export/core";
import { createActions } from "../src/actions.ts";
import type { Actions } from "../src/actions.ts";
import { shellCopy, whatsNew } from "../src/copy-shell.ts";
import { REPOSITORY_ADDRESS, buildDiagnostics, systemFamily } from "../src/diagnostics.ts";
import { setPlatform } from "../src/platform.ts";
import { Scope, runInScope } from "../src/reactive.ts";
import { initialState } from "../src/reducer.ts";
import type { State } from "../src/reducer.ts";
import { createStore } from "../src/store.ts";
import type { VaultStore } from "../src/vault.ts";
import { testTerminal } from "./terminal-fixture.ts";
import { FakeElement, installFakeDom } from "./fake-dom.ts";

vi.mock("snappy:licenses", () => ({ licenses: [{ name: "Example", license: "MIT", copyright: "Example authors", text: "License text." }] }));
vi.mock("../src/announce.ts", () => ({ announce: vi.fn() }));

const NOW = Date.UTC(2026, 10, 6, 12);
const PASS = "maple orbit kettle seven river";
const EDGE = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0";
const noVault: VaultStore = { supported: () => false, read: async () => null, write: async () => {}, clear: async () => {} };

afterEach(() => {
  setPlatform({});
  vi.unstubAllGlobals();
});

describe("the shape of the diagnostics", () => {
  it("an empty web page, line by line", () => {
    expect(buildDiagnostics(initialState(), {}, { userAgent: EDGE })).toBe(
      [
        "Snappy 0.1.0 (web)",
        "System: Windows, Edge 130",
        "Saved history: off",
        "Sample data: off",
        "Exports read: 0",
        "Counts: none loaded",
        "Findings: disappeared 0, requests 0, quiet 0, cleanup 0, protected 0",
        "Issue codes: none",
      ].join("\n"),
    );
  });

  it("names the installed build and its version, and the three words about the saved history", () => {
    const platform = { desktop: "windows", release: { version: "0.1.0-beta.2", beta: true } } as const;
    const first = buildDiagnostics(initialState(), platform, { userAgent: EDGE }).split("\n");
    expect(first[0]).toBe("Snappy 0.1.0-beta.2 (Windows desktop)");
    const unlocked: State = { ...initialState(), vault: { supported: true, hasSaved: true, phase: "unlocked", busy: false } };
    expect(buildDiagnostics(unlocked, platform, {})).toContain("Saved history: sealed, unlocked");
    expect(buildDiagnostics({ ...initialState(), vault: { supported: false, hasSaved: false, phase: "session", busy: false } }, platform, {})).toContain("Saved history: unavailable");
    expect(buildDiagnostics({ ...initialState(), sample: initialState().real }, platform, {})).toContain("Sample data: on");
    expect(buildDiagnostics(initialState(), { desktop: "macos" }, {}).split("\n")[0]).toBe("Snappy 0.1.0 (macOS desktop)");
  });

  it("gives the system family and the browser's major version, never the user agent", () => {
    expect(systemFamily(EDGE)).toBe("Windows, Edge 130");
    expect(systemFamily("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15")).toBe("macOS, Safari 17");
    expect(systemFamily("Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0")).toBe("Linux, Firefox 125");
    expect(systemFamily(undefined)).toBe("unknown system, unknown browser");
    expect(buildDiagnostics(initialState(), {}, { userAgent: EDGE })).not.toMatch(/Mozilla|AppleWebKit|537|Gecko/);
  });

  it("shows no counts or findings while the saved history is locked", () => {
    const locked: State = { ...initialState(), vault: { supported: true, hasSaved: true, phase: "locked", busy: false } };
    const text = buildDiagnostics(locked, {}, {});
    expect(text).toContain("Saved history: sealed, locked");
    expect(text).not.toMatch(/Exports read|Counts: |Findings: |Issue codes/);
    expect(text).toContain("not shown while the saved history is locked");
  });

  it("drops an issue code that is not a plain fixed word", () => {
    const state: State = { ...initialState(), real: { ...initialState().real, issues: [{ severity: "warning", code: "nested-zip", message: "x" }, { severity: "warning", code: "Ghost_1 was here", message: "x" }, { severity: "info", code: "nested-zip", message: "x" }] } };
    expect(buildDiagnostics(state, {}, {})).toContain("Issue codes: nested-zip\n".trimEnd());
    expect(buildDiagnostics(state, {}, {})).not.toMatch(/Ghost/i);
  });
});

describe("what the diagnostics never hold", () => {
  const files = (phase: 1 | 2, name: string): File => new File([new Uint8Array(syntheticExportZip({ now: NOW, phase, friendCount: 40, chatMessageCount: 200, memoryCount: 20 }))], name, { type: "application/zip" });

  it("holds no username, no canary and no date after two real exports are read and sealed", async () => {
    const store = createStore(initialState());
    const actions: Actions = createActions(store, { vault: { ...noVault, supported: () => true, write: async () => {} }, clock: () => NOW + 1000, yieldToUi: async () => {}, saveTheme: () => {} });
    expect(await actions.importZips([files(1, "one.zip")])).toBe("done");
    expect(await actions.importZips([files(2, "two.zip")])).toBe("done");
    await actions.sealWith(PASS);

    const state = store.get();
    const names = state.real.latest?.friends.friends.map((f) => f.username) ?? [];
    expect(names.length).toBeGreaterThan(10);
    const text = buildDiagnostics(state, { desktop: "windows", release: { version: "0.1.0-beta.2", beta: true } }, { userAgent: EDGE });

    // Premise: there is something to count, so the check is not passing on an empty page.
    expect(text).toMatch(/Exports read: 2, latest export parts: 1\b/);
    expect(text).toMatch(/Counts: friends [1-9]\d*, requests sent \d+, memories [1-9]\d*/);
    for (const name of names) expect(text, name).not.toContain(name);
    for (const canary of Object.values(CANARIES).flat()) expect(text, canary).not.toContain(canary);
    // No export date or any other date: the only digits are counts and the version.
    expect(text).not.toMatch(/\b(19|20)\d{2}\b|\d{4}-\d{2}-\d{2}/);
    expect(text).not.toMatch(/\.zip|[\\/]|https?:/i);
  }, 60_000);
});

describe("the repository address and What's new", () => {
  it("keeps the newest entry equal to the desktop app's version, with three lines each", () => {
    const conf = JSON.parse(readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../app/src-tauri/tauri.conf.json"), "utf8")) as { version: string };
    expect(whatsNew[0]?.version).toBe(conf.version);
    for (const entry of whatsNew) expect(entry.lines).toHaveLength(3);
  });
});

describe("Settings: help and feedback", () => {
  let settingsView: (typeof import("../src/views/settings.ts"))["settingsView"];
  let clipboard: string[];

  beforeAll(async () => {
    installFakeDom();
    ({ settingsView } = await import("../src/views/settings.ts"));
  });

  const open = (state: State = initialState()): { root: FakeElement; store: ReturnType<typeof createStore> } => {
    clipboard = [];
    vi.stubGlobal("navigator", { userAgent: EDGE, clipboard: { writeText: async (text: string) => void clipboard.push(text) } });
    const store = createStore(state);
    const root = runInScope(new Scope(true), () => settingsView({ store, actions: {} as Actions, terminal: testTerminal() })) as unknown as FakeElement;
    return { root, store };
  };
  const press = async (root: FakeElement, label: string): Promise<void> => {
    const found = root.querySelectorAll("button").find((b) => b.textContent === label);
    if (!found) throw new Error(`no button ${label}`);
    found.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  it("copies the diagnostics for the state as it is at the moment of the press", async () => {
    const { root, store } = open();
    expect(root.textContent).toContain(shellCopy.helpHeading);
    store.dispatch({ type: "vault", patch: { phase: "unlocked", hasSaved: true } });
    await press(root, shellCopy.copyDiagnosticsButton);
    expect(clipboard).toEqual([buildDiagnostics(store.get(), {}, { userAgent: EDGE })]);
    expect(clipboard[0]).toContain("Saved history: sealed, unlocked");
  });

  it("shows the repository address as text with a Copy button and no link", async () => {
    const { root } = open();
    const code = root.querySelector("code.repository") as FakeElement;
    expect(code.textContent).toBe(REPOSITORY_ADDRESS);
    expect(root.querySelectorAll("a").filter((a) => /github/.test(a.getAttribute("href") ?? ""))).toEqual([]);
    await press(root, shellCopy.copyAddressButton);
    expect(clipboard).toEqual([REPOSITORY_ADDRESS]);
  });

  it("says what is new only for the version that is running", () => {
    // The web build: no entry for 0.1.0, so no list.
    expect(open().root.textContent).not.toContain(shellCopy.whatsNewHeading);

    // An installed beta: the list for its version.
    setPlatform({ desktop: "windows", release: { version: "0.1.0-beta.2", beta: true } });
    const installed = open().root;
    expect(installed.textContent).toContain(shellCopy.whatsNewHeading);
    for (const line of whatsNew[0]?.lines ?? []) expect(installed.textContent).toContain(line);

    // A version with no entry shows no list at all.
    setPlatform({ desktop: "windows", release: { version: "9.9.9", beta: false } });
    expect(open().root.textContent).not.toContain(shellCopy.whatsNewHeading);
  });
});
