/**
 * Year in review: what it computes from the chats, friends and Memories the page holds, and what its page shows.
 * Synthetic data only. Conversation names and usernames carry a canary that must never reach a note, an
 * announcement, a label or a title: this tool reads dates, directions and media types, so its page holds no username at all.
 */
import { insights } from "@snappy-export/core";
import type { ChatEvent, DeletedFriendRecord, FriendRecord, MemoryItem, ParsedExport } from "@snappy-export/core";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAnalysisCache } from "../../src/analysis.ts";
import { tools } from "../../src/copy.ts";
import type { State, Workspace } from "../../src/reducer.ts";
import { COMMANDS, displayText } from "../../src/terminal/commands.ts";
import { toolData } from "../../src/tools/data.ts";
import { copy } from "../../src/tools/year-in-review/copy.ts";
import { descriptor } from "../../src/tools/year-in-review/index.ts";
import { availableYears, computeYear, OFFSETS } from "../../src/tools/year-in-review/model.ts";
import { view } from "../../src/tools/year-in-review/view.ts";
import { forgetPreferredOffset, offsetLabel, rememberOffset } from "../../src/tools/timezone.ts";
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
const FRIEND_CANARY = "zqcanary_friend";
const MINUTE = 60_000;
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 5, 1);
const MAR_1 = Date.UTC(2025, 2, 1, 12);
const MAR_14 = Date.UTC(2025, 2, 14, 12);
const MAR_25 = Date.UTC(2025, 2, 25, 12);
const FEB_2_2026 = Date.UTC(2026, 1, 2, 12);

let base: Workspace;
let sample: State;
beforeAll(async () => {
  base = await sampleWorkspace();
  sample = await sampleState();
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

const chat = (at: number, direction: ChatEvent["direction"] = "sent", kind = "TEXT"): ChatEvent => ({ conversation: CANARY, isGroup: false, direction, kind, at });
const run = (n: number, at: number, direction: ChatEvent["direction"] = "sent", kind = "TEXT"): ChatEvent[] => Array.from({ length: n }, (_, i) => chat(at + i * MINUTE, direction, kind));
const friend = (createdAt: number | undefined): FriendRecord => ({ username: FRIEND_CANARY, ...(createdAt === undefined ? {} : { createdAt }) });
const removed = (deletedAt: number | undefined): DeletedFriendRecord => ({ username: FRIEND_CANARY, ...(deletedAt === undefined ? {} : { deletedAt }) });
const memory = (date: number | null, mediaType: MemoryItem["mediaType"] = "image"): MemoryItem => ({ id: `m-${String(date)}-${mediaType}`, date, mediaType });

interface Parts {
  chats?: ChatEvent[];
  friends?: FriendRecord[];
  removed?: DeletedFriendRecord[];
  memories?: MemoryItem[];
}

/** A real (not sample) export that holds exactly these parts. */
function withExport(p: Parts, ws: Partial<Workspace> = {}): State {
  const b = base.latest as ParsedExport;
  const latest: ParsedExport = {
    ...b,
    chats: p.chats ?? [],
    memories: p.memories ?? [],
    friends: { ...b.friends, friends: p.friends ?? [], deletedFriends: p.removed ?? [] },
  };
  return stateWith({ latest, now: NOW, issues: [], parts: 1, ...ws });
}

/** 10 Snaps on Mar 1, 20 chats on Mar 14 (10 sent), 10 received chats on Mar 25 (all 2025), and 5 chats in Feb 2026. */
const crafted = (): Parts => ({
  chats: [...run(10, MAR_1, "sent", "IMAGE"), ...run(20, MAR_14).map((c, i) => ({ ...c, direction: i % 2 === 0 ? ("sent" as const) : ("received" as const) })), ...run(10, MAR_25, "received"), ...run(5, FEB_2_2026)],
  friends: [friend(Date.UTC(2025, 0, 5)), friend(Date.UTC(2024, 5, 1))],
  removed: [removed(Date.UTC(2025, 5, 1))],
  memories: [memory(Date.UTC(2025, 1, 10)), memory(Date.UTC(2025, 1, 11), "video"), memory(Date.UTC(2024, 11, 31))],
});
const dataOf = (state: State) => toolData(state);

describe("the tool", () => {
  it("is a Your export tool that needs an export and shows the year command", () => {
    expect(descriptor).toMatchObject({ id: "year-in-review", title: "Year in review", group: "your-export", category: "cleanup", needs: ["export"] });
    expect(descriptor.oneLiner).toBe("Sum up a year of chats, Snaps and Memories.");
    expect(COMMANDS["year-in-review"].argv[0]).toBe("year");
  });
});

describe("computeYear", () => {
  it("sums up the sample as core does, from dates, directions and kinds alone", () => {
    const parsed = base.latest as ParsedExport;
    const v = computeYear(dataOf(sample));
    const expected = insights.yearInReview.computeYearInReview(
      {
        chats: parsed.chats.map((c) => ({ direction: c.direction, kind: c.kind, at: c.at })),
        friends: parsed.friends.friends.map((f) => ({ createdAt: f.createdAt })),
        deletedFriends: parsed.friends.deletedFriends.map((f) => ({ deletedAt: f.deletedAt })),
        memories: parsed.memories.map((m) => ({ date: m.date, mediaType: m.mediaType })),
      },
      { now: base.now, utcOffsetMinutes: 0 },
    );
    expect(v.result).toEqual(expected);
    expect(v.result.year).not.toBeNull();
    expect(v.result.activity?.byMonth).toHaveLength(12);
    expect(v.activity).not.toBeNull();
  });

  it("sums up the crafted year: counts, busiest month and day, the longest quiet stretch, friends and Memories", () => {
    const v = computeYear(dataOf(withExport(crafted())), { year: 2025, utcOffsetMinutes: 0 });
    expect(v.result).toMatchObject({ year: 2025, yearSource: "given", inProgress: false });
    expect(v.activity?.total).toEqual({ total: 40, sent: 20, received: 20, unknown: 0 });
    expect(v.activity?.snaps).toEqual({ total: 10, sent: 10, received: 0, unknown: 0 });
    expect(v.activity?.chats).toEqual({ total: 30, sent: 10, received: 20, unknown: 0 });
    expect(v.activity?.busiestMonth).toMatchObject({ key: 3, count: 40, ties: 0 });
    expect(v.activity?.busiestDay).toMatchObject({ key: "2025-03-14", count: 20, ties: 0 });
    expect(v.activity?.longestQuietGap).toEqual({ days: 12, startDay: "2025-03-02", endDay: "2025-03-13" });
    expect(v.tiles).toEqual({ chats: 40, activeDays: 3, memories: 2, newFriends: 1, removedFriends: 1, gapDays: 12 });
    expect(v.memories).toMatchObject({ total: 2, image: 1, video: 1 });
  });

  it("uses the latest year by default, and says a year that is not over is in progress", () => {
    const v = computeYear(dataOf(withExport(crafted())));
    expect(v.result).toMatchObject({ year: 2026, yearSource: "latest", inProgress: true });
    expect(v.tiles.chats).toBe(5);
  });

  it("moves the days with the time zone", () => {
    const state = withExport(crafted());
    expect(computeYear(dataOf(state), { year: 2025, utcOffsetMinutes: 0 }).activity?.busiestDay?.key).toBe("2025-03-14");
    // 12:00 UTC is 02:00 the next day in UTC+14.
    expect(computeYear(dataOf(state), { year: 2025, utcOffsetMinutes: 840 }).activity?.busiestDay?.key).toBe("2025-03-15");
  });

  it("offers only time zones that core accepts as they are", () => {
    for (const minutes of OFFSETS) expect(computeYear(dataOf(withExport(crafted())), { year: 2025, utcOffsetMinutes: minutes }).result.notes.map((n) => n.code)).not.toContain("offset-adjusted");
    expect(OFFSETS).toContain(0);
    expect(computeYear(dataOf(withExport(crafted())), { year: 2025, utcOffsetMinutes: 10_000 }).result.notes.map((n) => n.code)).toContain("offset-adjusted");
  });

  it("tells a part with nothing to count (a dash) from a year with zero in it", () => {
    const none = computeYear(dataOf(withExport({ friends: [friend(undefined)], memories: [memory(null)] })));
    expect(none.result.year).toBeNull();
    expect(none.activity).toBeNull();
    expect(none.tiles).toEqual({ chats: null, activeDays: null, memories: null, newFriends: null, removedFriends: null, gapDays: null });
    const quiet = computeYear(dataOf(withExport(crafted())), { year: 2023, utcOffsetMinutes: 0 });
    expect(quiet.activity).toBeNull();
    expect(quiet.result.notes.map((n) => n.code)).toContain("no-activity-in-year");
    expect(quiet.tiles).toMatchObject({ chats: 0, activeDays: 0, memories: 0, newFriends: 0, removedFriends: 0, gapDays: null });
  });

  it("leaves out dates after now, and says so", () => {
    const v = computeYear(dataOf(withExport({ chats: [...run(30, MAR_14), chat(NOW + DAY)], friends: [friend(NOW + DAY)] })), { year: 2025, utcOffsetMinutes: 0 });
    expect(v.result.skipped).toEqual({ undated: 0, future: 2 });
    expect(v.result.notes.map((n) => n.code)).toContain("future-skipped");
  });

  it("is the same in any input order", () => {
    const p = crafted();
    const a = computeYear(dataOf(withExport(p)), { year: 2025, utcOffsetMinutes: 0 });
    const b = computeYear(dataOf(withExport({ chats: [...(p.chats ?? [])].reverse(), friends: [...(p.friends ?? [])].reverse(), removed: p.removed, memories: [...(p.memories ?? [])].reverse() })), { year: 2025, utcOffsetMinutes: 0 });
    expect(b.result).toEqual(a.result);
  });

  it("holds no conversation name or username, in the result or in any note", () => {
    const v = computeYear(dataOf(withExport(crafted())), { year: 2025, utcOffsetMinutes: 0 });
    expect(JSON.stringify(v)).not.toContain("zqcanary");
  });

  it("refuses to run without an export (the page never calls it that way)", () => {
    expect(() => computeYear(dataOf(emptyState()))).toThrow();
  });
});

describe("availableYears", () => {
  it("lists every year from the first to the last usable date, latest first, widened by the largest time zone shift", () => {
    expect(availableYears(dataOf(withExport(crafted())))).toEqual([2026, 2025, 2024]);
    // 2024-01-01 00:00 UTC is still 2023 for a UTC-12 reader, and 2026-02-02 is the same year everywhere.
    expect(availableYears(dataOf(withExport({ memories: [memory(Date.UTC(2024, 0, 1))], chats: [chat(FEB_2_2026)] })))).toEqual([2026, 2025, 2024, 2023]);
  });

  it("skips dates that are missing, not usable or after now, and is empty with none", () => {
    expect(availableYears(dataOf(withExport({ chats: [chat(0), chat(Number.NaN), chat(NOW + 400 * DAY)], friends: [friend(undefined)], memories: [memory(null)] })))).toEqual([]);
    expect(availableYears(dataOf(emptyState()))).toEqual([]);
  });

  it("looks at the removed friends too", () => {
    expect(availableYears(dataOf(withExport({ removed: [removed(Date.UTC(2022, 5, 1))] })))).toEqual([2022]);
  });
});

/** What a screen reader hears: a cell that shows a bare value keeps its full phrase in a hidden span, and that phrase is read here. */
const cells = (el: FakeElement, selector: string): string[] => el.querySelectorAll(selector).map((e) => e.querySelector(".cell-long")?.textContent ?? e.textContent);
const rowsOf = (table: FakeElement): string[][] => table.querySelectorAll("tbody tr").map((tr) => [...cells(tr, "th"), ...cells(tr, "td")]);
const headings = (root: FakeElement): string[] => root.querySelectorAll(".section-title").map((t) => t.textContent);
const tiles = (root: FakeElement): string[][] => root.querySelectorAll(".stat").map((t) => [t.querySelector(".stat-label")?.textContent ?? "", t.querySelector(".stat-value")?.textContent ?? ""]);
const year2025 = async (): Promise<{ root: FakeElement; select: FakeElement }> => {
  const r = await renderSettled(view, withExport(crafted()));
  const select = r.root.querySelector("#year-in-review-year") as FakeElement;
  select.value = "2025";
  select.fire("change");
  await settled(r.root);
  return { root: r.root, select };
};

describe("the page", () => {
  it("shows the sample's tiles, tables, bar lists, key dates, notes and the command", async () => {
    const { root } = await renderSettled(view, sample);
    expect(headings(root)).toEqual(expect.arrayContaining([copy.glanceHeading, copy.busiestHeading, copy.datesHeading, copy.directionHeading, copy.monthHeading, tools.commandHeading]));
    expect(tiles(root).map((t) => t[0])).toEqual([copy.chatsLabel, copy.activeDaysLabel, copy.memoriesLabel, copy.newFriendsLabel, copy.removedLabel, copy.gapLabel]);
    const tables = root.querySelectorAll("table");
    expect(tables).toHaveLength(2);
    expect(cells(tables[0] as FakeElement, "thead th")).toEqual([copy.patternHeader, copy.busiestHeader, copy.countHeader, copy.shareHeader]);
    expect(cells(tables[0] as FakeElement, "tbody th")).toEqual([copy.monthPattern, copy.dayPattern]);
    expect(cells(tables[1] as FakeElement, "thead th")).toEqual([copy.typeHeader, copy.totalHeader, copy.sentHeader, copy.receivedHeader, copy.unknownHeader]);
    expect(cells(tables[1] as FakeElement, "tbody th")).toEqual([copy.snapsRow, copy.chatsRow, copy.bothRow]);
    expect(cells(root, ".fact dt")).toEqual(expect.arrayContaining([copy.firstLabel, copy.lastLabel]));
    const bars = root.querySelectorAll(".mbars");
    expect(bars.length).toBeGreaterThanOrEqual(1);
    for (const list of bars) expect(list.querySelectorAll("li")).toHaveLength(12);
    expect(root.querySelector(".command code")?.textContent).toBe(displayText(COMMANDS["year-in-review"]));
    expect(root.querySelector(".command-head")?.querySelectorAll("button").map((b) => b.textContent)).toEqual(["Copy", "Run"]);
  });

  it("starts on the latest year and says it is not over", async () => {
    const { root } = await renderSettled(view, withExport(crafted()));
    expect(tiles(root)[0]).toEqual([copy.chatsLabel, "5"]);
    const notes = cells(root, ".tool-notes li");
    expect(notes).toEqual(expect.arrayContaining([copy.progressNote(2026), copy.fewNote(5)]));
    expect(said).toEqual([copy.summaryAnnounce(2026, 5)]);
  });

  it("shows the crafted year's numbers in the tiles, tables, dates and bars", async () => {
    const { root } = await year2025();
    expect(tiles(root)).toEqual([
      [copy.chatsLabel, "40"],
      [copy.activeDaysLabel, "3"],
      [copy.memoriesLabel, "2"],
      [copy.newFriendsLabel, "1"],
      [copy.removedLabel, "1"],
      [copy.gapLabel, "12 days"],
    ]);
    const [busiest, direction] = root.querySelectorAll("table") as [FakeElement, FakeElement];
    expect(rowsOf(busiest)).toEqual([
      [copy.monthPattern, "March is busiest", "40 counted", "100% of the year"],
      [copy.dayPattern, "Mar 14, 2025 is busiest", "20 counted", "50% of the year"],
    ]);
    // A wide page shows the bare value its column names ("20"); the phrase is for assistive technology and a phone's card.
    expect(direction.querySelectorAll("tbody tr")[1]?.querySelectorAll("td").map((td) => td.querySelector(".cell-short")?.textContent)).toEqual(["30", "10", "20", "0"]);
    expect(busiest.querySelectorAll("tbody tr")[0]?.querySelectorAll("td").map((td) => td.querySelector(".cell-short")?.textContent)).toEqual(["Mar", "40", "100%"]);
    expect(rowsOf(direction)).toEqual([
      [copy.snapsRow, "10 in all", "10 sent", "0 received", "0 unknown"],
      [copy.chatsRow, "30 in all", "10 sent", "20 received", "0 unknown"],
      [copy.bothRow, "40 in all", "20 sent", "20 received", "0 unknown"],
    ]);
    const facts = root.querySelectorAll(".fact").map((f) => [f.querySelector("dt")?.textContent, f.querySelector("dd")?.textContent]);
    expect(facts).toEqual([
      [copy.firstLabel, "Mar 1, 2025"],
      [copy.lastLabel, "Mar 25, 2025"],
      [copy.quietLabel, "Mar 2, 2025 to Mar 13, 2025"],
    ]);
    const [activity, memories] = root.querySelectorAll(".mbars") as [FakeElement, FakeElement];
    expect(cells(activity, ".mbar-name")).toEqual([...copy.months]);
    expect(cells(activity, ".mbar-count")).toEqual(["0", "0", "40", "0", "0", "0", "0", "0", "0", "0", "0", "0"]);
    expect(cells(memories, ".mbar-count")).toEqual(["0", "2", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0"]);
    const march = activity.querySelectorAll("li")[2] as FakeElement;
    expect((march.querySelector(".meter-fill") as FakeElement).styleProps.get("width")).toBe("100%");
    expect(((activity.querySelectorAll("li")[0] as FakeElement).querySelector(".meter-fill") as FakeElement).styleProps.get("width")).toBe("0%");
    // The bar is decorative: the count beside it says the same.
    expect(march.querySelector(".meter")?.getAttribute("aria-hidden")).toBe("true");
    expect(headings(root)).toContain(copy.memoriesMonthHeading);
  });

  it("recomputes for another year and keeps both controls", async () => {
    const r = await renderSettled(view, withExport(crafted()));
    const select = r.root.querySelector("select") as FakeElement;
    expect(select.getAttribute("id")).toBe("year-in-review-year");
    const options = select.querySelectorAll("option");
    expect(options.map((o) => o.textContent)).toEqual([copy.latestLabel, "2026", "2025", "2024"]);
    expect(options.find((o) => o.getAttribute("selected") !== null)?.textContent).toBe(copy.latestLabel);
    expect(r.root.querySelector("label[for=year-in-review-year]")?.textContent).toBe(copy.yearLabel);
    select.value = "2025";
    select.fire("change");
    expect(r.root.querySelector(".tool-result")?.getAttribute("aria-busy")).toBe("true");
    await settled(r.root);
    expect(r.root.querySelector("#year-in-review-year")).toBe(select);
    expect(tiles(r.root)[0]).toEqual([copy.chatsLabel, "40"]);
    expect(said).toEqual([copy.summaryAnnounce(2026, 5), copy.summaryAnnounce(2025, 40)]);
    select.value = "";
    select.fire("change");
    await settled(r.root);
    expect(tiles(r.root)[0]).toEqual([copy.chatsLabel, "5"]);
  });

  it("starts in the zone of the device, or the one chosen in Settings, and keeps a pick on this page only", async () => {
    deviceAt(-300);
    const state = withExport(crafted());
    const first = await renderSettled(view, state);
    const selected = (root: FakeElement): string | undefined => root.querySelector("#year-in-review-zone option[selected]")?.textContent;
    expect(selected(first.root)).toBe("UTC-5:00");
    const zone = first.root.querySelector("#year-in-review-zone") as FakeElement;
    zone.value = "840";
    zone.fire("change");
    await settled(first.root);
    expect(selected((await renderSettled(view, state)).root)).toBe("UTC-5:00");
    rememberOffset(60);
    expect(selected((await renderSettled(view, state)).root)).toBe("UTC+1:00");
    expect(copy.zoneHelp).not.toContain("starts with UTC");
  });

  it("recomputes for another time zone, repaints only the result and keeps the control", async () => {
    const { root, select } = await year2025();
    const zone = root.querySelector("#year-in-review-zone") as FakeElement;
    const options = zone.querySelectorAll("option");
    expect(options).toHaveLength(OFFSETS.length);
    expect(options.find((o) => o.getAttribute("selected") !== null)?.textContent).toBe("UTC");
    expect(options.map((o) => o.textContent)).toEqual(expect.arrayContaining(["UTC-5:00", "UTC+5:30", "UTC+5:45"]));
    expect(root.querySelector("label[for=year-in-review-zone]")?.textContent).toBe(copy.zoneLabel);
    zone.value = "840";
    zone.fire("change");
    await settled(root);
    expect(root.querySelector("#year-in-review-zone")).toBe(zone);
    expect(root.querySelector("#year-in-review-year")).toBe(select);
    expect(rowsOf(root.querySelectorAll("table")[0] as FakeElement)[1]?.[1]).toBe("Mar 15, 2025 is busiest");
    // The year picked earlier is kept.
    expect(tiles(root)[0]).toEqual([copy.chatsLabel, "40"]);
  });

  it("shows a quiet year as zeros, leaves out what needs activity, and announces it", async () => {
    const r = await renderSettled(view, withExport(crafted()));
    const select = r.root.querySelector("#year-in-review-year") as FakeElement;
    select.value = "2024";
    select.fire("change");
    await settled(r.root);
    expect(tiles(r.root)).toEqual([
      [copy.chatsLabel, "0"],
      [copy.activeDaysLabel, "0"],
      [copy.memoriesLabel, "1"],
      [copy.newFriendsLabel, "1"],
      [copy.removedLabel, "0"],
      [copy.gapLabel, copy.noValue],
    ]);
    expect(r.root.querySelectorAll("table")).toHaveLength(0);
    expect(headings(r.root)).not.toContain(copy.busiestHeading);
    expect(headings(r.root)).not.toContain(copy.monthHeading);
    expect(headings(r.root)).toContain(copy.memoriesMonthHeading);
    expect(cells(r.root, ".tool-notes li")).toEqual(expect.arrayContaining([copy.noActivityInYearNote(2024)]));
    expect(said.at(-1)).toBe(copy.quietAnnounce(2024));
  });

  it("shows a dash for what the export cannot count", async () => {
    const { root } = await renderSettled(view, withExport({ chats: run(30, MAR_14) }));
    expect(tiles(root)).toEqual([
      [copy.chatsLabel, "30"],
      [copy.activeDaysLabel, "1"],
      [copy.memoriesLabel, copy.noValue],
      [copy.newFriendsLabel, copy.noValue],
      [copy.removedLabel, copy.noValue],
      [copy.gapLabel, copy.noValue],
    ]);
    expect(cells(root, ".tool-notes li")).toEqual(expect.arrayContaining([copy.noFriendDatesNote, copy.noRemovalDatesNote, copy.noMemoriesNote]));
    expect(headings(root)).not.toContain(copy.memoriesMonthHeading);
  });

  it("marks a tied busiest month and day as tied", async () => {
    const { root } = await renderSettled(view, withExport({ chats: [...run(15, Date.UTC(2025, 0, 10, 12)), ...run(15, Date.UTC(2025, 1, 10, 12))] }));
    const select = root.querySelector("#year-in-review-year") as FakeElement;
    select.value = "2025";
    select.fire("change");
    await settled(root);
    const [busiest] = root.querySelectorAll("table") as [FakeElement];
    expect(rowsOf(busiest)).toEqual([
      [copy.monthPattern, copy.unitBusiestAt(copy.unitTied("January")), "15 counted", "50% of the year"],
      [copy.dayPattern, copy.unitBusiestAt(copy.unitTied("Jan 10, 2025")), "15 counted", "50% of the year"],
    ]);
  });

  it("shows the honest empty result when nothing has a usable date", async () => {
    const { root } = await renderSettled(view, withExport({ chats: [chat(0), chat(0, "received")], friends: [friend(undefined)], memories: [memory(null)] }));
    expect(root.querySelector(".empty-title")?.textContent).toBe(copy.empty.title);
    expect(root.querySelector(".empty-body")?.textContent).toBe(copy.empty.body);
    expect(root.querySelectorAll("table")).toHaveLength(0);
    expect(root.querySelectorAll(".mbars")).toHaveLength(0);
    expect(said).toEqual([copy.emptyAnnounce]);
  });

  it("announces its result politely, once, without a name", async () => {
    await renderSettled(view, withExport(crafted()));
    expect(said).toEqual([copy.summaryAnnounce(2026, 5)]);
    expect(said[0]?.length).toBeLessThanOrEqual(140);
    expect(said[0]).not.toContain("zqcanary");
  });

  it("says what is missing when no export is read, and when only saved history is held", async () => {
    const nothing = render(view, emptyState());
    expect(nothing.root.querySelector(".empty-title")?.textContent).toBe(tools.needs.exportTitle);
    expect(nothing.root.querySelector(".tool-result")).toBeNull();
    await new Promise((r) => setTimeout(r, 10));
    expect(said).toEqual([]);
    // The command stays on the page either way.
    expect(nothing.root.querySelector(".command code")?.textContent).toBe(displayText(COMMANDS["year-in-review"]));
    const ledgerOnly = render(view, stateWith({ ledger: base.ledger }));
    expect(ledgerOnly.root.querySelector(".empty-title")?.textContent).toBe(tools.needs.exportTitle);
  });

  it("writes hedged notes: a thin year, an unknown direction, left-out dates, and a year that is not over", async () => {
    const { root } = await renderSettled(view, withExport({ chats: [...run(10, FEB_2_2026, "unknown"), chat(NOW + DAY), chat(0)], friends: [friend(Date.UTC(2026, 0, 5)), friend(NOW + DAY)] }));
    const notes = cells(root, ".tool-notes li");
    expect(notes).toEqual(expect.arrayContaining([copy.progressNote(2026), copy.fewNote(10), copy.unknownNote(100), copy.futureNote(2), copy.undatedNote(1), copy.currentFriendsNote]));
    expect(root.querySelectorAll(".tool-note-warning").length).toBeGreaterThanOrEqual(2);
    expect(notes.join(" ")).toMatch(/may/);
  });

  it("says saved chats only and current friends only, once each, when it shows those numbers", async () => {
    const { root } = await year2025();
    const notes = cells(root, ".tool-notes li");
    expect(notes.filter((n) => n === copy.savedChatsNote)).toHaveLength(1);
    expect(notes.filter((n) => n === copy.currentFriendsNote)).toHaveLength(1);
  });

  it("has no download and builds no file", async () => {
    const { root } = await renderSettled(view, withExport(crafted()));
    expect(root.querySelectorAll("button").filter((b) => /download/i.test(b.textContent))).toHaveLength(0);
    expect(headings(root)).not.toContain(tools.downloadHeading);
    expect(saved).toEqual([]);
  });
});

describe("what the page never shows", () => {
  it("shows no conversation name or username, in any note, announcement, label or table, not even a canary", async () => {
    const states: State[] = [withExport(crafted()), withExport({ chats: run(10, MAR_14, "unknown"), friends: [friend(MAR_1)] }), withExport({ chats: [chat(0)] })];
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
    const entries = collectCopy({ tool_year_in_review: copy });
    expect(entries.length).toBeGreaterThan(40);
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

  it("keeps each tile label on one line", () => {
    for (const label of [copy.chatsLabel, copy.activeDaysLabel, copy.memoriesLabel, copy.newFriendsLabel, copy.removedLabel, copy.gapLabel]) expect(label.length, label).toBeLessThanOrEqual(18);
  });

  it("never takes a name: its functions take counts, years, percentages and dates", () => {
    expect(copy.undatedNote(2)).toBe("2 items have no usable date. Snappy leaves them out.");
    expect(copy.undatedNote(1)).toBe("1 item has no usable date. Snappy leaves it out.");
    expect(copy.futureNote(1)).toBe("1 item is dated in the future. Snappy leaves it out.");
    expect(copy.fewNote(1)).toBe("Only 1 chat or Snap was counted, so this year may look thin.");
    expect(copy.fewNote(5)).toBe("Only 5 chats and Snaps were counted, so this year may look thin.");
    expect(copy.progressNote(2026)).toBe("2026 is not over yet, so these numbers may still grow.");
    expect(copy.progressNote(Number.NaN)).toBe("");
    expect(copy.noActivityInYearNote(2023)).toBe("No chats or Snaps are dated in 2023.");
    expect(copy.summaryAnnounce(2025, 1)).toBe("Year in review for 2025 counted 1 chat or Snap.");
    expect(copy.quietAnnounce(2025)).toBe("Year in review found no chats or Snaps in 2025.");
    expect(copy.unitGapDays(1)).toBe("1 day");
    expect(copy.unitGapDays(12)).toBe("12 days");
    expect(copy.unitGapDays(-1)).toBe("");
    expect(offsetLabel(-330)).toBe("UTC-5:30");
    expect(offsetLabel(0)).toBe("UTC");
    expect(copy.unknownNote(60)).toBe("About 60% have no known direction, so sent and received may be off.");
    expect(copy.months).toHaveLength(12);
    expect(copy.monthsLong).toHaveLength(12);
  });
});
