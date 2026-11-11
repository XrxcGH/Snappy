/**
 * Waiting on a reply: what it computes from the chats the page holds, and what its page shows. Synthetic data only.
 * The people in the lists are the sample's friends; their usernames are canaries that may appear in the result
 * lists and nowhere else (not in a note, an announcement, a label or a document title).
 */
import { insights } from "@snappy-export/core";
import type { ChatEvent, FriendRecord, ParsedExport } from "@snappy-export/core";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAnalysisCache } from "../../src/analysis.ts";
import { tools } from "../../src/copy.ts";
import type { State, Workspace } from "../../src/reducer.ts";
import { COMMANDS, displayText } from "../../src/terminal/commands.ts";
import { toolData } from "../../src/tools/data.ts";
import { copy } from "../../src/tools/waiting-on-reply/copy.ts";
import { descriptor } from "../../src/tools/waiting-on-reply/index.ts";
import { computeWaitingOnReply } from "../../src/tools/waiting-on-reply/model.ts";
import { view } from "../../src/tools/waiting-on-reply/view.ts";
import { RULES, collectCopy, lint } from "../copy-rules.ts";
import type { FakeElement } from "../fake-dom.ts";
import { emptyState, render, renderSettled, sampleState, sampleWorkspace, settled, stateWith } from "./harness.ts";

const said: string[] = [];
vi.mock("../../src/announce.ts", () => ({ announce: (text: string) => void said.push(text) }));

const DAY = 24 * 60 * 60 * 1000;
let base: Workspace;
let sample: State;
let names: string[];
beforeAll(async () => {
  base = await sampleWorkspace();
  sample = await sampleState();
  names = (base.latest as ParsedExport).friends.friends.map((f) => f.username).filter((n) => n.length >= 5);
}, 120_000);
beforeEach(() => {
  resetAnalysisCache();
  said.length = 0;
});

const NOW = Date.UTC(2026, 10, 6, 12);
const ev = (conversation: string, direction: ChatEvent["direction"], daysAgo: number): ChatEvent => ({ conversation, isGroup: false, direction, kind: "TEXT", at: NOW - daysAgo * DAY });

/** A real (not sample) export made from the sample's, with crafted chats and, where given, crafted friends. */
function real(chats: ChatEvent[], friends?: readonly string[]): State {
  const parsed = base.latest as ParsedExport;
  const first = parsed.friends.friends[0] as FriendRecord;
  const list = friends ? friends.map((username) => ({ ...first, username })) : parsed.friends.friends;
  const latest: ParsedExport = { ...parsed, chats, exportedAt: NOW, friends: { ...parsed.friends, friends: list } };
  return stateWith({ latest, now: NOW, issues: [], parts: 1 });
}

/** Four friends in four situations: one waiting on you, one you wait on, one you write to most, one who writes to you most. */
function crafted(): { state: State; who: [string, string, string, string] } {
  const who = names.slice(0, 4) as [string, string, string, string];
  const [a, b, c, d] = who;
  const chats: ChatEvent[] = [
    ev(a, "sent", 9),
    ev(a, "received", 5),
    ev(b, "received", 20),
    ev(b, "sent", 10),
    ...Array.from({ length: 11 }, (_, i) => ev(c, "sent", 1 + i)),
    ev(c, "received", 30),
    ...Array.from({ length: 11 }, (_, i) => ev(d, "received", 1 + i)),
    ev(d, "sent", 30),
    { conversation: "group:abc", isGroup: true, direction: "sent", kind: "TEXT", at: NOW - DAY },
    { conversation: "group:abc", isGroup: true, direction: "received", kind: "TEXT", at: NOW - 2 * DAY },
  ];
  return { state: real(chats), who };
}

const text = (el: FakeElement, selector: string): string[] => el.querySelectorAll(selector).map((e) => e.textContent);
const rowNames = (el: FakeElement): string[] => text(el, "code.username");

describe("the tool", () => {
  it("is a Chats tool in the quiet color that needs chats and shows the replies command", () => {
    expect(descriptor).toMatchObject({ id: "waiting-on-reply", title: "Waiting on a reply", group: "chats", category: "quiet", needs: ["chats"] });
    expect(descriptor.oneLiner).toBe(copy.oneLiner);
    expect(COMMANDS.replies.argv[0]).toBe("replies");
  });

  it("passes the copy lint on its own words", () => {
    const entries = collectCopy({ waitingOnReply: copy });
    expect(entries.length).toBeGreaterThan(20);
    expect(RULES.flatMap((rule) => lint(entries, rule))).toEqual([]);
  });
});

describe("computeWaitingOnReply", () => {
  it("lists who waits on whom and which chats are one-sided, as core does", () => {
    const { state, who } = crafted();
    const { report, limits } = computeWaitingOnReply(toolData(state));
    expect(report.waitingOnYou).toEqual([{ username: who[0], since: NOW - 5 * DAY, days: 5 }]);
    expect(report.waitingOnThem.map((p) => [p.username, p.days])).toEqual([[who[1], 10]]);
    expect(report.oneSided.map((p) => [p.username, p.dominant, p.sent, p.received])).toEqual(
      expect.arrayContaining([
        [who[2], "you", 11, 1],
        [who[3], "them", 1, 11],
      ]),
    );
    expect(report.asOf).toBe(NOW);
    expect(report.notes.map((n) => n.code)).toContain("group-events-skipped");
    expect(limits).toEqual({ youDays: 3, themDays: 7, maxDays: 90, windowDays: 90, sharePercent: 85 });
  });

  it("uses the thresholds: three days waiting on you, seven days waiting on them", () => {
    const [a, b, c, d] = names;
    const state = real([ev(a as string, "received", 2), ev(b as string, "received", 3), ev(c as string, "sent", 6), ev(d as string, "sent", 7)]);
    const { report } = computeWaitingOnReply(toolData(state));
    expect(report.waitingOnYou.map((p) => p.username)).toEqual([b]);
    expect(report.waitingOnThem.map((p) => p.username)).toEqual([d]);
  });

  it("measures up to the export's date, so an old export does not make everyone look long overdue", () => {
    const a = names[0] as string;
    const parsed = base.latest as ParsedExport;
    const latest: ParsedExport = { ...parsed, chats: [ev(a, "received", 45)], exportedAt: NOW - 38 * DAY };
    const { report } = computeWaitingOnReply(toolData(stateWith({ latest, now: NOW, issues: [], parts: 1 })));
    expect(report.asOf).toBe(NOW - 38 * DAY);
    expect(report.waitingOnYou[0]?.days).toBe(7);
  });

  it("finds nothing in chats that are all quiet, and leaves out people who are not friends", () => {
    const [a, b] = names as [string, string];
    const state = real([ev(a, "received", 5), ev(b, "received", 5)], [b]);
    const { report } = computeWaitingOnReply(toolData(state));
    expect(report.waitingOnYou.map((p) => p.username)).toEqual([b]);
    expect(report.notes.find((n) => n.code === "people-not-in-friends")?.params.count).toBe(1);
    expect(computeWaitingOnReply(toolData(real([ev(a, "sent", 1), ev(a, "received", 0)]))).report.summary).toMatchObject({ waitingOnYou: 0, waitingOnThem: 0, oneSided: 0 });
  });

  it("holds no message text: the report keeps only names, dates and counts", () => {
    const { state } = crafted();
    const json = JSON.stringify(computeWaitingOnReply(toolData(state)));
    expect(json).not.toMatch(/TEXT|kind|group:abc/);
  });

  it("refuses to run without an export (the page never calls it that way)", () => {
    expect(() => computeWaitingOnReply(toolData(emptyState()))).toThrow();
  });
});

describe("the page", () => {
  it("shows the counts, a list for each side, one-sided chats by who sends most, and the replies command", async () => {
    const { state, who } = crafted();
    const { root } = await renderSettled(view, state);
    expect(text(root, ".section-title")).toEqual([copy.countsHeading, copy.youHeading, copy.themHeading, copy.oneSidedHeading, tools.notesHeading, tools.commandHeading]);
    expect(text(root, ".subheading")).toEqual([copy.youSendHeading, copy.theySendHeading]);
    expect(text(root, ".fact dd")).toEqual(["1", "1", "2"]);
    const lists = root.querySelectorAll("ul.rows");
    expect(lists.map(rowNames)).toEqual([[who[0]], [who[1]], [who[2]], [who[3]]]);
    expect(lists[0]?.textContent).toContain("5 days");
    expect(lists[1]?.textContent).toContain("10 days");
    expect(lists[2]?.textContent).toContain("11 sent, 1 received");
    expect(lists[3]?.textContent).toContain("1 sent, 11 received");
    expect(root.textContent).toContain(copy.asOfLine("Nov 6, 2026"));
    expect(root.querySelector(".command code")?.textContent).toBe(displayText(COMMANDS.replies));
    expect(root.querySelector("button.btn-secondary[data-key='tool-download']")).toBeNull();
  });

  it("says in a line when one list is empty, rather than leaving a heading with nothing", async () => {
    const a = names[0] as string;
    const { root } = await renderSettled(view, real([ev(a, "received", 5)]));
    expect(text(root, ".tool-result p")).toEqual(expect.arrayContaining([copy.themNoneLine, copy.oneSidedNoneLine]));
    expect(root.textContent).not.toContain(copy.youNoneLine);
    expect(root.querySelectorAll("ul.rows")).toHaveLength(1);
  });

  it("pages a long list: fifty people first, then Show more", async () => {
    const people = Array.from({ length: 55 }, (_, i) => `zq.person.${String(i).padStart(2, "0")}`);
    const { root } = await renderSettled(view, real(people.map((p) => ev(p, "received", 5)), people));
    expect(root.querySelectorAll("li.reply-row")).toHaveLength(50);
    expect(root.querySelector(".more .caption")?.textContent).toBe("Showing 50 of 55");
    root.querySelector(".more button")?.click();
    expect(root.querySelectorAll("li.reply-row")).toHaveLength(55);
  });

  it("writes each note as a short hedged sentence, from counts alone", async () => {
    const { state } = crafted();
    const { root } = await renderSettled(view, state);
    const notes = text(root, ".tool-notes li");
    expect(notes).toEqual([copy.hintNote, copy.groupNote(2)]);
    for (const n of notes) expect(n).not.toMatch(/[a-z]+-[a-z]+-[a-z]+/);
  });

  it("shows each kind of note with its count", async () => {
    const [a, b, c] = names as [string, string, string];
    const events: ChatEvent[] = [
      { ...ev(a, "unknown", 5) },
      { ...ev(b, "sent", 4), at: Number.NaN },
      ev(c, "sent", -3),
      { ...ev("", "sent", 2) },
      ev("someone.outside.the.list", "received", 5),
      ev(a, "sent", 100),
    ];
    const { root } = await renderSettled(view, real(events, [a, b, c]));
    const notes = text(root, ".tool-notes li");
    expect(notes).toEqual(expect.arrayContaining([copy.noTimeNote(1), copy.futureNote(1), copy.noPersonNote(1), copy.notFriendsNote(1), copy.unknownDirectionNote(1)]));
  });

  it("states the fixed limits under the result, from the limits core used, and names the options that change them", async () => {
    const { state } = crafted();
    const { root } = await renderSettled(view, state);
    const d = insights.waitingOnReply.WAITING_DEFAULTS;
    expect(text(root, ".limits-lines p")).toEqual([copy.limitsLine(d.waitingOnYouDays, d.waitingOnThemDays), copy.limitsToolLine]);
    expect(root.querySelectorAll(".limits-lines .caption")).toHaveLength(0);
    expect(copy.limitsLine(3, 7)).toBe("The limits are fixed: 3 days for you and 7 days for them.");
    expect(copy.limitsToolLine).toBe("To change them, use --you-days and --them-days in the command line tool.");
    for (const t of [copy.limitsLine(3, 7), copy.limitsToolLine]) expect(t.length).toBeLessThanOrEqual(76);
  });

  it("announces the counts politely once, and without a name", async () => {
    const { state } = crafted();
    await renderSettled(view, state);
    expect(said).toEqual(["Replies checked. 1 person may be waiting on you, 1 on them, and 2 chats look one-sided."]);
    expect(said[0]?.length).toBeLessThanOrEqual(140);
    for (const name of names) expect(said[0], name).not.toContain(name);
  });
});

describe("when nothing is waiting", () => {
  it("shows the honest empty state instead of three empty lists", async () => {
    const a = names[0] as string;
    const { root } = await renderSettled(view, real([ev(a, "sent", 1), ev(a, "received", 0)]));
    expect(text(root, ".empty-title")).toEqual([copy.empty.title]);
    expect(text(root, ".empty-body")).toEqual([copy.empty.body]);
    expect(root.querySelectorAll("ul.rows")).toHaveLength(0);
    expect(text(root, ".tool-notes li")).toEqual([copy.hintNote]);
    // The limits matter most when nothing was found, so they are said here too.
    expect(text(root, ".limits-lines p")).toEqual([copy.limitsLine(3, 7), copy.limitsToolLine]);
    expect(root.querySelector(".command code")?.textContent).toBe(displayText(COMMANDS.replies));
  });

  it("says so for chats that are all group chats too", async () => {
    const group: ChatEvent = { conversation: "group:abc", isGroup: true, direction: "received", kind: "TEXT", at: NOW - 5 * DAY };
    const { root } = await renderSettled(view, real([group]));
    expect(text(root, ".empty-title")).toEqual([copy.empty.title]);
  });
});

describe("without chats", () => {
  it("says plainly that chats are needed, and offers the next step", async () => {
    const { root } = render(view, emptyState());
    expect(text(root, ".empty-title")).toEqual([tools.needs.exportTitle]);
    expect(root.querySelector(".empty a")?.getAttribute("href")).toBe("#/start");
    expect(root.querySelector(".tool-result")).toBeNull();
    await settled(root);
  });

  it("names the chats when the export has friends but no chat history", async () => {
    const { root } = await renderSettled(view, real([]));
    expect(text(root, ".empty-title")).toEqual([tools.needs.chatsTitle]);
    expect(root.querySelector(".empty a")?.getAttribute("href")).toBe("#/tools/export-check");
  });
});

describe("privacy", () => {
  it("shows a username only in the result lists, and in no note, announcement, label, title or heading", async () => {
    const { state } = crafted();
    const { root } = await renderSettled(view, state);
    const shown = new Set(rowNames(root));
    expect(shown.size).toBe(4);
    for (const el of root.descendants()) {
      const own = el.childNodes.filter((c) => "data" in c).map((c) => (c as unknown as { data: string }).data).join(" ");
      const labels = ["aria-label", "title", "alt"].map((a) => el.getAttribute(a) ?? "").join(" ");
      for (const name of shown) {
        expect(labels, name).not.toContain(name);
        if (own.includes(name)) expect(el.tagName === "code" && el.classList.contains("username") && inList(el), `${el.tagName}.${el.className}`).toBe(true);
      }
    }
    for (const name of shown) {
      expect(said.join(" "), name).not.toContain(name);
      expect(text(root, ".tool-notes li, .notice, h1, h2, h3, .lead, .tool-reads, .empty-body, .caption").join(" "), name).not.toContain(name);
    }
    expect(root.querySelector("title")).toBeNull();
  });

  it("shows no username for the sample outside its lists, and holds no link or message text", async () => {
    const { root } = await renderSettled(view, sample);
    const page = root.textContent;
    expect(page).not.toMatch(/https?:|\.(jpg|mp4|png)\b/i);
    for (const name of names) {
      for (const el of root.descendants()) {
        const own = el.childNodes.filter((c) => "data" in c).map((c) => (c as unknown as { data: string }).data).join(" ");
        if (own.includes(name)) expect(inList(el), name).toBe(true);
      }
    }
  });

  it("shows an unusual username as plain text, with invisible characters made visible", async () => {
    const odd = "zq‮evil<b>x</b>";
    const { root } = await renderSettled(view, real([ev(odd, "received", 5)], [odd]));
    const shown = rowNames(root)[0] ?? "";
    expect(shown).toBe("zq?evil<b>x</b>");
    expect(root.querySelectorAll("b")).toHaveLength(0);
  });
});

function inList(el: FakeElement): boolean {
  for (let n: { parentNode: unknown } | null = el; n; n = n.parentNode as typeof n) {
    if ((n as FakeElement).classList?.contains("rows")) return true;
  }
  return false;
}
