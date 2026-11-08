/**
 * "Use anyway": an export whose friends list is empty although removed friends are listed is refused, and with
 * nothing saved to compare with the person may go on. With a saved history, or an earlier export in this
 * session, the refusal stands. Synthetic data only.
 */
import { zipSync } from "fflate";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createActions } from "../src/actions.ts";
import type { Actions } from "../src/actions.ts";
import { startFlow } from "../src/copy-start.ts";
import type { ImportRunner } from "../src/import-pipeline.ts";
import { runImport } from "../src/import-pipeline.ts";
import { Scope, runInScope } from "../src/reactive.ts";
import { initialState } from "../src/reducer.ts";
import { createStore } from "../src/store.ts";
import type { Store } from "../src/store.ts";
import type { VaultStore } from "../src/vault.ts";
import { startView } from "../src/views/start.ts";
import { FakeElement, installFakeDom } from "./fake-dom.ts";
import { NOW, memoryVault, partFiles } from "./export-fixtures.ts";
import { testTerminal } from "./terminal-fixture.ts";

vi.mock("../src/announce.ts", () => ({ announce: () => undefined }));

const bytesOf = (bytes: Uint8Array, name: string): File => new File([new Uint8Array(bytes)], name, { type: "application/zip" });
const usernames = (n: number, prefix: string): { Username: string }[] => Array.from({ length: n }, (_, i) => ({ Username: `${prefix}${i}` }));
/** An export whose Friends list is empty and whose Deleted Friends list is not. */
const emptyButDeleted = (name = "mydata~1700000000000.zip"): File =>
  bytesOf(zipSync({ "json/friends.json": [new TextEncoder().encode(JSON.stringify({ Friends: [], "Deleted Friends": usernames(20, "gone_") })), { mtime: new Date(NOW) }] }), name);

function setup(vault: VaultStore = memoryVault(), runner: ImportRunner = runImport): { store: Store; actions: Actions; reads: () => number } {
  const store = createStore(initialState());
  let reads = 0;
  const actions = createActions(store, {
    vault,
    clock: () => NOW + 1000,
    yieldToUi: async () => {},
    saveTheme: () => {},
    runImport: (blobs, hooks) => {
      reads++;
      return runner(blobs, hooks);
    },
  });
  return { store, actions, reads: () => reads };
}

describe("importing an export that is refused but may be overridden", () => {
  it("offers to go on when nothing is saved, and goes on without reading the files again", async () => {
    const { store, actions, reads } = setup();
    expect(await actions.importZips([emptyButDeleted()])).toBe("failed");
    expect(store.get().import).toMatchObject({ phase: "failed", message: expect.stringMatching(/did not use this export/), canOverride: true });
    expect(store.get().import.issues?.some((i) => i.code === "friends-empty-but-deleted" && i.severity === "error")).toBe(true);
    expect(store.get().real.ledger.snapshots).toHaveLength(0);

    expect(await actions.importAnyway()).toBe("done");
    expect(reads()).toBe(1);
    const warning = store.get().real.issues.find((i) => i.code === "friends-empty-but-deleted");
    expect(warning?.severity).toBe("warning");
    expect(store.get().real.issues.some((i) => i.severity === "error")).toBe(false);
    expect(store.get().real.ledger.snapshots).toHaveLength(1);
    expect(store.get().import).toMatchObject({ phase: "done", addedToHistory: true });
  });

  it("keeps the refusal when an earlier export was added in this session", async () => {
    const { store, actions } = setup();
    expect(await actions.importZips(partFiles(2))).toBe("done");
    expect(await actions.importZips([emptyButDeleted()])).toBe("failed");
    expect(store.get().import.canOverride).toBe(false);
    const before = store.get().real;
    expect(await actions.importAnyway()).toBe("failed");
    expect(store.get().real).toBe(before);
    expect(store.get().real.ledger.snapshots).toHaveLength(1);
  });

  it("keeps the refusal when a saved history exists, even locked", async () => {
    const vault: VaultStore = { ...memoryVault(), read: async () => new Uint8Array([1, 2, 3]) };
    const { store, actions } = setup(vault);
    await actions.init(null);
    expect(store.get().vault.phase).toBe("locked");
    expect(await actions.importZips([emptyButDeleted()])).toBe("failed");
    expect(store.get().import.canOverride).toBe(false);
    expect(await actions.importAnyway()).toBe("failed");
    expect(store.get().real.ledger.snapshots).toHaveLength(0);
  });

  it("offers nothing for a refusal that cannot be overridden, such as a damaged file", async () => {
    const { store, actions } = setup();
    expect(await actions.importZips([bytesOf(new Uint8Array(500), "mydata~1700000000000.zip")])).toBe("failed");
    expect(store.get().import.canOverride).toBe(false);
    expect(await actions.importAnyway()).toBe("failed");
    expect(store.get().real.ledger.snapshots).toHaveLength(0);
  });

  it("has nothing to go on with before any import, and forgets the export when the data is deleted or a new import starts", async () => {
    const { store, actions } = setup();
    expect(await actions.importAnyway()).toBe("failed");
    await actions.importZips([emptyButDeleted()]);
    await actions.deleteAll();
    expect(await actions.importAnyway()).toBe("failed");
    expect(store.get().real.ledger.snapshots).toHaveLength(0);

    await actions.importZips([emptyButDeleted()]);
    await actions.importZips([bytesOf(new Uint8Array(500), "mydata~1700000000000.zip")]);
    expect(await actions.importAnyway()).toBe("failed");
  });
});

describe("the Use anyway button", () => {
  beforeAll(() => void installFakeDom());

  function page(actions: Partial<Actions>, store: Store = createStore(initialState())): { view: FakeElement; store: Store } {
    const view = runInScope(new Scope(true), () => startView({ store, actions: actions as Actions, terminal: testTerminal() })) as unknown as FakeElement;
    return { view, store };
  }
  const refuse = (store: Store, canOverride: boolean): void =>
    store.dispatch({ type: "import-failed", message: "Refused.", issues: [{ severity: "error", code: "friends-empty-but-deleted", message: "The friends list is empty." }], canOverride });

  it("is next to the refusal when it may be overridden, and runs the action", () => {
    let calls = 0;
    const { view, store } = page({ importAnyway: async () => (calls++, "failed") });
    refuse(store, true);
    const button = view.querySelector("[data-key=use-anyway]") as FakeElement;
    expect(button.textContent).toBe(startFlow.useAnyway);
    expect(view.querySelector(".import-status")?.textContent).toContain("The friends list is empty.");
    button.click();
    expect(calls).toBe(1);
  });

  it("is not there for a refusal that stands", () => {
    const { view, store } = page({});
    refuse(store, false);
    expect(view.querySelector("[data-key=use-anyway]")).toBeNull();
    expect(view.querySelector(".import-status")?.textContent).toContain("The friends list is empty.");
  });

  it("goes away when a saved history is unlocked", () => {
    const { view, store } = page({});
    refuse(store, true);
    expect(view.querySelector("[data-key=use-anyway]")).not.toBeNull();
    store.dispatch({ type: "vault", patch: { hasSaved: true } });
    expect(view.querySelector("[data-key=use-anyway]")).toBeNull();
  });
});
