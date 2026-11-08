import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { validateExport } from "../../src/export/parse.ts";
import { bytesReader, mergeParsedExports, parseExportFromReader } from "../../src/export/zip-reader.ts";
import { enc } from "./helpers.ts";

const NOTE = "Your ZIP files hold the Memories list but no photos or videos. Choose Export your Memories to rescue them.";
const entry = (i: number, link: string) => ({ Date: `2024-03-0${i + 1} 10:00:00 UTC`, "Media Type": "Image", Location: "never read", "Download Link": link });
const emptyLinks = { "Saved Media": [entry(0, ""), entry(1, ""), entry(2, "")] };

const jsonOnly = (memories: unknown) => zipSync({ "json/friends.json": enc({ Friends: [{ Username: "amy_1" }] }), "json/memories_history.json": enc(memories) });
const loud = (issues: { severity: string }[]) => issues.filter((i) => i.severity !== "info");

describe("an export with the Memories list and no photos or videos", () => {
  it("says what it holds, as a note", async () => {
    const parsed = await parseExportFromReader(bytesReader(jsonOnly(emptyLinks)));
    const note = parsed.issues.find((i) => i.code === "memories-list-only");
    expect(note).toEqual({ severity: "info", code: "memories-list-only", message: NOTE });
    expect(parsed.issues.map((i) => i.code)).not.toContain("memories-no-media-source");
  });

  it("leaves nothing for the Overview to warn about", async () => {
    const parsed = await parseExportFromReader(bytesReader(jsonOnly(emptyLinks)));
    expect(loud(parsed.issues)).toEqual([]);
    expect(loud(validateExport(parsed))).toEqual([]);
  });

  it("says nothing when every Memory has a link", async () => {
    const parsed = await parseExportFromReader(bytesReader(jsonOnly({ "Saved Media": [entry(0, "https://example.invalid/a")] })));
    expect(parsed.issues.map((i) => i.code)).not.toContain("memories-list-only");
  });

  it("is dropped when another part does hold the files", async () => {
    const first = await parseExportFromReader(bytesReader(jsonOnly(emptyLinks)), { part: 1 });
    const second = await parseExportFromReader(bytesReader(zipSync({ "memories/2024-03-01_00000001-aaaa-bbbb-cccc-000000000001-main.jpg": new Uint8Array(4) })), { part: 2 });
    expect(first.issues.map((i) => i.code)).toContain("memories-list-only");
    const merged = mergeParsedExports([first, second]);
    expect(merged.issues.map((i) => i.code)).not.toContain("memories-list-only");
    expect(merged.issues.map((i) => i.code)).not.toContain("memories-no-media-source");
  });

  it("stays when no part holds files", async () => {
    const first = await parseExportFromReader(bytesReader(jsonOnly(emptyLinks)), { part: 1 });
    const second = await parseExportFromReader(bytesReader(zipSync({ "json/other.json": enc({}) })), { part: 2 });
    const merged = mergeParsedExports([first, second]);
    expect(merged.issues.filter((i) => i.code === "memories-list-only")).toHaveLength(1);
    expect(loud(merged.issues)).toEqual([]);
  });
});
