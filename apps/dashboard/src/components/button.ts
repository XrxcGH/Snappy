import { h } from "../dom.ts";
import type { Child, Handler } from "../dom.ts";
import { common } from "../copy.ts";
import { safeProfileUrl } from "../safe.ts";
import { icon } from "./icon.ts";
import type { IconName } from "./icon.ts";

export type ButtonVariant = "primary" | "secondary" | "danger" | "quiet";

export interface ButtonOptions {
  label: string;
  variant?: ButtonVariant;
  icon?: IconName;
  onclick?: Handler;
  /** Accessible name when the visible label is not enough (it must still contain the label). */
  ariaLabel?: string;
  /** Keeps focus on this control when the region around it repaints. */
  key?: string;
  disabled?: boolean;
  pressed?: boolean;
  type?: "button" | "submit";
  /** Extra class names after the button's own (for example a placement class). */
  className?: string;
}

export function button(options: ButtonOptions): HTMLButtonElement {
  return h(
    "button",
    {
      class: `btn btn-${options.variant ?? "secondary"}${options.className ? ` ${options.className}` : ""}`,
      type: options.type ?? "button",
      onclick: options.onclick,
      "aria-label": options.ariaLabel,
      "aria-pressed": options.pressed === undefined ? undefined : String(options.pressed),
      "data-key": options.key,
      disabled: options.disabled,
    },
    options.icon ? icon(options.icon, 20) : null,
    h("span", {}, options.label),
  );
}

/** An in-page route link that looks like a button. */
export function routeLink(route: string, label: string, variant: ButtonVariant = "secondary", extra: Child[] = []): HTMLAnchorElement {
  return h("a", { class: `btn btn-${variant}`, href: `#/${route}` }, h("span", {}, label), ...extra);
}

/**
 * Link to a friend's Snapchat profile in a new tab, or null when the username is not plain
 * enough to link safely. The visible text stays short; the accessible name says who and that
 * it opens a new tab.
 */
export function profileLink(username: string, variant: ButtonVariant = "secondary"): HTMLAnchorElement | null {
  const url = safeProfileUrl(username);
  if (url === null) return null;
  return h(
    "a",
    { class: `btn btn-${variant}`, href: url, target: "_blank", rel: "noopener noreferrer", "aria-label": common.openInSnapchatFor(username) },
    icon("external", 20),
    h("span", {}, common.openInSnapchat),
  );
}
