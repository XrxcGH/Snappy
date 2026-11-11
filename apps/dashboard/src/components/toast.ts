/**
 * A small confirmation, shown after Keep with one action ("ghost_5 is on your keep list. Undo") or alone after a copy,
 * a save or opening a file ("List copied.", or an error such as "Snappy could not copy..."). One toast at a time,
 * for eight seconds, paused while the pointer or keyboard focus is on it. A second Keep inside that time replaces it
 * and counts up ("3 kept."), and Undo then takes back the latest one only. The toast is for the eyes and the pointer:
 * the same sentence is spoken through the polite live region by whoever shows it, so this element is not a live
 * region and nothing is read twice. Usernames reach it as text, only through displayUsername, and never the title.
 *
 * A page that can show a toast draws `toastHost()` once; the shell draws `shellToastHost()` for the pages that do not. A
 * note and a Keep toast sit side by side, each with its own time, so neither takes the other away. Leaving the page
 * removes its host and its timers. Nothing is stored.
 */
import { lists } from "../copy-lists.ts";
import { h } from "../dom.ts";
import { onDispose } from "../reactive.ts";
import { button } from "./button.ts";
import { icon } from "./icon.ts";

/** How long a toast stays, unless the pointer or focus holds it. */
export const TOAST_MS = 8000;

export interface ToastOptions {
  /** The sentence for the first toast (count 1) and for each count after it. Export values only through displayUsername. */
  text: (count: number) => string;
  /** Label of the action button: one word. Left out, the toast is a plain note. */
  actionLabel?: string;
  /** Accessible name of the action button (it must contain the label). */
  actionAriaLabel?: string;
  /** Takes the latest action back. */
  onAction?: () => void;
  /** "error" marks a failure with the error colors and icon; a note is otherwise neutral. */
  kind?: "error";
  /** Where focus goes after the action, for example back to the row that reappeared. */
  afterAction?: (host: HTMLElement) => void;
}

interface Host {
  element: HTMLElement;
  show(options: ToastOptions): void;
  dismiss(): void;
}

/** The host of the page on screen, and the shell's own host that serves every page that draws none. */
let active: Host | null = null;
let fallback: Host | null = null;

/** One place in a host: it holds one toast with its own eight seconds, paused while the pointer or focus is on it. */
function makeSlot(paint: () => void) {
  let toast: HTMLElement | null = null;
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
    held = false;
    toast = null;
    paint();
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
  const place = (next: HTMLElement): void => {
    held = false;
    next.addEventListener("mouseenter", hold);
    next.addEventListener("mouseleave", release);
    next.addEventListener("focusin", hold);
    next.addEventListener("focusout", release);
    next.addEventListener("keydown", (event) => {
      if ((event as KeyboardEvent).key === "Escape") dismiss();
    });
    toast = next;
    paint();
    arm(TOAST_MS);
  };
  return { place, dismiss, current: (): HTMLElement | null => toast };
}

function makeHost(): Host {
  const element = h("div", { class: "toast-host" });
  let count = 0;
  // A Keep toast with Undo and a note (a copy, a save) have a place each, so a note never takes Undo away before its time.
  const slots = {} as { action: ReturnType<typeof makeSlot>; note: ReturnType<typeof makeSlot> };
  const paint = (): void => {
    const shown = [slots.action?.current(), slots.note?.current()].filter((t): t is HTMLElement => t !== null && t !== undefined);
    element.replaceChildren(...shown);
  };
  slots.action = makeSlot(paint);
  slots.note = makeSlot(paint);

  const show = (options: ToastOptions): void => {
    const acts = options.actionLabel !== undefined && options.onAction !== undefined;
    if (acts) count += 1;
    const undo = acts
      ? button({
          label: options.actionLabel!,
          ariaLabel: options.actionAriaLabel,
          variant: "secondary",
          key: "toast-action",
          onclick: () => {
            slots.action.dismiss();
            count = 0;
            options.onAction!();
            options.afterAction?.(element);
          },
        })
      : null;
    const toast = h(
      "div",
      { class: `toast${options.kind === "error" ? " toast-error" : ""}`, role: "group", "aria-label": lists.toastLabel },
      options.kind === "error" ? icon("warning", 20) : null,
      h("p", { class: "toast-text" }, options.text(Math.max(count, 1))),
      undo,
    );
    (acts ? slots.action : slots.note).place(toast);
  };
  const dismiss = (): void => {
    count = 0;
    slots.action.dismiss();
    slots.note.dismiss();
  };
  return { element, show, dismiss };
}

/** The element a page draws once to be able to show toasts. Fixed at the bottom of the window; empty when no toast is showing. */
export function toastHost(): HTMLElement {
  const host = makeHost();
  active = host;
  onDispose(() => {
    host.dismiss();
    if (active === host) active = null;
  });
  return host.element;
}

/**
 * The shell's own host, drawn once for the whole window: it shows a note on a page that draws no host of its own (a guide, a
 * tool, the year in review). Keep toasts stay with the page that draws one.
 */
export function shellToastHost(): HTMLElement {
  fallback = makeHost();
  return fallback.element;
}

/** Show a toast on the page's host, or on the shell's when the page has none. Returns false when neither is drawn (the action itself still happened). */
export function showToast(options: ToastOptions): boolean {
  const host = active ?? fallback;
  if (host === null) return false;
  host.show(options);
  return true;
}

/** A toast with a sentence and nothing to press: the visible side of a Copy, a Save or an opened file. A failure is marked as one. */
export function showNote(text: string, kind?: "error"): boolean {
  return showToast({ text: () => text, kind });
}

/** Take the toast away now. */
export function dismissToast(): void {
  (active ?? fallback)?.dismiss();
}
