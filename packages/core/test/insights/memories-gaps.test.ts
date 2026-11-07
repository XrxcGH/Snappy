import { describe, expect, it } from "vitest";
import { findMemoryGaps } from "../../src/insights/memories-gaps.ts";
import { parseExportFiles } from "../../src/export/parse.ts";
import { buildSyntheticExport } from "../../src/testing/synthetic-export.ts";
import type { MemoryItem } from "../../src/types.ts";

const NOW = Date.UTC(2026, 10, 6, 12, 0, 0); // 2026-11-06
const OPTS = { now: NOW };

function mem(id: string, y: number, m: number, d = 15, hh = 12): MemoryItem {
  return { id, date: Date.UTC(y, m - 1, d, hh), mediaType: "image" };
}
const ym = (year: number, month: number) => ({ year, month });
const codes = (r: { notes: { code: string }[] }) => r.notes.map((n) => n.code);

describe("empty and tiny input", () => {
  it("handles empty input", () => {
    const r = findMemoryGaps([], OPTS);
    expect(r.counts).toEqual({ input: 0, unique: 0, dated: 0, undated: 0, future: 0, duplicateIds: 0 });
    expect(r.range).toBeNull();
    expect(r.months).toEqual([]);
    expect(r.gaps).toEqual([]);
    expect(r.busiestMonth).toBeNull();
    expect(r.busiestStretch).toBeNull();
    expect(r.longestGapMonths).toBe(0);
    expect(codes(r)).toEqual(["no-dated-items"]);
  });

  it("handles one item, with an end gap up to now", () => {
    const r = findMemoryGaps([mem("a", 2026, 3)], OPTS);
    expect(r.range).toEqual({ first: ym(2026, 3), last: ym(2026, 3), months: 1, activeMonths: 1, emptyMonths: 0 });
    expect(r.months).toEqual([{ year: 2026, month: 3, count: 1 }]);
    expect(r.busiestMonth).toEqual({ year: 2026, month: 3, count: 1 });
    expect(r.busiestStretch).toEqual({ from: ym(2026, 3), to: ym(2026, 3), months: 1, count: 1, sharePercent: 100 });
    // April to September are empty; October is the month before the current one (November).
    expect(r.gaps).toEqual([{ kind: "end", from: ym(2026, 4), to: ym(2026, 10), months: 7, exportHint: false }]);
    expect(codes(r)).toEqual(["single-month", "gaps-may-be-quiet-time"]);
  });

  it("reports no gaps when every month has items", () => {
    const r = findMemoryGaps([mem("a", 2026, 8), mem("b", 2026, 9), mem("c", 2026, 10), mem("d", 2026, 11, 1)], OPTS);
    expect(r.gaps).toEqual([]);
    expect(codes(r)).toContain("no-gaps");
    expect(r.range?.emptyMonths).toBe(0);
  });
});

describe("gaps", () => {
  const items = [mem("a", 2024, 1), mem("b", 2024, 2), mem("c", 2024, 6), mem("d", 2025, 1), mem("e", 2026, 10)];

  it("finds middle gaps in date order with the default threshold of 2 months", () => {
    const r = findMemoryGaps(items, OPTS);
    // Feb -> Jun leaves Mar, Apr, May (3). Jun -> Jan leaves Jul..Dec (6). Jan 2025 -> Oct 2026 leaves Feb 2025..Sep 2026 (20).
    expect(r.gaps).toEqual([
      { kind: "middle", from: ym(2024, 3), to: ym(2024, 5), months: 3, exportHint: false },
      { kind: "middle", from: ym(2024, 7), to: ym(2024, 12), months: 6, exportHint: false },
      { kind: "middle", from: ym(2025, 2), to: ym(2026, 9), months: 20, exportHint: false },
    ]);
    expect(r.longestGapMonths).toBe(20);
    expect(r.range).toEqual({ first: ym(2024, 1), last: ym(2026, 10), months: 34, activeMonths: 5, emptyMonths: 29 });
    expect(r.months).toHaveLength(34);
  });

  it("treats a gap of exactly the threshold as a gap and one month less as none", () => {
    const two = findMemoryGaps([mem("a", 2024, 1), mem("b", 2024, 4), mem("c", 2026, 11, 1)], { ...OPTS, minGapMonths: 2 });
    expect(two.gaps.filter((g) => g.kind === "middle" && g.months === 2)).toHaveLength(1);
    const one = findMemoryGaps([mem("a", 2024, 1), mem("b", 2024, 3), mem("c", 2026, 11, 1)], { ...OPTS, minGapMonths: 2 });
    expect(one.gaps.some((g) => g.from.year === 2024 && g.from.month === 2)).toBe(false);
    const asOne = findMemoryGaps([mem("a", 2024, 1), mem("b", 2024, 3), mem("c", 2026, 11, 1)], { ...OPTS, minGapMonths: 1 });
    expect(asOne.gaps[0]).toMatchObject({ kind: "middle", from: ym(2024, 2), to: ym(2024, 2), months: 1 });
  });

  it("respects a custom threshold", () => {
    const r = findMemoryGaps(items, { ...OPTS, minGapMonths: 6 });
    expect(r.gaps.map((g) => g.months)).toEqual([6, 20]);
    expect(r.minGapMonths).toBe(6);
  });

  it("never reports the current month as part of an end gap", () => {
    // Last item in August; September and October are empty, November (now) is partial.
    const r = findMemoryGaps([mem("a", 2026, 8)], OPTS);
    expect(r.gaps).toEqual([{ kind: "end", from: ym(2026, 9), to: ym(2026, 10), months: 2, exportHint: false }]);
    // Last item in September leaves one whole empty month: below the threshold.
    expect(findMemoryGaps([mem("a", 2026, 9)], OPTS).gaps).toEqual([]);
  });

  it("finds a start gap only when since is given, and not counting its own month", () => {
    const list = [mem("a", 2024, 6), mem("b", 2026, 10)];
    expect(findMemoryGaps(list, OPTS).gaps.some((g) => g.kind === "start")).toBe(false);
    const r = findMemoryGaps(list, { ...OPTS, since: Date.UTC(2023, 8, 20) }); // Sept 2023 is partial
    expect(r.gaps[0]).toEqual({ kind: "start", from: ym(2023, 10), to: ym(2024, 5), months: 8, exportHint: false });
    // A since inside or after the first month gives no start gap.
    expect(findMemoryGaps(list, { ...OPTS, since: Date.UTC(2024, 5, 1) }).gaps.some((g) => g.kind === "start")).toBe(false);
    expect(findMemoryGaps(list, { ...OPTS, since: Date.UTC(2025, 0, 1) }).gaps.some((g) => g.kind === "start")).toBe(false);
  });

  it("orders start, middle and end gaps by date", () => {
    const r = findMemoryGaps([mem("a", 2024, 6), mem("b", 2024, 10), mem("c", 2025, 6)], { ...OPTS, since: Date.UTC(2024, 0, 10) });
    expect(r.gaps.map((g) => g.kind)).toEqual(["start", "middle", "middle", "end"]);
    expect(r.gaps.map((g) => g.months)).toEqual([4, 3, 7, 16]);
  });

  it("ignores an invalid since, a since in the future, and says so", () => {
    for (const since of [Number.NaN, 5, Date.UTC(2150, 0, 1), NOW + 86_400_000]) {
      const r = findMemoryGaps([mem("a", 2024, 6)], { ...OPTS, since });
      expect(codes(r)).toContain("since-invalid");
      expect(r.gaps.every((g) => g.kind !== "start")).toBe(true);
    }
  });

  it("measures the end gap from the earlier of now and exportedAt", () => {
    const list = [mem("a", 2025, 1)];
    const r = findMemoryGaps(list, { ...OPTS, exportedAt: Date.UTC(2025, 5, 10) });
    expect(r.gaps).toEqual([{ kind: "end", from: ym(2025, 2), to: ym(2025, 5), months: 4, exportHint: false }]);
    const later = findMemoryGaps(list, { ...OPTS, exportedAt: NOW + 5 * 86_400_000 });
    expect(codes(later)).toContain("exported-at-future");
    expect(later.gaps[0]?.to).toEqual(ym(2026, 10));
    const bad = findMemoryGaps(list, { ...OPTS, exportedAt: Number.NaN });
    expect(codes(bad)).toContain("exported-at-invalid");
    expect(bad.gaps[0]?.to).toEqual(ym(2026, 10));
  });

  it("gives no end gap when an item sits after the export date", () => {
    const r = findMemoryGaps([mem("a", 2025, 9)], { ...OPTS, exportedAt: Date.UTC(2025, 5, 10) });
    expect(r.gaps).toEqual([]);
  });

  it("has no end gap and says so when now is invalid", () => {
    const r = findMemoryGaps([mem("a", 2024, 1), mem("b", 2024, 6)], { now: Number.NaN });
    expect(codes(r)).toContain("now-invalid");
    expect(r.gaps.map((g) => g.kind)).toEqual(["middle"]);
  });
});

describe("export hint", () => {
  const list = [mem("a", 2024, 6), mem("b", 2024, 10), mem("c", 2025, 6)];

  it("tags start and end gaps, never middle ones, when the export may be date-limited", () => {
    const r = findMemoryGaps(list, { ...OPTS, since: Date.UTC(2024, 0, 10), issueCodes: ["possibly-date-limited"] });
    expect(r.gaps.map((g) => [g.kind, g.exportHint])).toEqual([
      ["start", true],
      ["middle", false],
      ["middle", false],
      ["end", true],
    ]);
    expect(r.notes).toContainEqual({ code: "gap-near-limited-export", params: { count: 2 } });
  });

  it("recognizes each limited code and ignores unrelated ones", () => {
    for (const code of ["friends-empty-but-deleted", "possibly-date-limited", "friend-count-mismatch"]) {
      expect(findMemoryGaps(list, { ...OPTS, issueCodes: [code] }).gaps.at(-1)?.exportHint).toBe(true);
    }
    const none = findMemoryGaps(list, { ...OPTS, issueCodes: ["snap-history-missing", "memories-missing"] });
    expect(none.gaps.every((g) => !g.exportHint)).toBe(true);
    expect(codes(none)).not.toContain("gap-near-limited-export");
    expect(findMemoryGaps(list, { ...OPTS, issueCodes: [] }).gaps.every((g) => !g.exportHint)).toBe(true);
  });

  it("adds no hint note when there are no start or end gaps", () => {
    const r = findMemoryGaps([mem("a", 2024, 1), mem("b", 2024, 5), mem("c", 2026, 11, 1)], { ...OPTS, issueCodes: ["possibly-date-limited"] });
    expect(r.gaps.every((g) => g.kind === "middle")).toBe(true);
    expect(codes(r)).not.toContain("gap-near-limited-export");
  });
});

describe("busiest month and stretch", () => {
  it("finds the busiest 3-month stretch and month, earliest first on ties", () => {
    const items: MemoryItem[] = [];
    const add = (y: number, m: number, n: number) => {
      for (let i = 0; i < n; i++) items.push(mem(`m${y}-${m}-${i}`, y, m, 1 + i));
    };
    add(2024, 1, 2);
    add(2024, 2, 1);
    add(2024, 3, 1);
    add(2024, 6, 3);
    add(2024, 7, 3);
    add(2024, 8, 3); // stretch Jun..Aug = 9
    add(2024, 12, 9); // single month of 9; stretch Oct..Dec = 9 (later, so it loses)
    const r = findMemoryGaps(items, { now: Date.UTC(2025, 0, 1) });
    expect(r.busiestStretch).toEqual({ from: ym(2024, 6), to: ym(2024, 8), months: 3, count: 9, sharePercent: Math.round((9 / 22) * 100) });
    expect(r.busiestMonth).toEqual({ year: 2024, month: 12, count: 9 });
  });

  it("uses a custom width and shrinks to a shorter range", () => {
    const list = [mem("a", 2024, 1), mem("b", 2024, 2), mem("c", 2024, 2, 20)];
    const wide = findMemoryGaps(list, { now: Date.UTC(2024, 5, 1), stretchMonths: 12 });
    expect(wide.busiestStretch).toMatchObject({ from: ym(2024, 1), to: ym(2024, 2), months: 2, count: 3, sharePercent: 100 });
    expect(wide.stretchMonths).toBe(12);
    const one = findMemoryGaps(list, { now: Date.UTC(2024, 5, 1), stretchMonths: 1 });
    expect(one.busiestStretch).toMatchObject({ from: ym(2024, 2), to: ym(2024, 2), months: 1, count: 2 });
  });

  it("adjusts and notes invalid options", () => {
    const r = findMemoryGaps([mem("a", 2024, 1)], { ...OPTS, minGapMonths: 0, stretchMonths: 99 });
    expect(r.minGapMonths).toBe(1);
    expect(r.stretchMonths).toBe(24);
    expect(r.notes).toContainEqual({ code: "min-gap-adjusted", params: { minGapMonths: 1 } });
    expect(r.notes).toContainEqual({ code: "stretch-adjusted", params: { stretchMonths: 24 } });
    const nan = findMemoryGaps([mem("a", 2024, 1)], { ...OPTS, minGapMonths: Number.NaN, stretchMonths: 2.5 });
    expect(nan.minGapMonths).toBe(2);
    expect(nan.stretchMonths).toBe(2);
  });
});

describe("undated, future, repeated and odd items", () => {
  it("counts undated and future items separately and leaves them out of the months", () => {
    const items = [
      { id: "z", date: null },
      { id: "u", date: undefined },
      { id: "n", date: Number.NaN },
      { id: "old", date: 5 },
      { id: "far", date: Date.UTC(2150, 0, 1) },
      { id: "fut", date: NOW + 86_400_000 },
      mem("ok", 2024, 1),
    ];
    const r = findMemoryGaps(items, OPTS);
    expect(r.counts).toEqual({ input: 7, unique: 7, dated: 1, undated: 5, future: 1, duplicateIds: 0 });
    expect(r.months).toEqual([{ year: 2024, month: 1, count: 1 }]);
    expect(r.notes).toContainEqual({ code: "undated-items", params: { count: 5 } });
    expect(r.notes).toContainEqual({ code: "future-dates-skipped", params: { count: 1 } });
  });

  it("counts a date exactly at now and skips one a moment later", () => {
    const r = findMemoryGaps([{ id: "a", date: NOW }, { id: "b", date: NOW + 1 }], OPTS);
    expect(r.counts).toMatchObject({ dated: 1, future: 1 });
  });

  it("handles only undated items", () => {
    const r = findMemoryGaps([{ id: "a", date: null }, { id: "b", date: null }], OPTS);
    expect(r.counts).toMatchObject({ dated: 0, undated: 2 });
    expect(r.range).toBeNull();
    expect(codes(r)).toEqual(["undated-items", "no-dated-items"]);
  });

  it("drops exactly repeated ids but keeps ids that differ by case, and items without an id", () => {
    const r = findMemoryGaps(
      [mem("a", 2024, 1), mem("a", 2024, 1), mem("A", 2024, 1), { date: Date.UTC(2024, 0, 3) }, { date: Date.UTC(2024, 0, 4) }, { id: "", date: Date.UTC(2024, 0, 5) }],
      OPTS,
    );
    expect(r.counts).toMatchObject({ input: 6, unique: 5, dated: 5, duplicateIds: 1 });
    expect(r.months[0]?.count).toBe(5);
    expect(r.notes).toContainEqual({ code: "duplicate-ids-skipped", params: { count: 1 } });
  });

  it("does not throw on junk entries", () => {
    const junk = [null, undefined, 5, "x", {}] as unknown as MemoryItem[];
    const r = findMemoryGaps(junk, OPTS);
    expect(r.counts.input).toBe(5);
    expect(r.counts.dated).toBe(0);
  });
});

describe("calendar edge cases", () => {
  it("handles month ends, year changes and leap days", () => {
    const r = findMemoryGaps(
      [
        { id: "a", date: Date.UTC(2023, 11, 31, 23, 59, 59) }, // Dec 2023
        { id: "b", date: Date.UTC(2024, 1, 29, 12) }, // Feb 29 2024 (leap)
        { id: "c", date: Date.UTC(2024, 2, 1, 0, 0, 0) }, // Mar 1 2024
        { id: "d", date: Date.UTC(2024, 4, 31, 23, 59) }, // May 31 2024
      ],
      { now: Date.UTC(2024, 5, 20) },
    );
    expect(r.months.map((m) => [m.year, m.month, m.count])).toEqual([
      [2023, 12, 1],
      [2024, 1, 0],
      [2024, 2, 1],
      [2024, 3, 1],
      [2024, 4, 0],
      [2024, 5, 1],
    ]);
    expect(r.gaps).toEqual([]); // two single-month gaps, below the threshold of 2
    expect(findMemoryGaps([{ id: "a", date: Date.UTC(2024, 1, 29, 12) }], { now: Date.UTC(2024, 5, 20) }).gaps).toEqual([
      { kind: "end", from: ym(2024, 3), to: ym(2024, 5), months: 3, exportHint: false },
    ]);
  });

  it("assigns a month by the UTC offset", () => {
    const edge = [{ id: "a", date: Date.UTC(2024, 2, 1, 2, 0) }]; // Mar 1 02:00 UTC
    expect(findMemoryGaps(edge, { now: Date.UTC(2024, 6, 1) }).months[0]).toMatchObject({ month: 3 });
    const west = findMemoryGaps(edge, { now: Date.UTC(2024, 6, 1), utcOffsetMinutes: -300 }); // Feb 29 21:00 local
    expect(west.months[0]).toMatchObject({ year: 2024, month: 2 });
    expect(west.utcOffsetMinutes).toBe(-300);
    const east = findMemoryGaps([{ id: "a", date: Date.UTC(2023, 11, 31, 20, 0) }], { now: Date.UTC(2024, 6, 1), utcOffsetMinutes: 330 });
    expect(east.months[0]).toMatchObject({ year: 2024, month: 1 });
  });

  it("ignores an invalid offset and says so", () => {
    for (const off of [900, -900, Number.NaN]) {
      const r = findMemoryGaps([mem("a", 2024, 1)], { ...OPTS, utcOffsetMinutes: off });
      expect(r.utcOffsetMinutes).toBe(0);
      expect(codes(r)).toContain("offset-invalid");
    }
  });

  it("uses the offset for the end-gap reference month too", () => {
    // 2026-11-01 02:00 UTC is still October in UTC-5, so October is the partial month.
    const now = Date.UTC(2026, 10, 1, 2, 0);
    const r = findMemoryGaps([mem("a", 2026, 7)], { now, utcOffsetMinutes: -300 });
    expect(r.gaps).toEqual([{ kind: "end", from: ym(2026, 8), to: ym(2026, 9), months: 2, exportHint: false }]);
    const utc = findMemoryGaps([mem("a", 2026, 7)], { now });
    expect(utc.gaps[0]?.to).toEqual(ym(2026, 10));
  });
});

describe("determinism and scale", () => {
  it("gives the same result for any input order and never mutates the input", () => {
    const items = [mem("a", 2024, 1), mem("b", 2024, 6), mem("c", 2025, 3), { id: "u", date: null }, mem("d", 2024, 6, 20)];
    const copy = items.map((i) => ({ ...i }));
    const a = findMemoryGaps(items, OPTS);
    expect(items).toEqual(copy);
    expect(findMemoryGaps([...items].reverse(), OPTS)).toEqual(a);
    expect(findMemoryGaps(items, OPTS)).toEqual(a);
  });

  it("handles 100,000 items quickly, with counts adding up", () => {
    const items: MemoryItem[] = [];
    for (let i = 0; i < 100_000; i++) items.push({ id: `m${i}`, date: Date.UTC(2010, 0, 1) + ((i * 7919) % 5000) * 86_400_000 + (i % 86_400) * 1000, mediaType: "image" });
    const t0 = Date.now();
    const r = findMemoryGaps(items, OPTS);
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(r.counts.dated).toBe(100_000);
    expect(r.months.reduce((n, m) => n + m.count, 0)).toBe(100_000);
    expect(r.range?.months).toBe(r.months.length);
    expect(r.range!.activeMonths + r.range!.emptyMonths).toBe(r.range!.months);
  }, 60_000);

  it("keeps month counts and gaps consistent with each other", () => {
    const items: MemoryItem[] = [];
    for (let i = 0; i < 400; i++) items.push({ id: `m${i}`, date: Date.UTC(2018, 0, 1) + ((i * 37) % 2000) * 86_400_000 + 5000, mediaType: "image" });
    const r = findMemoryGaps(items, { ...OPTS, minGapMonths: 1 });
    const empties = r.months.filter((m) => m.count === 0).length;
    const middle = r.gaps.filter((g) => g.kind === "middle").reduce((n, g) => n + g.months, 0);
    expect(middle).toBe(empties);
    expect(r.range?.emptyMonths).toBe(empties);
  });
});

describe("synthetic export", () => {
  it("works on parsed synthetic memories", () => {
    const parsed = parseExportFiles(buildSyntheticExport({ now: NOW, memoryCount: 300 }));
    const r = findMemoryGaps(parsed.memories, { ...OPTS, exportedAt: parsed.exportedAt, issueCodes: parsed.issues.map((i) => i.code) });
    expect(r.counts.input).toBe(parsed.memories.length);
    expect(r.counts.unique).toBe(r.counts.dated + r.counts.undated + r.counts.future);
    expect(r.counts.dated).toBeGreaterThan(0);
    expect(r.months.reduce((n, m) => n + m.count, 0)).toBe(r.counts.dated);
  });
});

describe("privacy", () => {
  const CANARY = "zqcanary-user-77";
  const items: MemoryItem[] = [
    {
      id: `id-${CANARY}`,
      date: Date.UTC(2023, 3, 1),
      mediaType: "image",
      downloadUrl: `https://example.invalid/${CANARY}`,
      zipPath: `memories/${CANARY}.jpg`,
      overlayPaths: [`memories/${CANARY}-overlay.png`],
      sizeBytes: 123456,
    },
    { id: "m-2", date: null, mediaType: "video", zipPath: `memories/${CANARY}-2.mp4` },
    { id: `m-3-${CANARY}`, date: Date.UTC(2099, 0, 1), mediaType: "image", zipPath: `${CANARY}/future.jpg` },
    { id: `id-${CANARY}-b`, date: Date.UTC(2024, 5, 1), mediaType: "image" },
  ];

  it("never puts ids, paths, links or canary text into the result", () => {
    const r = findMemoryGaps(items, { ...OPTS, since: Date.UTC(2022, 0, 1), issueCodes: ["possibly-date-limited", CANARY] });
    const s = JSON.stringify(r);
    expect(s).not.toContain(CANARY);
    expect(s).not.toContain("id-");
    expect(s).not.toContain("m-2");
    expect(s).not.toContain("memories/");
    expect(s).not.toContain("example.invalid");
    expect(s).not.toContain("123456");
    expect(r.gaps.length).toBeGreaterThan(0);
  });

  it("notes carry only codes and whole-number params", () => {
    const r = findMemoryGaps(items, { now: Number.NaN, utcOffsetMinutes: 999, minGapMonths: 0, stretchMonths: 99, since: Number.NaN, exportedAt: Number.NaN });
    const r2 = findMemoryGaps(items, { ...OPTS, since: Date.UTC(2022, 0, 1), issueCodes: ["possibly-date-limited"], exportedAt: NOW + 86_400_000 });
    const all = [...r.notes, ...r2.notes, ...findMemoryGaps([], OPTS).notes];
    expect(all.length).toBeGreaterThan(8);
    for (const n of all) {
      expect(n.code).toMatch(/^[a-z]+(-[a-z]+)*$/);
      for (const v of Object.values(n.params)) expect(Number.isInteger(v)).toBe(true);
    }
  });
});
