/**
 * The reload guard: the browser is asked to confirm a reload or close only when results of the person's own export
 * would be lost, never for sample data or a saved history that is open, and a page reloaded onto a results page lands
 * on Start with a line that says what happened. Synthetic data only.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Actions } from "../src/actions.ts";
import { startFlow } from "../src/copy-start.ts";
import { Scope, runInScope } from "../src/reactive.ts";
import { initialState, reduce } from "../src/reducer.ts";
import type { State } from "../src/reducer.ts";
import { buildSampleWorkspace } from "../src/sample.ts";
import { createStore } from "../src/store.ts";
import { clearReloadNote, installUnloadGuard, noteReload, reloadNotePending, reloadedOntoResults, shouldGuard } from "../src/unload-guard.ts";
import type { UnloadTarget } from "../src/unload-guard.ts";
import { startView } from "../src/views/start.ts";
import { FakeElement, installFakeDom } from "./fake-dom.ts";
import { partFiles, setup } from "./export-fixtures.ts";
import { testTerminal } from "./terminal-fixture.ts";

vi.mock("../src/announce.ts", () => ({ announce: () => undefined }));

async function afterImport(): Promise<State> {
  const { store, actions } = setup();
  await actions.importZips(partFiles(2));
  return store.get();
}

describe("shouldGuard", () => {
  it("guards an export that was read and not saved", async () => {
    const state = await afterImport();
    expect(state.vault.phase).toBe("session");
    expect(shouldGuard(state)).toBe(true);
  });

  it("guards an export added while a saved history is still locked, which joins the history only when it is unlocked", async () => {
    const state = await afterImport();
    expect(shouldGuard({ ...state, vault: { ...state.vault, phase: "locked", hasSaved: true } })).toBe(true);
  });

  it("does not guard once the history is open and saving every change", async () => {
    const state = await afterImport();
    expect(shouldGuard({ ...state, vault: { ...state.vault, phase: "unlocked", hasSaved: true } })).toBe(false);
  });

  it("does not guard an empty page, or sample data, however much of it there is", async () => {
    expect(shouldGuard(initialState())).toBe(false);
    const sample = await buildSampleWorkspace();
    expect(shouldGuard({ ...initialState(), sample })).toBe(false);
  });

  it("guards marks the person made, even before any export: a keep list, checked names, ticks", () => {
    const base = initialState();
    expect(shouldGuard(reduce(base, { type: "keep", username: "someone" }))).toBe(true);
    expect(shouldGuard({ ...base, real: { ...base.real, allowlist: ["someone"] } })).toBe(true);
    expect(shouldGuard({ ...base, real: { ...base.real, checkedOff: ["someone"] } })).toBe(true);
    expect(shouldGuard({ ...base, real: { ...base.real, ticks: ["tool:item"] } })).toBe(true);
  });
});

describe("installUnloadGuard", () => {
  function target(): { target: UnloadTarget; fire: () => { prevented: boolean; returnValue: unknown }; listeners: () => number } {
    const fns = new Set<(e: BeforeUnloadEvent) => void>();
    return {
      target: { addEventListener: (_t, fn) => void fns.add(fn), removeEventListener: (_t, fn) => void fns.delete(fn) },
      fire: () => {
        const event = { prevented: false, returnValue: undefined as unknown, preventDefault() { this.prevented = true; } };
        fns.forEach((fn) => fn(event as unknown as BeforeUnloadEvent));
        return event;
      },
      listeners: () => fns.size,
    };
  }

  it("asks the browser to confirm when there is something to lose, and not otherwise", async () => {
    const store = createStore(initialState());
    const t = target();
    installUnloadGuard(t.target, store);
    expect(t.fire().prevented).toBe(false);
    const { store: real, actions } = setup();
    await actions.importZips(partFiles(2));
    store.dispatch({ type: "import-finished", latest: real.get().real.latest as never, issues: [], snapshot: null, now: 1 });
    const asked = t.fire();
    expect(asked.prevented).toBe(true);
    expect(asked.returnValue).toBe("");
    store.dispatch({ type: "wiped" });
    expect(t.fire().prevented).toBe(false);
  });

  it("is removed with the function it returns", () => {
    const t = target();
    const off = installUnloadGuard(t.target, createStore(initialState()));
    expect(t.listeners()).toBe(1);
    off();
    expect(t.listeners()).toBe(0);
  });
});

describe("reloadedOntoResults", () => {
  it("is true only for a reload onto a page that is empty without results", () => {
    for (const hash of ["#/overview", "#/disappeared", "#/requests", "#/quiet", "#/cleanup", "#/memories"]) expect(reloadedOntoResults("reload", hash)).toBe(true);
    for (const hash of ["#/start", "#/tools", "#/tools/year-in-review", "#/guide", "#/settings", "#/privacy", "", "#main"]) expect(reloadedOntoResults("reload", hash)).toBe(false);
  });

  it("is false for a visit, a link or the back button, whatever the page", () => {
    for (const type of ["navigate", "back_forward", "prerender", undefined]) expect(reloadedOntoResults(type, "#/overview")).toBe(false);
  });
});

describe("the line on Start after a reload", () => {
  beforeAll(() => void installFakeDom());
  beforeEach(() => void clearReloadNote());

  function page(store = createStore(initialState())): { view: FakeElement; store: ReturnType<typeof createStore> } {
    const view = runInScope(new Scope(true), () => startView({ store, actions: {} as Actions, terminal: testTerminal() })) as unknown as FakeElement;
    return { view, store };
  }
  const said = (view: FakeElement): boolean => view.textContent.includes(startFlow.reloaded);

  it("says the results were cleared, when the page was reloaded onto a results page", () => {
    noteReload();
    expect(said(page().view)).toBe(true);
    expect(startFlow.reloaded).toBe("Your results were cleared when this page reloaded.");
  });

  it("says nothing on an ordinary visit", () => {
    expect(said(page().view)).toBe(false);
  });

  it("goes away for good once there is something to show again", async () => {
    noteReload();
    const { view, store } = page();
    expect(said(view)).toBe(true);
    store.dispatch({ type: "sample-loaded", workspace: await buildSampleWorkspace() });
    expect(said(view)).toBe(false);
    expect(reloadNotePending()).toBe(false);
    store.dispatch({ type: "sample-cleared" });
    expect(said(page(store).view)).toBe(false);
  });
});
