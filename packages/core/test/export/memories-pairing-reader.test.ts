/**
 * Memories pairing through the reader front end with hand-made zips, so the stored times are
 * exactly what each case needs: UTC only, DOS only on a shifted clock, or none worth anything.
 * Synthetic data only.
 */
import { describe, expect, it } from "vitest";
import { bytesReader, mergeParsedExports, parseExportFromReader } from "../../src/export/zip-reader.ts";
import { enc } from "./helpers.ts";
import { buildFixtureZip } from "./zip-fixture.ts";
import type { FixtureEntry } from "./zip-fixture.ts";

const T0 = Date.UTC(2026, 2, 4, 10, 20, 30);
const MIN = 60_000;
const HOUR = 3_600_000;
const day = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const stamp = (ms: number): string => new Date(ms).toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
const uuid = (n: number): string => `${n.toString(16).padStart(8, "0")}-1111-2222-3333-${n.toString(16).padStart(12, "0")}`.toUpperCase();

const dates = Array.from({ length: 14 }, (_, i) => T0 + i * 7 * MIN);
const listZip = (): Uint8Array =>
  buildFixtureZip([
    { name: "json/friends.json", data: enc({ Friends: [{ Username: "alice" }] }) },
    { name: "json/memories_history.json", data: enc({ "Saved Media": dates.map((d, i) => ({ Date: stamp(d), "Media Type": i % 2 ? "Video" : "Image", "Download Link": "", "Media Download URL": "" })) }) },
  ]);
const mediaZip = (indexes: number[], times: (ms: number) => Partial<FixtureEntry>): Uint8Array =>
  buildFixtureZip(
    indexes.map((i) => ({
      name: `memories/${day(dates[i] as number)}_${uuid(i + 1)}-main.${i % 2 ? "mp4" : "jpg"}`,
      data: enc(`file ${i}`),
      ...times(dates[i] as number),
    })),
  );

async function pair(media: Uint8Array) {
  const parts = [await parseExportFromReader(bytesReader(listZip()), { part: 1 }), await parseExportFromReader(bytesReader(media), { part: 2 })];
  return mergeParsedExports(parts);
}

describe("Memories paired through the reader", () => {
  it("uses the stored UTC time exactly, whatever the zipper's clock says", async () => {
    const merged = await pair(mediaZip([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], (ms) => ({ utcMs: ms, dosMs: Date.UTC(2020, 0, 1) })));
    expect(merged.memoriesPairing).toMatchObject({ method: "utc-time", paired: 10, unmatchedItems: 4, offsetHours: 0 });
    expect(merged.memories.filter((m) => m.partIndex === 2)).toHaveLength(10);
    expect(merged.memories.slice(0, 10).every((m) => m.zipPath !== undefined && m.sizeBytes === 6)).toBe(true);
    expect(merged.issues.map((i) => i.code)).toEqual(expect.arrayContaining(["memories-links-empty", "memories-unmatched-items"]));
    expect(merged.issues.map((i) => i.code)).not.toContain("memories-pairing-fallback");
  });

  it("finds a zipper clock that is a whole number of hours off when only DOS times exist, and says so", async () => {
    const merged = await pair(mediaZip([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], (ms) => ({ dosMs: ms + 5 * HOUR })));
    expect(merged.memoriesPairing).toMatchObject({ method: "offset-time", offsetHours: 5, paired: 12, unmatchedItems: 2 });
    expect(merged.issues.find((i) => i.code === "memories-time-offset")).toEqual({
      severity: "info",
      code: "memories-time-offset",
      message: "The Memories files keep their times on a clock 5 hours ahead of UTC. Snappy allowed for that.",
    });
  });

  it("pairs nothing it cannot tell apart: with no usable times and every entry on one day, it says what is missing", async () => {
    // All fourteen entries are on one day and nothing else tells them apart, so no pair is certain.
    const merged = await pair(mediaZip([0, 1], () => ({ dosMs: Date.UTC(2020, 0, 1) })));
    expect(merged.memoriesPairing?.method).toBe("none");
    expect(merged.memories.some((m) => m.zipPath !== undefined)).toBe(false);
    // The files are there but cannot be told apart, so this is not "a part may be missing".
    expect(merged.issues.map((i) => i.code)).toContain("memories-ambiguous-items");
    expect(merged.issues.map((i) => i.code)).not.toContain("memories-unmatched-items");
  });

  it("warns about the fallback when it did pair something that way", async () => {
    const spread = Array.from({ length: 4 }, (_, i) => Date.UTC(2026, 0, 1 + i, 9));
    const list = buildFixtureZip([{ name: "json/memories_history.json", data: enc({ "Saved Media": spread.map((d) => ({ Date: stamp(d), "Media Type": "Image" })) }) }]);
    const files = buildFixtureZip(spread.slice(0, 3).map((d, i) => ({ name: `memories/${day(d)}_${uuid(i + 1)}-main.jpg`, data: enc("x") })));
    const merged = mergeParsedExports([await parseExportFromReader(bytesReader(list), { part: 1 }), await parseExportFromReader(bytesReader(files), { part: 2 })]);
    expect(merged.memoriesPairing).toMatchObject({ method: "date-type", paired: 3, unmatchedItems: 1 });
    const warn = merged.issues.find((i) => i.code === "memories-pairing-fallback");
    expect(warn?.severity).toBe("warning");
    expect(warn?.message).toContain("matched them by date and type");
  });

  it("records the part each file came from, as the caller numbered the zips", async () => {
    const a = await parseExportFromReader(bytesReader(listZip()), { part: 1 });
    const b = await parseExportFromReader(bytesReader(mediaZip([0, 1, 2], (ms) => ({ utcMs: ms }))), { part: 2 });
    const c = await parseExportFromReader(bytesReader(mediaZip([3, 4, 5], (ms) => ({ utcMs: ms }))), { part: 3 });
    const merged = mergeParsedExports([c, a, b]);
    expect(merged.memories.slice(0, 6).map((m) => m.partIndex)).toEqual([2, 2, 2, 3, 3, 3]);
    expect(merged.bundledMedia?.map((f) => f.part)).toEqual([2, 2, 2, 3, 3, 3]);
    expect(b.bundledMedia?.every((f) => f.part === 2)).toBe(true);
    // Without a number the part is 1.
    expect((await parseExportFromReader(bytesReader(mediaZip([0], (ms) => ({ utcMs: ms }))))).bundledMedia?.[0]?.part).toBe(1);
  });

  it("does not look at the media of other folders, however well their names match", async () => {
    const files = buildFixtureZip([
      { name: `chat_media/${day(T0)}_${uuid(1)}-main.jpg`, data: enc("x"), utcMs: T0 },
      { name: `shared_story/${day(T0)}_${uuid(1)}-main.jpg`, data: enc("x"), utcMs: T0 },
    ]);
    const parsed = await parseExportFromReader(bytesReader(files), { part: 2 });
    expect(parsed.bundledMedia).toBeUndefined();
    expect(mergeParsedExports([await parseExportFromReader(bytesReader(listZip()), { part: 1 }), parsed]).memories.some((m) => m.zipPath !== undefined)).toBe(false);
  });
});
