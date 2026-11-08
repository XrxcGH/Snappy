import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { parseExportFiles, parseExportZip } from "../../src/export/parse.ts";
import { bytesReader, parseExportFromReader } from "../../src/export/zip-reader.ts";
import { enc } from "./helpers.ts";

const T = "2024-02-01 10:00:00 UTC";
const entry = (from: string) => ({ From: from, "Media Type": "TEXT", Created: T, IsSender: false });
const real = { amy_1: [entry("amy_1")], bob_2: [entry("bob_2")] };
const stray = { stray_9: [entry("stray_9")] };

describe("which copy of a data file is read", () => {
  const files = {
    "json/chat_history.json": enc(real),
    "chat_media/chat_history.json": enc(stray),
    "json/friends.json": enc({ Friends: [{ Username: "amy_1" }] }),
  };
  const conversations = (chats: { conversation: string }[]): string[] => [...new Set(chats.map((c) => c.conversation))].sort();

  it("prefers the one under json/ over a stray copy that sorts first", () => {
    expect(conversations(parseExportFiles(files).chats)).toEqual(["amy_1", "bob_2"]);
  });

  it("the same through a zip held in memory", () => {
    expect(conversations(parseExportZip(zipSync(files)).chats)).toEqual(["amy_1", "bob_2"]);
  });

  it("the same through a reader", async () => {
    const parsed = await parseExportFromReader(bytesReader(zipSync(files)));
    expect(conversations(parsed.chats)).toEqual(["amy_1", "bob_2"]);
  });

  it("a deeper json/ folder still wins over a shallower stray one", () => {
    const parsed = parseExportFiles({
      "mydata_1700000000000/json/chat_history.json": enc(real),
      "chat_history.json": enc(stray),
    });
    expect(conversations(parsed.chats)).toEqual(["amy_1", "bob_2"]);
  });

  it("without a json/ folder the shallowest wins, then the alphabetically first", () => {
    expect(conversations(parseExportFiles({ "a/b/chat_history.json": enc(stray), "chat_history.json": enc(real) }).chats)).toEqual(["amy_1", "bob_2"]);
    expect(conversations(parseExportFiles({ "z/chat_history.json": enc(stray), "a/chat_history.json": enc(real) }).chats)).toEqual(["amy_1", "bob_2"]);
  });

  it("the folder name is matched whole and in any case", () => {
    expect(conversations(parseExportFiles({ "JSON/chat_history.json": enc(real), "jsonish/chat_history.json": enc(stray) }).chats)).toEqual(["amy_1", "bob_2"]);
  });
});
