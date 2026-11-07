import { describe, expect, it } from "vitest";
import { DEFAULT_CLOSEST_FADING_SETTINGS, findClosestAndFading } from "../../src/insights/closest-fading.ts";
import type { ClosestFadingInput } from "../../src/insights/closest-fading.ts";
import { parseExportFiles } from "../../src/export/parse.ts";
import { buildSyntheticExport } from "../../src/testing/synthetic-export.ts";
import { DAY_MS } from "../../src/util.ts";
import type { ChatEvent } from "../../src/types.ts";

const NOW = Date.UTC(2026, 5, 1);

const ev = (conversation: string, daysAgo: number, extra: Partial<ChatEvent> = {}): ChatEvent => ({
  conversation,
  isGroup: false,
  direction: "received",
  kind: "TEXT",
  at: NOW - daysAgo * DAY_MS,
  ...extra,
});

/** n events for one person spread evenly over [fromDays, toDays] days ago. */
const spread = (who: string, n: number, fromDays: number, toDays: number, extra: Partial<ChatEvent> = {}): ChatEvent[] =>
  Array.from({ length: n }, (_, i) => ev(who, fromDays + ((toDays - fromDays) * i) / Math.max(1, n - 1), extra));

const input = (friends: string[], chats: ChatEvent[], extra: Partial<ClosestFadingInput> = {}): ClosestFadingInput => ({
  friends: { friends: friends.map((username) => ({ username })) },
  chats,
  ...extra,
});

describe("findClosestAndFading: closest", () => {
  it("returns empty lists and a note for no data", () => {
    const r = findClosestAndFading(input([], []), { now: NOW });
    expect(r.closest).toEqual([]);
    expect(r.fading).toEqual([]);
    expect(r.notes).toEqual([{ code: "no-activity-data", params: {} }]);
    expect(r.counts).toEqual({ friends: 0, withRecentActivity: 0, eventsUsed: 0 });
    expect(r.basis).toBe("saved-chats-and-snaps");
  });

  it("notes when every event is a group event", () => {
    const r = findClosestAndFading(input(["a"], [ev("group:abc", 1, { isGroup: true }), ev("group:abd", 2)]), { now: NOW });
    expect(r.closest).toEqual([]);
    expect(r.notes.map((n) => n.code)).toContain("no-one-to-one-activity");
  });

  it("handles one friend with one event (below the minimum, so not listed)", () => {
    const r = findClosestAndFading(input(["a"], [ev("a", 1)]), { now: NOW });
    expect(r.closest).toEqual([]);
    expect(r.counts.withRecentActivity).toBe(1);
    const lowBar = findClosestAndFading(input(["a"], [ev("a", 0)]), { now: NOW, minClosestEvents: 1 });
    expect(lowBar.closest).toHaveLength(1);
    expect(lowBar.closest[0]).toMatchObject({ key: "a", rank: 1, score: 1, relativeScore: 1 });
  });

  it("weights recent events more and counts both directions", () => {
    const chats = [
      ...spread("fresh", 4, 0, 5), // newer events
      ...spread("stale", 4, 70, 85), // same count, older
      ...spread("sender", 3, 0, 3, { direction: "sent" }),
    ];
    const r = findClosestAndFading(input(["fresh", "stale", "sender"], chats), { now: NOW });
    expect(r.closest.map((c) => c.key)).toEqual(["fresh", "sender", "stale"]);
    const sender = r.closest.find((c) => c.key === "sender")!;
    expect(sender.events).toEqual({ total: 3, sent: 3, received: 0, unknown: 0 });
    expect(sender.weighted.received).toBe(0);
    expect(sender.weighted.sent).toBeGreaterThan(2.5);
    expect(r.closest[0]!.rank).toBe(1);
    expect(r.closest[2]!.relativeScore).toBeLessThan(0.5);
  });

  it("exposes components that add up to the score", () => {
    const chats = [
      ev("a", 0, { direction: "sent" }),
      ev("a", 30, { direction: "received" }),
      ev("a", 60, { direction: "unknown" }),
    ];
    const [a] = findClosestAndFading(input(["a"], chats), { now: NOW }).closest;
    expect(a!.weighted).toEqual({ sent: 1, received: 0.5, unknown: 0.25 });
    expect(a!.score).toBe(1.75);
    expect(a!.events).toEqual({ total: 3, sent: 1, received: 1, unknown: 1 });
    expect(a!.lastAt).toBe(NOW);
  });

  it("honors the window, half-life, top count and minimum parameters", () => {
    const chats = [...spread("a", 5, 0, 10), ...spread("b", 5, 0, 20), ...spread("c", 5, 0, 30)];
    const r = findClosestAndFading(input(["a", "b", "c"], chats), { now: NOW, topCount: 2 });
    expect(r.closest.map((c) => c.key)).toEqual(["a", "b"]);
    expect(r.settings.topCount).toBe(2);
    // A 5-day window keeps only events newer than day 5 (day 5 itself is the earlier window).
    const narrow = findClosestAndFading(input(["a", "b", "c"], chats), { now: NOW, windowDays: 5, minClosestEvents: 1 });
    expect(narrow.closest.map((c) => [c.key, c.events.total])).toEqual([["a", 2], ["b", 1], ["c", 1]]);
    const slow = findClosestAndFading(input(["a"], spread("a", 4, 0, 60)), { now: NOW, halfLifeDays: 3000 });
    expect(slow.closest[0]!.score).toBeGreaterThan(3.8);
  });

  it("falls back to defaults for invalid parameters", () => {
    const r = findClosestAndFading(input(["a"], [ev("a", 1)]), { now: NOW, windowDays: -5, halfLifeDays: NaN, topCount: 0 });
    expect(r.settings).toEqual(DEFAULT_CLOSEST_FADING_SETTINGS);
  });

  it("never lets a fractional count setting floor to zero", () => {
    const chats = [ev("quiet", 120), ...spread("busy", 3, 0, 5)];
    const r = findClosestAndFading(input(["quiet", "busy"], chats), { now: NOW, minClosestEvents: 0.5, minEarlierEvents: 0.5, topCount: 0.5 });
    expect(r.settings).toMatchObject({ minClosestEvents: 1, minEarlierEvents: 1, topCount: 1 });
    // "quiet" has no recent events, so it must not be listed with a score of 0 and no time.
    expect(r.closest.map((c) => c.key)).toEqual(["busy"]);
    expect(r.closest.every((c) => c.score > 0 && Number.isFinite(c.lastAt))).toBe(true);
    expect(JSON.stringify(r)).not.toContain("null");
    for (const f of r.fading) expect(Number.isFinite(f.dropFraction)).toBe(true);
  });

  it("merges usernames that differ only by case and skips group events", () => {
    const chats = [ev("Mia_Test", 1), ev("mia_test", 2), ev("MIA_TEST", 3), ev("group:xyz", 1, { isGroup: true })];
    const r = findClosestAndFading(input(["mia_test", "MIA_test", "  Mia_Test "], chats), { now: NOW });
    expect(r.counts.friends).toBe(1);
    expect(r.closest).toHaveLength(1);
    expect(r.closest[0]!.key).toBe("mia_test");
    expect(r.closest[0]!.events.total).toBe(3);
  });

  it("ignores people who are not current friends and reports a count", () => {
    const r = findClosestAndFading(input(["a"], [...spread("a", 3, 0, 5), ...spread("stranger", 9, 0, 5)]), { now: NOW });
    expect(r.closest.map((c) => c.key)).toEqual(["a"]);
    expect(r.notes).toContainEqual({ code: "non-friend-events-ignored", params: { count: 9 } });
  });

  it("ignores future and undated events and reports counts", () => {
    const chats = [
      ...spread("a", 3, 1, 5),
      ev("a", -3), // after now
      { ...ev("a", 0), at: undefined as unknown as number },
      { ...ev("a", 0), at: NaN },
    ];
    const r = findClosestAndFading(input(["a"], chats), { now: NOW });
    expect(r.closest[0]!.events.total).toBe(3);
    expect(r.notes).toContainEqual({ code: "future-events-ignored", params: { count: 1 } });
    expect(r.notes).toContainEqual({ code: "undated-events-ignored", params: { count: 2 } });
  });

  it("measures to the export date when the export is older than now", () => {
    const exportedAt = NOW - 200 * DAY_MS;
    const chats = spread("a", 4, 205, 210);
    const stale = findClosestAndFading(input(["a"], chats, { exportedAt }), { now: NOW });
    expect(stale.closest).toHaveLength(1);
    expect(stale.asOf).toBe(exportedAt);
    expect(stale.notes).toContainEqual({ code: "measured-to-export-date", params: { daysBeforeNow: 200 } });
    // Without the export date the same events are far outside the windows.
    expect(findClosestAndFading(input(["a"], chats), { now: NOW }).closest).toEqual([]);
    // An export date in the future is capped at now.
    expect(findClosestAndFading(input(["a"], chats, { exportedAt: NOW + DAY_MS }), { now: NOW }).asOf).toBe(NOW);
  });

  it("returns a note and nothing else for a non-finite now", () => {
    const r = findClosestAndFading(input(["a"], [ev("a", 1)]), { now: NaN });
    expect(r.notes).toEqual([{ code: "invalid-reference-time", params: {} }]);
    expect(r.closest).toEqual([]);
  });

  it("ignores an invalid export date and only flags an invalid now", () => {
    const chats = [ev("a", 1), ev("a", 2), ev("a", 3)];
    const r = findClosestAndFading(input(["a"], chats, { exportedAt: NaN }), { now: NOW });
    expect(r.asOf).toBe(NOW);
    expect(r.notes.map((n) => n.code)).not.toContain("invalid-reference-time");
    expect(r.closest).toHaveLength(1);
    const inf = findClosestAndFading(input(["a"], chats, { exportedAt: Infinity }), { now: NOW });
    expect(inf.asOf).toBe(NOW);
    expect(inf.closest).toHaveLength(1);
  });

  it("breaks ties by event count, then username, whatever the input order", () => {
    const chats = [...spread("zed", 3, 4, 4), ...spread("amy", 3, 4, 4), ...spread("bob", 3, 4, 4)];
    const names = ["zed", "amy", "bob"];
    const a = findClosestAndFading(input(names, chats), { now: NOW });
    const b = findClosestAndFading(input([...names].reverse(), [...chats].reverse()), { now: NOW });
    expect(a.closest.map((c) => c.key)).toEqual(["amy", "bob", "zed"]);
    expect(b).toEqual(a);
  });
});

describe("findClosestAndFading: fading", () => {
  it("flags a friend whose volume fell a lot and sorts by the size of the drop", () => {
    const chats = [
      ...spread("gone", 12, 100, 170), // none recent
      ...spread("slump", 10, 95, 170),
      ...spread("slump", 3, 0, 80),
      ...spread("steady", 10, 95, 170),
      ...spread("steady", 10, 0, 80),
      ...spread("tiny", 3, 100, 170), // too little earlier activity to judge
    ];
    const r = findClosestAndFading(input(["gone", "slump", "steady", "tiny"], chats), { now: NOW });
    expect(r.fading.map((f) => f.key)).toEqual(["gone", "slump"]);
    expect(r.fading[0]).toMatchObject({ earlierEvents: 12, recentEvents: 0, dropFraction: 1, stopped: true });
    expect(r.fading[1]).toMatchObject({ earlierEvents: 10, recentEvents: 3, dropFraction: 0.7, stopped: false });
    expect(r.fading[0]!.lastAt).toBeLessThan(NOW - 90 * DAY_MS);
  });

  it("uses the thresholds as parameters", () => {
    const chats = [...spread("a", 10, 95, 170), ...spread("a", 6, 0, 80)]; // drop of 0.4
    expect(findClosestAndFading(input(["a"], chats), { now: NOW }).fading).toEqual([]);
    expect(findClosestAndFading(input(["a"], chats), { now: NOW, minDropFraction: 0.4 }).fading).toHaveLength(1);
    expect(findClosestAndFading(input(["a"], chats), { now: NOW, minDropFraction: 0.4, minEarlierEvents: 11 }).fading).toEqual([]);
  });

  it("flags a drop of exactly the threshold and an earlier count of exactly the minimum", () => {
    const earlier = (n: number) => spread("a", n, 95, 170);
    const recent = (n: number) => spread("a", n, 0, 80);
    // 10 earlier, 4 recent: a drop of exactly 0.6 is listed; 5 recent (0.5) is not.
    const atDrop = findClosestAndFading(input(["a"], [...earlier(10), ...recent(4)]), { now: NOW });
    expect(atDrop.fading).toHaveLength(1);
    expect(atDrop.fading[0]).toMatchObject({ earlierEvents: 10, recentEvents: 4, dropFraction: 0.6 });
    expect(findClosestAndFading(input(["a"], [...earlier(10), ...recent(5)]), { now: NOW }).fading).toEqual([]);
    // Exactly 8 earlier events (the default minimum) is listed; 7 is not.
    expect(findClosestAndFading(input(["a"], earlier(8)), { now: NOW }).fading).toHaveLength(1);
    expect(findClosestAndFading(input(["a"], earlier(7)), { now: NOW }).fading).toEqual([]);
  });

  it("does not flag friends who grew, and ignores events older than both windows", () => {
    const chats = [...spread("up", 9, 100, 170), ...spread("up", 20, 0, 80), ...spread("old", 30, 200, 400)];
    const r = findClosestAndFading(input(["up", "old"], chats), { now: NOW });
    expect(r.fading).toEqual([]);
    expect(r.counts.eventsUsed).toBe(29);
  });

  it("notes when the history starts inside the earlier window", () => {
    const r = findClosestAndFading(input(["a"], spread("a", 5, 0, 120)), { now: NOW });
    expect(r.notes.map((n) => n.code)).toContain("history-starts-inside-earlier-window");
    const covered = findClosestAndFading(input(["a"], [...spread("a", 5, 0, 120), ev("a", 400)]), { now: NOW });
    expect(covered.notes.map((n) => n.code)).not.toContain("history-starts-inside-earlier-window");
    // Old events with someone who is not a friend do not hide the note.
    const stranger = findClosestAndFading(input(["a"], [...spread("a", 5, 0, 120), ev("stranger", 400)]), { now: NOW });
    expect(stranger.notes.map((n) => n.code)).toContain("history-starts-inside-earlier-window");
  });

  it("puts events exactly on a window edge in the right window", () => {
    const chats = [ev("a", 0), ev("a", 90), ev("a", 180), ev("a", 90.0001)];
    const r = findClosestAndFading(input(["a"], chats), { now: NOW, minClosestEvents: 1, minEarlierEvents: 1, minDropFraction: 0.1 });
    // Day 0 is recent; day 90 is the earlier window's newest edge; day 180 falls outside both.
    expect(r.closest[0]!.events.total).toBe(1);
    expect(r.counts.eventsUsed).toBe(3);
  });
});

describe("findClosestAndFading: scale and synthetic data", () => {
  it("handles 10,000+ events and friends quickly with a stable result", () => {
    const names = Array.from({ length: 2000 }, (_, i) => `friend_${i}`);
    const chats: ChatEvent[] = [];
    for (let i = 0; i < 30000; i++) chats.push(ev(names[i % names.length]!, (i * 7) % 200, { direction: i % 3 === 0 ? "sent" : "received" }));
    const t0 = performance.now();
    const r = findClosestAndFading(input(names, chats), { now: NOW });
    expect(performance.now() - t0).toBeLessThan(5000); // loose: shared machines can be slow, a quadratic loop would take far longer
    expect(r.closest).toHaveLength(10);
    expect(r.counts.friends).toBe(2000);
    expect(findClosestAndFading(input(names, [...chats].reverse()), { now: NOW })).toEqual(r);
  });

  it("works on a parsed synthetic export", () => {
    const exportedAt = NOW;
    const parsed = parseExportFiles(buildSyntheticExport({ now: exportedAt, friendCount: 60, chatMessageCount: 3000 }));
    const r = findClosestAndFading(parsed, { now: NOW });
    expect(r.closest.length).toBeGreaterThan(0);
    expect(r.closest.every((c) => c.score > 0)).toBe(true);
    for (let i = 1; i < r.closest.length; i++) expect(r.closest[i - 1]!.score).toBeGreaterThanOrEqual(r.closest[i]!.score);
    expect(findClosestAndFading(parsed, { now: NOW })).toEqual(r);
  });
});

describe("findClosestAndFading: privacy", () => {
  it("lists the canary username only in rows and never in notes, settings or codes", () => {
    const canary = "zqcanary_user_9";
    const chats = [
      ...spread(canary, 5, 0, 20),
      ...spread("fader_one", 12, 100, 170),
      ev("stranger_zqcanary_user_9x", 1),
      ev(canary, -4),
      { ...ev(canary, 0), at: NaN },
    ];
    const r = findClosestAndFading(input([canary, "fader_one"], chats), { now: NOW });
    const { closest, fading, ...rest } = r;
    expect(closest.map((c) => c.key)).toEqual([canary]);
    expect(rest.notes.length).toBeGreaterThan(0);
    expect(JSON.stringify(rest).toLowerCase()).not.toContain("zqcanary");
    expect(JSON.stringify(rest.notes)).not.toContain("fader_one");
    expect(JSON.stringify(fading)).not.toContain("zqcanary");
    for (const n of r.notes) {
      expect(n.code).toMatch(/^[a-z-]+$/);
      expect(Object.values(n.params).every((v) => typeof v === "number")).toBe(true);
    }
  });
});
