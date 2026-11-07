/**
 * attachBundledMedia: linking the Memories list to the media files found in the zip directories.
 * Synthetic data only; the notes it produces carry counts, never a name or a path.
 */
import { describe, expect, it } from "vitest";
import { attachBundledMedia } from "../../src/export/memories.ts";
import { classifyMemoryMedia } from "../../src/memories/pair.ts";
import type { MemoryMediaFile } from "../../src/memories/pair.ts";
import type { MemoryItem } from "../../src/types.ts";

const T0 = Date.UTC(2025, 2, 4, 10, 20, 30);
const uuid = (n: number): string => `${n.toString(16).padStart(8, "0")}-aaaa-bbbb-cccc-${n.toString(16).padStart(12, "0")}`.toUpperCase();
const day = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** n list entries one minute apart, alternating image and video. */
function listOf(n: number, extra: Partial<MemoryItem> = {}): MemoryItem[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `m${i}`,
    date: T0 + i * 60_000,
    mediaType: i % 2 === 0 ? ("image" as const) : ("video" as const),
    ...extra,
  }));
}

/** The files of the entries in `indexes`, with their stored time as a UTC instant, a DOS clock reading, or none. */
function filesFor(items: MemoryItem[], indexes: number[], part = 1, timed: "utc" | "dos" | "none" = "utc", dosShiftHours = 0): MemoryMediaFile[] {
  return classifyMemoryMedia(
    indexes.map((i) => {
      const item = items[i] as MemoryItem;
      const time = item.date as number;
      return {
        name: `memories/${day(time)}_${uuid(i + 1)}-main.${item.mediaType === "video" ? "mp4" : "jpg"}`,
        size: 1000 + i,
        ...(timed === "utc" ? { mtimeUtcMs: time } : timed === "dos" ? { mtimeDosMs: time + dosShiftHours * 3_600_000 } : {}),
      };
    }),
    part,
  );
}

describe("attachBundledMedia", () => {
  it("pairs entries and files by the exact stored UTC time and records where each file lives", () => {
    const items = listOf(10);
    const files = [...filesFor(items, [0, 1, 2, 3, 4, 5, 6], 2), ...filesFor(items, [7, 8], 3)];
    const overlay = classifyMemoryMedia([{ name: `memories/${day(T0)}_${uuid(1)}-overlay.png`, size: 77, mtimeUtcMs: T0 }], 2);
    const r = attachBundledMedia(items, [...files, ...overlay]);

    expect(r.memories.filter((m) => m.zipPath !== undefined)).toHaveLength(9);
    expect(r.memories[0]).toMatchObject({ partIndex: 2, sizeBytes: 1000, overlayPaths: overlay.map((o) => o.path) });
    expect(r.memories[8]).toMatchObject({ partIndex: 3, sizeBytes: 1008 });
    expect(r.memories[9]?.zipPath).toBeUndefined();
    expect(r.pairing).toEqual({ items: 10, mainFiles: 9, paired: 9, unmatchedItems: 1, unmatchedFiles: 0, overlays: 1, ambiguous: 0, method: "utc-time", offsetHours: 0 });
  });

  it("says in counts only when the list has no links and when entries are missing from the files", () => {
    const items = listOf(10);
    const r = attachBundledMedia(items, filesFor(items, [0, 1, 2, 3, 4, 5, 6]));
    expect(r.issues.map((i) => [i.severity, i.code])).toEqual([
      ["info", "memories-links-empty"],
      ["warning", "memories-unmatched-items"],
    ]);
    expect(r.issues[1]?.message).toBe("3 of 10 saved Memories have no file in your ZIP files.");

    const one = attachBundledMedia(items, filesFor(items, [0, 1, 2, 3, 4, 5, 6, 7, 8]));
    expect(one.issues[1]?.message).toBe("1 of 10 saved Memories has no file in your ZIP files.");
  });

  it("does not count an entry with a download link as missing, and does not claim the links are empty", () => {
    const items = listOf(4).map((m, i) => (i >= 2 ? { ...m, downloadUrl: "https://example.invalid/x" } : m));
    const r = attachBundledMedia(items, filesFor(items, [0, 1]));
    expect(r.issues).toEqual([]);
    expect(r.pairing?.unmatchedItems).toBe(2);
  });

  it("allows for a clock offset in DOS-only times and says so", () => {
    const items = listOf(12);
    const r = attachBundledMedia(items, filesFor(items, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 1, "dos", -8));
    expect(r.pairing).toMatchObject({ method: "offset-time", offsetHours: -8, paired: 10 });
    expect(r.issues.map((i) => i.code)).toEqual(["memories-links-empty", "memories-time-offset", "memories-unmatched-items"]);
    expect(r.issues[1]?.message).toBe("The Memories files keep their times on a clock 8 hours behind UTC. Snappy allowed for that.");
  });

  it("warns when it had to fall back to the date and type, and pairs only unambiguous days", () => {
    const items: MemoryItem[] = [
      { id: "a", date: Date.UTC(2024, 0, 1, 9), mediaType: "image" },
      { id: "b", date: Date.UTC(2024, 0, 2, 9), mediaType: "image" },
      { id: "c", date: Date.UTC(2024, 0, 2, 10), mediaType: "image" },
    ];
    const files = classifyMemoryMedia(
      [
        { name: `memories/2024-01-01_${uuid(1)}-main.jpg`, size: 5 },
        { name: `memories/2024-01-02_${uuid(2)}-main.jpg`, size: 5 },
      ],
      1,
    );
    const r = attachBundledMedia(items, files);
    expect(r.pairing).toMatchObject({ method: "date-type", paired: 1 });
    expect(r.memories.map((m) => m.zipPath !== undefined)).toEqual([true, false, false]);
    expect(r.issues.map((i) => i.code)).toEqual(["memories-links-empty", "memories-pairing-fallback", "memories-ambiguous-items"]);
    // Those two have files in the zips that could not be told apart: the advice is not "a part may be missing".
    expect(r.issues[2]?.message).toBe("2 saved Memories share a time with others, so Snappy did not guess. Their files are in your ZIP files.");
  });

  it("fills in an unknown media type from the file it pairs with", () => {
    const items = listOf(3).map((m) => ({ ...m, mediaType: "unknown" as const }));
    const r = attachBundledMedia(items, filesFor(listOf(3), [0, 1, 2]));
    expect(r.memories.map((m) => m.mediaType)).toEqual(["image", "video", "image"]);
  });

  it("with no files only counts the entries that cannot be rescued", () => {
    const items = [...listOf(2), ...listOf(2, { downloadUrl: "https://example.invalid/x" }).map((m, i) => ({ ...m, id: `l${i}` }))];
    const r = attachBundledMedia(items, []);
    expect(r.pairing).toBeUndefined();
    expect(r.memories).toEqual(items);
    expect(r.issues).toEqual([{ severity: "warning", code: "memories-no-media-source", message: "2 Memories have no file or link in your ZIP files. Part of your export may be missing." }]);
  });

  it("starts from the list alone: stale file fields are dropped and the input is not touched", () => {
    const items = listOf(3).map((m) => ({ ...m, zipPath: "memories/stale.jpg", partIndex: 9, sizeBytes: 1, overlayPaths: ["memories/stale-overlay.png"] }));
    const before = structuredClone(items);
    const r = attachBundledMedia(items, filesFor(listOf(3), [0]));
    expect(items).toEqual(before);
    expect(r.memories[1]).toEqual({ id: "m1", date: T0 + 60_000, mediaType: "video" });
    expect(r.memories[0]?.zipPath).toMatch(/-main\.jpg$/);
    expect(r.memories[0]?.overlayPaths).toBeUndefined();
  });

  it("has nothing to say when there is no list, and never puts a path or an id into a message", () => {
    const items = listOf(6);
    const files = filesFor(items, [0, 1, 2]);
    expect(attachBundledMedia([], files).issues).toEqual([]);
    expect(attachBundledMedia([], files).pairing).toBeUndefined();
    const text = JSON.stringify(attachBundledMedia(items, files).issues);
    for (const f of files) expect(text).not.toContain(f.path.slice(f.path.lastIndexOf("/") + 1));
    expect(text).not.toMatch(/memories\/|\.jpg|\.mp4|AAAA-BBBB/i);
  });
});
