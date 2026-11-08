import { dataTable } from "../../components/dataTable.ts";
import type { TableCell } from "../../components/dataTable.ts";
import { icon } from "../../components/icon.ts";
import { factList, section, subsection } from "../../components/layout.ts";
import { toolView } from "../../components/toolPage.ts";
import type { ToolNote, ToolUi } from "../../components/toolPage.ts";
import { usernameText } from "../../components/usernameChip.ts";
import { h } from "../../dom.ts";
import { formatCount, formatDate } from "../../format.ts";
import { offsetLabel, startingOffset, zoneOptions } from "../timezone.ts";
import type { ToolMeta } from "../types.ts";
import { copy } from "./copy.ts";
import { computeReplySpeed, csvFileName, DEFAULT_PARAMS, friendsCsvText, FRIENDS_SHOWN } from "./model.ts";
import type { ReplySpeedParams, ReplySpeedReport, ReplySpeedResult } from "./model.ts";

export const meta: ToolMeta = { id: "reply-speed", group: "chats", category: "quiet", icon: "queue", needs: ["chats"] };

const HOUR_MS = 3_600_000;
const num = (v: number | undefined): number => (typeof v === "number" ? v : 0);
const hoursOf = (report: ReplySpeedReport): number => report.windowMs / HOUR_MS;

/** A reply time as words, or the dash when there is none. */
const timeText = (ms: number | null | undefined): string => (typeof ms === "number" ? copy.unitDuration(ms) || copy.noValue : copy.noValue);

/** A cell that shows the bare value its column names ("10 minutes"); a screen reader, and a phone with no column names, get the phrase ("10 minutes typical"). */
const typicalCell = (ms: number | null | undefined): TableCell => ({ text: timeText(ms), label: copy.unitTypicalCell(timeText(ms)) });
const repliesCell = (n: number): TableCell => ({ text: formatCount(n), label: copy.unitRepliesCell(n) });

/**
 * The first column of a result table names a friend. dataTable writes plain text, so each name is put in the shared
 * username element: still text only, with invisible and direction-changing characters shown as question marks.
 */
function nameRows(table: HTMLElement, names: readonly string[]): HTMLElement {
  table.querySelectorAll("tbody th").forEach((th, i) => th.replaceChildren(usernameText(names[i] ?? "")));
  return table;
}

/** The sentence for one note: whole-number counts only, so no note can name a person. */
function noteOf(n: ReplySpeedReport["notes"][number], report: ReplySpeedReport): ToolNote {
  const c = num(n.params.count);
  const hours = hoursOf(report);
  switch (n.code) {
    case "invalid-now":
      return { kind: "warning", text: copy.invalidNowNote };
    case "no-events":
      return { kind: "warning", text: copy.noEventsNote };
    case "no-one-to-one-events":
      return { kind: "warning", text: copy.noOneToOneNote };
    case "no-replies-found":
      return { kind: "warning", text: copy.noRepliesNote(hours) };
    case "few-replies-overall":
      return { kind: "warning", text: copy.fewNote(c) };
    case "events-without-time":
      return { kind: "info", text: copy.noTimeNote(c) };
    case "events-in-future":
      return { kind: "info", text: copy.futureNote(c) };
    case "events-without-person":
      return { kind: "info", text: copy.noPersonNote(c) };
    case "group-events-skipped":
      return { kind: "info", text: copy.groupNote(c) };
    case "events-direction-unknown":
      return { kind: "info", text: copy.unknownDirectionNote(c) };
    case "people-not-in-friends":
      return { kind: "info", text: copy.notFriendsNote(c) };
    case "turns-after-window":
      return { kind: "info", text: copy.lateNote(c, hours) };
    case "turns-at-same-time":
      return { kind: "info", text: copy.sameTimeNote(c) };
    case "people-below-minimum":
      return { kind: "info", text: copy.belowMinNote(c, report.minReplies) };
    case "offset-adjusted":
      return { kind: "info", text: copy.zoneNote };
    default:
      return { kind: "info", text: copy.otherNote };
  }
}

function glance({ report }: ReplySpeedResult): HTMLElement {
  const { you, them } = report.overall;
  return section(
    copy.glanceHeading,
    factList([
      { label: copy.youTypicalLabel, value: timeText(you?.medianMs), icon: "queue" },
      { label: copy.themTypicalLabel, value: timeText(them?.medianMs), icon: "queue" },
      { label: copy.youCountLabel, value: formatCount(report.summary.youReplies), icon: "people" },
      { label: copy.themCountLabel, value: formatCount(report.summary.themReplies), icon: "people" },
    ]),
    you === null ? null : h("p", {}, copy.youNineLine(timeText(you.p90Ms))),
    them === null ? null : h("p", {}, copy.themNineLine(timeText(them.p90Ms))),
    h("p", { class: "caption" }, copy.methodLine(hoursOf(report))),
    report.asOf === null ? null : h("p", { class: "caption" }, copy.asOfLine(formatDate(report.asOf))),
  );
}

/** One ranking as a table. Each cell says what it is ("6 replies"), because on a phone a table is a stack of cards with no column names. */
function rankTable(caption: string, list: ReplySpeedReport["fastest"]["you"]): HTMLElement {
  return nameRows(
    dataTable(
      caption,
      [copy.friendHeader, copy.typicalHeader, copy.repliesHeader],
      list.map((p): TableCell[] => [p.username, typicalCell(p.medianMs), repliesCell(p.replies)]),
    ),
    list.map((p) => p.username),
  );
}

function rankings({ report }: ReplySpeedResult): HTMLElement {
  const lists: [string, string, ReplySpeedReport["fastest"]["you"]][] = [
    [copy.youFastHeading, copy.youFastCaption, report.fastest.you],
    [copy.youSlowHeading, copy.youSlowCaption, report.slowest.you],
    [copy.themFastHeading, copy.themFastCaption, report.fastest.them],
    [copy.themSlowHeading, copy.themSlowCaption, report.slowest.them],
  ];
  const shown = lists.filter(([, , list]) => list.length > 0);
  return section(
    copy.rankHeading,
    h("p", {}, shown.length > 0 ? copy.rankLine(report.minReplies) : copy.rankNoneLine),
    ...shown.map(([heading, caption, list]) => subsection(heading, rankTable(caption, list))),
  );
}

function hourSection({ report, hours: rows }: ReplySpeedResult): HTMLElement {
  return section(
    copy.hourHeading,
    h("p", {}, copy.hourLine(offsetLabel(report.utcOffsetMinutes))),
    dataTable(
      copy.hourCaption,
      [copy.hourHeader, copy.hourYouHeader, copy.hourThemHeader],
      rows.map((b) => [
        copy.unitHour(b.hour),
        copy.hourCell(b.youReplies, b.youMedianMs === null ? "" : timeText(b.youMedianMs)),
        copy.hourCell(b.themReplies, b.themMedianMs === null ? "" : timeText(b.themMedianMs)),
      ]),
    ),
  );
}

function friends({ report, shown }: ReplySpeedResult): HTMLElement | null {
  if (shown.length === 0) return null;
  const side = (replies: number, spread: { medianMs: number } | null): TableCell[] => [repliesCell(replies), spread === null ? copy.tooFewCell : typicalCell(spread.medianMs)];
  return section(
    copy.friendsHeading,
    h("p", {}, copy.friendsLine(report.minReplies)),
    nameRows(
      dataTable(
        copy.friendsCaption,
        [copy.friendHeader, copy.youRepliesHeader, copy.youTypicalHeader, copy.themRepliesHeader, copy.themTypicalHeader],
        shown.map((f): TableCell[] => [f.username, ...side(f.youReplies, f.you), ...side(f.themReplies, f.them)]),
      ),
      shown.map((f) => f.username),
    ),
    report.friends.length > FRIENDS_SHOWN ? h("p", { class: "caption" }, copy.friendsMoreLine(report.friends.length - FRIENDS_SHOWN)) : null,
  );
}

/**
 * The page opens in the zone the person's device is in (or the one chosen in Settings), read each time the page opens. A zone
 * picked on this page stays on this page: it is not remembered for the next one.
 */
const START: ReplySpeedParams = Object.defineProperty({ ...DEFAULT_PARAMS }, "utcOffsetMinutes", { get: startingOffset, enumerable: true, configurable: true });

function zoneField(ui: ToolUi<ReplySpeedParams>): HTMLElement {
  const id = "reply-speed-zone";
  const select = h(
    "select",
    { id, class: "input", "data-key": id, "aria-describedby": `${id}-help` },
    ...zoneOptions(ui.params.utcOffsetMinutes),
  );
  select.addEventListener("change", () => {
    const minutes = Number(select.value);
    if (Number.isFinite(minutes)) ui.set({ utcOffsetMinutes: minutes });
  });
  // The select draws no native arrow: the chevron is its own icon.
  const chevron = icon("chevron-right", 16);
  chevron.setAttribute("class", "icon select-chevron");
  return h(
    "div",
    { class: "field" },
    h("label", { class: "label", for: id }, copy.zoneLabel),
    h("div", { class: "select-wrap" }, select, chevron),
    h("p", { class: "caption", id: `${id}-help` }, copy.zoneHelp),
  );
}

export const view = toolView<ReplySpeedResult, ReplySpeedParams>({
  meta,
  copy,
  params: START,
  compute: computeReplySpeed,
  summary: ({ report }) => (report.summary.youReplies + report.summary.themReplies === 0 ? copy.emptyAnnounce : copy.doneAnnounce(report.summary.youReplies, report.summary.themReplies)),
  isEmpty: ({ report }) => report.summary.youReplies + report.summary.themReplies === 0,
  controls: zoneField,
  render: (result) => [glance(result), rankings(result), hourSection(result), friends(result)],
  notes: ({ report }): ToolNote[] => [{ kind: "info", text: copy.hintNote }, ...report.notes.map((n) => noteOf(n, report))],
  download: {
    label: copy.downloadLabel,
    note: copy.downloadNote,
    build: ({ report }) => ({ fileName: csvFileName(report.asOf), text: friendsCsvText(report), mime: "text/csv" }),
  },
  command: "reply-speed",
});
