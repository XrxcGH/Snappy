import { describe, expect, it } from "vitest";
import { openLedger, syntheticExportZip } from "@snappy-export/core";
import { createActions } from "../src/actions.ts";
import type { Actions } from "../src/actions.ts";
import { blobReader } from "../src/blob-reader.ts";
import { initialState } from "../src/reducer.ts";
import { createStore } from "../src/store.ts";
import type { Store } from "../src/store.ts";
import { unpackSaved } from "../src/persist-codec.ts";
import type { VaultStore } from "../src/vault.ts";

const NOW = Date.UTC(2026, 10, 6, 12);
const PASS = "maple orbit kettle seven river";
const SMALL = { friendCount: 40, chatMessageCount: 200, memoryCount: 10 };

function zipFile(phase: 1 | 2, name = `part-${phase}.zip`): File {
  return new File([new Uint8Array(syntheticExportZip({ now: NOW, phase, ...SMALL }))], name, { type: "application/zip" });
}

interface FakeVault extends VaultStore {
  blob: Uint8Array | null;
  writes: number;
  failWrites: boolean;
  failClear: boolean;
}

function fakeVault(blob: Uint8Array | null = null): FakeVault {
  const v: FakeVault = {
    blob,
    writes: 0,
    failWrites: false,
    failClear: false,
    supported: () => true,
    read: async () => v.blob,
    write: async (bytes) => {
      if (v.failWrites) throw new Error("disk full");
      v.blob = new Uint8Array(bytes);
      v.writes++;
    },
    clear: async () => {
      if (v.failClear) throw new Error("blocked");
      v.blob = null;
    },
  };
  return v;
}

function setup(vault: FakeVault = fakeVault()): { store: Store; actions: Actions; vault: FakeVault; themes: string[] } {
  const store = createStore(initialState());
  const themes: string[] = [];
  const actions = createActions(store, { vault, clock: () => NOW + 1000, yieldToUi: async () => {}, saveTheme: (t) => void themes.push(t) });
  return { store, actions, vault, themes };
}

describe("init", () => {
  it("starts in session-only mode when nothing is saved and restores a remembered theme", async () => {
    const { store, actions } = setup();
    await actions.init("dark");
    expect(store.get().vault).toMatchObject({ phase: "session", hasSaved: false, supported: true });
    expect(store.get().theme).toBe("dark");
  });

  it("ignores an unknown theme value and notices saved data", async () => {
    const { store, actions } = setup(fakeVault(new Uint8Array([1, 2, 3])));
    await actions.init("neon");
    // Dark is the default theme: an unknown remembered value leaves it alone.
    expect(store.get().theme).toBe("dark");
    expect(store.get().vault).toMatchObject({ phase: "locked", hasSaved: true });
  });

  it("falls back to session-only when storage is unavailable or throws", async () => {
    const store = createStore(initialState());
    const base = fakeVault();
    const blocked = { ...base, supported: () => false };
    await createActions(store, { vault: blocked, clock: () => NOW, yieldToUi: async () => {}, saveTheme: () => {} }).init(null);
    expect(store.get().vault.supported).toBe(false);

    const store2 = createStore(initialState());
    const throwing = { ...base, read: async () => Promise.reject(new Error("denied")) };
    await createActions(store2, { vault: throwing, clock: () => NOW, yieldToUi: async () => {}, saveTheme: () => {} }).init(null);
    expect(store2.get().vault.supported).toBe(false);
    expect(store2.get().vault.message?.kind).toBe("error");
  });
});

describe("importing exports", () => {
  it("reads zip parts through Blob slices and builds a ledger from separate exports", async () => {
    const { store, actions } = setup();
    expect(await actions.importZips([zipFile(1)])).toBe("done");
    expect(await actions.importZips([zipFile(2)])).toBe("done");
    const real = store.get().real;
    expect(real.ledger.snapshots).toHaveLength(2);
    expect(real.latest?.exportedAt).toBe(NOW);
    expect(store.get().import).toMatchObject({ phase: "done", addedToHistory: true });
  });

  it("keeps the newest export as the latest even when an older one is added last", async () => {
    const { store, actions } = setup();
    await actions.importZips([zipFile(2)]);
    await actions.importZips([zipFile(1)]);
    expect(store.get().real.latest?.exportedAt).toBe(NOW);
    expect(store.get().real.ledger.snapshots).toHaveLength(2);
  });

  it("merges several parts of one export into one snapshot", async () => {
    const { store, actions } = setup();
    await actions.importZips([zipFile(2, "a.zip"), zipFile(2, "b.zip")]);
    expect(store.get().real.ledger.snapshots).toHaveLength(1);
  });

  it("passes the typed friend count to the validation", async () => {
    const { store, actions } = setup();
    actions.setExpectedFriendCount(500);
    await actions.importZips([zipFile(2)]);
    const codes = store.get().real.issues.map((i) => i.code);
    expect(codes.some((c) => /count|friend/i.test(c))).toBe(true);
  });

  it("refuses files that are not zips with a plain message", async () => {
    const { store, actions } = setup();
    const result = await actions.importZips([new File(["hello"], "notes.txt")]);
    expect(result).toBe("failed");
    expect(store.get().import.phase).toBe("failed");
    expect(store.get().import.message).toMatch(/ZIP/);
    expect(store.get().real.ledger.snapshots).toHaveLength(0);
  });

  it("refuses a damaged zip with its issues instead of throwing, and keeps it out of the history", async () => {
    const { store, actions } = setup();
    const result = await actions.importZips([new File([new Uint8Array(500)], "broken.zip")]);
    expect(result).toBe("failed");
    expect(store.get().import.issues?.some((i) => i.severity === "error")).toBe(true);
    expect(store.get().real.ledger.snapshots).toHaveLength(0);
  });

  it("never reads a whole file: only the requested ranges are sliced", async () => {
    const bytes = syntheticExportZip({ now: NOW, phase: 2, ...SMALL });
    let sliced = 0;
    let whole = 0;
    const blob = new Blob([new Uint8Array(bytes)]);
    const spy = {
      size: blob.size,
      slice: (a?: number, b?: number) => {
        sliced++;
        return blob.slice(a, b);
      },
      arrayBuffer: () => {
        whole++;
        return blob.arrayBuffer();
      },
    };
    const reader = blobReader(spy as unknown as Blob);
    expect(await reader.read(0, 4)).toEqual(bytes.slice(0, 4));
    expect(await reader.read(bytes.length - 22, bytes.length)).toEqual(bytes.slice(bytes.length - 22));
    expect(sliced).toBe(2);
    expect(whole).toBe(0);
  });
});

describe("sample data", () => {
  it("loads a labeled sample that never reaches the saved ledger", async () => {
    const vault = fakeVault();
    const { store, actions } = setup(vault);
    await actions.sealWith(PASS);
    const writesAfterSeal = vault.writes;
    expect(await actions.loadSample()).toBe("done");
    expect(store.get().sample).not.toBeNull();
    actions.keep("anyone");
    actions.toggleChecked("anyone");
    await actions.settled();
    expect(store.get().sample?.allowlist).toEqual(["anyone"]);
    expect(store.get().real.allowlist).toEqual([]);
    expect(vault.writes).toBe(writesAfterSeal);
    actions.clearSample();
    expect(store.get().sample).toBeNull();
  });
});

describe("sealed storage", () => {
  it("seals, saves edits, locks, refuses a wrong passphrase, and unlocks with the right one", async () => {
    const vault = fakeVault();
    const { store, actions } = setup(vault);
    await actions.init(null);
    await actions.importZips([zipFile(1)]);
    await actions.importZips([zipFile(2)]);

    expect(await actions.sealWith("too short")).toBe(false);
    expect(vault.blob).toBeNull();
    expect(await actions.sealWith(PASS)).toBe(true);
    expect(store.get().vault).toMatchObject({ phase: "unlocked", hasSaved: true });
    expect(store.get().vault.message?.kind).toBe("success");

    // What is on disk is an opaque sealed blob, not readable usernames, and the passphrase is nowhere in state.
    const blob = vault.blob as Uint8Array;
    expect(new TextDecoder("latin1").decode(blob.slice(0, 4))).toBe("SNPL");
    const asText = new TextDecoder("latin1").decode(blob);
    expect(asText).not.toMatch(/ghost_|active_|friends/);
    expect(JSON.stringify(store.get())).not.toContain(PASS);

    // Edits made while unlocked are saved without being asked.
    actions.keep("ghost_1");
    actions.toggleChecked("ghost_2");
    await actions.settled();
    const saved = unpackSaved(await openLedger(vault.blob as Uint8Array, PASS));
    expect(saved.allowlist).toEqual(["ghost_1"]);
    expect(saved.checkedOff).toEqual(["ghost_2"]);
    expect(saved.ledger.snapshots).toHaveLength(2);

    await actions.lock();
    expect(store.get().real.ledger.snapshots).toHaveLength(0);
    expect(store.get().vault).toMatchObject({ phase: "locked", hasSaved: true });
    expect(vault.blob).not.toBeNull();

    expect(await actions.unlock("wrong wrong wrong wrong")).toBe(false);
    expect(store.get().vault.phase).toBe("locked");
    expect(store.get().vault.message?.text).toMatch(/did not open/);
    expect(store.get().real.ledger.snapshots).toHaveLength(0);

    expect(await actions.unlock(PASS)).toBe(true);
    expect(store.get().vault.phase).toBe("unlocked");
    expect(store.get().real.ledger.snapshots).toHaveLength(2);
    expect(store.get().real.allowlist).toEqual(["ghost_1"]);
    expect(store.get().real.checkedOff).toEqual(["ghost_2"]);
  }, 60_000);

  it("merges what was imported while locked into the saved history on unlock", async () => {
    const vault = fakeVault();
    const first = setup(vault);
    await first.actions.importZips([zipFile(1)]);
    await first.actions.sealWith(PASS);

    // A new tab: the saved blob exists, the session is empty and locked.
    const second = setup(vault);
    await second.actions.init(null);
    expect(second.store.get().vault.phase).toBe("locked");
    await second.actions.importZips([zipFile(2)]);
    expect(await second.actions.sealWith(PASS)).toBe(false); // must unlock first, never overwrite
    expect(second.store.get().vault.message?.text).toMatch(/Unlock your saved data first/);

    expect(await second.actions.unlock(PASS)).toBe(true);
    await second.actions.settled();
    expect(second.store.get().real.ledger.snapshots).toHaveLength(2);
    const saved = unpackSaved(await openLedger(vault.blob as Uint8Array, PASS));
    expect(saved.ledger.snapshots).toHaveLength(2);
  }, 60_000);

  it("deletes everything: blob, memory and the unlocked state", async () => {
    const vault = fakeVault();
    const { store, actions } = setup(vault);
    await actions.importZips([zipFile(2)]);
    await actions.sealWith(PASS);
    expect(vault.blob).not.toBeNull();

    vault.failClear = true;
    expect(await actions.deleteAll()).toBe(false);
    expect(vault.blob).not.toBeNull();
    expect(store.get().real.ledger.snapshots).toHaveLength(1);

    vault.failClear = false;
    expect(await actions.deleteAll()).toBe(true);
    expect(vault.blob).toBeNull();
    expect(store.get().real.ledger.snapshots).toHaveLength(0);
    expect(store.get().vault).toMatchObject({ phase: "session", hasSaved: false });
    // A later edit must not resurrect anything on disk.
    actions.keep("someone");
    await actions.settled();
    expect(vault.blob).toBeNull();
  }, 60_000);

  it("says so when saving fails and stays usable", async () => {
    const vault = fakeVault();
    vault.failWrites = true;
    const { store, actions } = setup(vault);
    await actions.importZips([zipFile(2)]);
    expect(await actions.sealWith(PASS)).toBe(false);
    expect(store.get().vault.message?.text).toMatch(/could not save/);
    expect(store.get().vault.phase).toBe("session");
    expect(store.get().real.ledger.snapshots).toHaveLength(1);
  }, 60_000);

  it("remembers the theme through the injected preference store", () => {
    const { store, actions, themes } = setup();
    actions.setTheme("light");
    expect(store.get().theme).toBe("light");
    expect(themes).toEqual(["light"]);
  });
});

describe("commands that save history", () => {
  it("locks an open history first, so the dashboard cannot write over what the command writes", async () => {
    const vault = fakeVault();
    const { store, actions } = setup(vault);
    await actions.importZips([zipFile(2)]);
    expect(await actions.sealWith(PASS)).toBe(true);
    expect(store.get().vault.phase).toBe("unlocked");
    const writesBefore = vault.writes;

    await actions.beforeStoreRun();
    expect(store.get().vault.phase).toBe("locked");
    expect(store.get().real.ledger.snapshots).toHaveLength(0);
    // Locked means no passphrase is held, so an edit made now cannot save anything.
    actions.keep("someone");
    await actions.settled();
    expect(vault.writes).toBe(writesBefore);
  }, 60_000);

  it("tells the person when a command changed the saved history, and asks them to unlock to see it", async () => {
    const vault = fakeVault();
    const { store, actions } = setup(vault);
    await actions.importZips([zipFile(2)]);
    await actions.sealWith(PASS);
    await actions.lock();
    await actions.beforeStoreRun();
    vault.blob = new Uint8Array([9, 9, 9]); // the command wrote a new file
    await actions.afterStoreRun();
    expect(store.get().vault).toMatchObject({ hasSaved: true, phase: "locked", message: { kind: "success", text: "Saved history updated. Unlock to see it." } });
  }, 60_000);

  it("turns a session-only page into a locked one when a command created the saved history, and keeps what was on screen", async () => {
    const vault = fakeVault();
    const { store, actions } = setup(vault);
    await actions.importZips([zipFile(2)]);
    expect(store.get().vault.phase).toBe("session");
    await actions.beforeStoreRun();
    expect(store.get().vault.phase).toBe("session"); // nothing was open, so nothing is locked
    vault.blob = new Uint8Array([1, 2, 3]);
    await actions.afterStoreRun();
    expect(store.get().vault).toMatchObject({ hasSaved: true, phase: "locked" });
    // What was added before is still in memory and joins the history when it is unlocked.
    expect(store.get().real.ledger.snapshots).toHaveLength(1);
  }, 60_000);

  it("says nothing when the command left the saved history as it was, or the vault cannot be read", async () => {
    const vault = fakeVault(new Uint8Array([5, 5]));
    const { store, actions } = setup(vault);
    await actions.init(null);
    await actions.beforeStoreRun();
    await actions.afterStoreRun();
    expect(store.get().vault.message).toBeUndefined();
    vault.read = async () => {
      throw new Error("blocked");
    };
    await actions.beforeStoreRun();
    vault.blob = new Uint8Array([6]);
    await expect(actions.afterStoreRun()).resolves.toBeUndefined();
    expect(store.get().vault.message).toBeUndefined();
  });
});
