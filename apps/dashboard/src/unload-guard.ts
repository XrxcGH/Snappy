/**
 * Results live in memory until the person seals them with a passphrase. Reloading or closing the page clears them, and
 * a reload is easy to do by accident (F5, Ctrl+R). This asks the browser to confirm before that happens, but only when
 * there is something real to lose: an export that was read, or marks the person made, and no saved history to bring
 * it back. Sample data is never worth a question. Nothing is stored: the question is the browser's own.
 */
import { parseRoute } from "./route-parse.ts";
import type { State } from "./reducer.ts";
import type { Store } from "./store.ts";

/** True when closing or reloading now would lose results of the person's own export. */
export function shouldGuard(state: State): boolean {
  // Unlocked: every change is saved as it is made. Sample data lives apart (state.sample) and is never counted.
  if (state.vault.phase === "unlocked") return false;
  const real = state.real;
  return real.latest !== null || real.ledger.snapshots.length > 0 || real.allowlist.length > 0 || real.checkedOff.length > 0 || real.ticks.length > 0;
}

/** The few things of a window the guard uses, so it can be tried without a browser. */
export interface UnloadTarget {
  addEventListener(type: "beforeunload", listener: (event: BeforeUnloadEvent) => void): void;
  removeEventListener(type: "beforeunload", listener: (event: BeforeUnloadEvent) => void): void;
}

/** Returns a function that removes the guard. */
export function installUnloadGuard(target: UnloadTarget, store: Store): () => void {
  const guard = (event: BeforeUnloadEvent): void => {
    if (!shouldGuard(store.get())) return;
    // The browser shows its own words; a page cannot change them.
    event.preventDefault();
    event.returnValue = "";
  };
  target.addEventListener("beforeunload", guard);
  return () => target.removeEventListener("beforeunload", guard);
}

/** The pages that are empty without results. After a reload, which cleared them, the person is sent to Start. */
const NEEDS_RESULTS = new Set(["overview", "disappeared", "requests", "quiet", "cleanup", "memories"]);

/**
 * True when the page was reloaded while it showed a page that is empty without results. Reloading cleared the results, so
 * Start is the page to land on, with a line that says what happened. `navigationType` is what the browser reports for
 * this load ("reload", "navigate", "back_forward").
 */
export function reloadedOntoResults(navigationType: string | undefined, hash: string): boolean {
  if (navigationType !== "reload") return false;
  const id = parseRoute(hash);
  return id !== null && NEEDS_RESULTS.has(id);
}

/** Said once, on Start, after a reload cleared the results. Memory only. */
let pending = false;
export const noteReload = (): void => void (pending = true);
export const reloadNotePending = (): boolean => pending;
export const clearReloadNote = (): void => void (pending = false);
