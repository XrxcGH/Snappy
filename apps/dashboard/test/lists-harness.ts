/**
 * Helpers for the tests of the finding lists, the Cleanup queue, the Overview and the Memories page: a real store
 * with the real actions (so a click changes state and the page repaints), the synthetic sample as either the sample
 * or a real export, and small readers for the fake DOM. Synthetic data only.
 */
import { createActions } from "../src/actions.ts";
import type { Actions } from "../src/actions.ts";
import { initialState } from "../src/reducer.ts";
import type { State } from "../src/reducer.ts";
import { Scope, runInScope } from "../src/reactive.ts";
import { createStore } from "../src/store.ts";
import type { Store } from "../src/store.ts";
import type { View } from "../src/views/context.ts";
import type { FakeElement } from "./fake-dom.ts";
import { installFakeDom } from "./fake-dom.ts";
import { testTerminal } from "./terminal-fixture.ts";
import { sampleWorkspace } from "./tools/harness.ts";

export const textOf = (el: FakeElement): string => el.textContent.replace(/\s+/g, " ").trim();
export const all = (el: FakeElement, selector: string): FakeElement[] => el.querySelectorAll(selector);
export const byKey = (root: FakeElement, key: string): FakeElement | undefined => root.descendants().find((e) => e.getAttribute("data-key") === key);
export const byLabel = (root: FakeElement, text: string): FakeElement | undefined => root.descendants().find((e) => (e.tagName === "button" || e.tagName === "a") && textOf(e) === text);

/** The sample showing, as "Use sample data" does. Names are made up and never linked. */
export async function sampleStateOf(): Promise<State> {
  return { ...initialState(), sample: await sampleWorkspace() };
}

/** The same synthetic export held as a real one: profile links are drawn, and the keep list is saved state. */
export async function realStateOf(): Promise<State> {
  return { ...initialState(), real: await sampleWorkspace() };
}

export interface Mounted {
  root: FakeElement;
  store: Store;
  actions: Actions;
  scope: Scope;
}

/** Draw a view with a real store and real actions. */
export function mount(view: View, state: State): Mounted {
  installFakeDom();
  const store = createStore(state);
  const actions = createActions(store, {
    vault: { supported: () => false, read: async () => null, write: async () => undefined, clear: async () => undefined },
    clock: () => state.real.now || 0,
    yieldToUi: async () => undefined,
    saveTheme: () => undefined,
  });
  const scope = new Scope(true);
  const root = runInScope(scope, () => view({ store, actions, terminal: testTerminal() })) as unknown as FakeElement;
  return { root, store, actions, scope };
}
