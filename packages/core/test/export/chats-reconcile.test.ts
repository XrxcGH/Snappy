import { describe, expect, it } from "vitest";
import { parseChatHistoryJson } from "../../src/export/chats.ts";
import { parseExportFiles } from "../../src/export/parse.ts";
import { enc } from "./helpers.ts";

const T = "2024-02-01 10:00:00 UTC";
const friends = new Set(["amy_1", "bob_2"]);
const msg = (over: Record<string, unknown>) => ({ "Media Type": "TEXT", Created: T, ...over });

describe("the friends list settles one-to-one chats", () => {
  it("a chat titled by the display name is one-to-one when its sender is a friend", () => {
    const doc = { amy_1: [msg({ From: "amy_1", IsSender: false, "Conversation Title": "Amy Display" }), msg({ From: "me_user", IsSender: true })] };
    expect(parseChatHistoryJson(doc).chats.every((c) => c.isGroup)).toBe(true); // without the list: a group
    const { chats } = parseChatHistoryJson(doc, friends);
    expect(chats.map((c) => [c.conversation, c.isGroup, c.direction])).toEqual([["amy_1", false, "received"], ["amy_1", false, "sent"]]);
  });

  it("a chat keyed by the display name is filed under the friend's username", () => {
    const doc = { "Amy Display": [msg({ From: "amy_1", IsSender: false }), msg({ From: "me_user", IsSender: true })] };
    expect(parseChatHistoryJson(doc).chats.every((c) => c.isGroup)).toBe(true);
    const { chats } = parseChatHistoryJson(doc, friends);
    expect(chats.map((c) => [c.conversation, c.isGroup])).toEqual([["amy_1", false], ["amy_1", false]]);
  });

  it("a key that is itself a friend username is one-to-one even when only the owner wrote", () => {
    const { chats } = parseChatHistoryJson({ bob_2: [msg({ From: "me_user", IsSender: true, "Conversation Title": "Some Title" })] }, friends);
    expect(chats.map((c) => [c.conversation, c.isGroup])).toEqual([["bob_2", false]]);
  });

  it("two other senders is a group whatever the list says", () => {
    const { chats } = parseChatHistoryJson({ "Weekend Crew": [msg({ From: "amy_1", IsSender: false }), msg({ From: "bob_2", IsSender: false })] }, friends);
    expect(chats.every((c) => c.isGroup && c.conversation.startsWith("group:"))).toBe(true);
  });

  it("a group with one saved sender who is a friend stays a group when groups are the exception", () => {
    const doc: Record<string, unknown[]> = { "Weekend Crew": [msg({ From: "amy_1", IsSender: false })] };
    for (const name of ["bob_2", "cy_3", "dee_4", "eli_5"]) doc[name] = [msg({ From: name, IsSender: false })];
    const { chats } = parseChatHistoryJson(doc, new Set([...friends, "cy_3", "dee_4", "eli_5"]));
    expect(chats.filter((c) => c.isGroup)).toHaveLength(1);
    expect(chats.filter((c) => c.conversation === "amy_1")).toHaveLength(0);
  });

  it("when most conversations look like groups, the lone friend sender decides, and only for those", () => {
    const doc: Record<string, unknown[]> = {
      "Amy Display": [msg({ From: "amy_1", IsSender: false }), msg({ From: "amy_1", IsSender: false })],
      "Bob Display": [msg({ From: "bob_2", IsSender: false })],
      "Stranger Display": [msg({ From: "stranger_9", IsSender: false })],
    };
    const { chats } = parseChatHistoryJson(doc, friends);
    expect(chats.map((c) => [c.conversation.startsWith("group:") ? "group" : c.conversation, c.isGroup])).toEqual([["amy_1", false], ["amy_1", false], ["bob_2", false], ["group", true]]);
  });

  it("a sole sender who is not a friend stays a group", () => {
    const { chats } = parseChatHistoryJson({ "Weekend Crew": [msg({ From: "stranger_9", IsSender: false })] }, friends);
    expect(chats.every((c) => c.isGroup)).toBe(true);
  });

  it("a group's title never reaches the events", () => {
    const { chats } = parseChatHistoryJson({ "Weekend Crew": [msg({ From: "stranger_9", IsSender: false })] }, friends);
    expect(JSON.stringify(chats)).not.toContain("Weekend");
  });

  it("what is settled by the list is not counted as a group in the notes", () => {
    const doc: Record<string, unknown[]> = {};
    for (let i = 0; i < 12; i++) doc[`Person ${i}`] = [msg({ From: `pal_${i}`, IsSender: false })];
    const known = new Set(Array.from({ length: 12 }, (_, i) => `pal_${i}`));
    expect(parseChatHistoryJson(doc).issues.map((i) => i.code)).toContain("chats-mostly-groups");
    expect(parseChatHistoryJson(doc, known).issues.map((i) => i.code)).not.toContain("chats-mostly-groups");
  });
});

describe("the same through a whole export", () => {
  it("parseExportFiles gives the chat parser the usernames of friends.json (all its lists)", () => {
    const parsed = parseExportFiles({
      "json/friends.json": enc({ Friends: [{ Username: "amy_1" }], "Deleted Friends": [{ Username: "bob_2" }] }),
      "json/chat_history.json": enc({
        "Amy Display": [msg({ From: "amy_1", IsSender: false })],
        "Bob Display": [msg({ From: "bob_2", IsSender: false })],
        "Stranger Display": [msg({ From: "stranger_9", IsSender: false })],
      }),
    });
    expect(parsed.chats.map((c) => c.isGroup)).toEqual([false, false, true]);
    expect(parsed.chats.slice(0, 2).map((c) => c.conversation)).toEqual(["amy_1", "bob_2"]);
  });

  it("an export without a friends file keeps the layout rules", () => {
    const parsed = parseExportFiles({ "json/chat_history.json": enc({ "Amy Display": [msg({ From: "amy_1", IsSender: false })] }) });
    expect(parsed.chats.every((c) => c.isGroup)).toBe(true);
  });
});
