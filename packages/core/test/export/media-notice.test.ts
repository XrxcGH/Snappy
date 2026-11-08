import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { visibleIssues } from "../../src/export/parse.ts";
import { bytesReader, mergeParsedExports, parseExportFromReader } from "../../src/export/zip-reader.ts";
import { emptyFriends } from "../../src/export/friends.ts";
import type { ParsedExport } from "../../src/types.ts";
import { enc } from "./helpers.ts";

/** A part with `media` photo files next to a friends list. */
async function partWith(media: number, part: number): Promise<ParsedExport> {
  const files: Record<string, Uint8Array> = { "json/friends.json": enc({ Friends: [{ Username: "amy_1" }] }) };
  for (let i = 0; i < media; i++) files[`memories/2024-01-01_${part}-${i}-main.jpg`] = new Uint8Array(4);
  return parseExportFromReader(bytesReader(zipSync(files)), { part });
}

const mediaNotes = (p: ParsedExport) => p.issues.filter((i) => i.code === "media-not-opened");

describe("the media note across parts", () => {
  it("is one note with the total, even when two parts list the same number of files", async () => {
    const parts = [await partWith(5, 1), await partWith(100, 2), await partWith(100, 3)];
    const merged = mergeParsedExports(parts);
    expect(mediaNotes(merged)).toHaveLength(1);
    expect(mediaNotes(merged)[0]?.message).toBe("Snappy listed 205 media files by name and size only. It did not open them.");
  });

  it("is the same in any order", async () => {
    const parts = [await partWith(5, 1), await partWith(100, 2), await partWith(100, 3)];
    expect(mergeParsedExports([parts[2] as ParsedExport, parts[0] as ParsedExport, parts[1] as ParsedExport])).toEqual(mergeParsedExports(parts));
  });

  it("counts a part once however often it is merged", async () => {
    const parts = [await partWith(5, 1), await partWith(100, 2)];
    const merged = mergeParsedExports(parts);
    expect(mediaNotes(mergeParsedExports([merged, parts[1] as ParsedExport]))[0]?.message).toContain("105 media files");
    expect(mediaNotes(mergeParsedExports([parts[0] as ParsedExport, parts[0] as ParsedExport, parts[1] as ParsedExport]))[0]?.message).toContain("105 media files");
    expect(mergeParsedExports([merged, merged])).toEqual(merged);
  });

  it("a single part keeps its own note, and one file reads in the singular", async () => {
    const one = await partWith(1, 1);
    expect(mediaNotes(mergeParsedExports([one]))[0]?.message).toBe("Snappy listed 1 media file by name and size only. It did not open it.");
    expect(mergeParsedExports([one])).toEqual(one);
  });

  it("no media, no note", async () => {
    expect(mediaNotes(mergeParsedExports([await partWith(0, 1), await partWith(0, 2)]))).toEqual([]);
  });
});

describe("the file list note is for the inspect report", () => {
  const html = (n: number, tag: string) => Array.from({ length: n }, (_, i) => `html/<file-${tag}${i + 1}>.html`);
  const part = (fileList: string[]): ParsedExport => ({ friends: emptyFriends(), chats: [], memories: [], fileList, issues: [] });

  it("is marked hidden, and kept in the issue list", () => {
    const merged = mergeParsedExports([part(html(400, "a")), part(html(400, "b"))]);
    const note = merged.issues.find((i) => i.code === "file-list-truncated");
    expect(note).toMatchObject({ severity: "info", hidden: true });
  });

  it("visibleIssues leaves it out, and only it", async () => {
    const merged = mergeParsedExports([part(html(400, "a")), part(html(400, "b"))]);
    const withMedia = { ...merged, issues: [...merged.issues, ...mediaNotes(await partWith(2, 1))] };
    expect(withMedia.issues.map((i) => i.code)).toEqual(["file-list-truncated", "media-not-opened"]);
    expect(visibleIssues(withMedia.issues).map((i) => i.code)).toEqual(["media-not-opened"]);
  });
});
