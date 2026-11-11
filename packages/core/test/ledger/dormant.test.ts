import { describe, expect, it } from "vitest";
import { findDormant } from "../../src/ledger/detect-dormant.ts";
import { DAY_MS, confidenceFromScore } from "../../src/util.ts";
import type { ChatEvent, FriendRecord, ParsedExport } from "../../src/types.ts";

const NOW = Date.UTC(2025, 5, 1);

const friend = (username: string, daysAgo?: number): FriendRecord => ({
  username,
  ...(daysAgo !== undefined ? { createdAt: NOW - daysAgo * DAY_MS } : {}),
});

const ev = (conversation: string, daysAgo: number, extra: Partial<ChatEvent> = {}): ChatEvent => ({
  conversation,
  isGroup: false,
  direction: "received",
  kind: "TEXT",
  at: NOW - daysAgo * DAY_MS,
  ...extra,
});

// Chat data that reaches far back, so "never chatted" friends are judgeable.
const OLD_ANCHOR = ev("anchor_person", 1000);

function exp(friends: FriendRecord[], chats: ChatEvent[], extra: Partial<ParsedExport> = {}): ParsedExport {
  return {
    friends: {
      friends,
      sentRequests: [],
      pendingRequests: [],
      deletedFriends: [],
      blocked: [],
      ignored: [],
      hiddenSuggestions: [],
    },
    chats,
    memories: [],
    fileList: [],
    issues: [],
    ...extra,
  };
}

describe("findDormant", () => {
  it("returns [] when there are no chats at all", () => {
    expect(findDormant(exp([friend("a", 900)], []), { now: NOW })).toEqual([]);
  });

  it("flags old friends with no recent chats, capped below medium confidence", () => {
    const out = findDormant(
      exp([friend("quiet", 900), friend("never", 900)], [ev("quiet", 400), ev("other", 5)]),
      { now: NOW },
    );
    expect(out.map((c) => c.key).sort()).toEqual(["never", "quiet"]);
    for (const c of out) {
      expect(c.category).toBe("dormant");
      expect(c.score).toBeGreaterThan(0);
      expect(c.score).toBeLessThanOrEqual(0.4);
      expect(c.confidence).toBe("low");
      expect(c.confidence).toBe(confidenceFromScore(c.score));
      expect(c.protectedBy).toEqual([]);
      const limit = c.evidence.find((e) => e.signal === "chat-history-only-covers-saved-chats");
      expect(limit?.weight).toBe(0);
    }
  });

  it("does not flag friends with a chat event (either direction) inside the window", () => {
    const out = findDormant(
      exp(
        [friend("recvd", 900), friend("sent", 900), friend("old", 900)],
        [ev("recvd", 10), ev("sent", 179, { direction: "sent" }), ev("old", 181)],
      ),
      { now: NOW },
    );
    expect(out.map((c) => c.key)).toEqual(["old"]);
  });

  it("honours the days option", () => {
    const p = exp([friend("a", 900)], [ev("a", 50)]);
    expect(findDormant(p, { now: NOW })).toEqual([]);
    expect(findDormant(p, { now: NOW, days: 30 })).toHaveLength(1);
  });

  it("requires the friendship to be older than the window; unknown creation date is skipped", () => {
    const out = findDormant(
      exp([friend("new", 100), friend("unknown"), friend("old", 400)], [OLD_ANCHOR, ev("zzz", 1)]),
      { now: NOW },
    );
    expect(out.map((c) => c.key)).toEqual(["old"]);
  });

  it("matches conversations case-insensitively and ignores group chats", () => {
    const out = findDormant(
      exp(
        [friend("Alice", 900), friend("Bob", 900)],
        [
          OLD_ANCHOR,
          ev("ALICE", 3),
          // A group conversation must not count as 1:1 activity, whatever its key looks like.
          ev("bob", 2, { isGroup: true }),
          ev("group:1a2b3c4d", 1, { isGroup: true }),
        ],
      ),
      { now: NOW },
    );
    expect(out.map((c) => c.key)).toEqual(["bob"]);
  });

  it("skips never-chatted friends when chat data does not reach back across the window", () => {
    // Only recent chats exist (e.g. a short date-range export): absence proves nothing.
    const recentOnly = exp([friend("never", 900), friend("stale", 900)], [ev("someone", 20), ev("stale", 100)]);
    expect(findDormant(recentOnly, { now: NOW })).toEqual([]);
    // Once the data spans the window, never-chatted friends are judgeable again.
    const spanning = exp([friend("never", 900)], [ev("someone", 20), OLD_ANCHOR]);
    expect(findDormant(spanning, { now: NOW }).map((c) => c.key)).toEqual(["never"]);
  });

  it("measures silence up to the export date when the export is older than now", () => {
    // Last event 100 days before the export; now is far later. Not dormant relative to export.
    const exportedAt = NOW - 400 * DAY_MS;
    const p = exp([friend("a", 2000)], [ev("a", 500)], { exportedAt });
    expect(findDormant(p, { now: NOW })).toEqual([]);
    // But 200 days of silence before the export is dormant.
    const q = exp([friend("a", 2000)], [ev("a", 600)], { exportedAt });
    expect(findDormant(q, { now: NOW })).toHaveLength(1);
  });

  it("longer silence scores slightly higher but stays capped", () => {
    const out = findDormant(
      exp([friend("a", 3000), friend("b", 3000), friend("c", 3000)], [ev("a", 190), ev("b", 600), ev("c", 5000)]),
      { now: NOW },
    );
    const s = Object.fromEntries(out.map((c) => [c.key, c.score]));
    expect(s.a!).toBeLessThan(s.b!);
    expect(s.b!).toBeLessThanOrEqual(0.4);
  });

  it("de-duplicates friends", () => {
    const out = findDormant(exp([friend("dup", 900), friend("DUP", 900)], [OLD_ANCHOR]), { now: NOW });
    expect(out.map((c) => c.key)).toEqual(["dup"]);
  });

  it("normalises unicode usernames and never echoes them in evidence", () => {
    const [c] = findDormant(exp([friend("Canary_Ünï", 900)], [ev("canary_ünï", 400)]), { now: NOW });
    expect(c!.key).toBe("canary_ünï");
    for (const e of c!.evidence) expect(e.detail.toLowerCase()).not.toContain("canary");
    expect(Object.keys(c!).sort()).toEqual(["category", "confidence", "evidence", "key", "protectedBy", "score"]);
  });

  it("is sorted and deterministic, and does not mutate input", () => {
    const p = exp([friend("b", 900), friend("a", 900), friend("c", 900)], [ev("c", 700), ev("a", 300), ev("b", 300)]);
    const snapshot = JSON.stringify(p);
    const out = findDormant(p, { now: NOW });
    expect(out.map((c) => c.key)).toEqual(["c", "a", "b"]);
    expect(JSON.stringify(p)).toBe(snapshot);
    expect(findDormant(p, { now: NOW })).toEqual(out);
  });

  it("orders by longest silence when the score has saturated, then no-chat friends, then name", () => {
    // 600+ days is past 3x the 180-day window, so every score ties; silence must still decide.
    const friends = ["a", "b", "c", "d", "e", "f"].map((n) => friend(n, 3000));
    const chats = [ev("a", 931), ev("b", 1509), ev("c", 1190), ev("d", 752), ev("e", 1496), OLD_ANCHOR];
    const out = findDormant(exp(friends, chats), { now: NOW });
    expect(out.map((c) => c.key)).toEqual(["b", "e", "c", "a", "d", "f"]);
  });

  it("scales to 100k chat events and 5k friends", () => {
    const friends = Array.from({ length: 5000 }, (_, i) => friend(`f${i}`, 900));
    const chats: ChatEvent[] = [];
    for (let i = 0; i < 100_000; i++) chats.push(ev(`f${i % 2500}`, 200 + (i % 300)));
    const t0 = Date.now();
    const out = findDormant(exp(friends, chats), { now: NOW });
    expect(out.length).toBe(5000);
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});

describe("findDormant without one-to-one activity", () => {
  const NOW = Date.UTC(2025, 5, 1);
  const DAY = 86_400_000;
  const friend = (username: string) => ({ username, createdAt: NOW - 900 * DAY });
  const parsed = (chats: ParsedExport["chats"]): ParsedExport => ({
    friends: { friends: [friend("alice"), friend("bob"), friend("carol")], sentRequests: [], pendingRequests: [], deletedFriends: [], blocked: [], ignored: [], hiddenSuggestions: [] },
    chats,
    memories: [],
    fileList: [],
    issues: [],
  });

  it("refuses to judge when every conversation was filed as a group", () => {
    const groupOnly = [{ conversation: "group:1a2b3c4d", isGroup: true, direction: "sent" as const, kind: "TEXT", at: NOW - 5 * DAY }, { conversation: "group:1a2b3c4d", isGroup: true, direction: "sent" as const, kind: "TEXT", at: NOW - 800 * DAY }];
    expect(findDormant(parsed(groupOnly), { now: NOW })).toEqual([]);
  });

  it("still judges once any one-to-one event exists", () => {
    const events = [
      { conversation: "group:1a2b3c4d", isGroup: true, direction: "sent" as const, kind: "TEXT", at: NOW - 800 * DAY },
      { conversation: "carol", isGroup: false, direction: "unknown" as const, kind: "IMAGE", at: NOW - 5 * DAY },
    ];
    expect(findDormant(parsed(events), { now: NOW }).map((c) => c.key)).toEqual(["alice", "bob"]);
  });
});
