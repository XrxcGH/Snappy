import { insights } from "@snappy-export/core";
import { button } from "../../components/button.ts";
import { dataTable } from "../../components/dataTable.ts";
import type { TableCell } from "../../components/dataTable.ts";
import { factList, section } from "../../components/layout.ts";
import { toolView } from "../../components/toolPage.ts";
import type { ToolNote } from "../../components/toolPage.ts";
import { h } from "../../dom.ts";
import { formatCount, formatDate, formatPercent } from "../../format.ts";
import { usernameText } from "../../components/usernameChip.ts";
import type { ToolMeta } from "../types.ts";
import { copy } from "./copy.ts";
import { computeClosestFading, DEFAULT_PARAMS, WINDOW_CHOICES } from "./model.ts";
import type { ClosestFadingParams, ClosestFadingResult } from "./model.ts";

export const meta: ToolMeta = { id: "closest-fading", group: "friends", category: "requests", icon: "people", needs: ["export", "friends", "chats"] };

/** A long fading list would make a very long table, so the page shows the strongest drops and says how many it left out. */
const FADING_SHOWN = 50;

/**
 * The first column of a result table names a friend. dataTable writes plain text, so each name is put in the shared
 * username element: still text only, with invisible and direction-changing characters shown as question marks.
 */
function nameRows(table: HTMLElement, names: readonly string[]): HTMLElement {
  table.querySelectorAll("tbody th").forEach((th, i) => th.replaceChildren(usernameText(names[i] ?? "")));
  return table;
}

const num = (v: number | undefined): number => (typeof v === "number" ? v : 0);

/** The sentence for one core note code. Hedged, counts only: nobody is named. */
function noteOf(n: insights.closestFading.ClosestFadingNote): ToolNote {
  const count = num(n.params.count);
  switch (n.code) {
    case "invalid-reference-time":
      return { kind: "warning", text: copy.badDateNote };
    case "no-activity-data":
      return { kind: "warning", text: copy.noActivityNote };
    case "no-one-to-one-activity":
      return { kind: "warning", text: copy.groupOnlyNote };
    case "measured-to-export-date":
      return { kind: "info", text: copy.measuredNote(num(n.params.daysBeforeNow)) };
    case "history-starts-inside-earlier-window":
      return { kind: "info", text: copy.startsLateNote };
    case "future-events-ignored":
      return { kind: "info", text: copy.futureNote(count) };
    case "undated-events-ignored":
      return { kind: "info", text: copy.undatedNote(count) };
    case "non-friend-events-ignored":
      return { kind: "info", text: copy.nonFriendNote(count) };
    default:
      return { kind: "info", text: copy.otherNote };
  }
}

function glanceSection(r: ClosestFadingResult): HTMLElement {
  return section(
    copy.glanceHeading,
    factList([
      { label: copy.factFriendsHeader, value: formatCount(r.counts.friends), icon: "people" },
      { label: copy.factActiveHeader, value: formatCount(r.counts.withRecentActivity), icon: "check" },
      { label: copy.factFadingHeader, value: formatCount(r.fading.length), icon: "quiet" },
    ]),
    h("p", {}, copy.methodLine(formatDate(r.asOf), r.settings.windowDays)),
  );
}

/** Each cell says what it is ("49 sent"), because on a phone the table is a stack of cards with no column names. */
function closestSection(r: ClosestFadingResult): HTMLElement {
  const rows = r.closest.map((f): TableCell[] => [
    f.key,
    { text: formatPercent(f.relativeScore), label: copy.activityCell(formatPercent(f.relativeScore)) },
    { text: formatCount(f.events.sent), label: copy.sentCell(f.events.sent) },
    { text: formatCount(f.events.received), label: copy.receivedCell(f.events.received) },
    { text: formatDate(f.lastAt), label: copy.lastCell(formatDate(f.lastAt)) },
  ]);
  return section(
    copy.closestHeading,
    h("p", {}, copy.closestLine),
    r.closest.length === 0
      ? h("p", {}, copy.noClosestLine(r.settings.minClosestEvents))
      : nameRows(
          dataTable(copy.closestCaption, [copy.friendHeader, copy.activityHeader, copy.sentHeader, copy.receivedHeader, copy.lastHeader], rows),
          r.closest.map((f) => f.key),
        ),
  );
}

function fadingSection(r: ClosestFadingResult): HTMLElement {
  const shown = r.fading.slice(0, FADING_SHOWN);
  const rows = shown.map((f): TableCell[] => [
    f.key,
    { text: formatCount(f.earlierEvents), label: copy.earlierCell(f.earlierEvents) },
    { text: formatCount(f.recentEvents), label: copy.recentCell(f.recentEvents) },
    copy.changeCell(formatPercent(f.dropFraction)),
    { text: formatDate(f.lastAt), label: copy.lastCell(formatDate(f.lastAt)) },
  ]);
  return section(
    copy.fadingHeading,
    h("p", {}, copy.fadingLine(r.settings.windowDays)),
    r.fading.length === 0
      ? h("p", {}, copy.noFadingLine)
      : nameRows(
          dataTable(copy.fadingCaption, [copy.friendHeader, copy.earlierHeader, copy.recentHeader, copy.changeHeader, copy.lastHeader], rows),
          shown.map((f) => f.key),
        ),
    r.fading.length > shown.length ? h("p", { class: "caption" }, copy.fadingMoreLine(r.fading.length - shown.length)) : null,
  );
}

export const view = toolView<ClosestFadingResult, ClosestFadingParams>({
  meta,
  copy,
  params: DEFAULT_PARAMS,
  compute: computeClosestFading,
  summary: (r) => (r.closest.length + r.fading.length === 0 ? copy.emptyAnnounce : copy.doneAnnounce(r.closest.length, r.fading.length)),
  isEmpty: (r) => r.closest.length + r.fading.length === 0,
  // Built once, so the choice keeps focus while the result repaints. Only the pressed state is kept in step.
  controls: (ui) => {
    const buttons = WINDOW_CHOICES.map((days) =>
      button({
        label: String(days),
        ariaLabel: copy.unitWindow(days),
        key: `window-${days}`,
        pressed: ui.params.windowDays === days,
        onclick: () => {
          ui.set({ windowDays: days });
          WINDOW_CHOICES.forEach((d, i) => buttons[i]?.setAttribute("aria-pressed", String(d === days)));
        },
      }),
    );
    return h("div", { class: "controls" }, h("p", { class: "label" }, copy.windowLabel), h("div", { class: "segmented", role: "group", "aria-label": copy.windowLabel }, ...buttons));
  },
  render: (r) => [glanceSection(r), closestSection(r), fadingSection(r)],
  notes: (r): ToolNote[] => [
    ...r.notes.map(noteOf),
    ...(r.fading.length > 0 ? [{ kind: "info" as const, text: copy.fadingNote }] : []),
    { kind: "info", text: copy.savedOnlyNote },
  ],
  command: "closest",
});
