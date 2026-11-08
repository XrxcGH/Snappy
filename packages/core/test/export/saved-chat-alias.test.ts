import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { describeStructureFromReader, formatStructureReport } from "../../src/export/inspect.ts";
import { parseExportFiles, validateExport } from "../../src/export/parse.ts";
import { bytesReader, parseExportFromReader } from "../../src/export/zip-reader.ts";
import { enc } from "./helpers.ts";

const T = "2024-02-01 10:00:00 UTC";
const entry = (from: string, sent = false) => ({ From: from, "Media Type": "TEXT", Created: T, IsSender: sent });
const saved = { amy_1: [entry("amy_1"), entry("me_user", true)] };
const usual = { bob_2: [entry("bob_2")] };
const friends = { Friends: [{ Username: "amy_1" }, { Username: "bob_2" }] };

const conversations = (chats: { conversation: string }[]): string[] => [...new Set(chats.map((c) => c.conversation))];

describe("saved_chat_history.json", () => {
  it("is read as the chat history when it is the only one", () => {
    const parsed = parseExportFiles({ "json/friends.json": enc(friends), "json/saved_chat_history.json": enc(saved) });
    expect(conversations(parsed.chats)).toEqual(["amy_1"]);
    expect(parsed.chats).toHaveLength(2);
  });

  it("is read through a reader too", async () => {
    const zip = zipSync({ "json/friends.json": enc(friends), "json/saved_chat_history.json": enc(saved) });
    const parsed = await parseExportFromReader(bytesReader(zip));
    expect(conversations(parsed.chats)).toEqual(["amy_1"]);
  });

  it("gives way to chat_history.json when both are there, whatever sorts first", () => {
    const parsed = parseExportFiles({ "json/chat_history.json": enc(usual), "json/saved_chat_history.json": enc(saved) });
    expect(conversations(parsed.chats)).toEqual(["bob_2"]);
    const swapped = parseExportFiles({ "a/chat_history.json": enc(usual), "json/saved_chat_history.json": enc(saved) });
    expect(conversations(swapped.chats)).toEqual(["bob_2"]); // the usual name wins even where the alias sits under json/
  });

  it("does not say the chat history is missing, even when it holds no readable chats", () => {
    const parsed = parseExportFiles({ "json/friends.json": enc(friends), "json/saved_chat_history.json": enc({}) });
    expect(validateExport(parsed).map((i) => i.code)).not.toContain("chat-history-missing");
  });

  it("is listed by its name, not masked", () => {
    const parsed = parseExportFiles({ "json/friends.json": enc(friends), "json/saved_chat_history.json": enc(saved) });
    expect(parsed.fileList).toContain("json/saved_chat_history.json");
  });

  it("is described by inspect like the chat history: conversation names are not judged", async () => {
    const zip = zipSync({ "json/saved_chat_history.json": enc({ support: [entry("x")] }) });
    const text = formatStructureReport(await describeStructureFromReader([bytesReader(zip)]));
    expect(text).not.toContain("not described");
    expect(text).toContain("IsSender: boolean");
  });
});
