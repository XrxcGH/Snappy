import { reduce } from "./reducer.ts";
import type { Action, State } from "./reducer.ts";

export type Listener = (state: State, previous: State) => void;

export interface Store {
  get(): State;
  dispatch(action: Action): void;
  /** Returns an unsubscribe function. */
  subscribe(listener: Listener): () => void;
}

/** Minimal observable store. Listeners run synchronously, in order; dispatches made by a listener are queued. */
export function createStore(initial: State): Store {
  let state = initial;
  const listeners = new Set<Listener>();
  const queue: Action[] = [];
  let draining = false;

  const drain = (): void => {
    draining = true;
    try {
      for (let action = queue.shift(); action !== undefined; action = queue.shift()) {
        const previous = state;
        state = reduce(state, action);
        if (state !== previous) for (const listener of [...listeners]) listener(state, previous);
      }
    } finally {
      draining = false;
    }
  };

  return {
    get: () => state,
    dispatch(action) {
      queue.push(action);
      if (!draining) drain();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
