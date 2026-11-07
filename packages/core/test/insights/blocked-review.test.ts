import { describe, expect, it } from "vitest";
import { reviewBlocked } from "../../src/insights/blocked-review.ts";
import type { BlockedReviewInput } from "../../src/insights/blocked-review.ts";
import { parseExportFiles } from "../../src/export/parse.ts";
import { buildSyntheticExport } from "../../src/testing/synthetic-export.ts";
import { DAY_MS } from "../../src/util.ts";
import type { FriendRecord } from "../../src/types.ts";

const NOW = Date.UTC(2026, 5, 1);
const day = (n: number) => NOW - n * DAY_MS;
const rec = (username: string, at?: number, extra: Partial<FriendRecord> = {}): FriendRecord => ({
  username,
  ...(at !== undefined ? { createdAt: at } : {}),
  ...extra,
});
const list = (r: ReturnType<typeof reviewBlocked>, id: string) => r.lists.find((l) => l.id === id)!;

describe("reviewBlocked", () => {
  it("handles empty input", () => {
    const r = reviewBlocked({}, { now: NOW });
    expect(r.lists.map((l) => l.id)).toEqual(["blocked", "ignored", "hiddenSuggestions"]);
    expect(r.lists.every((l) => l.count === 0 && l.oldestAt === null && l.newestAt === null)).toBe(true);
    expect(r.conflicts).toEqual([]);
    expect(r.reviewOrder).toEqual([]);
    expect(r.totals).toEqual({ people: 0, conflicts: 0 });
    expect(r.notes).toEqual([{ code: "no-entries", params: {} }]);
  });

  it("handles one item", () => {
    const r = reviewBlocked({ blocked: [rec("amy", day(10))] }, { now: NOW });
    const b = list(r, "blocked");
    expect(b.count).toBe(1);
    expect(b.oldestAt).toBe(day(10));
    expect(b.newestAt).toBe(day(10));
    expect(r.reviewOrder).toEqual([{ kind: "list", list: "blocked", code: "review-blocked", count: 1 }]);
    expect(r.notes.map((n) => n.code)).toEqual(["list-empty", "list-empty", "friends-list-empty"]);
  });

  it("reports oldest and newest and orders oldest first, undated last, with a username tiebreak", () => {
    const r = reviewBlocked(
      { ignored: [rec("zed", day(5)), rec("amy"), rec("bob", day(50)), rec("cat", day(5)), rec("abe")] },
      { now: NOW },
    );
    const l = list(r, "ignored");
    expect(l.entries.map((e) => e.username)).toEqual(["bob", "cat", "zed", "abe", "amy"]);
    expect(l.oldestAt).toBe(day(50));
    expect(l.newestAt).toBe(day(5));
    expect(l.datedCount).toBe(3);
    expect(l.undatedCount).toBe(2);
    expect(r.notes).toContainEqual({ code: "undated-entries", params: { list: "ignored", count: 2 } });
  });

  it("falls back to modifiedAt and ignores invalid dates", () => {
    const r = reviewBlocked(
      { blocked: [rec("a", undefined, { modifiedAt: day(3) }), rec("b", NaN), rec("c", 0), rec("d", -5)] },
      { now: NOW },
    );
    const l = list(r, "blocked");
    expect(l.datedCount).toBe(1);
    expect(l.undatedCount).toBe(3);
    expect(l.oldestAt).toBe(day(3));
  });

  it("counts future dates apart and keeps them out of oldest and newest", () => {
    const r = reviewBlocked({ hiddenSuggestions: [rec("a", NOW + DAY_MS), rec("b", day(2))] }, { now: NOW });
    const l = list(r, "hiddenSuggestions");
    expect(l.futureCount).toBe(1);
    expect(l.datedCount).toBe(1);
    expect(l.undatedCount).toBe(0);
    expect(l.newestAt).toBe(day(2));
    expect(l.entries.find((e) => e.username === "a")!.at).toBeUndefined();
    expect(r.notes).toContainEqual({ code: "future-dated-entries", params: { list: "hiddenSuggestions", count: 1 } });
  });

  it("merges case duplicates and keeps the oldest usable date", () => {
    const r = reviewBlocked(
      { blocked: [rec("Amy", day(5)), rec("AMY", day(9)), rec("amy ", NOW + DAY_MS), rec("bob", day(1))] },
      { now: NOW },
    );
    const l = list(r, "blocked");
    expect(l.count).toBe(2);
    expect(l.caseDuplicates).toBe(2);
    expect(l.entries[0]).toMatchObject({ username: "amy", at: day(9) });
    expect(l.futureCount).toBe(0);
    expect(r.notes).toContainEqual({ code: "case-duplicates", params: { list: "blocked", count: 2 } });
  });

  it("skips blank usernames and says how many", () => {
    const r = reviewBlocked({ ignored: [rec("  "), rec(""), rec("amy")] }, { now: NOW });
    expect(list(r, "ignored").count).toBe(1);
    expect(r.notes).toContainEqual({ code: "blank-entries", params: { list: "ignored", count: 2 } });
  });

  it("finds people in more than one list and people who are also friends or requests", () => {
    const input: BlockedReviewInput = {
      blocked: [rec("amy", day(9)), rec("bob"), rec("fay")],
      ignored: [rec("AMY", day(3)), rec("cat"), rec("gus")],
      hiddenSuggestions: [rec("cat"), rec("dan"), rec("eve")],
      friends: [rec("bob"), rec("Dan")],
      pendingRequests: [rec("eve")],
      sentRequests: [rec("fay")],
    };
    const r = reviewBlocked(input, { now: NOW });
    expect(r.conflicts).toEqual([
      { username: "amy", lists: ["blocked", "ignored"], kinds: ["multiple-lists"] },
      { username: "bob", lists: ["blocked"], kinds: ["also-friend"] },
      { username: "cat", lists: ["ignored", "hiddenSuggestions"], kinds: ["multiple-lists"] },
      { username: "dan", lists: ["hiddenSuggestions"], kinds: ["also-friend"] },
      { username: "eve", lists: ["hiddenSuggestions"], kinds: ["also-pending"] },
      { username: "fay", lists: ["blocked"], kinds: ["also-sent"] },
    ]);
    expect(list(r, "ignored").entries.find((e) => e.username === "gus")!.conflicts).toEqual([]);
    expect(r.totals).toEqual({ people: 7, conflicts: 6 });
    expect(r.reviewOrder.map((s) => s.code)).toEqual([
      "review-conflicts",
      "review-blocked",
      "review-ignored",
      "review-hidden-suggestions",
    ]);
    expect(r.reviewOrder[0]!.count).toBe(6);
    expect(r.notes).toContainEqual({ code: "conflicts-found", params: { count: 6 } });
    expect(r.notes.some((n) => n.code === "friends-list-empty")).toBe(false);
  });

  it("combines several conflict kinds for one person", () => {
    const r = reviewBlocked(
      { blocked: [rec("amy")], ignored: [rec("amy")], friends: [rec("amy")], pendingRequests: [rec("amy")] },
      { now: NOW },
    );
    expect(r.conflicts[0]!.kinds).toEqual(["multiple-lists", "also-friend", "also-pending"]);
  });

  it("does not mutate its input and is deterministic", () => {
    const input: BlockedReviewInput = { blocked: [rec("b", day(2)), rec("a", day(2))], friends: [rec("a")] };
    const copy = JSON.stringify(input);
    const one = reviewBlocked(input, { now: NOW });
    expect(JSON.stringify(input)).toBe(copy);
    expect(reviewBlocked(input, { now: NOW })).toEqual(one);
  });

  it("is fast on 10 000+ items per list", () => {
    const n = 12_000;
    const mk = (p: string) =>
      Array.from({ length: n }, (_, i) => rec(`${p}${i % 9000}`, i % 7 === 0 ? undefined : day(i % 400)));
    const started = performance.now();
    const r = reviewBlocked(
      { blocked: mk("u"), ignored: mk("u"), hiddenSuggestions: mk("v"), friends: mk("u").slice(0, 5000) },
      { now: NOW },
    );
    expect(performance.now() - started).toBeLessThan(2000);
    expect(list(r, "blocked").count).toBe(9000);
    expect(list(r, "blocked").caseDuplicates).toBe(3000);
    expect(r.conflicts.length).toBeGreaterThan(8000);
  });

  it("works on the parsed synthetic export", () => {
    const parsed = parseExportFiles(buildSyntheticExport({ now: NOW }));
    const r = reviewBlocked(parsed.friends, { now: NOW });
    expect(list(r, "blocked").count).toBe(parsed.friends.blocked.length);
    expect(list(r, "blocked").count).toBeGreaterThan(0);
    expect(r.generatedAt).toBe(NOW);
  });

  it("keeps a canary username only in the rows that list people", () => {
    const canary = "zzcanary_blockedreview_7f3a";
    const r = reviewBlocked(
      {
        blocked: [rec(canary.toUpperCase(), day(4))],
        ignored: [rec(canary)],
        hiddenSuggestions: [rec("  " + canary + " ")],
        friends: [rec(canary)],
        pendingRequests: [rec(canary)],
        sentRequests: [rec(canary)],
      },
      { now: NOW },
    );
    const rest = JSON.stringify({
      generatedAt: r.generatedAt,
      reviewOrder: r.reviewOrder,
      totals: r.totals,
      notes: r.notes,
      listMeta: r.lists.map(({ entries: _entries, ...meta }) => meta),
    });
    expect(rest).not.toContain(canary);
    const listed = JSON.stringify({ entries: r.lists.map((l) => l.entries), conflicts: r.conflicts });
    expect(listed).toContain(canary);
    expect(r.conflicts).toHaveLength(1);
  });
});
