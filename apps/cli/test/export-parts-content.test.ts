/**
 * The parts of an export are told apart by what each zip holds (its directory), not by its name: two different
 * exports are refused with both numbers named, the part with the lists is read first whatever it is called, and
 * parts of photos and videos only are refused whatever they are called. Synthetic data only.
 */
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CliError } from "../src/errors.ts";
import { checkParts, exportId, scanNames } from "../src/export-parts.ts";
import type { PartScan } from "../src/export-parts.ts";
import { requireFirstPart, resolveZipPaths } from "../src/inputs.ts";
import { makeIo, tempDir, writeSyntheticParts } from "./helpers.ts";

const code = async (p: Promise<unknown>): Promise<string | undefined> => {
  try {
    await p;
    return undefined;
  } catch (e) {
    return e instanceof CliError ? e.code : "other";
  }
};
const message = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return "";
  } catch (e) {
    return e instanceof Error ? e.message : "";
  }
};
const base = (paths: string[]): string[] => paths.map((p) => p.split(/[\\/]/).pop() as string);

/** Three parts (the lists, then two of photos and videos) written under the given names. */
function writeAs(dir: string, names: [string, string, string]): string[] {
  const staging = tempDir("stage");
  const parts = writeSyntheticParts(staging);
  return parts.map((from, i) => {
    const to = join(dir, names[i] as string);
    copyFileSync(from, to);
    return to;
  });
}

describe("exportId", () => {
  it("is the digits after the prefix, from any part of that export", () => {
    expect(exportId("/x/mydata~1700000000000.zip")).toBe("1700000000000");
    expect(exportId("C:\\x\\MYDATA~1700000000000-3.ZIP")).toBe("1700000000000");
    expect(exportId("holiday.zip")).toBeNull();
  });
});

describe("scanNames", () => {
  it("sees the lists, JSON files and pages, and ignores the memories page of a later part", () => {
    expect(scanNames(["json/friends.json", "chat_media/a.jpg"])).toEqual({ listed: true, friends: true, pages: true });
    expect(scanNames(["memories/memories_2.html", "memories/a.jpg"])).toEqual({ listed: true, friends: false, pages: false });
    expect(scanNames(["html/index.html"])).toEqual({ listed: true, friends: false, pages: true });
    expect(scanNames([])).toEqual({ listed: false, friends: false, pages: false });
  });
});

describe("checkParts", () => {
  const lists: PartScan = { listed: true, friends: true, pages: true };
  const media: PartScan = { listed: true, friends: false, pages: false };

  it("puts the part with the lists first, then -2, -3, and reads -part-N as a number", () => {
    const check = checkParts(["/d/mydata~1-part-3.zip", "/d/mydata~1-part-2.zip", "/d/mydata~1-1.zip"], [media, media, lists]);
    expect(check).toEqual({ kind: "ok", ordered: ["/d/mydata~1-1.zip", "/d/mydata~1-part-2.zip", "/d/mydata~1-part-3.zip"] });
  });

  it("names the two numbers, smaller first", () => {
    expect(checkParts(["/d/mydata~1710000000000.zip", "/d/mydata~1700000000000-2.zip"], [lists, media])).toEqual({ kind: "mixed", ids: ["1700000000000", "1710000000000"] });
  });

  it("does not refuse names without an export number, or a browser copy of one export", () => {
    expect(checkParts(["/d/a.zip", "/d/b.zip"], [lists, lists]).kind).toBe("ok");
    expect(checkParts(["/d/mydata~1.zip", "/d/mydata~1 (1).zip"], [lists, lists]).kind).toBe("ok");
  });

  it("calls parts later parts when none holds a page, and judges an unlistable part by its name", () => {
    expect(checkParts(["/d/holiday.zip"], [media])).toEqual({ kind: "later-only" });
    const unlisted: PartScan = { listed: false, friends: false, pages: false };
    expect(checkParts(["/d/mydata~1-2.zip"], [unlisted])).toEqual({ kind: "later-only" });
    expect(checkParts(["/d/broken.zip"], [unlisted]).kind).toBe("ok");
  });
});

describe("resolveZipPaths by content", () => {
  it("refuses parts of two different exports and names both numbers", async () => {
    const dir = tempDir("two-exports");
    writeAs(dir, ["mydata~1700000000000.zip", "mydata~1700000000000-2.zip", "mydata~1700000000000-3.zip"]);
    copyFileSync(join(dir, "mydata~1700000000000.zip"), join(dir, "mydata~1710000000000.zip"));
    expect(await code(resolveZipPaths(makeIo(), [dir]))).toBe("mixed-exports");
    const text = await message(resolveZipPaths(makeIo(), [join(dir, "mydata*.zip")]));
    expect(text).toContain("1700000000000");
    expect(text).toContain("1710000000000");
  });

  it("reads the part with the lists first although its name carries a number", async () => {
    const dir = tempDir("named-1");
    writeAs(dir, ["mydata~1700000000000-1.zip", "mydata~1700000000000-2.zip", "mydata~1700000000000-3.zip"]);
    const paths = await resolveZipPaths(makeIo(), [dir]);
    expect(base(paths)).toEqual(["mydata~1700000000000-1.zip", "mydata~1700000000000-2.zip", "mydata~1700000000000-3.zip"]);
    // By name alone, a first part named -1 would have been refused as a later part.
    expect(() => requireFirstPart(paths)).not.toThrow();
  });

  it("puts the part with the lists first when the names would put it elsewhere", async () => {
    const dir = tempDir("reordered");
    // The lists are in "zzz.zip"; by name it would sort last.
    writeAs(dir, ["zzz.zip", "aaa.zip", "bbb.zip"]);
    expect(base(await resolveZipPaths(makeIo(), [dir]))[0]).toBe("zzz.zip");
  });

  it("refuses photo and video parts however they are called, and a lone part 1 with a later-part name is read", async () => {
    const dir = tempDir("media-only");
    const [, second, third] = writeAs(dir, ["mydata~1.zip", "holiday-photos.zip", "more photos.zip"]);
    const paths = await resolveZipPaths(makeIo(), [second as string, third as string]);
    expect(() => requireFirstPart(paths)).toThrowError(expect.objectContaining({ code: "later-parts-only" }));
    const lone = join(dir, "mydata~1-2.zip");
    writeFileSync(lone, readFileSync(join(dir, "mydata~1.zip")));
    expect(() => requireFirstPart([lone])).toThrowError(expect.objectContaining({ code: "later-parts-only" }));
    const checked = await resolveZipPaths(makeIo(), [lone]);
    expect(() => requireFirstPart(checked)).not.toThrow();
  });
});
