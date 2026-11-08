/**
 * A small confirmation with one action, shown after Keep: "ghost_5 is on your keep list. Undo". One toast at a time,
 * for eight seconds, paused while the pointer or keyboard focus is on it. A second Keep inside that time replaces it
 * and counts up ("3 kept."), and Undo then takes back the latest one only. The toast is for the eyes and the pointer:
 * the same sentence is spoken through the polite live region by whoever shows it, so this element is not a live
 * region and nothing is read twice. Usernames reach it as text, only through displayUsername, and never the title.
 *
 * A page that can show a toast draws `toastHost()` once; `showToast` does nothing where no host is drawn. Leaving the
 * page removes the host and its timer. Nothing is stored.
 */
import { lists } from "../copy-lists.ts";
import { h } from "../dom.ts";
import { onDispose } from "../reactive.ts";
import { button } from "./button.ts";

/** How long a toast stays, unless the pointer or focus holds it. */
export const TOAST_MS = 8000;

export interface ToastOptions {
  /** The sentence for the first toast (count 1) and for each count after it. Export values only through displayUsername. */
  text: (count: number) => string;
  /** Label of the action button: one word. */
  actionLabel: string;
  /** Accessible name of the action button (it must contain the label). */
  actionAriaLabel: string;
  /** Takes the latest action back. */
  onAction: () => void;
  /** Where focus goes after the action, for example back to the row that reappeared. */
  afterAction?: (host: HTMLElement) => void;
}

interface Host {
  element: HTMLElement;
  show(options: ToastOptions): void;
  dismiss(): void;
}

let active: Host | null = null;

/** The element a page draws once to be able to show toasts. Fixed at the bottom of the window; empty when no toast is showing. */
export function toastHost(): HTMLElement {
  const element = h("div", { class: "toast-host" });
  let count = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let remaining = TOAST_MS;
  let startedAt = 0;
  let held = false;

  const stop = (): void => {
    clearTimeout(timer);
    timer = undefined;
  };
  const dismiss = (): void => {
    stop();
    count = 0;
    held = false;
    element.replaceChildren();
  };
  const arm = (ms: number): void => {
    stop();
    remaining = ms;
    startedAt = Date.now();
    timer = setTimeout(dismiss, ms);
  };
  /** While the pointer or focus is on the toast, its time stands still. */
  const hold = (): void => {
    if (held || timer === undefined) return;
    held = true;
    remaining = Math.max(0, remaining - (Date.now() - startedAt));
    stop();
  };
  const release = (): void => {
    if (!held) return;
    held = false;
    arm(remaining);
  };

  const show = (options: ToastOptions): void => {
    count += 1;
    held = false;
    const undo = button({
      label: options.actionLabel,
      ariaLabel: options.actionAriaLabel,
      variant: "secondary",
      key: "toast-action",
      onclick: () => {
        dismiss();
        options.onAction();
        options.afterAction?.(element);
      },
    });
    const toast = h("div", { class: "toast", role: "group", "aria-label": lists.toastLabel }, h("p", { class: "toast-text" }, options.text(count)), undo);
    toast.addEventListener("mouseenter", hold);
    toast.addEventListener("mouseleave", release);
    toast.addEventListener("focusin", hold);
    toast.addEventListener("focusout", release);
    toast.addEventListener("keydown", (event) => {
      if ((event as KeyboardEvent).key === "Escape") dismiss();
    });
    element.replaceChildren(toast);
    arm(TOAST_MS);
  };

  const host: Host = { element, show, dismiss };
  active = host;
  onDispose(() => {
    dismiss();
    if (active === host) active = null;
  });
  return element;
}

/** Show a toast on the page that drew a host. Returns false when there is none (the action itself still happened). */
export function showToast(options: ToastOptions): boolean {
  if (active === null) return false;
  active.show(options);
  return true;
}

/** Take the toast away now. */
export function dismissToast(): void {
  active?.dismiss();
}
