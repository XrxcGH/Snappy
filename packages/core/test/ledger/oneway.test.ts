import { describe, expect, it } from "vitest";
import { findOneWay } from "../../src/ledger/detect-oneway.ts";
import { DAY_MS, confidenceFromScore } from "../../src/util.ts";
import type { FriendRecord, ParsedExport } from "../../src/types.ts";

const NOW = Date.UTC(2025, 5, 1);

// A non-empty friends list is the default so tests exercise the detector, not the empty-list guard.
const BASE_FRIENDS: FriendRecord[] = [{ username: "basefriend" }];

function exp(p: Partial<ParsedExport["friends"]> = {}, extra: Partial<ParsedExport> = {}): ParsedExport {
  return {
    friends: {
      friends: BASE_FRIENDS,
      sentRequests: [],
      pendingRequests: [],
      deletedFriends: [],
      blocked: [],
      ignored: [],
      hiddenSuggestions: [],
      ...p,
    },
    chats: [],
    memories: [],
    fileList: [],
    issues: [],
    ...extra,
  };
}

const req = (username: string, daysAgo?: number, extra: Partial<FriendRecord> = {}): FriendRecord => ({
  username,
  ...(daysAgo !== undefined ? { createdAt: NOW - daysAgo * DAY_MS } : {}),
  ...extra,
});

describe("findOneWay", () => {
  it("returns [] for an export without sent requests", () => {
    expect(findOneWay(exp(), { now: NOW })).toEqual([]);
  });

  it("returns [] when the friends list is empty (cannot tell unanswered from dropped)", () => {
    expect(findOneWay(exp({ friends: [], sentRequests: [req("a", 90)] }), { now: NOW })).toEqual([]);
  });

  it("scores rise with age and never exceed 0.7", () => {
    const out = findOneWay(
      exp({ sentRequests: [req("a", 20), req("b", 60), req("c", 180), req("d", 4000)] }),
      { now: NOW },
    );
    const s = Object.fromEntries(out.map((c) => [c.key, c.score]));
    expect(s.a!).toBeLessThan(s.b!);
    expect(s.b!).toBeLessThan(s.c!);
    expect(s.d!).toBeLessThanOrEqual(0.7);
    expect(s.c!).toBeGreaterThan(0.5);
    for (const c of out) {
      expect(c.category).toBe("one-way");
      expect(c.confidence).toBe(confidenceFromScore(c.score));
      expect(c.protectedBy).toEqual([]);
    }
  });

  it("excludes requests younger than minAgeDays (default 14) and honours the option", () => {
    const p = exp({ sentRequests: [req("young", 13), req("edge", 14)] });
    expect(findOneWay(p, { now: NOW }).map((c) => c.key)).toEqual(["edge"]);
    expect(findOneWay(p, { now: NOW, minAgeDays: 7 }).map((c) => c.key).sort()).toEqual(["edge", "young"]);
    expect(findOneWay(p, { now: NOW, minAgeDays: 30 })).toEqual([]);
  });

  it("ignores requests dated in the future", () => {
    expect(findOneWay(exp({ sentRequests: [req("future", -5)] }), { now: NOW })).toEqual([]);
  });

  it("excludes people who are friends, were deleted by the user, or are blocked (case-insensitive)", () => {
    const out = findOneWay(
      exp({
        sentRequests: [req("Friend", 90), req("DELETED", 90), req("blocky", 90), req("lonely", 90)],
        friends: [{ username: "friend" }],
        deletedFriends: [{ username: "deleted" }],
        blocked: [{ username: "BLOCKY" }],
      }),
      { now: NOW },
    );
    expect(out.map((c) => c.key)).toEqual(["lonely"]);
  });

  it("includes unknown-age requests with low weight and the unknown-request-age signal", () => {
    const [c] = findOneWay(exp({ sentRequests: [req("mystery")] }), { now: NOW });
    expect(c).toBeDefined();
    expect(c!.evidence.map((e) => e.signal)).toContain("unknown-request-age");
    expect(c!.confidence).toBe("low");
    expect(c!.score).toBeLessThan(0.3);
  });

  it("carries honest evidence mentioning the request may have been declined or unseen", () => {
    const [c] = findOneWay(exp({ sentRequests: [req("x", 100)] }), { now: NOW });
    const signals = c!.evidence.map((e) => e.signal);
    expect(signals).toEqual(expect.arrayContaining(["request-never-accepted", "request-age"]));
    const never = c!.evidence.find((e) => e.signal === "request-never-accepted")!;
    expect(never.detail).toMatch(/declined|never seen|ignored/);
    for (const e of c!.evidence) {
      expect(e.weight).toBeGreaterThanOrEqual(0);
      expect(e.weight).toBeLessThanOrEqual(1);
    }
  });

  it("never echoes the username in evidence text or anywhere except key", () => {
    const name = "CanaryUser_Zq9";
    const out = findOneWay(exp({ sentRequests: [req(name, 90), req("noage_canary_k4")] }), { now: NOW });
    expect(out).toHaveLength(2);
    for (const c of out) {
      for (const e of c.evidence) {
        expect(e.detail.toLowerCase()).not.toContain("canary");
        expect(e.signal.toLowerCase()).not.toContain("canary");
      }
      expect(Object.keys(c).sort()).toEqual(["category", "confidence", "evidence", "key", "protectedBy", "score"]);
    }
  });

  it("de-duplicates repeated requests, keeping the oldest", () => {
    const out = findOneWay(exp({ sentRequests: [req("Zoë", 30), req("zoë", 120), req("ZOË")] }), { now: NOW });
    expect(out).toHaveLength(1);
    expect(out[0]!.key).toBe("zoë");
    expect(out[0]!.evidence.find((e) => e.signal === "request-age")!.at).toBe(NOW - 120 * DAY_MS);
  });

  it("normalises unicode usernames to the key", () => {
    const [c] = findOneWay(exp({ sentRequests: [req("Ünï_Çode", 40)] }), { now: NOW });
    expect(c!.key).toBe("ünï_çode");
  });

  it("skips empty usernames", () => {
    expect(findOneWay(exp({ sentRequests: [req("  ", 90), req("", 90)] }), { now: NOW })).toEqual([]);
  });

  it("sorts by score desc then key and is deterministic", () => {
    const p = exp({ sentRequests: [req("b", 100), req("a", 100), req("c", 400), req("d", 20)] });
    const first = findOneWay(p, { now: NOW });
    expect(first.map((c) => c.key)).toEqual(["c", "a", "b", "d"]);
    expect(findOneWay(p, { now: NOW })).toEqual(first);
  });

  it("does not mutate its input", () => {
    const p = exp({ sentRequests: [req("a", 90)], friends: [{ username: "f" }] });
    const snapshot = JSON.stringify(p);
    findOneWay(p, { now: NOW });
    expect(JSON.stringify(p)).toBe(snapshot);
  });

  it("handles 5k requests quickly", () => {
    const sentRequests = Array.from({ length: 5000 }, (_, i) => req(`user${i}`, 20 + (i % 400)));
    const friends = Array.from({ length: 5000 }, (_, i) => ({ username: `friend${i}` }));
    const t0 = Date.now();
    const out = findOneWay(exp({ sentRequests, friends }), { now: NOW });
    expect(out).toHaveLength(5000);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});
