/**
 * Self-reported checklist ticks: the person's own word, kept only through the saved-history mechanism that already
 * exists. With saving on they are sealed with the history; otherwise they last this session and are never written.
 * The sample never touches the real list. Lock and Delete data forget them.
 */
import { openLedger, syntheticExportZip } from "@snappy-export/core";
import { describe, expect, it } from "vitest";
import { createActions } from "../../src/actions.ts";
import { privacy, settings } from "../../src/copy.ts";
import { unpackSaved } from "../../src/persist-codec.ts";
import { initialState } from "../../src/reducer.ts";
import { createStore } from "../../src/store.ts";
import type { VaultStore } from "../../src/vault.ts";
import { sampleWorkspace } from "./harness.ts";

const NOW = Date.UTC(2026, 10, 6, 12);
const PASS = "maple orbit kettle seven river";

function setup() {
  const vault: VaultStore & { blob: Uint8Array | null; writes: number } = {
    blob: null,
    writes: 0,
    supported: () => true,
    read: async () => vault.blob,
    write: async (bytes) => {
      vault.blob = new Uint8Array(bytes);
      vault.writes++;
    },
    clear: async () => {
      vault.blob = null;
    },
  };
  const store = createStore(initialState());
  const actions = createActions(store, { vault, clock: () => NOW + 1000, yieldToUi: async () => {}, saveTheme: () => {} });
  return { store, actions, vault };
}

const zip = (): File => new File([new Uint8Array(syntheticExportZip({ now: NOW, phase: 1, friendCount: 20, chatMessageCount: 50, memoryCount: 5 }))], "part-1.zip");

describe("ticks without saving", () => {
  it("are kept for this session, can be undone, and are never written anywhere", async () => {
    const { store, actions, vault } = setup();
    await actions.init(null);
    actions.setTick("safety-checklist:review-devices", true);
    actions.setTick("privacy-tuneup:two-step", true);
    expect(store.get().real.ticks).toEqual(["privacy-tuneup:two-step", "safety-checklist:review-devices"]);
    actions.setTick("privacy-tuneup:two-step", false);
    expect(store.get().real.ticks).toEqual(["safety-checklist:review-devices"]);
    await actions.settled();
    expect(vault.writes).toBe(0);
    expect(vault.blob).toBeNull();
  });

  it("do nothing when the tick is already as asked, so nothing repaints or saves", () => {
    const { store, actions } = setup();
    actions.setTick("a:b", true);
    const before = store.get().real;
    actions.setTick("a:b", true);
    actions.setTick("c:d", false);
    expect(store.get().real).toBe(before);
  });

  it("go to the sample's own list while the sample shows, and the real list is not touched", async () => {
    const { store, actions } = setup();
    store.dispatch({ type: "sample-loaded", workspace: await sampleWorkspace() });
    actions.setTick("safety-checklist:review-devices", true);
    expect(store.get().sample?.ticks).toEqual(["safety-checklist:review-devices"]);
    expect(store.get().real.ticks).toEqual([]);
    actions.clearSample();
    expect(store.get().real.ticks).toEqual([]);
  });
});

describe("ticks with saving on", () => {
  it("are sealed with the history, forgotten on Lock, and back after unlocking", async () => {
    const { store, actions, vault } = setup();
    await actions.init(null);
    await actions.importZips([zip()]);
    expect(await actions.sealWith(PASS)).toBe(true);
    actions.setTick("safety-checklist:review-devices", true);
    await actions.settled();
    const saved = unpackSaved(await openLedger(vault.blob as Uint8Array, PASS));
    expect(saved.ticks).toEqual(["safety-checklist:review-devices"]);
    // What is on disk is sealed: the tick is not readable in it.
    expect(new TextDecoder("latin1").decode(vault.blob as Uint8Array)).not.toContain("review-devices");

    await actions.lock();
    expect(store.get().real.ticks).toEqual([]);
    expect(await actions.unlock(PASS)).toBe(true);
    expect(store.get().real.ticks).toEqual(["safety-checklist:review-devices"]);
  });

  it("made before unlocking are merged into the saved ones, not lost", async () => {
    const { store, actions, vault } = setup();
    await actions.init(null);
    await actions.importZips([zip()]);
    await actions.sealWith(PASS);
    actions.setTick("a:one", true);
    await actions.settled();
    await actions.lock();
    actions.setTick("b:two", true);
    expect(await actions.unlock(PASS)).toBe(true);
    await actions.settled();
    expect(store.get().real.ticks).toEqual(["a:one", "b:two"]);
    expect(unpackSaved(await openLedger(vault.blob as Uint8Array, PASS)).ticks).toEqual(["a:one", "b:two"]);
  });

  it("are gone after Delete data", async () => {
    const { store, actions, vault } = setup();
    await actions.init(null);
    await actions.importZips([zip()]);
    await actions.sealWith(PASS);
    actions.setTick("a:one", true);
    await actions.settled();
    expect(await actions.deleteAll()).toBe(true);
    expect(store.get().real.ticks).toEqual([]);
    expect(vault.blob).toBeNull();
  });
});

describe("what the copy says the sealed history holds", () => {
  it("names the checklist marks wherever it lists what is saved or deleted", () => {
    expect(privacy.sealBody.join(" ")).toMatch(/checklist marks/);
    expect(privacy.keepBody).toMatch(/checklist marks/);
    expect(settings.deleteConfirmBody).toMatch(/checklist marks/);
  });
});
