import { describe, expect, it } from "vitest";
import type { ChatEvent, Snapshot } from "../../src/types.ts";
import { SINCE_LAST_DEFAULTS, sinceLastExport } from "../../src/insights/since-last-export.ts";
import type { SinceLastExport, SinceLastExportInput, SinceNote } from "../../src/insights/since-last-export.ts";
import { snapshotFromExport } from "../../src/ledger/ledger.ts";
import { parseExportZip } from "../../src/export/parse.ts";
import { CANARIES, syntheticExportZip } from "../../src/testing/synthetic-export.ts";
import { DAY_MS } from "../../src/util.ts";

const NOW = Date.UTC(2025, 5, 15, 12); // Jun 15, 2025
const PREV = Date.UTC(2025, 2, 1, 12); // Mar 1, 2025
const CUR = Date.UTC(2025, 4, 1, 12); // May 1, 2025 (61 days later)

const snap = (id: string, takenAt: number, friends: string[], extra: Partial<Snapshot> = {}): Snapshot => ({
  id, takenAt, source: "export", friends, sentRequests: [], deleted: {}, friendSince: {}, sentAt: {}, ...extra,
});
const run = (p: Partial<SinceLastExportInput> = {}): SinceLastExport =>
  sinceLastExport({ previous: snap("p", PREV, []), current: snap("c", CUR, []), now: NOW, ...p });
const names = (rows: { username: string }[] | undefined) => rows?.map((r) => r.username);
const note = (r: SinceLastExport, code: string): SinceNote | undefined => r.notes.find((n) => n.code === code);
const codes = (r: SinceLastExport) => r.notes.map((n) => n.code);
const ev = (direction: string, at: number) => ({ direction, at });

describe("sinceLastExport: friends", () => {
  it("handles two empty snapshots", () => {
    const r = run();
    expect(r.comparable).toBe(true);
    expect(r.friends).toEqual({ previousCount: 0, currentCount: 0, net: 0, added: [], disappeared: [], removedByYou: [], blockedByYou: [] });
    expect(r.requests).toEqual({ accepted: [], stillPending: [], vanished: [] });
    expect(r.memories).toBeNull();
    expect(r.activity).toBeNull();
    expect(codes(r)).toEqual(["no-memories-data", "no-activity-data"]);
  });

  it("lists added and disappeared friends, sorted, with dates", () => {
    const r = run({
      previous: snap("p", PREV, ["zed", "amy", "bob"], { friendSince: { zed: 5, amy: 7 } }),
      current: snap("c", CUR, ["bob", "cat", "dan"], { friendSince: { dan: 9, cat: 8 } }),
    });
    expect(r.friends?.added).toEqual([{ username: "cat", at: 8 }, { username: "dan", at: 9 }]);
    expect(r.friends?.disappeared).toEqual([{ username: "amy", at: 7 }, { username: "zed", at: 5 }]);
    expect(r.friends).toMatchObject({ previousCount: 3, currentCount: 3, net: 0 });
    expect(r.counts).toMatchObject({ added: 2, disappeared: 2, removedByYou: 0 });
    expect(note(r, "friends-may-have-left")).toEqual({ code: "friends-may-have-left", params: { count: 2 } });
  });

  it("handles one friend gained and one lost", () => {
    expect(names(run({ current: snap("c", CUR, ["a"]) }).friends?.added)).toEqual(["a"]);
    expect(names(run({ previous: snap("p", PREV, ["a"]) }).friends?.disappeared)).toEqual(["a"]);
  });

  it("treats case-different duplicates as one person", () => {
    const r = run({
      previous: snap("p", PREV, ["Amy", "amy", " AMY "], { friendSince: { Amy: 9, amy: 4 } }),
      current: snap("c", CUR, ["AMY", "Bob", "bob"]),
    });
    expect(r.friends).toMatchObject({ previousCount: 1, currentCount: 2 });
    expect(names(r.friends?.added)).toEqual(["bob"]);
    expect(r.friends?.disappeared).toEqual([]);
  });

  it("splits out people you removed, with the deletion date, and people you blocked", () => {
    const r = run({
      previous: snap("p", PREV, ["gone", "mine", "blocked"]),
      current: snap("c", CUR, [], { deleted: { MINE: 123 }, blocked: ["Blocked"] }),
    });
    expect(names(r.friends?.disappeared)).toEqual(["gone"]);
    expect(r.friends?.removedByYou).toEqual([{ username: "mine", at: 123 }]);
    expect(names(r.friends?.blockedByYou)).toEqual(["blocked"]);
    expect(note(r, "blocked-excluded")?.params).toEqual({ count: 1 });
    expect(r.counts.disappeared).toBe(1);
  });

  it("uses snapshots in between to explain deletions and blocks", () => {
    const r = run({
      previous: snap("p", PREV, ["a", "b"]),
      current: snap("c", CUR, []),
      between: [snap("m", PREV + DAY_MS, ["a", "b"], { deleted: { a: null }, blocked: ["b"] })],
    });
    expect(r.friends?.disappeared).toEqual([]);
    expect(r.friends?.removedByYou).toEqual([{ username: "a", at: null }]);
    expect(names(r.friends?.blockedByYou)).toEqual(["b"]);
  });

  it("does not mistake names like constructor for properties", () => {
    const r = run({
      previous: snap("p", PREV, ["constructor"]),
      current: snap("c", CUR, ["tostring"], { friendSince: Object.fromEntries([["tostring", 3]]) }),
    });
    expect(r.friends?.disappeared).toEqual([{ username: "constructor", at: null }]);
    expect(r.friends?.added).toEqual([{ username: "tostring", at: 3 }]);
  });

  it("pins the partial export thresholds on both sides", () => {
    const list = (n: number) => Array.from({ length: n }, (_, i) => `f${i}`);
    const lose = (total: number, lost: number) =>
      note(run({ previous: snap("p", PREV, list(total)), current: snap("c", CUR, list(total).slice(lost)) }), "possible-partial-export");
    expect(SINCE_LAST_DEFAULTS.massShare).toBe(0.5);
    expect(lose(9, 8)).toBeUndefined(); // below the minimum list size
    expect(lose(10, 6)?.params).toEqual({ count: 6, previous: 10 });
    expect(lose(10, 5)).toBeUndefined(); // exactly half
    expect(lose(11, 6)?.params).toEqual({ count: 6, previous: 11 }); // just over half
    expect(lose(11, 5)).toBeUndefined();
  });

  it("notes a possible partial export when more than half of a real list vanishes", () => {
    const many = Array.from({ length: 12 }, (_, i) => `f${i}`);
    const r = run({ previous: snap("p", PREV, many), current: snap("c", CUR, many.slice(0, 4)) });
    expect(note(r, "possible-partial-export")?.params).toEqual({ count: 8, previous: 12 });
    // exactly half is not "more than half", and a tiny list never triggers it
    expect(note(run({ previous: snap("p", PREV, many.slice(0, 10)), current: snap("c", CUR, many.slice(0, 5)) }), "possible-partial-export")).toBeUndefined();
    expect(note(run({ previous: snap("p", PREV, ["a", "b", "c"]) }), "possible-partial-export")).toBeUndefined();
    expect(SINCE_LAST_DEFAULTS.massMinFriends).toBe(10);
  });
});

describe("sinceLastExport: requests", () => {
  it("separates accepted, still pending and vanished requests", () => {
    const r = run({
      previous: snap("p", PREV, ["old"], { sentRequests: ["acc", "wait", "gone", "old", "deleted"], sentAt: { acc: 1, wait: 2, gone: 3 } }),
      current: snap("c", CUR, ["old", "acc"], { sentRequests: ["wait", "acc"], deleted: { deleted: 1 }, sentAt: { wait: 2 } }),
    });
    expect(r.requests?.accepted).toEqual([{ username: "acc", at: 1 }]);
    expect(r.requests?.stillPending).toEqual([{ username: "wait", at: 2 }]);
    expect(r.requests?.vanished).toEqual([{ username: "gone", at: 3 }]);
    expect(r.counts).toMatchObject({ requestsAccepted: 1, requestsPending: 1 });
    expect(note(r, "requests-may-be-declined")?.params).toEqual({ count: 1 });
  });

  it("does not count a friend echoed in the sent list as a request", () => {
    const r = run({
      previous: snap("p", PREV, ["a"], { sentRequests: ["a"] }),
      current: snap("c", CUR, ["a"], { sentRequests: ["a"] }),
    });
    expect(r.requests).toEqual({ accepted: [], stillPending: [], vanished: [] });
  });
});

describe("sinceLastExport: time", () => {
  it("counts calendar days, including a leap day", () => {
    const days = (a: number, b: number) => run({ previous: snap("p", a, []), current: snap("c", b, []) }).daysBetween;
    expect(days(Date.UTC(2024, 1, 28, 12), Date.UTC(2024, 2, 1, 12))).toBe(2);
    expect(days(Date.UTC(2025, 1, 28, 12), Date.UTC(2025, 2, 1, 12))).toBe(1);
    expect(run().daysBetween).toBe(61);
  });

  it("measures days in the caller's offset", () => {
    const a = Date.UTC(2025, 0, 1, 23, 30);
    const b = Date.UTC(2025, 0, 2, 0, 30);
    const at = (utcOffsetMinutes?: number) =>
      run({ previous: snap("p", a, []), current: snap("c", b, []), ...(utcOffsetMinutes === undefined ? {} : { utcOffsetMinutes }) });
    expect(at().daysBetween).toBe(1);
    expect(at(-300).daysBetween).toBe(0);
    expect(note(at(-300), "same-day")).toBeDefined();
    expect(at(60).daysBetween).toBe(0); // 00:30 and 01:30 on Jan 2
    expect(at(Number.NaN).daysBetween).toBe(1);
    expect(at(99999).daysBetween).toBe(0); // clamped to +14:00: Jan 2 13:30 and 14:30
    expect(at(-99999).daysBetween).toBe(0); // clamped to -12:00: Jan 1 11:30 and 12:30
  });

  it("applies the offset in the right direction", () => {
    const days = (a: number, b: number, utcOffsetMinutes: number) =>
      run({ previous: snap("p", a, []), current: snap("c", b, []), utcOffsetMinutes }).daysBetween;
    // 20:00Z and 22:00Z on Jan 1: three hours east they straddle local midnight, three hours west they do not
    const a = Date.UTC(2025, 0, 1, 20);
    const b = Date.UTC(2025, 0, 1, 22);
    expect(days(a, b, 180)).toBe(1);
    expect(days(a, b, -180)).toBe(0);
    // 02:00Z and 04:00Z on Jan 1: the mirror image
    const c = Date.UTC(2025, 0, 1, 2);
    const d = Date.UTC(2025, 0, 1, 4);
    expect(days(c, d, -180)).toBe(1);
    expect(days(c, d, 180)).toBe(0);
    // fractional offsets round to whole minutes: 239.6 becomes 240 (20:00Z is local midnight), 239.4 becomes 239
    expect(days(a, b, 240)).toBe(0);
    expect(days(a, b, 239.6)).toBe(0);
    expect(days(a, b, 239.4)).toBe(1);
  });

  it("swaps a previous snapshot that is newer, and says so", () => {
    const r = run({ previous: snap("p", CUR, ["a"]), current: snap("c", PREV, ["a", "b"]) });
    expect(r.previousAt).toBe(PREV);
    expect(r.currentAt).toBe(CUR);
    expect(r.daysBetween).toBe(61);
    expect(names(r.friends?.disappeared)).toEqual(["b"]);
    expect(codes(r)).toContain("order-swapped");
  });

  it("handles identical times without measuring a period", () => {
    const r = run({ previous: snap("p", CUR, ["a"]), current: snap("c", CUR, ["a", "b"]), events: [ev("sent", CUR)] });
    expect(r.daysBetween).toBe(0);
    expect(r.activity).toBeNull();
    expect(codes(r)).toContain("same-time");
    expect(names(r.friends?.added)).toEqual(["b"]);
  });

  it("notes a long gap and times in the future", () => {
    const r = run({ previous: snap("p", NOW - 400 * DAY_MS, []), current: snap("c", NOW + 5 * DAY_MS, []) });
    expect(note(r, "long-gap")?.params).toEqual({ days: 405 });
    expect(note(r, "snapshot-time-in-future")?.params).toEqual({ count: 1 });
  });

  it("notes a long gap from exactly 180 days, not before", () => {
    const gap = (days: number) => run({ previous: snap("p", PREV, []), current: snap("c", PREV + days * DAY_MS, []) });
    expect(SINCE_LAST_DEFAULTS.longGapDays).toBe(180);
    expect(note(gap(179), "long-gap")).toBeUndefined();
    expect(note(gap(180), "long-gap")?.params).toEqual({ days: 180 });
    expect(note(gap(181), "long-gap")?.params).toEqual({ days: 181 });
  });

  it("counts every snapshot time after now", () => {
    const at = (previous: number, current: number) => run({ previous: snap("p", previous, []), current: snap("c", current, []) });
    const future = NOW + DAY_MS;
    expect(note(at(PREV, CUR), "snapshot-time-in-future")).toBeUndefined();
    expect(note(at(PREV, NOW), "snapshot-time-in-future")).toBeUndefined(); // exactly now is not the future
    expect(note(at(PREV, future), "snapshot-time-in-future")?.params).toEqual({ count: 1 });
    expect(note(at(future, future + DAY_MS), "snapshot-time-in-future")?.params).toEqual({ count: 2 });
    expect(note(at(future, PREV), "snapshot-time-in-future")?.params).toEqual({ count: 1 }); // swapped order
  });

  it("has nothing to compare on a first export or without a usable time", () => {
    const first = sinceLastExport({ current: snap("c", CUR, ["a"]), now: NOW });
    expect(first.comparable).toBe(false);
    expect(first.friends).toBeNull();
    expect(first.currentAt).toBe(CUR);
    expect(first.counts.added).toBeNull();
    expect(codes(first)).toEqual(["no-previous-export"]);
    const bad = run({ current: snap("c", Number.NaN, []) });
    expect(bad.comparable).toBe(false);
    expect(codes(bad)).toEqual(["unusable-snapshot-time"]);
  });

  it("rejects an unusable now", () => {
    expect(() => run({ now: Number.NaN })).toThrow(TypeError);
  });
});

describe("sinceLastExport: Memories", () => {
  it("counts memories captured between the exports", () => {
    const m = (date: number | null | undefined) => ({ date });
    const r = run({
      memories: [m(PREV), m(PREV + 1), m(CUR), m(CUR + 1), m(PREV - DAY_MS), m(null), m(undefined), m(NOW + DAY_MS)],
    });
    expect(r.memories).toEqual({ total: 8, newCount: 2, totalChange: null });
    expect(r.counts.newMemories).toBe(2);
    expect(note(r, "memories-dates-unusable")?.params).toEqual({ undated: 2, future: 1 });
  });

  it("shows the change in the total when the previous total is known", () => {
    const r = run({ memories: [{ date: CUR }, { date: CUR }], previousMemoriesTotal: 5 });
    expect(r.memories).toMatchObject({ total: 2, totalChange: -3 });
    expect(run({ memories: [{ date: CUR }], previousMemoriesTotal: Number.NaN }).memories?.totalChange).toBeNull();
  });

  it("gives no memory result for none", () => {
    const r = run({ memories: [] });
    expect(r.memories).toBeNull();
    expect(r.counts.newMemories).toBeNull();
  });
});

describe("sinceLastExport: activity", () => {
  // span = 61 days: since is (PREV, CUR], earlier is (PREV - 61 days, PREV]
  const early = PREV - 61 * DAY_MS;

  it("compares the period since with the period before it", () => {
    const r = run({
      events: [
        ev("sent", early - DAY_MS), // before both windows: proves history reaches back
        ev("sent", early + 1), ev("received", PREV), ev("received", PREV - DAY_MS), ev("unknown", PREV - 2 * DAY_MS),
        ev("sent", PREV + 1), ev("sent", CUR), ev("sent", CUR - DAY_MS), ev("received", CUR - 2 * DAY_MS), ev("weird", CUR - 3 * DAY_MS),
        ev("sent", CUR + 1), // after the current export: in neither window
      ],
    });
    expect(r.activity).toEqual({
      since: { sent: 3, received: 1, unknown: 1 },
      earlier: { sent: 1, received: 2, unknown: 1 },
      change: { sent: 2, received: -1 },
    });
    expect(r.notes).toEqual([{ code: "no-memories-data", params: {} }]);
  });

  it("excludes an event exactly at the start of the earlier period but counts it as reaching back", () => {
    const r = run({ events: [ev("sent", early), ev("sent", early + 1), ev("received", CUR)] });
    expect(r.activity).toEqual({
      since: { sent: 0, received: 1, unknown: 0 },
      earlier: { sent: 1, received: 0, unknown: 0 },
      change: { sent: -1, received: 1 },
    });
    expect(codes(r)).not.toContain("earlier-period-not-covered");
    expect(run({ events: [ev("sent", early)] }).activity?.earlier).toEqual({ sent: 0, received: 0, unknown: 0 });
    expect(run({ events: [ev("sent", early + 1)] }).activity?.earlier).toBeNull();
  });

  it("withholds activity and Memories when the snapshots had to be swapped", () => {
    const input = {
      previous: snap("p", CUR, ["a"]),
      current: snap("c", PREV, ["a", "b"]),
      events: [ev("sent", early - DAY_MS), ev("sent", PREV + DAY_MS), ev("received", PREV - DAY_MS), ev("sent", NOW + 1)],
      memories: [{ date: PREV + DAY_MS }, { date: null }],
    };
    const r = run(input);
    expect(r.activity).toBeNull();
    expect(r.memories).toBeNull();
    expect(r.counts.newMemories).toBeNull();
    expect(codes(r)).toEqual(["order-swapped", "friends-may-have-left"]);
    expect(names(r.friends?.disappeared)).toEqual(["b"]);
    // the same data in the right order is measured
    const ok = run({ ...input, previous: input.current, current: input.previous });
    expect(ok.activity?.since.sent).toBe(1);
    expect(ok.memories?.newCount).toBe(1);
  });

  it("withholds the comparison when events do not reach back", () => {
    const r = run({ events: [ev("sent", PREV + DAY_MS), ev("received", PREV - DAY_MS)] });
    expect(r.activity).toEqual({ since: { sent: 1, received: 0, unknown: 0 }, earlier: null, change: null });
    expect(codes(r)).toContain("earlier-period-not-covered");
  });

  it("ignores events with a missing or future time and counts them", () => {
    const r = run({
      events: [ev("sent", early - 1), ev("sent", NOW + 1), { direction: "sent", at: null }, { direction: "sent" }, ev("sent", Number.NaN), ev("sent", CUR)],
    });
    expect(r.activity?.since.sent).toBe(1);
    expect(note(r, "unusable-times-ignored")?.params).toEqual({ count: 4 });
  });

  it("handles a single event and no events", () => {
    expect(run({ events: [ev("received", CUR)] }).activity?.since).toEqual({ sent: 0, received: 1, unknown: 0 });
    const none = run({ events: [] });
    expect(none.activity).toBeNull();
    expect(codes(none)).toContain("no-activity-data");
  });

  it("accepts real ChatEvents", () => {
    const chat: ChatEvent = { conversation: "amy", isGroup: false, direction: "sent", kind: "TEXT", at: CUR - DAY_MS };
    expect(run({ events: [chat] }).activity?.since.sent).toBe(1);
  });

  it("is linear enough for 20,000 events and 5,000 friends", () => {
    const friends = Array.from({ length: 5000 }, (_, i) => `f${i}`);
    const events = Array.from({ length: 20000 }, (_, i) => ev(i % 3 === 0 ? "sent" : "received", PREV - 61 * DAY_MS + i * 6_000_000));
    const t0 = Date.now();
    const r = run({ previous: snap("p", PREV, friends), current: snap("c", CUR, friends.slice(100).concat(["n1", "n2"])), events });
    expect(Date.now() - t0).toBeLessThan(1500);
    expect(r.friends?.disappeared).toHaveLength(100);
    expect((r.activity?.since.sent ?? 0) + (r.activity?.since.received ?? 0)).toBeGreaterThan(0);
  });
});

describe("sinceLastExport: determinism and privacy", () => {
  it("gives equal output for equal input, whatever the list order", () => {
    const a = run({ previous: snap("p", PREV, ["c", "a", "b"]), current: snap("c", CUR, ["z", "y"]) });
    const b = run({ previous: snap("p", PREV, ["b", "c", "a"]), current: snap("c", CUR, ["y", "z"]) });
    expect(a).toEqual(b);
  });

  it("keeps usernames out of notes and counts (canary)", () => {
    const secret = "zqcanary-user-name";
    const r = run({
      previous: snap("p", PREV, [secret, "b"], { sentRequests: [secret + "2"] }),
      current: snap("c", CUR, ["b", secret + "3"], { blocked: [secret] }),
      events: [ev("sent", CUR)],
      memories: [{ date: CUR }],
    });
    expect(JSON.stringify([r.notes, r.counts, r.activity, r.memories, r.daysBetween])).not.toContain("zqcanary");
    expect(JSON.stringify(r.friends)).toContain(secret + "3"); // the deliberate rows
  });

  it("works on synthetic exports and never carries content canaries", () => {
    const now = Date.UTC(2025, 5, 1, 12);
    const p1 = parseExportZip(syntheticExportZip({ now, phase: 1 }));
    const p2 = parseExportZip(syntheticExportZip({ now, phase: 2 }));
    const r = sinceLastExport({
      previous: snapshotFromExport(p1),
      current: snapshotFromExport(p2),
      events: p2.chats,
      memories: p2.memories,
      now,
    });
    expect(r.daysBetween).toBe(120);
    expect((r.friends?.added.length ?? 0) + (r.friends?.disappeared.length ?? 0) + (r.friends?.removedByYou.length ?? 0)).toBeGreaterThan(0);
    expect(r.memories?.total).toBeGreaterThan(0);
    expect(r.activity?.since.sent).toBeGreaterThan(0);
    const text = JSON.stringify(r);
    for (const list of Object.values(CANARIES)) for (const c of list) expect(text).not.toContain(c);
  });
});
