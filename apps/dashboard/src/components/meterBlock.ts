import { h } from "../dom.ts";
import { progressBar } from "./progressBar.ts";
import type { ProgressOptions } from "./progressBar.ts";

/**
 * A progress bar with its short name and its value on one line above it, as the Memories meter has them. The bar keeps
 * the full accessible name and the spoken value; the line above says the same thing to the eye, so the label and the
 * number are never apart. `value` is 0..1.
 */
export function meterBlock(options: ProgressOptions & { name: string; valueText: string; value: number }): HTMLElement {
  return h(
    "div",
    { class: "meter-block" },
    h("p", { class: "meter-head" }, h("span", { class: "meter-name" }, options.name), " ", h("span", { class: "meter-text" }, options.valueText)),
    progressBar(options),
  );
}
