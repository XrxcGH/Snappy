/**
 * A folder that holds an unzipped export (Safari unzips downloads) or a JSON file is not "No .zip files": the
 * message says what it looks like and what to do. Everything else keeps its existing message.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveZipPaths } from "../src/inputs.ts";
import { makeIo, tempDir } from "./helpers.ts";

const failure = async (p: Promise<unknown>): Promise<{ code?: string; message: string }> => {
  try {
    await p;
    return { message: "" };
  } catch (e) {
    return { code: (e as { code?: string }).code, message: (e as Error).message };
  }
};

describe("an unzipped export given to the command line tool", () => {
  it("is named as such when the folder holds json/", async () => {
    const dir = tempDir("unzipped");
    mkdirSync(join(dir, "json"));
    writeFileSync(join(dir, "json", "friends.json"), "{}");
    const result = await failure(resolveZipPaths(makeIo(), [dir]));
    expect(result.code).toBe("unzipped-export");
    expect(result.message).toMatch(/unzipped export/);
    expect(result.message).toMatch(/ZIP files/);
    expect(result.message).not.toContain(dir);
  });

  it("is named as such for a JSON file and for a folder of JSON files", async () => {
    const dir = tempDir("unzipped-json");
    writeFileSync(join(dir, "friends.json"), "{}");
    expect((await failure(resolveZipPaths(makeIo(), [join(dir, "friends.json")]))).code).toBe("unzipped-export");
    expect((await failure(resolveZipPaths(makeIo(), [dir]))).code).toBe("unzipped-export");
  });

  it("keeps the existing messages for an empty folder and for another kind of file", async () => {
    const empty = tempDir("empty");
    expect((await failure(resolveZipPaths(makeIo(), [empty]))).code).toBe("no-zips");
    writeFileSync(join(empty, "notes.txt"), "x");
    expect((await failure(resolveZipPaths(makeIo(), [join(empty, "notes.txt")]))).code).toBe("not-zip");
    expect((await failure(resolveZipPaths(makeIo(), [empty]))).code).toBe("no-zips");
  });
});
