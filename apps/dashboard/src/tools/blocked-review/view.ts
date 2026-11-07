import { insights } from "@snappy-export/core";
import { factList, section, stepCards } from "../../components/layout.ts";
import { pagedList } from "../../components/pagedList.ts";
import { toolView } from "../../components/toolPage.ts";
import type { ToolNote } from "../../components/toolPage.ts";
import { usernameChip } from "../../components/usernameChip.ts";
import { h } from "../../dom.ts";
import { formatCount, formatDate } from "../../format.ts";
import type { ToolMeta } from "../types.ts";
import { copy } from "./copy.ts";
import { computeBlockedReview } from "./model.ts";
import type { BlockedReview, ReviewConflict, ReviewEntry, ReviewList } from "./model.ts";

export const meta: ToolMeta = { id: "blocked-review", group: "friends", category: "requests", icon: "remove", needs: ["export"] };

type ListId = insights.blockedReview.ReviewListId;

const HEADING: Record<ListId, string> = { blocked: copy.blockedHeading, ignored: copy.ignoredHeading, hiddenSuggestions: copy.hiddenHeading };

const num = (v: number | string | undefined): number => (typeof v === "number" ? v : 0);
const where = (v: number | string | undefined): string => copy.unitList(String(v));

/** The sentence for one step in the review order. */
function stepText(s: insights.blockedReview.ReviewStep): string {
  switch (s.code) {
    case "review-conflicts":
      return copy.conflictsStep(s.count);
    case "review-blocked":
      return copy.blockedStep(s.count);
    case "review-ignored":
      return copy.ignoredStep(s.count);
    case "review-hidden-suggestions":
      return copy.hiddenStep(s.count);
    default:
      return copy.otherStep;
  }
}

/** The sentence for one note. Counts and list names only, never a person. Hedged where Snappy infers. */
function noteText(n: insights.blockedReview.ReviewNote): string | null {
  const count = num(n.params.count);
  switch (n.code) {
    case "undated-entries":
      return copy.undatedNote(count, where(n.params.list));
    case "future-dated-entries":
      return copy.futureNote(count, where(n.params.list));
    case "case-duplicates":
      return copy.duplicatesNote(count, where(n.params.list));
    case "blank-entries":
      return copy.blankNote(count, where(n.params.list));
    case "conflicts-found":
      return copy.conflictsNote(count);
    case "friends-list-empty":
      return copy.friendsEmptyNote;
    // The page leaves out a list that is empty, and the empty state covers a review with nobody in it.
    case "no-entries":
    case "list-empty":
      return null;
    default:
      return copy.otherNote;
  }
}

const dateText = (at: number | undefined): string => (at === undefined ? copy.noDateLine : formatDate(at));

/** One person in a result list: the username as text in a chip, then what Snappy knows about them. */
function row(name: string, ...meta: string[]): HTMLElement {
  return h("li", { class: "review-row" }, usernameChip(name, { copy: false }), h("span", { class: "review-meta" }, ...meta.map((m) => h("span", {}, m))));
}

function conflictRow(c: ReviewConflict): HTMLElement {
  return row(c.username, c.lists.map((l) => copy.listLabel[l]).join(", "), c.kinds.map((k) => copy.kinds[k]).join(", "));
}

function entryRow(e: ReviewEntry): HTMLElement {
  return row(e.username, dateText(e.at));
}

function rangeOf(list: ReviewList): string | null {
  return list.oldestAt === null || list.newestAt === null ? null : copy.rangeLine(formatDate(list.oldestAt), formatDate(list.newestAt));
}

function listSection(list: ReviewList): HTMLElement {
  const range = rangeOf(list);
  return section(
    HEADING[list.id],
    range === null ? null : h("p", { class: "caption" }, range),
    pagedList(list.entries, entryRow, { key: `blocked-review:${list.id}`, className: "review-list" }),
  );
}

function factsSection(review: BlockedReview): HTMLElement {
  const count = (id: ListId): string => formatCount(review.lists.find((l) => l.id === id)?.count ?? 0);
  return section(
    copy.countsHeading,
    factList([
      { label: copy.facts.blocked, value: count("blocked"), icon: "remove" },
      { label: copy.facts.ignored, value: count("ignored"), icon: "minus" },
      { label: copy.facts.hiddenSuggestions, value: count("hiddenSuggestions"), icon: "people" },
      { label: copy.facts.conflicts, value: formatCount(review.totals.conflicts), icon: "search" },
    ]),
  );
}

export const view = toolView<BlockedReview, Record<string, never>>({
  meta,
  copy,
  compute: computeBlockedReview,
  summary: (review) => copy.doneAnnounce(review.totals.people, review.totals.conflicts),
  isEmpty: (review) => review.totals.people === 0,
  render: (review) => [
    factsSection(review),
    review.reviewOrder.length > 0 ? section(copy.firstHeading, stepCards(review.reviewOrder.map(stepText))) : null,
    review.conflicts.length > 0
      ? section(copy.conflictsHeading, h("p", {}, copy.conflictsLine), pagedList(review.conflicts, conflictRow, { key: "blocked-review:conflicts", className: "review-list" }))
      : null,
    ...review.lists.filter((l) => l.count > 0).map(listSection),
  ],
  notes: (review): ToolNote[] => [
    { kind: "info", text: copy.readOnlyNote },
    ...review.notes.flatMap((n): ToolNote[] => {
      const text = noteText(n);
      return text === null ? [] : [{ kind: n.code === "future-dated-entries" || n.code === "blank-entries" || n.code === "friends-list-empty" ? "warning" : "info", text }];
    }),
  ],
  command: "blocked",
});
