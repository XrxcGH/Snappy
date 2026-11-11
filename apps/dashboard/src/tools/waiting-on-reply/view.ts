import { insights } from "@snappy-export/core";
import { emptyState, factList, section, subsection } from "../../components/layout.ts";
import { pagedList } from "../../components/pagedList.ts";
import { toolView } from "../../components/toolPage.ts";
import type { ToolNote } from "../../components/toolPage.ts";
import { usernameText } from "../../components/usernameChip.ts";
import { h } from "../../dom.ts";
import { formatCount, formatDate } from "../../format.ts";
import type { ToolMeta } from "../types.ts";
import { copy } from "./copy.ts";
import { computeWaitingOnReply } from "./model.ts";
import type { WaitingResult } from "./model.ts";

export const meta: ToolMeta = { id: "waiting-on-reply", group: "chats", category: "quiet", icon: "one-way", needs: ["chats"] };

type Person = insights.waitingOnReply.WaitingPerson;
type OneSided = insights.waitingOnReply.OneSidedPerson;

/** One row: the username (shown only here, as text), then what Snappy infers about the wait or the balance. */
function personRow(username: string, strong: string, rest: string): HTMLElement {
  return h(
    "li",
    { class: "reply-row" },
    h("span", { class: "reply-who" }, usernameText(username)),
    h("span", { class: "reply-meta" }, h("span", { class: "reply-strong" }, strong), h("span", {}, rest)),
  );
}

const waitingList = (people: readonly Person[], key: string): HTMLElement =>
  pagedList(people, (p) => personRow(p.username, copy.unitDays(p.days), copy.unitSince(formatDate(p.since))), { key, className: "rows" });

const oneSidedList = (people: readonly OneSided[], key: string): HTMLElement =>
  pagedList(people, (p) => personRow(p.username, `${Math.round(p.share * 100)}%`, copy.unitSentReceived(p.sent, p.received)), { key, className: "rows" });

function waitingSection(heading: string, line: string, noneLine: string, people: readonly Person[], key: string): HTMLElement {
  return section(heading, h("p", {}, people.length > 0 ? line : noneLine), people.length > 0 ? waitingList(people, key) : null);
}

function oneSidedSection({ report, limits }: WaitingResult): HTMLElement {
  const you = report.oneSided.filter((p) => p.dominant === "you");
  const them = report.oneSided.filter((p) => p.dominant === "them");
  const part = (heading: string, people: readonly OneSided[], key: string): HTMLElement | null => (people.length > 0 ? subsection(heading, oneSidedList(people, key)) : null);
  return section(
    copy.oneSidedHeading,
    h("p", {}, report.oneSided.length > 0 ? copy.oneSidedLine(limits.windowDays, limits.sharePercent) : copy.oneSidedNoneLine),
    part(copy.youSendHeading, you, "waiting-on-reply:you-send"),
    part(copy.theySendHeading, them, "waiting-on-reply:they-send"),
  );
}

/** The sentence for one note: whole-number counts only, so no note can name a person. */
function noteText(n: insights.waitingOnReply.WaitingNote, result: WaitingResult): ToolNote {
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
    case "people-last-direction-unknown":
      return { kind: "info", text: copy.unknownDirectionNote(c) };
    case "people-last-event-tied":
      return { kind: "info", text: copy.tiedNote(c) };
    case "people-wait-too-old":
      return { kind: "info", text: copy.tooOldNote(c, result.limits.maxDays) };
    case "people-one-sided-direction-unreliable":
      return { kind: "info", text: copy.unreliableNote(c) };
    default:
      return { kind: "info", text: copy.otherNote };
  }
}

/** Two short lines of normal text, not one long caption: people need these to read. */
const limitsLines = (limits: WaitingResult["limits"]): HTMLElement => h("div", { class: "limits-lines" },
  h("p", {}, copy.limitsLine(limits.youDays, limits.themDays)),
  h("p", {}, copy.limitsToolLine),
);

export const view = toolView<WaitingResult, Record<string, never>>({
  meta,
  copy,
  compute: computeWaitingOnReply,
  summary: ({ report }) => copy.doneAnnounce(report.summary.waitingOnYou, report.summary.waitingOnThem, report.summary.oneSided),
  render: (result) => {
    const { report, limits } = result;
    // The empty state is drawn here, not by the frame, so the notes below it still say what was left out and why.
    if (report.summary.waitingOnYou + report.summary.waitingOnThem + report.summary.oneSided === 0) {
      return [emptyState({ icon: meta.icon, spot: "empty", category: meta.category, title: copy.empty.title, body: copy.empty.body }), limitsLines(limits)];
    }
    return [
      section(
        copy.countsHeading,
        factList([
          { label: copy.youCountLabel, value: formatCount(report.summary.waitingOnYou), icon: "people" },
          { label: copy.themCountLabel, value: formatCount(report.summary.waitingOnThem), icon: "queue" },
          { label: copy.oneSidedCountLabel, value: formatCount(report.summary.oneSided), icon: "one-way" },
        ]),
        report.asOf === null ? null : h("p", { class: "caption" }, copy.asOfLine(formatDate(report.asOf))),
      ),
      waitingSection(copy.youHeading, copy.youLine(limits.youDays), copy.youNoneLine, report.waitingOnYou, "waiting-on-reply:you"),
      waitingSection(copy.themHeading, copy.themLine(limits.themDays), copy.themNoneLine, report.waitingOnThem, "waiting-on-reply:them"),
      oneSidedSection(result),
      limitsLines(limits),
    ];
  },
  notes: (result) => [{ kind: "info", text: copy.hintNote }, ...result.report.notes.map((n) => noteText(n, result))],
  command: "replies",
});
