import { overview } from "../copy.ts";
import { h } from "../dom.ts";
import type { Child } from "../dom.ts";
import { icon } from "./icon.ts";
import type { IconName } from "./icon.ts";
import { detailsBody } from "./layout.ts";

export interface HealthGroupOptions {
  errors: number;
  warnings: number;
  /** Info-severity notes. */
  notes: number;
  /** Open when there is at least one error or warning, unless the person toggled it themselves. */
  open: boolean;
  /** Called when the person opens or closes it, so the view can remember the choice across repaints. */
  onToggle?: (open: boolean) => void;
}

function badge(kind: "error" | "warning" | "info", iconName: IconName, text: string): HTMLElement {
  return h("span", { class: `badge badge-${kind}` }, icon(iconName, 16), h("span", {}, text));
}

/**
 * Collapsible frame for the export-health notes. The summary names the section and shows one
 * badge per non-zero severity, each with its status icon and a count word, so a closed group
 * still says what is inside.
 */
export function healthGroup(options: HealthGroupOptions, ...children: Child[]): HTMLElement {
  const badges: HTMLElement[] = [];
  if (options.errors > 0) badges.push(badge("error", "warning", overview.healthErrors(options.errors)));
  if (options.warnings > 0) badges.push(badge("warning", "warning", overview.healthWarnings(options.warnings)));
  if (options.notes > 0) badges.push(badge("info", "info", overview.healthNotes(options.notes)));
  const details = h(
    "details",
    { class: "health-group" },
    h(
      "summary",
      { class: "disclosure health-summary", "data-key": "health" },
      icon("chevron-right", 16),
      h("h2", { class: "health-title" }, overview.healthHeading),
      badges.length > 0 ? h("span", { class: "health-badges" }, ...badges) : null,
    ),
    detailsBody(...children),
  );
  details.open = options.open;
  const onToggle = options.onToggle;
  if (onToggle) details.addEventListener("toggle", () => onToggle(details.open));
  return details;
}
