/**
 * Helpers for the tools' tests: the synthetic sample workspace (built once), states with and without data, and
 * a render that waits for a tool's result to land (a tool computes after the page has painted).
 */
import type { Actions } from "../../src/actions.ts";
import { initialState } from "../../src/reducer.ts";
import type { State, Workspace } from "../../src/reducer.ts";
import { Scope, runInScope } from "../../src/reactive.ts";
import { buildSampleWorkspace } from "../../src/sample.ts";
import { createStore } from "../../src/store.ts";
import type { Store } from "../../src/store.ts";
import { TOOLS } from "../../src/tools/registry.ts";
import type { View } from "../../src/views/context.ts";
import { FakeElement, installFakeDom } from "../fake-dom.ts";
import { testTerminal } from "../terminal-fixture.ts";

let sample: Workspace | undefined;

/** The built-in synthetic sample, built once per test file (it does real zip work). */
export async function sampleWorkspace(): Promise<Workspace> {
  installFakeDom();
  sample ??= await buildSampleWorkspace();
  return sample;
}

export const emptyState = (): State => initialState();

/** The sample data showing, as "Use sample data" does. */
export async function sampleState(): Promise<State> {
  return { ...initialState(), sample: await sampleWorkspace() };
}

/** A state holding a real (not sample) export, for tests that need `source: "export"` without the sample flag. */
export function stateWith(workspace: Partial<Workspace>): State {
  const base = initialState();
  return { ...base, real: { ...base.real, ...workspace } };
}

export interface Rendered {
  root: FakeElement;
  store: Store;
  /** The scope the view was drawn in. Disposing it is what leaving the page does. */
  scope: Scope;
}

export function render(view: View, state: State, store: Store = createStore(state)): Rendered {
  installFakeDom();
  const scope = new Scope(true);
  const root = runInScope(scope, () => view({ store, actions: {} as Actions, terminal: testTerminal() })) as unknown as FakeElement;
  return { root, store, scope };
}

/** Waits until no result is being computed on the page, so the result can be inspected. */
export async function settled(root: FakeElement): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (root.querySelector("[aria-busy]") === null) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("The tool did not finish.");
}

export async function renderSettled(view: View, state: State): Promise<Rendered> {
  const r = render(view, state);
  await settled(r.root);
  return r;
}

export interface RenderedToolPage {
  id: string;
  state: "sample" | "empty";
  root: FakeElement;
}

/** Every registered tool's page, drawn with the sample and with no export, each waited for. The shared lint tests read them. */
export async function renderToolPages(): Promise<RenderedToolPage[]> {
  const states = [
    ["sample", await sampleState()],
    ["empty", emptyState()],
  ] as const;
  const out: RenderedToolPage[] = [];
  for (const tool of TOOLS) for (const [state, s] of states) out.push({ id: tool.id, state, root: (await renderSettled(tool.view, s)).root });
  return out;
}
