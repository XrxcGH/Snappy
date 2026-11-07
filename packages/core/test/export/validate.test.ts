import { describe, expect, it } from "vitest";
import { parseExportFiles, validateExport } from "../../src/export/parse.ts";
import { emptyFriends } from "../../src/export/friends.ts";
import type { ParsedExport } from "../../src/types.ts";
import { DAY_MS } from "../../src/util.ts";
import { allMessages, enc } from "./helpers.ts";

const NOW = Date.UTC(2024, 5, 1);

type Over = Partial<Omit<ParsedExport, "friends">> & { friends?: Partial<ParsedExport["friends"]> };

function mk(over: Over = {}): ParsedExport {
  return {
    chats: [],
    memories: [],
    fileList: ["friends.json", "chat_history.json", "snap_history.json", "memories_history.json"],
    issues: [],
    ...over,
    friends: { ...emptyFriends(), ...over.friends },
  };
}

const people = (n: number, createdAt?: number) =>
  Array.from({ length: n }, (_, i) => ({ username: `u${i}`, ...(createdAt === undefined ? {} : { createdAt }) }));
const codes = (p: ParsedExport, hints = {}) => validateExport(p, hints).map((i) => i.code);

describe("validateExport", () => {
  it("is quiet for a healthy export", () => {
    expect(validateExport(mk({ friends: { friends: people(10, NOW - 400 * DAY_MS) }, exportedAt: NOW }), {})).toEqual([]);
  });

  it("errors when there is no friends data at all", () => {
    const out = validateExport(mk());
    expect(out.find((i) => i.code === "no-friends-section")?.severity).toBe("error");
  });

  it("flags friends-empty-but-deleted as an error", () => {
    const out = validateExport(mk({ friends: { deletedFriends: [{ username: "a" }, { username: "b" }] } }));
    const hit = out.find((i) => i.code === "friends-empty-but-deleted");
    expect(hit?.severity).toBe("error");
    expect(hit?.message).toContain("2 deleted");
    expect(out.map((i) => i.code)).not.toContain("no-friends-section");
  });

  it("flags an HTML-only export", () => {
    const parsed = parseExportFiles({ "html/friends.html": enc("<html></html>"), "index.html": enc("<html></html>") });
    const out = validateExport(parsed);
    expect(out.find((i) => i.code === "html-only-export")).toMatchObject({ severity: "error" });
    expect(out.find((i) => i.code === "html-only-export")?.message).toMatch(/JSON/);
  });

  it("does not call a mixed JSON+HTML export HTML-only", () => {
    const parsed = parseExportFiles({ "friends.json": enc({ Friends: [{ Username: "a" }] }), "index.html": enc("<html></html>") });
    expect(validateExport(parsed).map((i) => i.code)).not.toContain("html-only-export");
  });

  it("warns on duplicate usernames within friends or sent requests", () => {
    const out = validateExport(mk({ friends: { friends: [{ username: "a" }, { username: "a" }, { username: "b" }], sentRequests: [{ username: "x" }, { username: "x" }] } }));
    const hit = out.find((i) => i.code === "duplicate-usernames");
    expect(hit?.severity).toBe("warning");
    expect(hit?.message).toContain("2 duplicate");
    expect(allMessages(out)).not.toMatch(/\b[ax]\b.*duplicate/);
  });

  it("warns on future timestamps relative to exportedAt, with slack", () => {
    const base = { friends: { friends: people(5) }, exportedAt: NOW };
    const slack = mk({ ...base, chats: [{ conversation: "a", isGroup: false, direction: "sent", kind: "TEXT", at: NOW + DAY_MS }] });
    expect(codes(slack)).not.toContain("future-timestamps");
    const future = mk({
      ...base,
      chats: [{ conversation: "a", isGroup: false, direction: "sent", kind: "TEXT", at: NOW + 30 * DAY_MS }],
      memories: [{ id: "1", date: NOW + 90 * DAY_MS, mediaType: "image" }],
    });
    const hit = validateExport(future).find((i) => i.code === "future-timestamps");
    expect(hit?.severity).toBe("warning");
    expect(hit?.message).toContain("2 timestamps");
  });

  it("uses hints.now when exportedAt is unknown, and skips the check with neither", () => {
    const p = mk({ friends: { friends: [{ username: "a", createdAt: NOW + 100 * DAY_MS }] } });
    expect(codes(p)).not.toContain("future-timestamps");
    expect(codes(p, { now: NOW })).toContain("future-timestamps");
  });

  it("notes a missing chat file, Snap file and memories file as info only", () => {
    const out = validateExport(mk({ fileList: ["friends.json"], friends: { friends: people(3) } }));
    expect(out.filter((i) => i.severity === "info").map((i) => i.code).sort()).toEqual(["chat-history-missing", "memories-missing", "snap-history-missing"]);
    expect(out.every((i) => i.severity === "info")).toBe(true);
  });

  it("says a missing Snap history may make friends look quieter, without a value or a file path", () => {
    const hit = validateExport(mk({ fileList: ["friends.json", "chat_history.json"], friends: { friends: people(3) } })).find((i) => i.code === "snap-history-missing");
    expect(hit).toEqual({ severity: "info", code: "snap-history-missing", message: "No Snap history file was found, so Snaps are not counted and friends you mostly Snap may look quieter than they are." });
  });

  it("does not ask for a Snap history that is there", () => {
    expect(codes(mk({ friends: { friends: people(3) } }))).not.toContain("snap-history-missing");
  });

  it("does not claim a chat file is missing when it is present but empty", () => {
    expect(codes(mk({ friends: { friends: people(3) } }))).not.toContain("chat-history-missing");
  });

  describe("friend-count-mismatch", () => {
    it("warns when the count differs by more than 5% and at least 3, citing counts and date ranges only", () => {
      const out = validateExport(mk({ friends: { friends: people(80) } }), { expectedFriendCount: 100 });
      const hit = out.find((i) => i.code === "friend-count-mismatch");
      expect(hit?.severity).toBe("warning");
      expect(hit?.message).toContain("80");
      expect(hit?.message).toContain("100");
      expect(hit?.message).toMatch(/date range/i);
    });

    it("tolerates small differences", () => {
      expect(codes(mk({ friends: { friends: people(98) } }), { expectedFriendCount: 100 })).not.toContain("friend-count-mismatch");
      // 2 of 20 is 10% but below the minimum absolute difference of 3.
      expect(codes(mk({ friends: { friends: people(18) } }), { expectedFriendCount: 20 })).not.toContain("friend-count-mismatch");
      // 3 of 20 is 15% and at the minimum: flagged.
      expect(codes(mk({ friends: { friends: people(17) } }), { expectedFriendCount: 20 })).toContain("friend-count-mismatch");
      // 4 of 100 is below 5%.
      expect(codes(mk({ friends: { friends: people(96) } }), { expectedFriendCount: 100 })).not.toContain("friend-count-mismatch");
    });

    it("is silent without the hint", () => {
      expect(codes(mk({ friends: { friends: people(1) } }))).not.toContain("friend-count-mismatch");
    });
  });

  describe("possibly-date-limited", () => {
    it("warns when current friends are all far newer than the oldest sent/deleted record", () => {
      const p = mk({
        friends: {
          friends: people(10, NOW - 100 * DAY_MS),
          deletedFriends: [{ username: "old", createdAt: NOW - 1500 * DAY_MS, deletedAt: NOW - 1000 * DAY_MS }],
        },
      });
      expect(validateExport(p).find((i) => i.code === "possibly-date-limited")?.severity).toBe("warning");
    });

    it("stays quiet when the ranges overlap sensibly or data is missing", () => {
      const ok = mk({
        friends: {
          friends: people(10, NOW - 900 * DAY_MS),
          sentRequests: [{ username: "s", createdAt: NOW - 1000 * DAY_MS }],
        },
      });
      expect(codes(ok)).not.toContain("possibly-date-limited");
      expect(codes(mk({ friends: { friends: people(10, NOW - 100 * DAY_MS) } }))).not.toContain("possibly-date-limited");
    });
  });

  it("never echoes usernames in any issue", () => {
    const p = mk({
      friends: {
        friends: [{ username: "canary_dupe" }, { username: "canary_dupe" }],
        deletedFriends: [{ username: "canary_gone", createdAt: 1 + Date.UTC(2000, 0, 1) }],
      },
    });
    expect(allMessages(validateExport(p, { expectedFriendCount: 50 }))).not.toContain("canary");
  });
});
