import { describe, expect, it } from "vitest";
import type { DeletedFriendRecord, FriendRecord, Ledger, Snapshot } from "../../src/types.ts";
import { buildFriendCountHistory } from "../../src/insights/friend-count-history.ts";
import type { FriendCountHistory, FriendCountInput } from "../../src/insights/friend-count-history.ts";
import { addSnapshot, emptyLedger, snapshotFromExport } from "../../src/ledger/ledger.ts";
import { parseExportZip } from "../../src/export/parse.ts";
import { CANARIES, syntheticExportZip } from "../../src/testing/synthetic-export.ts";
import { DAY_MS } from "../../src/util.ts";

const NOW = Date.UTC(2025, 5, 15, 12); // Jun 15, 2025
const at = (y: number, m: number, d = 10) => Date.UTC(y, m - 1, d, 8);

const fr = (username: string, createdAt?: number): FriendRecord => (createdAt === undefined ? { username } : { username, createdAt });
const del = (username: string, createdAt: number | undefined, deletedAt: number | undefined): DeletedFriendRecord => ({
  username,
  ...(createdAt !== undefined ? { createdAt } : {}),
  ...(deletedAt !== undefined ? { deletedAt } : {}),
});
const snap = (id: string, takenAt: number, friends: string[]): Snapshot => ({
  id, takenAt, source: "export", friends, sentRequests: [], deleted: {}, friendSince: {}, sentAt: {},
});
const ledgerOf = (...snapshots: Snapshot[]): Ledger => ({ version: 1, snapshots });
const run = (p: Partial<FriendCountInput> = {}): FriendCountHistory =>
  buildFriendCountHistory({ friends: [], deletedFriends: [], now: NOW, ...p });
const codes = (h: FriendCountHistory) => h.notes.map((n) => n.code);
const note = (h: FriendCountHistory, code: string) => h.notes.find((n) => n.code === code);
const names = (n: number, prefix = "f") => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

describe("curve and monthly series", () => {
  it("handles empty input", () => {
    const h = run();
    expect(h.months).toEqual([]);
    expect(h.best).toBeNull();
    expect(h.worst).toBeNull();
    expect(h.totals).toEqual({ joined: 0, left: 0, net: 0, startingCount: 0, currentCount: null });
    expect(codes(h)).toEqual(["no-dated-friendships", "no-snapshots"]);
  });

  it("handles one friend", () => {
    const h = run({ friends: [fr("a", at(2025, 3))] });
    expect(h.months.map((m) => [m.month, m.joined, m.left, m.net, m.count, m.partial])).toEqual([
      ["2025-03", 1, 0, 1, 1, false],
      ["2025-04", 0, 0, 0, 1, false],
      ["2025-05", 0, 0, 0, 1, false],
      ["2025-06", 0, 0, 0, 1, true],
    ]);
    expect(h.best).toEqual({ month: "2025-03", net: 1 });
    expect(h.worst).toBeNull();
    expect(h.totals.currentCount).toBe(1);
  });

  it("builds joins, leaves, net, running count, with gap months filled", () => {
    const h = run({
      friends: [fr("a", at(2025, 1)), fr("b", at(2025, 1)), fr("c", at(2025, 4))],
      deletedFriends: [del("d", at(2024, 12), at(2025, 2)), del("e", at(2024, 12), at(2025, 2)), del("f", at(2025, 1), at(2025, 2))],
    });
    expect(h.months.map((m) => [m.month, m.joined, m.left, m.net, m.count])).toEqual([
      ["2024-12", 2, 0, 2, 2],
      ["2025-01", 3, 0, 3, 5],
      ["2025-02", 0, 3, -3, 2],
      ["2025-03", 0, 0, 0, 2],
      ["2025-04", 1, 0, 1, 3],
      ["2025-05", 0, 0, 0, 3],
      ["2025-06", 0, 0, 0, 3],
    ]);
    expect(h.best).toEqual({ month: "2025-01", net: 3 });
    expect(h.worst).toEqual({ month: "2025-02", net: -3 });
    expect(h.totals).toMatchObject({ joined: 6, left: 3, net: 3, currentCount: 3, startingCount: 0 });
  });

  it("merges usernames that differ only by case and trims them", () => {
    const h = run({
      friends: [fr("Alice", at(2025, 2)), fr(" alice ", at(2025, 1)), fr("ALICE", at(2025, 3))],
      deletedFriends: [del("bob", at(2025, 1), at(2025, 2)), del("BOB", at(2025, 1), at(2025, 3))],
    });
    // Alice: one friend, earliest creation. Bob: one deletion, the latest.
    expect(h.totals).toMatchObject({ joined: 2, left: 1, currentCount: 1 });
    expect(h.months.find((m) => m.month === "2025-01")!.joined).toBe(2);
    expect(h.months.find((m) => m.month === "2025-03")!.left).toBe(1);
  });

  it("treats a person in both lists as a current friend and says so", () => {
    const h = run({ friends: [fr("a", at(2025, 4))], deletedFriends: [del("A", at(2025, 1), at(2025, 2))] });
    expect(h.totals).toMatchObject({ joined: 1, left: 0, currentCount: 1 });
    expect(note(h, "re-added-friends")?.params).toEqual({ count: 1 });
  });

  it("assumes undated friendships go back before the first month and says so", () => {
    const h = run({
      friends: [fr("a"), fr("b"), fr("c", at(2025, 3))],
      deletedFriends: [del("d", undefined, at(2025, 4)), del("e", at(2025, 1), undefined)],
    });
    expect(h.totals).toMatchObject({ startingCount: 3, joined: 1, left: 1, currentCount: 3 });
    expect(h.months.map((m) => m.count)).toEqual([4, 3, 3, 3]);
    expect(note(h, "undated-joins")?.params).toEqual({ count: 3 });
    expect(note(h, "undated-leaves")?.params).toEqual({ count: 1 });
  });

  it("gives no curve when no friendship has a usable date", () => {
    const h = run({ friends: [fr("a"), fr("b")], deletedFriends: [del("c", undefined, undefined)] });
    expect(h.months).toEqual([]);
    expect(h.totals.currentCount).toBeNull();
    expect(codes(h)).toContain("no-dated-friendships");
  });

  it("ignores future and implausible dates and counts them", () => {
    const h = run({
      friends: [fr("a", NOW + 5 * DAY_MS), fr("b", 0), fr("c", Number.NaN), fr("d", at(2025, 5))],
      deletedFriends: [del("e", at(2025, 1), NOW + DAY_MS)],
    });
    expect(h.totals).toMatchObject({ joined: 1, left: 0, startingCount: 3, currentCount: 4 });
    expect(note(h, "unusable-dates-ignored")?.params).toEqual({ count: 3 }); // a, b (NaN is just undated) and e's deletion
    expect(h.months.at(-1)!.month).toBe("2025-06");
    expect(h.months.every((m) => m.month <= "2025-06")).toBe(true);
  });

  it("drops a deletion that is dated before the creation and says so", () => {
    const h = run({ deletedFriends: [del("a", at(2025, 3), at(2025, 1))] });
    expect(h.totals).toMatchObject({ joined: 1, left: 0 });
    expect(note(h, "leave-before-join")?.params).toEqual({ count: 1 });
    // The person stays on the curve as a join, so they are not also "left out" as an undated leave.
    expect(codes(h)).not.toContain("undated-leaves");
  });

  it("marks the month of now as partial and keeps it out of best and worst", () => {
    const h = run({ friends: names(5).map((n) => fr(n, at(2025, 6, 1))), deletedFriends: [del("x", undefined, at(2025, 3))] });
    expect(h.months.at(-1)).toMatchObject({ month: "2025-06", joined: 5, partial: true });
    expect(h.best).toBeNull();
    expect(h.worst).toEqual({ month: "2025-03", net: -1 });
  });

  it("breaks best and worst ties toward the earlier month", () => {
    const h = run({
      friends: [fr("a", at(2025, 1)), fr("b", at(2025, 3)), fr("c", at(2025, 2))],
      deletedFriends: [del("d", undefined, at(2025, 4)), del("e", undefined, at(2025, 5))],
    });
    expect(h.best).toEqual({ month: "2025-01", net: 1 });
    expect(h.worst).toEqual({ month: "2025-04", net: -1 });
  });

  it("reports a best month but no worst when a month joined 2 and left 1", () => {
    const h = run({ friends: [fr("a", at(2025, 3))], deletedFriends: [del("b", at(2025, 3), at(2025, 3))] });
    expect(h.months[0]).toMatchObject({ joined: 2, left: 1, net: 1 });
    expect(h.best).toEqual({ month: "2025-03", net: 1 });
    expect(h.worst).toBeNull();
  });

  it("reports no best or worst when every complete month nets to zero", () => {
    const h = run({ deletedFriends: [del("a", at(2025, 3), at(2025, 3, 20))] });
    expect(h.months[0]).toMatchObject({ month: "2025-03", joined: 1, left: 1, net: 0 });
    expect(h.best).toBeNull();
    expect(h.worst).toBeNull();
  });
});

describe("date boundaries", () => {
  it("keeps a date equal to now and drops one a millisecond later", () => {
    const h = run({ friends: [fr("a", NOW), fr("b", NOW + 1)] });
    expect(h.totals).toMatchObject({ joined: 1, startingCount: 1 });
    expect(note(h, "unusable-dates-ignored")?.params).toEqual({ count: 1 });
    expect(h.months.at(-1)).toMatchObject({ month: "2025-06", joined: 1, partial: true });
  });

  it("keeps a date exactly at Jan 1, 2011 UTC and drops one a millisecond earlier", () => {
    const start = Date.UTC(2011, 0, 1);
    const h = run({ friends: [fr("a", start), fr("b", start - 1)] });
    expect(h.totals).toMatchObject({ joined: 1, startingCount: 1 });
    expect(note(h, "unusable-dates-ignored")?.params).toEqual({ count: 1 });
    expect(h.months[0]).toMatchObject({ month: "2011-01", joined: 1 });
  });

  it("splits months at UTC midnight, including the last millisecond of January", () => {
    const h = run({
      friends: [fr("a", Date.UTC(2025, 0, 31, 23, 59, 59, 999)), fr("b", Date.UTC(2025, 1, 1, 0, 0, 0, 0))],
    });
    expect(h.months.slice(0, 2).map((m) => [m.month, m.joined])).toEqual([["2025-01", 1], ["2025-02", 1]]);
  });

  it("handles leap days and the February to March change", () => {
    const h = run({
      friends: [
        fr("a", Date.UTC(2024, 1, 28, 23, 59, 59, 999)),
        fr("b", Date.UTC(2024, 1, 29, 0, 0, 0, 0)),
        fr("c", Date.UTC(2024, 1, 29, 23, 59, 59, 999)),
        fr("d", Date.UTC(2024, 2, 1, 0, 0, 0, 0)),
      ],
    });
    expect(h.months.slice(0, 2).map((m) => [m.month, m.joined, m.count])).toEqual([["2024-02", 3, 3], ["2024-03", 1, 4]]);
  });

  it("keeps the series a sane length when now is huge but finite", () => {
    const h = buildFriendCountHistory({ friends: [fr("a", at(2025, 3))], deletedFriends: [], now: 8e15 });
    expect(h.months.at(-1)).toMatchObject({ month: "9999-12", partial: true });
    expect(h.months.length).toBeLessThan(100_000);
    expect(h.totals.currentCount).toBe(1);
  });

  it("counts bad date values, not people", () => {
    const h = run({ friends: [fr("a", 0)], deletedFriends: [del("a", 0, NOW + DAY_MS)] });
    expect(note(h, "unusable-dates-ignored")?.params).toEqual({ count: 3 });
  });

  it("puts a snapshot on its UTC month and compares at its exact moment", () => {
    const t = Date.UTC(2025, 0, 31, 23, 59, 59, 999);
    const h = run({
      friends: [fr("a", t), fr("b", t + 1)],
      ledger: ledgerOf(snap("s1", t, names(1))),
    });
    expect(h.comparisons[0]).toMatchObject({ curveCount: 1, gap: 0 });
    expect(h.months[0]).toMatchObject({ month: "2025-01", snapshotCount: 1 });
  });
});

describe("snapshots and the disagreement note", () => {
  const friendsInput = { friends: names(20).map((n) => fr(n, at(2024, 1))) };

  it("notes that there are no snapshots, or only one", () => {
    expect(codes(run(friendsInput))).toEqual(["curve-may-run-high", "no-snapshots"]);
    const one = run({ ...friendsInput, ledger: ledgerOf(snap("s1", at(2025, 2), names(20))) });
    expect(codes(one)).toEqual(["curve-may-run-high", "single-snapshot", "sources-agree"]);
    expect(one.comparisons).toEqual([{ takenAt: at(2025, 2), snapshotCount: 20, curveCount: 20, gap: 0, disagrees: false }]);
  });

  it("reports sources that agree", () => {
    const h = run({ ...friendsInput, ledger: ledgerOf(snap("s1", at(2024, 6), names(19)), snap("s2", at(2025, 2), names(21))) });
    expect(note(h, "sources-agree")?.params).toEqual({ compared: 2 });
    expect(codes(h)).not.toContain("sources-disagree");
  });

  it("reports sources that disagree, with counts and the largest gap", () => {
    const h = run({
      ...friendsInput,
      ledger: ledgerOf(snap("s1", at(2024, 6), names(60)), snap("s2", at(2025, 2), names(30)), snap("s3", at(2025, 3), names(20))),
    });
    expect(h.comparisons.map((c) => [c.snapshotCount, c.curveCount, c.gap, c.disagrees])).toEqual([
      [60, 20, 40, true],
      [30, 20, 10, true],
      [20, 20, 0, false],
    ]);
    expect(note(h, "sources-disagree")?.params).toEqual({ compared: 3, disagreeing: 2, largestGap: 40 });
    expect(codes(h)).not.toContain("sources-agree");
  });

  it("respects the thresholds and lets options change them", () => {
    const ledger = ledgerOf(snap("s1", at(2025, 2), names(26))); // gap 6 > 5 and > 10% of 26
    expect(run({ ...friendsInput, ledger }).comparisons[0]!.disagrees).toBe(true);
    expect(run({ ...friendsInput, ledger: ledgerOf(snap("s1", at(2025, 2), names(25))) }).comparisons[0]!.disagrees).toBe(false);
    expect(buildFriendCountHistory({ ...friendsInput, deletedFriends: [], now: NOW, ledger }, { disagreeMinGap: 10 }).comparisons[0]!.disagrees).toBe(false);
  });

  describe("the share-of-snapshot threshold", () => {
    const big = { friends: names(200).map((n) => fr(n, at(2024, 1))) };
    const withSnap = (size: number) => ledgerOf(snap("s1", at(2025, 2), names(size)));
    const disagrees = (size: number, options?: { disagreeMinGap?: number; disagreeFraction?: number }) =>
      buildFriendCountHistory({ ...big, deletedFriends: [], now: NOW, ledger: withSnap(size) }, options).comparisons[0]!.disagrees;

    it("tolerates a gap below 10% of a large snapshot, even when it is above the 5 friend floor", () => {
      expect(disagrees(215)).toBe(false); // gap 15 < 21.5
      expect(disagrees(222)).toBe(false); // gap 22 < 22.2
      expect(disagrees(185)).toBe(false); // negative gaps use the same rule
    });

    it("flags a gap above 10% of a large snapshot", () => {
      expect(disagrees(230)).toBe(true); // gap 30 > 23
      expect(disagrees(223)).toBe(true); // gap 23 > 22.3
      expect(disagrees(150)).toBe(true); // gap -50 > 15
    });

    it("falls back to the defaults when an option is not a finite number", () => {
    const bad = { disagreeMinGap: Number.NaN, disagreeFraction: Number.POSITIVE_INFINITY };
    expect(disagrees(230, bad)).toBe(true);
    expect(disagrees(215, bad)).toBe(false);
    expect(disagrees(230, { disagreeMinGap: Number.NaN })).toBe(true);
    expect(disagrees(230, { disagreeFraction: Number.NaN })).toBe(true);
  });

  it("lets disagreeFraction change the share", () => {
      expect(disagrees(230, { disagreeFraction: 0.5 })).toBe(false); // gap 30 < 115
      expect(disagrees(215, { disagreeFraction: 0.01 })).toBe(true); // 1% is below the floor of 5, gap 15 > 5
      expect(disagrees(215, { disagreeFraction: 0.01, disagreeMinGap: 20 })).toBe(false); // the floor now wins
    });
  });

  it("compares against the curve at the time of the snapshot, not today", () => {
    const h = run({
      friends: [fr("a", at(2024, 1)), fr("b", at(2025, 1))],
      deletedFriends: [del("c", at(2024, 1), at(2024, 6))],
      ledger: ledgerOf(snap("s1", at(2024, 3), names(2)), snap("s2", at(2024, 8), names(1)), snap("s3", at(2025, 3), names(2))),
    });
    expect(h.comparisons.map((c) => c.curveCount)).toEqual([2, 1, 2]);
    expect(h.comparisons.every((c) => !c.disagrees)).toBe(true);
  });

  it("puts snapshot sizes on their month, the latest one winning, and extends the series", () => {
    const h = run({
      friends: [fr("a", at(2025, 3))],
      ledger: ledgerOf(snap("s0", at(2025, 1, 5), names(4)), snap("s1", at(2025, 3, 5), names(2)), snap("s2", at(2025, 3, 20), names(3))),
    });
    expect(h.months[0]).toMatchObject({ month: "2025-01", joined: 0, snapshotCount: 4 });
    expect(h.months.find((m) => m.month === "2025-03")).toMatchObject({ snapshotCount: 3 });
    expect(h.months.find((m) => m.month === "2025-02")!.snapshotCount).toBeNull();
  });

  it("works from snapshots alone, with no curve", () => {
    const h = run({ ledger: ledgerOf(snap("s1", at(2025, 4), names(7))) });
    expect(h.months.find((m) => m.month === "2025-04")).toMatchObject({ snapshotCount: 7, count: null });
    expect(h.comparisons).toEqual([]);
    expect(codes(h)).toEqual(["no-dated-friendships", "single-snapshot"]);
  });

  it("ignores snapshots with a missing, future or implausible time", () => {
    const bad = [snap("s1", NOW + DAY_MS, names(3)), snap("s2", 5, names(3)), { ...snap("s3", Number.NaN, names(3)) }];
    const h = run({ ...friendsInput, ledger: ledgerOf(...bad, snap("ok", at(2025, 1), names(20))) });
    expect(note(h, "snapshots-ignored")?.params).toEqual({ count: 3 });
    expect(h.comparisons).toHaveLength(1);
  });

  it("counts a snapshot's friends once per person, ignoring case", () => {
    const h = run({ ...friendsInput, ledger: ledgerOf(snap("s1", at(2025, 1), ["A", "a", " a ", "b", ""])) });
    expect(h.comparisons[0]!.snapshotCount).toBe(2);
  });

  it("tolerates snapshots out of order and equal times deterministically", () => {
    const ledger = ledgerOf(snap("late", at(2025, 3), names(20)), snap("early", at(2024, 6), names(20)), snap("tie", at(2025, 3), names(20)));
    const h = run({ ...friendsInput, ledger });
    expect(h.comparisons.map((c) => c.takenAt)).toEqual([at(2024, 6), at(2025, 3), at(2025, 3)]);
  });
});

describe("determinism, scale and privacy", () => {
  it("is deterministic and does not depend on input order", () => {
    const friends = [fr("a", at(2025, 1)), fr("b", at(2025, 2)), fr("c", at(2025, 2))];
    const deletedFriends = [del("d", at(2024, 5), at(2025, 2)), del("e", at(2024, 5), at(2025, 4))];
    const ledger = ledgerOf(snap("s1", at(2025, 1), names(3)), snap("s2", at(2025, 5), names(2)));
    const a = run({ friends, deletedFriends, ledger });
    const b = run({ friends: [...friends].reverse(), deletedFriends: [...deletedFriends].reverse(), ledger });
    expect(b).toEqual(a);
    expect(run({ friends, deletedFriends, ledger })).toEqual(a);
  });

  it("does not modify its input", () => {
    const friends = [fr("B", at(2025, 2)), fr("a", at(2025, 1))];
    const copy = JSON.parse(JSON.stringify(friends));
    run({ friends });
    expect(friends).toEqual(copy);
  });

  it("rejects a non-finite now without echoing anything", () => {
    expect(() => run({ now: Number.NaN })).toThrow(/now must be/);
  });

  it("handles 10,000+ friends and snapshots quickly", () => {
    const base = Date.UTC(2013, 0, 1);
    const friends = Array.from({ length: 12_000 }, (_, i) => fr(`user${i}`, base + (i % 4000) * DAY_MS));
    const deletedFriends = Array.from({ length: 6_000 }, (_, i) => del(`gone${i}`, base + (i % 3000) * DAY_MS, base + 3000 * DAY_MS + (i % 1000) * DAY_MS));
    const snapshots = Array.from({ length: 500 }, (_, i) => snap(`s${i}`, base + (i + 1) * 8 * DAY_MS, names(1000 + i)));
    const t0 = performance.now();
    const h = run({ friends, deletedFriends, ledger: ledgerOf(...snapshots), now: Date.UTC(2025, 0, 1) });
    expect(performance.now() - t0).toBeLessThan(3000);
    expect(h.totals).toMatchObject({ joined: 18_000, left: 6_000, currentCount: 12_000 });
    expect(h.comparisons).toHaveLength(500);
    expect(h.months.length).toBeGreaterThan(100);
  });

  it("never puts a username anywhere in the result (canary)", () => {
    const canary = "zq_canary_username_7f3a91";
    const h = run({
      friends: [fr(canary, at(2025, 1)), fr(canary.toUpperCase(), at(2025, 2)), fr("another_canary_qq", at(2025, 2))],
      deletedFriends: [del("gone_canary_zz", at(2024, 1), at(2025, 2)), del(canary + "_x", undefined, undefined)],
      ledger: ledgerOf(snap("s1", at(2025, 1), [canary, "gone_canary_zz"]), snap("s2", at(2025, 3), names(60))),
    });
    const text = JSON.stringify(h).toLowerCase();
    for (const name of [canary, "another_canary_qq", "gone_canary_zz", "canary"]) expect(text).not.toContain(name.toLowerCase());
    // Notes carry only numbers.
    for (const n of h.notes) for (const v of Object.values(n.params)) expect(typeof v).toBe("number");
  });
});

describe("with the synthetic export", () => {
  it("builds a history from the built-in pair and leaks no canary or username", () => {
    const now = Date.UTC(2025, 5, 1, 12);
    const parsed1 = parseExportZip(syntheticExportZip({ now, phase: 1 }));
    const parsed2 = parseExportZip(syntheticExportZip({ now, phase: 2 }));
    const ledger = addSnapshot(addSnapshot(emptyLedger(), snapshotFromExport(parsed1)), snapshotFromExport(parsed2));
    const h = buildFriendCountHistory({ friends: parsed2.friends.friends, deletedFriends: parsed2.friends.deletedFriends, ledger, now });

    expect(h.comparisons).toHaveLength(2);
    expect(h.months.length).toBeGreaterThan(0);
    expect(h.months.at(-1)!.month).toBe("2025-06");
    expect(h.totals.currentCount).toBe(h.totals.startingCount + h.totals.net);

    const text = JSON.stringify(h);
    for (const list of Object.values(CANARIES)) for (const c of list) expect(text).not.toContain(c);
    for (const rec of [...parsed2.friends.friends, ...parsed2.friends.deletedFriends]) expect(text).not.toContain(rec.username);
  });
});
