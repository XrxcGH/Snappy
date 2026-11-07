/**
 * snap_history.json through the front ends: in-memory files, a zip parsed in memory, and a zip read
 * through a reader (which streams the histories). Synthetic data only.
 */
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { bytesReader, parseExportFromReader } from "../../src/export/zip-reader.ts";
import { parseExportFiles, parseExportZip } from "../../src/export/parse.ts";
import { enc } from "./helpers.ts";

const T = Date.UTC(2026, 9, 1, 12, 0, 0);
const FRIENDS = { Friends: [{ Username: "alice", "Creation Timestamp": "2020-01-01 00:00:00 UTC" }] };
const entry = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  From: "alice",
  "Media Type": "IMAGE",
  Created: "2026-10-01 12:00:00 UTC",
  "Created(microseconds)": T * 1000,
  IsSender: false,
  "Conversation Title": null,
  ...over,
});
const CHATS = { alice: [{ From: "alice", "Media Type": "TEXT", Created: "2026-09-01 12:00:00 UTC", IsSender: false, Content: "ZQCANARY-MSG-1" }] };
const SNAPS = { alice: [entry(), entry({ IsSender: true, From: "me", "Media Type": "VIDEO", "Created(microseconds)": (T + 60_000) * 1000 })] };

const zipOf = (files: Record<string, unknown>, level: 0 | 6 = 6): Uint8Array =>
  zipSync(Object.fromEntries(Object.entries(files).map(([name, v]) => [name, [v instanceof Uint8Array ? v : enc(v), { level }]])));

const everyFrontEnd = async (files: Record<string, unknown>) => {
  const zip = zipOf(files);
  return {
    files: parseExportFiles(Object.fromEntries(Object.entries(files).map(([n, v]) => [n, v instanceof Uint8Array ? v : enc(v)]))),
    zip: parseExportZip(zip),
    reader: await parseExportFromReader(bytesReader(zip)),
  };
};

describe("Snaps in a parsed export", () => {
  it("count as events next to the saved chats, whichever way the export is read", async () => {
    const r = await everyFrontEnd({ "json/friends.json": FRIENDS, "json/chat_history.json": CHATS, "json/snap_history.json": SNAPS });
    for (const parsed of Object.values(r)) {
      expect(parsed.chats.map((c) => [c.conversation, c.direction, c.kind])).toEqual([
        ["alice", "received", "TEXT"],
        ["alice", "received", "IMAGE"],
        ["alice", "sent", "VIDEO"],
      ]);
      expect(parsed.issues.filter((i) => i.severity !== "info")).toEqual([]);
      expect(JSON.stringify(parsed)).not.toContain("ZQCANARY");
    }
    expect(r.reader).toEqual(r.zip);
    expect(r.files.chats).toEqual(r.zip.chats);
  });

  it("are all there is when there is no chat history", async () => {
    const r = await everyFrontEnd({ "json/friends.json": FRIENDS, "json/snap_history.json": SNAPS });
    for (const parsed of Object.values(r)) expect(parsed.chats.map((c) => c.kind)).toEqual(["IMAGE", "VIDEO"]);
  });

  it("are simply absent when there is no Snap history: no error, no note at this stage", async () => {
    const r = await everyFrontEnd({ "json/friends.json": FRIENDS, "json/chat_history.json": CHATS });
    for (const parsed of Object.values(r)) {
      expect(parsed.chats.map((c) => c.kind)).toEqual(["TEXT"]);
      expect(parsed.issues.filter((i) => i.severity === "error")).toEqual([]);
    }
  });

  it("are picked by file name, nested or not, and the shallowest copy wins", async () => {
    const stray = { alice: [entry({ "Media Type": "AUDIO" })] };
    const r = await everyFrontEnd({ "json/friends.json": FRIENDS, "mydata_1/json/snap_history.json": SNAPS, "backup/deeper/still/snap_history.json": stray });
    for (const parsed of Object.values(r)) expect(parsed.chats.map((c) => c.kind)).toEqual(["IMAGE", "VIDEO"]);
  });

  it("list their file by its system name", async () => {
    const r = await everyFrontEnd({ "json/friends.json": FRIENDS, "json/snap_history.json": SNAPS });
    expect(r.reader.fileList).toContain("json/snap_history.json");
  });
});

describe("a damaged Snap history", () => {
  const files = (snap: Uint8Array) => ({ "json/friends.json": FRIENDS, "json/chat_history.json": CHATS, "json/snap_history.json": snap });

  it("is reported by its fixed name, all or nothing, and leaves the chats alone (reader and in-memory alike)", async () => {
    const truncated = enc('{"alice":[{"From":"alice","Media Type":"IMAGE","Created(microseconds)":1');
    const r = await everyFrontEnd(files(truncated));
    for (const parsed of Object.values(r)) {
      expect(parsed.chats.map((c) => c.kind)).toEqual(["TEXT"]);
      expect(parsed.issues).toContainEqual({ severity: "error", code: "json-parse-failed", message: "snap_history.json is not valid JSON, so it was not read." });
    }
    expect(r.reader).toEqual(r.zip);
  });

  it("keeps the events it had read out of the result when the file turns out to be broken further on", async () => {
    const broken = enc(`{"alice":[${JSON.stringify(entry())}],"bob":[${JSON.stringify(entry({ From: "bob" }))},]}`);
    const reader = await parseExportFromReader(bytesReader(zipOf(files(broken))));
    expect(reader.chats.map((c) => c.kind)).toEqual(["TEXT"]);
    expect(reader.issues.map((i) => i.code)).toContain("json-parse-failed");
  });

  it("says a file nested too deep is too complex, in the words used for any file", async () => {
    const deep = enc(`{"a":${"[".repeat(70)}${"]".repeat(70)}}`);
    const reader = await parseExportFromReader(bytesReader(zipOf(files(deep))));
    expect(reader.issues).toContainEqual({ severity: "error", code: "json-too-complex", message: "snap_history.json has too many items to read safely, so it was not read." });
    expect(reader.chats.map((c) => c.kind)).toEqual(["TEXT"]);
  });

  it("is reported as undecompressable when the compressed data is damaged", async () => {
    const zip = zipOf({ ...files(enc(JSON.stringify(SNAPS))), "json/snap_history.json": enc(JSON.stringify(SNAPS).repeat(1)) }, 6);
    const at = new TextDecoder("latin1").decode(zip).indexOf("json/snap_history.json") + "json/snap_history.json".length;
    const bad = zip.slice();
    bad.fill(0xff, at, at + 6);
    const reader = await parseExportFromReader(bytesReader(bad));
    expect(reader.issues).toContainEqual({ severity: "error", code: "zip-entry-unreadable", message: "snap_history.json inside the archive could not be decompressed." });
    expect(reader.chats.map((c) => c.kind)).toEqual(["TEXT"]);
  });

  it("never puts a conversation key, a sender or a title into any note", async () => {
    const hostile = enc(`{"ZQCANARY-KEY":[{"From":"ZQCANARY-FROM","Created":"x","IsSender":false,"Conversation Title":"ZQCANARY-TITLE"}],"ZQCANARY-TWO":[`);
    const r = await everyFrontEnd(files(hostile));
    for (const parsed of Object.values(r)) expect(JSON.stringify(parsed.issues)).not.toContain("ZQCANARY");
  });
});
