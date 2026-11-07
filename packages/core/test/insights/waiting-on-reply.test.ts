import { describe, expect, it } from "vitest";
import { WAITING_DEFAULTS, findWaitingOnReply } from "../../src/insights/waiting-on-reply.ts";
import type { WaitingNote } from "../../src/insights/waiting-on-reply.ts";
import { parseExportZip } from "../../src/export/parse.ts";
import { syntheticExportZip } from "../../src/testing/synthetic-export.ts";
import { DAY_MS } from "../../src/util.ts";
import type { ChatEvent } from "../../src/types.ts";

const NOW = Date.UTC(2025, 5, 1, 12, 0, 0);

const ev = (
  who: string,
  direction: ChatEvent["direction"],
  daysAgo: number,
  extra: Partial<ChatEvent> = {},
): ChatEvent => ({
  conversation: who,
  isGroup: false,
  direction,
  kind: "TEXT",
  at: NOW - daysAgo * DAY_MS,
  ...extra,
});

const run = (events: ChatEvent[], extra: Record<string, unknown> = {}) =>
  findWaitingOnReply(events, { now: NOW, ...extra });
const code = (notes: WaitingNote[], c: string) => notes.find((n) => n.code === c);

describe("findWaitingOnReply: waiting lists", () => {
  it("handles empty input", () => {
    const r = run([]);
    expect(r.waitingOnYou).toEqual([]);
    expect(r.waitingOnThem).toEqual([]);
    expect(r.oneSided).toEqual([]);
    expect(r.notes).toEqual([{ code: "no-events", params: {} }]);
    expect(r.summary.people).toBe(0);
  });

  it("rejects an unusable now without throwing", () => {
    const r = findWaitingOnReply([ev("a", "received", 5)], { now: Number.NaN });
    expect(r.asOf).toBeNull();
    expect(r.notes).toEqual([{ code: "invalid-now", params: {} }]);
  });

  it("finds one person waiting on you after the default threshold", () => {
    const r = run([ev("amy", "sent", 6), ev("amy", "received", 4)]);
    expect(r.waitingOnYou).toEqual([{ username: "amy", since: NOW - 4 * DAY_MS, days: 4 }]);
    expect(r.waitingOnThem).toEqual([]);
  });

  it("does not list a received message that is younger than the threshold", () => {
    expect(run([ev("amy", "received", 2)]).waitingOnYou).toEqual([]);
    expect(run([ev("amy", "received", WAITING_DEFAULTS.waitingOnYouDays)]).waitingOnYou).toHaveLength(1);
  });

  it("finds one person you are waiting on, with its own threshold", () => {
    expect(run([ev("bo", "sent", 6)]).waitingOnThem).toEqual([]);
    const r = run([ev("bo", "received", 9), ev("bo", "sent", 8)]);
    expect(r.waitingOnThem).toEqual([{ username: "bo", since: NOW - 8 * DAY_MS, days: 8 }]);
    expect(r.waitingOnYou).toEqual([]);
  });

  it("is not waiting once the other side answers", () => {
    const r = run([ev("cy", "received", 10), ev("cy", "sent", 9), ev("cy", "received", 8), ev("cy", "sent", 0)]);
    expect(r.waitingOnYou).toEqual([]);
    expect(r.waitingOnThem).toEqual([]);
  });

  it("merges names that differ only by case, and ignores input order", () => {
    const events = [ev("Dee", "received", 5), ev("dee", "sent", 20), ev("DEE", "received", 9)];
    const a = run(events);
    const b = run([...events].reverse());
    expect(a).toEqual(b);
    expect(a.waitingOnYou).toEqual([{ username: "dee", since: NOW - 5 * DAY_MS, days: 5 }]);
    expect(a.summary.people).toBe(1);
  });

  it("never counts unknown direction as either side", () => {
    // Newest event is unknown: who spoke last cannot be told.
    const r = run([ev("eli", "received", 30), ev("eli", "unknown", 10)]);
    expect(r.waitingOnYou).toEqual([]);
    expect(r.waitingOnThem).toEqual([]);
    expect(code(r.notes, "people-last-direction-unknown")?.params).toEqual({ count: 1 });
    // Older unknown events do not hide a clear last direction.
    const r2 = run([ev("eli", "unknown", 40), ev("eli", "received", 30)]);
    expect(r2.waitingOnYou).toHaveLength(1);
    // Only unknown events.
    const r3 = run([ev("fay", "unknown", 30)]);
    expect(r3.summary.people).toBe(1);
    expect(r3.waitingOnYou.length + r3.waitingOnThem.length).toBe(0);
  });

  it("skips a tie between sent and received at the same instant", () => {
    const r = run([ev("gus", "sent", 10), ev("gus", "received", 10)]);
    expect(r.waitingOnYou).toEqual([]);
    expect(r.waitingOnThem).toEqual([]);
    expect(code(r.notes, "people-last-event-tied")?.params).toEqual({ count: 1 });
  });

  it("leaves out group chats and counts them", () => {
    const r = run([
      ev("group:abc123", "received", 20, { isGroup: true }),
      ev("group:def456", "received", 20), // flag missing, key still marks it
      ev("hal", "received", 20),
    ]);
    expect(r.waitingOnYou.map((p) => p.username)).toEqual(["hal"]);
    expect(code(r.notes, "group-events-skipped")?.params).toEqual({ count: 2 });
    const only = run([ev("group:abc123", "received", 20, { isGroup: true })]);
    expect(code(only.notes, "no-one-to-one-events")).toBeDefined();
  });

  it("ignores events with missing or non-finite timestamps and counts them", () => {
    const bad = [
      { ...ev("ivy", "received", 0), at: undefined as unknown as number },
      { ...ev("ivy", "received", 0), at: Number.NaN },
      { ...ev("ivy", "received", 0), at: Infinity },
    ];
    const r = run([...bad, ev("ivy", "sent", 20)]);
    expect(code(r.notes, "events-without-time")?.params).toEqual({ count: 3 });
    expect(r.waitingOnThem).toEqual([{ username: "ivy", since: NOW - 20 * DAY_MS, days: 20 }]);
    expect(run(bad).summary.people).toBe(0);
  });

  it("ignores events dated after now and counts them", () => {
    const r = run([ev("jon", "sent", 20), ev("jon", "received", -3)]);
    expect(code(r.notes, "events-in-future")?.params).toEqual({ count: 1 });
    expect(r.waitingOnThem).toHaveLength(1);
    expect(r.waitingOnYou).toEqual([]);
  });

  it("measures up to the export time when it is earlier than now", () => {
    const exportedAt = NOW - 100 * DAY_MS;
    const events = [ev("kim", "received", 104), ev("kim", "received", 95)];
    const r = run(events, { exportedAt });
    expect(r.asOf).toBe(exportedAt);
    // The 95 days ago event is after the export time, so it is ignored as "future".
    expect(r.waitingOnYou).toEqual([{ username: "kim", since: NOW - 104 * DAY_MS, days: 4 }]);
    expect(code(r.notes, "events-in-future")?.params).toEqual({ count: 1 });
  });

  it("drops very old waits from the lists and counts them", () => {
    const r = run([ev("lou", "received", 400), ev("mia", "received", 60)]);
    expect(r.waitingOnYou.map((p) => p.username)).toEqual(["mia"]);
    expect(code(r.notes, "people-wait-too-old")?.params).toEqual({ count: 1 });
    expect(run([ev("lou", "received", 400)], { maxWaitDays: 1000 }).waitingOnYou).toHaveLength(1);
  });

  it("limits the result to current friends when given", () => {
    const events = [ev("ned", "received", 10), ev("oli", "received", 10)];
    const r = run(events, { friends: ["NED"] });
    expect(r.waitingOnYou.map((p) => p.username)).toEqual(["ned"]);
    expect(code(r.notes, "people-not-in-friends")?.params).toEqual({ count: 1 });
  });

  it("orders by longest wait, then username", () => {
    const r = run([
      ev("zed", "received", 10),
      ev("abe", "received", 10),
      ev("mo", "received", 30),
      ev("kit", "received", 5),
    ]);
    expect(r.waitingOnYou.map((p) => p.username)).toEqual(["mo", "abe", "zed", "kit"]);
  });

  it("falls back to defaults for unusable thresholds", () => {
    const r = run([ev("pam", "received", 5)], { waitingOnYouDays: Number.NaN });
    expect(r.waitingOnYou).toHaveLength(1);
    expect(run([ev("pam", "received", 5)], { waitingOnYouDays: 10 }).waitingOnYou).toEqual([]);
  });
});

describe("findWaitingOnReply: one-sided chats", () => {
  const many = (who: string, sent: number, received: number, unknown = 0, daysAgo = 10): ChatEvent[] => [
    ...Array.from({ length: sent }, (_, i) => ev(who, "sent", daysAgo + i * 0.01)),
    ...Array.from({ length: received }, (_, i) => ev(who, "received", daysAgo + i * 0.01 + 0.005)),
    ...Array.from({ length: unknown }, (_, i) => ev(who, "unknown", daysAgo + i * 0.01 + 0.002)),
  ];

  it("flags a chat where you send nearly everything", () => {
    const r = run(many("quin", 18, 2));
    expect(r.oneSided).toEqual([
      { username: "quin", dominant: "you", sent: 18, received: 2, unknown: 0, share: 0.9 },
    ]);
  });

  it("flags a chat where they send nearly everything", () => {
    const r = run(many("rex", 1, 19));
    expect(r.oneSided[0]).toMatchObject({ username: "rex", dominant: "them", share: 0.95 });
  });

  it("does not flag balanced chats, too-small chats or a share below the ratio", () => {
    expect(run(many("a", 10, 10)).oneSided).toEqual([]);
    expect(run(many("b", 8, 0)).oneSided).toEqual([]); // under minEvents
    expect(run(many("c", 16, 4)).oneSided).toEqual([]); // 0.80 < 0.85
    expect(run(many("c", 16, 4), { dominantShare: 0.8 }).oneSided).toHaveLength(1);
  });

  it("only looks inside the window", () => {
    expect(run(many("d", 20, 0, 0, 200)).oneSided).toEqual([]);
    expect(run(many("d", 20, 0, 0, 200), { windowDays: 365 }).oneSided).toHaveLength(1);
  });

  it("keeps unknown events out of both sides and flags unreliable direction", () => {
    const ok = run(many("e", 12, 0, 3));
    expect(ok.oneSided[0]).toMatchObject({ sent: 12, received: 0, unknown: 3 });
    const bad = run(many("f", 12, 0, 40));
    expect(bad.oneSided).toEqual([]);
    expect(code(bad.notes, "people-one-sided-direction-unreliable")?.params).toEqual({ count: 1 });
    // Only unknown events never makes a one-sided chat.
    expect(run(many("g", 0, 0, 50)).oneSided).toEqual([]);
  });

  it("orders by share, then volume, then username", () => {
    const r = run([
      ...many("zoe", 19, 1),
      ...many("amy", 19, 1),
      ...many("bob", 30, 1),
      ...many("cat", 50, 0),
    ]);
    expect(r.oneSided.map((p) => p.username)).toEqual(["cat", "bob", "amy", "zoe"]);
  });

  it("ignores group chats", () => {
    const r = run(many("group:xyz", 30, 0).map((e) => ({ ...e, isGroup: true })));
    expect(r.oneSided).toEqual([]);
  });
});

describe("findWaitingOnReply: scale, determinism and privacy", () => {
  it("handles 10,000+ people and 100,000+ events fast, deterministically", () => {
    const events: ChatEvent[] = [];
    for (let i = 0; i < 12_000; i++) {
      const who = `person_${String(i).padStart(5, "0")}`;
      events.push(ev(who, "received", 5 + (i % 40)));
      events.push(ev(who, i % 3 === 0 ? "sent" : "received", 50 + (i % 7)));
      for (let k = 0; k < 8; k++) events.push(ev(who, "sent", 60 + k));
    }
    const t0 = performance.now();
    const a = run(events);
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(3000);
    expect(a.summary.people).toBe(12_000);
    expect(a.waitingOnYou.length).toBeGreaterThan(10_000);
    expect(run([...events].reverse())).toEqual(a);
  });

  it("is a pure function of its inputs", () => {
    const events = [ev("sam", "received", 9), ev("tom", "sent", 12)];
    const copy = JSON.stringify(events);
    expect(run(events)).toEqual(run(events));
    expect(JSON.stringify(events)).toBe(copy);
  });

  it("puts a canary username only in the rows that list people, never in notes", () => {
    const canary = "zqcanary_waiting_user";
    const events: ChatEvent[] = [
      ev(canary, "received", 20),
      ev(canary, "unknown", 1),
      ev(`${canary}_b`, "received", 20),
      ev(`${canary}_c`, "sent", 20),
      ev(`${canary}_c`, "received", 20),
      ev(`${canary}_d`, "sent", 20, { at: Number.NaN }),
      ev(`${canary}_e`, "sent", -5),
      ev(`${canary}_f`, "sent", 400),
      ev("group:" + canary, "sent", 5, { isGroup: true }),
      ...Array.from({ length: 12 }, () => ev(`${canary}_g`, "sent", 10)),
    ];
    const r = run(events, { friends: [canary, `${canary}_b`, `${canary}_c`, `${canary}_f`, `${canary}_g`] });
    expect(r.notes.length).toBeGreaterThan(3);
    expect(JSON.stringify(r.notes)).not.toContain(canary);
    expect(JSON.stringify(r.summary)).not.toContain(canary);
    for (const n of r.notes) {
      expect(Object.keys(n).sort()).toEqual(["code", "params"]);
      for (const v of Object.values(n.params)) expect(typeof v).toBe("number");
      expect(n.code).toMatch(/^[a-z-]+$/);
    }
    // People appear only in explicit rows.
    expect(JSON.stringify(r.waitingOnYou)).toContain(`${canary}_b`);
    const rowless = { ...r, waitingOnYou: [], waitingOnThem: [], oneSided: [] };
    expect(JSON.stringify(rowless)).not.toContain(canary);
  });

  it("works on a built-in synthetic export", () => {
    const parsed = parseExportZip(syntheticExportZip({ now: NOW, seed: 7, friendCount: 40 }));
    const r = findWaitingOnReply(parsed.chats, {
      now: NOW,
      friends: parsed.friends.friends.map((f) => f.username),
    });
    expect(r.summary.people).toBeGreaterThan(0);
    const again = findWaitingOnReply(parsed.chats, {
      now: NOW,
      friends: parsed.friends.friends.map((f) => f.username),
    });
    expect(again).toEqual(r);
    for (const row of [...r.waitingOnYou, ...r.waitingOnThem]) expect(row.days).toBeGreaterThanOrEqual(3);
  });
});
