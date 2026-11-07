import { describe, expect, it } from "vitest";
import {
  calendarYear,
  heatLevel,
  indexMemoryDays,
  localDate,
  monthDayCalendar,
  monthYearHeatmap,
  nearbyDays,
  onThisDay,
} from "../../src/insights/memories-on-this-day.ts";
import { parseExportFiles } from "../../src/export/parse.ts";
import { buildSyntheticExport } from "../../src/testing/synthetic-export.ts";
import type { MemoryItem } from "../../src/types.ts";

const NOW = Date.UTC(2026, 10, 6, 12, 0, 0);
const OPTS = { now: NOW };

function mem(id: string, y: number, m: number, d: number, hh = 12, mm = 0): MemoryItem {
  return { id, date: Date.UTC(y, m - 1, d, hh, mm), mediaType: "image" };
}

describe("indexMemoryDays", () => {
  it("handles empty input", () => {
    const idx = indexMemoryDays([], OPTS);
    expect(idx.counts).toEqual({ input: 0, unique: 0, dated: 0, undated: 0, future: 0, duplicateIds: 0, invalidIds: 0 });
    expect(idx.firstYear).toBeNull();
    expect(idx.notes.map((n) => n.code)).toEqual(["no-dated-items"]);
    expect(onThisDay(idx, { year: 2026, month: 11, day: 6 }).years).toEqual([]);
    expect(nearbyDays(idx, { year: 2026, month: 11, day: 6 }).years).toEqual([]);
    expect(calendarYear(idx, 2024)).toMatchObject({ total: 0, days: [], activeDays: 0, maxDayCount: 0 });
    expect(monthYearHeatmap(idx)).toMatchObject({ years: [], max: 0, total: 0 });
    expect(monthDayCalendar(idx).cells).toEqual([]);
  });

  it("handles one item", () => {
    const idx = indexMemoryDays([mem("a", 2024, 11, 6)], OPTS);
    expect(idx.counts.dated).toBe(1);
    expect(idx.firstYear).toBe(2024);
    expect(idx.lastYear).toBe(2024);
    const r = onThisDay(idx, { year: 2026, month: 11, day: 6 });
    expect(r.years).toEqual([{ year: 2024, yearsAgo: 2, ids: ["a"], count: 1 }]);
    expect(r.total).toBe(1);
  });

  it("counts missing, null, NaN and out-of-range dates as undated, sorted by id", () => {
    const items = [
      { id: "z", date: null },
      { id: "b", date: undefined },
      { id: "n", date: Number.NaN },
      { id: "old", date: 5 },
      { id: "far", date: Date.UTC(2150, 0, 1) },
      mem("ok", 2024, 1, 1),
    ];
    const idx = indexMemoryDays(items, OPTS);
    expect(idx.counts).toMatchObject({ dated: 1, undated: 5, future: 0 });
    expect(idx.undatedIds).toEqual(["b", "far", "n", "old", "z"]);
    expect(idx.notes).toContainEqual({ code: "undated-items", params: { count: 5 } });
    expect(monthYearHeatmap(idx).excluded).toEqual({ undated: 5, future: 0 });
  });

  it("keeps dates after now off the calendar and counts them as future", () => {
    const idx = indexMemoryDays([mem("past", 2025, 11, 6), mem("soon", 2027, 11, 6), { id: "edge", date: NOW }], OPTS);
    expect(idx.counts).toMatchObject({ dated: 2, future: 1 });
    expect(calendarYear(idx, 2027).total).toBe(0);
    expect(idx.notes).toContainEqual({ code: "future-dates-skipped", params: { count: 1 } });
  });

  it("treats now as not future and now + 1 ms as future", () => {
    const idx = indexMemoryDays([{ id: "at", date: NOW }, { id: "after", date: NOW + 1 }, { id: "before", date: NOW - 1 }], OPTS);
    expect(idx.counts).toMatchObject({ dated: 2, future: 1 });
    expect(idx.undatedIds).toEqual([]);
  });

  it("counts an exact duplicate id once but keeps ids that differ only by case", () => {
    const idx = indexMemoryDays([mem("Abc", 2023, 5, 5), mem("abc", 2023, 5, 5), mem("Abc", 2022, 5, 5), { id: "", date: NOW - 1 }], OPTS);
    expect(idx.counts).toMatchObject({ input: 4, unique: 2, dated: 2, duplicateIds: 1, invalidIds: 1 });
    const r = onThisDay(idx, { year: 2026, month: 5, day: 5 });
    expect(r.years).toEqual([{ year: 2023, yearsAgo: 3, ids: ["Abc", "abc"], count: 2 }]);
  });

  it("ignores a bad offset and a bad now, with notes", () => {
    const idx = indexMemoryDays([mem("a", 2024, 1, 1)], { now: Number.NaN, utcOffsetMinutes: 9999 });
    expect(idx.utcOffsetMinutes).toBe(0);
    expect(idx.notes.map((n) => n.code)).toEqual(expect.arrayContaining(["offset-invalid", "now-invalid"]));
    expect(idx.counts.dated).toBe(1);
  });
});

describe("UTC offset", () => {
  it("accepts offsets of exactly +-840 minutes and rejects 841", () => {
    const item = mem("x", 2024, 3, 9, 12);
    for (const ok of [840, -840]) {
      const idx = indexMemoryDays([item], { now: NOW, utcOffsetMinutes: ok });
      expect(idx.utcOffsetMinutes).toBe(ok);
      expect(idx.notes.map((n) => n.code)).not.toContain("offset-invalid");
    }
    for (const bad of [841, -841]) {
      const idx = indexMemoryDays([item], { now: NOW, utcOffsetMinutes: bad });
      expect(idx.utcOffsetMinutes).toBe(0);
      expect(idx.notes.map((n) => n.code)).toContain("offset-invalid");
    }
    expect(localDate(Date.UTC(2026, 0, 1, 12, 0), 841)).toEqual({ year: 2026, month: 1, day: 1 });
    expect(localDate(Date.UTC(2026, 0, 1, 12, 0), 840)).toEqual({ year: 2026, month: 1, day: 2 });
  });

  it("moves a late-evening UTC memory to the next local day for a positive offset", () => {
    const item = mem("late", 2024, 3, 9, 23, 30);
    const utc = indexMemoryDays([item], OPTS);
    const plus2 = indexMemoryDays([item], { now: NOW, utcOffsetMinutes: 120 });
    expect(onThisDay(utc, { year: 2026, month: 3, day: 9 }).total).toBe(1);
    expect(onThisDay(plus2, { year: 2026, month: 3, day: 9 }).total).toBe(0);
    expect(onThisDay(plus2, { year: 2026, month: 3, day: 10 }).total).toBe(1);
  });

  it("moves an early-morning UTC memory to the previous local day for a negative offset", () => {
    const idx = indexMemoryDays([mem("early", 2024, 1, 1, 2, 0)], { now: NOW, utcOffsetMinutes: -300 });
    expect(calendarYear(idx, 2023).days).toEqual([{ month: 12, day: 31, count: 1 }]);
    expect(idx.firstYear).toBe(2023);
  });

  it("localDate gives today in the caller's zone", () => {
    expect(localDate(Date.UTC(2026, 0, 1, 1, 0), -120)).toEqual({ year: 2025, month: 12, day: 31 });
    expect(localDate(Number.NaN)).toBeNull();
  });
});

describe("onThisDay", () => {
  const items = [
    mem("a1", 2023, 7, 4, 9),
    mem("a2", 2023, 7, 4, 9), // same time as a1: id breaks the tie
    mem("a0", 2023, 7, 4, 8),
    mem("b", 2021, 7, 4),
    mem("c", 2026, 7, 4), // current year
    mem("d", 2022, 7, 5),
  ];
  const idx = indexMemoryDays(items, OPTS);

  it("lists earlier years newest first with ids in capture order, then id order", () => {
    const r = onThisDay(idx, { year: 2026, month: 7, day: 4 });
    expect(r.years.map((y) => y.year)).toEqual([2023, 2021]);
    expect(r.years[0]!.ids).toEqual(["a0", "a1", "a2"]);
    expect(r.years[0]!.yearsAgo).toBe(3);
    expect(r.total).toBe(4);
  });

  it("can include the target year", () => {
    const r = onThisDay(idx, { year: 2026, month: 7, day: 4 }, { includeSameYear: true });
    expect(r.years.map((y) => y.year)).toEqual([2026, 2023, 2021]);
  });

  it("is the same whatever the input order", () => {
    const rev = indexMemoryDays([...items].reverse(), OPTS);
    expect(onThisDay(rev, { year: 2026, month: 7, day: 4 })).toEqual(onThisDay(idx, { year: 2026, month: 7, day: 4 }));
  });

  it("rejects impossible targets without throwing", () => {
    for (const t of [
      { year: 2026, month: 2, day: 29 }, // 2026 is a common year
      { year: 2026, month: 13, day: 1 },
      { year: 2026, month: 4, day: 31 },
      { year: 2026.5, month: 4, day: 1 },
      { year: 1800, month: 4, day: 1 },
    ]) {
      const r = onThisDay(idx, t);
      expect(r.years).toEqual([]);
      expect(r.notes).toContainEqual({ code: "invalid-target", params: {} });
    }
  });
});

describe("Feb 29", () => {
  const idx = indexMemoryDays([mem("leap", 2020, 2, 29), mem("feb28", 2021, 2, 28), mem("mar1", 2022, 3, 1), mem("leap2", 2024, 2, 29)], OPTS);

  it("matches only Feb 29 on a leap-day target", () => {
    const r = onThisDay(idx, { year: 2028, month: 2, day: 29 });
    expect(r.years.map((y) => y.ids)).toEqual([["leap2"], ["leap"]]);
  });

  it("folds Feb 29 memories into Feb 28 in a common year, with a note", () => {
    const r = onThisDay(idx, { year: 2026, month: 2, day: 28 });
    expect(r.years.map((y) => y.ids)).toEqual([["leap2"], ["feb28"], ["leap"]]);
    expect(r.notes).toContainEqual({ code: "leap-day-folded", params: { count: 2 } });
  });

  it("does not fold on a Feb 28 target in a leap year", () => {
    const r = onThisDay(idx, { year: 2028, month: 2, day: 28 });
    expect(r.years.map((y) => y.ids)).toEqual([["feb28"]]);
    expect(r.notes.some((n) => n.code === "leap-day-folded")).toBe(false);
  });

  it("gives Feb 29 its own cell in the month-and-day calendar and the year calendar", () => {
    expect(monthDayCalendar(idx).cells.find((c) => c.month === 2 && c.day === 29)).toEqual({ month: 2, day: 29, count: 2, years: 2 });
    expect(calendarYear(idx, 2024).days).toEqual([{ month: 2, day: 29, count: 1 }]);
  });

  it("centers a Feb 29 window on Feb 28 in common years", () => {
    const r = nearbyDays(idx, { year: 2028, month: 2, day: 29 }, { windowDays: 1 });
    const y2021 = r.years.find((y) => y.year === 2021)!;
    expect(y2021.days).toEqual([{ date: { year: 2021, month: 2, day: 28 }, offsetDays: 0, ids: ["feb28"] }]);
    const y2022 = r.years.find((y) => y.year === 2022)!;
    expect(y2022.days[0]).toMatchObject({ date: { year: 2022, month: 3, day: 1 }, offsetDays: 1 });
  });
});

describe("nearbyDays", () => {
  const idx = indexMemoryDays(
    [mem("on", 2024, 6, 15), mem("m2", 2024, 6, 13), mem("p3", 2024, 6, 18), mem("p4", 2024, 6, 19), mem("other", 2023, 6, 16), mem("dec", 2023, 12, 30), mem("jan", 2024, 1, 2)],
    OPTS,
  );

  it("collects days within the window, oldest first, with offsets", () => {
    const r = nearbyDays(idx, { year: 2026, month: 6, day: 15 });
    expect(r.windowDays).toBe(3);
    expect(r.years.map((y) => y.year)).toEqual([2024, 2023]);
    expect(r.years[0]!.days.map((d) => [d.offsetDays, d.ids[0]])).toEqual([
      [-2, "m2"],
      [0, "on"],
      [3, "p3"],
    ]);
    expect(r.years[1]!.days[0]).toMatchObject({ offsetDays: 1, ids: ["other"] });
    expect(r.total).toBe(4);
  });

  it("clamps the window and says so", () => {
    expect(nearbyDays(idx, { year: 2026, month: 6, day: 15 }, { windowDays: 500 }).windowDays).toBe(31);
    const neg = nearbyDays(idx, { year: 2026, month: 6, day: 15 }, { windowDays: -4 });
    expect(neg.windowDays).toBe(0);
    expect(neg.notes).toContainEqual({ code: "window-adjusted", params: { windowDays: 0 } });
    expect(neg.years.map((y) => y.year)).toEqual([2024]);
  });

  it("reaches across the new year", () => {
    const r = nearbyDays(idx, { year: 2026, month: 1, day: 1 }, { windowDays: 3 });
    // The window around Jan 1, 2024 spans Dec 29, 2023 to Jan 4, 2024 and is listed under 2024.
    const y2024 = r.years.find((y) => y.year === 2024)!;
    expect(y2024.days.map((d) => [d.date.year, d.offsetDays, d.ids[0]])).toEqual([
      [2023, -2, "dec"],
      [2024, 1, "jan"],
    ]);
    expect(r.years.some((y) => y.year === 2023)).toBe(false);
  });
});

describe("nearbyDays at the edges of the memory range", () => {
  it("finds a late-December memory for a January target when it is the only memory", () => {
    const idx = indexMemoryDays([mem("dec", 2023, 12, 30)], OPTS);
    const r = nearbyDays(idx, { year: 2026, month: 1, day: 1 });
    expect(r.years.map((y) => y.year)).toEqual([2024]);
    expect(r.years[0]!.days.map((d) => [d.date.year, d.offsetDays, d.ids[0]])).toEqual([[2023, -2, "dec"]]);
    expect(r.total).toBe(1);
  });

  it("finds an early-January memory for a December target when it is the only memory", () => {
    const idx = indexMemoryDays([mem("jan", 2024, 1, 2)], OPTS);
    const r = nearbyDays(idx, { year: 2026, month: 12, day: 31 });
    expect(r.years.map((y) => y.year)).toEqual([2023]);
    expect(r.years[0]!.days.map((d) => [d.date.year, d.offsetDays, d.ids[0]])).toEqual([[2024, 2, "jan"]]);
  });

  it("still never lists the target year or later unless asked", () => {
    const idx = indexMemoryDays([mem("dec", 2025, 12, 30)], OPTS);
    expect(nearbyDays(idx, { year: 2026, month: 1, day: 1 }).years.map((y) => y.year)).toEqual([]);
    expect(nearbyDays(idx, { year: 2026, month: 1, day: 1 }, { includeSameYear: true }).years.map((y) => y.year)).toEqual([2026]);
  });
});

describe("Feb 29 targets", () => {
  const idx = indexMemoryDays([mem("c28", 2023, 2, 28), mem("l29", 2024, 2, 29), mem("c28b", 2025, 2, 28)], OPTS);

  it("onThisDay matches a Feb 29 target only in leap years", () => {
    const r = onThisDay(idx, { year: 2028, month: 2, day: 29 });
    expect(r.years).toEqual([{ year: 2024, yearsAgo: 4, ids: ["l29"], count: 1 }]);
  });

  it("nearbyDays centers a Feb 29 target on Feb 28 in common years", () => {
    const r = nearbyDays(idx, { year: 2028, month: 2, day: 29 }, { windowDays: 0 });
    expect(r.years.map((y) => [y.year, y.days.map((d) => d.ids[0])])).toEqual([
      [2025, ["c28b"]],
      [2024, ["l29"]],
      [2023, ["c28"]],
    ]);
  });
});

describe("calendar data", () => {
  const idx = indexMemoryDays(
    [mem("a", 2023, 1, 1), mem("b", 2023, 1, 1, 18), mem("c", 2023, 1, 5), mem("d", 2023, 12, 31), mem("e", 2025, 3, 3), mem("f", 2025, 3, 4)],
    OPTS,
  );

  it("counts per day for a year", () => {
    const y = calendarYear(idx, 2023);
    expect(y.days).toEqual([
      { month: 1, day: 1, count: 2 },
      { month: 1, day: 5, count: 1 },
      { month: 12, day: 31, count: 1 },
    ]);
    expect(y).toMatchObject({ total: 4, activeDays: 3, maxDayCount: 2 });
    expect(y.months[0]).toBe(3);
    expect(y.months[11]).toBe(1);
    expect(calendarYear(idx, 2024).total).toBe(0);
    expect(calendarYear(idx, Number.NaN).notes).toContainEqual({ code: "invalid-year", params: {} });
  });

  it("builds a dense month and year heatmap, empty years included", () => {
    const h = monthYearHeatmap(idx);
    expect(h.years.map((y) => y.year)).toEqual([2023, 2024, 2025]);
    expect(h.years[1]!.months).toEqual(new Array(12).fill(0));
    expect(h.years[2]!.months[2]).toBe(2);
    expect(h).toMatchObject({ max: 3, total: 6 });
    expect(h.years.map((y) => y.total)).toEqual([4, 0, 2]);
  });

  it("buckets heat levels 0..4", () => {
    expect(heatLevel(0, 10)).toBe(0);
    expect(heatLevel(1, 10)).toBe(1);
    expect(heatLevel(5, 10)).toBe(2);
    expect(heatLevel(10, 10)).toBe(4);
    expect(heatLevel(99, 10)).toBe(4);
    expect(heatLevel(3, 0)).toBe(0);
    expect(heatLevel(Number.NaN, 10)).toBe(0);
  });

  it("counts years per month and day", () => {
    const idx2 = indexMemoryDays([mem("a", 2022, 5, 5), mem("b", 2023, 5, 5), mem("c", 2023, 5, 5, 20), mem("d", 2023, 1, 9)], OPTS);
    expect(monthDayCalendar(idx2).cells).toEqual([
      { month: 1, day: 9, count: 1, years: 1 },
      { month: 5, day: 5, count: 3, years: 2 },
    ]);
  });
});

describe("scale", () => {
  it("indexes and queries 100,000 items and stays deterministic", () => {
    const items: MemoryItem[] = [];
    for (let i = 0; i < 100_000; i++) items.push({ id: `m${i}`, date: Date.UTC(2015, 0, 1) + ((i * 7919) % 3650) * 86_400_000 + (i % 86_400) * 1000, mediaType: "image" });
    const idx = indexMemoryDays(items, OPTS);
    const target = { year: 2026, month: 6, day: 15 };
    const a = onThisDay(idx, target);
    nearbyDays(idx, target, { windowDays: 31 });
    monthDayCalendar(idx);
    calendarYear(idx, 2018);
    expect(idx.counts.dated).toBe(100_000);
    expect(monthYearHeatmap(idx).years.reduce((n, y) => n + y.total, 0)).toBe(100_000);
    expect(onThisDay(indexMemoryDays([...items].reverse(), OPTS), target)).toEqual(a);
  }, 60_000);
});

describe("synthetic export", () => {
  it("works on parsed synthetic memories, with counts adding up", () => {
    const parsed = parseExportFiles(buildSyntheticExport({ now: NOW, memoryCount: 300 }));
    const idx = indexMemoryDays(parsed.memories, OPTS);
    expect(idx.counts.input).toBe(parsed.memories.length);
    expect(idx.counts.unique).toBe(idx.counts.dated + idx.counts.undated + idx.counts.future);
    expect(idx.counts.dated).toBeGreaterThan(0);
    const heat = monthYearHeatmap(idx);
    expect(heat.total).toBe(idx.counts.dated);
    const daySum = heat.years.reduce((n, y) => n + calendarYear(idx, y.year).total, 0);
    expect(daySum).toBe(idx.counts.dated);
  });
});

describe("privacy", () => {
  const CANARY = "zqcanary-user-77";
  const items: MemoryItem[] = [
    {
      ...mem("m-1", 2023, 4, 1),
      downloadUrl: `https://example.invalid/${CANARY}`,
      zipPath: `memories/${CANARY}.jpg`,
      overlayPaths: [`memories/${CANARY}-overlay.png`],
      sizeBytes: 123456,
    },
    { id: "m-2", date: null, mediaType: "video", zipPath: `memories/${CANARY}-2.mp4` },
    { ...mem("m-3", 2099, 1, 1), zipPath: `${CANARY}/future.jpg` },
  ];
  const idx = indexMemoryDays(items, OPTS);

  it("never puts paths, links or canary text into any output", () => {
    const outputs = [
      idx.notes,
      idx.counts,
      onThisDay(idx, { year: 2026, month: 4, day: 1 }),
      nearbyDays(idx, { year: 2026, month: 4, day: 1 }),
      calendarYear(idx, 2023),
      monthYearHeatmap(idx),
      monthDayCalendar(idx),
      onThisDay(idx, { year: 2026, month: 2, day: 30 }),
    ];
    for (const out of outputs) {
      const s = JSON.stringify(out);
      expect(s).not.toContain(CANARY);
      expect(s).not.toContain("memories/");
      expect(s).not.toContain("example.invalid");
      expect(s).not.toContain("123456");
    }
  });

  it("notes carry only codes and whole-number params", () => {
    const all = [...idx.notes, ...onThisDay(idx, { year: 1, month: 1, day: 1 }).notes, ...nearbyDays(idx, { year: 2026, month: 4, day: 1 }, { windowDays: 99 }).notes];
    expect(all.length).toBeGreaterThan(0);
    for (const n of all) {
      expect(n.code).toMatch(/^[a-z]+(-[a-z]+)*$/);
      for (const v of Object.values(n.params)) expect(Number.isInteger(v)).toBe(true);
    }
  });

  it("lists memory ids only where it is meant to", () => {
    expect(JSON.stringify(onThisDay(idx, { year: 2026, month: 4, day: 1 }))).toContain("m-1");
    expect(JSON.stringify(calendarYear(idx, 2023))).not.toContain("m-1");
    expect(JSON.stringify(monthYearHeatmap(idx))).not.toContain("m-1");
    expect(JSON.stringify(idx.notes)).not.toContain("m-");
  });
});
