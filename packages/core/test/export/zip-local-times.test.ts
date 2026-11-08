import { describe, expect, it } from "vitest";
import { LOCAL_TIME_PHASE, addLocalHeaderTimes, bytesReader, listZipEntries, parseExportFromReader } from "../../src/export/zip-reader.ts";
import type { LocalTimeProgress, RandomAccessReader } from "../../src/export/zip-reader.ts";
import { buildFixtureZip } from "./zip-fixture.ts";
import type { FixtureEntry } from "./zip-fixture.ts";
import { enc } from "./helpers.ts";

const UTC = Date.UTC(2024, 4, 6, 7, 8, 9);
const MEMORIES = 200;

/** Memories media whose UTC time sits in the local headers only, so every file needs a local read. */
function localOnlyZip(count: number, withTime = true): Uint8Array {
  const entries: FixtureEntry[] = [
    { name: "json/memories_history.json", data: enc({ "Saved Media": [] }) },
    ...Array.from({ length: count }, (_, i) => ({
      name: `memories/2024-05-06_${String(i).padStart(4, "0")}-main.jpg`,
      data: new Uint8Array(400).fill(7),
      ...(withTime ? { utcMs: UTC + i * 1000, utcInLocalOnly: true } : {}),
    })),
  ];
  return buildFixtureZip(entries);
}

/** Counts reads, tracks how many are in flight at once and answers each after a tick, like a Blob does. */
function slowReader(bytes: Uint8Array): { reader: RandomAccessReader; reads: [number, number][]; peak: () => number } {
  const inner = bytesReader(bytes);
  const reads: [number, number][] = [];
  let inFlight = 0;
  let peak = 0;
  return {
    reads,
    peak: () => peak,
    reader: {
      size: inner.size,
      async read(start, end) {
        reads.push([start, end]);
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 0));
        inFlight -= 1;
        return inner.read(start, end);
      },
    },
  };
}

describe("local header times", () => {
  it("are read many at a time, never repeated, and never touch the media bytes", async () => {
    const zip = localOnlyZip(MEMORIES);
    const { entries } = await listZipEntries(bytesReader(zip));
    const media = entries.filter((e) => e.name.startsWith("memories/"));
    expect(media.every((e) => e.mtimeUtcMs === undefined)).toBe(true);

    const { reader, reads, peak } = slowReader(zip);
    const filled = await addLocalHeaderTimes(reader, media);
    expect(filled.map((e) => e.mtimeUtcMs)).toEqual(media.map((_, i) => UTC + i * 1000));
    // header + extra per file: no more than two reads each, and none of them reaches the file's data
    expect(reads.length).toBe(media.length * 2);
    const dataStart = (e: (typeof media)[number]): number => e.localHeaderOffset + 30 + e.name.length + 9;
    for (const [start, end] of reads) {
      const hit = media.find((e) => start < dataStart(e) + e.compressedSize && end > dataStart(e));
      expect(hit, `read ${start}-${end} touches file data`).toBeUndefined();
    }
    // one after the other would peak at 1
    expect(peak()).toBeGreaterThanOrEqual(16);
    expect(peak()).toBeLessThanOrEqual(32);
  });

  it("are counted in the progress callback with a phase text, each file once", async () => {
    const zip = localOnlyZip(MEMORIES);
    const { reader, reads } = slowReader(zip);
    const seen: LocalTimeProgress[] = [];
    const parsed = await parseExportFromReader(reader, { onProgress: (p) => seen.push({ ...p }) });
    expect(parsed.bundledMedia?.every((f) => f.timeKind === "utc")).toBe(true);
    expect(seen).toHaveLength(MEMORIES);
    expect(new Set(seen.map((p) => p.phase))).toEqual(new Set([LOCAL_TIME_PHASE]));
    expect(LOCAL_TIME_PHASE).toBe("Matching Memories to files");
    expect(seen.map((p) => p.done)).toEqual(Array.from({ length: MEMORIES }, (_, i) => i + 1));
    expect(seen.every((p) => p.total === MEMORIES)).toBe(true);
    // the local header of each Memories file was asked for once
    const headerReads = await mediaHeaderReads(zip, reads);
    expect(new Set(headerReads.map(([s]) => s)).size).toBe(headerReads.length);
    expect(headerReads.length).toBe(MEMORIES);
  });

  it("an archive whose local headers hold no time costs sixteen probes, each file once", async () => {
    const zip = localOnlyZip(MEMORIES, false);
    const { reader, reads } = slowReader(zip);
    const seen: LocalTimeProgress[] = [];
    await parseExportFromReader(reader, { onProgress: (p) => seen.push({ ...p }) });
    expect(await mediaHeaderReads(zip, reads)).toHaveLength(16);
    expect(seen).toHaveLength(16);
    expect(seen.at(-1)).toEqual({ phase: LOCAL_TIME_PHASE, done: 16, total: MEMORIES });
  });

  it("report nothing when the central directory already holds the times", async () => {
    const zip = buildFixtureZip([{ name: "memories/a.jpg", data: new Uint8Array(10), utcMs: UTC }]);
    const seen: LocalTimeProgress[] = [];
    await parseExportFromReader(bytesReader(zip), { onProgress: (p) => seen.push(p) });
    expect(seen).toEqual([]);
  });
});

/** The fixed-header reads aimed at Memories media files (the JSON entry's own header is read elsewhere). */
async function mediaHeaderReads(zip: Uint8Array, reads: [number, number][]): Promise<[number, number][]> {
  const { entries } = await listZipEntries(bytesReader(zip));
  const offsets = new Set(entries.filter((e) => e.name.startsWith("memories/")).map((e) => e.localHeaderOffset));
  return reads.filter(([s, e]) => e - s === 30 && offsets.has(s));
}
