import { describe, expect, it } from "vitest";
import { planMemoryStorage } from "../../src/insights/storage-planner.ts";
import { planMemories } from "../../src/memories/plan.ts";
import type { MemoryItem } from "../../src/types.ts";

const MB = 1024 ** 2;
const GIB = 1024 ** 3;
const NOW = Date.UTC(2026, 5, 1);

function mem(id: string, over: Partial<MemoryItem> = {}): MemoryItem {
  return { id, date: Date.UTC(2023, 3, 1, 12, 0, 0), mediaType: "image", sizeBytes: MB, ...over };
}

const y = (year: number, m = 1, d = 1) => Date.UTC(year, m, d, 12, 0, 0);

describe("planMemoryStorage: basics", () => {
  it("handles empty input", () => {
    const plan = planMemoryStorage([], GIB, { now: NOW });
    expect(plan.totals).toMatchObject({ items: 0, knownBytes: 0, unsized: 0, isLowerBound: false });
    expect(plan.byYear).toEqual([]);
    expect(plan.byPart).toEqual([]);
    expect(plan.batches).toEqual([]);
    expect(plan.priority).toEqual([]);
    expect(plan.byType.map((t) => t.type)).toEqual(["image", "video", "unknown"]);
    expect(plan.fit).toMatchObject({ fitsAll: true, items: 0, bytes: 0, fractionOfGoal: 0 });
    expect(plan.notes).toEqual([{ code: "empty", params: {} }]);
  });

  it("plans a single item", () => {
    const plan = planMemoryStorage([mem("a", { partIndex: 2 })], GIB, { now: NOW });
    expect(plan.totals.items).toBe(1);
    expect(plan.byYear).toHaveLength(1);
    expect(plan.byYear[0]!).toMatchObject({ year: 2023, items: 1, knownBytes: MB, share: 1, fit: "all" });
    expect(plan.byPart).toEqual([{ part: 2, items: 1, knownBytes: MB, unsized: 0 }]);
    expect(plan.batches).toHaveLength(1);
    expect(plan.batches[0]!).toMatchObject({ index: 1, items: 1, bytes: MB, parts: [2], itemIds: ["a"], oversize: false });
    expect(plan.notes).toEqual([]);
  });

  it("totals by year, type and part and agrees with the plan.ts meter", () => {
    const items = [
      mem("a", { date: y(2021), sizeBytes: 3 * MB, partIndex: 1 }),
      mem("b", { date: y(2021), mediaType: "video", sizeBytes: 10 * MB, partIndex: 1 }),
      mem("c", { date: y(2022), sizeBytes: 2 * MB, partIndex: 2 }),
      mem("d", { date: y(2022), mediaType: "unknown", sizeBytes: 1 * MB }),
    ];
    const plan = planMemoryStorage(items, GIB);
    expect(plan.totals.knownBytes).toBe(16 * MB);
    expect(plan.totals.knownBytes).toBe(planMemories(items, { capBytes: GIB }).meter.knownBytes);
    expect(plan.byYear.map((r) => [r.year, r.items, r.knownBytes])).toEqual([
      [2021, 2, 13 * MB],
      [2022, 2, 3 * MB],
    ]);
    expect(plan.byYear[0]!.byType.video).toEqual({ items: 1, knownBytes: 10 * MB, unsized: 0 });
    expect(plan.byType.map((t) => [t.type, t.items, t.knownBytes])).toEqual([
      ["image", 2, 5 * MB],
      ["video", 1, 10 * MB],
      ["unknown", 1, 1 * MB],
    ]);
    expect(plan.byType[1]!.share).toBeCloseTo(10 / 16);
    expect(plan.byPart.map((p) => p.part)).toEqual([1, 2, null]);
  });

  it("falls back to the default goal and batch size with notes", () => {
    const plan = planMemoryStorage([mem("a")], -5, { batchBytes: Number.NaN });
    expect(plan.goalBytes).toBe(5 * GIB);
    expect(plan.batchBytes).toBe(GIB);
    expect(plan.notes.map((n) => n.code)).toEqual(["goal-defaulted", "batch-size-defaulted"]);
  });
});

describe("planMemoryStorage: sizes", () => {
  it("counts items without a size and marks the total as a lower bound", () => {
    const items = [
      mem("a", { sizeBytes: 4 * MB }),
      mem("b", { sizeBytes: undefined }),
      mem("c", { sizeBytes: -1 }),
      mem("d", { sizeBytes: Number.NaN }),
    ];
    const plan = planMemoryStorage(items, GIB);
    expect(plan.totals).toMatchObject({ items: 4, knownBytes: 4 * MB, unsized: 3, isLowerBound: true });
    expect(plan.byYear[0]!).toMatchObject({ unsized: 3 });
    expect(plan.notes).toContainEqual({ code: "lower-bound", params: { unsized: 3 } });
    // Unsized items never enter the fit or the batches.
    expect(plan.batches.flatMap((b) => b.itemIds)).toEqual(["a"]);
    expect(plan.fit.items).toBe(1);
  });

  it("marks a group with only unsized items as 'unsized'", () => {
    const plan = planMemoryStorage([mem("a", { sizeBytes: undefined })], GIB);
    expect(plan.priority[0]!.fit).toBe("unsized");
    expect(plan.byYear[0]!.fit).toBe("unsized");
    expect(plan.fit.fitsAll).toBe(true);
  });

  it("keeps a zero-byte item as known", () => {
    const plan = planMemoryStorage([mem("a", { sizeBytes: 0, date: y(2020) })], GIB);
    expect(plan.totals).toMatchObject({ knownBytes: 0, unsized: 0 });
    expect(plan.batches[0]!.itemIds).toEqual(["a"]);
  });
});

describe("planMemoryStorage: goal, order and fit", () => {
  const items = [
    mem("old-img", { date: y(2019), sizeBytes: 40 * MB }),
    mem("mid-img", { date: y(2021), sizeBytes: 30 * MB }),
    mem("mid-vid", { date: y(2021, 2), mediaType: "video", sizeBytes: 50 * MB }),
    mem("new-img", { date: y(2024), sizeBytes: 20 * MB }),
  ];

  it("fits everything when the goal is large enough", () => {
    const plan = planMemoryStorage(items, GIB);
    expect(plan.fit).toMatchObject({ fitsAll: true, items: 4, bytes: 140 * MB, deferredItems: 0, deferredBytes: 0 });
    expect(plan.byYear.every((r) => r.fit === "all")).toBe(true);
    expect(plan.notes).toEqual([]);
  });

  it("downloads newest years first, images before videos, and stops at the first overflow", () => {
    // order: 2024 img 20, 2021 img 30 (50 total), 2021 vid 50 would make 100 > 90 => stop, 2019 deferred
    const plan = planMemoryStorage(items, 90 * MB);
    expect(plan.priority.map((c) => [c.year, c.type, c.fit])).toEqual([
      [2024, "image", "all"],
      [2021, "image", "all"],
      [2021, "video", "none"],
      [2019, "image", "none"],
    ]);
    expect(plan.fit).toMatchObject({ fitsAll: false, items: 2, bytes: 50 * MB, deferredItems: 2, deferredBytes: 90 * MB });
    expect(plan.fit.fractionOfGoal).toBeCloseTo(140 / 90);
    expect(plan.byYear.map((r) => [r.year, r.fit])).toEqual([
      [2019, "none"],
      [2021, "part"],
      [2024, "all"],
    ]);
    expect(plan.batches.flatMap((b) => b.itemIds)).toEqual(["new-img", "mid-img"]);
    expect(plan.notes).toContainEqual({ code: "over-goal", params: { deferredItems: 2 } });
  });

  it("does not skip ahead to a smaller item after the first overflow", () => {
    const plan = planMemoryStorage(
      [mem("a", { date: y(2024), sizeBytes: 60 * MB }), mem("b", { date: y(2023), sizeBytes: 1 * MB })],
      50 * MB,
    );
    expect(plan.fit.items).toBe(0);
    expect(plan.batches).toEqual([]);
  });

  it("can go oldest first", () => {
    const plan = planMemoryStorage(items, 45 * MB, { order: "oldest-first" });
    expect(plan.order).toBe("oldest-first");
    expect(plan.priority.map((c) => c.year)).toEqual([2019, 2021, 2021, 2024]);
    expect(plan.batches[0]!.itemIds).toEqual(["old-img"]);
  });

  it("puts older dates first inside the same year and type", () => {
    const items = [
      mem("a-newer", { date: y(2022, 8, 20), sizeBytes: MB + 1 }),
      mem("z-older", { date: y(2022, 1, 5), sizeBytes: MB + 2 }),
    ];
    const plan = planMemoryStorage(items, GIB);
    expect(plan.batches[0]!.itemIds).toEqual(["z-older", "a-newer"]);
    expect(planMemoryStorage([...items].reverse(), GIB).batches[0]!.itemIds).toEqual(["z-older", "a-newer"]);
  });

  it("puts images, then videos, then unknown inside a year", () => {
    const items = [
      mem("u", { date: y(2022), mediaType: "unknown", sizeBytes: MB + 1 }),
      mem("v", { date: y(2022), mediaType: "video", sizeBytes: MB + 2 }),
      mem("i", { date: y(2022), mediaType: "image", sizeBytes: MB + 3 }),
    ];
    const plan = planMemoryStorage(items, GIB);
    expect(plan.priority.map((c) => c.type)).toEqual(["image", "video", "unknown"]);
    expect(plan.batches[0]!.itemIds).toEqual(["i", "v", "u"]);
    // Only a goal that holds two items keeps the first two in that order.
    const tight = planMemoryStorage(items, 2 * MB + 5);
    expect(tight.batches.flatMap((b) => b.itemIds)).toEqual(["i", "v"]);
  });

  it("fits a goal that is exactly the total", () => {
    const plan = planMemoryStorage(items, 140 * MB);
    expect(plan.fit.fitsAll).toBe(true);
    expect(plan.fit.fractionOfGoal).toBe(1);
  });
});

describe("planMemoryStorage: batches", () => {
  it("packs in download order and respects the batch size", () => {
    const items = [1, 2, 3, 4, 5].map((n) => mem(`m${n}`, { date: y(2020 + n), sizeBytes: 40 * MB, partIndex: n % 2 + 1 }));
    const plan = planMemoryStorage(items, GIB, { batchBytes: 100 * MB });
    expect(plan.batches.map((b) => b.itemIds)).toEqual([["m5", "m4"], ["m3", "m2"], ["m1"]]);
    for (const b of plan.batches) expect(b.bytes).toBeLessThanOrEqual(100 * MB);
    expect(plan.batches[0]!).toMatchObject({ index: 1, firstYear: 2025, lastYear: 2024, parts: [1, 2] });
    expect(plan.batches.map((b) => b.index)).toEqual([1, 2, 3]);
    expect(plan.batches.reduce((s, b) => s + b.bytes, 0)).toBe(plan.fit.bytes);
  });

  it("fills a batch to exactly the batch size", () => {
    const items = [mem("a", { date: y(2024), sizeBytes: 50 * MB }), mem("b", { date: y(2023), sizeBytes: 50 * MB })];
    const plan = planMemoryStorage(items, GIB, { batchBytes: 100 * MB });
    expect(plan.batches).toHaveLength(1);
    expect(plan.batches[0]!).toMatchObject({ items: 2, bytes: 100 * MB, oversize: false });
    // One byte more starts a second batch.
    const over = planMemoryStorage([...items, mem("c", { date: y(2022), sizeBytes: 1 })], GIB, { batchBytes: 100 * MB });
    expect(over.batches.map((b) => b.itemIds)).toEqual([["a", "b"], ["c"]]);
  });

  it("does not flag an item equal to the batch size as oversize", () => {
    const plan = planMemoryStorage([mem("a", { sizeBytes: 100 * MB })], GIB, { batchBytes: 100 * MB });
    expect(plan.batches).toHaveLength(1);
    expect(plan.batches[0]!.oversize).toBe(false);
    expect(plan.notes.map((n) => n.code)).not.toContain("oversize-items");
    const bigger = planMemoryStorage([mem("a", { sizeBytes: 100 * MB + 1 })], GIB, { batchBytes: 100 * MB });
    expect(bigger.batches[0]!.oversize).toBe(true);
  });

  it("gives an item larger than the batch size its own flagged batch", () => {
    const items = [
      mem("small1", { date: y(2024), sizeBytes: 10 * MB }),
      mem("huge", { date: y(2023), sizeBytes: 500 * MB, mediaType: "video" }),
      mem("small2", { date: y(2022), sizeBytes: 10 * MB }),
    ];
    const plan = planMemoryStorage(items, GIB, { batchBytes: 100 * MB });
    expect(plan.batches.map((b) => [b.itemIds, b.oversize])).toEqual([
      [["small1"], false],
      [["huge"], true],
      [["small2"], false],
    ]);
    expect(plan.notes).toContainEqual({ code: "oversize-items", params: { items: 1 } });
  });
});

describe("planMemoryStorage: dates", () => {
  it("puts missing and implausible dates in an undated group that comes last", () => {
    const items = [
      mem("a", { date: null }),
      mem("b", { date: Number.NaN }),
      mem("c", { date: 0 }),
      mem("d", { date: y(2022) }),
    ];
    const plan = planMemoryStorage(items, GIB);
    expect(plan.byYear.map((r) => [r.year, r.items])).toEqual([[2022, 1], [null, 3]]);
    expect(plan.priority.map((c) => c.year)).toEqual([2022, null]);
    expect(plan.batches.flatMap((b) => b.itemIds)).toEqual(["d", "a", "b", "c"]);
    expect(plan.notes).toContainEqual({ code: "undated-items", params: { items: 3 } });
  });

  it("treats dates after now as undated and says so, but only when now is given", () => {
    const items = [mem("a", { date: y(2030) }), mem("b", { date: y(2020) })];
    const withNow = planMemoryStorage(items, GIB, { now: NOW });
    expect(withNow.byYear.map((r) => r.year)).toEqual([2020, null]);
    expect(withNow.notes).toContainEqual({ code: "future-dates", params: { items: 1 } });
    expect(withNow.notes.map((n) => n.code)).not.toContain("undated-items");

    const without = planMemoryStorage(items, GIB);
    expect(without.byYear.map((r) => r.year)).toEqual([2020, 2030]);
    expect(without.notes).toEqual([]);
  });

  it("keeps a date equal to now and treats now plus one ms as future", () => {
    const plan = planMemoryStorage(
      [mem("a", { date: NOW, sizeBytes: MB + 1 }), mem("b", { date: NOW + 1, sizeBytes: MB + 2 })],
      GIB,
      { now: NOW },
    );
    expect(plan.byYear.map((r) => [r.year, r.items])).toEqual([[2026, 1], [null, 1]]);
    expect(plan.notes).toContainEqual({ code: "future-dates", params: { items: 1 } });
    expect(plan.notes.map((n) => n.code)).not.toContain("undated-items");
  });

  it("accepts dates from 1990-01-01 to 2100-01-01 and treats others as undated", () => {
    const low = Date.UTC(1990, 0, 1);
    const high = Date.UTC(2100, 0, 1);
    const plan = planMemoryStorage(
      [
        mem("a", { date: low, sizeBytes: MB + 1 }),
        mem("b", { date: low - 1, sizeBytes: MB + 2 }),
        mem("c", { date: high, sizeBytes: MB + 3 }),
        mem("d", { date: high + 1, sizeBytes: MB + 4 }),
      ],
      GIB,
    );
    expect(plan.byYear.map((r) => [r.year, r.items])).toEqual([[1990, 1], [2100, 1], [null, 2]]);
  });

  it("buckets a leap day and the last millisecond of a year by UTC", () => {
    const plan = planMemoryStorage(
      [
        mem("a", { date: Date.UTC(2024, 1, 29, 23, 59, 59, 999), sizeBytes: MB + 1 }),
        mem("b", { date: Date.UTC(2023, 11, 31, 23, 59, 59, 999), sizeBytes: MB + 2 }),
        mem("c", { date: Date.UTC(2024, 0, 1, 0, 0, 0, 0), sizeBytes: MB + 3 }),
      ],
      GIB,
    );
    expect(plan.byYear.map((r) => [r.year, r.items])).toEqual([[2023, 1], [2024, 2]]);
    // Oldest first inside the 2024 image group: January 1 before February 29.
    expect(plan.batches[0]!.itemIds).toEqual(["c", "a", "b"]);
  });

  it("buckets years by UTC", () => {
    const plan = planMemoryStorage(
      [mem("a", { date: Date.UTC(2022, 11, 31, 23, 59, 59) }), mem("b", { date: Date.UTC(2023, 0, 1, 0, 0, 0) })],
      GIB,
    );
    expect(plan.byYear.map((r) => r.year)).toEqual([2022, 2023]);
  });
});

describe("planMemoryStorage: duplicates and case", () => {
  it("leaves probable duplicates out of every number", () => {
    const items = [mem("a", { zipPath: "m/x.jpg" }), mem("b", { zipPath: "m/x.jpg" })];
    const plan = planMemoryStorage(items, GIB);
    expect(plan.totals).toMatchObject({ items: 1, knownBytes: MB, duplicatesSkipped: 1 });
    expect(plan.notes).toContainEqual({ code: "duplicates-skipped", params: { items: 1 } });
  });

  it("keeps ids that differ only by case as separate items, in a stable order", () => {
    // Sizes differ so plan.ts does not treat them as probable duplicates of each other.
    const items = [
      mem("Abc", { date: y(2022), sizeBytes: MB + 1 }),
      mem("abc", { date: y(2022), sizeBytes: MB + 2 }),
      mem("ABC", { date: y(2022), sizeBytes: MB + 3 }),
    ];
    const plan = planMemoryStorage(items, GIB);
    expect(plan.totals.items).toBe(3);
    expect(plan.batches[0]!.itemIds).toEqual(["ABC", "Abc", "abc"]);
    expect(planMemoryStorage([...items].reverse(), GIB).batches[0]!.itemIds).toEqual(["ABC", "Abc", "abc"]);
  });

  it("breaks ties by id so the result does not depend on input order", () => {
    const items = Array.from({ length: 30 }, (_, i) =>
      mem(`id-${String(i).padStart(2, "0")}`, { date: y(2022), sizeBytes: 1000 + i }),
    );
    const a = planMemoryStorage(items, 10 * MB, { batchBytes: 4500 });
    const b = planMemoryStorage([...items].reverse(), 10 * MB, { batchBytes: 4500 });
    expect(b).toEqual(a);
    expect(a.batches[0]!.itemIds).toEqual(["id-00", "id-01", "id-02", "id-03"]);
  });
});

describe("planMemoryStorage: bad input", () => {
  it("copes with junk media types and part numbers", () => {
    const items = [
      mem("a", { mediaType: "gif" as never, partIndex: 0 }),
      mem("b", { partIndex: 1.5, sizeBytes: MB + 1 }),
      mem("c", { partIndex: -2, sizeBytes: MB + 2 }),
    ];
    const plan = planMemoryStorage(items, GIB);
    expect(plan.byType[2]!).toMatchObject({ type: "unknown", items: 1 });
    expect(plan.byPart).toEqual([{ part: null, items: 3, knownBytes: 3 * MB + 3, unsized: 0 }]);
    expect(plan.batches[0]!.parts).toEqual([]);
  });

  it("copes with a non-finite now", () => {
    expect(() => planMemoryStorage([mem("a")], GIB, { now: Number.NaN })).not.toThrow();
  });
});

describe("planMemoryStorage: scale", () => {
  it("handles 20,000 items quickly and consistently", () => {
    const n = 20_000;
    const items: MemoryItem[] = [];
    for (let i = 0; i < n; i++) {
      items.push(
        mem(`m${i}`, {
          date: y(2015 + (i % 11), i % 12, 1 + (i % 28)) + i * 1000,
          mediaType: i % 5 === 0 ? "video" : "image",
          sizeBytes: i % 97 === 0 ? undefined : (1 + (i % 50)) * 100_000,
          partIndex: 1 + (i % 7),
        }),
      );
    }
    const t0 = performance.now();
    const plan = planMemoryStorage(items, 400 * MB, { batchBytes: 50 * MB, now: NOW });
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(5000);
    expect(plan.totals.items).toBe(n);
    expect(plan.byYear.reduce((s, r) => s + r.items, 0)).toBe(n);
    expect(plan.byType.reduce((s, r) => s + r.items, 0)).toBe(n);
    expect(plan.byPart.reduce((s, r) => s + r.items, 0)).toBe(n);
    expect(plan.fit.bytes).toBeLessThanOrEqual(400 * MB);
    expect(plan.batches.flatMap((b) => b.itemIds)).toHaveLength(plan.fit.items);
    for (const b of plan.batches) expect(b.bytes).toBeLessThanOrEqual(50 * MB);
    expect(plan.totals.isLowerBound).toBe(true);
  });
});

describe("planMemoryStorage: privacy", () => {
  const CANARY = "zz_canary_user_4471";

  it("lists a canary only in batches, and only through the id of an item that fits", () => {
    const items = [
      // Sized and fits: its id is the one deliberate place the canary may appear.
      mem(`id-${CANARY}`, {
        date: y(2024),
        sizeBytes: MB,
        zipPath: `memories/${CANARY}/a.jpg`,
        downloadUrl: `https://example.invalid/${CANARY}`,
      }),
      mem("id-2", { date: y(2023), sizeBytes: MB }),
      // Left out of the batches (over the goal, unsized, future): the canary must not show up.
      mem(`deferred-${CANARY}`, { date: y(2020), sizeBytes: 50 * MB }),
      mem(`unsized-${CANARY}`, { date: null, sizeBytes: undefined }),
      mem(`future-${CANARY}`, { date: y(2040), sizeBytes: undefined }),
    ];
    const plan = planMemoryStorage(items, 3 * MB, { now: NOW, batchBytes: 100 * MB });
    const { batches, ...rest } = plan;
    expect(batches.flatMap((b) => b.itemIds)).toEqual([`id-${CANARY}`, "id-2"]);
    expect(JSON.stringify(batches).split(CANARY)).toHaveLength(2);
    expect(JSON.stringify(plan).split(CANARY)).toHaveLength(2);
    for (const [name, value] of Object.entries(rest)) {
      expect(JSON.stringify(value), name).not.toContain(CANARY);
    }
    expect(plan.notes.length).toBeGreaterThan(0);
    for (const note of plan.notes) {
      expect(typeof note.code).toBe("string");
      expect(Object.values(note.params).every((v) => typeof v === "number")).toBe(true);
    }
    // The URL and the path never appear anywhere, batches included.
    expect(JSON.stringify(plan)).not.toContain("example.invalid");
    expect(JSON.stringify(plan)).not.toContain("memories/");
  });
});
