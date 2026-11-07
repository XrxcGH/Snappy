import type { Actions } from "../actions.ts";
import type { RouteId } from "../copy.ts";
import type { State } from "../reducer.ts";
import type { Store } from "../store.ts";

export interface ViewContext {
  store: Store;
  actions: Actions;
}

export type View = (ctx: ViewContext) => HTMLElement;

export function navigate(route: RouteId): void {
  location.hash = `#/${route}`;
}

/** What most data views repaint on: the active data, either workspace, and the storage cap. */
export const dataDeps = (s: State): readonly unknown[] => [s.sample, s.real, s.capGiB];
