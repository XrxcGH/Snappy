import { describe, expect, it } from "vitest";
import { claimUniquePath, memoryFileName, planMemories, storageMeter } from "../../src/memories/plan.ts";
import type { MemoryItem } from "../../src/types.ts";
import { DAY_MS } from "../../src/util.ts";

const GIB = 1024 ** 3;
const NOW = Date.UTC(2024, 5, 1, 0, 0, 0);

function mem(id: string, over: Partial<MemoryItem> = {}): MemoryItem {
  return { id, date: Date.UTC(2023, 3, 1, 12, 30, 0), mediaType: "image", ...over };
}

describe("memoryFileName", () => {
  it("formats a UTC stamp, type and 4-digit ordinal", () => {
    const item = mem("a", { date: Date.UTC(2023, 3, 1, 9, 5, 7) });
    expect(memoryFileName(item, 7)).toBe("2023-04-01_090507_image_0007.jpg");
  });

  it("uses mp4 for video and bin for unknown when there is no zipPath", () => {
    expect(memoryFileName(mem("v", { mediaType: "video" }), 1)).toMatch(/_video_0001\.mp4$/);
    expect(memoryFileName(mem("u", { mediaType: "unknown" }), 1)).toMatch(/_unknown_0001\.bin$/);
  });

  it("prefers a sane zipPath extension, lower-cased, including backslash paths", () => {
    expect(memoryFileName(mem("a", { zipPath: "memories/IMG_1.PNG" }), 1)).toMatch(/\.png$/);
    expect(memoryFileName(mem("a", { zipPath: "memories\\clip.MoV" }), 1)).toMatch(/\.mov$/);
  });

  it("falls back to the media type when the extension is unsafe or missing", () => {
    for (const zipPath of ["a/b.j p g", "a/b.toolongext", "a/b.", "a/noext", "a/b.jp/g", "../..", "x.<script>", "a/b.é"]) {
      expect(memoryFileName(mem("a", { zipPath }), 1)).toMatch(/\.jpg$/);
    }
  });

  it("numbers undated items with an 'undated' date part", () => {
    expect(memoryFileName(mem("a", { date: null }), 12)).toBe("undated_image_0012.jpg");
  });

  it("treats implausible dates as undated", () => {
    expect(memoryFileName(mem("a", { date: 0 }), 1)).toMatch(/^undated_/);
    expect(memoryFileName(mem("a", { date: Number.NaN }), 1)).toMatch(/^undated_/);
    expect(memoryFileName(mem("a", { date: 8.64e15 }), 1)).toMatch(/^undated_/);
  });

  it("sanitises bad ordinals and never emits separators", () => {
    const item = mem("a");
    expect(memoryFileName(item, -5)).toMatch(/_0000\./);
    expect(memoryFileName(item, Number.NaN)).toMatch(/_0000\./);
    expect(memoryFileName(item, 12345)).toMatch(/_12345\./);
    expect(memoryFileName(item, 1e30)).toMatch(/_9007199254740991\./); // no "1e+30" exponent form
    expect(memoryFileName(mem("a", { zipPath: "../../etc/passwd" }), 1)).not.toMatch(/[\\/]/);
  });

  it("ignores an unrecognised runtime mediaType", () => {
    const item = { ...mem("a"), mediaType: "audio" } as unknown as MemoryItem;
    expect(memoryFileName(item, 1)).toMatch(/_unknown_0001\.bin$/);
  });
});

describe("planMemories layouts", () => {
  const items = [
    mem("1", { date: Date.UTC(2023, 3, 1, 12, 30, 0) }),
    mem("2", { date: Date.UTC(2022, 11, 31, 23, 59, 59), mediaType: "video" }),
    mem("3", { date: null }),
  ];

  it("defaults to year-month", () => {
    const paths = planMemories(items).entries.map((e) => e.relativePath);
    expect(paths).toEqual([
      "2023/2023-04/2023-04-01_123000_image_0001.jpg",
      "2022/2022-12/2022-12-31_235959_video_0002.mp4",
      "undated/undated_image_0003.jpg",
    ]);
  });

  it("supports year", () => {
    const paths = planMemories(items, { layout: "year" }).entries.map((e) => e.relativePath);
    expect(paths).toEqual([
      "2023/2023-04-01_123000_image_0001.jpg",
      "2022/2022-12-31_235959_video_0002.mp4",
      "undated/undated_image_0003.jpg",
    ]);
  });

  it("supports flat, still isolating undated items", () => {
    const paths = planMemories(items, { layout: "flat" }).entries.map((e) => e.relativePath);
    expect(paths).toEqual([
      "2023-04-01_123000_image_0001.jpg",
      "2022-12-31_235959_video_0002.mp4",
      "undated/undated_image_0003.jpg",
    ]);
  });

  it("falls back to year-month for an invalid layout value", () => {
    const plan = planMemories(items, { layout: "weird" as never });
    expect(plan.entries[0]?.relativePath.startsWith("2023/2023-04/")).toBe(true);
  });

  it("uses UTC at day boundaries regardless of local timezone", () => {
    const plan = planMemories([mem("a", { date: Date.UTC(2023, 0, 1, 0, 0, 0) })]);
    expect(plan.entries[0]?.relativePath).toBe("2023/2023-01/2023-01-01_000000_image_0001.jpg");
  });

  it("only emits forward-slash, relative, traversal-free paths", () => {
    const evil = [
      mem("a", { zipPath: "../../Windows/System32/evil.exe" }),
      mem("b", { zipPath: "C:\\Windows\\x.dll", date: null }),
      mem("c", { zipPath: "/etc/passwd" }),
      mem("d", { zipPath: "CON.jpg" }),
    ];
    for (const e of planMemories(evil).entries) {
      expect(e.relativePath).not.toMatch(/\\|\.\.|^\/|:/);
      expect(e.relativePath).toMatch(/^[0-9a-z/_.-]+$/);
    }
  });

  it("keeps input order and does not mutate the input", () => {
    const copy = JSON.parse(JSON.stringify(items)) as MemoryItem[];
    const plan = planMemories(copy);
    expect(plan.entries.map((e) => e.item.id)).toEqual(["1", "2", "3"]);
    expect(copy).toEqual(items);
  });

  it("handles an empty list", () => {
    const plan = planMemories([]);
    expect(plan.entries).toEqual([]);
    expect(plan.counts.total).toBe(0);
    expect(plan.meter.knownBytes).toBe(0);
    expect(plan.meter.projectedCapAt).toBeNull();
  });
});

describe("path uniqueness", () => {
  it("appends -2, -3 case-insensitively before the extension", () => {
    const used = new Set<string>();
    expect(claimUniquePath(used, "2023/a.jpg")).toBe("2023/a.jpg");
    expect(claimUniquePath(used, "2023/A.JPG")).toBe("2023/A-2.JPG");
    expect(claimUniquePath(used, "2023/a.jpg")).toBe("2023/a-3.jpg");
    expect(claimUniquePath(used, "2023/a-2.jpg")).toBe("2023/a-2-2.jpg");
  });

  it("does not mistake a dot in a folder for an extension", () => {
    const used = new Set<string>();
    claimUniquePath(used, "v1.2/noext");
    expect(claimUniquePath(used, "v1.2/noext")).toBe("v1.2/noext-2");
  });

  it("gives every planned path (originals and duplicates) a distinct lower-case key", () => {
    const items = Array.from({ length: 500 }, (_, i) =>
      mem(String(i), { date: Date.UTC(2023, 0, 1) + (i % 3) * 1000, mediaType: i % 2 ? "video" : "image", downloadUrl: i % 10 === 0 ? "same" : undefined }),
    );
    const plan = planMemories(items);
    const all = [...plan.entries, ...plan.duplicates].map((e) => e.relativePath.toLowerCase());
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("duplicates", () => {
  it("matches the same non-empty downloadUrl, keeping the earliest-listed", () => {
    const plan = planMemories([
      mem("a", { downloadUrl: "https://x/y?id=1" }),
      mem("b", { downloadUrl: "https://x/y?id=2" }),
      mem("c", { downloadUrl: "https://x/y?id=1", date: null }),
    ]);
    expect(plan.entries.map((e) => e.item.id)).toEqual(["a", "b"]);
    expect(plan.duplicates.map((d) => [d.item.id, d.duplicateOf])).toEqual([["c", "a"]]);
    expect(plan.counts.total).toBe(2);
  });

  it("does not treat URLs differing only in query tokens as duplicates (exact match is the safe choice)", () => {
    const plan = planMemories([
      mem("a", { downloadUrl: "https://x/y?id=1&sig=AAA" }),
      mem("b", { downloadUrl: "https://x/y?id=1&sig=BBB" }),
    ]);
    expect(plan.duplicates).toEqual([]);
  });

  it("ignores empty/blank URLs and paths", () => {
    const plan = planMemories([
      mem("a", { downloadUrl: "", zipPath: "  " }),
      mem("b", { downloadUrl: "   ", zipPath: "" }),
    ]);
    expect(plan.duplicates).toEqual([]);
  });

  it("matches the same zipPath (slash-normalised)", () => {
    const plan = planMemories([mem("a", { zipPath: "memories/1.jpg" }), mem("b", { zipPath: "memories\\1.jpg" })]);
    expect(plan.duplicates[0]?.duplicateOf).toBe("a");
  });

  it("matches date+type+size only when all three are present", () => {
    const base = { sizeBytes: 100 };
    const plan = planMemories([
      mem("a", base),
      mem("b", base), // dup of a
      mem("c", { ...base, sizeBytes: undefined }),
      mem("d", { ...base, sizeBytes: undefined }), // size missing => not matched
      mem("g", { ...base, date: null }),
      mem("h", { ...base, date: null }), // date missing => not matched
      mem("i", { ...base, mediaType: "unknown" }),
      mem("j", { ...base, mediaType: "unknown" }), // type unknown => not matched
      mem("k", { ...base, mediaType: "video" }), // different type
      mem("l", { ...base, date: Date.UTC(2023, 3, 1, 12, 30, 1) }), // different date
      mem("m", { ...base, sizeBytes: 101 }), // different size
    ]);
    expect(plan.duplicates.map((d) => [d.item.id, d.duplicateOf])).toEqual([["b", "a"]]);
  });

  it("collapses chains onto the earliest original", () => {
    const plan = planMemories([
      mem("a", { downloadUrl: "u1" }),
      mem("b", { downloadUrl: "u1", zipPath: "z" }),
      mem("c", { zipPath: "z" }),
    ]);
    expect(plan.duplicates.map((d) => [d.item.id, d.duplicateOf])).toEqual([
      ["b", "a"],
      ["c", "a"],
    ]);
  });

  it("excludes duplicates from counts and storage", () => {
    const plan = planMemories([
      mem("a", { downloadUrl: "u", sizeBytes: 10 }),
      mem("b", { downloadUrl: "u", sizeBytes: 10 }),
    ]);
    expect(plan.counts.total).toBe(1);
    expect(plan.meter.knownBytes).toBe(10);
    expect(storageMeter([mem("a", { downloadUrl: "u", sizeBytes: 10 }), mem("b", { downloadUrl: "u", sizeBytes: 10 })]).knownBytes).toBe(10);
  });
});

describe("counts", () => {
  it("tallies types and dates (and has no location field)", () => {
    const plan = planMemories([
      mem("1"),
      mem("2", { mediaType: "video", date: null }),
      mem("3", { mediaType: "unknown" }),
      mem("4", { mediaType: "video", date: null }),
      mem("5", { date: Number.NaN }),
    ]);
    expect(plan.counts).toEqual({ total: 5, images: 2, videos: 2, unknown: 1, withDate: 2 });
  });

  it("ignores unexpected extra fields (e.g. a location) when deriving anything", () => {
    const extra = { ...mem("a"), location: "12.3456,65.4321" } as unknown as MemoryItem;
    const plan = planMemories([extra, { ...extra, id: "b" }]);
    expect(plan.duplicates).toEqual([]); // extras never feed duplicate detection
    expect(plan.entries[0]?.relativePath).not.toContain("3456");
    expect(Object.keys(plan.counts).sort()).toEqual(["images", "total", "unknown", "videos", "withDate"]);
  });
});

describe("storageMeter", () => {
  it("defaults the cap to 5 GiB and reports fraction and unknown sizes", () => {
    const m = storageMeter([mem("a", { sizeBytes: GIB }), mem("b", { sizeBytes: 1.5 * GIB }), mem("c")]);
    expect(m.capBytes).toBe(5 * GIB);
    expect(m.knownBytes).toBe(2.5 * GIB);
    expect(m.unknownSizeCount).toBe(1);
    expect(m.fractionOfCap).toBeCloseTo(0.5, 10);
  });

  it("treats negative/NaN sizes as unknown", () => {
    const m = storageMeter([mem("a", { sizeBytes: -1 }), mem("b", { sizeBytes: Number.NaN }), mem("c", { sizeBytes: 5 })]);
    expect(m.knownBytes).toBe(5);
    expect(m.unknownSizeCount).toBe(2);
  });

  it("honours a custom cap and ignores invalid ones", () => {
    expect(storageMeter([mem("a", { sizeBytes: 50 })], { capBytes: 100 }).fractionOfCap).toBe(0.5);
    expect(storageMeter([], { capBytes: 0 }).capBytes).toBe(5 * GIB);
    expect(storageMeter([], { capBytes: Number.NaN }).capBytes).toBe(5 * GIB);
  });

  it("computes growth and projection with a fixed now", () => {
    // 100 bytes/day for the 100 days before NOW: one 100-byte item per day.
    const items = Array.from({ length: 100 }, (_, i) => mem(`i${i}`, { date: NOW - (100 - i) * DAY_MS, sizeBytes: 100 }));
    const m = storageMeter(items, { capBytes: 20_000, now: NOW });
    expect(m.knownBytes).toBe(10_000);
    expect(m.growthBytesPerDay).toBeCloseTo(100, 6); // 10_000 bytes over 100 days to now
    // 10_000 bytes remaining at 100/day => 100 days after now.
    expect(m.projectedCapAt).toBe(NOW + 100 * DAY_MS);
    expect(m.fractionOfCap).toBe(0.5);
  });

  it("limits growth to the lookback window", () => {
    const old = mem("old", { date: NOW - 800 * DAY_MS, sizeBytes: 1_000_000 });
    const recent = [mem("r1", { date: NOW - 60 * DAY_MS, sizeBytes: 600 }), mem("r2", { date: NOW - 1 * DAY_MS, sizeBytes: 600 })];
    const m = storageMeter([old, ...recent], { now: NOW, lookbackDays: 90 });
    expect(m.growthBytesPerDay).toBeCloseTo(1200 / 60, 6);
    expect(m.knownBytes).toBe(1_001_200);
  });

  it("returns null growth with under 30 days of history", () => {
    const items = [mem("a", { date: NOW - 10 * DAY_MS, sizeBytes: 5 }), mem("b", { date: NOW - 1 * DAY_MS, sizeBytes: 5 })];
    const m = storageMeter(items, { now: NOW });
    expect(m.growthBytesPerDay).toBeNull();
    expect(m.projectedCapAt).toBeNull();
  });

  it("measures the span up to now, so a user who stopped saving gets a lower rate", () => {
    const burst = [mem("a", { date: NOW - 100 * DAY_MS, sizeBytes: 1000 }), mem("b", { date: NOW - 99 * DAY_MS, sizeBytes: 1000 })];
    const m = storageMeter(burst, { now: NOW });
    expect(m.growthBytesPerDay).toBeCloseTo(2000 / 100, 6);
  });

  it("ignores undated, unsized and future-dated items for growth", () => {
    const items = [
      mem("a", { date: NOW - 90 * DAY_MS, sizeBytes: 900 }),
      mem("undated", { date: null, sizeBytes: 1e9 }),
      mem("nosize", { date: NOW - 200 * DAY_MS }),
      mem("future", { date: NOW + 30 * DAY_MS, sizeBytes: 1e9 }),
    ];
    const m = storageMeter(items, { now: NOW });
    expect(m.growthBytesPerDay).toBeCloseTo(10, 6);
  });

  it("returns null projection when already at or over the cap, with fraction > 1", () => {
    const items = [mem("a", { date: NOW - 90 * DAY_MS, sizeBytes: 600 }), mem("b", { date: NOW - 1 * DAY_MS, sizeBytes: 600 })];
    const over = storageMeter(items, { capBytes: 1000, now: NOW });
    expect(over.fractionOfCap).toBeCloseTo(1.2, 10);
    expect(over.growthBytesPerDay).not.toBeNull();
    expect(over.projectedCapAt).toBeNull();
    expect(storageMeter(items, { capBytes: 1200, now: NOW }).projectedCapAt).toBeNull();
  });

  it("returns null projection for zero growth and for absurdly distant dates", () => {
    const zero = [mem("a", { date: NOW - 90 * DAY_MS, sizeBytes: 0 }), mem("b", { date: NOW - 1 * DAY_MS, sizeBytes: 0 })];
    expect(storageMeter(zero, { now: NOW }).projectedCapAt).toBeNull();
    const tiny = [mem("a", { date: NOW - 90 * DAY_MS, sizeBytes: 1 })];
    expect(storageMeter(tiny, { now: NOW }).projectedCapAt).toBeNull();
  });

  it("without now, still reports growth against the newest memory but no projection", () => {
    const items = [mem("a", { date: NOW - 90 * DAY_MS, sizeBytes: 900 }), mem("b", { date: NOW - 60 * DAY_MS, sizeBytes: 100 })];
    const m = storageMeter(items);
    expect(m.growthBytesPerDay).toBeCloseTo(1000 / 30, 6);
    expect(m.projectedCapAt).toBeNull();
  });

  it("planMemories passes cap, now and lookback to the meter", () => {
    const items = [mem("a", { date: NOW - 90 * DAY_MS, sizeBytes: 900 }), mem("b", { date: NOW - 1 * DAY_MS, sizeBytes: 100 })];
    const plan = planMemories(items, { capBytes: 2000, now: NOW });
    expect(plan.meter.capBytes).toBe(2000);
    expect(plan.meter.projectedCapAt).toBe(NOW + Math.round((1000 / (1000 / 90)) * DAY_MS));
  });
});

describe("privacy", () => {
  it("never puts a download URL into paths or any serialised plan output apart from the item itself", () => {
    const url = "https://canary.invalid/dl?token=CANARY123";
    const plan = planMemories([mem("a", { downloadUrl: url }), mem("b", { downloadUrl: url })]);
    expect(JSON.stringify(plan.meter)).not.toContain("CANARY");
    expect(JSON.stringify(plan.counts)).not.toContain("CANARY");
    for (const e of [...plan.entries, ...plan.duplicates]) expect(e.relativePath).not.toContain("CANARY");
  });

  it("does not throw on junk items and never echoes the URL in an error", () => {
    const junk = [
      { id: "x", date: "2023" as unknown as number, mediaType: 5, downloadUrl: 42, zipPath: {}, sizeBytes: "9" },
      { id: "y", date: null, mediaType: "image", downloadUrl: "https://canary.invalid/CANARY", sizeBytes: Infinity },
    ] as unknown as MemoryItem[];
    expect(() => planMemories(junk, { now: NOW })).not.toThrow();
  });
});

describe("scale and unicode", () => {
  it("plans 100k items quickly with unique paths", () => {
    const n = 100_000;
    const items: MemoryItem[] = new Array<MemoryItem>(n);
    for (let i = 0; i < n; i++) {
      items[i] = {
        id: `m${i}`,
        date: i % 7 === 0 ? null : Date.UTC(2015, 0, 1) + (i % 3000) * 3_600_000,
        mediaType: i % 3 === 0 ? "video" : "image",
        downloadUrl: i % 50 === 0 ? `https://x/${i - 50}` : `https://x/${i}`,
        sizeBytes: 1000 + (i % 100),
      };
    }
    const t0 = performance.now();
    const plan = planMemories(items, { now: NOW });
    const ms = performance.now() - t0;
    // A generous bound: it exists to catch quadratic behavior, and must not flake when the whole suite runs in parallel.
    expect(ms).toBeLessThan(5000);
    expect(plan.entries.length + plan.duplicates.length).toBe(n);
    expect(plan.duplicates.length).toBeGreaterThan(0);
    const paths = new Set(plan.entries.map((e) => e.relativePath.toLowerCase()));
    expect(paths.size).toBe(plan.entries.length);
  });

  it("never embeds unicode or special input text in paths", () => {
    const plan = planMemories([mem("😀/../é", { zipPath: "memories/日本語.jpg" }), mem("b", { zipPath: "x/日本語.日本" })]);
    for (const e of plan.entries) expect(e.relativePath).toMatch(/^[0-9a-z/_.-]+$/);
  });
});
