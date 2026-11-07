import { announce } from "../announce.ts";
import { tools } from "../copy.ts";
import { h } from "../dom.ts";
import type { ToolUi } from "./toolPage.ts";

export interface TickItem {
  /** Stable, lowercase words joined by hyphens. The saved tick is "<tool id>:<id>". */
  id: string;
  /** One short line: what the person does or has done. */
  label: string;
  /** An optional short hint under the line. */
  hint?: string;
}

/**
 * A self-reported checklist for a tool page: one checkbox per item, and one honest note under the list. A tick is the
 * person's own word. Snappy cannot see their settings, so nothing here ever says anything was checked or verified. Ticks
 * go through actions.setTick, so they are saved only with the saved history, and otherwise last this session.
 */
export function tickList<P>(ui: ToolUi<P>, toolId: string, items: readonly TickItem[]): HTMLElement {
  const ticked = new Set(ui.ticks);
  return h(
    "div",
    { class: "mark-block" },
    h(
      "ul",
      { class: "mark-list" },
      ...items.map((item) => {
        const key = `${toolId}:${item.id}`;
        const box = h("input", { type: "checkbox", class: "check-input", checked: ticked.has(key), "data-key": `mark:${key}` });
        box.addEventListener("change", () => {
          ui.actions.setTick(key, box.checked);
          announce(tools.markAnnounce(item.label, box.checked));
        });
        return h(
          "li",
          { class: ticked.has(key) ? "mark-item is-done" : "mark-item" },
          h("label", { class: "check" }, box, h("span", {}, item.label)),
          item.hint ? h("p", { class: "caption" }, item.hint) : null,
        );
      }),
    ),
    // Body text, not a caption: it is the one honest statement about what a mark means, so people should read it easily.
    h("p", { class: "mark-note" }, tools.markNote),
  );
}
