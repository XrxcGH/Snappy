/**
 * `storageShowcase`: the realistic synthetic export with declared Memories file sizes, so the storage meter, the cap
 * projection and the storage planner have something to show. Synthetic data only.
 */
import { describe, expect, it } from "vitest";
import {
  DAY_MS,
  bytesReader,
  insights,
  listZipEntries,
  mergeParsedExports,
  parseExportFromReader,
  planMemories,
  syntheticExportParts,
  syntheticExportZip,
} from "../../src/index.ts";

const NOW = Date.UTC(2026, 10, 6, 12, 0, 0);
const REAL = { now: NOW, memoryCount: 400, realisticMemories: true } as const;
const SHOW = { ...REAL, storageShowcase: true } as const;
const MB = 1024 * 1024;

async function parse(zip: Uint8Array) {
  return mergeParsedExports([await parseExportFromReader(bytesReader(zip))]);
}

describe("the plain realistic export is left as it was", () => {
  it("has tiny Memories files", async () => {
    const parsed = await parse(syntheticExportZip(REAL));
    const plan = planMemories(parsed.memories, { now: NOW });
    expect(plan.meter.knownBytes).toBeLessThan(MB);
    expect(plan.meter.projectedCapAt).toBeNull();
  });

  it("is byte for byte what it was when the option is false", () => {
    expect(syntheticExportZip({ ...REAL, storageShowcase: false })).toEqual(syntheticExportZip(REAL));
  });
});

describe("storageShowcase", () => {
  it("gives the storage meter megabytes to read, a share of the cap and a projected date", async () => {
    const parsed = await parse(syntheticExportZip(SHOW));
    const { meter } = planMemories(parsed.memories, { now: NOW });
    expect(meter.knownBytes).toBeGreaterThan(300 * MB);
    expect(meter.fractionOfCap).toBeGreaterThan(0.05);
    expect(meter.fractionOfCap).toBeLessThan(0.6);
    // Some Memories have no file, so some sizes stay unknown, as in a real export.
    expect(meter.unknownSizeCount).toBeGreaterThan(0);
    expect(meter.projectedCapAt).not.toBeNull();
    expect(meter.projectedCapAt as number).toBeGreaterThan(NOW + 365 * DAY_MS);
    expect(meter.projectedCapAt as number).toBeLessThan(Date.UTC(2100, 0, 1));
  });

  it("keeps the real shape of the list: every link empty, so the Memories are paired by their files", async () => {
    const parsed = await parse(syntheticExportZip(SHOW));
    expect(parsed.memories).toHaveLength(400);
    expect(parsed.memories.every((m) => m.downloadUrl === undefined)).toBe(true);
    expect(parsed.issues.some((i) => i.code === "memories-links-empty")).toBe(true);
    expect(parsed.memories.filter((m) => m.zipPath !== undefined).length).toBeGreaterThan(200);
  });

  it("declares sizes in the real ranges: images of 0.2 to 4 MB, videos of 3 to 40 MB", async () => {
    const parsed = await parse(syntheticExportZip(SHOW));
    const sized = parsed.memories.filter((m) => typeof m.sizeBytes === "number");
    expect(sized.length).toBeGreaterThan(200);
    for (const m of sized) {
      const size = m.sizeBytes as number;
      if (m.mediaType === "video") expect(size >= 3_000_000 && size <= 40_000_000).toBe(true);
      else expect(size >= 200_000 && size <= 4_000_000).toBe(true);
    }
  });

  it("writes the same size into the local header as into the directory, and leaves the files small", async () => {
    const zip = syntheticExportZip(SHOW);
    const { entries } = await listZipEntries(bytesReader(zip));
    const media = entries.filter((e) => /^memories\/.*-main\.(jpg|mp4)$/.test(e.name));
    expect(media.length).toBeGreaterThan(200);
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    for (const e of media) {
      expect(view.getUint32(e.localHeaderOffset + 22, true)).toBe(e.size);
      expect(e.size).toBeGreaterThan(100_000);
      expect(e.compressedSize).toBeLessThan(1_000);
    }
    expect(zip.length).toBeLessThan(2 * MB);
  });

  it("changes only the sizes of the main Memories files: every other entry keeps its real size", async () => {
    const plain = (await listZipEntries(bytesReader(syntheticExportZip(REAL)))).entries;
    const shown = (await listZipEntries(bytesReader(syntheticExportZip(SHOW)))).entries;
    expect(shown.map((e) => e.name)).toEqual(plain.map((e) => e.name));
    plain.forEach((e, i) => {
      const other = shown[i];
      if (/-main\.(jpg|mp4)$/.test(e.name)) expect(other?.size).toBeGreaterThan(e.size);
      else expect(other?.size).toBe(e.size);
    });
  });

  it("is deterministic, and the earlier export sizes the Memories it shares with the later one the same way", async () => {
    expect(syntheticExportZip(SHOW)).toEqual(syntheticExportZip(SHOW));
    const earlier = await parse(syntheticExportZip({ ...SHOW, phase: 1 }));
    const later = await parse(syntheticExportZip({ ...SHOW, phase: 2 }));
    expect(earlier.memories.length).toBeLessThan(later.memories.length);
    const sizes = new Map(later.memories.map((m) => [m.date, m.sizeBytes]));
    const shared = earlier.memories.filter((m) => m.sizeBytes !== undefined);
    expect(shared.length).toBeGreaterThan(20);
    for (const m of shared) expect(sizes.get(m.date)).toBe(m.sizeBytes);
  });

  it("does not move the other generator streams: friends and Memories dates are the same as without it", async () => {
    const a = await parse(syntheticExportZip(REAL));
    const b = await parse(syntheticExportZip(SHOW));
    expect(JSON.stringify(b.friends)).toBe(JSON.stringify(a.friends));
    expect(b.memories.map((m) => m.date)).toEqual(a.memories.map((m) => m.date));
  });

  it("also applies to the three-part layout", async () => {
    const parts = syntheticExportParts({ now: NOW, memoryCount: 400, storageShowcase: true });
    const videos = (await Promise.all(parts.map((p) => listZipEntries(bytesReader(p.bytes))))).flatMap((l) => l.entries).filter((e) => e.name.endsWith("-main.mp4"));
    expect(videos.length).toBeGreaterThan(30);
    expect(videos.every((e) => e.size >= 3_000_000)).toBe(true);
  });

  it("gives the storage planner a size for most of the list, spread over several years", async () => {
    const parsed = await parse(syntheticExportZip(SHOW));
    const plan = insights.storagePlanner.planMemoryStorage(parsed.memories, 5 * 1024 ** 3, { now: NOW });
    expect(plan.totals.knownBytes).toBeGreaterThan(300 * MB);
    expect(plan.totals.unsized).toBeGreaterThan(0);
    expect(plan.byYear.length).toBeGreaterThan(2);
  });
});
