import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bytesReader, listZipEntries, parseExportFromReader, syntheticExportZip } from "@snappy-export/core";
import { openFileReader } from "../src/fs-reader.ts";
import { resolveZipPaths } from "../src/inputs.ts";
import { LATER, makeIo, tempDir, writeSyntheticZip } from "./helpers.ts";

describe("openFileReader", () => {
  it("returns exactly the requested ranges and the file size", async () => {
    const file = join(tempDir("reader"), "bytes.bin");
    writeFileSync(file, Uint8Array.from({ length: 1000 }, (_, i) => i % 251));
    const reader = await openFileReader(makeIo(), file);
    try {
      expect(reader.size).toBe(1000);
      expect([...(await reader.read(10, 15))]).toEqual([10, 11, 12, 13, 14]);
      expect((await reader.read(5, 5)).length).toBe(0);
      expect((await reader.read(990, 1000)).length).toBe(10);
    } finally {
      await reader.close();
    }
  });

  it("rejects a range past the end of the file instead of returning short data", async () => {
    const file = join(tempDir("reader"), "short.bin");
    writeFileSync(file, "abc");
    const reader = await openFileReader(makeIo(), file);
    try {
      await expect(reader.read(0, 10)).rejects.toBeInstanceOf(RangeError);
    } finally {
      await reader.close();
    }
  });

  it("gives core the same view of a zip as an in-memory reader, requesting only small ranges", async () => {
    const dir = tempDir("reader");
    const zip = syntheticExportZip({ now: LATER, friendCount: 30, memoryCount: 10, bundleMedia: true });
    const path = join(dir, "export.zip");
    writeFileSync(path, zip);

    const fileReader = await openFileReader(makeIo(), path);
    let requested = 0;
    const counting = { size: fileReader.size, read: (s: number, e: number) => ((requested += e - s), fileReader.read(s, e)) };
    try {
      expect(await parseExportFromReader(counting)).toEqual(await parseExportFromReader(bytesReader(zip)));
      expect((await listZipEntries(counting)).entries.length).toBeGreaterThan(4);
      // The JSON files are read, the bundled media entries are not: far less than reading twice over.
      expect(requested).toBeLessThan(zip.length * 2);
    } finally {
      await fileReader.close();
    }
  });

  it("reports a missing file with a calm coded error", async () => {
    await expect(openFileReader(makeIo(), join(tempDir("reader"), "missing.zip"))).rejects.toMatchObject({ code: "not-found" });
  });
});

describe("resolveZipPaths", () => {
  it("expands a folder into its zips in natural order and ignores other files", async () => {
    const dir = tempDir("parts");
    for (const name of ["export-10.zip", "export-2.zip", "export-1.ZIP"]) writeFileSync(join(dir, name), "x");
    writeFileSync(join(dir, "notes.txt"), "x");
    mkdirSync(join(dir, "sub.zip")); // a folder named like a zip is not a part
    const paths = await resolveZipPaths(makeIo(), [dir]);
    expect(paths.map((p) => p.split(/[\\/]/).pop())).toEqual(["export-1.ZIP", "export-2.zip", "export-10.zip"]);
  });

  it("removes duplicates and rejects folders without zips, non-zip files and no input", async () => {
    const dir = tempDir("parts");
    const zip = writeSyntheticZip(dir, "a.zip");
    expect(await resolveZipPaths(makeIo(), [zip, dir, zip])).toHaveLength(1);

    const empty = tempDir("parts");
    await expect(resolveZipPaths(makeIo(), [empty])).rejects.toMatchObject({ code: "no-zips" });
    appendFileSync(join(empty, "a.txt"), "x");
    await expect(resolveZipPaths(makeIo(), [join(empty, "a.txt")])).rejects.toMatchObject({ code: "not-zip" });
    await expect(resolveZipPaths(makeIo(), [])).rejects.toMatchObject({ code: "no-input" });
    await expect(resolveZipPaths(makeIo(), [join(empty, "missing.zip")])).rejects.toMatchObject({ code: "not-found" });
  });
});
