/** Page-level building blocks shared by the views. */
import { h, setVar } from "../dom.ts";
import type { Child } from "../dom.ts";
import { isFirstPaint } from "../reactive.ts";
import { icon } from "./icon.ts";
import type { IconName } from "./icon.ts";

/** The one h1 of a view, plus an optional lead. The router focuses the h1 after navigation. */
export function pageHeader(title: string, lead?: string): HTMLElement {
  return h("header", { class: "page-header" }, h("h1", { id: "page-title", tabindex: "-1" }, title), lead ? h("p", { class: "lead" }, lead) : null);
}

export function section(heading: string, ...children: Child[]): HTMLElement {
  return h("section", { class: "section" }, h("h2", { class: "section-title" }, heading), ...children);
}

/** Empty state: names what will appear and how to get it. */
export function emptyState(options: { icon: IconName; title: string; body: string; actions?: Child[] }): HTMLElement {
  return h(
    "div",
    { class: "empty" },
    icon(options.icon, 48),
    h("h2", { class: "empty-title" }, options.title),
    h("p", { class: "empty-body" }, options.body),
    options.actions && options.actions.length > 0 ? h("div", { class: "actions" }, ...options.actions) : null,
  );
}

/** Label and number, for the counts on the overview and memories views. */
export function stat(label: string, value: string, accent = false): HTMLElement {
  return h("div", { class: "stat" }, h("dt", { class: "stat-label" }, label), h("dd", { class: accent ? "stat-value stat-accent" : "stat-value" }, value));
}

/**
 * Signature motion: on the first paint of a view its key bars slide in from the left, each a
 * little after the last. Returns the class and sets the order through CSSOM; later repaints
 * (a filter change, a Keep) return nothing, so it happens once per view.
 */
export function slideIn<T extends HTMLElement>(el: T, index: number): T {
  if (isFirstPaint()) {
    el.classList.add("slide-in");
    setVar(el, "--i", String(Math.min(index, 12)));
  }
  return el;
}

/** Summary line for a <details>: a chevron that turns when open, then the label. */
export function disclosureSummary(label: string, key?: string): HTMLElement {
  return h("summary", { class: "disclosure", "data-key": key }, icon("chevron-right", 16), h("span", {}, label));
}
