/**
 * Memories on this day: what it computes from the dates of the Memories list, and what its page shows. Synthetic data only.
 * Memory ids and usernames carry canaries that must never reach a result, a note, an announcement or the page.
 */
import type { MemoryItem, ParsedExport } from "@snappy-export/core";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAnalysisCache } from "../../src/analysis.ts";
import { tools } from "../../src/copy.ts";
import { initialState } from "../../src/reducer.ts";
import type { State, Workspace } from "../../src/reducer.ts";
import { COMMANDS, displayText } from "../../src/terminal/commands.ts";
import { toolData } from "../../src/tools/data.ts";
import { copy } from "../../src/tools/memories-on-this-day/copy.ts";
import { descriptor } from "../../src/tools/memories-on-this-day/index.ts";
import { computeMemoriesOnThisDay, DEFAULT_PARAMS } from "../../src/tools/memories-on-this-day/model.ts";
import { view } from "../../src/tools/memories-on-this-day/view.ts";
import { forgetPreferredOffset, offsetLabel, rememberOffset } from "../../src/tools/timezone.ts";
import { RULES, collectCopy, lint } from "../copy-rules.ts";
import type { FakeElement } from "../fake-dom.ts";
import { render, renderSettled, sampleState, sampleWorkspace, settled, stateWith } from "./harness.ts";

const said: string[] = [];
vi.mock("../../src/announce.ts", () => ({ announce: (text: string) => void said.push(text) }));

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
  forgetPreferredOffset();
  deviceAt(0);
});
afterEach(() => {
  vi.restoreAllMocks();
  forgetPreferredOffset();
});

/** The reference date of the sample (and of the crafted exports below): Nov 6, 2026, 12:00 UTC. */
const at = (year: number, month: number, day: number, hour = 12): number => Date.UTC(year, month - 1, day, hour);
const memory = (id: string, date: number | null): MemoryItem => ({ id, date, mediaType: "image" });

/** Two on Nov 6, 2025, one on Nov 6, 2023, one on Nov 8, 2024, two on Mar 1, 2022, one undated, one in the future, one repeated id. */
const MEMORIES: MemoryItem[] = [
  memory("ZQCANARY-a", at(2025, 11, 6)),
  memory("ZQCANARY-b", at(2025, 11, 6)),
  memory("ZQCANARY-c", at(2023, 11, 6)),
  memory("ZQCANARY-d", at(2024, 11, 8)),
  memory("ZQCANARY-e", at(2022, 3, 1)),
  memory("ZQCANARY-f", at(2022, 3, 1)),
  memory("ZQCANARY-g", null),
  memory("ZQCANARY-h", at(2027, 1, 1)),
  memory("ZQCANARY-a", at(2020, 1, 1)),
];

/** A real (not sample) export made from the sample's, with the given Memories. */
function real(memories: MemoryItem[] = MEMORIES, ws: Partial<Workspace> = {}): State {
  const latest = { ...(base.latest as ParsedExport), memories };
  return stateWith({ latest, now: at(2026, 11, 6), issues: [], parts: 1, ...ws });
}
const dataOf = (state: State) => toolData(state);
const compute = (params: Partial<typeof DEFAULT_PARAMS> = {}, state: State = real()) => computeMemoriesOnThisDay(dataOf(state), { ...DEFAULT_PARAMS, ...params });

describe("the tool", () => {
  it("is a Memories tool in the Memories color that needs a Memories list and shows the on-this-day command", () => {
    expect(descriptor).toMatchObject({ id: "memories-on-this-day", title: "Memories on this day", group: "memories", category: "memories", needs: ["memories"] });
    expect(descriptor.oneLiner).toBe(copy.oneLiner);
    expect(COMMANDS["on-this-day"].argv[0]).toBe("on-this-day");
  });
});

describe("computeMemoriesOnThisDay", () => {
  it("finds the same day in earlier years, newest first, with today taken from the page's own date", () => {
    const r = compute();
    expect(r.isToday).toBe(true);
    expect(r.target).toEqual({ year: 2026, month: 11, day: 6 });
    expect(r.years).toEqual([
      { year: 2025, yearsAgo: 1, count: 2 },
      { year: 2023, yearsAgo: 3, count: 1 },
    ]);
    expect(r.total).toBe(3);
    expect(r.windowDays).toBe(0);
  });

  it("counts what it used and what it left out", () => {
    const { counts, firstYear, lastYear } = compute();
    expect(counts).toMatchObject({ dated: 6, undated: 1, future: 1, duplicateIds: 1 });
    expect([firstYear, lastYear]).toEqual([2022, 2025]);
  });

  it("looks at the days either side when asked", () => {
    const r = compute({ windowDays: 3 });
    expect(r.windowDays).toBe(3);
    expect(r.years.map((y) => [y.year, y.count])).toEqual([
      [2025, 2],
      [2024, 1],
      [2023, 1],
    ]);
    expect(r.total).toBe(4);
  });

  it("takes a chosen day instead of today, and ignores text that is not a date", () => {
    const march = compute({ date: "2026-03-01" });
    expect(march.isToday).toBe(false);
    expect(march.target).toEqual({ year: 2026, month: 3, day: 1 });
    expect(march.years).toEqual([{ year: 2022, yearsAgo: 4, count: 2 }]);
    expect(compute({ date: "yesterday" }).isToday).toBe(true);
  });

  it("moves a Memory to the next day under an offset, and moves today with it", () => {
    const late = real([memory("ZQCANARY-late", at(2025, 11, 6, 20))]);
    expect(compute({}, late).total).toBe(1);
    const east = compute({ offsetMinutes: 720 }, late);
    expect(east.utcOffsetMinutes).toBe(720);
    // Under +12:00 it is already Nov 7, and the Memory fell on Nov 7, 2025 (08:00 the next morning).
    expect(east.target).toEqual({ year: 2026, month: 11, day: 7 });
    expect(east.total).toBe(1);
    expect(compute({ offsetMinutes: 720, date: "2026-11-06" }, late).total).toBe(0);
  });

  it("lists every year with Memories newest first, and the busiest month of each", () => {
    const { byYear } = compute();
    expect(byYear.map((y) => [y.year, y.total, y.busiestMonth, y.busiestCount])).toEqual([
      [2025, 2, 11, 2],
      [2024, 1, 11, 1],
      [2023, 1, 11, 1],
      [2022, 2, 3, 2],
    ]);
  });

  it("lists the days of the year that come up most, busiest first and in calendar order for ties", () => {
    const { topDays } = compute();
    expect(topDays).toEqual([
      { month: 11, day: 6, count: 3, years: 2 },
      { month: 3, day: 1, count: 2, years: 1 },
      { month: 11, day: 8, count: 1, years: 1 },
    ]);
  });

  it("hands on core's notes by code, and flags a day that does not exist", () => {
    expect(compute().notes.map((n) => n.code)).toEqual(expect.arrayContaining(["undated-items", "future-dates-skipped", "duplicate-ids-skipped"]));
    const bad = compute({ date: "2026-02-30" });
    expect(bad.notes.map((n) => n.code)).toContain("invalid-target");
    expect(bad.total).toBe(0);
    expect(compute({ offsetMinutes: 99_999 }).notes.map((n) => n.code)).toContain("offset-invalid");
  });

  it("works on the sample, and says nothing about a Memory but its date", () => {
    const r = computeMemoriesOnThisDay(dataOf(sample));
    expect(r.counts.dated).toBeGreaterThan(0);
    expect(r.byYear.length).toBeGreaterThan(0);
    const json = JSON.stringify(compute());
    expect(json).not.toContain("ZQCANARY");
    expect(json).not.toMatch(/https?:|\.jpg|\.mp4|memories\//i);
  });

  it("gives empty lists when no Memory has a date", () => {
    const r = compute({}, real([memory("ZQCANARY-x", null)]));
    expect(r.counts).toMatchObject({ dated: 0, undated: 1 });
    expect(r).toMatchObject({ total: 0, years: [], byYear: [], topDays: [], firstYear: null, lastYear: null });
  });

  it("refuses to run without an export (the page never calls it that way)", () => {
    expect(() => computeMemoriesOnThisDay(dataOf(initialState()))).toThrow();
  });
});

const text = (el: FakeElement, selector: string): string[] => el.querySelectorAll(selector).map((e) => e.textContent);
/** What a screen reader hears: a cell that shows a bare value keeps its full phrase in a hidden span, and that phrase is read here. */
const phrases = (el: FakeElement, selector: string): string[] => el.querySelectorAll(selector).map((e) => e.querySelector(".cell-long")?.textContent ?? e.textContent);
const tableRows = (table: FakeElement): string[][] => table.querySelectorAll("tbody tr").map((r) => [...phrases(r, "th"), ...phrases(r, "td")]);

describe("the page", () => {
  it("shows the day, the years it came up, the years and the busiest days as tables, then notes and the command", async () => {
    const { root } = await renderSettled(view, real());
    expect(root.querySelectorAll(".section-title").map((t) => t.textContent)).toEqual([copy.dayHeading, copy.yearsHeading, copy.topDaysHeading, tools.notesHeading, tools.commandHeading]);
    expect(root.textContent).toContain(copy.lookingLine("Nov 6, 2026", true, 0));
    expect(root.textContent).toContain(copy.foundLine(3, 2, false));

    const [day, years, top] = root.querySelectorAll("table") as [FakeElement, FakeElement, FakeElement];
    expect(day.querySelector("caption")?.textContent).toBe(copy.dayCaption);
    expect(text(day, "thead th")).toEqual([copy.yearHeader, copy.whenHeader, copy.memoriesHeader]);
    expect(tableRows(day)).toEqual([
      ["2025", "1 year ago", "2 Memories"],
      ["2023", "3 years ago", "1 Memory"],
    ]);
    expect(text(years, "thead th")).toEqual([copy.yearHeader, copy.memoriesHeader, copy.busiestHeader]);
    expect(tableRows(years)).toEqual([
      ["2025", "2 Memories", "Nov busiest (2)"],
      ["2024", "1 Memory", "Nov busiest (1)"],
      ["2023", "1 Memory", "Nov busiest (1)"],
      ["2022", "2 Memories", "Mar busiest (2)"],
    ]);
    expect(text(top, "thead th")).toEqual([copy.dayHeader, copy.memoriesHeader, copy.yearsHeader]);
    expect(tableRows(top)).toEqual([
      ["Nov 6", "3 Memories", "2 years"],
      ["Mar 1", "2 Memories", "1 year"],
      ["Nov 8", "1 Memory", "1 year"],
    ]);
    // The counts in a list of facts: dated, the years they span and what was left out.
    expect(text(root, ".fact dd")).toEqual(["6", "2022 to 2025", "2"]);

    expect(root.querySelector(".command code")?.textContent).toBe(displayText(COMMANDS["on-this-day"]));
    expect(root.querySelectorAll("table")).toHaveLength(3);
  });

  it("is in the Memories color", async () => {
    const { root } = await renderSettled(view, real());
    expect(root.classList.contains("cat-memories")).toBe(true);
  });

  it("writes each note as a short sentence with its count, and says which offset the dates use", async () => {
    const { root } = await renderSettled(view, real());
    const notes = text(root, ".tool-notes li");
    expect(notes).toEqual(expect.arrayContaining([copy.offsetNote("UTC"), copy.undatedNote(1), copy.futureNote(1), copy.duplicateNote(1)]));
    for (const n of notes) expect(n).not.toMatch(/[a-z]+-[a-z]+-[a-z]+/);
  });

  it("announces how many Memories it found, politely and once", async () => {
    await renderSettled(view, real());
    expect(said).toEqual([copy.foundAnnounce(3, false)]);
    expect(said[0]).toBe("3 Memories found from this day in earlier years.");
  });

  it("says plainly when no Memory is from this day, and still shows the years and the busiest days", async () => {
    const { root } = await renderSettled(view, real([memory("ZQCANARY-z", at(2024, 5, 20)), memory("ZQCANARY-y", at(2026, 11, 6, 8))]));
    expect(root.textContent).toContain(copy.noneLine(false));
    expect(root.querySelectorAll("table")).toHaveLength(2);
    expect(root.querySelectorAll(".section-title").map((t) => t.textContent)).toContain(copy.yearsHeading);
    expect(said).toEqual([copy.noneAnnounce(false)]);
  });

  it("shows its own empty state when no Memory has a usable date", async () => {
    const { root } = await renderSettled(view, real([memory("ZQCANARY-x", null)]));
    expect(text(root, ".empty-title")).toEqual([copy.empty.title]);
    expect(text(root, ".empty-body")).toEqual([copy.empty.body]);
    expect(root.querySelectorAll("table")).toHaveLength(0);
    expect(said).toEqual([copy.emptyAnnounce]);
  });

  it("downloads nothing: the page has a command, not a file", async () => {
    const { root } = await renderSettled(view, real());
    expect(root.querySelectorAll(".section-title").map((t) => t.textContent)).not.toContain(tools.downloadHeading);
    expect(root.querySelector("[data-key=tool-download]")).toBeNull();
  });
});

describe("the controls", () => {
  it("offers a day, the days either side and a time zone, labeled, with today and the device's zone as the start", async () => {
    const { root } = await renderSettled(view, real());
    expect(text(root, "label.label")).toEqual([copy.dateLabel, copy.windowLabel, "Time zone"]);
    expect(copy.zoneLabel).toBe("Time zone");
    const date = root.querySelector("#otd-date") as FakeElement;
    expect(date.getAttribute("type")).toBe("date");
    expect(date.getAttribute("aria-describedby")).toBe("otd-date-help");
    expect(root.querySelector("#otd-date-help")?.textContent).toBe(copy.dateHelpNote);
    expect(text(root.querySelector("#otd-window") as FakeElement, "option")).toEqual(["None", "1 day", "3 days", "7 days"]);
    const offsets = text(root.querySelector("#otd-offset") as FakeElement, "option");
    expect(offsets).toEqual(expect.arrayContaining(["UTC", "UTC-5:00", "UTC+1:00", "UTC+5:30", "UTC-12:00", "UTC+14:00"]));
    expect(root.querySelector("#otd-window option[selected]")?.textContent).toBe("None");
    expect(root.querySelector("#otd-offset option[selected]")?.textContent).toBe("UTC");
  });

  it("recomputes for a chosen day and repaints only the result, so the controls keep their place", async () => {
    const r = await renderSettled(view, real());
    const date = r.root.querySelector("#otd-date") as FakeElement;
    date.value = "2026-03-01";
    date.fire("input");
    await settled(r.root);
    expect(r.root.querySelector("#otd-date")).toBe(date);
    expect(r.root.textContent).toContain(copy.lookingLine("Mar 1, 2026", false, 0));
    expect(tableRows(r.root.querySelectorAll("table")[0] as FakeElement)).toEqual([["2022", "4 years ago", "2 Memories"]]);
    // A wide page shows the bare value its column names ("2"); the phrase is for assistive technology and a phone's card.
    const short = (r.root.querySelectorAll("table")[0] as FakeElement).querySelectorAll("tbody td").map((td) => td.querySelector(".cell-short")?.textContent);
    expect(short).toEqual([undefined, "2"]);
    expect(said.at(-1)).toBe(copy.foundAnnounce(2, false));
    // Clearing the field goes back to today.
    date.value = "";
    date.fire("input");
    await settled(r.root);
    expect(r.root.textContent).toContain(copy.lookingLine("Nov 6, 2026", true, 0));
  });

  it("refuses a year the calendar helpers would fold into the 1900s, without a Looking at line", async () => {
    const r = await renderSettled(view, real());
    const date = r.root.querySelector("#otd-date") as FakeElement;
    for (const day of ["0001-01-01", "0099-12-31", "9999-12-31"]) {
      date.value = day;
      date.fire("input");
      await settled(r.root);
      expect(r.root.textContent).toContain(copy.invalidDayNote);
      expect(r.root.textContent).not.toContain("Looking at");
      expect(r.root.textContent).not.toContain("1901");
      expect(r.root.textContent).toContain(copy.invalidLine);
      expect(r.root.textContent).not.toContain(copy.noneLine(false));
      expect(said.at(-1)).toBe(copy.invalidAnnounce);
    }
  });

  it("recomputes for the days either side and says it looked around the day", async () => {
    const r = await renderSettled(view, real());
    const window = r.root.querySelector("#otd-window") as FakeElement;
    window.value = "3";
    window.fire("change");
    await settled(r.root);
    expect(r.root.textContent).toContain(copy.lookingLine("Nov 6, 2026", true, 3));
    expect(r.root.textContent).toContain(copy.foundLine(4, 3, true));
    expect(tableRows(r.root.querySelectorAll("table")[0] as FakeElement).map((row) => row[0])).toEqual(["2025", "2024", "2023"]);
    expect(said.at(-1)).toBe(copy.foundAnnounce(4, true));
  });

  it("starts in the zone the device is in, so an evening capture in the Americas is on its own day", async () => {
    deviceAt(-300);
    const late = real([memory("ZQCANARY-late", at(2025, 11, 7, 2))]);
    const r = await renderSettled(view, late);
    expect(r.root.querySelector("#otd-offset option[selected]")?.textContent).toBe("UTC-5:00");
    expect(text(r.root, ".tool-notes li")).toContain(copy.offsetNote("UTC-5:00"));
    // 02:00 UTC on Nov 7 is 9 pm on Nov 6 in New York: today's date there is Nov 6, and the Memory is found on it.
    expect(r.root.textContent).toContain(copy.foundLine(1, 1, false));
    // A zone picked on the page is kept for that page only: the next visit starts at the device's zone again.
    const offset = r.root.querySelector("#otd-offset") as FakeElement;
    offset.value = "330";
    offset.fire("change");
    await settled(r.root);
    expect(text(r.root, ".tool-notes li")).toContain(copy.offsetNote("UTC+5:30"));
    const again = await renderSettled(view, late);
    expect(again.root.querySelector("#otd-offset option[selected]")?.textContent).toBe("UTC-5:00");
  });

  it("starts in the zone chosen in Settings when there is one, and in UTC when the device's zone is not offered", async () => {
    rememberOffset(60);
    expect((await renderSettled(view, real())).root.querySelector("#otd-offset option[selected]")?.textContent).toBe("UTC+1:00");
    forgetPreferredOffset();
    deviceAt(100);
    expect((await renderSettled(view, real())).root.querySelector("#otd-offset option[selected]")?.textContent).toBe("UTC");
  });

  it("recomputes for a UTC offset and names it in a note", async () => {
    const r = await renderSettled(view, real([memory("ZQCANARY-late", at(2025, 11, 6, 20))]));
    expect(r.root.textContent).toContain(copy.foundLine(1, 1, false));
    const offset = r.root.querySelector("#otd-offset") as FakeElement;
    offset.value = "330";
    offset.fire("change");
    await settled(r.root);
    expect(text(r.root, ".tool-notes li")).toContain(copy.offsetNote("UTC+5:30"));
    expect(r.root.textContent).toContain(copy.lookingLine("Nov 6, 2026", true, 0));
  });
});

describe("without what it needs", () => {
  it("says so plainly without an export, and still offers the command", () => {
    const { root } = render(view, initialState());
    expect(text(root, ".empty-title")).toEqual([tools.needs.exportTitle]);
    expect(root.querySelector(".command code")?.textContent).toBe(displayText(COMMANDS["on-this-day"]));
    expect(root.querySelector(".tool-result")).toBeNull();
  });

  it("says the export has no Memories list when it has none", async () => {
    const { root } = render(view, real([]));
    expect(text(root, ".empty-title")).toEqual([tools.needs.memoriesTitle]);
    expect(text(root, ".empty-body")).toEqual([tools.needs.memoriesBody]);
    expect(root.querySelector(".tool-result")).toBeNull();
    await settled(root);
  });

  it("works on the sample", async () => {
    const { root } = await renderSettled(view, sample);
    expect(root.querySelector(".tool-failed")).toBeNull();
    expect(root.querySelectorAll("table").length).toBeGreaterThanOrEqual(2);
    expect(said).toHaveLength(1);
  });
});

describe("privacy", () => {
  it("shows no username, Memory id or link anywhere, and names no one in a note or an announcement", async () => {
    const parsed = base.latest as ParsedExport;
    const names = [...new Set([...parsed.friends.friends.map((f) => f.username), ...parsed.chats.slice(0, 200).map((c) => c.conversation)])].filter((n) => n.length >= 5);
    for (const state of [real(), sample]) {
      said.length = 0;
      const { root } = await renderSettled(view, state);
      const page = root.textContent;
      const labels = root.descendants().map((el) => ["aria-label", "title", "alt"].map((a) => el.getAttribute(a) ?? "").join(" ")).join(" ");
      const notes = text(root, ".tool-notes li").join(" ");
      for (const name of names) {
        expect(page, name).not.toContain(name);
        expect(labels, name).not.toContain(name);
        expect(notes, name).not.toContain(name);
        expect(said.join(" "), name).not.toContain(name);
      }
      expect(page).not.toContain("ZQCANARY");
      expect(said.join(" ")).not.toContain("ZQCANARY");
      expect(root.querySelectorAll("code.username")).toHaveLength(0);
      expect(root.querySelectorAll("a").filter((a) => (a.getAttribute("href") ?? "").startsWith("http"))).toHaveLength(0);
    }
  });

  it("reads only dates: a Memory's link and file path never reach the result", () => {
    const withLinks = MEMORIES.map((m) => ({ ...m, downloadUrl: "https://example.test/ZQCANARY-link", zipPath: "memories/ZQCANARY-file.jpg" }));
    const json = JSON.stringify(compute({}, real(withLinks)));
    expect(json).not.toContain("ZQCANARY");
    expect(json).not.toContain("example.test");
  });
});

describe("its words", () => {
  it("pass the copy lint, with the strings its functions give for sample numbers", () => {
    const entries = collectCopy({ tool_memories_on_this_day: copy });
    expect(entries.length).toBeGreaterThan(20);
    expect(RULES.flatMap((rule) => lint(entries, rule))).toEqual([]);
  });

  it("takes only counts, a formatted date and flags, never a name, and has no exclamation mark", () => {
    // A copy function has at most three parameters, and each one is a number, a date text or a flag (see its signature).
    for (const value of Object.values(copy)) if (typeof value === "function") expect(value.length).toBeLessThanOrEqual(3);
    expect(collectCopy({ copy }).map((e) => e.text).join(" ")).not.toMatch(/!/);
  });

  it("names the zones as UTC+2:00 everywhere, and the windows the way the command does", () => {
    expect([0, -300, 330, 345, 840].map(offsetLabel)).toEqual(["UTC", "UTC-5:00", "UTC+5:30", "UTC+5:45", "UTC+14:00"]);
    expect([0, 1, 7].map(copy.unitWindow)).toEqual(["None", "1 day", "7 days"]);
    expect(copy.unitAgo(0)).toBe("Same year");
  });
});
