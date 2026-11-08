/**
 * An export that a browser unzipped (Safari does) is a folder with json/ inside. The command line tool reads that folder:
 * only its few JSON files, wrapped in memory as one ZIP file, so every command works on it as on ZIP files. A single JSON
 * file, an empty folder and another kind of file keep clear messages. Synthetic data only.
 */
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { syntheticExportParts } from "@snappy-export/core";
import { parseParts, resolveZipPaths, withReaders } from "../src/inputs.ts";
import { NOW, makeIo, run, tempDir, writeSyntheticParts } from "./helpers.ts";

const failure = async (p: Promise<unknown>): Promise<{ code?: string; message: string }> => {
  try {
    await p;
    return { message: "" };
  } catch (e) {
    return { code: (e as { code?: string }).code, message: (e as Error).message };
  }
};

/** The JSON files of a synthetic export written as an unzipped folder: json/ with the data, media folders left empty. */
function writeUnzipped(dir: string): string {
  const base = syntheticExportParts({ now: NOW, phase: 2, friendCount: 40, chatMessageCount: 200, memoryCount: 40 })[0]?.bytes as Uint8Array;
  const folder = join(dir, "mydata~1700000000000");
  mkdirSync(join(folder, "json"), { recursive: true });
  mkdirSync(join(folder, "chat_media"));
  for (const [name, bytes] of Object.entries(unzipSync(base))) {
    if (name.endsWith(".json")) writeFileSync(join(folder, name), bytes);
  }
  // A stray file with a data name, deeper in a media folder: it must not be read.
  writeFileSync(join(folder, "chat_media", "friends.json"), "{}");
  return folder;
}

describe("an unzipped export given to the command line tool", () => {
  it("is read as one export from its folder, with a note that there are no photos or videos", async () => {
    const folder = writeUnzipped(tempDir("unzipped"));
    const io = makeIo();
    const paths = await resolveZipPaths(io, [folder]);
    expect(paths).toEqual([folder]);
    const parsed = await withReaders(io, paths, (readers) => parseParts(readers, io));
    expect(parsed.friends.friends).toHaveLength(40);
    expect(parsed.memories.length).toBeGreaterThan(0);
    expect(parsed.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(parsed.issues.find((i) => i.code === "folder-no-media")).toMatchObject({ severity: "info" });
    // The export date is the time of the files, as the time inside a ZIP file would be.
    expect(parsed.exportedAt).toBe(Math.floor(statSync(join(folder, "json", "friends.json")).mtimeMs / 1000) * 1000);
  });

  it("gives the same friends as the ZIP files of the same export", async () => {
    const dir = tempDir("unzipped-same");
    const folder = writeUnzipped(dir);
    const io = makeIo();
    const zipPath = join(dir, "same.zip");
    writeFileSync(zipPath, syntheticExportParts({ now: NOW, phase: 2, friendCount: 40, chatMessageCount: 200, memoryCount: 40 })[0]?.bytes as Uint8Array);
    const zips = await resolveZipPaths(io, [zipPath]);
    const fromZip = await withReaders(io, zips, (readers) => parseParts(readers, io));
    const fromFolder = await withReaders(io, [folder], (readers) => parseParts(readers, io));
    expect(fromFolder.friends.friends.length).toBe(fromZip.friends.friends.length);
  });

  it("works through a command, which reads the folder like any path", async () => {
    const folder = writeUnzipped(tempDir("unzipped-cmd"));
    const result = await run(["check", folder]);
    expect(result.code).toBe(0);
    expect(result.out).toMatch(/friends/i);
  });

  it("refuses a folder given together with ZIP files, which would read the lists twice", async () => {
    const dir = tempDir("unzipped-both");
    const folder = writeUnzipped(dir);
    const zip = (writeSyntheticParts(join(dir, "zips")) as string[])[0] as string;
    expect((await failure(resolveZipPaths(makeIo(), [folder, zip]))).code).toBe("mixed-inputs");
  });

  it("names a single JSON file as part of an unzipped export, and keeps the existing messages for the rest", async () => {
    const dir = tempDir("unzipped-json");
    writeFileSync(join(dir, "friends.json"), "{}");
    const single = await failure(resolveZipPaths(makeIo(), [join(dir, "friends.json")]));
    expect(single.code).toBe("unzipped-export");
    expect(single.message).toMatch(/unzipped export/);
    expect(single.message).not.toContain(dir);

    const empty = tempDir("empty");
    expect((await failure(resolveZipPaths(makeIo(), [empty]))).code).toBe("no-zips");
    // A json folder with none of the files Snappy reads is not an export either: the same message, not an empty export.
    const hollow = tempDir("hollow");
    mkdirSync(join(hollow, "json"));
    writeFileSync(join(hollow, "json", "account.json"), "{}");
    expect((await failure(resolveZipPaths(makeIo(), [hollow]))).code).toBe("no-zips");
    writeFileSync(join(empty, "notes.txt"), "x");
    expect((await failure(resolveZipPaths(makeIo(), [join(empty, "notes.txt")]))).code).toBe("not-zip");
  });
});
