/**
 * Category scope helpers. Each finding area owns one quiet color. The color is applied by a
 * `cat-<id>` class on a view root, card, row or nav link (see styles.css); it is never the only
 * signal, so every use pairs it with the category icon and its text label.
 */
import type { CandidateCategory } from "@snappy-export/core";
import { h } from "../dom.ts";
import { icon } from "./icon.ts";
import type { IconName } from "./icon.ts";

export type CategoryId = "disappeared" | "requests" | "quiet" | "cleanup" | "memories";
/** A category, or `neutral` for counts that belong to no category (friends, snapshots). */
export type Scope = CategoryId | "neutral";

export const CATEGORY_ICON: Record<CategoryId, IconName> = {
  disappeared: "vanished",
  requests: "one-way",
  quiet: "quiet",
  cleanup: "queue",
  memories: "memories",
};

export const categoryOfCandidate = (c: CandidateCategory): CategoryId => (c === "ghost" ? "disappeared" : c === "one-way" ? "requests" : "quiet");

export const scopeClass = (s: Scope): string => `cat-${s}`;

/** Icon tile: a rounded square holding one icon, painted by the surrounding scope. Decorative. */
export function chipIcon(name: IconName, size: "sm" | "md" | "lg" = "md"): HTMLElement {
  const sizeClass = size === "md" ? "" : ` chip-icon-${size}`;
  return h("span", { class: `chip-icon${sizeClass}` }, icon(name, size === "lg" ? 24 : 20));
}

/** Labeled tag: category icon plus its words, painted by the category's own color. */
export function categoryTag(id: CategoryId, label: string): HTMLElement {
  return h("span", { class: `cat-tag ${scopeClass(id)}` }, icon(CATEGORY_ICON[id], 16), h("span", {}, label));
}
