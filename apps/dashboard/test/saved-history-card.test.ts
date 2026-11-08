/**
 * Settings, Saved history: the exports in the history by date and friend count (never a name), each deletable in two
 * steps, the deletion saved when the history is unlocked, and nothing shown while it is locked. Fake DOM, synthetic data.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { openLedger, syntheticExportZip } from "@snappy-export/core";
import type { Ledger, Snapshot } from "@snappy-export/core";
import { createActions } from "../src/actions.ts";
import type { Actions } from "../src/actions.ts";
import { announce } from "../src/announce.ts";
import { shellCopy } from "../src/copy-shell.ts";
import { Scope, runInScope } from "../src/reactive.ts";
import { initialState, reduce } from "../src/reducer.ts";
import type { State } from "../src/reducer.ts";
import { unpackSaved } from "../src/persist-codec.ts";
import { createStore } from "../src/store.ts";
import type { Store } from "../src/store.ts";
import type { VaultStore } from "../src/vault.ts";
import { testTerminal } from "./terminal-fixture.ts";
import { FakeElement, installFakeDom } from "./fake-dom.ts";

vi.mock("snappy:licenses", () => ({ licenses: [] }));
vi.mock("../src/announce.ts", () => ({ announce: vi.fn() }));

const NOW = Date.UTC(2026, 10, 6, 12);
const PASS = "maple orbit kettle seven river";
let dom: ReturnType<typeof installFakeDom>;
let settingsView: (typeof import("../src/views/settings.ts"))["settingsView"];

const snap = (id: string, takenAt: number, friends: string[]): Snapshot => ({ id, takenAt, source: "export", friends, sentRequests: [], deleted: {}, friendSince: {}, sentAt: {} });
const ledger = (...snapshots: Snapshot[]): Ledger => ({ version: 1, snapshots });
const withLedger = (l: Ledger, patch: Partial<State> = {}): State => ({ ...initialState(), real: { ...initialState().real, ledger: l }, ...patch });

const NAMES = ["zqcanary_one", "zqcanary_two", "zqcanary_three"];
const THREE = ledger(snap("a", Date.UTC(2025, 0, 5), NAMES.slice(0, 1)), snap("b", Date.UTC(2026, 4, 9), NAMES.slice(0, 2)), snap("c", Date.UTC(2026, 10, 6), NAMES));

beforeAll(async () => {
  dom = installFakeDom();
  ({ settingsView } = await import("../src/views/settings.ts"));
});

beforeEach(() => {
  vi.mocked(announce).mockClear();
  FakeElement.lastFocused = null;
  (dom.document as { activeElement: unknown }).activeElement = null;
});

afterEach(() => vi.unstubAllGlobals());

const noVault: VaultStore = { supported: () => false, read: async () => null, write: async () => {}, clear: async () => {} };

function open(state: State, actions?: Actions, store: Store = createStore(state)): { root: FakeElement; store: Store } {
  const a = actions ?? createActions(store, { vault: noVault, clock: () => NOW, yieldToUi: async () => {}, saveTheme: () => {} });
  const root = runInScope(new Scope(true), () => settingsView({ store, actions: a, terminal: testTerminal() })) as unknown as FakeElement;
  return { root, store };
}

const rows = (root: FakeElement): string[] => root.querySelectorAll("li.history-row").map((li) => (li.querySelector(".history-what") as FakeElement).textContent);
const buttonNamed = (root: FakeElement, name: string): FakeElement => {
  const found = root.querySelectorAll("button").find((b) => b.getAttribute("aria-label") === name || b.textContent === name);
  if (!found) throw new Error(`no button ${name}`);
  return found;
};

describe("the list", () => {
  it("shows each export by date and friend count, newest first, and never a name", () => {
    const { root } = open(withLedger(THREE));
    expect(rows(root)).toEqual(["Nov 6, 2026, 3 friends", "May 9, 2026, 2 friends", "Jan 5, 2025, 1 friend"]);
    expect(root.textContent).toContain(shellCopy.historyHeading);
    expect(root.textContent).toContain(shellCopy.historyNote);
    for (const name of NAMES) expect(root.textContent, name).not.toContain(name);
  });

  it("says so when the history holds no export, and shows nothing while it is locked", () => {
    const empty = open(withLedger(ledger())).root;
    expect(empty.textContent).toContain(shellCopy.historyEmpty);
    expect(rows(empty)).toEqual([]);

    const locked = open(withLedger(ledger(), { vault: { supported: true, hasSaved: true, phase: "locked", busy: false } })).root;
    expect(locked.textContent).not.toContain(shellCopy.historyHeading);
  });

  it("shows the real history while sample data is on, and a sample does not change it", () => {
    const sample = { ...initialState().real, ledger: ledger(snap("s", NOW, ["sample_a"])) };
    const { root, store } = open(withLedger(THREE, { sample }));
    expect(rows(root)).toHaveLength(3);
    buttonNamed(root, shellCopy.historyDeleteFor("Nov 6, 2026")).click();
    buttonNamed(root, shellCopy.historyConfirmButton).click();
    expect(store.get().sample?.ledger.snapshots).toHaveLength(1);
    expect(store.get().real.ledger.snapshots.map((s) => s.id)).toEqual(["a", "b"]);
  });
});

describe("deleting one export", () => {
  it("takes two steps: Delete asks, Cancel puts it back with focus on Delete, and nothing is removed", () => {
    const { root, store } = open(withLedger(THREE));
    const del = buttonNamed(root, shellCopy.historyDeleteFor("May 9, 2026"));
    expect(del.textContent).toBe(shellCopy.historyDeleteButton);
    del.click();
    expect(root.textContent).toContain(shellCopy.historyConfirmNote("May 9, 2026"));
    expect((FakeElement.lastFocused as FakeElement).textContent).toBe(shellCopy.historyCancelButton);
    buttonNamed(root, shellCopy.historyCancelButton).click();
    expect((FakeElement.lastFocused as FakeElement).getAttribute("aria-label")).toBe(shellCopy.historyDeleteFor("May 9, 2026"));
    expect(root.textContent).not.toContain(shellCopy.historyConfirmNote("May 9, 2026"));
    expect(store.get().real.ledger.snapshots).toHaveLength(3);
    expect(announce).not.toHaveBeenCalled();
  });

  it("Escape cancels the question, and it is a no-op when nothing is being asked", () => {
    const { root, store } = open(withLedger(THREE));
    const slot = root.querySelectorAll("li.history-row .history-actions")[1] as FakeElement;
    slot.fire("keydown", { key: "Escape" });
    expect(FakeElement.lastFocused).toBeNull();
    buttonNamed(root, shellCopy.historyDeleteFor("May 9, 2026")).click();
    slot.fire("keydown", { key: "Enter" });
    expect(root.textContent).toContain(shellCopy.historyConfirmNote("May 9, 2026"));
    slot.fire("keydown", { key: "Escape" });
    expect(root.textContent).not.toContain(shellCopy.historyConfirmNote("May 9, 2026"));
    expect((FakeElement.lastFocused as FakeElement).getAttribute("aria-label")).toBe(shellCopy.historyDeleteFor("May 9, 2026"));
    expect(store.get().real.ledger.snapshots).toHaveLength(3);
  });

  it("Delete export removes only that export, redraws the list and says so", () => {
    const { root, store } = open(withLedger(THREE));
    buttonNamed(root, shellCopy.historyDeleteFor("May 9, 2026")).click();
    buttonNamed(root, shellCopy.historyConfirmButton).click();
    expect(store.get().real.ledger.snapshots.map((s) => s.id)).toEqual(["a", "c"]);
    expect(rows(root)).toEqual(["Nov 6, 2026, 3 friends", "Jan 5, 2025, 1 friend"]);
    expect(announce).toHaveBeenCalledWith(shellCopy.historyDeletedAnnounce);
  });

  it("is saved when the history is unlocked: the sealed copy holds one export fewer", async () => {
    const files = (phase: 1 | 2, name: string): File => new File([new Uint8Array(syntheticExportZip({ now: NOW, phase, friendCount: 40, chatMessageCount: 200, memoryCount: 20 }))], name, { type: "application/zip" });
    let blob: Uint8Array | null = null;
    const vault: VaultStore = { supported: () => true, read: async () => blob, write: async (bytes) => void (blob = new Uint8Array(bytes)), clear: async () => void (blob = null) };
    const store = createStore(initialState());
    const actions = createActions(store, { vault, clock: () => NOW + 1000, yieldToUi: async () => {}, saveTheme: () => {} });
    await actions.importZips([files(1, "one.zip")]);
    await actions.importZips([files(2, "two.zip")]);
    await actions.sealWith(PASS);
    const before = store.get().real.ledger.snapshots;
    expect(before).toHaveLength(2);

    const { root } = open(store.get(), actions, store);
    expect(rows(root)).toHaveLength(2);
    const newest = [...before].sort((a, b) => b.takenAt - a.takenAt)[0] as Snapshot;
    const label = shellCopy.historyDeleteFor(new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(newest.takenAt)));
    root.querySelectorAll("button").find((b) => b.getAttribute("aria-label") === label)?.click();
    buttonNamed(root, shellCopy.historyConfirmButton).click();
    await actions.settled();
    const saved = unpackSaved(await openLedger(blob as unknown as Uint8Array, PASS));
    expect(saved.ledger.snapshots.map((s) => s.id)).toEqual(store.get().real.ledger.snapshots.map((s) => s.id));
    expect(saved.ledger.snapshots).toHaveLength(1);
    expect(saved.ledger.snapshots.some((s) => s.id === newest.id)).toBe(false);
  }, 60_000);
});

describe("the reducer", () => {
  it("removes one snapshot by id, leaves the rest in order, and ignores an unknown id (same state back)", () => {
    const state = withLedger(THREE);
    const next = reduce(state, { type: "snapshot-removed", id: "b" });
    expect(next.real.ledger.snapshots.map((s) => s.id)).toEqual(["a", "c"]);
    expect(next.real.ledger.version).toBe(1);
    expect(state.real.ledger.snapshots).toHaveLength(3);
    expect(reduce(state, { type: "snapshot-removed", id: "nope" })).toBe(state);
  });
});
