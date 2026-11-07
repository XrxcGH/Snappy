import type { Actions } from "../actions.ts";
import { announce } from "../announce.ts";
import { shell } from "../copy.ts";
import { h } from "../dom.ts";
import type { State, Theme } from "../reducer.ts";
import type { Store } from "../store.ts";
import { icon } from "./icon.ts";

export type ResolvedTheme = "light" | "dark";

/** Whether the device asks for a dark theme. False where the browser cannot say. */
export function devicePrefersDark(): boolean {
  try {
    return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

/** The theme actually on screen: "Match device" resolves to what the device asks for. */
export const resolveTheme = (theme: Theme, prefersDark: boolean): ResolvedTheme => (theme === "system" ? (prefersDark ? "dark" : "light") : theme);

/**
 * Header button that flips between the dark and light themes. It shows the icon of the theme it
 * switches to, and its accessible name says what pressing it does ("Switch to light theme").
 * The current theme is stated through aria-pressed (pressed means the dark theme is on), and the
 * name stays the action. It shares the store with the Settings control: both
 * call actions.setTheme, and both repaint from the same state.
 */
export function themeToggle(store: Store, actions: Pick<Actions, "setTheme">): HTMLButtonElement {
  const toggle = h("button", { class: "btn btn-secondary btn-icon theme-toggle", type: "button", "data-key": "theme-toggle" });

  const paint = (s: State): void => {
    const current = resolveTheme(s.theme, devicePrefersDark());
    const next: ResolvedTheme = current === "dark" ? "light" : "dark";
    toggle.setAttribute("aria-label", next === "light" ? shell.themeToLight : shell.themeToDark);
    toggle.dataset.theme = current;
    // Pressed means "the dark theme is on"; the name says what pressing does.
    toggle.setAttribute("aria-pressed", String(current === "dark"));
    toggle.setAttribute("title", next === "light" ? shell.themeToLight : shell.themeToDark);
    toggle.replaceChildren(icon(next === "light" ? "sun" : "moon", 24));
  };

  toggle.addEventListener("click", () => {
    const current = resolveTheme(store.get().theme, devicePrefersDark());
    const next: ResolvedTheme = current === "dark" ? "light" : "dark";
    actions.setTheme(next);
    announce(next === "dark" ? shell.themeChangedDark : shell.themeChangedLight);
  });

  paint(store.get());
  store.subscribe((s, p) => {
    if (s.theme !== p.theme) paint(s);
  });
  // "Match device" follows the device while the page is open.
  try {
    if (typeof matchMedia === "function") matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => paint(store.get()));
  } catch {
    // Older browsers cannot watch the device setting; the button repaints on the next click.
  }
  return toggle;
}
