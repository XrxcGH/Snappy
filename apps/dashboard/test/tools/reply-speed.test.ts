/**
 * Reply speed: what it computes from the chats the page holds, and what its page shows and downloads. Synthetic
 * data only. The friends in the tables are the sample's friends; their usernames are canaries that may appear in
 * the result tables and in the CSV file and nowhere else (not in a note, an announcement, a label or a title).
 */
import type { ChatEvent, FriendRecord, ParsedExport } from "@snappy-export/core";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAnalysisCache } from "../../src/analysis.ts";
import { tools } from "../../src/copy.ts";
import type { State, Workspace } from "../../src/reducer.ts";
import { COMMANDS, displayText } from "../../src/terminal/commands.ts";
import { toolData } from "../../src/tools/data.ts";
import { copy } from "../../src/tools/reply-speed/copy.ts";
import { descriptor } from "../../src/tools/reply-speed/index.ts";
import { computeReplySpeed, csvFileName, friendsCsvText, FRIENDS_SHOWN, OFFSETS } from "../../src/tools/reply-speed/model.ts";
import { view } from "../../src/tools/reply-speed/view.ts";
import { forgetPreferredOffset, offsetLabel, rememberOffset } from "../../src/tools/timezone.ts";
import { RULES, collectCopy, lint } from "../copy-rules.ts";
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

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 10, 6, 12);

let base: Workspace;
let sample: State;
let names: string[];
beforeAll(async () => {
  base = await sampleWorkspace();
  sample = await sampleState();
  names = (base.latest as ParsedExport).friends.friends.map((f) => f.username).filter((n) => n.length >= 5);
}, 120_000);
/** A device that is `east` minutes east of UTC (getTimezoneOffset counts the other way). The page starts in the device's zone. */
const deviceAt = (east: number): void => void vi.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(-east);
beforeEach(() => {
  resetAnalysisCache();
  said.length = 0;
  saved.length = 0;
  forgetPreferredOffset();
  deviceAt(0);
});
afterEach(() => {
  vi.restoreAllMocks();
  forgetPreferredOffset();
});

interface Turns {
  /** Minutes you took to answer them, one entry per reply. */
  you?: number[];
  /** Minutes they took to answer you, one entry per reply. */
  them?: number[];
  /** Hour of the day (UTC) the first message of each turn is sent. Default 20. */
  hour?: number;
}

const ev = (conversation: string, direction: ChatEvent["direction"], at: number): ChatEvent => ({ conversation, isGroup: false, direction, kind: "TEXT", at });

/** The chats of one friend: each turn starts three days after the last, so no two turns touch. */
function turns(friend: string, t: Turns): ChatEvent[] {
  const out: ChatEvent[] = [];
  let day = 0;
  const start = (): number => Date.UTC(2026, 7, 1) + ++day * 3 * DAY + (t.hour ?? 20) * HOUR;
  for (const m of t.you ?? []) {
    const at = start();
    out.push(ev(friend, "received", at), ev(friend, "sent", at + m * MINUTE));
  }
  for (const m of t.them ?? []) {
    const at = start();
    out.push(ev(friend, "sent", at), ev(friend, "received", at + m * MINUTE));
  }
  return out;
}
const six = (minutes: number): number[] => Array.from({ length: 6 }, () => minutes);

/** A real (not sample) export made from the sample's, with these chats and, where given, these friends. */
function real(chats: ChatEvent[], friends?: readonly string[]): State {
  const parsed = base.latest as ParsedExport;
  const first = parsed.friends.friends[0] as FriendRecord;
  const list = friends ? friends.map((username) => ({ ...first, username })) : parsed.friends.friends;
  const latest: ParsedExport = { ...parsed, chats, exportedAt: NOW, friends: { ...parsed.friends, friends: list } };
  return stateWith({ latest, now: NOW, issues: [], parts: 1 });
}

/** Two friends with enough replies on both sides, and a third with too few. */
function crafted(): { state: State; who: [string, string, string] } {
  const who = names.slice(0, 3) as [string, string, string];
  const [a, b, c] = who;
  const chats = [...turns(a, { you: six(10), them: six(30) }), ...turns(b, { you: six(40), them: six(5) }), ...turns(c, { you: [2, 2] })];
  return { state: real(chats), who };
}

/** What a screen reader hears: a cell that shows a bare value keeps its full phrase in a hidden span, and that phrase is read here. */
const text = (el: FakeElement, selector: string): string[] => el.querySelectorAll(selector).map((e) => e.querySelector(".cell-long")?.textContent ?? e.textContent);
const rowNames = (el: FakeElement): string[] => text(el, "code.username");
const dataOf = (state: State) => toolData(state);

describe("the tool", () => {
  it("is a Chats tool in the quiet color that needs chats and shows the reply-speed command", () => {
    expect(descriptor).toMatchObject({ id: "reply-speed", title: "Reply speed", group: "chats", category: "quiet", icon: "queue", needs: ["chats"] });
    expect(descriptor.oneLiner).toBe(copy.oneLiner);
    expect(descriptor.oneLiner.length).toBeLessThanOrEqual(56);
    expect(COMMANDS["reply-speed"].argv[0]).toBe("reply-speed");
  });

  it("passes the copy lint on its own words", () => {
    const entries = collectCopy({ replySpeed: copy });
    expect(entries.length).toBeGreaterThan(30);
    expect(RULES.flatMap((rule) => lint(entries, rule))).toEqual([]);
  });

  it("words a reply time in seconds, minutes, hours and days", () => {
    const t = copy.unitDuration;
    expect(t(0)).toBe("Under 1 second");
    expect(t(1000)).toBe("1 second");
    expect(t(30_000)).toBe("30 seconds");
    expect(t(MINUTE)).toBe("1 minute");
    expect(t(59_700)).toBe("1 minute");
    expect(t(12 * MINUTE)).toBe("12 minutes");
    expect(t(119 * MINUTE)).toBe("119 minutes");
    expect(t(2 * HOUR)).toBe("2 hours");
    expect(t(47 * HOUR)).toBe("47 hours");
    expect(t(2 * DAY)).toBe("2 days");
    expect(t(Number.NaN)).toBe("");
    expect(t(-1)).toBe("");
  });

  it("says a count of one in the singular in every note", () => {
    expect(copy.groupNote(1)).toBe("1 group chat event was left out.");
    expect(copy.groupNote(3)).toBe("3 group chat events were left out.");
    expect(copy.unknownDirectionNote(1)).toBe("1 event does not say who wrote, so Snappy left it out.");
    expect(copy.unknownDirectionNote(4)).toBe("4 events do not say who wrote, so Snappy left them out.");
    expect(copy.lateNote(1, 24)).toBe("1 change of sender took over 24 hours. Snappy treats it as a new chat, not a reply.");
    expect(copy.lateNote(2, 1)).toBe("2 changes of sender took over 1 hour. Snappy treats them as new chats, not replies.");
    expect(copy.sameTimeNote(1)).toBe("1 message pair shares one exact time, so Snappy cannot tell the order and left it out.");
    expect(copy.belowMinNote(1, 5)).toBe("1 person has replies, but fewer than 5. Snappy shows the count only.");
    expect(copy.belowMinNote(3, 5)).toBe("3 people have replies, but fewer than 5. Snappy shows the counts only.");
    expect(copy.fewNote(0)).toBe("One side has no replies, so the overall times may be off.");
    expect(copy.fewNote(1)).toBe("One side has only 1 reply, so the overall times may be off.");
    expect(copy.notFriendsNote(1)).toBe("1 person outside your friends list was left out.");
    expect(copy.hourCell(0, "")).toBe("No replies");
    expect(copy.hourCell(1, "")).toBe("1 reply, too few to time");
    expect(copy.hourCell(6, "10 minutes")).toBe("6 replies, 10 minutes typical");
  });
});

describe("computeReplySpeed", () => {
  it("times who answers whom, as core does", () => {
    const { state, who } = crafted();
    const r = computeReplySpeed(dataOf(state));
    expect(r.report.overall.you).toMatchObject({ replies: 14, medianMs: 10 * MINUTE, p90Ms: 40 * MINUTE });
    expect(r.report.overall.them).toMatchObject({ replies: 12, medianMs: 17.5 * MINUTE, p90Ms: 30 * MINUTE });
    // Most replies first, then username; the friend with too few replies has no row.
    expect(r.report.friends.map((f) => f.username)).toEqual([who[0], who[1]].sort());
    expect(r.report.friends.find((f) => f.username === who[0])).toMatchObject({ youReplies: 6, themReplies: 6, you: { medianMs: 10 * MINUTE }, them: { medianMs: 30 * MINUTE } });
    expect(r.report.fastest.you.map((p) => p.username)).toEqual([who[0]]);
    expect(r.report.slowest.you.map((p) => p.username)).toEqual([who[1]]);
    expect(r.report.fastest.them.map((p) => p.username)).toEqual([who[1]]);
    expect(r.report.slowest.them.map((p) => p.username)).toEqual([who[0]]);
    expect(r.report.asOf).toBe(NOW);
    expect(r.report.notes.map((n) => n.code)).toEqual(expect.arrayContaining(["turns-after-window", "people-below-minimum"]));
    expect(r.shown).toEqual(r.report.friends);
    // Every turn starts at 20:00 UTC and no reply takes an hour, so the replies are all sent in the 8 PM hour.
    expect(r.hours.map((b) => [b.hour, b.youReplies, b.themReplies, b.youMedianMs, b.themMedianMs])).toEqual([[20, 14, 12, 10 * MINUTE, 17.5 * MINUTE]]);
  });

  it("moves the hour of the reply with the time zone", () => {
    const [a] = names as [string];
    const state = real(turns(a, { you: six(10), them: six(10), hour: 20 }));
    expect(computeReplySpeed(dataOf(state)).hours.map((b) => b.hour)).toEqual([20]);
    const east = computeReplySpeed(dataOf(state), { utcOffsetMinutes: 240 });
    expect(east.hours.map((b) => b.hour)).toEqual([0]);
    expect(east.report.utcOffsetMinutes).toBe(240);
    const west = computeReplySpeed(dataOf(state), { utcOffsetMinutes: -330 });
    expect(west.hours.map((b) => b.hour)).toEqual([14]);
  });

  it("offers only time zones that core accepts as they are", () => {
    const [a] = names as [string];
    const data = dataOf(real(turns(a, { you: six(10), them: six(10) })));
    for (const minutes of OFFSETS) {
      const r = computeReplySpeed(data, { utcOffsetMinutes: minutes });
      expect(r.report.utcOffsetMinutes, String(minutes)).toBe(minutes);
      expect(r.report.notes.map((n) => n.code), String(minutes)).not.toContain("offset-adjusted");
    }
  });

  it("lists only current friends, and leaves people outside the list out", () => {
    const [a, b] = names as [string, string];
    const state = real([...turns(a, { you: six(10), them: six(10) }), ...turns(b, { you: six(10), them: six(10) })], [b]);
    const r = computeReplySpeed(dataOf(state));
    expect(r.report.friends.map((f) => f.username)).toEqual([b]);
    expect(r.report.notes.find((n) => n.code === "people-not-in-friends")?.params.count).toBe(1);
  });

  it("shows the first rows and keeps every row for the file", () => {
    const people = Array.from({ length: FRIENDS_SHOWN + 7 }, (_, i) => `zq.person.${String(i).padStart(2, "0")}`);
    const r = computeReplySpeed(dataOf(real(people.flatMap((p) => turns(p, { you: six(5), them: six(5) })), people)));
    expect(r.report.friends).toHaveLength(FRIENDS_SHOWN + 7);
    expect(r.shown).toHaveLength(FRIENDS_SHOWN);
    expect(friendsCsvText(r.report).split("\r\n")).toHaveLength(FRIENDS_SHOWN + 7 + 2);
  });

  it("holds no message text: the report keeps only names, times and counts", () => {
    const { state } = crafted();
    const json = JSON.stringify(computeReplySpeed(dataOf(state)));
    expect(json).not.toMatch(/TEXT|"kind"|isGroup/);
  });

  it("refuses to run without an export (the page never calls it that way)", () => {
    expect(() => computeReplySpeed(dataOf(emptyState()))).toThrow();
  });
});

describe("the file", () => {
  it("has one row per friend: counts and whole seconds, empty where a side has too few replies", () => {
    const [a, b] = names as [string, string];
    const state = real([...turns(a, { you: six(10), them: [30] }), ...turns(b, { you: six(40), them: six(5) })], [a, b]);
    const { report } = computeReplySpeed(dataOf(state));
    const lines = friendsCsvText(report).split("\r\n");
    expect(lines[0]).toBe(`﻿${copy.csvHeaders.map((h) => `"${h}"`).join(",")}`);
    expect(report.friends).toHaveLength(2);
    const rowOf = (name: string): string => lines.find((l) => l.startsWith(`"${name}"`)) ?? "";
    expect(rowOf(a)).toBe(`"${a}","6","600","600","1","",""`);
    expect(rowOf(b)).toBe(`"${b}","6","2400","2400","6","300","300"`);
    expect(lines.at(-1)).toBe("");
  });

  it("makes a spreadsheet cell safe for a username that looks like a formula", () => {
    const [a] = names as [string];
    const base1 = computeReplySpeed(dataOf(real(turns(a, { you: six(10) })))).report;
    const row = { youReplies: 5, themReplies: 0, you: { medianMs: 1500, p90Ms: 2500 }, them: null };
    const csv = friendsCsvText({ ...base1, friends: [{ username: "=cmd|x", ...row }, { username: "-a\"b", ...row }] });
    const lines = csv.split("\r\n");
    expect(lines[1]).toBe(`"'=cmd|x","5","2","3","0","",""`);
    expect(lines[2]).toBe(`"'-a""b","5","2","3","0","",""`);
  });

  it("is named for the day of the report, in UTC, and never for a person", () => {
    expect(csvFileName(NOW)).toBe("snappy-reply-speed-2026-11-06.csv");
    expect(csvFileName(null)).toBe("snappy-reply-speed.csv");
    expect(csvFileName(Number.NaN)).toBe("snappy-reply-speed.csv");
  });
});

describe("the page", () => {
  it("shows the typical times, the rankings, the hours, the friends table, the download and the command", async () => {
    const { state, who } = crafted();
    const { root } = await renderSettled(view, state);
    expect(text(root, ".section-title")).toEqual([copy.glanceHeading, copy.rankHeading, copy.hourHeading, copy.friendsHeading, tools.notesHeading, tools.downloadHeading, tools.commandHeading]);
    expect(text(root, ".subheading")).toEqual([copy.youFastHeading, copy.youSlowHeading, copy.themFastHeading, copy.themSlowHeading]);
    expect(text(root, ".fact dt")).toEqual([copy.youTypicalLabel, copy.themTypicalLabel, copy.youCountLabel, copy.themCountLabel]);
    expect(text(root, ".fact dd")).toEqual(["10 minutes", "18 minutes", "14", "12"]);
    expect(root.textContent).toContain(copy.youNineLine("40 minutes"));
    expect(root.textContent).toContain(copy.themNineLine("30 minutes"));
    expect(root.textContent).toContain(copy.methodLine(24));
    expect(root.textContent).toContain(copy.asOfLine("Nov 6, 2026"));

    const tables = root.querySelectorAll("table");
    expect(tables).toHaveLength(6);
    // The rankings, then the hours, then the friends.
    expect(tables.slice(0, 4).map(rowNames)).toEqual([[who[0]], [who[1]], [who[1]], [who[0]]]);
    expect(text(tables[0] as FakeElement, "tbody td")).toEqual([copy.unitTypicalCell("10 minutes"), copy.unitRepliesCell(6)]);
    // The cells show the bare value their column names; the phrase is for assistive technology (and a phone's stacked card).
    expect(((tables[0] as FakeElement).querySelectorAll("tbody td") as FakeElement[]).map((td) => td.querySelector(".cell-short")?.textContent)).toEqual(["10 minutes", "6"]);
    expect(text(tables[4] as FakeElement, "tbody th")).toEqual(["8 PM"]);
    expect(text(tables[4] as FakeElement, "tbody td")).toEqual(["14 replies, 10 minutes typical", "12 replies, 18 minutes typical"]);
    const friendRows = (tables[5] as FakeElement).querySelectorAll("tbody tr");
    expect(friendRows).toHaveLength(2);
    expect(rowNames(tables[5] as FakeElement)).toEqual([who[0], who[1]].sort());
    const first = friendRows.find((r) => r.textContent.includes(who[0])) as FakeElement;
    expect(text(first, "td")).toEqual(["6 replies", "10 minutes typical", "6 replies", "30 minutes typical"]);
    expect(root.querySelector(".command code")?.textContent).toBe(displayText(COMMANDS["reply-speed"]));
    expect(root.querySelector("button[data-key='tool-download']")?.textContent).toBe(copy.downloadLabel);
    expect(root.textContent).toContain(copy.downloadNote);
  });

  it("shows a dash for a typical time that does not exist, and says so", async () => {
    const [a] = names as [string];
    const { root } = await renderSettled(view, real(turns(a, { you: six(10), them: [30] })));
    expect(text(root, ".fact dd")).toEqual(["10 minutes", "30 minutes", "6", "1"]);
    const { root: onlyYou } = await renderSettled(view, real(turns(a, { you: six(10) })));
    expect(text(onlyYou, ".fact dd")).toEqual(["10 minutes", copy.noValue, "6", "0"]);
    expect(onlyYou.textContent).not.toContain("Nine in ten of their");
    const friendRow = (onlyYou.querySelectorAll("table").at(-1) as FakeElement).querySelector("tbody tr") as FakeElement;
    expect(text(friendRow, "td")).toEqual(["6 replies", "10 minutes typical", "0 replies", copy.tooFewCell]);
  });

  it("says in a line that nobody can be ranked when only one friend has enough replies", async () => {
    const [a] = names as [string];
    const { root } = await renderSettled(view, real(turns(a, { you: six(10), them: six(30) })));
    expect(root.textContent).toContain(copy.rankNoneLine);
    expect(root.querySelectorAll(".subheading")).toHaveLength(0);
    expect(root.textContent).not.toContain(copy.rankLine(5));
    expect(root.querySelectorAll("table")).toHaveLength(2);
  });

  it("lists the first rows of a long friends table, says how many are left, and downloads them all", async () => {
    const people = Array.from({ length: FRIENDS_SHOWN + 3 }, (_, i) => `zq.person.${String(i).padStart(2, "0")}`);
    const { root } = await renderSettled(view, real(people.flatMap((p) => turns(p, { you: six(5), them: six(5) })), people));
    const tables = root.querySelectorAll("table");
    expect((tables.at(-1) as FakeElement).querySelectorAll("tbody tr")).toHaveLength(FRIENDS_SHOWN);
    expect(root.textContent).toContain(copy.friendsMoreLine(3));
    root.querySelector("button[data-key='tool-download']")?.click();
    expect(saved).toHaveLength(1);
    expect(saved[0]?.text.split("\r\n")).toHaveLength(FRIENDS_SHOWN + 3 + 2);
  });

  it("builds the file only on the press, and writes the exact CSV", async () => {
    const { state, who } = crafted();
    const { root } = await renderSettled(view, state);
    expect(saved).toHaveLength(0);
    said.length = 0;
    root.querySelector("button[data-key='tool-download']")?.click();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toEqual({ fileName: "snappy-reply-speed-2026-11-06.csv", text: friendsCsvText(computeReplySpeed(dataOf(state)).report), mime: "text/csv" });
    expect(saved[0]?.text).toContain(`"${who[0]}"`);
    expect(saved[0]?.text).not.toContain(who[2]);
    expect(said).toEqual([tools.downloadSaved]);
  });

  it("recomputes for another time zone, repaints only the result and keeps the control", async () => {
    const [a] = names as [string];
    const r = render(view, real(turns(a, { you: six(10), them: six(10), hour: 20 })));
    await settled(r.root);
    const select = r.root.querySelector("select") as FakeElement;
    expect(select.getAttribute("id")).toBe("reply-speed-zone");
    expect(r.root.querySelector("label[for=reply-speed-zone]")?.textContent).toBe(copy.zoneLabel);
    expect(select.querySelectorAll("option")).toHaveLength(OFFSETS.length);
    expect(text(r.root, "tbody th").filter((t) => /[AP]M$/.test(t))).toEqual(["8 PM"]);
    expect(r.root.textContent).toContain(copy.hourLine("UTC"));
    select.value = "240";
    select.fire("change");
    await settled(r.root);
    expect(text(r.root, "tbody th").filter((t) => /[AP]M$/.test(t))).toEqual(["12 AM"]);
    expect(r.root.textContent).toContain(copy.hourLine("UTC+4:00"));
    expect(r.root.querySelector("select")).toBe(select);
  });

  it("starts in the zone of the device, or the one chosen in Settings, and keeps a pick on this page only", async () => {
    deviceAt(-300);
    const [a] = names as [string];
    const state = real(turns(a, { you: six(10), them: six(10), hour: 20 }));
    const first = await renderSettled(view, state);
    expect(first.root.querySelector("#reply-speed-zone option[selected]")?.textContent).toBe("UTC-5:00");
    expect(first.root.textContent).toContain(copy.hourLine("UTC-5:00"));
    // 20:00 UTC is 3 PM at UTC-5:00.
    expect(text(first.root, "tbody th").filter((t) => /[AP]M$/.test(t))).toEqual(["3 PM"]);
    const select = first.root.querySelector("select") as FakeElement;
    select.value = "240";
    select.fire("change");
    await settled(first.root);
    expect(first.root.textContent).toContain(copy.hourLine("UTC+4:00"));
    const again = await renderSettled(view, state);
    expect(again.root.querySelector("#reply-speed-zone option[selected]")?.textContent).toBe("UTC-5:00");
    rememberOffset(120);
    expect((await renderSettled(view, state)).root.querySelector("#reply-speed-zone option[selected]")?.textContent).toBe("UTC+2:00");
    expect(copy.zoneHelp).not.toContain("starts with UTC");
  });

  it("writes each note as a short hedged sentence, from counts alone", async () => {
    const { state } = crafted();
    const { root } = await renderSettled(view, state);
    const notes = text(root, ".tool-notes li");
    expect(notes[0]).toBe(copy.hintNote);
    expect(notes.some((n) => /^\d+ changes of sender took over 24 hours\. Snappy treats them as new chats, not replies\.$/.test(n))).toBe(true);
    expect(notes).toContain(copy.belowMinNote(1, 5));
    for (const n of notes) expect(n).not.toMatch(/[a-z]+-[a-z]+-[a-z]+/);
  });

  it("shows each kind of note with its count", async () => {
    const [a, b, c] = names as [string, string, string];
    const t = Date.UTC(2026, 8, 10, 10);
    const events: ChatEvent[] = [
      ...turns(a, { you: six(10), them: six(10) }),
      ev(a, "unknown", t),
      { ...ev(b, "sent", t), at: Number.NaN },
      ev(c, "sent", NOW + DAY),
      ev("", "sent", t),
      ev("someone.outside.the.list", "received", t),
      { conversation: "group:abc", isGroup: true, direction: "sent", kind: "TEXT", at: t },
      ev(b, "received", t + 5 * DAY),
      ev(b, "sent", t + 5 * DAY),
    ];
    const { root } = await renderSettled(view, real(events, [a, b, c]));
    const notes = text(root, ".tool-notes li");
    expect(notes).toEqual(
      expect.arrayContaining([
        copy.noTimeNote(1),
        copy.futureNote(1),
        copy.noPersonNote(1),
        copy.notFriendsNote(1),
        copy.unknownDirectionNote(1),
        copy.groupNote(1),
        copy.sameTimeNote(1),
      ]),
    );
    expect(root.querySelectorAll(".tool-note-warning")).toHaveLength(0);
  });

  it("warns when one side has very few replies", async () => {
    const [a] = names as [string];
    const { root } = await renderSettled(view, real(turns(a, { you: six(10), them: [30, 30] })));
    expect(text(root, ".tool-note-warning")).toEqual([copy.fewNote(2)]);
  });

  it("announces the counts politely once, and without a name", async () => {
    const { state } = crafted();
    await renderSettled(view, state);
    expect(said).toEqual(["Reply speed counted 14 replies of yours and 12 of theirs."]);
    expect(said[0]?.length).toBeLessThanOrEqual(140);
    for (const name of names) expect(said[0], name).not.toContain(name);
  });
});

describe("when there is nothing to time", () => {
  it("shows the honest empty state, with no tables and no download", async () => {
    const [a] = names as [string];
    const { root } = await renderSettled(view, real([ev(a, "received", NOW - DAY)]));
    expect(text(root, ".empty-title")).toEqual([copy.empty.title]);
    expect(text(root, ".empty-body")).toEqual([copy.empty.body]);
    expect(root.querySelectorAll("table")).toHaveLength(0);
    expect(root.querySelector("button[data-key='tool-download']")).toBeNull();
    expect(root.querySelector(".command code")?.textContent).toBe(displayText(COMMANDS["reply-speed"]));
    expect(said).toEqual([copy.emptyAnnounce]);
  });

  it("says so for chats that are all group chats too", async () => {
    const group: ChatEvent = { conversation: "group:abc", isGroup: true, direction: "received", kind: "TEXT", at: NOW - 5 * DAY };
    const { root } = await renderSettled(view, real([group, { ...group, direction: "sent", at: group.at + MINUTE }]));
    expect(text(root, ".empty-title")).toEqual([copy.empty.title]);
  });

  it("works with the built-in sample", async () => {
    const { root } = await renderSettled(view, sample);
    expect(root.querySelector(".tool-failed")).toBeNull();
    expect(root.querySelectorAll("table").length).toBeGreaterThan(0);
  });
});

describe("without chats", () => {
  it("says plainly that an export is needed, and offers the next step", async () => {
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

function inTable(el: FakeElement): boolean {
  for (let n: { parentNode: unknown } | null = el; n; n = n.parentNode as typeof n) {
    if ((n as FakeElement).classList?.contains("table-wrap")) return true;
  }
  return false;
}

describe("privacy", () => {
  it("shows a username only in the result tables, and in no note, announcement, label, title or heading", async () => {
    const { state } = crafted();
    const { root } = await renderSettled(view, state);
    const shown = new Set(rowNames(root));
    expect(shown.size).toBe(2);
    for (const el of root.descendants()) {
      const own = el.childNodes.filter((c) => "data" in c).map((c) => (c as unknown as { data: string }).data).join(" ");
      const labels = ["aria-label", "title", "alt"].map((a) => el.getAttribute(a) ?? "").join(" ");
      for (const name of shown) {
        expect(labels, name).not.toContain(name);
        if (own.includes(name)) expect(el.tagName === "code" && el.classList.contains("username") && inTable(el), `${el.tagName}.${el.className}`).toBe(true);
      }
    }
    for (const name of [...shown, ...names]) {
      expect(said.join(" "), name).not.toContain(name);
      expect(text(root, ".tool-notes li, .notice, h1, h2, h3, .lead, .tool-reads, .empty-body, .caption, .fact, .tool-result > section > p").join(" "), name).not.toContain(name);
    }
    expect(root.querySelector("title")).toBeNull();
  });

  it("shows no username for the sample outside its tables, and holds no link or message text", async () => {
    const { root } = await renderSettled(view, sample);
    expect(root.textContent).not.toMatch(/https?:|\.(jpg|mp4|png)\b/i);
    for (const name of names) {
      for (const el of root.descendants()) {
        const own = el.childNodes.filter((c) => "data" in c).map((c) => (c as unknown as { data: string }).data).join(" ");
        if (own.includes(name)) expect(inTable(el), name).toBe(true);
      }
    }
  });

  it("shows an unusual username as plain text, with invisible characters made visible", async () => {
    const odd = "zq‮evil<b>x</b>";
    const { root } = await renderSettled(view, real(turns(odd, { you: six(10), them: six(10) }), [odd]));
    expect(rowNames(root)[0]).toBe("zq?evil<b>x</b>");
    expect(root.querySelectorAll("b")).toHaveLength(0);
  });
});
