import { emptyState, factList, section } from "../../components/layout.ts";
import { pagedList } from "../../components/pagedList.ts";
import { toolView } from "../../components/toolPage.ts";
import type { ToolNote } from "../../components/toolPage.ts";
import { usernameChip } from "../../components/usernameChip.ts";
import { h } from "../../dom.ts";
import { formatCount } from "../../format.ts";
import type { ToolMeta } from "../types.ts";
import { copy } from "./copy.ts";
import { computeLookalikes } from "./model.ts";
import type { LookalikeListId, LookalikeNote, LookalikePair, Lookalikes } from "./model.ts";

export const meta: ToolMeta = { id: "lookalike-usernames", group: "friends", category: "requests", icon: "search", needs: ["export", "friends"] };

const num = (v: number | undefined): number => (typeof v === "number" ? v : 0);

/** The pairs worth a second look: very close and close. A slight pair is listed, but it is not one. */
const worthOf = (result: Lookalikes): number => result.totals.byLevel.high + result.totals.byLevel.medium;

/** The sentence for one note. Counts only, never a person. Hedged where Snappy infers. */
function noteText(n: LookalikeNote, result: Lookalikes): string | null {
  switch (n.code) {
    case "no-people":
      return copy.noPeopleNote;
    case "lookalikes-found":
      // Only the very close and close pairs are worth a second look; a list of slight pairs says so.
      return worthOf(result) > 0 ? copy.foundNote(worthOf(result)) : copy.slightNote(num(n.params.count));
    case "list-truncated":
      return copy.truncatedNote(num(n.params.shown), num(n.params.total));
    case "case-duplicates":
      return copy.duplicatesNote(num(n.params.count));
    case "blank-entries":
      return copy.blankNote(num(n.params.count));
    case "overlong-entries":
      return copy.overlongNote(num(n.params.count));
    case "crowded-groups":
      return copy.crowdedNote(num(n.params.people));
    // The empty state already says that no pair was found.
    case "no-lookalikes":
      return null;
    default:
      return copy.otherNote;
  }
}

/** One person in a pair: the username as text in a chip, then the lists they are in. */
function person(name: string, lists: readonly LookalikeListId[]): HTMLElement {
  return h("div", { class: "pair-person" }, usernameChip(name, { copy: false }), h("span", { class: "pair-lists" }, lists.map((l) => copy.listLabel[l]).join(", ")));
}

/** One pair: the two people, then how alike they look and why, each reason on its own line. */
function pairRow(p: LookalikePair): HTMLElement {
  const why = [...p.reasons.map((r) => copy.reasons[r]), ...p.contexts.map((c) => copy.contexts[c])];
  return h(
    "li",
    { class: "pair-row" },
    h("div", { class: "pair-people" }, person(p.a, p.aLists), person(p.b, p.bLists)),
    h("div", { class: "pair-why" }, h("p", { class: `pair-level pair-level-${p.level}` }, copy.levels[p.level]), h("ul", { class: "pair-reasons" }, ...why.map((text) => h("li", {}, text)))),
  );
}

export const view = toolView<Lookalikes, Record<string, never>>({
  meta,
  copy,
  compute: computeLookalikes,
  summary: (result) => copy.doneAnnounce(worthOf(result), result.totals.byLevel.low),
  render: (result) => {
    // The empty state is drawn here, not by the frame, so the notes below it still say what was left out and why.
    if (result.totals.pairs === 0) return [emptyState({ icon: meta.icon, spot: "empty", category: meta.category, title: copy.empty.title, body: copy.empty.body })];
    return [
      section(
        copy.countsHeading,
        factList([
          { label: copy.facts.names, value: formatCount(result.totals.people), icon: "people" },
          { label: copy.facts.high, value: formatCount(result.totals.byLevel.high), icon: "search" },
          { label: copy.facts.medium, value: formatCount(result.totals.byLevel.medium), icon: "search" },
          { label: copy.facts.low, value: formatCount(result.totals.byLevel.low), icon: "search" },
        ]),
      ),
      section(copy.pairsHeading, h("p", {}, copy.pairsLine), pagedList(result.pairs, pairRow, { key: "lookalike-usernames:pairs", className: "pair-list" })),
    ];
  },
  notes: (result): ToolNote[] => [
    { kind: "info", text: copy.readOnlyNote },
    ...result.notes.flatMap((n): ToolNote[] => {
      const text = noteText(n, result);
      return text === null ? [] : [{ kind: n.code === "blank-entries" || n.code === "overlong-entries" ? "warning" : "info", text }];
    }),
  ],
  command: "lookalikes",
});
