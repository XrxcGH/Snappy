import { describe, expect, it } from "vitest";
import { isJsonDataEntry, readZipDirectory } from "../../src/export/zip.ts";
import { parseExportZip } from "../../src/export/parse.ts";
import { bytesReader, listZipEntries, parseExportFromReader } from "../../src/export/zip-reader.ts";
import { buildFixtureZip } from "./zip-fixture.ts";
import type { FixtureEntry } from "./zip-fixture.ts";
import { enc } from "./helpers.ts";

const JSON_TIME = Date.UTC(2024, 5, 1, 12, 0, 0);
const REPACKED = Date.UTC(2026, 2, 9, 8, 30, 0); // a zipper that stamped the media "now"
const friends = enc({ Friends: [{ Username: "amy_1" }] });

const zipWith = (entries: FixtureEntry[]): Uint8Array => buildFixtureZip(entries);
const dated = (name: string, utcMs: number, data: Uint8Array = new Uint8Array(4)): FixtureEntry => ({ name, utcMs, data });

describe("the date of an export", () => {
  const repacked = zipWith([
    dated("json/friends.json", JSON_TIME, friends),
    dated("memories/2023-01-01_a-main.jpg", REPACKED),
    dated("chat_media/b.mp4", REPACKED + 1000),
    dated("html/index.html", REPACKED + 2000),
  ]);

  it("comes from the data files under json/, not from media stamped later", async () => {
    expect((await listZipEntries(bytesReader(repacked))).newestMtime).toBe(JSON_TIME);
    expect(readZipDirectory(repacked, 1000)?.newestMtime).toBe(JSON_TIME);
  });

  it("is what the parse reports as exportedAt, in memory and through a reader", async () => {
    expect(parseExportZip(repacked).exportedAt).toBe(JSON_TIME);
    expect((await parseExportFromReader(bytesReader(repacked))).exportedAt).toBe(JSON_TIME);
  });

  it("is the newest of several data files", async () => {
    const zip = zipWith([dated("json/a.json", JSON_TIME), dated("json/b.json", JSON_TIME + 5000), dated("memories/x.jpg", REPACKED)]);
    expect((await listZipEntries(bytesReader(zip))).newestMtime).toBe(JSON_TIME + 5000);
    expect(readZipDirectory(zip, 1000)?.newestMtime).toBe(JSON_TIME + 5000);
  });

  it("falls back to the newest entry of any kind when there is no data file", async () => {
    const zip = zipWith([dated("memories/x.jpg", JSON_TIME), dated("html/index.html", REPACKED)]);
    expect((await listZipEntries(bytesReader(zip))).newestMtime).toBe(REPACKED);
    expect(readZipDirectory(zip, 1000)?.newestMtime).toBe(REPACKED);
  });

  it("ignores a .json file outside a json/ folder when a data file has a time", async () => {
    const zip = zipWith([dated("json/friends.json", JSON_TIME, friends), dated("other/notes.json", REPACKED)]);
    expect((await listZipEntries(bytesReader(zip))).newestMtime).toBe(JSON_TIME);
  });

  it("a data file with no stored time leaves the other entries to date it", async () => {
    const zip = zipWith([{ name: "json/friends.json", data: friends, dosMs: Date.UTC(2020, 0, 1) }, dated("memories/x.jpg", REPACKED)]);
    // The DOS time of the data file counts as its time: it is the earlier one, so the json date wins.
    expect((await listZipEntries(bytesReader(zip))).newestMtime).toBe(Date.UTC(2020, 0, 1));
  });
});

describe("isJsonDataEntry", () => {
  it("is a .json file under a folder named json, in any case, with either slash", () => {
    for (const name of ["json/friends.json", "JSON/Friends.JSON", "mydata_123/json/chat_history.json", "a\\json\\b.json"]) expect(isJsonDataEntry(name), name).toBe(true);
    for (const name of ["friends.json", "json.json", "jsonx/friends.json", "json/index.html", "memories/a.jpg", "json/"]) expect(isJsonDataEntry(name), name).toBe(false);
  });
});
