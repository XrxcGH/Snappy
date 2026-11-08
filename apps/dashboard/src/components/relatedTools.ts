/**
 * "Related tools": a short row of links at the end of a page that lead to the tools which go with it (Disappeared
 * friends to Since your last export, Cleanup to Friends backup, and so on). The names come from the tool registry, so
 * a tool that is renamed or removed changes here without an edit, and an id that is not a tool shows nothing.
 */
import { lists } from "../copy-lists.ts";
import { h } from "../dom.ts";
import { toolById } from "../tools/registry.ts";

let counter = 0;

export function relatedTools(ids: readonly string[], note?: string): HTMLElement | null {
  const found = ids.flatMap((id) => toolById(id) ?? []);
  if (found.length === 0) return null;
  const labelId = `related-tools-${++counter}`;
  return h(
    "div",
    { class: "related" },
    h("p", { class: "label", id: labelId }, lists.relatedLabel),
    note ? h("p", {}, note) : null,
    h("ul", { class: "related-list", role: "list", "aria-labelledby": labelId }, ...found.map((tool) => h("li", {}, h("a", { href: `#/tools/${tool.id}` }, tool.title)))),
  );
}
