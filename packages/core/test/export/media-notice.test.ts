import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { mediaNotOpenedIssue, visibleIssues } from "../../src/export/parse.ts";
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

describe("the media note says how many of the files are Memories files", () => {
  /** A part with `memories` Memories files and `chat` photos outside the Memories folder. */
  async function mixed(memories: number, chat: number, part: number): Promise<ParsedExport> {
    const files: Record<string, Uint8Array> = { "json/friends.json": enc({ Friends: [{ Username: "amy_1" }] }) };
    for (let i = 0; i < memories; i++) files[`memories/2024-01-01_${part}-${i}-main.jpg`] = new Uint8Array(4);
    for (let i = 0; i < chat; i++) files[`chat_media/2024-01-01_${part}-${i}.jpg`] = new Uint8Array(4);
    return parseExportFromReader(bytesReader(zipSync(files)), { part });
  }

  it("adds the Memories share when other media files are counted too", async () => {
    const merged = mergeParsedExports([await mixed(5, 2, 1), await mixed(10, 0, 2)]);
    expect(mediaNotes(merged)[0]?.message).toBe("Snappy listed 17 media files by name and size only, including 15 Memories files. It did not open them.");
  });

  it("reads in the singular for one Memories file", async () => {
    const one = await mixed(1, 2, 1);
    expect(mediaNotes(one)[0]?.message).toBe("Snappy listed 3 media files by name and size only, including 1 Memories file. It did not open them.");
  });

  it("says nothing more when every file is a Memories file, or none is", async () => {
    expect(mediaNotes(await mixed(3, 0, 1))[0]?.message).toBe("Snappy listed 3 media files by name and size only. It did not open them.");
    expect(mediaNotes(await mixed(0, 3, 1))[0]?.message).toBe("Snappy listed 3 media files by name and size only. It did not open them.");
  });

  it("counts a part once however often it is merged", async () => {
    const parts = [await mixed(5, 2, 1), await mixed(10, 0, 2)];
    const merged = mergeParsedExports(parts);
    expect(mediaNotes(mergeParsedExports([merged, parts[1] as ParsedExport]))[0]?.message).toContain("17 media files");
    expect(mediaNotes(mergeParsedExports([merged, parts[1] as ParsedExport]))[0]?.message).toContain("including 15 Memories files");
  });
});

describe("the media note when two copies of a part differ in their Memories count", () => {
  const withNote = (memories: Record<number, number>): ParsedExport => ({ friends: emptyFriends(), chats: [], memories: [], fileList: [], issues: [mediaNotOpenedIssue({ 1: 7, 2: 10 }, memories)] });

  it("keeps the larger count for each part instead of dropping one copy", () => {
    const a = withNote({ 1: 5, 2: 10 });
    const b = withNote({ 1: 3, 2: 12 });
    // Same text and same file counts, so only the Memories counts tell them apart: 5 + 12 is every file.
    expect(a.issues[0]?.message).toBe(b.issues[0]?.message);
    const merged = mediaNotes(mergeParsedExports([a, b]));
    expect(merged).toHaveLength(1);
    expect(merged[0]?.partMemories).toEqual({ 1: 5, 2: 12 });
    expect(merged[0]?.message).toBe("Snappy listed 17 media files by name and size only. It did not open them.");
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
