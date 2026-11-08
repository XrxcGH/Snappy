/**
 * Memories timeline gaps: what it computes from the dates of the Memories list (and the oldest friend date), and what its
 * page shows. Synthetic data only. Memory ids and usernames carry canaries that must never reach a result, a note, an
 * announcement or the page.
 */
import type { ExportIssue, MemoryItem, ParsedExport } from "@snappy-export/core";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAnalysisCache } from "../../src/analysis.ts";
import { tools } from "../../src/copy.ts";
import { initialState } from "../../src/reducer.ts";
import type { State, Workspace } from "../../src/reducer.ts";
import { COMMANDS, displayText } from "../../src/terminal/commands.ts";
import { toolData } from "../../src/tools/data.ts";
import { copy } from "../../src/tools/memories-gaps/copy.ts";
import { descriptor } from "../../src/tools/memories-gaps/index.ts";
import { DEFAULT_PARAMS, computeMemoriesGaps, oldestFriendDate } from "../../src/tools/memories-gaps/model.ts";
import { forgetPreferredOffset } from "../../src/tools/timezone.ts";
import { dropChosenZone, view } from "../../src/tools/memories-gaps/view.ts";
import { RULES, collectCopy, lint } from "../copy-rules.ts";
import type { FakeElement } from "../fake-dom.ts";
import { phrase } from "./cell-text.ts";
import { render, renderSettled, sampleState, sampleWorkspace, settled, stateWith } from "./harness.ts";

const said: string[] = [];
vi.mock("../../src/announce.ts", () => ({ announce: (text: string) => void said.push(text) }));

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
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** The reference date of the crafted exports below: Nov 6, 2026, 12:00 UTC. */
const at = (year: number, month: number, day = 15, hour = 12): number => Date.UTC(year, month - 1, day, hour);
const memory = (id: string, date: number | null): MemoryItem => ({ id, date, mediaType: "image" });

/**
 * Two in Jan 2022, none in Feb to Apr (a gap of 3), one in May, three in Jun, none in Jul, one in Aug, then nothing until now
 * (a late gap of 50). One undated, one in the future and one repeated id.
 */
const MEMORIES: MemoryItem[] = [
  memory("ZQCANARY-a", at(2022, 1, 15)),
  memory("ZQCANARY-b", at(2022, 1, 20)),
  memory("ZQCANARY-c", at(2022, 5, 10)),
  memory("ZQCANARY-d", at(2022, 6, 5)),
  memory("ZQCANARY-e", at(2022, 6, 6)),
  memory("ZQCANARY-f", at(2022, 6, 7)),
  memory("ZQCANARY-g", at(2022, 8, 2)),
  memory("ZQCANARY-h", null),
  memory("ZQCANARY-i", at(2030, 1, 1)),
  memory("ZQCANARY-a", at(2020, 1, 1)),
];

const friend = (username: string, createdAt?: number) => ({ username, ...(createdAt === undefined ? {} : { createdAt }) });
/** The oldest friend date is Jun 10, 2021, so Jul to Dec 2021 is an early gap of 6. */
const FRIENDS = [friend("zqpal_old", at(2021, 6, 10)), friend("zqpal_new", at(2023, 2, 3)), friend("zqpal_nodate")];

const issue = (code: string): ExportIssue => ({ severity: "warning", code, message: "A check." });

/** A real (not sample) export made from the sample's, with the given Memories and friends. */
function real(memories: MemoryItem[] = MEMORIES, extra: Partial<ParsedExport> = {}, ws: Partial<Workspace> = {}): State {
  const parsed = base.latest as ParsedExport;
  const latest: ParsedExport = { ...parsed, memories, friends: { ...parsed.friends, friends: FRIENDS }, exportedAt: undefined, ...extra };
  return stateWith({ latest, now: at(2026, 11, 6), issues: [], parts: 1, ...ws });
}
const dataOf = (state: State) => toolData(state);
const compute = (params: Partial<typeof DEFAULT_PARAMS> = {}, state: State = real()) => computeMemoriesGaps(dataOf(state), { ...DEFAULT_PARAMS, ...params });

describe("the tool", () => {
  it("is a Memories tool in the Memories color that needs a Memories list and shows the gaps command", () => {
    expect(descriptor).toMatchObject({ id: "memories-gaps", title: "Memories timeline gaps", group: "memories", category: "memories", needs: ["memories"] });
    expect(descriptor.oneLiner).toBe(copy.oneLiner);
    expect(COMMANDS.gaps.argv[0]).toBe("gaps");
  });
});

describe("computeMemoriesGaps", () => {
  it("finds the early, middle and late gaps in date order", () => {
    const r = compute();
    expect(r.gaps.map((g) => [g.kind, g.from, g.to, g.months, g.exportHint])).toEqual([
      ["start", { year: 2021, month: 7 }, { year: 2021, month: 12 }, 6, false],
      ["middle", { year: 2022, month: 2 }, { year: 2022, month: 4 }, 3, false],
      ["end", { year: 2022, month: 9 }, { year: 2026, month: 10 }, 50, false],
    ]);
    expect(r.longestGapMonths).toBe(50);
    expect(r.sinceUsed).toBe(true);
  });

  it("counts what it used and what it left out", () => {
    const r = compute();
    expect(r.counts).toEqual({ input: 10, unique: 9, dated: 7, undated: 1, future: 1, duplicateIds: 1 });
    expect(r.range).toEqual({ first: { year: 2022, month: 1 }, last: { year: 2022, month: 8 }, months: 8, activeMonths: 4, emptyMonths: 4 });
    expect(r.notes.map((n) => n.code)).toEqual(["undated-items", "future-dates-skipped", "duplicate-ids-skipped", "gaps-may-be-quiet-time"]);
  });

  it("finds the busiest month and the busiest stretch, the earliest one winning a tie", () => {
    const r = compute();
    expect(r.busiestMonth).toEqual({ year: 2022, month: 6, count: 3 });
    // Apr to Jun, May to Jul and Jun to Aug all hold 4.
    expect(r.busiestStretch).toEqual({ from: { year: 2022, month: 4 }, to: { year: 2022, month: 6 }, months: 3, count: 4, sharePercent: 57 });
    expect(compute({ stretchMonths: 1 }).busiestStretch).toMatchObject({ months: 1, count: 3 });
  });

  it("takes a shorter or longer gap when asked, and says when a setting was changed", () => {
    expect(compute({ minGapMonths: 4 }).gaps.map((g) => g.kind)).toEqual(["start", "end"]);
    expect(compute({ minGapMonths: 1 }).gaps.map((g) => g.months)).toEqual([6, 3, 1, 50]);
    expect(compute({ minGapMonths: 100 }).gaps).toEqual([]);
    expect(compute({ minGapMonths: 100 }).notes.map((n) => n.code)).toContain("no-gaps");
    const adjusted = compute({ minGapMonths: 500, stretchMonths: 99 });
    expect([adjusted.minGapMonths, adjusted.stretchMonths]).toEqual([120, 24]);
    expect(adjusted.notes.map((n) => n.code)).toEqual(expect.arrayContaining(["min-gap-adjusted", "stretch-adjusted"]));
  });

  it("moves a Memory into the next month under an offset", () => {
    const edge = real([memory("ZQCANARY-x", at(2025, 1, 31, 23)), memory("ZQCANARY-y", at(2025, 6, 10))]);
    expect(compute({}, edge).range?.first).toEqual({ year: 2025, month: 1 });
    const east = compute({ offsetMinutes: 120 }, edge);
    expect(east.utcOffsetMinutes).toBe(120);
    expect(east.range?.first).toEqual({ year: 2025, month: 2 });
    expect(compute({ offsetMinutes: 99_999 }, edge).notes.map((n) => n.code)).toContain("offset-invalid");
  });

  it("reports an early gap only when a friend has a usable date", () => {
    const none = real(MEMORIES, { friends: { ...(base.latest as ParsedExport).friends, friends: [friend("zqpal_nodate")] } });
    const r = compute({}, none);
    expect(r.sinceUsed).toBe(false);
    expect(r.gaps.map((g) => g.kind)).toEqual(["middle", "end"]);
    const odd = real(MEMORIES, { friends: { ...(base.latest as ParsedExport).friends, friends: [friend("zqpal_future", at(2030, 1, 1)), friend("zqpal_old", at(1980, 1, 1))] } });
    expect(compute({}, odd).sinceUsed).toBe(false);
  });

  it("finds the oldest usable friend date and ignores missing, future and out-of-range ones", () => {
    const now = at(2026, 11, 6);
    expect(oldestFriendDate([], now)).toBeUndefined();
    expect(oldestFriendDate([{}, { createdAt: Number.NaN }], now)).toBeUndefined();
    expect(oldestFriendDate([{ createdAt: at(2021, 6) }, { createdAt: at(2019, 6) }, { createdAt: at(2024, 6) }], now)).toBe(at(2019, 6));
    expect(oldestFriendDate([{ createdAt: at(1985, 6) }, { createdAt: at(2030, 6) }, { createdAt: at(2020, 6) }], now)).toBe(at(2020, 6));
  });

  it("ends the late gap at the export date when the export is older than the page's date", () => {
    const r = compute({}, real(MEMORIES, { exportedAt: at(2023, 3, 10) }));
    expect(r.gaps.at(-1)).toMatchObject({ kind: "end", from: { year: 2022, month: 9 }, to: { year: 2023, month: 2 }, months: 6 });
    const future = compute({}, real(MEMORIES, { exportedAt: at(2030, 3, 10) }));
    expect(future.gaps.at(-1)?.months).toBe(50);
    expect(future.notes.map((n) => n.code)).toContain("exported-at-future");
  });

  it("marks early and late gaps when the export looks date-limited, from the codes of its health notes alone", () => {
    for (const code of ["possibly-date-limited", "friends-empty-but-deleted", "friend-count-mismatch"]) {
      const r = compute({}, real(MEMORIES, {}, { issues: [issue(code)] }));
      expect(r.gaps.map((g) => g.exportHint), code).toEqual([true, false, true]);
      expect(r.notes.find((n) => n.code === "gap-near-limited-export")?.params).toEqual({ count: 2 });
    }
    expect(compute({}, real(MEMORIES, {}, { issues: [issue("something-else")] })).gaps.some((g) => g.exportHint)).toBe(false);
  });

  it("gives empty results when no Memory has a usable date, and one month when all share it", () => {
    const none = compute({}, real([memory("ZQCANARY-x", null)]));
    expect(none).toMatchObject({ range: null, gaps: [], busiestMonth: null, busiestStretch: null, longestGapMonths: 0 });
    expect(none.notes.map((n) => n.code)).toEqual(["undated-items", "no-dated-items"]);
    const one = compute({}, real([memory("ZQCANARY-x", at(2026, 9, 1)), memory("ZQCANARY-y", at(2026, 9, 20))]));
    expect(one.range?.months).toBe(1);
    expect(one.notes.map((n) => n.code)).toContain("single-month");
  });

  it("works on the sample, and says nothing about a Memory but its date", () => {
    const r = computeMemoriesGaps(dataOf(sample));
    expect(r.counts.dated).toBeGreaterThan(0);
    expect(r.range).not.toBeNull();
    const json = JSON.stringify(compute());
    expect(json).not.toContain("ZQCANARY");
    expect(json).not.toContain("zqpal");
    expect(json).not.toMatch(/https?:|\.jpg|\.mp4|memories\//i);
  });

  it("stays quick on a long list", () => {
    const many = Array.from({ length: 20_000 }, (_, i) => memory(`ZQCANARY-${i}`, at(2015, 1, 1) + i * 3_600_000 * 3));
    const started = Date.now();
    const r = compute({}, real(many));
    expect(r.counts.dated).toBe(20_000);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("refuses to run without an export (the page never calls it that way)", () => {
    expect(() => computeMemoriesGaps(dataOf(initialState()))).toThrow();
  });
});

const text = (el: FakeElement, selector: string): string[] => el.querySelectorAll(selector).map(phrase);
const tableRows = (table: FakeElement): string[][] => table.querySelectorAll("tbody tr").map((r) => [...text(r, "th"), ...text(r, "td")]);

describe("the page", () => {
  it("shows the facts, the gaps and the busiest times, then notes and the command", async () => {
    const { root } = await renderSettled(view, real());
    expect(root.querySelectorAll(".section-title").map((t) => t.textContent)).toEqual([copy.glanceHeading, copy.gapsHeading, copy.busiestHeading, tools.notesHeading, tools.commandHeading]);
    // Dated, months covered, empty months and the longest gap.
    expect(text(root, ".fact dt")).toEqual([copy.datedFact, copy.spanFact, copy.emptyFact, copy.longestFact]);
    expect(text(root, ".fact dd")).toEqual(["7", "8", "4", "50 months"]);

    const [gaps, busiest] = root.querySelectorAll("table") as [FakeElement, FakeElement];
    expect(gaps.querySelector("caption")?.textContent).toBe(copy.gapsCaption);
    expect(text(gaps, "thead th")).toEqual([copy.fromHeader, copy.toHeader, copy.whereHeader, copy.lengthHeader]);
    expect(tableRows(gaps)).toEqual([
      ["Jul 2021", "Dec 2021", "Before first Memory", "6 months"],
      ["Feb 2022", "Apr 2022", "Between Memories", "3 months"],
      ["Sep 2022", "Oct 2026", "Since last Memory", "50 months"],
    ]);
    expect(text(busiest, "thead th")).toEqual([copy.highlightHeader, copy.whenHeader, copy.memoriesHeader, copy.shareHeader]);
    expect(tableRows(busiest)).toEqual([
      ["Busiest month", "Jun 2022", "3 Memories", "43% of dated"],
      ["Busiest 3 months", "Apr 2022 to Jun 2022", "4 Memories", "57% of dated"],
    ]);
    expect(root.querySelector(".command code")?.textContent).toBe(displayText(COMMANDS.gaps));
    expect(root.querySelectorAll("table")).toHaveLength(2);
  });

  it("is in the Memories color", async () => {
    const { root } = await renderSettled(view, real());
    expect(root.classList.contains("cat-memories")).toBe(true);
  });

  it("writes each note as a short sentence with its count, and says which offset the dates use", async () => {
    const { root } = await renderSettled(view, real());
    const notes = text(root, ".tool-notes li");
    expect(notes).toEqual([
      copy.offsetNote,
      copy.undatedNote(1),
      copy.futureNote(1),
      copy.duplicateNote(1),
      copy.quietNote(3),
      copy.startNote,
    ]);
    expect(notes[4]).toBe("These gaps may be a quiet time. Snappy cannot tell if anything is missing.");
    for (const n of notes) expect(n).not.toMatch(/[a-z]+-[a-z]+-[a-z]+/);
  });

  it("marks a gap near the edge of a date-limited export, with a warning note", async () => {
    const { root } = await renderSettled(view, real(MEMORIES, {}, { issues: [issue("possibly-date-limited")] }));
    const gaps = root.querySelectorAll("table")[0] as FakeElement;
    expect(tableRows(gaps).map((r) => r[2])).toEqual(["Before first Memory, export may be limited", "Between Memories", "Since last Memory, export may be limited"]);
    expect(text(root, ".tool-notes li")).toContain(copy.limitedNote(2));
    expect(root.querySelectorAll(".tool-note-warning").length).toBeGreaterThan(0);
  });

  it("announces how many gaps it found, politely and once", async () => {
    await renderSettled(view, real());
    expect(said).toEqual([copy.foundAnnounce(3)]);
    expect(said[0]).toBe("3 gaps found in your Memories timeline.");
  });

  it("says plainly when there is no gap, and still shows the busiest times without a gap table", async () => {
    // With no friend date there is no early gap, and two neighboring months leave nothing in between.
    const plain = await renderSettled(view, real([memory("ZQCANARY-p", at(2026, 9, 3)), memory("ZQCANARY-q", at(2026, 10, 3))], { friends: { ...(base.latest as ParsedExport).friends, friends: [] } }));
    expect(plain.root.textContent).toContain(copy.noGapsLine(2));
    expect(plain.root.querySelectorAll("table")).toHaveLength(1);
    expect(text(plain.root, ".tool-notes li")).not.toContain(copy.quietNote(1));
    expect(said).toEqual([copy.noneAnnounce(2)]);
  });

  it("shows its own empty state when no Memory has a usable date", async () => {
    const { root } = await renderSettled(view, real([memory("ZQCANARY-x", null)]));
    expect(text(root, ".empty-title")).toEqual([copy.empty.title]);
    expect(text(root, ".empty-body")).toEqual([copy.empty.body]);
    expect(root.querySelectorAll("table")).toHaveLength(0);
    expect(said).toEqual([copy.emptyAnnounce]);
  });

  it("trims a long list of gaps and says how many are shown", async () => {
    // A Memory every other month leaves one empty month between neighbors: 69 of them, and the late gap makes 70.
    const sparse: MemoryItem[] = [];
    for (let i = 0; i < 70; i++) sparse.push(memory(`ZQCANARY-s${i}`, at(1991 + Math.floor(i / 6), 1 + (i % 6) * 2, 10)));
    const r = await renderSettled(view, real(sparse));
    const select = r.root.querySelector("#gaps-min") as FakeElement;
    select.value = "1";
    select.fire("change");
    await settled(r.root);
    expect(tableRows(r.root.querySelectorAll("table")[0] as FakeElement)).toHaveLength(50);
    expect(text(r.root, "p.caption")).toContain(copy.moreLine(50, 70));
    expect(text(r.root, "p.caption")).toContain("Showing the first 50 of 70. Raise the shortest gap to see fewer.");
  });

  it("downloads nothing: the page has a command, not a file", async () => {
    const { root } = await renderSettled(view, real());
    expect(root.querySelectorAll(".section-title").map((t) => t.textContent)).not.toContain(tools.downloadHeading);
    expect(root.querySelector("[data-key=tool-download]")).toBeNull();
  });
});

describe("the controls", () => {
  it("offers the shortest gap, the busiest stretch and a UTC offset, labeled, with 2 months, 3 months and UTC as the start", async () => {
    const { root } = await renderSettled(view, real());
    expect(text(root, "label.label")).toEqual([copy.minGapLabel, copy.stretchLabel, copy.zoneLabel]);
    expect(text(root.querySelector("#gaps-min") as FakeElement, "option")).toEqual(["1 month", "2 months", "3 months", "6 months", "12 months"]);
    expect(text(root.querySelector("#gaps-stretch") as FakeElement, "option")).toEqual(["1 month", "3 months", "6 months", "12 months"]);
    const offsets = text(root.querySelector("#gaps-offset") as FakeElement, "option");
    expect(offsets).toEqual(expect.arrayContaining(["UTC", "UTC-5:00", "UTC+1:00", "UTC+5:30", "UTC-12:00", "UTC+14:00"]));
    expect(root.querySelector("#gaps-min option[selected]")?.textContent).toBe("2 months");
    expect(root.querySelector("#gaps-stretch option[selected]")?.textContent).toBe("3 months");
    expect(root.querySelector("#gaps-offset option[selected]")?.textContent).toBe("UTC");
  });

  it("recomputes for a longer shortest gap and repaints only the result, so the controls keep their place", async () => {
    const r = await renderSettled(view, real());
    const select = r.root.querySelector("#gaps-min") as FakeElement;
    select.value = "6";
    select.fire("change");
    await settled(r.root);
    expect(r.root.querySelector("#gaps-min")).toBe(select);
    expect(tableRows(r.root.querySelectorAll("table")[0] as FakeElement).map((row) => row[2])).toEqual(["Before first Memory", "Since last Memory"]);
    expect(said.at(-1)).toBe(copy.foundAnnounce(2));
    select.value = "12";
    select.fire("change");
    await settled(r.root);
    expect(tableRows(r.root.querySelectorAll("table")[0] as FakeElement).map((row) => row[2])).toEqual(["Since last Memory"]);
    expect(said.at(-1)).toBe(copy.foundAnnounce(1));
    expect(said.at(-1)).toBe("1 gap found in your Memories timeline.");
  });

  it("recomputes for a busiest stretch and lists a one-month stretch only once", async () => {
    const r = await renderSettled(view, real());
    const select = r.root.querySelector("#gaps-stretch") as FakeElement;
    select.value = "6";
    select.fire("change");
    await settled(r.root);
    expect(tableRows(r.root.querySelectorAll("table")[1] as FakeElement)[1]).toEqual(["Busiest 6 months", "Jan 2022 to Jun 2022", "6 Memories", "86% of dated"]);
    select.value = "1";
    select.fire("change");
    await settled(r.root);
    expect(tableRows(r.root.querySelectorAll("table")[1] as FakeElement)).toEqual([["Busiest month", "Jun 2022", "3 Memories", "43% of dated"]]);
  });

  it("recomputes for a UTC offset and names it in a note", async () => {
    const r = await renderSettled(view, real([memory("ZQCANARY-late", at(2025, 1, 31, 23)), memory("ZQCANARY-next", at(2025, 6, 10))]));
    const offset = r.root.querySelector("#gaps-offset") as FakeElement;
    offset.value = "330";
    offset.fire("change");
    await settled(r.root);
    expect(text(r.root, ".tool-notes li")).toContain(copy.offsetNote);
    expect(text(r.root, ".zone-caption")).toEqual(["Dates are in UTC+5:30."]);
    // 23:00 UTC plus 5:30 is already February.
    expect(tableRows(r.root.querySelectorAll("table")[1] as FakeElement)[0]).toEqual(["Busiest month", "Feb 2025", "1 Memory", "50% of dated"]);
  });
});

describe("without what it needs", () => {
  it("says so plainly without an export, and still offers the command", () => {
    const { root } = render(view, initialState());
    expect(text(root, ".empty-title")).toEqual([tools.needs.exportTitle]);
    expect(root.querySelector(".command code")?.textContent).toBe(displayText(COMMANDS.gaps));
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
    expect(root.querySelectorAll("table").length).toBeGreaterThanOrEqual(1);
    expect(said).toHaveLength(1);
  });
});

describe("privacy", () => {
  it("shows no username, Memory id or link anywhere, and names no one in a note or an announcement", async () => {
    const parsed = base.latest as ParsedExport;
    const names = [
      ...new Set([...parsed.friends.friends.map((f) => f.username), ...FRIENDS.map((f) => f.username), ...parsed.chats.slice(0, 200).map((c) => c.conversation)]),
    ].filter((n) => n.length >= 5);
    expect(names).toContain("zqpal_old");
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
    const entries = collectCopy({ tool_memories_gaps: copy });
    expect(entries.length).toBeGreaterThan(30);
    expect(RULES.flatMap((rule) => lint(entries, rule))).toEqual([]);
  });

  it("takes only counts, month names and flags, never a name, and has no exclamation mark", () => {
    for (const value of Object.values(copy)) if (typeof value === "function") expect(value.length).toBeLessThanOrEqual(2);
    expect(collectCopy({ copy }).map((e) => e.text).join(" ")).not.toMatch(/!/);
  });

  it("agrees nouns and verbs with the count", () => {
    expect(copy.undatedNote(1)).toBe("1 Memory has no usable date, so Snappy left it out.");
    expect(copy.undatedNote(2)).toBe("2 Memories have no usable date, so Snappy left them out.");
    expect(copy.futureNote(1)).toContain("1 Memory is dated in the future");
    expect(copy.futureNote(2)).toContain("2 Memories are dated in the future");
    expect(copy.duplicateNote(1)).toBe("1 repeated Memory was counted once.");
    expect(copy.duplicateNote(2)).toBe("2 repeated Memories were counted once.");
    expect(copy.quietNote(1)).toMatch(/^This gap may/);
    expect(copy.quietNote(2)).toMatch(/^These gaps may/);
    expect(copy.limitedNote(1)).toMatch(/^1 gap at the start/);
    expect(copy.noGapsLine(1)).toBe("No gaps of 1 month or more.");
    expect(copy.noneAnnounce(12)).toBe("No gaps of 12 months or more found.");
    expect(copy.stretchCell(1)).toBe("Busiest 1 month");
    expect(copy.minGapNote(1)).toBe("The shortest gap was changed to 1 month.");
  });

  it("names the months the way the command does", () => {
    expect(copy.unitMonthYear(3, 2021)).toBe("Mar 2021");
    expect(copy.unitMonthYear(12, 1999)).toBe("Dec 1999");
  });
});
