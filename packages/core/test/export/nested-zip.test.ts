import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { failureClass, parseExportZip, validateExport } from "../../src/export/parse.ts";
import { bytesReader, parseExportFromReader } from "../../src/export/zip-reader.ts";
import { enc } from "./helpers.ts";

const FRIENDS = { Friends: [{ Username: "amy" }] };
const inner = (): Uint8Array => zipSync({ "json/friends.json": enc(FRIENDS) });
const MESSAGE = "This ZIP holds other ZIP files. Unzip it once and choose the parts inside.";

/** What a drive or mail app hands over: the parts, stored in one more ZIP file. */
const outer = (extra: Record<string, Uint8Array> = {}): Uint8Array =>
  zipSync({ "mydata~1700000000000.zip": [inner(), { level: 0 }], "mydata~1700000000000-2.zip": [inner(), { level: 0 }], ...extra });

describe("a ZIP inside a ZIP", () => {
  it("is named as such when the files are read through a reader", async () => {
    const parsed = await parseExportFromReader(bytesReader(outer()));
    expect(parsed.issues.filter((i) => i.code === "nested-zip")).toEqual([{ severity: "error", code: "nested-zip", message: MESSAGE }]);
  });

  it("is named as such when the whole zip is in memory", () => {
    expect(parseExportZip(outer()).issues.map((i) => i.code)).toContain("nested-zip");
  });

  it("is the only notice: no friends-list or not-found notes follow", async () => {
    const parsed = await parseExportFromReader(bytesReader(outer()));
    expect(validateExport(parsed)).toEqual([]);
    expect(failureClass(parsed.issues)).toBe("nested-zip");
  });

  it("also when the inner zips sit in a folder next to other files", async () => {
    const parsed = await parseExportFromReader(bytesReader(zipSync({ "Download/part1.ZIP": [inner(), { level: 0 }], "Download/readme.txt": enc("hello") })));
    expect(parsed.issues.map((i) => i.code)).toContain("nested-zip");
  });

  it("is not claimed when the data files are there too", async () => {
    const parsed = await parseExportFromReader(bytesReader(outer({ "json/friends.json": enc(FRIENDS) })));
    expect(parsed.issues.map((i) => i.code)).not.toContain("nested-zip");
    expect(parsed.friends.friends).toHaveLength(1);
  });

  it("is not claimed for an export with no ZIP entries", async () => {
    const parsed = await parseExportFromReader(bytesReader(zipSync({ "html/index.html": enc("<html></html>") })));
    expect(parsed.issues.map((i) => i.code)).not.toContain("nested-zip");
  });
});
