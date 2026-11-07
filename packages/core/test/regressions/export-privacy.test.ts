/**
 * Regression tests for privacy defects in the export layer: group titles filed as usernames,
 * raw container keys retained in a module-global cache, showKeys printing handles and titles.
 */
import { describe, expect, it } from "vitest";
import { buildCleanupQueue, findDormant, parseChatHistoryJson } from "../../src/index.ts";
import { describeStructure, formatStructureReport } from "../../src/export/inspect.ts";
import { keyCacheSize, normKey } from "../../src/export/json-util.ts";
import { enc } from "../export/helpers.ts";

const msg = (extra: Record<string, unknown> = {}) => ({
  From: "me",
  "Media Type": "TEXT",
  Created: "2023-04-01 12:30:00 UTC",
  IsSender: true,
  ...extra,
});

describe("group title with no non-owner sender and no title signal", () => {
  it("is hashed, never stored as a username", () => {
    const { chats } = parseChatHistoryJson({ "Weekend Crew Lisbon": [msg({ "Conversation Title": null })] });
    expect(chats).toHaveLength(1);
    expect(chats[0]!.isGroup).toBe(true);
    expect(chats[0]!.conversation).toMatch(/^group:[0-9a-f]{8}$/);
    expect(JSON.stringify(chats).toLowerCase()).not.toContain("lisbon");
  });

  it("does not reach the detectors as a username", () => {
    const { chats } = parseChatHistoryJson({ "Weekend Crew Lisbon": [msg()] });
    const parsed = {
      friends: { friends: [], sentRequests: [], pendingRequests: [], deletedFriends: [], blocked: [], ignored: [], hiddenSuggestions: [] },
      chats,
      memories: [],
      fileList: [],
      issues: [],
    };
    const now = Date.UTC(2025, 0, 1);
    const text = JSON.stringify([findDormant(parsed, { now }), buildCleanupQueue([], chats, { now })]).toLowerCase();
    expect(text).not.toContain("lisbon");
  });

  it("also hashes a title that equals the key, which suppresses the title signal", () => {
    const { chats } = parseChatHistoryJson({ "Book Club 2023 Planning": [msg({ "Conversation Title": "Book Club 2023 Planning" })] });
    expect(chats[0]!.conversation).toMatch(/^group:/);
  });

  it("still files an owner-only chat under a username-shaped key as 1:1", () => {
    const { chats } = parseChatHistoryJson({ alice_smith: [msg()] });
    expect(chats[0]).toMatchObject({ conversation: "alice_smith", isGroup: false, direction: "sent" });
  });

  it("keeps a 1:1 proven by the sender's own name, whatever the key looks like", () => {
    const { chats } = parseChatHistoryJson({ "Some Long Display Key": [msg({ From: "Some Long Display Key", IsSender: false })] });
    expect(chats[0]).toMatchObject({ isGroup: false });
  });
});

describe("normKey memoisation", () => {
  it("never retains caller-supplied container keys", () => {
    // Warm up so the fixed field-name aliases are cached; they are the only thing that may be.
    parseChatHistoryJson({ warm: [msg()] });
    const before = keyCacheSize();
    const secret = `Private Group Title ${Math.random()}`;
    parseChatHistoryJson({ [secret]: [msg({ "Conversation Title": "Another Secret Title" })], "some_user_name": [msg()] });
    normKey(secret);
    expect(keyCacheSize()).toBe(before);
  });

  it("still memoises the allowlisted field names", () => {
    parseChatHistoryJson({ warm: [msg()] });
    expect(keyCacheSize()).toBeGreaterThan(0);
    expect(normKey("Media Type")).toBe("mediatype");
    expect(normKey("Created(microseconds)")).toBe("createdmicroseconds");
  });
});

describe("a flat-section name is matched exactly", () => {
  it("does not mistake usernames that contain 'savedchat' or 'chathistory' for the flat section", () => {
    for (const user of ["savedchat_fan", "chathistorybot"]) {
      const { chats } = parseChatHistoryJson({
        [user]: [
          { From: user, "Media Type": "TEXT", Created: "2023-04-01 12:30:00 UTC", IsSender: false },
          msg({ Created: "2023-04-01 12:31:00 UTC" }),
        ],
      });
      expect(chats.map((c) => c.direction).sort(), user).toEqual(["received", "sent"]);
      expect(chats.every((c) => c.conversation === user.toLowerCase()), user).toBe(true);
    }
  });

  it("still treats the real section names as flat lists", () => {
    for (const name of ["Saved Chat History", "Received Saved Chat History", "Sent Saved Chat History", "chat_history"]) {
      const { chats, issues } = parseChatHistoryJson({
        [name]: [{ From: "dana", "Media Type": "TEXT", Created: "2023-04-01 12:30:00 UTC", IsSender: false }, msg()],
      });
      expect(chats, name).toHaveLength(1);
      expect(chats[0]!.conversation, name).toBe("dana");
      expect(issues.map((i) => i.code), name).toContain("chat-conversation-unknown");
    }
  });
});

describe("inspect showKeys", () => {
  const convo = [{ From: "x", "Media Type": "TEXT", Created: "2023-04-01 12:30:00 UTC", IsSender: true }];
  const files = { "json/chat_history.json": enc({ alice_smith: convo, bob99: convo, "Weekend Crew Lisbon": convo }) };

  it("does not print usernames or group titles that key a list of conversations", () => {
    const text = formatStructureReport(describeStructure(files, { showKeys: true })).toLowerCase();
    for (const secret of ["alice_smith", "bob99", "weekend", "lisbon"]) expect(text).not.toContain(secret);
    // The record field names underneath are the part that helps fix a parser, and they stay.
    expect(text).toContain("media type");
  });

  it("rejects digit-bearing keys and tells the reader to review the output", () => {
    const text = formatStructureReport(describeStructure({ "json/friends.json": enc({ user42: 1, Notes: 2 }) }, { showKeys: true }));
    expect(text).not.toContain("user42");
    expect(text).toContain("Notes");
    expect(text).toContain("Review before sharing");
  });

  it("does not make the review warning part of the default report", () => {
    expect(formatStructureReport(describeStructure(files))).not.toContain("Review before sharing");
  });
});
