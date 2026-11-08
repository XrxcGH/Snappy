/**
 * The Start intro for someone with no export yet: one line that says they can look around first, and the sample button
 * next to it. Once there are results (an export, a saved history or the sample) the row is gone. Rendered in the fake DOM.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Actions } from "../src/actions.ts";
import { start } from "../src/copy.ts";
import { startFlow } from "../src/copy-start.ts";
import { Scope, runInScope } from "../src/reactive.ts";
import { initialState } from "../src/reducer.ts";
import { buildSampleWorkspace } from "../src/sample.ts";
import { createStore } from "../src/store.ts";
import type { Store } from "../src/store.ts";
import { startView } from "../src/views/start.ts";
import { FakeElement, installFakeDom } from "./fake-dom.ts";
import { partFiles, setup } from "./export-fixtures.ts";
import { testTerminal } from "./terminal-fixture.ts";

vi.mock("../src/announce.ts", () => ({ announce: () => undefined }));

beforeAll(() => void installFakeDom());

function page(actions: Partial<Actions> = {}): { view: FakeElement; store: Store } {
  const store = createStore(initialState());
  const view = runInScope(new Scope(true), () => startView({ store, actions: actions as Actions, terminal: testTerminal() })) as unknown as FakeElement;
  return { view, store };
}
const row = (view: FakeElement): FakeElement | null => view.querySelector(".hero .sample-row");

describe("the first-run row on Start", () => {
  it("says there is no export yet and that the person can look around, with the sample button in the intro", () => {
    const { view } = page();
    const found = row(view) as FakeElement;
    expect(found.querySelector(".sample-lead")?.textContent).toBe("No export yet? You can look around first.");
    const button = found.querySelector("[data-key=try-sample]") as FakeElement;
    expect(button.textContent).toBe(start.sampleButton);
    expect(found.textContent).toContain(start.sampleBody);
    // In the intro, before the three steps: no scrolling to find it.
    const order = view.descendants();
    expect(order.indexOf(button)).toBeLessThan(order.indexOf(view.querySelector(".step-list") as FakeElement));
    expect(startFlow.noExportYet).toBe("No export yet? You can look around first.");
  });

  it("runs the sample when the button is pressed", async () => {
    let calls = 0;
    const { view } = page({ loadSample: async () => (calls++, "failed") });
    (view.querySelector("[data-key=try-sample]") as FakeElement).click();
    expect(calls).toBe(1);
  });

  it("is gone once the sample is loaded, and back when it is cleared", async () => {
    const { view, store } = page();
    store.dispatch({ type: "sample-loaded", workspace: await buildSampleWorkspace() });
    expect(row(view)).toBeNull();
    expect(view.querySelector("[data-key=try-sample]")).toBeNull();
    store.dispatch({ type: "sample-cleared" });
    expect(row(view)).not.toBeNull();
  });

  it("is gone once an export has been read", async () => {
    const { view, store } = page();
    const read = setup();
    await read.actions.importZips(partFiles(2));
    store.dispatch({ type: "import-finished", latest: read.store.get().real.latest as never, issues: [], snapshot: null, now: 1 });
    expect(row(view)).toBeNull();
  });

  it("is gone when a saved history was unlocked, although no export was read in this session", async () => {
    const { view, store } = page();
    const read = setup();
    await read.actions.importZips(partFiles(2));
    store.dispatch({ type: "unlocked", saved: { ledger: read.store.get().real.ledger, allowlist: [], checkedOff: [], ticks: [] }, now: 1 });
    expect(row(view)).toBeNull();
  });
});
