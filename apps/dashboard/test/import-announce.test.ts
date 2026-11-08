/**
 * One live source for import progress. The reading line was spoken twice: once by the paragraph, which was a live region, and
 * once by an announcement made as the import started. Now the progress block announces its line, once, each time it changes,
 * and nothing else says it. Rendered in the fake DOM with the real actions; announcements are recorded.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createActions } from "../src/actions.ts";
import type { Deps } from "../src/actions.ts";
import { start } from "../src/copy.ts";
import { createImportFlow } from "../src/import-flow.ts";
import { runImport } from "../src/import-pipeline.ts";
import { Scope, runInScope } from "../src/reactive.ts";
import { initialState } from "../src/reducer.ts";
import { createStore } from "../src/store.ts";
import { startView } from "../src/views/start.ts";
import { FakeElement, installFakeDom } from "./fake-dom.ts";
import { NOW, memoryVault, partFiles } from "./export-fixtures.ts";
import { testTerminal } from "./terminal-fixture.ts";

const spoken: { text: string; assertive: boolean }[] = [];
vi.mock("../src/announce.ts", () => ({ announce: (text: string, assertive = false) => void spoken.push({ text, assertive }) }));

beforeAll(() => {
  installFakeDom();
  // The flow goes to the Overview when an export was kept; the address bar is a stand-in here.
  (globalThis as { location?: unknown }).location = { hash: "" };
});
beforeEach(() => void (spoken.length = 0));

function page(overrides: Partial<Deps> = {}) {
  const store = createStore(initialState());
  const actions = createActions(store, { vault: memoryVault(), clock: () => NOW + 1000, yieldToUi: async () => {}, saveTheme: () => {}, ...overrides });
  const ctx = { store, actions, terminal: testTerminal() };
  const view = runInScope(new Scope(true), () => startView(ctx)) as unknown as FakeElement;
  return { store, actions, view, flow: createImportFlow(ctx) };
}

describe("import progress is announced once", () => {
  it("does not make the reading line a live region of its own", async () => {
    const { store, view } = page();
    store.dispatch({ type: "import-started", steps: 2, sample: false });
    const status = view.querySelector(".status") as FakeElement;
    expect(status.querySelectorAll("[role=status]")).toHaveLength(0);
    expect(status.querySelector("p")?.textContent).toBe(start.reading(0, 2));
  });

  it("says each line once as it changes, and not again for the progress ticks within a part", () => {
    const { store } = page();
    store.dispatch({ type: "import-started", steps: 3, sample: false });
    for (const fraction of [0.1, 0.2, 0.3]) store.dispatch({ type: "import-progress", step: 0, fraction });
    store.dispatch({ type: "import-progress", step: 1, fraction: 0.4 });
    store.dispatch({ type: "import-progress", step: 1, fraction: 0.6 });
    expect(spoken.map((s) => s.text)).toEqual([start.reading(0, 3), start.reading(1, 3)]);
  });

  it("says the sample's stages once each", async () => {
    const { actions } = page();
    await actions.loadSample();
    const sample = spoken.map((s) => s.text).filter((t) => t.startsWith("Building sample export"));
    expect(sample).toEqual([start.readingSample(0, 3), start.readingSample(1, 3), start.readingSample(2, 3)]);
  });

  it("does not say the first line a second time when the import was started by the shared flow", async () => {
    const { flow } = page({ runImport: runImport });
    await flow.files(partFiles(2));
    const first = spoken.filter((s) => s.text === start.reading(0, 3));
    expect(first).toHaveLength(1);
    // And the end is still said: once, as the result.
    expect(spoken.some((s) => s.text === start.readDone)).toBe(true);
  });
});
