import { button } from "../../components/button.ts";
import { dataTable } from "../../components/dataTable.ts";
import { emptyState, factList, section } from "../../components/layout.ts";
import { toolView } from "../../components/toolPage.ts";
import type { ToolNote } from "../../components/toolPage.ts";
import { usernameText } from "../../components/usernameChip.ts";
import { h } from "../../dom.ts";
import { formatCount, formatDate, formatPercent } from "../../format.ts";
import type { ToolMeta } from "../types.ts";
import { copy } from "./copy.ts";
import { computeReachOutFirst, DEFAULT_PARAMS, GAP_CHOICES } from "./model.ts";
import type { ReachOutNote, ReachOutParams, ReachOutPerson, ReachOutReport } from "./model.ts";

export const meta: ToolMeta = { id: "reach-out-first", group: "chats", category: "quiet", icon: "people", needs: ["chats"] };

/** A long list would make a very long table, so the page shows the strongest cases and says how many it left out. */
const SHOWN = 50;

/**
 * The first column of a result table names a friend. dataTable writes plain text, so each name is put in the shared
 * username element: still text only, with invisible and direction-changing characters shown as question marks.
 */
function nameRows(table: HTMLElement, names: readonly string[]): HTMLElement {
  table.querySelectorAll("tbody th").forEach((th, i) => th.replaceChildren(usernameText(names[i] ?? "")));
  return table;
}

/** One list: the rule in a line, then a table of the chats (or a line saying none were found). */
function sideSection(heading: string, caption: string, rule: string, none: string, people: readonly ReachOutPerson[], side: "you" | "them"): HTMLElement {
  const shown = people.slice(0, SHOWN);
  const rows = shown.map((p) => [p.username, formatCount(p.byYou), formatCount(p.byThem), formatPercent((side === "you" ? p.byYou : p.byThem) / p.exchanges)]);
  return section(
    heading,
    h("p", {}, people.length > 0 ? rule : none),
    people.length > 0 ? nameRows(dataTable(caption, [copy.friendHeader, copy.youStartedHeader, copy.theyStartedHeader, copy.shareHeader], rows), shown.map((p) => p.username)) : null,
    people.length > shown.length ? h("p", { class: "caption" }, copy.moreLine(people.length - shown.length)) : null,
  );
}

/** The sentence for one note: whole-number counts only, so no note can name a person. */
function noteOf(n: ReachOutNote): ToolNote {
  const c = n.params.count ?? 0;
  switch (n.code) {
    case "invalid-now":
      return { kind: "warning", text: copy.invalidNowNote };
    case "no-events":
      return { kind: "warning", text: copy.noEventsNote };
    case "no-one-to-one-events":
      return { kind: "info", text: copy.noOneToOneNote };
    case "group-events-skipped":
      return { kind: "info", text: copy.groupNote(c) };
    case "events-without-time":
      return { kind: "info", text: copy.noTimeNote(c) };
    case "events-in-future":
      return { kind: "info", text: copy.futureNote(c) };
    case "events-without-person":
      return { kind: "info", text: copy.noPersonNote(c) };
    case "people-not-in-friends":
      return { kind: "info", text: copy.notFriendsNote(c) };
    case "exchanges-starter-unknown":
      return { kind: "info", text: copy.starterUnknownNote(c) };
    case "exchanges-starter-tied":
      return { kind: "info", text: copy.starterTiedNote(c) };
    case "people-too-few-exchanges":
      return { kind: "info", text: copy.tooFewNote(c) };
    case "people-starter-unreliable":
      return { kind: "info", text: copy.unreliableNote(c) };
    default:
      return { kind: "info", text: copy.otherNote };
  }
}

export const view = toolView<ReachOutReport, ReachOutParams>({
  meta,
  copy,
  params: DEFAULT_PARAMS,
  compute: computeReachOutFirst,
  summary: (r) => (r.overall.exchanges === 0 ? copy.emptyAnnounce : copy.doneAnnounce(r.summary.mostlyThem, r.summary.mostlyYou)),
  // Built once, so the choice keeps focus while the result repaints. Only the pressed state is kept in step.
  controls: (ui) => {
    const buttons = GAP_CHOICES.map((hours) =>
      button({
        label: String(hours),
        ariaLabel: copy.unitGap(hours),
        key: `gap-${hours}`,
        pressed: ui.params.gapHours === hours,
        onclick: () => {
          ui.set({ gapHours: hours });
          GAP_CHOICES.forEach((g, i) => buttons[i]?.setAttribute("aria-pressed", String(g === hours)));
        },
      }),
    );
    return h("div", { class: "controls" }, h("p", { class: "label" }, copy.gapLabel), h("div", { class: "segmented", role: "group", "aria-label": copy.gapLabel }, ...buttons));
  },
  render: (r) => {
    // The empty state is drawn here, not by the frame, so the notes below it still say what was left out and why.
    const { overall, settings } = r;
    if (overall.exchanges === 0 || overall.youShare === null) {
      return [emptyState({ icon: meta.icon, spot: "empty", category: meta.category, title: copy.empty.title, body: copy.empty.body })];
    }
    const you = Math.round(overall.youShare * 100);
    const percent = Math.round(settings.mostlyShare * 100);
    return [
      section(
        copy.glanceHeading,
        factList([
          { label: copy.chatsLabel, value: formatCount(r.summary.people), icon: "people" },
          { label: copy.exchangesLabel, value: formatCount(overall.exchanges), icon: "list" },
          { label: copy.youLabel, value: formatCount(overall.byYou), icon: "one-way" },
          { label: copy.themLabel, value: formatCount(overall.byThem), icon: "queue" },
        ]),
        h("p", {}, copy.shareLine(`${you}%`, `${100 - you}%`)),
        r.asOf === null ? null : h("p", { class: "caption" }, copy.methodLine(formatDate(r.asOf), settings.gapHours)),
      ),
      sideSection(copy.themHeading, copy.themCaption, copy.themRuleLine(settings.minExchanges, percent), copy.themNoneLine, r.mostlyThem, "them"),
      sideSection(copy.youHeading, copy.youCaption, copy.youRuleLine(settings.minExchanges, percent), copy.youNoneLine, r.mostlyYou, "you"),
    ];
  },
  notes: (r): ToolNote[] => [{ kind: "info", text: copy.hintNote }, ...r.notes.map(noteOf)],
  command: "reach-out",
});
