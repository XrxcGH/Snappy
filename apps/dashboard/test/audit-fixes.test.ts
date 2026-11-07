/**
 * Regression tests for defects found in review: refusing broken exports, untrusted export dates,
 * what lock and delete forget, stale tabs and racing saves, passphrase feedback, and the privacy
 * canary check for everything the dashboard produces. Synthetic data only.
 */
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { CANARIES, buildSyntheticExport, openLedger, syntheticExportZip } from "@snappy-export/core";
import { createActions } from "../src/actions.ts";
import type { Actions } from "../src/actions.ts";
import { analyze } from "../src/analysis.ts";
import { initialState } from "../src/reducer.ts";
import { createStore } from "../src/store.ts";
import type { Store } from "../src/store.ts";
import { queueToCsv, queueToText } from "../src/queue-export.ts";
import { unpackSaved } from "../src/persist-codec.ts";
import { hideInvisible, displayUsername } from "../src/safe.ts";
import { neutralizeCell } from "../src/csv.ts";
import type { VaultStore } from "../src/vault.ts";

const NOW = Date.UTC(2026, 10, 6, 12);
const PASS = "maple orbit kettle seven river";
const SMALL = { friendCount: 40, chatMessageCount: 200, memoryCount: 10 };
/** Large enough that every canary category appears in the export (the same shape the command-line check uses). */
const BIG = { friendCount: 40, chatMessageCount: 200, memoryCount: 20 };

const fileOf = (bytes: Uint8Array, name: string): File => new File([new Uint8Array(bytes)], name, { type: "application/zip" });
const synthetic = (phase: 1 | 2, name = `part-${phase}.zip`, size: typeof SMALL = SMALL): File => fileOf(syntheticExportZip({ now: NOW, phase, ...size }), name);
const jsonZip = (friends: unknown, mtime: Date, name = "bad.zip"): File => fileOf(zipSync({ "json/friends.json": [new TextEncoder().encode(JSON.stringify(friends)), { mtime }] }), name);

interface FakeVault extends VaultStore {
  blob: Uint8Array | null;
  writes: number;
}

function fakeVault(blob: Uint8Array | null = null): FakeVault {
  const v: FakeVault = {
    blob,
    writes: 0,
    supported: () => true,
    read: async () => v.blob,
    write: async (bytes) => {
      v.blob = new Uint8Array(bytes);
      v.writes++;
    },
    clear: async () => {
      v.blob = null;
    },
  };
  return v;
}

function setup(vault: FakeVault = fakeVault()): { store: Store; actions: Actions; vault: FakeVault } {
  const store = createStore(initialState());
  const actions = createActions(store, { vault, clock: () => NOW + 1000, yieldToUi: async () => {}, saveTheme: () => {} });
  return { store, actions, vault };
}

describe("an export with errors is refused, as the command-line tool does", () => {
  const usernames = (n: number, prefix: string): { Username: string }[] => Array.from({ length: n }, (_, i) => ({ Username: `${prefix}${i}` }));

  it("keeps an empty friends list with many deleted friends out of the sealed history and out of the queue", async () => {
    const vault = fakeVault();
    const { store, actions } = setup(vault);
    expect(await actions.importZips([synthetic(2)])).toBe("done");
    expect(await actions.sealWith(PASS)).toBe(true);
    const good = store.get().real;
    const writes = vault.writes;

    const bad = jsonZip({ Friends: [], "Deleted Friends": usernames(20, "gone_") }, new Date(NOW));
    expect(await actions.importZips([bad])).toBe("failed");
    await actions.settled();

    const state = store.get();
    expect(state.import.phase).toBe("failed");
    expect(state.import.message).toMatch(/did not use this export/);
    expect(state.import.issues?.some((i) => i.code === "friends-empty-but-deleted" && i.severity === "error")).toBe(true);
    // Nothing changed: same ledger, same latest export, nothing written.
    expect(state.real.ledger).toBe(good.ledger);
    expect(state.real.latest).toBe(good.latest);
    expect(vault.writes).toBe(writes);
    const saved = unpackSaved(await openLedger(vault.blob as Uint8Array, PASS));
    expect(saved.ledger.snapshots).toHaveLength(1);
    expect(saved.ledger.snapshots.every((s) => s.friends.length > 0)).toBe(true);
  }, 60_000);

  it("suggests no one when the only export is refused", async () => {
    const { store, actions } = setup();
    await actions.importZips([jsonZip({ Friends: [], "Deleted Friends": usernames(20, "gone_") }, new Date(NOW))]);
    const a = analyze(store.get());
    expect(a.source).toBe("none");
    expect(a.queue.summary.total).toBe(0);
    expect(store.get().real.ledger.snapshots).toHaveLength(0);
  });

  it("reports a damaged zip the same way", async () => {
    const { store, actions } = setup();
    expect(await actions.importZips([new File([new Uint8Array(500)], "broken.zip")])).toBe("failed");
    expect(store.get().import.issues?.some((i) => i.severity === "error")).toBe(true);
    expect(store.get().real.ledger.snapshots).toHaveLength(0);
    expect(store.get().real.latest).toBeNull();
  });

  it("clears the refusal when a good export follows", async () => {
    const { store, actions } = setup();
    await actions.importZips([new File([new Uint8Array(500)], "broken.zip")]);
    expect(await actions.importZips([synthetic(2)])).toBe("done");
    expect(store.get().import.issues).toBeUndefined();
    expect(store.get().real.ledger.snapshots).toHaveLength(1);
  });
});

describe("the export date is not trusted when it lies in the future", () => {
  it("dates the snapshot today, says so, and leaves ordering intact", async () => {
    const { store, actions } = setup();
    const future = jsonZip({ Friends: usernames("p_", 5) }, new Date(Date.UTC(2099, 11, 31, 12)), "future.zip");
    expect(await actions.importZips([future])).toBe("done");
    const real = store.get().real;
    expect(real.ledger.snapshots[0]?.takenAt).toBe(NOW + 1000);
    expect(real.issues.map((i) => i.code)).toContain("export-time-future");
    expect(real.issues.map((i) => i.code)).not.toContain("export-time-unknown");

    // A later honest export still sorts after it, so friends are compared in the right order.
    const honest = jsonZip({ Friends: usernames("p_", 4) }, new Date(NOW + 5 * 24 * 60 * 60 * 1000), "honest.zip");
    await actions.importZips([honest]);
    const times = store.get().real.ledger.snapshots.map((s) => s.takenAt);
    expect(times[times.length - 1]).toBeLessThan(Date.UTC(2099, 0, 1));
  });

  function usernames(prefix: string, n: number): { Username: string }[] {
    return Array.from({ length: n }, (_, i) => ({ Username: `${prefix}${i}` }));
  }
});

describe("lock and delete forget the last analysis", () => {
  it("drops the cached analysis even when no data view runs afterwards", async () => {
    const { store, actions } = setup();
    await actions.importZips([synthetic(1)]);
    await actions.importZips([synthetic(2)]);
    const before = store.get();
    const first = analyze(before);
    expect(analyze(before).ghosts).toBe(first.ghosts); // memoised while data is on screen
    await actions.sealWith(PASS);
    await actions.lock();
    // The memo no longer holds the old export: the same inputs are computed afresh.
    expect(analyze(before).ghosts).not.toBe(first.ghosts);
    expect(analyze(store.get()).source).toBe("none");
  }, 60_000);

  it("does the same for delete all and for clearing the sample", async () => {
    const { store, actions } = setup();
    await actions.importZips([synthetic(2)]);
    const s = store.get();
    const a = analyze(s);
    await actions.deleteAll();
    expect(analyze(s).ghosts).not.toBe(a.ghosts);

    await actions.loadSample();
    const sampled = store.get();
    const b = analyze(sampled);
    actions.clearSample();
    expect(analyze(sampled).ghosts).not.toBe(b.ghosts);
  }, 60_000);
});

describe("saving and deleting do not step on each other", () => {
  it("an edit made while delete is pending does not write the data back", async () => {
    const vault = fakeVault();
    const { actions } = setup(vault);
    await actions.importZips([synthetic(2)]);
    await actions.sealWith(PASS);
    const pending = actions.deleteAll();
    actions.keep("someone"); // lands while the delete is still waiting
    expect(await pending).toBe(true);
    await actions.settled();
    expect(vault.blob).toBeNull();
  }, 60_000);

  it("a tab that still says 'session only' does not replace history saved by another tab", async () => {
    const vault = fakeVault();
    const tabA = setup(vault);
    await tabA.actions.init(null);
    const tabB = setup(vault);
    await tabB.actions.init(null); // opened before anything was saved
    await tabA.actions.importZips([synthetic(1)]);
    await tabA.actions.sealWith(PASS);
    const sealedByA = vault.blob;

    await tabB.actions.importZips([synthetic(2)]);
    expect(await tabB.actions.sealWith("another passphrase entirely")).toBe(false);
    expect(vault.blob).toBe(sealedByA);
    expect(tabB.store.get().vault).toMatchObject({ phase: "locked", hasSaved: true });
    expect(tabB.store.get().vault.message?.text).toMatch(/already exists/);
  }, 60_000);
});

describe("passphrase feedback", () => {
  it("says so when a passphrase is long enough in UTF-16 units but too short in characters", async () => {
    const { store, actions } = setup();
    const sixEmoji = "\u{1F510}".repeat(6); // 12 UTF-16 units, 6 characters
    expect(sixEmoji.length).toBe(12);
    expect(await actions.sealWith(sixEmoji)).toBe(false);
    expect(store.get().vault.message).toEqual({ kind: "error", text: "Use at least 12 characters." });
  });
});

describe("what is exported matches what is shown", () => {
  it("replaces right-to-left overrides and zero-width characters with ? in cells", () => {
    expect(neutralizeCell("‮evil.cod")).toBe("?evil.cod");
    expect(neutralizeCell("bob​")).toBe("bob?");
    expect(neutralizeCell("bob​")).not.toBe(neutralizeCell("bob"));
    expect(hideInvisible("a⁦b")).toBe(displayUsername("a⁦b"));
  });
});

describe("privacy canaries: nothing the dashboard shows, saves or exports contains export content", () => {
  const ALL = Object.values(CANARIES).flat();
  const leaks = (text: string, label: string): void => {
    for (const canary of ALL) expect(text, `${label} leaked ${JSON.stringify(canary)}`).not.toContain(canary);
    expect(text, `${label} leaked a download link`).not.toMatch(/demo\.snappy\.invalid|https?:\/\/(?!www\.snapchat\.com\/add\/)/);
  };

  it("premise: the export really contains the canaries and the links", () => {
    const files = buildSyntheticExport({ now: NOW, ...BIG, bundleMedia: true });
    const text = Object.entries(files)
      .filter(([name]) => name.endsWith(".json"))
      .map(([, bytes]) => new TextDecoder().decode(bytes))
      .join(" ");
    for (const [category, list] of Object.entries<string[]>(CANARIES as unknown as Record<string, string[]>)) {
      expect(list.some((c) => text.includes(c)), `no ${category} canary in the export`).toBe(true);
    }
    expect(text).toContain("demo.snappy.invalid");
  });

  it("the CSV, the copied list, the issue messages and the decrypted vault hold usernames and fixed text only", async () => {
    const vault = fakeVault();
    const { store, actions } = setup(vault);
    await actions.importZips([synthetic(1, "one.zip", BIG)]);
    await actions.importZips([synthetic(2, "two.zip", BIG)]);
    await actions.sealWith(PASS);
    actions.keep("ghost_1");
    await actions.settled();

    const a = analyze(store.get());
    expect(a.queue.items.length).toBeGreaterThan(0);
    leaks(queueToCsv(a.queue.items), "csv");
    leaks(queueToText(a.queue.items), "copied list");
    leaks(JSON.stringify(a.queue), "queue and evidence");
    leaks(JSON.stringify(store.get().real.issues), "issues");
    leaks(JSON.stringify(store.get().import), "import status");

    const plain = JSON.stringify(unpackSaved(await openLedger(vault.blob as Uint8Array, PASS)));
    leaks(plain, "decrypted vault");
    // Sealed bytes are opaque: the decrypted check above is the meaningful one.
    leaks(new TextDecoder("latin1").decode(vault.blob as Uint8Array), "sealed bytes");
  }, 60_000);
});

describe("the import path reads only ranges of the file", () => {
  it("never loads a whole zip while importing", async () => {
    const bytes = syntheticExportZip({ now: NOW, phase: 2, ...SMALL });
    const blob = new Blob([new Uint8Array(bytes)]);
    const calls = { slice: 0, whole: 0, widest: 0 };
    const spy = {
      name: "spy.zip",
      size: blob.size,
      slice: (a?: number, b?: number) => {
        calls.slice++;
        calls.widest = Math.max(calls.widest, (b ?? blob.size) - (a ?? 0));
        return blob.slice(a, b);
      },
      arrayBuffer: () => (calls.whole++, blob.arrayBuffer()),
      text: () => (calls.whole++, blob.text()),
      stream: () => (calls.whole++, blob.stream()),
    };
    const { store, actions } = setup();
    expect(await actions.importZips([spy as unknown as File])).toBe("done");
    expect(store.get().real.latest).not.toBeNull();
    expect(calls.whole).toBe(0);
    expect(calls.slice).toBeGreaterThan(2);
  });
});
