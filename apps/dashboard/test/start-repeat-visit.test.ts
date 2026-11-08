/**
 * Coming back to Start with exports already read: one line says which export is the latest and how many were read, with
 * the way to the overview, and the third step is "Add a newer export". Nothing is stored for it: it comes from the history.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Actions } from "../src/actions.ts";
import { start } from "../src/copy.ts";
import { startFlow } from "../src/copy-start.ts";
import { formatDate } from "../src/format.ts";
import { Scope, runInScope } from "../src/reactive.ts";
import { initialState } from "../src/reducer.ts";
import { createStore } from "../src/store.ts";
import type { Store } from "../src/store.ts";
import { startView } from "../src/views/start.ts";
import { FakeElement, installFakeDom } from "./fake-dom.ts";
import { partFiles, setup } from "./export-fixtures.ts";
import { testTerminal } from "./terminal-fixture.ts";

vi.mock("../src/announce.ts", () => ({ announce: () => undefined }));

beforeAll(() => void installFakeDom());

function page(store: Store = createStore(initialState())): { view: FakeElement; store: Store } {
  const view = runInScope(new Scope(true), () => startView({ store, actions: {} as Actions, terminal: testTerminal() })) as unknown as FakeElement;
  return { view, store };
}
const heading = (view: FakeElement): string => (view.querySelectorAll(".step-card")[2] as FakeElement).querySelectorAll("h2 span")[1]?.textContent ?? "";

describe("Start with no export read", () => {
  it("has no latest line and keeps the first-visit heading", () => {
    const { view } = page();
    expect(view.querySelector(".latest-line")).toBeNull();
    expect(heading(view)).toBe(start.addHeading);
  });
});

describe("Start with exports read", () => {
  async function read(times: 1 | 2): Promise<Store> {
    const { store, actions } = setup();
    await actions.importZips(partFiles(2));
    if (times === 2) await actions.importZips(partFiles(1));
    return store;
  }

  it("says which export is the latest and how many were read, and links to the overview", async () => {
    const source = await read(1);
    const { view } = page(source);
    const line = view.querySelector(".latest-line") as FakeElement;
    const taken = Math.max(...source.get().real.ledger.snapshots.map((s) => s.takenAt));
    expect(line.textContent).toContain(`Latest export: ${formatDate(taken)}. 1 export read.`);
    expect(line.querySelector("a")?.getAttribute("href")).toBe("#/overview");
    expect(line.querySelector("a")?.textContent).toBe(startFlow.openOverview);
  });

  it("counts every export, and calls the third step Add a newer export", async () => {
    const source = await read(2);
    const { view } = page(source);
    expect(source.get().real.ledger.snapshots.length).toBeGreaterThan(1);
    expect(view.querySelector(".latest-line")?.textContent).toContain(`${source.get().real.ledger.snapshots.length} exports read.`);
    expect(heading(view)).toBe("Add a newer export");
  });

  it("follows the history while the page is open, in both directions", async () => {
    const source = await read(1);
    const { view, store } = page();
    expect(view.querySelector(".latest-line")).toBeNull();
    store.dispatch({ type: "unlocked", saved: { ledger: source.get().real.ledger, allowlist: [], checkedOff: [], ticks: [] }, now: 1 });
    expect(view.querySelector(".latest-line")).not.toBeNull();
    expect(heading(view)).toBe(startFlow.addNewerHeading);
    store.dispatch({ type: "wiped" });
    expect(view.querySelector(".latest-line")).toBeNull();
    expect(heading(view)).toBe(start.addHeading);
  });
});
