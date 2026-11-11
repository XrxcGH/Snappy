/**
 * The import pipeline: parts read in export order from Blobs, a real percentage of the bytes read,
 * yields to the page between reads, and the same result as reading the parts directly.
 * Synthetic data only.
 */
import { bytesReader, mergeParsedExports, parseExportFromReader } from "@snappy-export/core";
import { describe, expect, it } from "vitest";
import { runImport } from "../src/import-pipeline.ts";
import type { ImportProgress } from "../src/import-pipeline.ts";
import { partFiles } from "./export-fixtures.ts";

const NO_YIELD = async (): Promise<void> => {};

async function collect(blobs: Blob[], extra: { now?: () => number; yieldToUi?: () => Promise<void> } = {}) {
  const progress: ImportProgress[] = [];
  const parsed = await runImport(blobs, { onProgress: (p) => progress.push(p), yieldToUi: extra.yieldToUi ?? NO_YIELD, ...(extra.now && { now: extra.now }) });
  return { parsed, progress };
}

describe("runImport", () => {
  it("gives the same result as parsing every part and merging them", async () => {
    const files = partFiles(2);
    const { parsed } = await collect(files);
    const direct = mergeParsedExports(await Promise.all(files.map(async (f, i) => parseExportFromReader(bytesReader(new Uint8Array(await f.arrayBuffer())), { part: i + 1 }))));
    expect(parsed).toEqual(direct);
  });

  it("numbers the parts by position, so Memories files know which zip holds them", async () => {
    const { parsed } = await collect(partFiles(2));
    const parts = new Set((parsed.bundledMedia ?? []).map((m) => m.part));
    expect([...parts].sort()).toEqual([2, 3]);
    const have = parsed.memories.filter((m) => m.partIndex !== undefined);
    expect(have.length).toBeGreaterThan(0);
    expect(new Set(have.map((m) => m.partIndex))).toEqual(new Set([2, 3]));
    expect(parsed.memoriesPairing?.method).toBe("utc-time");
  });

  it("counts Snaps as activity, next to saved chats", async () => {
    const { parsed } = await collect(partFiles(2));
    const kinds = new Set(parsed.chats.map((c) => c.kind));
    expect(kinds.has("IMAGE") || kinds.has("VIDEO")).toBe(true);
    expect(kinds.has("TEXT")).toBe(true);
  });

  it("reports a real percentage that only grows, from the first part to the last", async () => {
    const { progress } = await collect(partFiles(2));
    expect(progress.length).toBeGreaterThan(3);
    const fractions = progress.map((p) => p.fraction);
    expect(fractions.every((f) => f !== null)).toBe(true);
    for (let i = 1; i < fractions.length; i++) expect(fractions[i] as number).toBeGreaterThanOrEqual(fractions[i - 1] as number);
    expect(fractions[0]).toBe(0);
    expect(fractions[fractions.length - 1]).toBe(1);
    for (const f of fractions) expect(f as number).toBeLessThanOrEqual(1);
    // Part by part: 0, 1, 2 while reading, then 3 of 3 once all are read.
    expect([...new Set(progress.map((p) => p.step))]).toEqual([0, 1, 2, 3]);
    expect(new Set(progress.map((p) => p.steps))).toEqual(new Set([3]));
  });

  it("does not say 100 percent until the last part is parsed, since the bytes are read before the parsing ends", async () => {
    for (const blobs of [partFiles(2), [partFiles(2)[0] as File]]) {
      const { progress } = await collect(blobs);
      const last = progress[progress.length - 1] as ImportProgress;
      expect(last.fraction).toBe(1);
      expect(last.step).toBe(last.steps);
      for (const p of progress.filter((q) => q.step < q.steps)) expect(Math.round((p.fraction as number) * 100)).toBeLessThan(100);
    }
  });

  it("reports at most one update per percent point, plus one per part", async () => {
    const { progress } = await collect(partFiles(2));
    // 101 percent points, 4 forced reports (three parts and the end): a loose upper bound.
    expect(progress.length).toBeLessThanOrEqual(110);
  });

  it("lets the page paint between reads when work runs long, and not when it is quick", async () => {
    let yields = 0;
    let clock = 0;
    const slow = await collect(partFiles(2), {
      now: () => (clock += 50),
      yieldToUi: async () => {
        yields++;
      },
    });
    expect(yields).toBeGreaterThan(5);
    expect(slow.parsed.chats.length).toBeGreaterThan(0);

    yields = 0;
    await collect(partFiles(2), {
      now: () => 0,
      yieldToUi: async () => {
        yields++;
      },
    });
    expect(yields).toBe(0);
  });

  it("yields between reads, never inside one, and the result does not depend on it", async () => {
    let clock = 0;
    const withYields = await collect(partFiles(2), { now: () => (clock += 50) });
    const without = await collect(partFiles(2), { now: () => 0 });
    expect(withYields.parsed).toEqual(without.parsed);
  });

  it("reads a single zip without merging, and reports a percentage for it", async () => {
    const [first] = partFiles(2);
    const { parsed, progress } = await collect([first as File]);
    const direct = await parseExportFromReader(bytesReader(new Uint8Array(await (first as File).arrayBuffer())), { part: 1 });
    expect(parsed).toEqual(direct);
    expect(progress[progress.length - 1]).toEqual({ step: 1, steps: 1, fraction: 1 });
  });

  it("has no percentage when there is nothing to measure, and still finishes", async () => {
    const [, second] = partFiles(2);
    const { parsed, progress } = await collect([second as File]);
    expect(parsed.friends.friends).toEqual([]);
    expect(progress.every((p) => p.fraction === null)).toBe(true);
    expect(progress[progress.length - 1]?.step).toBe(1);
  });

  it("treats a damaged or unreadable zip as an export with problems, not as a crash", async () => {
    const { parsed } = await collect([new File([new Uint8Array(500)], "broken.zip")]);
    expect(parsed.issues.some((i) => i.severity === "error")).toBe(true);
    expect(parsed.chats).toEqual([]);

    const unreadable = { size: 100_000, slice: () => ({ arrayBuffer: () => Promise.reject(new Error("denied by the disk")) }) } as unknown as Blob;
    const result = await collect([unreadable]);
    expect(result.parsed.issues.some((i) => i.severity === "error")).toBe(true);
    expect(JSON.stringify(result.parsed.issues)).not.toContain("denied by the disk");
  });
});
