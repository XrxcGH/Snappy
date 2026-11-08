import { describe, expect, it } from "vitest";
import { parseChatHistoryJson, parseSnapHistoryJson } from "../../src/export/chats.ts";

const T = "2024-02-01 10:00:00 UTC";

/** `n` conversations; the first `groups` of them carry a title that differs from the key (a group). */
function conversations(n: number, groups: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (let i = 0; i < n; i++) {
    out[`friend_${i}`] = [
      { From: `friend_${i}`, "Media Type": "TEXT", Created: T, IsSender: false, "Conversation Title": i < groups ? `Some Group ${i}` : null },
    ];
  }
  return out;
}

const issuesOf = (obj: unknown, parse = parseChatHistoryJson) => parse(obj).issues;
const byCode = (obj: unknown, code: string, parse = parseChatHistoryJson) => issuesOf(obj, parse).find((i) => i.code === code);

describe("mostly group chats is a warning", () => {
  it("when more than half of the conversations look like groups", () => {
    const hit = byCode(conversations(12, 7), "chats-mostly-groups");
    expect(hit?.severity).toBe("warning");
    expect(hit?.message).toBe("Snappy treated 7 of 12 conversations in chat_history.json as group chats. The layout may differ, so results may be wrong.");
  });

  it("all groups gives the warning, not only the quiet note", () => {
    const codes = issuesOf(conversations(40, 40)).map((i) => i.code);
    expect(codes).toContain("chats-mostly-groups");
    expect(codes).not.toContain("chat-all-groups");
  });

  it("names the Snap history for snaps", () => {
    expect(byCode(conversations(12, 12), "chats-mostly-groups", parseSnapHistoryJson)?.message).toContain("snap_history.json");
  });

  it("exactly half, or fewer, stays quiet", () => {
    expect(byCode(conversations(12, 6), "chats-mostly-groups")).toBeUndefined();
    expect(byCode(conversations(12, 2), "chats-mostly-groups")).toBeUndefined();
  });

  it("a handful of conversations keeps the quiet note", () => {
    const issues = issuesOf(conversations(3, 3));
    expect(issues.map((i) => i.code)).toContain("chat-all-groups");
    expect(issues.find((i) => i.code === "chat-all-groups")?.severity).toBe("info");
    expect(issues.map((i) => i.code)).not.toContain("chats-mostly-groups");
  });

  it("never repeats a title or a key", () => {
    expect(JSON.stringify(issuesOf(conversations(12, 12)))).not.toMatch(/Some Group|friend_/);
  });
});

/** A flat list: `matched` entries that name their chat (a received sender) and `lost` that cannot. */
function flat(matched: number, lost: number): unknown[] {
  return [
    ...Array.from({ length: matched }, (_, i) => ({ From: `friend_${i}`, "Media Type": "TEXT", Created: T, IsSender: false })),
    ...Array.from({ length: lost }, () => ({ From: "me_user", "Media Type": "TEXT", Created: T, IsSender: true })),
  ];
}

describe("messages that could not be matched is a warning when there are many", () => {
  it("above a fifth of the messages", () => {
    const hit = byCode(flat(40, 20), "chats-unmatched-many");
    expect(hit?.severity).toBe("warning");
    expect(hit?.message).toBe("20 of 60 messages in chat_history.json were skipped because no conversation matched them. Some results may be wrong.");
    expect(issuesOf(flat(40, 20)).map((i) => i.code)).not.toContain("chat-conversation-unknown");
  });

  it("a fifth or less keeps the note", () => {
    const issues = issuesOf(flat(40, 10));
    expect(issues.find((i) => i.code === "chat-conversation-unknown")?.severity).toBe("info");
    expect(issues.map((i) => i.code)).not.toContain("chats-unmatched-many");
  });

  it("a few messages keep the note even when they are all of them", () => {
    const issues = issuesOf(flat(0, 4));
    expect(issues.map((i) => i.code)).toContain("chat-conversation-unknown");
    expect(issues.map((i) => i.code)).not.toContain("chats-unmatched-many");
  });

  it("names the Snap history and says Snaps", () => {
    expect(byCode(flat(5, 30), "chats-unmatched-many", parseSnapHistoryJson)?.message).toBe(
      "30 of 35 Snaps in snap_history.json were skipped because no conversation matched them. Some results may be wrong.",
    );
  });
});
