import { describe, expect, it } from "vitest";
import { addSnapshot, emptyLedger, snapshotFromExport } from "@snappy-export/core";
import type { ParsedExport } from "@snappy-export/core";
import { activeWorkspace, emptyWorkspace, initialState, reduce } from "../src/reducer.ts";
import type { Action, State } from "../src/reducer.ts";
import { createStore } from "../src/store.ts";

const parsed = (exportedAt: number | undefined, friends: string[]): ParsedExport => ({
  friends: { friends: friends.map((username) => ({ username })), sentRequests: [], pendingRequests: [], deletedFriends: [], blocked: [], ignored: [], hiddenSuggestions: [] },
  chats: [],
  memories: [],
  exportedAt,
  fileList: [],
  issues: [],
});

const run = (state: State, ...actions: Action[]): State => actions.reduce(reduce, state);

describe("reducer: import", () => {
  it("adds the snapshot to the ledger and makes the export the latest", () => {
    const p = parsed(2000, ["a", "b"]);
    const s = run(initialState(), { type: "import-started", steps: 1, sample: false }, { type: "import-finished", latest: p, issues: [], snapshot: snapshotFromExport(p), now: 9000 });
    expect(s.real.latest).toBe(p);
    expect(s.real.ledger.snapshots).toHaveLength(1);
    expect(s.real.now).toBe(9000);
    expect(s.import.phase).toBe("done");
    expect(s.import.addedToHistory).toBe(true);
  });

  it("keeps the newest export as the latest when an older one is added afterwards", () => {
    const newer = parsed(2000, ["a"]);
    const older = parsed(1000, ["a", "b"]);
    const s = run(
      initialState(),
      { type: "import-finished", latest: newer, issues: [{ severity: "info", code: "new", message: "m" }], snapshot: snapshotFromExport(newer), now: 1 },
      { type: "import-finished", latest: older, issues: [], snapshot: snapshotFromExport(older), now: 2 },
    );
    expect(s.real.latest).toBe(newer);
    expect(s.real.issues.map((i) => i.code)).toEqual(["new"]);
    expect(s.real.ledger.snapshots.map((x) => x.takenAt)).toEqual([1000, 2000]);
  });

  it("does not touch the ledger when no snapshot is given, and ends sample mode", () => {
    const p = parsed(5, []);
    const start = run(initialState(), { type: "sample-loaded", workspace: emptyWorkspace(7) });
    expect(start.sample).not.toBeNull();
    const s = run(start, { type: "import-finished", latest: p, issues: [], snapshot: null, now: 1 });
    expect(s.real.ledger.snapshots).toHaveLength(0);
    expect(s.sample).toBeNull();
    expect(s.import.addedToHistory).toBe(false);
  });
});

describe("reducer: keep list and checkmarks", () => {
  it("edits the active workspace only", () => {
    const withSample = run(initialState(), { type: "sample-loaded", workspace: emptyWorkspace(1) }, { type: "keep", username: "zed" }, { type: "keep", username: "amy" }, { type: "toggle-checked", username: "bo" });
    expect(withSample.sample?.allowlist).toEqual(["amy", "zed"]);
    expect(withSample.sample?.checkedOff).toEqual(["bo"]);
    expect(withSample.real.allowlist).toEqual([]);
    expect(withSample.real.checkedOff).toEqual([]);

    const real = run(withSample, { type: "sample-cleared" }, { type: "keep", username: "cy" });
    expect(real.real.allowlist).toEqual(["cy"]);
    expect(activeWorkspace(real)).toBe(real.real);
  });

  it("toggles, un-keeps and clears", () => {
    let s = run(initialState(), { type: "keep", username: "a" }, { type: "keep", username: "a" }, { type: "toggle-checked", username: "a" });
    expect(s.real.allowlist).toEqual(["a"]);
    expect(s.real.checkedOff).toEqual(["a"]);
    s = run(s, { type: "toggle-checked", username: "a" });
    expect(s.real.checkedOff).toEqual([]);
    s = run(s, { type: "toggle-checked", username: "a" }, { type: "clear-checked" }, { type: "unkeep", username: "a" });
    expect(s.real.checkedOff).toEqual([]);
    expect(s.real.allowlist).toEqual([]);
  });

  it("keeps references stable when nothing changes", () => {
    const s = initialState();
    expect(reduce(s, { type: "clear-checked" }).real).toBe(s.real);
  });
});

describe("reducer: lock, unlock, wipe", () => {
  it("unlock merges saved data with the session's and marks the vault unlocked", () => {
    const session = run(initialState(), { type: "keep", username: "session_kept" }, { type: "vault", patch: { hasSaved: true, phase: "locked" } });
    const savedLedger = addSnapshot(emptyLedger(), snapshotFromExport(parsed(1000, ["a", "b"])));
    const s = run(session, { type: "unlocked", saved: { ledger: savedLedger, allowlist: ["saved_kept"], checkedOff: [] }, now: 77 });
    expect(s.vault.phase).toBe("unlocked");
    expect(s.real.allowlist).toEqual(["saved_kept", "session_kept"]);
    expect(s.real.ledger.snapshots).toHaveLength(1);
    expect(s.real.now).toBe(77);
  });

  it("lock forgets all in-memory data but keeps the theme and the saved flag; wipe also clears the flag", () => {
    const p = parsed(2000, ["a"]);
    const loaded = run(
      initialState(),
      { type: "theme", theme: "light" },
      { type: "import-finished", latest: p, issues: [], snapshot: snapshotFromExport(p), now: 1 },
      { type: "vault", patch: { phase: "unlocked", hasSaved: true } },
    );
    const locked = reduce(loaded, { type: "locked" });
    expect(locked.real.ledger.snapshots).toHaveLength(0);
    expect(locked.real.latest).toBeNull();
    expect(locked.theme).toBe("light");
    expect(locked.vault).toMatchObject({ phase: "locked", hasSaved: true });

    const wiped = reduce(loaded, { type: "wiped" });
    expect(wiped.vault).toMatchObject({ phase: "session", hasSaved: false });
    expect(wiped.real.ledger.snapshots).toHaveLength(0);
  });
});

describe("store", () => {
  it("notifies subscribers with the previous state and queues nested dispatches", () => {
    const store = createStore(initialState());
    const seen: string[] = [];
    store.subscribe((s, prev) => {
      seen.push(`${prev.theme}>${s.theme}`);
      if (s.theme === "light") store.dispatch({ type: "theme", theme: "system" });
    });
    // Dark is the default theme, so the first change starts from dark.
    store.dispatch({ type: "theme", theme: "light" });
    expect(seen).toEqual(["dark>light", "light>system"]);
    expect(store.get().theme).toBe("system");
  });

  it("does not notify when an action changes nothing, or after unsubscribing", () => {
    const store = createStore(initialState());
    let calls = 0;
    const off = store.subscribe(() => void calls++);
    store.dispatch({ type: "clear-checked" });
    expect(calls).toBe(0);
    off();
    store.dispatch({ type: "theme", theme: "light" });
    expect(calls).toBe(0);
  });
});
