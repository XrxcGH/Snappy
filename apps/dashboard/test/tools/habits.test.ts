/**
 * Habits: what it computes from the chats the page holds, and what its page shows. Synthetic data only.
 * Conversation names carry a canary that must never reach a result, a note, an announcement or the page.
 */
import { insights } from "@snappy-export/core";
import type { ChatEvent, ParsedExport } from "@snappy-export/core";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAnalysisCache } from "../../src/analysis.ts";
import { tools } from "../../src/copy.ts";
import type { State, Workspace } from "../../src/reducer.ts";
import { COMMANDS, displayText } from "../../src/terminal/commands.ts";
import { toolData } from "../../src/tools/data.ts";
import { copy } from "../../src/tools/habits/copy.ts";
import { descriptor } from "../../src/tools/habits/index.ts";
import { computeHabits, MONTHS_SHOWN, OFFSETS } from "../../src/tools/habits/model.ts";
import { view } from "../../src/tools/habits/view.ts";
import { RULES, collectCopy, lint, sentences, words } from "../copy-rules.ts";
import type { FakeElement } from "../fake-dom.ts";
import { emptyState, render, renderSettled, sampleState, sampleWorkspace, settled, stateWith } from "./harness.ts";

const said: string[] = [];
const saved: string[] = [];
vi.mock("../../src/announce.ts", () => ({ announce: (text: string) => void said.push(text) }));
vi.mock("../../src/download.ts", () => ({
  saveTextFile: (fileName: string) => {
    saved.push(fileName);
    return true;
  },
  saveBlob: () => true,
}));

const CANARY = "zqcanary_alice";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Fri Mar 6 2026, 21:00 UTC. Mar 6 is a Friday; Apr 11 is a Saturday; May 4 is a Monday. */
const FRIDAY = Date.UTC(2026, 2, 6, 21);
const SATURDAY = Date.UTC(2026, 3, 11, 9);
const MONDAY = Date.UTC(2026, 4, 4, 13);
const NOW = Date.UTC(2026, 5, 1);

let base: Workspace;
let sample: State;
beforeAll(async () => {
  base = await sampleWorkspace();
  sample = await sampleState();
}, 120_000);
beforeEach(() => {
  resetAnalysisCache();
  said.length = 0;
  saved.length = 0;
});

const chat = (at: number, direction: ChatEvent["direction"] = "sent"): ChatEvent => ({ conversation: CANARY, isGroup: false, direction, kind: "TEXT", at });
const many = (n: number, at: number, direction: ChatEvent["direction"] = "sent", step = 60_000): ChatEvent[] => Array.from({ length: n }, (_, i) => chat(at + i * step, direction));

/** A real (not sample) export that holds exactly these chats. */
function withChats(chats: ChatEvent[], ws: Partial<Workspace> = {}): State {
  const latest = { ...(base.latest as ParsedExport), chats };
  return stateWith({ latest, now: NOW, issues: [], parts: 1, ...ws });
}
/** 20 sent on a Friday at 9 pm, 10 received on a Saturday at 9 am and 5 received on a Monday at 1 pm: 35 in all. */
const crafted = (): ChatEvent[] => [...many(20, FRIDAY), ...many(10, SATURDAY, "received"), ...many(5, MONDAY, "received")];
const dataOf = (state: State) => toolData(state);

describe("the tool", () => {
  it("is a Chats tool in the quiet color that needs chat history and shows the habits command", () => {
    expect(descriptor).toMatchObject({ id: "habits", title: "Chat and Snap habits", group: "chats", category: "quiet", needs: ["chats"] });
    expect(descriptor.oneLiner).toBe("See when you chat and Snap most.");
    expect(COMMANDS.habits.argv[0]).toBe("habits");
  });
});

describe("computeHabits", () => {
  it("counts the sample as core does, from the direction and time of each event alone", () => {
    const parsed = base.latest as ParsedExport;
    const v = computeHabits(dataOf(sample));
    const expected = insights.habits.computeHabits(parsed.chats.map((c) => ({ direction: c.direction, at: c.at })), { now: base.now, utcOffsetMinutes: 0 });
    expect(v.result).toEqual(expected);
    expect(v.result.totals.used).toBeGreaterThan(0);
    expect(v.result.byHour).toHaveLength(24);
    expect(v.result.byWeekday).toHaveLength(7);
    expect(v.hour).not.toBeNull();
    expect(v.months.length).toBeLessThanOrEqual(MONTHS_SHOWN);
  });

  it("finds the busiest hour, weekday and month, and names a quietest only when it is clear", () => {
    const v = computeHabits(dataOf(withChats(crafted())));
    expect(v.result.totals).toMatchObject({ used: 35, sent: 20, received: 15, unknown: 0 });
    expect(v.hour).toMatchObject({ busiest: 21, tied: false, quietest: null });
    expect(v.weekday).toMatchObject({ busiest: 5, tied: false, quietest: null });
    expect(v.hour?.share).toBeCloseTo(20 / 35);
    // March is the busiest month; May is the lowest but it is the last month, so it may be partial and is not named.
    expect(v.month).toMatchObject({ busiest: "2026-03", tied: false, quietest: null });
    expect(v.months.map((m) => m.month)).toEqual(["2026-03", "2026-04", "2026-05"]);
    expect(v.result.sentShare).toBeCloseTo(20 / 35);
  });

  it("names a quietest month that lies between the first and the last", () => {
    const v = computeHabits(dataOf(withChats([...many(20, FRIDAY), ...many(5, SATURDAY), ...many(20, MONDAY)])));
    expect(v.month).toMatchObject({ busiest: "2026-03", tied: true, quietest: "2026-04" });
  });

  it("moves the hours with the time zone", () => {
    expect(computeHabits(dataOf(withChats(crafted())), { utcOffsetMinutes: 120 }).hour?.busiest).toBe(23);
    expect(computeHabits(dataOf(withChats(crafted())), { utcOffsetMinutes: -300 }).hour?.busiest).toBe(16);
    // 9 pm in UTC+3 is already Saturday.
    expect(computeHabits(dataOf(withChats(crafted())), { utcOffsetMinutes: 180 }).weekday?.busiest).toBe(6);
  });

  it("offers only time zones that core accepts as they are", () => {
    for (const minutes of OFFSETS) expect(computeHabits(dataOf(withChats(crafted())), { utcOffsetMinutes: minutes }).result.notes.map((n) => n.code)).not.toContain("offset-adjusted");
    expect(OFFSETS).toContain(0);
    expect(computeHabits(dataOf(withChats(crafted())), { utcOffsetMinutes: 10_000 }).result.notes.map((n) => n.code)).toContain("offset-adjusted");
  });

  it("finds nothing to count in an empty list or in dates that are unusable", () => {
    const none = computeHabits(dataOf(withChats([])));
    expect(none.result.totals.used).toBe(0);
    expect(none.hour).toBeNull();
    expect(none.months).toEqual([]);
    const undated = computeHabits(dataOf(withChats([chat(0), chat(Number.NaN)])));
    expect(undated.result.totals).toMatchObject({ used: 0, undated: 2 });
    expect(undated.result.notes.map((n) => n.code)).toContain("no-usable-events");
  });

  it("leaves out events dated after now, and says so", () => {
    const v = computeHabits(dataOf(withChats([...many(30, FRIDAY), chat(NOW + DAY)])));
    expect(v.result.totals).toMatchObject({ used: 30, future: 1 });
    expect(v.result.notes.map((n) => n.code)).toContain("future-skipped");
  });

  it("calls the patterns weak under 30 events, and a direction unreliable above half unknown", () => {
    const codes = (events: ChatEvent[]): string[] => computeHabits(dataOf(withChats(events))).result.notes.map((n) => n.code);
    expect(codes(many(29, FRIDAY))).toContain("few-events");
    expect(codes(many(30, FRIDAY))).not.toContain("few-events");
    expect(codes(many(40, FRIDAY, "unknown"))).toContain("many-unknown-direction");
    expect(codes(many(40, FRIDAY, "sent"))).not.toContain("many-unknown-direction");
  });

  it("is the same in any input order", () => {
    const events = crafted();
    const a = computeHabits(dataOf(withChats(events)));
    const b = computeHabits(dataOf(withChats([...events].reverse())));
    expect(b.result).toEqual(a.result);
  });

  it("holds no conversation name, in the result or in any note", () => {
    const v = computeHabits(dataOf(withChats(crafted())));
    expect(JSON.stringify(v)).not.toContain("zqcanary");
    expect(JSON.stringify(v)).not.toContain(CANARY);
  });

  it("refuses to run without an export (the page never calls it that way)", () => {
    expect(() => computeHabits(dataOf(emptyState()))).toThrow();
  });
});

const cells = (el: FakeElement, selector: string): string[] => el.querySelectorAll(selector).map((e) => e.textContent);
const rowsOf = (table: FakeElement): string[][] => table.querySelectorAll("tbody tr").map((tr) => [...cells(tr, "th"), ...cells(tr, "td")]);
const headings = (root: FakeElement): string[] => root.querySelectorAll(".section-title").map((t) => t.textContent);

describe("the page", () => {
  it("shows the sample's overview, busiest times, directions, bar lists, notes and the command", async () => {
    const { root } = await renderSettled(view, sample);
    expect(headings(root)).toEqual(expect.arrayContaining([copy.glanceHeading, copy.busiestHeading, copy.directionHeading, copy.hourHeading, copy.weekdayHeading, copy.monthHeading, tools.commandHeading]));
    expect(cells(root, ".fact dt")).toEqual(expect.arrayContaining([copy.countedLabel, copy.activeDaysLabel, copy.firstLabel, copy.lastLabel]));
    const tables = root.querySelectorAll("table");
    expect(tables).toHaveLength(2);
    expect(cells(tables[0] as FakeElement, "thead th")).toEqual([copy.patternHeader, copy.busiestHeader, copy.shareHeader, copy.quietestHeader]);
    expect(cells(tables[0] as FakeElement, "tbody th")).toEqual([copy.hourPattern, copy.weekdayPattern, copy.monthPattern]);
    expect(cells(tables[1] as FakeElement, "tbody th")).toEqual([copy.sentRow, copy.receivedRow, copy.unknownRow]);
    expect(root.querySelectorAll(".hbars")).toHaveLength(3);
    expect(root.querySelectorAll(".hbars")[0]?.querySelectorAll("li")).toHaveLength(24);
    expect(root.querySelectorAll(".hbars")[1]?.querySelectorAll("li")).toHaveLength(7);
    expect(root.querySelector(".command code")?.textContent).toBe(displayText(COMMANDS.habits));
    expect(root.querySelector(".command-head")?.querySelectorAll("button").map((b) => b.textContent)).toEqual(["Copy", "Run"]);
  });

  it("shows the crafted export's numbers in the tables and the bars", async () => {
    const { root } = await renderSettled(view, withChats(crafted()));
    const [busiest, direction] = root.querySelectorAll("table") as [FakeElement, FakeElement];
    expect(rowsOf(busiest)).toEqual([
      [copy.hourPattern, "9 pm", "57%", "-"],
      [copy.weekdayPattern, "Friday", "57%", "-"],
      [copy.monthPattern, "Mar 2026", "57%", "-"],
    ]);
    expect(rowsOf(direction)).toEqual([
      [copy.sentRow, "20", "57%"],
      [copy.receivedRow, "15", "43%"],
      [copy.unknownRow, "0", "0%"],
    ]);
    expect(root.textContent).toContain(copy.sentLine(57));
    const hours = root.querySelectorAll(".hbars")[0] as FakeElement;
    const nine = hours.querySelectorAll("li")[21] as FakeElement;
    expect(cells(nine, ".hbar-name")).toEqual(["9 pm"]);
    expect(cells(nine, ".hbar-count")).toEqual(["20"]);
    expect((nine.querySelector(".meter-fill") as FakeElement).styleProps.get("width")).toBe("100%");
    const midnight = hours.querySelectorAll("li")[0] as FakeElement;
    expect((midnight.querySelector(".meter-fill") as FakeElement).styleProps.get("width")).toBe("0%");
    // The bar is decorative: the count beside it says the same.
    expect(nine.querySelector(".meter")?.getAttribute("aria-hidden")).toBe("true");
    const months = root.querySelectorAll(".hbars")[2] as FakeElement;
    expect(cells(months, ".hbar-name")).toEqual(["Mar 2026", "Apr 2026", "May 2026"]);
  });

  it("marks a tied busiest time as tied, and a clear quietest month by name", async () => {
    const { root } = await renderSettled(view, withChats([...many(20, FRIDAY), ...many(5, SATURDAY), ...many(20, MONDAY)]));
    const busiest = root.querySelectorAll("table")[0] as FakeElement;
    expect(rowsOf(busiest).find((r) => r[0] === copy.monthPattern)).toEqual([copy.monthPattern, copy.unitTied("Mar 2026"), "44%", "Apr 2026"]);
  });

  it("lists the latest 12 months and says how many there are", async () => {
    const events = Array.from({ length: 15 }, (_, i) => chat(Date.UTC(2025, i, 10, 12)));
    const { root } = await renderSettled(view, withChats([...events, ...many(15, Date.UTC(2026, 3, 10, 12))]));
    const months = root.querySelectorAll(".hbars")[2] as FakeElement;
    expect(months.querySelectorAll("li")).toHaveLength(12);
    expect(root.textContent).toContain(copy.monthsShownLine(12, 16));
  });

  it("announces its result politely, once, without a name", async () => {
    await renderSettled(view, withChats(crafted()));
    expect(said).toEqual([copy.summaryAnnounce(35, 3)]);
    expect(said[0]?.length).toBeLessThanOrEqual(140);
    expect(said[0]).not.toContain("zqcanary");
  });

  it("recomputes for another time zone, repaints only the result and keeps the control", async () => {
    const r = await renderSettled(view, withChats(crafted()));
    const select = r.root.querySelector("select") as FakeElement;
    expect(select.getAttribute("id")).toBe("habits-zone");
    const options = select.querySelectorAll("option");
    expect(options).toHaveLength(OFFSETS.length);
    expect(options.find((o) => o.getAttribute("selected") !== null)?.textContent).toBe("UTC");
    expect(options.map((o) => o.textContent)).toEqual(expect.arrayContaining(["UTC-5:00", "UTC+5:30", "UTC+5:45"]));
    expect(r.root.querySelector("label[for=habits-zone]")?.textContent).toBe(copy.zoneLabel);

    select.value = "120";
    select.fire("change");
    expect(r.root.querySelector(".tool-result")?.getAttribute("aria-busy")).toBe("true");
    await settled(r.root);
    expect(r.root.querySelector("select")).toBe(select);
    const busiest = r.root.querySelectorAll("table")[0] as FakeElement;
    expect(rowsOf(busiest)[0]?.[1]).toBe("11 pm");
    // Each result is announced as it lands, and the control is not rebuilt.
    expect(said).toHaveLength(2);
  });

  it("shows the honest empty result when no chat has a usable date", async () => {
    const { root } = await renderSettled(view, withChats([chat(0), chat(0, "received")]));
    expect(root.querySelector(".empty-title")?.textContent).toBe(copy.empty.title);
    expect(root.querySelector(".empty-body")?.textContent).toBe(copy.empty.body);
    expect(root.querySelectorAll("table")).toHaveLength(0);
    expect(root.querySelectorAll(".hbars")).toHaveLength(0);
    expect(said).toEqual([copy.emptyAnnounce]);
  });

  it("says what is missing when the export holds no chat history, and when nothing is loaded", async () => {
    const noChats = render(view, withChats([]));
    expect(noChats.root.querySelector(".empty-title")?.textContent).toBe(tools.needs.chatsTitle);
    expect(noChats.root.querySelector(".empty a")?.getAttribute("href")).toBe("#/tools/export-check");
    expect(noChats.root.querySelector(".tool-result")).toBeNull();
    const nothing = render(view, emptyState());
    expect(nothing.root.querySelector(".empty-title")?.textContent).toBe(tools.needs.exportTitle);
    await new Promise((r) => setTimeout(r, 10));
    expect(said).toEqual([]);
    // The command stays on the page either way.
    expect(nothing.root.querySelector(".command code")?.textContent).toBe(displayText(COMMANDS.habits));
  });

  it("writes hedged notes: few events, unknown direction and left-out dates, and says the first and last months may be partial", async () => {
    const { root } = await renderSettled(view, withChats([...many(10, FRIDAY, "unknown"), ...many(5, MONDAY, "unknown"), chat(NOW + DAY), chat(0)]));
    const notes = cells(root, ".tool-notes li");
    expect(notes).toEqual(expect.arrayContaining([copy.fewNote(15), copy.unknownNote(100), copy.futureNote(1), copy.undatedNote(1), copy.partialNote]));
    expect(root.querySelectorAll(".tool-note-warning").length).toBeGreaterThanOrEqual(2);
    expect(notes.join(" ")).toMatch(/may/);
  });

  it("has no download and builds no file", async () => {
    const { root } = await renderSettled(view, withChats(crafted()));
    expect(root.querySelectorAll("button").filter((b) => /download/i.test(b.textContent))).toHaveLength(0);
    expect(headings(root)).not.toContain(tools.downloadHeading);
    expect(saved).toEqual([]);
  });
});

describe("what the page never shows", () => {
  it("shows no conversation name, in any note, announcement, label or table, not even a canary", async () => {
    const states: State[] = [withChats(crafted()), withChats(many(10, FRIDAY, "unknown")), withChats([chat(0)])];
    for (const state of states) {
      said.length = 0;
      const { root } = await renderSettled(view, state);
      expect(root.textContent).not.toContain("zqcanary");
      for (const el of root.descendants()) for (const attr of ["aria-label", "title", "alt"]) expect(el.getAttribute(attr) ?? "").not.toContain("zqcanary");
      for (const line of said) expect(line).not.toContain("zqcanary");
    }
  });

  it("shows no friend's username on the sample page: it holds none, so no table or note can", async () => {
    const parsed = base.latest as ParsedExport;
    const names = [...new Set([...parsed.friends.friends.map((f) => f.username), ...parsed.chats.map((c) => c.conversation)])].filter((n) => n.length >= 5);
    expect(names.length).toBeGreaterThan(0);
    const { root } = await renderSettled(view, sample);
    const page = root.textContent;
    for (const name of names) expect(page, name).not.toContain(name);
    for (const line of said) for (const name of names) expect(line, name).not.toContain(name);
  });
});

describe("the copy", () => {
  it("passes the copy lint: sentence case, US English, quotes, punctuation and lengths", () => {
    const entries = collectCopy({ tool_habits: copy });
    expect(entries.length).toBeGreaterThan(20);
    expect(RULES.flatMap((rule) => lint(entries, rule))).toEqual([]);
  });

  it("has a short title, tile line, description and reads line", () => {
    expect(copy.title.length).toBeLessThanOrEqual(28);
    expect(words(copy.title).length).toBeLessThanOrEqual(4);
    expect(copy.oneLiner.length).toBeLessThanOrEqual(56);
    expect(sentences(copy.description).length).toBeLessThanOrEqual(2);
    expect(words(copy.description).length).toBeLessThanOrEqual(25);
    expect(sentences(copy.reads)).toHaveLength(1);
    expect(words(copy.reads).length).toBeLessThanOrEqual(25);
  });

  it("never takes a name: its functions take counts, hours, months and milliseconds", () => {
    expect(copy.undatedNote(2)).toBe("2 chats and Snaps have no usable date. Snappy leaves them out.");
    expect(copy.undatedNote(1)).toBe("1 chat or Snap has no usable date. Snappy leaves it out.");
    expect(copy.unitHour(0)).toBe("12 am");
    expect(copy.unitHour(12)).toBe("12 pm");
    expect(copy.unitHour(23)).toBe("11 pm");
    expect(copy.unitHour(24)).toBe("");
    expect(copy.unitMonth(2026, 3)).toBe("Mar 2026");
    expect(copy.unitMonth(2026, 13)).toBe("");
    expect(copy.unitOffset(-330)).toBe("UTC-5:30");
    expect(copy.unitOffset(0)).toBe("UTC");
    expect(copy.unitGap(500)).toBe("Under 1 second");
    expect(copy.unitGap(40_000)).toBe("40 seconds");
    expect(copy.unitGap(12 * 60_000)).toBe("12 minutes");
    expect(copy.unitGap(3 * HOUR)).toBe("3 hours");
    expect(copy.unitGap(5 * DAY)).toBe("5 days");
  });
});
