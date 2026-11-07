/** Page-level building blocks shared by the views. */
import { common } from "../copy.ts";
import { h, setVar } from "../dom.ts";
import type { Child } from "../dom.ts";
import { isFirstPaint } from "../reactive.ts";
import { chipIcon, scopeClass } from "./category.ts";
import type { Scope } from "./category.ts";
import { icon, spot as spotIllustration } from "./icon.ts";
import type { IconName, SpotName } from "./icon.ts";

export interface PageHeaderOptions {
  /** Icon tile shown before the title. Decorative: the title names the page. */
  icon?: IconName;
  /** Finding area (or the neutral scope); its color paints the tile and the accent bar under the lead. */
  category?: Scope;

  /** A small muted line inside the header, after the lead and before the accent bar. */
  note?: string;
}

/** The one h1 of a view, plus an optional lead. The router focuses the h1 after navigation. */
export function pageHeader(title: string, lead?: string, options: PageHeaderOptions = {}): HTMLElement {
  const classes = ["page-header"];

  if (options.category) classes.push(scopeClass(options.category));
  return h(
    "header",
    { class: classes.join(" ") },
    h(
      "div",
      { class: "page-header-main" },
      h("div", { class: "page-title-row" }, options.icon ? chipIcon(options.icon, "lg") : null, h("h1", { id: "page-title", tabindex: "-1" }, title)),
      lead ? h("p", { class: "lead" }, lead) : null,
      options.note ? h("p", { class: "page-header-note" }, options.note) : null,
    ),

  );
}

export function section(heading: string, ...children: Child[]): HTMLElement {
  return h("section", { class: "section" }, h("h2", { class: "section-title" }, heading), ...children);
}

/**
 * A part of a section with its own h3. Like a section, it keeps one heading gap between the h3 and
 * its content, and the stylesheet puts one section gap before it, so every sub-heading sits the same distance from what came before.
 */
export function subsection(heading: string, ...children: Child[]): HTMLElement {
  return h("section", { class: "section subsection" }, h("h3", { class: "subheading" }, heading), ...children);
}

/**
 * The content of a <details> after its summary. The browser puts a details' content in one internal
 * slot, so a grid gap on the details never reaches these children: they get a wrapper that owns the gap.
 */
export function detailsBody(...children: Child[]): HTMLElement {
  return h("div", { class: "details-body" }, ...children);
}

/**
 * One numbered step as a card. The number is decorative; the heading carries a screen-reader
 * prefix ("Step 1: ") so the order is still announced.
 */
export function stepSection(n: number, heading: string, ...children: Child[]): HTMLElement {
  return h(
    "section",
    { class: "step-card" },
    h("span", { class: "step-num", "aria-hidden": "true" }, String(n)),
    h("h2", { class: "section-title" }, h("span", { class: "sr-only" }, common.stepPrefix(n)), h("span", {}, heading)),
    // The content starts at the card's left edge, under the number and the heading, so it has the full width.
    h("div", { class: "step-content" }, ...children),
  );
}

/** A short numbered list of one-line steps, each in a compact card. */
export function stepCards(items: readonly string[]): HTMLElement {
  return h(
    "ol",
    { class: "step-list", role: "list" },
    ...items.map((text, i) => h("li", { class: "step-card step-card-compact" }, h("span", { class: "step-num", "aria-hidden": "true" }, String(i + 1)), h("p", {}, text))),
  );
}

/** A bulleted list whose bullets are small check icons. */
export function pointList(items: readonly string[], iconName: IconName = "check"): HTMLElement {
  return h("ul", { class: "point-list" }, ...items.map((text) => h("li", {}, icon(iconName, 20), h("span", {}, text))));
}

/**
 * Empty state: names what will appear and how to get it. With `spot` it shows an illustration
 * beside the words; without it, the old 48 px icon sits above them.
 */
export function emptyState(options: {
  icon: IconName;
  title: string;
  body: string;
  actions?: Child[];
  spot?: SpotName;
  category?: Scope;
  tint?: boolean;
}): HTMLElement {
  const classes = ["empty"];
  if (options.spot) classes.push("empty-spot");
  if (options.category) classes.push(scopeClass(options.category));
  if (options.tint) classes.push("empty-tint");
  return h(
    "div",
    { class: classes.join(" ") },
    options.spot ? spotIllustration(options.spot) : null,
    h(
      "div",
      { class: "empty-copy" },
      options.spot ? null : icon(options.icon, 48),
      h("h2", { class: "empty-title" }, options.title),
      h("p", { class: "empty-body" }, options.body),
      options.actions && options.actions.length > 0 ? h("div", { class: "actions" }, ...options.actions) : null,
    ),
  );
}

export interface StatOptions {
  /** Violet key figure. */
  accent?: boolean;
  /** Adds an icon tile and turns the stat into a card with a colored underline bar. */
  icon?: IconName;
  /** Which color scope paints the tile and bar. Defaults to the quiet gray `neutral`. */
  scope?: Scope;
}

/**
 * Label and number, for the counts on the overview and memories views. A boolean third argument
 * keeps its old meaning (`accent`); an options object with `icon` renders the card with its tile.
 */
export function stat(label: string, value: string, options: boolean | StatOptions = false): HTMLElement {
  const opts: StatOptions = typeof options === "boolean" ? { accent: options } : options;
  const valueClass = opts.accent ? "stat-value stat-accent" : "stat-value";
  if (!opts.icon) return h("div", { class: "stat" }, h("dt", { class: "stat-label" }, label), h("dd", { class: valueClass }, value));
  // A tile: the icon tile and the label share the first row, then the number, then a short bar. The grid
  // (`statGrid`) shares those rows across the tiles of one row, and everything is centered.
  return h(
    "div",
    { class: `stat stat-card tile ${scopeClass(opts.scope ?? "neutral")}` },
    h("dt", { class: "stat-label" }, chipIcon(opts.icon), h("span", {}, label)),
    h("dd", { class: valueClass }, value),
  );
}

/** The grid for a set of `stat` tiles: one column on a narrow phone, two from a larger phone, three from 40rem. */
export function statGrid(...tiles: HTMLElement[]): HTMLElement {
  return h("dl", { class: "tiles tiles-stats stats" }, ...tiles);
}

/**
 * A short list of facts in one card: the label on the left (with its icon tile), the number on the right. For a
 * set of counts that does not fill a card grid (four, say), where cards would leave a hole.
 */
export function factList(items: readonly { label: string; value: string; icon: IconName; scope?: Scope }[]): HTMLElement {
  return h(
    "dl",
    { class: "facts" },
    ...items.map((item) =>
      h("div", { class: `fact ${scopeClass(item.scope ?? "neutral")}` }, h("dt", {}, chipIcon(item.icon, "sm"), h("span", {}, item.label)), h("dd", {}, item.value)),
    ),
  );
}

/** Several quiet notes in one frame, divided by hairlines. */
export function noticeGroup(...children: Child[]): HTMLElement {
  return h("div", { class: "notice-group" }, ...children);
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
