import type { Confidence } from "@snappy-export/core";
import { common } from "../copy.ts";
import { h } from "../dom.ts";
import { confidenceBars } from "./icon.ts";

/** Confidence as three bars plus a word. Colour tints the badge but is never the only signal. */
export function confidenceBadge(level: Confidence): HTMLElement {
  return h(
    "span",
    { class: `conf conf-${level}`, title: common.confidenceHint[level] },
    confidenceBars(level),
    h("span", { class: "conf-word" }, common.confidenceWord[level]),
    h("span", { class: "sr-only" }, ` ${common.confidenceSuffix}`),
  );
}
