import { announce } from "../../announce.ts";
import { button } from "../../components/button.ts";
import { factList, section } from "../../components/layout.ts";
import { toolView } from "../../components/toolPage.ts";
import type { ToolNote } from "../../components/toolPage.ts";
import { usernameText } from "../../components/usernameChip.ts";
import { common } from "../../copy.ts";
import { h } from "../../dom.ts";
import { formatCount, formatDate } from "../../format.ts";
import type { ToolMeta } from "../types.ts";
import { controls } from "./controls.ts";
import { copy } from "./copy.ts";
import { DEFAULT_PARAMS, computeFriendsTable, csvFileName, csvText } from "./model.ts";
import type { FriendRow, FriendsTableNote, FriendsTableParams, FriendsTableResult } from "./model.ts";

export const meta: ToolMeta = { id: "friends-table", group: "friends", category: "requests", icon: "people", needs: ["friends"] };

/** Rows drawn at first, and added by each press of Show more. A long list is drawn in pages so the page stays light. */
const PAGE_SIZE = 50;

const count = (n: FriendsTableNote): number => n.params.count ?? 0;

/** The sentence for one note: whole-number counts only, so no note can name a person. */
function noteText(n: FriendsTableNote): ToolNote {
  const c = count(n);
  switch (n.code) {
    case "invalid-now":
      return { kind: "warning", text: copy.invalidNowNote };
    case "no-friends":
      return { kind: "warning", text: copy.noFriendsNote };
    case "no-events":
      return { kind: "info", text: copy.noEventsNote };
    case "events-without-time":
      return { kind: "info", text: copy.noTimeNote(c) };
    case "events-in-future":
      return { kind: "info", text: copy.futureNote(c) };
    case "group-events-skipped":
      return { kind: "info", text: copy.groupNote(c) };
    case "events-not-with-friends":
      return { kind: "info", text: copy.notFriendsNote(c) };
    case "friends-duplicates-merged":
      return { kind: "info", text: copy.duplicatesNote(c) };
    case "friends-invalid-username":
      return { kind: "info", text: copy.invalidUsernameNote(c) };
    case "friends-without-added-date":
      return { kind: "info", text: copy.noAddedNote(c) };
    case "quiet-not-judged-no-activity":
      return { kind: "info", text: copy.quietNoActivityNote };
    case "quiet-not-judged-short-history":
      return { kind: "info", text: copy.quietShortNote(c) };
    default:
      return { kind: "info", text: copy.otherNote };
  }
}

/** The hints on one row in words, as a sentence-case phrase, or the dash for none. */
function hintsCell(r: FriendRow): string {
  const parts: string[] = [];
  if (r.quiet) parts.push(copy.unitQuiet);
  if (r.oneSided) parts.push(copy.unitOneSided);
  if (r.waitingOn === "you") parts.push(copy.unitWaitingYou);
  if (r.waitingOn === "them") parts.push(copy.unitWaitingThem);
  const text = parts.join(", ");
  return text === "" ? copy.noHintsCell : `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

/** The cells after the username. Each says what it holds, since a phone shows no column names. */
const cellsOf = (r: FriendRow): string[] => [
  r.addedAt === null ? copy.noAddedCell : copy.addedCell(formatDate(r.addedAt)),
  r.lastAt === null ? copy.noLastCell : copy.lastCell(formatDate(r.lastAt)),
  copy.totalCell(r.total),
  copy.sentCell(r.sent),
  copy.receivedCell(r.received),
  hintsCell(r),
];

const HEADERS = [copy.friendHeader, copy.addedHeader, copy.lastHeader, copy.totalHeader, copy.sentHeader, copy.receivedHeader, copy.hintsHeader];

/**
 * The table, with the markup and classes of the shared data table, so the stylesheet stacks each row into a card on a phone. It is built
 * here because the username names each row and is shown as code (written as text, with invisible characters hidden), which the shared
 * table cannot draw.
 */
function friendsTable(rows: readonly FriendRow[]): HTMLElement {
  return h(
    "div",
    { class: "table-wrap" },
    h(
      "table",
      { class: "table", role: "table" },
      h("caption", { class: "table-caption" }, copy.tableCaption),
      h("thead", { role: "rowgroup" }, h("tr", { role: "row" }, ...HEADERS.map((text) => h("th", { scope: "col", role: "columnheader" }, text)))),
      h(
        "tbody",
        { role: "rowgroup" },
        ...rows.map((r) =>
          h("tr", { role: "row" }, h("th", { scope: "row", role: "rowheader" }, usernameText(r.username)), ...cellsOf(r).map((text) => h("td", { role: "cell" }, text))),
        ),
      ),
    ),
  );
}

/** The table in pages of fifty rows, with Show more under it. The list of rows is held, so a long export draws only what is asked for. */
function pagedTable(rows: readonly FriendRow[]): HTMLElement {
  let shown = Math.min(PAGE_SIZE, rows.length);
  const host = h("div", { class: "friends-table-host" });
  const footer = h("div", { class: "more" });
  const paintTable = (): void => {
    host.replaceChildren(friendsTable(rows.slice(0, shown)));
  };
  const paintFooter = (): void => {
    footer.replaceChildren();
    const remaining = rows.length - shown;
    if (remaining <= 0) return;
    footer.append(
      h("p", { class: "caption muted" }, common.showing(formatCount(shown), formatCount(rows.length))),
      button({
        label: common.showMore(Math.min(PAGE_SIZE, remaining)),
        key: "friends-table-more",
        onclick: () => {
          const from = shown;
          shown = Math.min(rows.length, shown + PAGE_SIZE);
          paintTable();
          paintFooter();
          const first = host.querySelectorAll<HTMLElement>("tbody tr")[from];
          first?.setAttribute("tabindex", "-1");
          first?.focus({ preventScroll: false });
          announce(common.showing(formatCount(shown), formatCount(rows.length)));
        },
      }),
    );
  };
  paintTable();
  paintFooter();
  return h("div", { class: "paged" }, host, footer);
}

export const view = toolView<FriendsTableResult, FriendsTableParams>({
  meta,
  copy,
  params: DEFAULT_PARAMS,
  compute: computeFriendsTable,
  summary: ({ table }) => copy.doneAnnounce(table.summary.friends, table.summary.quiet, table.summary.waiting),
  // Nothing in the table at all. A filter that matches no one is not empty: the controls stay and a line says so.
  isEmpty: ({ table }) => table.summary.friends === 0,
  controls,
  render: ({ table, rows, filtered, limits }) => [
    section(
      copy.glanceHeading,
      factList([
        { label: copy.friendsLabel, value: formatCount(table.summary.friends), icon: "people" },
        { label: copy.withChatsLabel, value: formatCount(table.summary.withEvents), icon: "snapshots" },
        { label: copy.quietLabel, value: formatCount(table.summary.quiet), icon: "quiet" },
        { label: copy.oneSidedLabel, value: formatCount(table.summary.oneSided), icon: "one-way" },
        { label: copy.waitingLabel, value: formatCount(table.summary.waiting), icon: "queue" },
      ]),
      table.asOf === null ? null : h("p", { class: "caption" }, copy.asOfLine(formatDate(table.asOf))),
    ),
    section(
      copy.friendsHeading,
      filtered ? h("p", {}, rows.length === 0 ? copy.noMatchLine : copy.matchLine(rows.length, table.summary.friends)) : null,
      rows.length === 0 ? null : pagedTable(rows),
    ),
    section(copy.hintsHeading, h("p", {}, copy.quietLine(limits.quietDays)), h("p", {}, copy.oneSidedLine(limits.windowDays)), h("p", {}, copy.waitingLine)),
  ],
  notes: ({ table }): ToolNote[] => [{ kind: "info", text: copy.hintNote }, ...table.notes.map(noteText)],
  download: {
    label: copy.downloadLabel,
    note: copy.downloadNote,
    build: ({ table, rows }) => ({ fileName: csvFileName(table.asOf), text: csvText(rows), mime: "text/csv" }),
  },
  command: "friends",
});
