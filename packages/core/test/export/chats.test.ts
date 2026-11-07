import { describe, expect, it } from "vitest";
import { parseChatHistoryJson } from "../../src/export/parse.ts";
import { hashString } from "../../src/util.ts";
import { allMessages } from "./helpers.ts";

const T = "2023-04-01 12:30:00 UTC";
const T_MS = Date.UTC(2023, 3, 1, 12, 30);

describe("parseChatHistoryJson", () => {
  it("reduces a 1:1 chat to {conversation, isGroup, direction, kind, at}", () => {
    const { chats, issues } = parseChatHistoryJson({
      Alice_01: [
        { From: "alice_01", "Media Type": "TEXT", Created: T, Content: "hello canary", IsSender: false, "Conversation Title": null },
        { From: "me", "Media Type": "MEDIA", Created: T, Content: null, IsSender: true, "Conversation Title": null },
      ],
    });
    expect(chats).toEqual([
      { conversation: "alice_01", isGroup: false, direction: "received", kind: "TEXT", at: T_MS },
      { conversation: "alice_01", isGroup: false, direction: "sent", kind: "MEDIA", at: T_MS },
    ]);
    expect(Object.keys(chats[0]!).sort()).toEqual(["at", "conversation", "direction", "isGroup", "kind"]);
    expect(issues).toEqual([]);
  });

  it("prefers the microsecond field and accepts numeric strings", () => {
    const { chats } = parseChatHistoryJson({
      bob: [
        { From: "bob", "Media Type": "TEXT", Created: "2000-01-01 00:00:00 UTC", "Created(microseconds)": "1680352200000000", IsSender: "false" },
        { From: "bob", "Media Type": "TEXT", Created: "1680352300", IsSender: 0 },
      ],
    });
    expect(chats.map((c) => c.at)).toEqual([1680352200000, 1680352300000]);
    expect(chats.map((c) => c.direction)).toEqual(["received", "received"]);
  });

  it("tolerates mixed-case keys", () => {
    const { chats } = parseChatHistoryJson({
      Bob: [{ FROM: "bob", "media type": "note", created: T, issender: true }],
    });
    expect(chats).toEqual([{ conversation: "bob", isGroup: false, direction: "sent", kind: "NOTE", at: T_MS }]);
  });

  it("files a group (distinct Conversation Title) under a hash and never keeps the title", () => {
    const { chats } = parseChatHistoryJson({
      "Weekend Squad Canary": [
        { From: "carol", "Media Type": "TEXT", Created: T, IsSender: false, "Conversation Title": "Weekend Squad Canary" },
        { From: "dave", "Media Type": "TEXT", Created: T, IsSender: false, "Conversation Title": "Weekend Squad Canary" },
        { From: "me", "Media Type": "TEXT", Created: T, IsSender: true, "Conversation Title": "Weekend Squad Canary" },
      ],
    });
    const id = `group:${hashString("Weekend Squad Canary")}`;
    expect(chats.every((c) => c.conversation === id && c.isGroup)).toBe(true);
    expect(JSON.stringify(chats)).not.toContain("Squad");
  });

  it("detects a group from two distinct non-owner senders, even without titles", () => {
    const { chats } = parseChatHistoryJson({
      teamchat: [
        { From: "carol", "Media Type": "TEXT", Created: T, IsSender: false },
        { From: "dave", "Media Type": "TEXT", Created: T, IsSender: false },
      ],
    });
    expect(chats.every((c) => c.isGroup && c.conversation === `group:${hashString("teamchat")}`)).toBe(true);
  });

  it("detects a group when the only other sender is not the conversation key", () => {
    const { chats } = parseChatHistoryJson({
      "some title": [{ From: "carol", "Media Type": "TEXT", Created: T, IsSender: false }],
    });
    expect(chats[0]?.isGroup).toBe(true);
  });

  it("does not let ownership-unknown messages make a 1:1 chat look like a group", () => {
    const { chats, issues } = parseChatHistoryJson({
      alice: [
        { From: "alice", "Media Type": "TEXT", Created: T, IsSender: false },
        { From: "someone-else", "Media Type": "TEXT", Created: T },
      ],
    });
    // The message without IsSender is kept: it proves activity with alice, only its direction is unknown.
    expect(chats.map((c) => c.direction)).toEqual(["received", "unknown"]);
    expect(chats.every((c) => !c.isGroup && c.conversation === "alice")).toBe(true);
    const note = issues.find((i) => i.code === "chat-direction-unknown");
    expect(note?.severity).toBe("info");
    expect(note?.message).toBe("1 message has no IsSender flag, so whether it was sent or received is unknown; it still counts as activity.");
  });

  it("keeps a flat-list entry of a titled group when direction is unknown, and drops one that cannot name its chat", () => {
    const { chats, issues } = parseChatHistoryJson([
      { From: "x", "Media Type": "TEXT", Created: T, "Conversation Title": "weekend crew" },
      { From: "alice", "Media Type": "TEXT", Created: T },
    ]);
    expect(chats).toHaveLength(1);
    expect(chats[0]).toMatchObject({ isGroup: true, direction: "unknown" });
    expect(issues.map((i) => i.code)).toContain("chat-conversation-unknown");
  });

  it("drops messages with unreadable timestamps and counts them", () => {
    const { chats, issues } = parseChatHistoryJson({
      alice: [
        { From: "alice", "Media Type": "TEXT", Created: "not a date", IsSender: false },
        { From: "alice", "Media Type": "TEXT", IsSender: false },
        { From: "alice", "Media Type": "TEXT", Created: T, IsSender: false },
        "garbage",
        null,
      ],
    });
    expect(chats).toHaveLength(1);
    expect(issues.map((i) => i.code).sort()).toEqual(["chat-bad-timestamp", "chat-invalid-entries"]);
  });

  it("only trusts category-looking media types and never derives kind from content", () => {
    const { chats } = parseChatHistoryJson({
      alice: [
        { From: "alice", "Media Type": "this is secret message text, really", Created: T, IsSender: false, Content: "hi" },
        { From: "alice", Created: T, IsSender: false, Content: "hi" },
        { From: "alice", "Media Type": "Share Saved Story", Created: T, IsSender: false },
      ],
    });
    expect(chats.map((c) => c.kind)).toEqual(["UNKNOWN", "UNKNOWN", "SHARE_SAVED_STORY"]);
  });

  it("handles flat 'Saved Chat History' lists: received -> sender, titled -> group hash, else skipped", () => {
    const { chats, issues } = parseChatHistoryJson({
      "Saved Chat History": [
        { From: "erin", "Media Type": "TEXT", Created: T, IsSender: false, "Conversation Title": null },
        { From: "me", "Media Type": "TEXT", Created: T, IsSender: true, "Conversation Title": "Flat Group Canary" },
        { From: "me", "Media Type": "TEXT", Created: T, IsSender: true },
      ],
    });
    expect(chats).toEqual([
      { conversation: "erin", isGroup: false, direction: "received", kind: "TEXT", at: T_MS },
      { conversation: `group:${hashString("Flat Group Canary")}`, isGroup: true, direction: "sent", kind: "TEXT", at: T_MS },
    ]);
    expect(issues.map((i) => i.code)).toContain("chat-conversation-unknown");
    expect(JSON.stringify(chats)).not.toContain("Canary");
  });

  it("accepts a bare array with a warning", () => {
    const { chats, issues } = parseChatHistoryJson([{ From: "erin", "Media Type": "TEXT", Created: T, IsSender: false }]);
    expect(chats).toHaveLength(1);
    expect(issues[0]?.code).toBe("chat-top-level-array");
  });

  it("keeps file order and counts non-list values", () => {
    const { chats, issues } = parseChatHistoryJson({
      zed: [{ From: "zed", "Media Type": "TEXT", Created: "2023-02-01 00:00:00 UTC", IsSender: false }],
      amy: [{ From: "amy", "Media Type": "TEXT", Created: "2023-01-01 00:00:00 UTC", IsSender: false }],
      "Some Metadata": { a: 1 },
      Another: "x",
    });
    expect(chats.map((c) => c.conversation)).toEqual(["zed", "amy"]);
    expect(issues.find((i) => i.code === "chat-non-list-values")?.message).toContain("2 top-level");
  });

  it("notes when every conversation was treated as a group", () => {
    const { issues } = parseChatHistoryJson({
      x: [{ From: "y", "Media Type": "TEXT", Created: T, IsSender: false }],
    });
    expect(issues.map((i) => i.code)).toContain("chat-all-groups");
  });

  it.each([null, undefined, 3, "str", true])("never throws on %s", (bad) => {
    const { chats, issues } = parseChatHistoryJson(bad);
    expect(chats).toEqual([]);
    expect(issues[0]?.code).toBe("chat-unexpected-shape");
  });

  it("keeps unicode usernames and never echoes them in issues", () => {
    const { chats, issues } = parseChatHistoryJson({
      "Zoë_名前": [
        { From: "zoë_名前", "Media Type": "TEXT", Created: "bad", IsSender: false },
        { From: "zoë_名前", "Media Type": "TEXT", Created: T, IsSender: false },
      ],
    });
    expect(chats[0]?.conversation).toBe("zoë_名前");
    expect(allMessages(issues)).not.toContain("zoë");
  });

  it("handles 150k events without blowing up", () => {
    const list = (from: string, n: number) =>
      Array.from({ length: n }, (_, i) => ({
        From: i % 2 ? "me" : from,
        "Media Type": "TEXT",
        Created: "2023-04-01 12:30:00 UTC",
        "Created(microseconds)": 1680352200000000 + i,
        IsSender: i % 2 === 1,
        Content: "x",
      }));
    const obj: Record<string, unknown> = {};
    for (let c = 0; c < 1500; c++) obj[`friend${c}`] = list(`friend${c}`, 100);
    const t0 = performance.now();
    const { chats } = parseChatHistoryJson(obj);
    expect(chats).toHaveLength(150_000);
    expect(performance.now() - t0).toBeLessThan(5000);
  });
});
