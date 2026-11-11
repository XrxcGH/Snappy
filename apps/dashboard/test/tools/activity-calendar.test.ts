/**
 * Activity calendar: what it computes from the chats the page holds, and what its page shows. Synthetic data only.
 * Conversation names carry a canary that must never reach a result, a note, an announcement or the page.
 */
import { insights } from "@snappy-export/core";
import type { ChatEvent, ParsedExport } from "@snappy-export/core";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAnalysisCache } from "../../src/analysis.ts";
import { tools } from "../../src/copy.ts";
import type { State, Workspace } from "../../src/reducer.ts";
import { COMMANDS, displayText } from "../../src/terminal/commands.ts";
import { toolData } from "../../src/tools/data.ts";
import { copy } from "../../src/tools/activity-calendar/copy.ts";
import { descriptor } from "../../src/tools/activity-calendar/index.ts";
import { computeCalendar, heatLevel, yearChoices, YEARS_SHOWN } from "../../src/tools/activity-calendar/model.ts";
import { OFFSETS, forgetPreferredOffset } from "../../src/tools/timezone.ts";
import { dropChosenZone } from "../../src/tools/activity-calendar/controls.ts";
import { view } from "../../src/tools/activity-calendar/view.ts";
import { RULES, collectCopy, lint, sentences, words } from "../copy-rules.ts";
import type { FakeElement } from "../fake-dom.ts";
import { phrase } from "./cell-text.ts";
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
const NOW = Date.UTC(2026, 5, 1);
/** A Monday, a Tuesday, the next Tuesday and the Tuesday after that, in March 2026, at noon UTC. */
const MON_MAR_2 = Date.UTC(2026, 2, 2, 12);
const TUE_MAR_3 = Date.UTC(2026, 2, 3, 12);
const TUE_MAR_10 = Date.UTC(2026, 2, 10, 12);
const TUE_MAR_17 = Date.UTC(2026, 2, 17, 12);

let base: Workspace;
let sample: State;
beforeAll(async () => {
  base = await sampleWorkspace();
  sample = await sampleState();
}, 120_000);
beforeEach(() => {
  // The pages open in the device's time zone. These tests pin the device to UTC; the zone tests below move it.
  vi.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(0);
  forgetPreferredOffset();
  dropChosenZone();
  resetAnalysisCache();
  said.length = 0;
  saved.length = 0;
});
afterEach(() => {
  vi.restoreAllMocks();
});

const chat = (at: number, kind = "TEXT", direction: ChatEvent["direction"] = "sent"): ChatEvent => ({ conversation: CANARY, isGroup: false, direction, kind, at });
const many = (n: number, at: number, kind = "TEXT", step = 60_000): ChatEvent[] => Array.from({ length: n }, (_, i) => chat(at + i * step, kind));

/** A real (not sample) export that holds exactly these chats. */
function withChats(chats: ChatEvent[], ws: Partial<Workspace> = {}): State {
  const latest = { ...(base.latest as ParsedExport), chats };
  return stateWith({ latest, now: NOW, issues: [], parts: 1, ...ws });
}
/**
 * 20 text on Mon Mar 2, 10 image on Tue Mar 3, 6 video on Tue Mar 10 and 4 media on Tue Mar 17: 40 on 4 days. The full weeks
 * are Mar 2 to 8 (30) and Mar 9 to 15 (6). Active runs: Mar 2 to 3 is the longest. Quiet runs: Mar 4 to 9 and Mar 11 to 16 tie at 6 days.
 */
const crafted = (): ChatEvent[] => [...many(20, MON_MAR_2), ...many(10, TUE_MAR_3, "IMAGE"), ...many(6, TUE_MAR_10, "VIDEO"), ...many(4, TUE_MAR_17, "MEDIA")];
const dataOf = (state: State) => toolData(state);

describe("the tool", () => {
  it("is a Chats tool in the quiet color that needs chat history and shows the calendar command", () => {
    expect(descriptor).toMatchObject({ id: "activity-calendar", title: "Activity calendar", group: "chats", category: "quiet", icon: "calendar", needs: ["chats"] });
    expect(descriptor.oneLiner).toBe("See your activity by day, week and kind.");
    expect(COMMANDS["calendar" as keyof typeof COMMANDS].argv[0]).toBe("calendar");
  });
});

describe("heatLevel", () => {
  it("is 0 for no activity and 1 to 4 by quarters of the busiest day", () => {
    expect(heatLevel(0, 20)).toBe(0);
    expect(heatLevel(1, 0)).toBe(0);
    expect(heatLevel(Number.NaN, 20)).toBe(0);
    expect(heatLevel(1, 100)).toBe(1);
    expect(heatLevel(5, 20)).toBe(1);
    expect(heatLevel(6, 20)).toBe(2);
    expect(heatLevel(10, 20)).toBe(2);
    expect(heatLevel(11, 20)).toBe(3);
    expect(heatLevel(15, 20)).toBe(3);
    expect(heatLevel(16, 20)).toBe(4);
    expect(heatLevel(20, 20)).toBe(4);
  });
});

describe("computeCalendar", () => {
  it("counts the sample as core does, from the kind and time of each event alone", () => {
    const parsed = base.latest as ParsedExport;
    const v = computeCalendar(dataOf(sample));
    const expected = insights.activityCalendar.computeActivityCalendar(parsed.chats.map((c) => ({ kind: c.kind, at: c.at })), { now: base.now, utcOffsetMinutes: 0 });
    expect(v.result).toEqual(expected);
    expect(v.result.totals.used).toBeGreaterThan(0);
    expect(v.year).not.toBeNull();
    expect(v.year?.levels).toHaveLength(v.year?.calendar.days.length ?? -1);
    expect(v.yearsShown.length).toBeLessThanOrEqual(YEARS_SHOWN);
    expect(v.yearsTotal).toBe(v.result.years.length);
  });

  it("finds the days, runs, weeks and kinds of a crafted export", () => {
    const v = computeCalendar(dataOf(withChats(crafted())));
    expect(v.result.totals).toMatchObject({ used: 40, activeDays: 4, undated: 0, future: 0 });
    expect(v.result.mix).toMatchObject({ text: 20, image: 10, video: 6, note: 0, sticker: 0, other: 4, total: 40 });
    expect(v.result.streaks.longestActive).toEqual({ days: 2, start: "2026-03-02", end: "2026-03-03" });
    expect(v.result.streaks.longestQuiet).toEqual({ days: 6, start: "2026-03-04", end: "2026-03-09" });
    const cal = v.year?.calendar;
    expect(cal).toMatchObject({ year: 2026, total: 40, activeDays: 4 });
    expect(cal?.busiestWeek).toEqual({ start: "2026-03-02", count: 30, ties: 0 });
    expect(cal?.quietestWeek).toEqual({ start: "2026-03-09", count: 6, ties: 0 });
    expect(cal?.days).toHaveLength(152);
    expect(v.result.mixByYear).toEqual([{ year: 2026, text: 20, image: 10, video: 6, note: 0, sticker: 0, other: 4, total: 40 }]);
  });

  it("shapes the grid: heat levels, the row of January 1 and the month labels", () => {
    const y = computeCalendar(dataOf(withChats(crafted()))).year as NonNullable<ReturnType<typeof computeCalendar>["year"]>;
    // Jan 1, 2026 is a Thursday: row 3 when Monday is row 0.
    expect(y.startRow).toBe(3);
    // Mar 2 is day 60 (0-based), Mar 3 is 61, Mar 10 is 68 and Mar 17 is 75; the busiest day has 20.
    expect([60, 61, 68, 75].map((i) => y.levels[i])).toEqual([4, 2, 2, 1]);
    expect(y.levels.filter((l) => l > 0)).toHaveLength(4);
    expect(y.marks.map((m) => m.month)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(y.marks[0]).toEqual({ month: 1, column: 1 });
    // Feb 1 is day 31: (31 + 3) / 7 = 4.86, so column 5. Mar 1 is day 59: (59 + 3) / 7 = 8.86, so column 9.
    expect(y.marks[1]?.column).toBe(5);
    expect(y.marks[2]?.column).toBe(9);
    expect(y.columns).toBe(Math.floor((152 - 1 + 3) / 7) + 1);
  });

  it("lists the year asked for, and an empty one without activity", () => {
    const chats = [...many(30, Date.UTC(2025, 5, 1, 12)), ...many(30, Date.UTC(2026, 1, 1, 12))];
    const data = dataOf(withChats(chats));
    expect(computeCalendar(data).year?.calendar.year).toBe(2026);
    expect(computeCalendar(data, { utcOffsetMinutes: 0, year: 2025 }).year?.calendar).toMatchObject({ year: 2025, total: 30, activeDays: 1 });
    const empty = computeCalendar(data, { utcOffsetMinutes: 0, year: 2020 });
    expect(empty.year?.calendar).toMatchObject({ year: 2020, total: 0 });
    expect(empty.result.notes.map((n) => n.code)).toContain("year-empty");
    expect(empty.year?.levels.every((l) => l === 0)).toBe(true);
    // A year in the future has no listed days.
    expect(computeCalendar(data, { utcOffsetMinutes: 0, year: 2030 }).year?.calendar.days).toEqual([]);
    expect(computeCalendar(data, { utcOffsetMinutes: 0, year: 1900 }).result.notes.map((n) => n.code)).toContain("year-adjusted");
    expect(computeCalendar(data, { utcOffsetMinutes: 0, year: 1900 }).year?.calendar.year).toBe(2026);
  });

  it("moves the days with the time zone", () => {
    const data = dataOf(withChats(many(30, Date.UTC(2026, 2, 2, 23))));
    const day = (minutes: number): string | undefined => computeCalendar(data, { utcOffsetMinutes: minutes, year: null }).result.streaks.longestActive?.start;
    expect(day(0)).toBe("2026-03-02");
    expect(day(180)).toBe("2026-03-03");
    expect(day(-300)).toBe("2026-03-02");
    expect(day(840)).toBe("2026-03-03");
  });

  it("offers only time zones that core accepts as they are", () => {
    const data = dataOf(withChats(crafted()));
    for (const minutes of OFFSETS) expect(computeCalendar(data, { utcOffsetMinutes: minutes, year: null }).result.notes.map((n) => n.code)).not.toContain("offset-adjusted");
    expect(OFFSETS).toContain(0);
    expect(computeCalendar(data, { utcOffsetMinutes: 10_000, year: null }).result.notes.map((n) => n.code)).toContain("offset-adjusted");
  });

  it("matches kinds ignoring case and spaces, and counts anything else as other", () => {
    const v = computeCalendar(dataOf(withChats([chat(MON_MAR_2, " image "), chat(MON_MAR_2, "video"), chat(MON_MAR_2, "SNAP"), chat(MON_MAR_2, ""), chat(MON_MAR_2, "Sticker")])));
    expect(v.result.mix).toMatchObject({ image: 1, video: 1, sticker: 1, other: 2, total: 5 });
  });

  it("finds nothing to count in an empty list or in dates that are unusable", () => {
    const none = computeCalendar(dataOf(withChats([])));
    expect(none.result.totals.used).toBe(0);
    expect(none.year).toBeNull();
    expect(none.yearsShown).toEqual([]);
    const undated = computeCalendar(dataOf(withChats([chat(0), chat(Number.NaN)])));
    expect(undated.result.totals).toMatchObject({ used: 0, undated: 2 });
    expect(undated.result.notes.map((n) => n.code)).toContain("no-usable-events");
  });

  it("leaves out events dated after now, and says so", () => {
    const v = computeCalendar(dataOf(withChats([...many(30, MON_MAR_2), chat(NOW + DAY)])));
    expect(v.result.totals).toMatchObject({ used: 30, future: 1 });
    expect(v.result.notes.map((n) => n.code)).toContain("future-skipped");
  });

  it("calls the picture weak under 30 events, and the mix unreliable above half other", () => {
    const codes = (events: ChatEvent[]): string[] => computeCalendar(dataOf(withChats(events))).result.notes.map((n) => n.code);
    expect(codes(many(29, MON_MAR_2))).toContain("few-events");
    expect(codes(many(30, MON_MAR_2))).not.toContain("few-events");
    expect(codes(many(40, MON_MAR_2, "MEDIA"))).toContain("many-other-kind");
    expect(codes(many(40, MON_MAR_2, "TEXT"))).not.toContain("many-other-kind");
  });

  it("is the same in any input order", () => {
    const events = crafted();
    expect(computeCalendar(dataOf(withChats([...events].reverse()))).result).toEqual(computeCalendar(dataOf(withChats(events))).result);
  });

  it("copes with a leap day and a year with 366 days", () => {
    const v = computeCalendar(dataOf(withChats([...many(15, Date.UTC(2024, 1, 29, 12)), ...many(15, Date.UTC(2024, 11, 31, 12))])), { utcOffsetMinutes: 0, year: 2024 });
    const days = v.year?.calendar.days ?? [];
    expect(days).toHaveLength(366);
    expect(days.find((d) => d.date === "2024-02-29")?.count).toBe(15);
    expect(days.at(-1)).toEqual({ date: "2024-12-31", count: 15 });
    // Jan 1, 2024 was a Monday, so the grid starts in the first row.
    expect(v.year?.startRow).toBe(0);
  });

  it("holds no conversation name, in the result or in any note", () => {
    const v = computeCalendar(dataOf(withChats(crafted())));
    expect(JSON.stringify(v)).not.toContain("zqcanary");
    expect(JSON.stringify(v)).not.toContain(CANARY);
  });

  it("refuses to run without an export (the page never calls it that way)", () => {
    expect(() => computeCalendar(dataOf(emptyState()))).toThrow();
  });

  it("is fast on a large list", () => {
    const big = Array.from({ length: 200_000 }, (_, i) => chat(Date.UTC(2020, 0, 1) + (i % 2000) * DAY + (i % 24) * HOUR, ["TEXT", "IMAGE", "MEDIA"][i % 3]));
    const started = Date.now();
    const v = computeCalendar(dataOf(withChats(big)), { utcOffsetMinutes: 0, year: 2024 });
    expect(Date.now() - started).toBeLessThan(5000);
    expect(v.result.totals.used).toBeGreaterThan(100_000);
  });
});

describe("yearChoices", () => {
  it("lists every year the export could hold, newest first, with a year of room for the time zone", () => {
    const data = dataOf(withChats([chat(Date.UTC(2023, 0, 1, 2)), chat(Date.UTC(2023, 5, 1)), chat(Date.UTC(2025, 5, 1))]));
    // Jan 1, 2023 at 2 am UTC is still Dec 31, 2022 in UTC-5, so 2022 is offered too.
    expect(yearChoices(data)).toEqual([2025, 2024, 2023, 2022]);
  });

  it("is empty with no usable time, never offers a year after now, and is held once per list", () => {
    expect(yearChoices(dataOf(withChats([])))).toEqual([]);
    expect(yearChoices(dataOf(withChats([chat(0), chat(Number.NaN)])))).toEqual([]);
    expect(yearChoices(dataOf(withChats([chat(NOW + 400 * DAY)])))).toEqual([]);
    const data = dataOf(withChats(crafted()));
    expect(yearChoices(data)).toBe(yearChoices(data));
    expect(yearChoices(dataOf(emptyState()))).toEqual([]);
  });
});

const cells = (el: FakeElement, selector: string): string[] => el.querySelectorAll(selector).map(phrase);
const rowsOf = (table: FakeElement): string[][] => table.querySelectorAll("tbody tr").map((tr) => [...cells(tr, "th"), ...cells(tr, "td")]);
const headings = (root: FakeElement): string[] => root.querySelectorAll(".section-title").map((t) => t.textContent);

describe("the page", () => {
  it("shows the sample's overview, year, grid, months, runs, kinds, notes and the command", async () => {
    const { root } = await renderSettled(view, sample);
    expect(headings(root)).toEqual(
      expect.arrayContaining([copy.glanceHeading, copy.monthHeading, copy.runsHeading, copy.kindsHeading, copy.kindsByYearHeading, tools.commandHeading]),
    );
    expect(headings(root).some((t) => /^Year \d{4}$/.test(t))).toBe(true);
    expect(cells(root, ".fact dt")).toEqual(expect.arrayContaining([copy.countedLabel, copy.activeDaysLabel, copy.firstLabel, copy.lastLabel]));
    expect(root.querySelectorAll("table")).toHaveLength(5);
    expect(root.querySelectorAll(".cal-grid .cal-cell").length).toBeGreaterThan(28);
    expect(root.querySelector(".command code")?.textContent).toBe(displayText(COMMANDS["calendar" as keyof typeof COMMANDS]));
    expect(root.querySelector(".command-head")?.querySelectorAll("button").map((b) => b.textContent)).toEqual(["Copy", "Run"]);
  });

  it("shows the crafted export's numbers in the tables, the grid and the bars", async () => {
    const { root } = await renderSettled(view, withChats(crafted()));
    const tables = root.querySelectorAll("table") as [FakeElement, FakeElement, FakeElement, FakeElement, FakeElement];
    expect(cells(tables[0], "thead th")).toEqual([copy.measureHeader, copy.valueHeader]);
    expect(rowsOf(tables[0])).toEqual([
      [copy.countedRow, "40 counted"],
      [copy.activeDaysRow, "4 days"],
      [copy.busiestWeekRow, "Week of Mar 2, 2026, 30 chats and Snaps"],
      [copy.quietestWeekRow, "Week of Mar 9, 2026, 6 chats and Snaps"],
    ]);
    const runs = [
      [copy.activeRunRow, "2 days", "From Mar 2, 2026", "To Mar 3, 2026"],
      [copy.quietRunRow, "6 days", "From Mar 4, 2026", "To Mar 9, 2026"],
    ];
    expect(cells(tables[1], "thead th")).toEqual([copy.runHeader, copy.lengthHeader, copy.fromHeader, copy.toHeader]);
    expect(rowsOf(tables[1])).toEqual(runs);
    expect(rowsOf(tables[2])).toEqual(runs);
    expect(cells(tables[2], "caption")).toEqual([copy.yearRunsCaption(2026)]);
    // Each run table sits under its own small heading, so the two can be told apart.
    expect(cells(root, ".subheading")).toEqual([copy.allTimeRunsCaption, copy.yearRunsCaption(2026)]);
    expect(cells(tables[3], "thead th")).toEqual([copy.kindHeader, copy.allTimeHeader, copy.shareHeader, "2026"]);
    expect(rowsOf(tables[3])).toEqual([
      ["Text", "20 counted", "50% of the total", "20 counted in 2026"],
      ["Image", "10 counted", "25% of the total", "10 counted in 2026"],
      ["Video", "6 counted", "15% of the total", "6 counted in 2026"],
      ["Note", "0 counted", "0% of the total", "0 counted in 2026"],
      ["Sticker", "0 counted", "0% of the total", "0 counted in 2026"],
      ["Other", "4 counted", "10% of the total", "4 counted in 2026"],
    ]);
    expect(rowsOf(tables[4])).toEqual([["2026", "20 text", "10 image", "6 video", "0 note", "0 sticker", "4 other", "40 in all"]]);
    expect(root.textContent).toContain(copy.otherNote);

    // One square per listed day, in order, with the heat levels of the busiest day and the quieter ones.
    const squares = root.querySelectorAll(".cal-grid .cal-cell");
    expect(squares).toHaveLength(152);
    expect(squares[60]?.classList.contains("lvl-4")).toBe(true);
    expect(squares[61]?.classList.contains("lvl-2")).toBe(true);
    expect(squares[75]?.classList.contains("lvl-1")).toBe(true);
    expect(squares[0]?.classList.contains("lvl-0")).toBe(true);
    expect(squares[0]?.styleProps.get("grid-row-start")).toBe("4");
    expect(squares[1]?.styleProps.has("grid-row-start")).toBe(false);
    expect(cells(root, ".cal-month")).toEqual(["Jan", "Feb", "Mar", "Apr", "May", "Jun"]);
    expect(root.querySelector(".cal-month")?.styleProps.get("grid-column")).toBe("1 / span 3");
    expect(cells(root, ".cal-weekday")).toEqual(["Mon", "Wed", "Fri"]);
    expect(root.querySelectorAll(".cal-legend .cal-cell")).toHaveLength(5);

    // The grid is one image for a screen reader, with the counts in words; the tables hold the same numbers.
    const scroll = root.querySelector(".cal-scroll") as FakeElement;
    expect(scroll.getAttribute("role")).toBe("img");
    expect(scroll.getAttribute("tabindex")).toBe("0");
    expect(scroll.getAttribute("aria-label")).toBe(copy.gridFor(2026, 40, 4));
    expect(root.querySelector(".cal-legend")?.getAttribute("aria-hidden")).toBe("true");

    const months = root.querySelector(".hbars") as FakeElement;
    expect(cells(months, ".hbar-name")).toEqual(["Jan 2026", "Feb 2026", "Mar 2026", "Apr 2026", "May 2026", "Jun 2026"]);
    expect(cells(months, ".hbar-count")).toEqual(["0", "0", "40", "0", "0", "0"]);
    expect((months.querySelectorAll(".meter-fill")[2] as FakeElement).styleProps.get("width")).toBe("100%");
    expect((months.querySelectorAll(".meter-fill")[0] as FakeElement).styleProps.get("width")).toBe("0%");
    expect(months.querySelectorAll(".meter")[0]?.getAttribute("aria-hidden")).toBe("true");
  });

  it("marks a tied busiest week", async () => {
    const chats = [...many(10, Date.UTC(2026, 2, 2, 12)), ...many(10, Date.UTC(2026, 2, 9, 12)), ...many(10, Date.UTC(2026, 2, 16, 12)), ...many(10, Date.UTC(2026, 2, 24, 12))];
    const { root } = await renderSettled(view, withChats(chats));
    const first = root.querySelectorAll("table")[0] as FakeElement;
    expect(rowsOf(first).find((r) => r[0] === copy.busiestWeekRow)).toEqual([copy.busiestWeekRow, "Week of Mar 2, 2026, 10 chats and Snaps (tied)"]);
  });

  it("lists at most 10 years of kinds and says how many there are", async () => {
    const chats = Array.from({ length: 14 }, (_, i) => chat(Date.UTC(2012 + i, 5, 10, 12)));
    const { root } = await renderSettled(view, withChats(chats));
    const table = root.querySelectorAll("table").at(-1) as FakeElement;
    expect(rowsOf(table)).toHaveLength(YEARS_SHOWN);
    expect(rowsOf(table)[0]?.[0]).toBe("2016");
    expect(rowsOf(table).at(-1)?.[0]).toBe("2025");
    expect(root.textContent).toContain(copy.yearsShownLine(10, 14));
  });

  it("announces its result politely, once, without a name", async () => {
    await renderSettled(view, withChats(crafted()));
    expect(said).toEqual([copy.summaryAnnounce(40, 4)]);
    expect(said[0]?.length).toBeLessThanOrEqual(140);
    expect(said[0]).not.toContain("zqcanary");
  });

  it("recomputes for another time zone, repaints only the result and keeps the controls", async () => {
    const r = await renderSettled(view, withChats(many(30, Date.UTC(2026, 2, 2, 23))));
    const [zone, year] = r.root.querySelectorAll("select") as [FakeElement, FakeElement];
    expect(zone.getAttribute("id")).toBe("calendar-zone");
    expect(year.getAttribute("id")).toBe("calendar-year");
    const options = zone.querySelectorAll("option");
    expect(options).toHaveLength(OFFSETS.length);
    expect(options.find((o) => o.getAttribute("selected") !== null)?.textContent).toBe("UTC");
    expect(options.map((o) => o.textContent)).toEqual(expect.arrayContaining(["UTC-5:00", "UTC+5:30", "UTC+5:45"]));
    expect(r.root.querySelector("label[for=calendar-zone]")?.textContent).toBe(copy.zoneLabel);
    const runs = (): string[][] => rowsOf(r.root.querySelectorAll("table")[1] as FakeElement);
    expect(runs()[0]).toEqual([copy.activeRunRow, "1 day", "From Mar 2, 2026", "To Mar 2, 2026"]);
    const facts = (): string[] => [...r.root.querySelectorAll(".fact")].map((f) => `${phrase(f.querySelector("dt") as FakeElement)}: ${phrase(f.querySelector("dd") as FakeElement)}`);
    expect(facts()).toEqual(expect.arrayContaining([`${copy.firstLabel}: Mar 2, 2026`, `${copy.lastLabel}: Mar 2, 2026`]));

    zone.value = "180";
    zone.fire("change");
    expect(r.root.querySelector(".tool-result")?.getAttribute("aria-busy")).toBe("true");
    await settled(r.root);
    expect(r.root.querySelectorAll("select")[0]).toBe(zone);
    expect(runs()[0]).toEqual([copy.activeRunRow, "1 day", "From Mar 3, 2026", "To Mar 3, 2026"]);
    expect(facts()).toEqual(expect.arrayContaining([`${copy.firstLabel}: Mar 3, 2026`, `${copy.lastLabel}: Mar 3, 2026`]));
    expect(said).toHaveLength(2);
  });

  it("picks the year from the years the export holds, and keeps the choice when the time zone changes", async () => {
    const chats = [...many(30, Date.UTC(2025, 5, 1, 12)), ...many(30, Date.UTC(2026, 1, 1, 12))];
    const r = await renderSettled(view, withChats(chats));
    const year = r.root.querySelector("#calendar-year") as FakeElement;
    expect(year.querySelectorAll("option").map((o) => o.textContent)).toEqual([copy.latestOption, "2026", "2025"]);
    expect(year.querySelectorAll("option").find((o) => o.getAttribute("selected") !== null)?.textContent).toBe(copy.latestOption);
    expect(headings(r.root)).toContain("Year 2026");

    year.value = "2025";
    year.fire("change");
    await settled(r.root);
    expect(headings(r.root)).toContain("Year 2025");
    expect(headings(r.root)).not.toContain("Year 2026");
    expect(r.root.querySelector("#calendar-year")).toBe(year);

    const zone = r.root.querySelector("#calendar-zone") as FakeElement;
    zone.value = "60";
    zone.fire("change");
    await settled(r.root);
    expect(headings(r.root)).toContain("Year 2025");

    year.value = "";
    year.fire("change");
    await settled(r.root);
    expect(headings(r.root)).toContain("Year 2026");
  });

  it("shows the honest empty result when no chat has a usable date", async () => {
    const { root } = await renderSettled(view, withChats([chat(0), chat(0, "IMAGE")]));
    expect(root.querySelector(".empty-title")?.textContent).toBe(copy.empty.title);
    expect(root.querySelector(".empty-body")?.textContent).toBe(copy.empty.body);
    expect(root.querySelectorAll("table")).toHaveLength(0);
    expect(root.querySelectorAll(".cal-grid")).toHaveLength(0);
    expect(said).toEqual([copy.emptyAnnounce]);
  });

  it("says what is missing when the export holds no chat history, and when nothing is loaded", async () => {
    const noChats = render(view, withChats([]));
    expect(noChats.root.querySelector(".empty-title")?.textContent).toBe(tools.needs.chatsTitle);
    expect(noChats.root.querySelector(".empty a")?.getAttribute("href")).toBe("#/tools/export-check");
    expect(noChats.root.querySelector(".tool-result")).toBeNull();
    const nothing = render(view, emptyState());
    expect(nothing.root.querySelector(".empty-title")?.textContent).toBe(tools.needs.exportTitle);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(said).toEqual([]);
    expect(nothing.root.querySelector(".command code")?.textContent).toBe(displayText(COMMANDS["calendar" as keyof typeof COMMANDS]));
  });

  it("writes hedged notes: few events, an unsorted kind and left-out dates", async () => {
    const { root } = await renderSettled(view, withChats([...many(10, MON_MAR_2, "MEDIA"), ...many(5, TUE_MAR_10, "MEDIA"), chat(NOW + DAY), chat(0)]));
    const notes = cells(root, ".tool-notes li");
    expect(notes).toEqual(expect.arrayContaining([copy.fewNote(15), copy.otherKindNote(100), copy.futureNote(1), copy.undatedNote(1)]));
    expect(root.querySelectorAll(".tool-note-warning").length).toBeGreaterThanOrEqual(2);
    expect(notes.join(" ")).toMatch(/may/);
  });

  it("says an empty year is empty, with no grid, months or year runs for it", async () => {
    // A year the list offers at its edge can be empty in the chosen time zone.
    const chats = many(30, Date.UTC(2025, 0, 1, 2));
    const r = await renderSettled(view, withChats(chats));
    const zone = r.root.querySelector("#calendar-zone") as FakeElement;
    const year = r.root.querySelector("#calendar-year") as FakeElement;
    expect(year.querySelectorAll("option").map((o) => o.textContent)).toEqual([copy.latestOption, "2025", "2024"]);
    zone.value = "-300";
    zone.fire("change");
    await settled(r.root);
    // The latest year is now 2024 (Dec 31 in UTC-5), and the page follows it.
    expect(headings(r.root)).toContain("Year 2024");
    year.value = "2025";
    year.fire("change");
    await settled(r.root);
    expect(cells(r.root, ".tool-notes li")).toContain(copy.yearEmptyNote(2025));
    expect(r.root.querySelectorAll(".cal-grid")).toHaveLength(0);
    expect(r.root.querySelectorAll("table")).toHaveLength(4);
    expect(rowsOf(r.root.querySelectorAll("table")[0] as FakeElement)).toEqual([[copy.countedRow, "0 counted"], [copy.activeDaysRow, "0 days"]]);
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
    const states: State[] = [withChats(crafted()), withChats(many(10, MON_MAR_2, "MEDIA")), withChats([chat(0)])];
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
    for (const el of root.descendants()) for (const attr of ["aria-label", "title", "alt"]) for (const name of names) expect(el.getAttribute(attr) ?? "", name).not.toContain(name);
    for (const line of said) for (const name of names) expect(line, name).not.toContain(name);
  });
});

describe("the copy", () => {
  it("passes the copy lint: sentence case, US English, quotes, punctuation and lengths", () => {
    const entries = collectCopy({ tool_activity_calendar: copy });
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

  it("never takes a name: its functions take counts, years, dates and minutes", () => {
    expect(copy.undatedNote(2)).toBe("2 chats and Snaps have no usable date. Snappy leaves them out.");
    expect(copy.undatedNote(1)).toBe("1 chat or Snap has no usable date. Snappy leaves it out.");
    expect(copy.futureNote(1)).toBe("1 chat or Snap is dated in the future. Snappy leaves it out.");
    expect(copy.fewNote(1)).toBe("Only 1 chat or Snap was counted, so this picture may be weak.");
    expect(copy.unitMonth(2026, 3)).toBe("Mar 2026");
    expect(copy.unitMonth(2026, 13)).toBe("");
    expect(copy.yearHeading(2026)).toBe("Year 2026");
    expect(copy.yearHeading(Number.NaN)).toBe("");
    expect(copy.unitWeek("Mar 2, 2026", 1, false)).toBe("Week of Mar 2, 2026, 1 chat or Snap");
    expect(copy.unitWeek("Mar 2, 2026", 5, true)).toBe("Week of Mar 2, 2026, 5 chats and Snaps (tied)");
    expect(copy.unitDays(1)).toBe("1 day");
    expect(copy.unitDays(6)).toBe("6 days");
    expect(copy.yearsShownLine(1, 14)).toBe("Showing the latest 1 year of 14.");
    expect(copy.otherKindNote(Number.NaN)).toBe("");
    expect(copy.gridFor(2026, 40, 4)).toBe("Daily activity in 2026: 40 chats and Snaps on 4 days. The tables below hold the same counts.");
  });
});

describe("a grid wider than its frame", () => {
  it("starts scrolled to the latest weeks and says it scrolls, and says nothing when it fits", async () => {
    const watchers: (() => void)[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(cb: () => void) {
          watchers.push(cb);
        }
        observe(): void {}
        disconnect(): void {}
      },
    );
    try {
      const r = await renderSettled(view, withChats(many(10, MON_MAR_2, "TEXT", DAY)));
      const scroll = r.root.querySelector(".cal-scroll") as FakeElement & { scrollLeft?: number };
      const hint = r.root.querySelectorAll("p.caption").find((p) => p.textContent === copy.scrollNote) as FakeElement;
      expect(hint.hasAttribute("hidden")).toBe(true);
      const measure = (scrollWidth: number, clientWidth: number): void => {
        Object.defineProperty(scroll, "scrollWidth", { value: scrollWidth, configurable: true });
        Object.defineProperty(scroll, "clientWidth", { value: clientWidth, configurable: true });
        for (const cb of watchers) cb();
      };
      // Not laid out yet: nothing happens.
      measure(890, 0);
      expect(scroll.scrollLeft ?? 0).toBe(0);
      expect(hint.hasAttribute("hidden")).toBe(true);
      measure(890, 574);
      expect(scroll.scrollLeft).toBe(890);
      expect(hint.hasAttribute("hidden")).toBe(false);
      // The person scrolls back to January; a later resize does not pull the grid away again.
      scroll.scrollLeft = 0;
      measure(890, 560);
      expect(scroll.scrollLeft).toBe(0);
      measure(574, 574);
      expect(hint.hasAttribute("hidden")).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
