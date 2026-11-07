/**
 * Friends table: what it computes from the friends and chats the page holds, and what its page shows and downloads.
 * Synthetic data only. The friends in the crafted export have invented names. Their usernames may appear in the result
 * table and in the file a button press writes, and nowhere else (not in a note, an announcement, a label or a heading).
 */
import { insights } from "@snappy-export/core";
import type { ChatEvent, FriendRecord, ParsedExport } from "@snappy-export/core";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAnalysisCache } from "../../src/analysis.ts";
import { tools } from "../../src/copy.ts";
import type { State, Workspace } from "../../src/reducer.ts";
import { COMMANDS, displayText } from "../../src/terminal/commands.ts";
import { toolData } from "../../src/tools/data.ts";
import { copy } from "../../src/tools/friends-table/copy.ts";
import { descriptor } from "../../src/tools/friends-table/index.ts";
import { DEFAULT_PARAMS, SORT_ORDERS, SHOW_FILTERS, computeFriendsTable, csvFileName, csvText, orderIdOf } from "../../src/tools/friends-table/model.ts";
import { view } from "../../src/tools/friends-table/view.ts";
import { RULES, collectCopy, lint, useNames } from "../copy-rules.ts";
import type { FakeElement } from "../fake-dom.ts";
import { emptyState, render, renderSettled, sampleState, sampleWorkspace, settled, stateWith } from "./harness.ts";

const said: string[] = [];
const saved: { fileName: string; text: string; mime: string }[] = [];
vi.mock("../../src/announce.ts", () => ({ announce: (text: string) => void said.push(text) }));
vi.mock("../../src/download.ts", () => ({
  saveTextFile: (fileName: string, text: string, mime: string) => {
    saved.push({ fileName, text, mime });
    return true;
  },
  saveBlob: () => true,
}));

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 6, 12);
let base: Workspace;
let sample: State;
let sampleNames: string[];
beforeAll(async () => {
  base = await sampleWorkspace();
  sample = await sampleState();
  sampleNames = [...new Set((base.latest as ParsedExport).friends.friends.map((f) => f.username))].filter((n) => n.length >= 5);
}, 120_000);
beforeEach(() => {
  resetAnalysisCache();
  said.length = 0;
  saved.length = 0;
});

const ev = (conversation: string, direction: ChatEvent["direction"], daysAgo: number): ChatEvent => ({ conversation, isGroup: false, direction, kind: "TEXT", at: NOW - daysAgo * DAY });
const day = (y: number, m: number, d: number): number => Date.UTC(y, m - 1, d, 12);
const friend = (username: string, createdAt?: number): FriendRecord => ({ username, ...(createdAt !== undefined && { createdAt }) });

/** A real (not sample) export made from the sample's, with crafted friends and chats. */
function real(friends: FriendRecord[], chats: ChatEvent[], extra: Partial<ParsedExport> = {}): State {
  const parsed = base.latest as ParsedExport;
  const latest: ParsedExport = { ...parsed, chats, exportedAt: NOW, friends: { ...parsed.friends, friends }, ...extra };
  return stateWith({ latest, now: NOW, issues: [], parts: 1 });
}

/**
 * Six friends in six situations, a repeated name in another case, a group chat and a chat with someone outside the list:
 * ann waits on you, ben you wait on, cai you write to most, dee has been quiet for a long time, eli has never chatted,
 * and fay has no added date. Ann was added on a leap day.
 */
const NAMES = { ann: "zq.ann", ben: "zq.ben", cai: "zq.cai", dee: "zq.dee", eli: "zq.eli", fay: "zq.fay" } as const;
function crafted(): State {
  const friends = [
    friend("ZQ.ANN", day(2024, 2, 29)),
    friend(NAMES.ben, day(2023, 5, 1)),
    friend(NAMES.cai, day(2024, 1, 1)),
    friend(NAMES.dee, day(2022, 1, 1)),
    friend(NAMES.eli, day(2020, 1, 1)),
    friend(NAMES.fay),
    friend("zq.ann", day(2025, 1, 1)),
  ];
  const chats: ChatEvent[] = [
    ev(NAMES.ann, "sent", 9),
    ev(NAMES.ann, "received", 5),
    ev(NAMES.ben, "received", 20),
    ev(NAMES.ben, "sent", 10),
    ...Array.from({ length: 11 }, (_, i) => ev(NAMES.cai, "sent", 1 + i)),
    ev(NAMES.cai, "received", 30),
    ev(NAMES.dee, "sent", 300),
    { conversation: "group:abc", isGroup: true, direction: "sent", kind: "TEXT", at: NOW - DAY },
    ev("zq.stranger", "received", 2),
  ];
  return real(friends, chats);
}

const text = (el: FakeElement, selector: string): string[] => el.querySelectorAll(selector).map((e) => e.textContent);
/** The usernames in the table, in order: each names its row. */
const rowNames = (el: FakeElement): string[] => text(el, "tbody th");
const cellsOf = (el: FakeElement, name: string): string[] => {
  const tr = el.querySelectorAll("tbody tr").find((r) => r.querySelector("th")?.textContent === name) as FakeElement;
  return text(tr, "td");
};
const select = (root: FakeElement, id: string): FakeElement => root.querySelector(`select#${id}`) as FakeElement;

describe("the tool", () => {
  it("is a Friends tool in the requests color that needs a friends list and shows the friends command", () => {
    expect(descriptor).toMatchObject({ id: "friends-table", title: "Friends table", group: "friends", category: "requests", icon: "people", needs: ["friends"] });
    expect(descriptor.oneLiner).toBe(copy.oneLiner);
    expect(COMMANDS.friends.argv[0]).toBe("friends");
  });

  it("passes the copy lint on its own words", () => {
    const entries = collectCopy({ tool_friends_table: copy });
    useNames([]);
    expect(entries.length).toBeGreaterThan(40);
    expect(RULES.flatMap((rule) => lint(entries, rule))).toEqual([]);
  });

  it("has a word for every order and every filter it offers", () => {
    expect(Object.keys(copy.sortLabels).sort()).toEqual(SORT_ORDERS.map((o) => o.id).sort());
    expect(Object.keys(copy.showLabels).sort()).toEqual([...SHOW_FILTERS].sort());
    expect(orderIdOf({ sort: "last", desc: true })).toBe("last-desc");
    expect(orderIdOf({ sort: "sent", desc: false })).toBe("username-asc");
  });
});

describe("computeFriendsTable", () => {
  it("builds the table as core does, one row per friend with the repeated name merged", () => {
    const data = toolData(crafted());
    const result = computeFriendsTable(data);
    expect(result.table).toEqual(insights.friendsTable.buildFriendsTable(data.parsed as ParsedExport, { now: NOW }));
    expect(result.rows.map((r) => r.username)).toEqual(Object.values(NAMES));
    expect(result.table.summary).toEqual({ friends: 6, withEvents: 4, quiet: 2, oneSided: 1, waiting: 2 });
    expect(result.filtered).toBe(false);
    const ann = result.rows[0];
    expect(ann).toMatchObject({ addedDay: "2024-02-29", total: 2, sent: 1, received: 1, waitingOn: "you", quiet: false });
    expect(result.rows.find((r) => r.username === NAMES.cai)).toMatchObject({ oneSided: true, sent: 11, received: 1, recent: 12 });
    expect(result.rows.find((r) => r.username === NAMES.dee)).toMatchObject({ quiet: true, total: 1, lastDay: insights.friendsTable.buildFriendsTable(data.parsed as ParsedExport, { now: NOW }).rows[3]?.lastDay });
    expect(result.rows.find((r) => r.username === NAMES.eli)).toMatchObject({ quiet: true, total: 0, firstAt: null, lastAt: null });
    expect(result.rows.find((r) => r.username === NAMES.fay)).toMatchObject({ quiet: false, addedAt: null });
    expect(result.table.notes.map((n) => [n.code, n.params.count])).toEqual(
      expect.arrayContaining([["group-events-skipped", 1], ["events-not-with-friends", 1], ["friends-duplicates-merged", 1], ["friends-without-added-date", 1]]),
    );
    expect(result.limits).toEqual({ quietDays: 180, windowDays: 90 });
  });

  it("builds the table once for the same data, whatever the sort or filter", () => {
    const data = toolData(crafted());
    const a = computeFriendsTable(data);
    const b = computeFriendsTable(data, { ...DEFAULT_PARAMS, sort: "total", desc: true, show: "quiet" });
    expect(b.table).toBe(a.table);
    const other = computeFriendsTable(toolData(crafted()));
    expect(other.table).not.toBe(a.table);
  });

  it("sorts by each key and direction with core's rules: no date last, ties by username", () => {
    const data = toolData(crafted());
    const all = computeFriendsTable(data).rows;
    for (const { sort, desc } of SORT_ORDERS) {
      const rows = computeFriendsTable(data, { ...DEFAULT_PARAMS, sort, desc }).rows;
      expect(rows.map((r) => r.id), `${sort} ${desc}`).toEqual(insights.friendsTable.sortRows(all, sort, desc ? "desc" : "asc").map((r) => r.id));
    }
    expect(computeFriendsTable(data, { ...DEFAULT_PARAMS, sort: "total", desc: true }).rows.map((r) => r.username)).toEqual([NAMES.cai, NAMES.ann, NAMES.ben, NAMES.dee, NAMES.eli, NAMES.fay]);
    // Friends with no added date, or no chats, always go last.
    expect(computeFriendsTable(data, { ...DEFAULT_PARAMS, sort: "added", desc: true }).rows.at(-1)?.username).toBe(NAMES.fay);
    expect(computeFriendsTable(data, { ...DEFAULT_PARAMS, sort: "last", desc: false }).rows.slice(-2).map((r) => r.username)).toEqual([NAMES.eli, NAMES.fay]);
    expect(computeFriendsTable(data, { ...DEFAULT_PARAMS, sort: "username", desc: true }).rows.map((r) => r.username)).toEqual(Object.values(NAMES).reverse());
  });

  it("filters by a hint and by the start of a username, in any case", () => {
    const data = toolData(crafted());
    const names = (params: Partial<typeof DEFAULT_PARAMS>): string[] => computeFriendsTable(data, { ...DEFAULT_PARAMS, ...params }).rows.map((r) => r.username);
    expect(names({ show: "quiet" })).toEqual([NAMES.dee, NAMES.eli]);
    expect(names({ show: "one-sided" })).toEqual([NAMES.cai]);
    expect(names({ show: "waiting" })).toEqual([NAMES.ann, NAMES.ben]);
    expect(names({ show: "waiting-you" })).toEqual([NAMES.ann]);
    expect(names({ show: "waiting-them" })).toEqual([NAMES.ben]);
    expect(names({ prefix: "ZQ.A" })).toEqual([NAMES.ann]);
    expect(names({ prefix: "  zq.e  " })).toEqual([NAMES.eli]);
    expect(names({ prefix: "zq.", show: "quiet" })).toEqual([NAMES.dee, NAMES.eli]);
    expect(names({ prefix: "zq.a", show: "quiet" })).toEqual([]);
    expect(names({ prefix: "nobody" })).toEqual([]);
    expect(computeFriendsTable(data, { ...DEFAULT_PARAMS, show: "quiet" }).filtered).toBe(true);
    expect(computeFriendsTable(data, { ...DEFAULT_PARAMS, prefix: "   " }).filtered).toBe(false);
    // The filter never changes the counts: they describe every friend.
    expect(computeFriendsTable(data, { ...DEFAULT_PARAMS, show: "quiet" }).table.summary.friends).toBe(6);
  });

  it("handles no chats, no usable friends and a long prefix", () => {
    const noChats = computeFriendsTable(toolData(real([friend("zq.one", day(2024, 1, 1))], [])));
    expect(noChats.rows).toHaveLength(1);
    expect(noChats.rows[0]).toMatchObject({ total: 0, quiet: false });
    expect(noChats.table.notes.map((n) => n.code)).toContain("no-events");
    const noFriends = computeFriendsTable(toolData(real([friend("   ")], [])));
    expect(noFriends.table.summary.friends).toBe(0);
    expect(noFriends.table.notes.map((n) => n.code)).toEqual(expect.arrayContaining(["no-friends", "friends-invalid-username"]));
    expect(computeFriendsTable(toolData(crafted()), { ...DEFAULT_PARAMS, prefix: "z".repeat(5000) }).rows).toEqual([]);
  });

  it("measures up to the export's date and ignores events after it", () => {
    const old = real([friend("zq.old", day(2020, 1, 1)), friend("zq.new", day(2020, 1, 1))], [ev("zq.old", "received", 45), ev("zq.new", "sent", -3), ev("zq.new", "sent", 400)], { exportedAt: NOW - 38 * DAY });
    const result = computeFriendsTable(toolData(old));
    expect(result.table.asOf).toBe(NOW - 38 * DAY);
    expect(result.table.notes.map((n) => n.code)).toContain("events-in-future");
    expect(result.rows.find((r) => r.username === "zq.old")?.waitingOn).toBe("you");
  });

  it("holds no message text: the rows keep only names, dates and counts", () => {
    const json = JSON.stringify(computeFriendsTable(toolData(crafted())));
    expect(json).not.toMatch(/TEXT|kind|group:abc|zq\.stranger/);
  });

  it("refuses to run without an export (the page never calls it that way)", () => {
    expect(() => computeFriendsTable(toolData(emptyState()))).toThrow();
  });

  it("names the file for the day of the data and writes safe CSV", () => {
    expect(csvFileName(NOW)).toBe("friends-table-2026-11-06.csv");
    expect(csvFileName(null)).toBe("friends-table.csv");
    const rows = computeFriendsTable(toolData(crafted())).rows;
    expect(csvText(rows)).toBe(insights.friendsTable.toCsv(rows));
    expect(csvText(rows).startsWith(`${insights.friendsTable.FRIENDS_CSV_HEADER.join(",")}\r\n`)).toBe(true);
  });

  it("leaves a spreadsheet no way to run a name as a formula, and shows hidden characters as question marks", () => {
    const odd = ["=cmd|zq", "+sum", "-1", "@zq.at", "zq‮evil", "zq,\"quote\"", "zq\ttab"];
    const rows = computeFriendsTable(toolData(real(odd.map((u) => friend(u, day(2024, 1, 1))), []))).rows;
    const lines = csvText(rows).split("\r\n");
    expect(lines.at(-1)).toBe("");
    const body = lines.slice(1, -1);
    expect(body).toHaveLength(odd.length);
    for (const line of body) expect(line, line).not.toMatch(/^[=+\-@\t\r]/);
    expect(body.some((l) => l.startsWith("'=cmd|zq,"))).toBe(true);
    expect(body.some((l) => l.startsWith("'+sum,"))).toBe(true);
    expect(body.some((l) => l.startsWith("'-1,"))).toBe(true);
    expect(body.some((l) => l.startsWith("'@zq.at,"))).toBe(true);
    expect(body.some((l) => l.startsWith("zq?evil,"))).toBe(true);
    expect(body.some((l) => l.startsWith('"zq,""quote""",'))).toBe(true);
    expect(body.some((l) => l.startsWith("zq?tab,"))).toBe(true);
    expect(csvText(rows)).not.toMatch(/[‮\t]/);
  });
});

describe("the page", () => {
  it("shows the counts, the controls, the table, how hints work and the friends command", async () => {
    const { root } = await renderSettled(view, crafted());
    expect(text(root, ".section-title")).toEqual([copy.glanceHeading, copy.friendsHeading, copy.hintsHeading, tools.notesHeading, tools.downloadHeading, tools.commandHeading]);
    expect(text(root, ".fact dd")).toEqual(["6", "4", "2", "1", "2"]);
    expect(text(root, ".fact dt")).toEqual([copy.friendsLabel, copy.withChatsLabel, copy.quietLabel, copy.oneSidedLabel, copy.waitingLabel]);
    expect(root.textContent).toContain(copy.asOfLine("Nov 6, 2026"));
    expect(text(root, "thead th")).toEqual([copy.friendHeader, copy.addedHeader, copy.lastHeader, copy.totalHeader, copy.sentHeader, copy.receivedHeader, copy.hintsHeader]);
    expect(root.querySelector("caption")?.textContent).toBe(copy.tableCaption);
    expect(rowNames(root)).toEqual(Object.values(NAMES));
    expect(text(root, ".tool-result p")).toEqual(expect.arrayContaining([copy.quietLine(180), copy.oneSidedLine(90), copy.waitingLine]));
    expect(root.querySelector(".command code")?.textContent).toBe(displayText(COMMANDS.friends));
    expect(root.querySelector(".controls")?.getAttribute("aria-label")).toBe(copy.controlsLabel);
  });

  it("says in each cell what it holds, since a phone shows no column names", async () => {
    const { root } = await renderSettled(view, crafted());
    expect(cellsOf(root, NAMES.ann)).toEqual([copy.addedCell("Feb 29, 2024"), copy.lastCell("Nov 1, 2026"), copy.totalCell(2), copy.sentCell(1), copy.receivedCell(1), "Waiting on you"]);
    expect(cellsOf(root, NAMES.ben)[5]).toBe("Waiting on them");
    expect(cellsOf(root, NAMES.cai)).toEqual([copy.addedCell("Jan 1, 2024"), copy.lastCell("Nov 5, 2026"), copy.totalCell(12), copy.sentCell(11), copy.receivedCell(1), "One-sided"]);
    expect(cellsOf(root, NAMES.dee)[5]).toBe("Quiet");
    expect(cellsOf(root, NAMES.eli)).toEqual([copy.addedCell("Jan 1, 2020"), copy.noLastCell, copy.totalCell(0), copy.sentCell(0), copy.receivedCell(0), "Quiet"]);
    expect(cellsOf(root, NAMES.fay)).toEqual([copy.noAddedCell, copy.noLastCell, copy.totalCell(0), copy.sentCell(0), copy.receivedCell(0), copy.noHintsCell]);
    for (const cell of root.querySelectorAll("tbody td")) expect(cell.textContent, "a cell with no words").toMatch(/[A-Za-z]{3,}|^-$/);
  });

  it("starts in username order with everyone showing, and a label for each control", async () => {
    const { root } = await renderSettled(view, crafted());
    expect(text(select(root, "friends-table-sort"), "option")).toEqual(SORT_ORDERS.map((o) => copy.sortLabels[o.id]));
    expect(text(select(root, "friends-table-show"), "option")).toEqual(SHOW_FILTERS.map((s) => copy.showLabels[s]));
    expect(root.querySelector("label[for=friends-table-sort]")?.textContent).toBe(copy.sortLabel);
    expect(root.querySelector("label[for=friends-table-show]")?.textContent).toBe(copy.showLabel);
    expect(root.querySelector("label[for=friends-table-starts]")?.textContent).toBe(copy.startsLabel);
    expect(text(root, "form button")).toEqual([copy.applyButton]);
    expect(root.querySelector("input#friends-table-starts")?.getAttribute("maxlength")).toBe("64");
    expect(root.querySelector("input#friends-table-starts")?.getAttribute("spellcheck")).toBe("false");
    // The chosen option is marked in the page itself.
    const chosen = select(root, "friends-table-sort").querySelectorAll("option").filter((o) => o.hasAttribute("selected"));
    expect(chosen.map((o) => o.textContent)).toEqual([copy.sortLabels["username-asc"]]);
  });

  it("sorts again when the order changes, and repaints only the result so the controls keep their place", async () => {
    const r = await renderSettled(view, crafted());
    const order = select(r.root, "friends-table-sort");
    order.value = "total-desc";
    order.fire("change");
    expect(r.root.querySelector(".tool-result")?.getAttribute("aria-busy")).toBe("true");
    await settled(r.root);
    expect(rowNames(r.root)).toEqual([NAMES.cai, NAMES.ann, NAMES.ben, NAMES.dee, NAMES.eli, NAMES.fay]);
    expect(select(r.root, "friends-table-sort")).toBe(order);
    order.value = "added-desc";
    order.fire("change");
    await settled(r.root);
    expect(rowNames(r.root)).toEqual([NAMES.ann, NAMES.cai, NAMES.ben, NAMES.dee, NAMES.eli, NAMES.fay]);
  });

  it("shows only friends with the chosen hint, says how many match, and keeps the counts for everyone", async () => {
    const r = await renderSettled(view, crafted());
    const show = select(r.root, "friends-table-show");
    show.value = "quiet";
    show.fire("change");
    await settled(r.root);
    expect(rowNames(r.root)).toEqual([NAMES.dee, NAMES.eli]);
    expect(text(r.root, ".tool-result p")).toContain(copy.matchLine(2, 6));
    expect(text(r.root, ".fact dd")).toEqual(["6", "4", "2", "1", "2"]);
    show.value = "waiting-you";
    show.fire("change");
    await settled(r.root);
    expect(rowNames(r.root)).toEqual([NAMES.ann]);
    expect(text(r.root, ".tool-result p")).toContain(copy.matchLine(1, 6));
    expect(copy.matchLine(1, 6)).toContain("1 friend matches");
    show.value = "all";
    show.fire("change");
    await settled(r.root);
    expect(rowNames(r.root)).toHaveLength(6);
    expect(text(r.root, ".tool-result p")).not.toContain(copy.matchLine(6, 6));
  });

  it("filters by the start of a username when it is sent, in any case, and again when it is cleared", async () => {
    const r = await renderSettled(view, crafted());
    const input = r.root.querySelector("input#friends-table-starts") as FakeElement;
    input.value = "ZQ.B";
    (r.root.querySelector("form") as FakeElement).fire("submit");
    await settled(r.root);
    expect(rowNames(r.root)).toEqual([NAMES.ben]);
    expect(r.root.querySelector("input#friends-table-starts")).toBe(input);
    input.value = "";
    (r.root.querySelector("form") as FakeElement).fire("submit");
    await settled(r.root);
    expect(rowNames(r.root)).toHaveLength(6);
  });

  it("keeps the controls and says so in a line when no friend matches", async () => {
    const r = await renderSettled(view, crafted());
    const input = r.root.querySelector("input#friends-table-starts") as FakeElement;
    input.value = "nobody";
    (r.root.querySelector("form") as FakeElement).fire("submit");
    await settled(r.root);
    expect(text(r.root, ".tool-result p")).toContain(copy.noMatchLine);
    expect(r.root.querySelector("table")).toBeNull();
    expect(r.root.querySelector(".empty")).toBeNull();
    expect(text(r.root, ".fact dd")[0]).toBe("6");
    expect(r.root.querySelector("input#friends-table-starts")).toBe(input);
    // The file still holds whatever is shown: here, only the header.
    (r.root.querySelectorAll("button").find((b) => b.textContent === copy.downloadLabel) as FakeElement).click();
    expect(saved[0]?.text).toBe(`${insights.friendsTable.FRIENDS_CSV_HEADER.join(",")}\r\n`);
  });

  it("draws a long list in pages of fifty, then Show more adds fifty more", async () => {
    const people = Array.from({ length: 120 }, (_, i) => `zq.person.${String(i).padStart(3, "0")}`);
    const { root } = await renderSettled(view, real(people.map((p) => friend(p, day(2024, 1, 1))), people.map((p) => ev(p, "received", 5))));
    expect(rowNames(root)).toHaveLength(50);
    expect(root.querySelector(".more .caption")?.textContent).toBe("Showing 50 of 120");
    expect(text(root, ".fact dd")[0]).toBe("120");
    said.length = 0;
    const more = root.querySelector(".more button") as FakeElement;
    expect(more.textContent).toBe("Show 50 more");
    more.click();
    expect(rowNames(root)).toHaveLength(100);
    expect(root.querySelector(".more .caption")?.textContent).toBe("Showing 100 of 120");
    expect(said).toEqual(["Showing 100 of 120"]);
    (root.querySelector(".more button") as FakeElement).click();
    expect(rowNames(root)).toHaveLength(120);
    expect(root.querySelector(".more")?.textContent).toBe("");
    // The file holds every row, not the page.
    (root.querySelectorAll("button").find((b) => b.textContent === copy.downloadLabel) as FakeElement).click();
    expect(saved[0]?.text.split("\r\n")).toHaveLength(122);
  });

  it("writes each note as a short hedged sentence, from counts alone", async () => {
    const { root } = await renderSettled(view, crafted());
    const notes = text(root, ".tool-notes li");
    expect(notes).toEqual([copy.hintNote, copy.groupNote(1), copy.notFriendsNote(1), copy.duplicatesNote(1), copy.noAddedNote(1)]);
    for (const n of notes) expect(n).not.toMatch(/[a-z]+-[a-z]+-[a-z]+/);
  });

  it("shows each kind of note with its count", async () => {
    const odd: ChatEvent[] = [{ ...ev("zq.one", "sent", 4), at: Number.NaN }, ev("zq.one", "sent", -3), { ...ev("zq.one", "sent", 2), isGroup: true, conversation: "group:x" }];
    const a = await renderSettled(view, real([friend("zq.one", day(2024, 1, 1)), friend("  ")], odd));
    expect(text(a.root, ".tool-notes li")).toEqual(expect.arrayContaining([copy.noTimeNote(1), copy.futureNote(1), copy.groupNote(1), copy.invalidUsernameNote(1), copy.quietNoActivityNote]));
    const b = await renderSettled(view, real([friend("zq.one", day(2024, 1, 1))], []));
    expect(text(b.root, ".tool-notes li")).toEqual([copy.hintNote, copy.noEventsNote]);
    // A friend with no chats, in a short history: not judged quiet, and the note says so.
    const short = await renderSettled(view, real([friend("zq.one", day(2020, 1, 1)), friend("zq.two", day(2020, 1, 1))], [ev("zq.one", "sent", 3)]));
    expect(text(short.root, ".tool-notes li")).toContain(copy.quietShortNote(1));
  });

  it("announces the counts politely once, and without a name", async () => {
    await renderSettled(view, crafted());
    expect(said).toEqual([copy.doneAnnounce(6, 2, 2)]);
    expect(said[0]).toBe("Friends table ready: 6 friends, 2 may be quiet and 2 may be waiting on a reply.");
    expect(said[0]?.length).toBeLessThanOrEqual(140);
    for (const name of Object.values(NAMES)) expect(said[0], name).not.toContain(name);
  });
});

describe("the download", () => {
  it("builds the file only on the press, and writes the exact core text for the rows shown", async () => {
    const r = await renderSettled(view, crafted());
    expect(saved).toHaveLength(0);
    expect(r.root.textContent).toContain(copy.downloadNote);
    const press = (): void => (r.root.querySelectorAll("button").find((b) => b.textContent === copy.downloadLabel) as FakeElement).click();
    said.length = 0;
    press();
    const all = computeFriendsTable(toolData(crafted())).rows;
    expect(saved[0]).toEqual({ fileName: "friends-table-2026-11-06.csv", text: insights.friendsTable.toCsv(all), mime: "text/csv" });
    expect(said).toEqual([tools.downloadSaved]);
    // Sorted and filtered, the file follows the table.
    const show = select(r.root, "friends-table-show");
    show.value = "quiet";
    show.fire("change");
    await settled(r.root);
    const order = select(r.root, "friends-table-sort");
    order.value = "username-desc";
    order.fire("change");
    await settled(r.root);
    press();
    expect(saved[1]?.text.split("\r\n").slice(1, -1).map((l) => l.split(",")[0])).toEqual([NAMES.eli, NAMES.dee]);
    expect(saved[1]?.text.endsWith("\r\n")).toBe(true);
  });

  it("offers the file with a short note that it lists usernames", async () => {
    const { root } = await renderSettled(view, crafted());
    expect(text(root, "button").filter((t) => t === copy.downloadLabel)).toHaveLength(1);
    expect(copy.downloadLabel).toBe("Download CSV");
    expect(copy.downloadNote).toContain("usernames");
  });
});

describe("with the sample", () => {
  it("lists every sample friend once and builds a file with one line each", async () => {
    const { root } = await renderSettled(view, sample);
    const friends = (base.latest as ParsedExport).friends.friends;
    const distinct = new Set(friends.map((f) => f.username.trim().toLowerCase())).size;
    expect(text(root, ".fact dd")[0]).toBe(String(distinct));
    expect(rowNames(root).length).toBe(Math.min(50, distinct));
    (root.querySelectorAll("button").find((b) => b.textContent === copy.downloadLabel) as FakeElement).click();
    expect(saved[0]?.text.split("\r\n")).toHaveLength(distinct + 2);
  });
});

describe("when there is nothing to list", () => {
  it("shows the honest empty state for a friends list with no usable names, and no table or file", async () => {
    const { root } = await renderSettled(view, real([friend("   ")], []));
    expect(text(root, ".empty-title")).toEqual([copy.empty.title]);
    expect(text(root, ".empty-body")).toEqual([copy.empty.body]);
    expect(root.querySelector("table")).toBeNull();
    expect(text(root, "button").filter((t) => t === copy.downloadLabel)).toHaveLength(0);
    expect(root.querySelector(".command code")?.textContent).toBe(displayText(COMMANDS.friends));
  });
});

describe("without a friends list", () => {
  it("says plainly that an export is needed, and offers the next step", async () => {
    const { root } = render(view, emptyState());
    expect(text(root, ".empty-title")).toEqual([tools.needs.exportTitle]);
    expect(root.querySelector(".empty a")?.getAttribute("href")).toBe("#/start");
    expect(root.querySelector(".tool-result")).toBeNull();
    await settled(root);
  });

  it("names the friends list when the export has none", async () => {
    const { root } = await renderSettled(view, real([], []));
    expect(text(root, ".empty-title")).toEqual([tools.needs.friendsTitle]);
    expect(root.querySelector(".empty a")?.getAttribute("href")).toBe("#/tools/export-check");
  });

  it("runs on saved history alone, since a friends list is all it needs", async () => {
    const { root } = await renderSettled(view, stateWith({ ledger: base.ledger }));
    expect(root.querySelector(".tool-result")).not.toBeNull();
    expect(root.querySelector(".tool-failed")).toBeNull();
  });
});

describe("privacy", () => {
  it("shows a username only in the result table, and in no note, announcement, label, title or heading", async () => {
    const { root } = await renderSettled(view, crafted());
    const shown = new Set(rowNames(root));
    expect(shown.size).toBe(6);
    for (const el of root.descendants()) {
      const own = el.childNodes.filter((c) => "data" in c).map((c) => (c as unknown as { data: string }).data).join(" ");
      const labels = ["aria-label", "title", "alt", "value", "placeholder"].map((a) => el.getAttribute(a) ?? "").join(" ");
      for (const name of shown) {
        expect(labels, name).not.toContain(name);
        if (own.includes(name)) expect(el.tagName === "code" && el.classList.contains("username") && inTable(el), `${el.tagName}.${el.className}`).toBe(true);
      }
    }
    for (const name of shown) {
      expect(said.join(" "), name).not.toContain(name);
      expect(text(root, ".tool-notes li, .notice, h1, h2, h3, .lead, .tool-reads, .empty-body, .caption, caption, .tool-result p, label").join(" "), name).not.toContain(name);
    }
    expect(root.querySelector("title")).toBeNull();
    // Someone outside the list and a group are never named.
    expect(root.textContent).not.toMatch(/zq\.stranger|group:abc/);
  });

  it("keeps a username out of the page after a filter, a sort or a failed match", async () => {
    const r = await renderSettled(view, crafted());
    const input = r.root.querySelector("input#friends-table-starts") as FakeElement;
    input.value = "zq.d";
    (r.root.querySelector("form") as FakeElement).fire("submit");
    await settled(r.root);
    expect(rowNames(r.root)).toEqual([NAMES.dee]);
    // The typed text stays in the field and is never written elsewhere on the page.
    const outside = r.root.descendants().filter((el) => el.tagName !== "input" && !el.classList.contains("username"));
    for (const el of outside) expect(el.childNodes.filter((c) => "data" in c).map((c) => (c as unknown as { data: string }).data).join(" ")).not.toContain("zq.d");
    for (const line of said) expect(line).not.toContain("zq.");
  });

  it("shows no sample username outside the table, and holds no link or message text", async () => {
    const { root } = await renderSettled(view, sample);
    expect(root.textContent).not.toMatch(/https?:|\.(jpg|mp4|png)\b/i);
    for (const name of sampleNames) {
      for (const el of root.descendants()) {
        const own = el.childNodes.filter((c) => "data" in c).map((c) => (c as unknown as { data: string }).data).join(" ");
        if (own.includes(name)) expect(el.tagName === "code" && el.classList.contains("username") && inTable(el), name).toBe(true);
      }
    }
    for (const name of sampleNames) expect(said.join(" "), name).not.toContain(name);
  });

  it("shows an unusual username as plain text, with invisible characters made visible", async () => {
    const odd = "zq‮evil<b>x</b>";
    const { root } = await renderSettled(view, real([friend(odd, day(2024, 1, 1))], [ev(odd, "received", 5)]));
    expect(rowNames(root)[0]).toBe("zq?evil<b>x</b>");
    expect(root.querySelectorAll("b")).toHaveLength(0);
  });
});

function inTable(el: FakeElement): boolean {
  for (let n: { parentNode: unknown } | null = el; n; n = n.parentNode as typeof n) {
    const e = n as FakeElement;
    if (e.classList?.contains("table-wrap") || e.tagName === "table") return true;
  }
  return false;
}
