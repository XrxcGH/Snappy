/**
 * Pairing the Memories list with bundled media by stored zip time. Synthetic data only: names are
 * made-up dates and ids, times are generated, nothing is read from a real export.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyMemoryMedia, pairMemories } from "../../src/index.ts";
import type { MemoryItem, MemoryMediaFile, PairingResult } from "../../src/index.ts";

interface Entry {
  name: string;
  size: number;
  mtimeUtcMs?: number;
  mtimeDosMs?: number;
}

const HOUR = 3_600_000;
const BASE = Date.UTC(2019, 0, 1);
const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const uuidOf = (k: number): string => `${(0xa0000000 + k).toString(16)}-0000-4000-8000-${k.toString(16).padStart(12, "0")}`;
/** The 2-second DOS reading of a zipper whose wall clock is `offsetHours` from UTC, `skewS` seconds off. */
const dosOf = (utcMs: number, offsetHours: number, skewS = 0): number => Math.floor((utcMs + offsetHours * HOUR + skewS * 1000) / 2000) * 2000;

interface Spec {
  count: number;
  /** Seconds between item k-1 and item k (always >= 5, so no two items are within the DOS tolerance). */
  spacing: (k: number) => number;
  isVideo: (k: number) => boolean;
  hasFile: (k: number) => boolean;
  times: "utc" | "dos";
  /** Zipper clock offset in whole hours, for dos times. */
  offsetHours?: (k: number) => number;
  skewS?: number;
  overlays?: number;
  parts?: number;
}

interface Built {
  items: MemoryItem[];
  entries: Entry[][];
  fileOf: Map<string, string>; // item id -> uuid of its main file
  withoutFile: Set<string>;
  overlayUuids: string[];
}

function build(spec: Spec): Built {
  const items: MemoryItem[] = [];
  const parts = Math.max(1, spec.parts ?? 1);
  const entries: Entry[][] = Array.from({ length: parts }, () => [{ name: "memories/index.html", size: 900 }]);
  const fileOf = new Map<string, string>();
  const withoutFile = new Set<string>();
  const overlayUuids: string[] = [];
  let at = BASE;
  for (let k = 0; k < spec.count; k++) {
    at += spec.spacing(k) * 1000;
    const video = spec.isVideo(k);
    const id = `m${k}`;
    items.push({ id, date: at, mediaType: video ? "video" : "image" });
    if (!spec.hasFile(k)) {
      withoutFile.add(id);
      continue;
    }
    const uuid = uuidOf(k);
    fileOf.set(id, uuid.toUpperCase());
    const times = (): Pick<Entry, "mtimeUtcMs" | "mtimeDosMs"> =>
      spec.times === "utc" ? { mtimeUtcMs: at, mtimeDosMs: dosOf(at, -8) } : { mtimeDosMs: dosOf(at, spec.offsetHours?.(k) ?? 0, spec.skewS ?? 0) };
    const part = entries[k % parts] as Entry[];
    part.push({ name: `memories/${isoDay(at)}_${uuid}-main.${video ? "mp4" : "jpg"}`, size: 1000 + k, ...times() });
    if (!video && overlayUuids.length < (spec.overlays ?? 0)) {
      overlayUuids.push(uuid.toUpperCase());
      part.push({ name: `memories/${isoDay(at)}_${uuid}-overlay.png`, size: 50, ...times() });
    }
  }
  return { items, entries, fileOf, withoutFile, overlayUuids };
}

const classifyAll = (built: Built): MemoryMediaFile[] => built.entries.flatMap((list, i) => classifyMemoryMedia(list, i + 2));
const uuidFromPath = (path: string): string => (/[0-9a-f]{8}-[0-9a-f-]{27}/i.exec(path)?.[0] ?? "").toUpperCase();

/** Every pair links an item to the file that was built for it. */
function expectCorrectPairs(result: PairingResult, built: Built): void {
  for (const p of result.pairs) {
    expect(uuidFromPath(p.file.path)).toBe(built.fileOf.get(p.itemId));
    for (const o of p.overlays) expect(uuidFromPath(o.path)).toBe(uuidFromPath(p.file.path));
  }
}

/** The real-shaped scenario: 711 entries (520 image, 191 video), 498 main files, 15 overlays, 213 entries without a file. */
const realShaped = (times: "utc" | "dos", extra: Partial<Spec> = {}): Spec => ({
  count: 711,
  spacing: (k) => 18_000 + ((k * 37) % 3600),
  isVideo: (k) => (k * 7) % 711 < 191, // a bijection, so exactly 191 videos
  hasFile: (k) => {
    // 112 images and 101 videos have no file: ranks within each type, again via bijections
    const video = (k * 7) % 711 < 191;
    return !(video ? (rankInType(k, true) * 3) % 191 < 101 : (rankInType(k, false) * 3) % 520 < 112);
  },
  times,
  overlays: 15,
  parts: 2,
  ...extra,
});

function rankInType(k: number, video: boolean): number {
  let rank = 0;
  for (let j = 0; j < k; j++) if (((j * 7) % 711 < 191) === video) rank++;
  return rank;
}

afterEach(() => vi.restoreAllMocks());

// ------------------------------------------------------------------ classify ---

describe("classifyMemoryMedia", () => {
  const e = (name: string, rest: Partial<Entry> = {}): Entry => ({ name, size: 10, ...rest });
  const id = "0a1b2c3d-1111-4222-8333-444455556666";

  it("keeps only files under a folder named memories (any depth, any case) and skips html pages", () => {
    const out = classifyMemoryMedia(
      [
        e(`memories/2023-04-01_${id}-main.jpg`),
        e(`Memories/sub/2023-04-02_${id}-main.mp4`),
        e(`mydata~1-2/MEMORIES/2023-04-03_${id}-overlay.png`),
        e("memories/index.html"),
        e("memories/Page.HTM"),
        e(`chat_media/2023-04-01_${id}-main.jpg`),
        e("json/memories_history.json"),
        e(`memories_backup/2023-04-01_${id}-main.jpg`),
        e("memories"), // a file named memories is not a folder
        e("memories/"), // a directory entry
        e(`memories\\win\\2023-04-04_${id}-main.jpg`),
      ],
      2,
    );
    expect(out.map((f) => f.path)).toEqual([
      `memories/2023-04-01_${id}-main.jpg`,
      `Memories/sub/2023-04-02_${id}-main.mp4`,
      `mydata~1-2/MEMORIES/2023-04-03_${id}-overlay.png`,
      `memories\\win\\2023-04-04_${id}-main.jpg`,
    ]);
    expect(out.every((f) => f.part === 2)).toBe(true);
  });

  it("derives role, upper-case id and day from the name", () => {
    const [main, overlay, thumb, thumbnail, odd, plain, badDay] = classifyMemoryMedia(
      [
        e(`memories/2023-04-01_${id}-main.jpg`),
        e(`memories/2023-04-01_${id}-OVERLAY.PNG`),
        e(`memories/2023-04-01_${id}-thumb.jpg`),
        e(`memories/2023-04-01_${id}-thumbnail.jpg`),
        e(`memories/2023-04-01_${id}-preview.jpg`),
        e("memories/photo.jpg"),
        e(`memories/2023-13-45_${id}-main.jpg`),
      ],
      3,
    ) as MemoryMediaFile[];
    expect([main?.role, overlay?.role, thumb?.role, thumbnail?.role, odd?.role, plain?.role]).toEqual(["main", "overlay", "other", "other", "other", "other"]);
    expect(main?.idInName).toBe(id.toUpperCase());
    expect(main?.nameDay).toBe("2023-04-01");
    expect(main?.part).toBe(3);
    expect(plain?.idInName).toBeUndefined();
    expect(plain?.nameDay).toBeUndefined();
    expect(badDay?.nameDay).toBeUndefined();
  });

  it("prefers the UTC time, then the DOS time, and sanitizes sizes", () => {
    const [utc, dos, none, bad] = classifyMemoryMedia(
      [
        e(`memories/a-${id}-main.jpg`, { mtimeUtcMs: 5_000, mtimeDosMs: 9_000 }),
        e(`memories/b-${id}-main.jpg`, { mtimeDosMs: 9_000 }),
        e(`memories/c-${id}-main.jpg`),
        { name: `memories/d-${id}-main.jpg`, size: Infinity, mtimeUtcMs: Number.NaN },
      ],
      2,
    ) as MemoryMediaFile[];
    expect([utc?.timeKind, utc?.timeMs]).toEqual(["utc", 5_000]);
    expect([dos?.timeKind, dos?.timeMs]).toEqual(["dos", 9_000]);
    expect([none?.timeKind, none?.timeMs]).toEqual(["none", undefined]);
    expect([bad?.timeKind, bad?.size]).toEqual(["none", 0]);
  });

  it("ignores garbage entries without throwing", () => {
    const garbage = [null, undefined, 42, {}, { name: 7 }, { name: "" }, { name: "/" }] as unknown as Entry[];
    expect(classifyMemoryMedia(garbage, 1)).toEqual([]);
    expect(classifyMemoryMedia([], 1)).toEqual([]);
  });
});

// ------------------------------------------------------------- the real case ---

describe("pairMemories with extended (UTC) times", () => {
  const built = build(realShaped("utc"));
  const files = classifyAll(built);
  const result = pairMemories(built.items, files);

  it("builds the scenario the owner's export showed", () => {
    expect(built.items).toHaveLength(711);
    expect(built.items.filter((i) => i.mediaType === "image")).toHaveLength(520);
    expect(built.items.filter((i) => i.mediaType === "video")).toHaveLength(191);
    expect(built.withoutFile.size).toBe(213);
    expect([...built.withoutFile].filter((id) => built.items.find((i) => i.id === id)?.mediaType === "image")).toHaveLength(112);
    expect(files.filter((f) => f.role === "main")).toHaveLength(498);
    expect(files.filter((f) => f.role === "overlay")).toHaveLength(15);
    expect(new Set(files.filter((f) => f.role === "main").map((f) => f.timeMs)).size).toBe(498);
  });

  it("pairs all 498 main files exactly, leaves the 213 entries without a file, attaches 15 overlays", () => {
    expect(result.method).toBe("utc-time");
    expect(result.offsetHours).toBe(0);
    expect(result.pairs).toHaveLength(498);
    expect(result.pairs.every((p) => p.method === "exact-time")).toBe(true);
    expect(new Set(result.unmatchedItemIds)).toEqual(built.withoutFile);
    expect(result.unmatchedFiles).toEqual([]);
    expect(result.summary).toEqual({ items: 711, mainFiles: 498, paired: 498, unmatchedItems: 213, unmatchedFiles: 0, overlays: 15, ambiguous: 0 });
    expectCorrectPairs(result, built);
    expect(result.pairs.filter((p) => p.overlays.length > 0).map((p) => uuidFromPath(p.file.path)).sort()).toEqual([...built.overlayUuids].sort());
  });

  it("uses each item and file once", () => {
    expect(new Set(result.pairs.map((p) => p.itemId)).size).toBe(498);
    expect(new Set(result.pairs.map((p) => p.file.path)).size).toBe(498);
  });

  it("does not depend on the order the files or items arrive in", () => {
    const reversed = pairMemories([...built.items].reverse(), [...files].reverse());
    const mapping = (r: PairingResult) => new Map(r.pairs.map((p) => [p.itemId, p.file.path]));
    expect(mapping(reversed)).toEqual(mapping(result));
    expect(new Set(reversed.unmatchedItemIds)).toEqual(new Set(result.unmatchedItemIds));
    expect(pairMemories(built.items, files)).toEqual(result);
  });

  it("returns pairs and unmatched ids in input order", () => {
    const order = new Map(built.items.map((item, i) => [item.id, i]));
    const positions = result.pairs.map((p) => order.get(p.itemId) as number);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    const unmatched = result.unmatchedItemIds.map((id) => order.get(id) as number);
    expect(unmatched).toEqual([...unmatched].sort((a, b) => a - b));
  });

  it("matches to the exact second: one second of skew leaves the UTC stage with nothing", () => {
    const skewed = files.map((f) => (f.timeKind === "utc" ? { ...f, timeMs: (f.timeMs as number) + 1000 } : f));
    const r = pairMemories(built.items, skewed);
    // Not guessed: it falls back to the flagged day-and-type pairing, and says so.
    expect(r.method).not.toBe("utc-time");
    expect(r.pairs.every((p) => p.method === "date-and-type")).toBe(true);
  });
});

// ------------------------------------------------------------ DOS-only times ---

describe("pairMemories with DOS-only times", () => {
  it("detects a whole-hour shift (zipper 8 hours behind UTC) and pairs everything", () => {
    const built = build(realShaped("dos", { offsetHours: () => -8 }));
    const result = pairMemories(built.items, classifyAll(built));
    expect(result.method).toBe("offset-time");
    expect(result.offsetHours).toBe(-8);
    expect(result.pairs).toHaveLength(498);
    expect(result.pairs.every((p) => p.method === "time-tolerance")).toBe(true);
    expect(new Set(result.unmatchedItemIds)).toEqual(built.withoutFile);
    expect(result.summary).toMatchObject({ paired: 498, unmatchedItems: 213, overlays: 15, ambiguous: 0 });
    expectCorrectPairs(result, built);
  });

  it.each([-14, -11, -5, 0, 1, 5.0, 9, 14])("finds offset %d", (h) => {
    const built = build(realShaped("dos", { offsetHours: () => h }));
    const result = pairMemories(built.items, classifyAll(built));
    expect(result.method).toBe("offset-time");
    expect(result.offsetHours).toBe(h);
    expect(result.pairs).toHaveLength(498);
    expectCorrectPairs(result, built);
  });

  it.each([2, 1, 0, -1])("tolerates %d seconds of clock skew", (skewS) => {
    const built = build(realShaped("dos", { offsetHours: () => -8, skewS }));
    const result = pairMemories(built.items, classifyAll(built));
    expect(result.method).toBe("offset-time");
    expect(result.pairs).toHaveLength(498);
    expectCorrectPairs(result, built);
  });

  it("pairs every file when daylight saving moved some of them by an hour, and reports both offsets", () => {
    const built = build(realShaped("dos", { offsetHours: (k) => (k % 10 < 7 ? -8 : -7) }));
    const result = pairMemories(built.items, classifyAll(built));
    expect(result.method).toBe("offset-time");
    expect(result.offsetHours).toBe(-8);
    expect(result.extraOffsetHours).toEqual([-7]);
    expect(result.pairs).toHaveLength(498);
    expectCorrectPairs(result, built);
    expect(result.summary).toMatchObject({ paired: 498, unmatchedFiles: 0, unmatchedItems: 213, ambiguous: 0 });
  });

  it.each([
    ["12 files against 8", (k: number) => (k % 5 < 3 ? 1 : 2)],
    ["11 against 9, where no offset has 1.5 times the other's matches", (k: number) => (k % 20 < 11 ? 1 : 2)],
    ["an even split", (k: number) => (k % 2 === 0 ? -8 : -7)],
  ])("pairs every file of a daylight saving split (%s)", (_, offsetHours) => {
    const sparse: Spec = { count: 200, spacing: (k) => 30 * 3600 + ((k * 37) % 3600), isVideo: (k) => k % 3 === 0, hasFile: () => true, times: "dos", offsetHours };
    const built = build(sparse);
    const result = pairMemories(built.items, classifyAll(built));
    expect(result.method).toBe("offset-time");
    expect(result.extraOffsetHours).toHaveLength(1);
    expect(result.pairs).toHaveLength(200);
    expect(result.pairs.every((p) => p.method === "time-tolerance")).toBe(true);
    expectCorrectPairs(result, built);
  });

  it.each([5.5, 5.75, -9.5, 12.75])("finds a clock that is %d hours from UTC (half-hour and 45-minute zones)", (h) => {
    const built = build(realShaped("dos", { offsetHours: () => h }));
    const result = pairMemories(built.items, classifyAll(built));
    expect(result.method).toBe("offset-time");
    expect(result.offsetHours).toBe(h);
    expect(result.extraOffsetHours).toEqual([]);
    expect(result.pairs).toHaveLength(498);
    expectCorrectPairs(result, built);
  });

  it("does not invent an offset for times that match nothing, and falls back to the flagged day-and-type pairing", () => {
    const sparse: Spec = { count: 200, spacing: (k) => 30 * 3600 + ((k * 37) % 3600), isVideo: (k) => k % 3 === 0, hasFile: () => true, times: "dos", offsetHours: () => -8, skewS: 600 };
    const built = build(sparse);
    const result = pairMemories(built.items, classifyAll(built));
    expect(result.method).toBe("date-type");
    expect(result.offsetHours).toBe(0);
    expect(result.extraOffsetHours).toEqual([]);
    expect(result.pairs).toHaveLength(200);
    expect(result.pairs.every((p) => p.method === "date-and-type")).toBe(true);
    expectCorrectPairs(result, built);
  });

  it("does not pair times that match no offset", () => {
    const built = build(realShaped("dos", { offsetHours: () => -8, skewS: 5 }));
    const result = pairMemories(built.items, classifyAll(built));
    expect(result.method).not.toBe("offset-time");
    expect(result.offsetHours).toBe(0);
  });

  it("uses a minority of UTC-timed files only through the DOS stage's own rules", () => {
    // 3 of 10 files carry a UTC time: not "most", so the exact stage is not used.
    const built = build({ count: 10, spacing: () => 40_000, isVideo: () => false, hasFile: () => true, times: "dos", offsetHours: () => -3 });
    const files = classifyAll(built).map((f, i) => (i < 3 ? { ...f, timeKind: "utc" as const, timeMs: 1 } : f));
    const result = pairMemories(built.items, files);
    expect(result.method).toBe("offset-time");
    expect(result.pairs).toHaveLength(7);
  });
});

// -------------------------------------------------------------- date and type ---

describe("pairMemories without usable times", () => {
  const sparse = (): Built => build({ count: 40, spacing: (k) => 30 * 3600 + ((k * 37) % 3600), isVideo: (k) => k % 4 === 0, hasFile: (k) => k % 5 !== 0, times: "utc" });
  const stripTimes = (files: MemoryMediaFile[]): MemoryMediaFile[] => files.map(({ timeMs: _t, ...f }) => ({ ...f, timeKind: "none" as const }));

  it("pairs unambiguous days by day and type, flagged as such", () => {
    const built = sparse();
    const result = pairMemories(built.items, stripTimes(classifyAll(built)));
    expect(result.method).toBe("date-type");
    expect(result.pairs).toHaveLength(32);
    expect(result.pairs.every((p) => p.method === "date-and-type")).toBe(true);
    expect(new Set(result.unmatchedItemIds)).toEqual(built.withoutFile);
    expectCorrectPairs(result, built);
  });

  it("leaves a day with two items of one type alone, and counts it", () => {
    const items: MemoryItem[] = [
      { id: "a", date: Date.UTC(2023, 3, 1, 9), mediaType: "image" },
      { id: "b", date: Date.UTC(2023, 3, 1, 18), mediaType: "image" },
      { id: "c", date: Date.UTC(2023, 3, 2, 9), mediaType: "image" },
      { id: "d", date: Date.UTC(2023, 3, 2, 9), mediaType: "video" },
    ];
    const files = classifyMemoryMedia(
      [{ name: "memories/2023-04-01_AAAAAAAA-0000-4000-8000-000000000001-main.jpg", size: 1 }, { name: "memories/2023-04-02_AAAAAAAA-0000-4000-8000-000000000002-main.jpg", size: 1 }, { name: "memories/2023-04-02_AAAAAAAA-0000-4000-8000-000000000003-main.mp4", size: 1 }],
      2,
    );
    const result = pairMemories(items, files);
    expect(result.method).toBe("date-type");
    expect(result.pairs.map((p) => p.itemId).sort()).toEqual(["c", "d"]);
    expect(result.unmatchedItemIds).toEqual(["a", "b"]);
    expect(result.summary.ambiguous).toBe(2);
    expect(result.unmatchedFiles).toHaveLength(1);
  });

  it("does not pair when the file has no day in its name or the types differ", () => {
    const items: MemoryItem[] = [{ id: "a", date: Date.UTC(2023, 3, 1, 9), mediaType: "image" }];
    const none = classifyMemoryMedia([{ name: "memories/photo-main.jpg", size: 1 }], 2);
    expect(pairMemories(items, none).pairs).toEqual([]);
    const other = classifyMemoryMedia([{ name: "memories/2023-04-01_x-main.mp4", size: 1 }], 2);
    expect(pairMemories(items, other).pairs).toEqual([]);
  });
});

// ------------------------------------------------------------------ ambiguity ---

describe("pairMemories same-second ambiguity", () => {
  const T = Date.UTC(2022, 5, 1, 12, 0, 0);
  const at = (n: number): number => T + n * 1000;
  const item = (id: string, n: number, mediaType: MemoryItem["mediaType"]): MemoryItem => ({ id, date: at(n), mediaType });
  const file = (uuidNo: number, n: number, ext: string, role = "main"): Entry => ({
    name: `memories/2022-06-01_BBBBBBBB-0000-4000-8000-${String(uuidNo).padStart(12, "0")}-${role}.${ext}`,
    size: 5,
    mtimeUtcMs: at(n),
  });
  /** Three ordinary, clearly separated memories so the UTC stage has company. */
  const company = (): { items: MemoryItem[]; entries: Entry[] } => ({
    items: [item("p", 100, "image"), item("q", 200, "video"), item("r", 300, "image")],
    entries: [file(1, 100, "jpg"), file(2, 200, "mp4"), file(3, 300, "jpg")],
  });

  it("leaves two images that share a second, with two files at that second, unmatched", () => {
    const c = company();
    const result = pairMemories([...c.items, item("x", 0, "image"), item("y", 0, "image")], classifyMemoryMedia([...c.entries, file(4, 0, "jpg"), file(5, 0, "jpg")], 2));
    expect(result.method).toBe("utc-time");
    expect(result.pairs.map((p) => p.itemId)).toEqual(["p", "q", "r"]);
    expect(result.unmatchedItemIds).toEqual(["x", "y"]);
    expect(result.unmatchedFiles).toHaveLength(2);
    expect(result.summary.ambiguous).toBe(2);
  });

  it("pairs an image and a video that share a second when their file types tell them apart", () => {
    const c = company();
    const result = pairMemories([...c.items, item("x", 0, "image"), item("y", 0, "video")], classifyMemoryMedia([...c.entries, file(4, 0, "mp4"), file(5, 0, "jpg")], 2));
    expect(result.pairs.map((p) => [p.itemId, /\.(jpg|mp4)$/.exec(p.file.path)?.[1]])).toEqual([
      ["p", "jpg"],
      ["q", "mp4"],
      ["r", "jpg"],
      ["x", "jpg"],
      ["y", "mp4"],
    ]);
    expect(result.summary.ambiguous).toBe(0);
  });

  it("does not pair a lone video with a jpg and an mp4 at its second (counts differ)", () => {
    const c = company();
    const result = pairMemories([...c.items, item("x", 0, "video")], classifyMemoryMedia([...c.entries, file(4, 0, "mp4"), file(5, 0, "jpg")], 2));
    expect(result.pairs.map((p) => p.itemId)).toEqual(["p", "q", "r"]);
    expect(result.unmatchedItemIds).toEqual(["x"]);
    expect(result.summary.ambiguous).toBe(1);
  });

  it("does not pair two items at one second with a single file", () => {
    const c = company();
    const result = pairMemories([...c.items, item("x", 0, "image"), item("y", 0, "image")], classifyMemoryMedia([...c.entries, file(4, 0, "jpg")], 2));
    expect(result.unmatchedItemIds).toEqual(["x", "y"]);
    expect(result.summary).toMatchObject({ paired: 3, ambiguous: 2, unmatchedFiles: 1 });
  });

  it("ignores sub-second differences in the item date (floors to the second)", () => {
    const c = company();
    const items = c.items.map((i) => ({ ...i, date: (i.date as number) + 999 }));
    expect(pairMemories(items, classifyMemoryMedia(c.entries, 2)).pairs).toHaveLength(3);
  });

  it("does not let a thumbnail that shares a main file's id and time spoil the pair", () => {
    const entries = [file(1, 100, "jpg"), file(1, 100, "jpg", "thumb")];
    const result = pairMemories([item("p", 100, "image")], classifyMemoryMedia(entries, 2));
    expect(result.pairs).toHaveLength(1);
    expect(result.summary).toMatchObject({ mainFiles: 1, unmatchedFiles: 0, ambiguous: 0 });
  });

  it("never pairs a thumbnail as the Memory when its main file was not supplied", () => {
    // A first run with only some of the parts: the thumbnails are here, their mains are in another part.
    const items = [item("p", 100, "image"), item("q", 200, "image")];
    const entries = [file(1, 100, "jpg", "thumbnail"), file(2, 200, "jpg", "thumb"), file(3, 300, "jpg", "preview")];
    const result = pairMemories(items, classifyMemoryMedia(entries, 2));
    expect(result.pairs).toEqual([]);
    expect(result.unmatchedItemIds).toEqual(["p", "q"]);
    expect(result.summary).toMatchObject({ mainFiles: 0, paired: 0, unmatchedFiles: 0 });
  });

  it("still pairs a file named only by its day and id, with no word after the id", () => {
    const entries: Entry[] = [{ name: `memories/2022-06-01_${uuidOf(1)}.jpg`, size: 1, mtimeUtcMs: at(100) }];
    const result = pairMemories([item("p", 100, "image")], classifyMemoryMedia(entries, 2));
    expect(result.pairs.map((p) => p.itemId)).toEqual(["p"]);
  });

  it("treats the same main file seen in two parts as one candidate", () => {
    const items = [item("p", 100, "image"), item("q", 200, "image"), item("r", 300, "image")];
    const entries = [file(1, 100, "jpg"), file(2, 200, "jpg"), file(3, 300, "jpg")];
    const twice = [...classifyMemoryMedia(entries, 2), ...classifyMemoryMedia(entries, 3)];
    const result = pairMemories(items, twice);
    expect(result.pairs.map((p) => p.itemId)).toEqual(["p", "q", "r"]);
    expect(result.pairs.every((p) => p.file.part === 2)).toBe(true);
    expect(result.summary).toMatchObject({ mainFiles: 3, paired: 3, ambiguous: 0, unmatchedFiles: 0 });
  });

  it("attaches an overlay to one main file only and reports overlays with no main", () => {
    const entries = [file(1, 100, "jpg"), file(1, 100, "png", "overlay"), file(1, 200, "jpg"), file(9, 300, "png", "overlay")];
    const result = pairMemories([item("p", 100, "image"), item("q", 200, "image")], classifyMemoryMedia(entries, 2));
    expect(result.pairs.map((p) => p.overlays.length)).toEqual([1, 0]);
    expect(result.summary.overlays).toBe(1);
    expect(result.unmatchedFiles.map((f) => f.role)).toEqual(["overlay"]);
  });

  it("pairs within a DOS window only when one item and one file are near each other", () => {
    const entries: Entry[] = [
      { name: "memories/2022-06-01_BBBBBBBB-0000-4000-8000-000000000001-main.jpg", size: 1, mtimeDosMs: at(100) },
      { name: "memories/2022-06-01_BBBBBBBB-0000-4000-8000-000000000002-main.jpg", size: 1, mtimeDosMs: at(500) },
      { name: "memories/2022-06-01_BBBBBBBB-0000-4000-8000-000000000003-main.jpg", size: 1, mtimeDosMs: at(900) },
    ];
    const items = [item("a", 100, "image"), item("b1", 500, "image"), item("b2", 501, "image"), item("c", 900, "image")];
    const result = pairMemories(items, classifyMemoryMedia(entries, 2));
    expect(result.method).toBe("offset-time");
    expect(result.pairs.map((p) => p.itemId)).toEqual(["a", "c"]);
    expect(result.unmatchedItemIds).toEqual(["b1", "b2"]);
    expect(result.summary.ambiguous).toBe(2);
  });
});

// -------------------------------------------------------------- garbage input ---

describe("pairMemories with empty or garbage input", () => {
  it("handles nothing at all", () => {
    expect(pairMemories([], [])).toEqual({
      pairs: [],
      unmatchedItemIds: [],
      unmatchedFiles: [],
      method: "none",
      offsetHours: 0,
      extraOffsetHours: [],
      summary: { items: 0, mainFiles: 0, paired: 0, unmatchedItems: 0, unmatchedFiles: 0, overlays: 0, ambiguous: 0 },
    });
  });

  it("reports every item as unmatched when there are no files, and every file when there are no items", () => {
    const items: MemoryItem[] = [{ id: "a", date: 1_600_000_000_000, mediaType: "image" }];
    expect(pairMemories(items, [])).toMatchObject({ method: "none", unmatchedItemIds: ["a"] });
    const files = classifyMemoryMedia([{ name: "memories/2020-09-13_CCCCCCCC-0000-4000-8000-000000000001-main.jpg", size: 1, mtimeUtcMs: 1_600_000_000_000 }], 2);
    const r = pairMemories([], files);
    expect(r.method).toBe("none");
    expect(r.unmatchedFiles).toEqual(files);
  });

  it("never pairs items without a usable date", () => {
    const bad = [null, Number.NaN, Infinity, -Infinity, 9e15, undefined] as unknown as (number | null)[];
    const items: MemoryItem[] = bad.map((date, i) => ({ id: `u${i}`, date, mediaType: "image" }));
    const files = classifyMemoryMedia([{ name: "memories/2020-09-13_CCCCCCCC-0000-4000-8000-000000000001-main.jpg", size: 1, mtimeUtcMs: 1_600_000_000_000 }], 2);
    const r = pairMemories(items, files);
    expect(r.pairs).toEqual([]);
    expect(r.unmatchedItemIds).toEqual(["u0", "u1", "u2", "u3", "u4", "u5"]);
    expect(r.summary).toMatchObject({ items: 6, unmatchedItems: 6, mainFiles: 1, unmatchedFiles: 1 });
  });

  it("copes with files that carry no time and no day", () => {
    const files: MemoryMediaFile[] = [
      { path: "memories/x-main.jpg", part: 2, role: "main", timeKind: "none", size: 1 },
      { path: "", part: 2, role: "other", timeKind: "dos", size: 0, timeMs: Number.NaN },
      { path: "memories/y-overlay.png", part: 2, role: "overlay", timeKind: "none", size: 1 },
    ];
    const r = pairMemories([{ id: "a", date: 1_600_000_000_000, mediaType: "unknown" }], files);
    expect(r.pairs).toEqual([]);
    expect(r.summary.unmatchedFiles).toBe(3);
  });

  it("writes nothing to the console", () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    const built = build(realShaped("utc"));
    pairMemories(built.items, classifyAll(built));
    classifyMemoryMedia([null as unknown as Entry], 1);
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------- performance ---

describe("pairMemories at scale", () => {
  const big = (times: "utc" | "dos"): Built => build({ count: 100_000, spacing: (k) => 5 + ((k * 31) % 200), isVideo: (k) => k % 4 === 3, hasFile: (k) => k % 5 !== 0, times, offsetHours: () => -7 });

  it("pairs 100k items with exact times quickly", () => {
    const built = big("utc");
    const files = classifyAll(built);
    const t0 = performance.now();
    const result = pairMemories(built.items, files);
    const ms = performance.now() - t0;
    expect(result.method).toBe("utc-time");
    expect(result.pairs).toHaveLength(80_000);
    expect(result.summary.unmatchedItems).toBe(20_000);
    expect(ms).toBeLessThan(5_000);
  });

  it("detects the offset and pairs 100k items from DOS times quickly", () => {
    const built = big("dos");
    const files = classifyAll(built);
    const t0 = performance.now();
    const result = pairMemories(built.items, files);
    const ms = performance.now() - t0;
    expect(result.method).toBe("offset-time");
    expect(result.offsetHours).toBe(-7);
    expect(result.pairs.length).toBe(80_000);
    expect(ms).toBeLessThan(10_000);
  });

  it("survives 50k items and files that all share one second", () => {
    const T = Date.UTC(2021, 0, 1);
    const items: MemoryItem[] = Array.from({ length: 50_000 }, (_, i) => ({ id: `s${i}`, date: T, mediaType: "image" }));
    const files: MemoryMediaFile[] = Array.from({ length: 50_000 }, (_, i) => ({ path: `memories/2021-01-01_${i}-main.jpg`, part: 2, role: "main", timeKind: "utc", timeMs: T, size: 1 }));
    const t0 = performance.now();
    const result = pairMemories(items, files);
    expect(performance.now() - t0).toBeLessThan(5_000);
    expect(result.pairs).toEqual([]);
    expect(result.summary.unmatchedItems).toBe(50_000);
  });
});
