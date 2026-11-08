import type { Confidence } from "@snappy-export/core";
import { common } from "../copy.ts";
import { h } from "../dom.ts";
import { confidenceBars } from "./icon.ts";

/**
 * Confidence as three bars plus a word. Colour tints the badge but is never the only signal. The explanation is not a
 * tooltip (no keyboard, touch or focus access): the list page says it in one line, and each row's "Why this appears"
 * holds the hint for its level.
 */
export function confidenceBadge(level: Confidence): HTMLElement {
  return h(
    "span",
    { class: `conf conf-${level}` },
    confidenceBars(level),
    h("span", { class: "conf-word" }, common.confidenceWord[level]),
    h("span", { class: "sr-only" }, ` ${common.confidenceSuffix}`),
  );
}
