/**
 * Keyboard shortcuts for the whole app, one listener on the window. `?` shows the list, `/` jumps to the page's search
 * box, and `g` then a letter goes to a page (o Overview, c Cleanup queue, t Tools, m Memories rescue, s Settings,
 * h Start). Keys are lowercase only. Nothing happens while someone is typing in a field or holds Ctrl, Meta or Alt, so
 * the browser's own shortcuts and every text box keep working. A pending `g` shows a small "Go to..." pill for
 * 1.5 seconds and is announced politely once. Nothing is stored and nothing is read from the export.
 */
import { announce } from "./announce.ts";
import { button } from "./components/button.ts";
import { routes } from "./copy.ts";
import type { RouteId } from "./copy.ts";
import { shellCopy } from "./copy-shell.ts";
import { h } from "./dom.ts";

/** The second key of a `g` chord, and the page it goes to. */
export const GO_KEYS: Readonly<Record<string, RouteId>> = { o: "overview", c: "cleanup", t: "tools", m: "memories", s: "settings", h: "start" };

/** How long a `g` waits for its second key. */
export const PENDING_MS = 1500;

/** The keys the list shows, in order. A chord has two keys. */
export const SHORTCUTS: readonly { keys: readonly string[]; label: () => string }[] = [
  { keys: ["?"], label: () => shellCopy.shortcutShowList },
  { keys: ["/"], label: () => shellCopy.shortcutSearch },
  ...Object.entries(GO_KEYS).map(([key, route]) => ({ keys: ["g", key], label: () => shellCopy.shortcutGoTo(routes[route].label) })),
];

/** The kinds of element that take typed text, where a shortcut must never fire. */
function isTyping(target: unknown): boolean {
  const el = target as { tagName?: unknown; isContentEditable?: unknown; getAttribute?: (name: string) => string | null } | null;
  if (!el || typeof el.tagName !== "string") return false;
  const tag = el.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (el.isContentEditable === true) return true;
  const editable = typeof el.getAttribute === "function" ? el.getAttribute("contenteditable") : null;
  return editable !== null && editable !== "false";
}

// ------------------------------------------------------------------ dialog ---

let dialog: HTMLDialogElement | null = null;
let opener: HTMLElement | null = null;

function buildDialog(): HTMLDialogElement {
  const titleId = "shortcuts-title";
  const rows = SHORTCUTS.map(({ keys, label }) => {
    const chord: (Node | string)[] = [];
    keys.forEach((key, i) => {
      if (i > 0) chord.push(` ${shellCopy.unitThen} `);
      chord.push(h("kbd", { class: "key" }, key));
    });
    return [h("dt", { class: "shortcut-keys" }, ...chord), h("dd", {}, label())];
  }).flat();
  const close = button({ label: shellCopy.closeShortcutsButton, variant: "primary", key: "close-shortcuts", onclick: () => dialog?.close() });
  const element = h(
    "dialog",
    { class: "shortcuts", "aria-labelledby": titleId },
    h("h2", { id: titleId, class: "section-title" }, shellCopy.shortcutsTitle),
    h("p", { class: "caption" }, shellCopy.shortcutsNote),
    h("dl", { class: "shortcut-list" }, ...rows),
    h("div", { class: "actions" }, close),
  );
  // Escape closes a modal dialog by itself; this keeps it closing in an engine that does not.
  element.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Escape") {
      e.preventDefault();
      element.close();
    }
  });
  // However it closes (the button, Escape, the engine's own cancel), focus goes back to what opened it.
  element.addEventListener("close", () => {
    opener?.focus({ preventScroll: true });
    opener = null;
  });
  return element;
}

/** Show the list of shortcuts. A modal dialog: focus stays inside it, Escape or Close ends it, and focus returns to the opener. */
export function openShortcuts(): void {
  if (dialog?.open) return;
  opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  if (dialog === null) {
    dialog = buildDialog();
    document.body.appendChild(dialog);
  }
  dialog.showModal();
}

/** Forget the dialog. For tests, and for a page that is torn down. */
export function resetShortcuts(): void {
  dialog?.remove();
  dialog = null;
  opener = null;
}

// ---------------------------------------------------------------- listener ---

export interface KeysOptions {
  /** Go to a page. */
  go: (route: RouteId) => void;
  /** The search box of the page that is showing, or null when it has none. */
  findSearch?: () => HTMLElement | null;
}

interface KeyTarget {
  addEventListener(type: "keydown", listener: (event: KeyboardEvent) => void): void;
  removeEventListener(type: "keydown", listener: (event: KeyboardEvent) => void): void;
}

const defaultSearch = (): HTMLElement | null => {
  const found = document.querySelector<HTMLInputElement>('#main input[type="search"]');
  return found && !found.disabled ? found : null;
};

/** Listen for the shortcuts on `target` (the window). Returns a function that stops listening. */
export function installKeys(target: KeyTarget, options: KeysOptions): () => void {
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pill: HTMLElement | null = null;

  const endPending = (): void => {
    pending = false;
    clearTimeout(timer);
    pill?.remove();
    pill = null;
  };

  const onKeydown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.repeat) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (isTyping(event.target)) return;
    // While the list is open the dialog owns the keyboard.
    if (dialog?.open) return;

    const key = event.key;
    if (pending) {
      const route = GO_KEYS[key];
      endPending();
      if (route !== undefined) {
        event.preventDefault();
        options.go(route);
      }
      return;
    }

    if (key === "?") {
      event.preventDefault();
      openShortcuts();
    } else if (key === "/") {
      const search = (options.findSearch ?? defaultSearch)();
      if (search) {
        event.preventDefault();
        search.focus();
      }
    } else if (key === "g") {
      pending = true;
      pill = h("p", { class: "keys-pending", "aria-hidden": "true" }, h("kbd", { class: "key" }, "g"), shellCopy.goPendingStatus);
      document.body.appendChild(pill);
      announce(shellCopy.goPendingAnnounce);
      timer = setTimeout(endPending, PENDING_MS);
    }
  };

  target.addEventListener("keydown", onKeydown);
  return () => {
    target.removeEventListener("keydown", onKeydown);
    endPending();
  };
}
