/**
 * Small reactive layer. A region repaints itself when the slice of state it depends on changes,
 * keeps keyboard focus on the same control across repaints, and cleans up its own subscriptions.
 * Views are plain functions that return DOM; regions are where they stay live.
 */
import { h } from "./dom.ts";
import type { Child } from "./dom.ts";
import type { State } from "./reducer.ts";
import type { Store } from "./store.ts";

/** Everything created while a view (or a region repaint) is rendering is cleaned up through its scope. */
export class Scope {
  private readonly disposers: (() => void)[] = [];
  /** True while the view is being painted for the first time: the moment bars slide in, once. */
  firstPaint: boolean;

  constructor(firstPaint: boolean) {
    this.firstPaint = firstPaint;
  }

  add(dispose: () => void): void {
    this.disposers.push(dispose);
  }

  dispose(): void {
    for (const d of this.disposers.splice(0)) d();
  }
}

let current: Scope | null = null;

export function runInScope<T>(scope: Scope, fn: () => T): T {
  const previous = current;
  current = scope;
  try {
    return fn();
  } finally {
    current = previous;
  }
}

/** True only during a view's first paint: elements may then carry the slide-in class. */
export function isFirstPaint(): boolean {
  return current?.firstPaint === true;
}

/** Register cleanup (event listeners on window, timers) with the view being rendered. */
export function onDispose(dispose: () => void): void {
  current?.add(dispose);
}

function sameSlice(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
}

/** The focused control: its data-key, and its place among the controls of the same kind ("keep:", "unkeep:"...). */
interface FocusMemo {
  key: string;
  kind: string;
  index: number;
  /** The data-key of the control to land on when this one and its kind are gone (data-focus-next). */
  next: string;
}

const keyedControls = (root: HTMLElement): HTMLElement[] => [...root.querySelectorAll<HTMLElement>("[data-key]")];
/** "keep:sam_01" is of kind "keep:". A key with no colon has no siblings. */
const kindOf = (key: string): string => key.slice(0, key.indexOf(":") + 1);

/** Controls tagged data-key survive a repaint with focus intact. */
function focusedKey(root: HTMLElement): FocusMemo | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !root.contains(active) || active === root) return null;
  const key = active.dataset.key ?? "";
  const kind = kindOf(key);
  const index = kind === "" ? -1 : keyedControls(root).filter((el) => (el.dataset.key ?? "").startsWith(kind)).indexOf(active);
  return { key, kind, index, next: active.dataset.focusNext ?? "" };
}

function restoreFocus(root: HTMLElement, memo: FocusMemo | null): void {
  if (memo === null) return;
  const controls = memo.key === "" ? [] : keyedControls(root);
  let target = controls.find((el) => el.dataset.key === memo.key);
  if (target === undefined && memo.kind !== "") {
    // The control is gone because its row left the list (Keep moves a person to Protected). Land on
    // the same kind of control in the row that took its place, so a keyboard user keeps their spot.
    const siblings = controls.filter((el) => (el.dataset.key ?? "").startsWith(memo.kind));
    target = siblings[Math.min(memo.index, siblings.length - 1)];
  }
  // The control named by data-focus-next (a search box, an add box), when the one that had focus cleared itself away.
  if (target === undefined && memo.next !== "") target = controls.find((el) => el.dataset.key === memo.next);
  // Nothing comparable is left: park focus on the region rather than at the top of the page.
  (target ?? root).focus({ preventScroll: true });
}

export interface RegionOptions {
  className?: string;
  /** Names the region for screen readers when it is a distinct block. */
  label?: string;
}

/**
 * A container that renders `render(state)` and repaints when `deps(state)` changes (compared item by
 * item with Object.is). Inner regions are disposed and rebuilt on every repaint.
 */
export function region(
  store: Store,
  deps: (state: State) => readonly unknown[],
  render: (state: State) => Child | Child[],
  options: RegionOptions = {},
): HTMLElement {
  const root = h("div", { class: options.className ?? "region", tabindex: "-1", role: options.label ? "region" : undefined, "aria-label": options.label });
  const parent = current;
  let inner: Scope | null = null;
  let last = deps(store.get());

  const paint = (state: State): void => {
    const key = focusedKey(root);
    inner?.dispose();
    inner = new Scope(parent?.firstPaint === true && root.childNodes.length === 0);
    const children = runInScope(inner, () => render(state));
    root.replaceChildren();
    for (const child of Array.isArray(children) ? children : [children]) {
      if (child === null || child === undefined || child === false) continue;
      root.appendChild(typeof child === "object" ? child : document.createTextNode(String(child)));
    }
    restoreFocus(root, key);
  };

  paint(store.get());
  const off = store.subscribe((state) => {
    const next = deps(state);
    if (sameSlice(last, next)) return;
    last = next;
    paint(state);
  });
  parent?.add(() => {
    off();
    inner?.dispose();
  });
  return root;
}
