import { describe, expect, it } from "vitest";
import { REACH_OUT_DEFAULTS, findWhoReachesOutFirst } from "../../src/insights/reach-out-first.ts";
import type { ReachOutNote } from "../../src/insights/reach-out-first.ts";
import { parseExportZip } from "../../src/export/parse.ts";
import { syntheticExportZip } from "../../src/testing/synthetic-export.ts";
import { DAY_MS } from "../../src/util.ts";
import type { ChatEvent } from "../../src/types.ts";

const NOW = Date.UTC(2025, 5, 1, 12, 0, 0);
const HOUR = 3_600_000;

const ev = (
  who: string,
  direction: ChatEvent["direction"],
  hoursAgo: number,
  extra: Partial<ChatEvent> = {},
): ChatEvent => ({
  conversation: who,
  isGroup: false,
  direction,
  kind: "TEXT",
  at: NOW - hoursAgo * HOUR,
  ...extra,
});

/** One exchange per day, starting at the given direction, each followed by a reply an hour later. */
const days = (who: string, starters: Array<"sent" | "received" | "unknown">, firstDay = 1): ChatEvent[] =>
  starters.flatMap((d, i) => {
    const start = (firstDay + i) * 24;
    return [ev(who, d, start), ev(who, d === "sent" ? "received" : "sent", start - 1)];
  });

const rep = (n: number, d: "sent" | "received" | "unknown") => Array.from({ length: n }, () => d);
const run = (events: ChatEvent[], extra: Record<string, unknown> = {}) =>
  findWhoReachesOutFirst(events, { now: NOW, ...extra });
const code = (notes: ReachOutNote[], c: string) => notes.find((n) => n.code === c);

describe("findWhoReachesOutFirst: exchanges", () => {
  it("handles empty input", () => {
    const r = run([]);
    expect(r.people).toEqual([]);
    expect(r.notes).toEqual([{ code: "no-events", params: {} }]);
    expect(r.overall).toEqual({ exchanges: 0, byYou: 0, byThem: 0, unknown: 0, youShare: null });
  });

  it("rejects an unusable now without throwing", () => {
    const r = findWhoReachesOutFirst([ev("amy", "sent", 5)], { now: Number.NaN });
    expect(r.asOf).toBeNull();
    expect(r.notes).toEqual([{ code: "invalid-now", params: {} }]);
  });

  it("counts a single event as one exchange started by its sender", () => {
    expect(run([ev("amy", "sent", 5)]).people).toEqual([
      { username: "amy", exchanges: 1, byYou: 1, byThem: 0, unknown: 0, youShare: 1 },
    ]);
    expect(run([ev("amy", "received", 5)]).people[0]).toMatchObject({ byYou: 0, byThem: 1, youShare: 0 });
  });

  it("uses the first event of each exchange, not who talks most", () => {
    const r = run([
      ev("bo", "sent", 100),
      ...Array.from({ length: 5 }, (_, i) => ev("bo", "received", 99 - i)),
      ev("bo", "received", 50),
      ev("bo", "sent", 49),
    ]);
    expect(r.people[0]).toMatchObject({ exchanges: 2, byYou: 1, byThem: 1, youShare: 0.5 });
  });

  it("starts a new exchange at exactly the gap, not before", () => {
    const g = REACH_OUT_DEFAULTS.gapHours;
    expect(run([ev("cy", "sent", 50), ev("cy", "received", 50 - g + 0.01)]).people[0]!.exchanges).toBe(1);
    expect(run([ev("cy", "sent", 50), ev("cy", "received", 50 - g)]).people[0]).toMatchObject({ byYou: 1, byThem: 1 });
  });

  it("measures the gap from the previous event, so a chain of short gaps stays one exchange", () => {
    const chain = Array.from({ length: 10 }, (_, i) => ev("dee", i === 0 ? "sent" : "received", 100 - i * 5));
    expect(run(chain).people[0]).toMatchObject({ exchanges: 1, byYou: 1 });
  });

  it("honors a custom gap and falls back to the default for an unusable one", () => {
    const events = [ev("eli", "sent", 50), ev("eli", "received", 47)];
    expect(run(events).people[0]!.exchanges).toBe(1);
    expect(run(events, { gapHours: 2 }).people[0]!.exchanges).toBe(2);
    expect(run(events, { gapHours: Number.NaN }).settings.gapHours).toBe(REACH_OUT_DEFAULTS.gapHours);
    expect(run(events, { gapHours: -4 }).settings.gapHours).toBeGreaterThan(0);
  });

  it("merges names that differ only by case, and ignores input order", () => {
    const events = [ev("Fay", "sent", 80), ev("fay", "received", 60), ev("FAY", "sent", 40)];
    const a = run(events);
    expect(run([...events].reverse())).toEqual(a);
    expect(a.people).toHaveLength(1);
    expect(a.people[0]).toMatchObject({ username: "fay", exchanges: 3, byYou: 2, byThem: 1 });
  });

  it("is not affected by a UTC offset: only the length of silence matters", () => {
    const shift = 13 * HOUR; // an offset-sized shift of every timestamp
    const events = days("gus", rep(3, "sent"));
    const shifted = events.map((e) => ({ ...e, at: e.at - shift }));
    expect(run(shifted, { now: NOW }).people).toEqual(run(events, { now: NOW }).people);
  });

  it("handles a leap day like any other day", () => {
    const leap = Date.UTC(2024, 1, 29, 10, 0, 0);
    const at = (d: number, h = 0) => leap + d * DAY_MS + h * HOUR;
    const events: ChatEvent[] = [
      { ...ev("hal", "sent", 0), at: at(-1) }, // Feb 28
      { ...ev("hal", "received", 0), at: at(0) }, // Feb 29
      { ...ev("hal", "sent", 0), at: at(1) }, // Mar 1
    ];
    expect(run(events).people[0]).toMatchObject({ exchanges: 3, byYou: 2, byThem: 1 });
  });
});

describe("findWhoReachesOutFirst: unknown direction", () => {
  it("excludes an exchange that opens with an unknown event and counts it", () => {
    const r = run([ev("ivy", "unknown", 100), ev("ivy", "sent", 99), ev("ivy", "sent", 50)]);
    expect(r.people[0]).toMatchObject({ exchanges: 1, byYou: 1, unknown: 1, youShare: 1 });
    expect(code(r.notes, "exchanges-starter-unknown")?.params).toEqual({ count: 1 });
    expect(r.overall).toMatchObject({ exchanges: 1, unknown: 1 });
  });

  it("lets an unknown event in the middle keep the exchange together", () => {
    // sent at 100, unknown at 95, received at 90: 5h gaps, one exchange started by you.
    const r = run([ev("jon", "sent", 100), ev("jon", "unknown", 95), ev("jon", "received", 90)]);
    expect(r.people[0]).toMatchObject({ exchanges: 1, byYou: 1, unknown: 0 });
  });

  it("does not make a person of only unknown events a known starter", () => {
    const r = run([ev("kim", "unknown", 100), ev("kim", "unknown", 10)]);
    expect(r.people[0]).toMatchObject({ exchanges: 0, unknown: 2, youShare: null });
    expect(r.overall.youShare).toBeNull();
  });

  it("treats disagreeing first events at the same instant as a tie, in any order", () => {
    const a = run([ev("lou", "sent", 50), ev("lou", "received", 50)]);
    const b = run([ev("lou", "received", 50), ev("lou", "sent", 50)]);
    expect(a).toEqual(b);
    expect(a.people[0]).toMatchObject({ exchanges: 0, unknown: 1 });
    expect(code(a.notes, "exchanges-starter-tied")?.params).toEqual({ count: 1 });
    // Agreeing events at the same instant are fine.
    expect(run([ev("lou", "sent", 50), ev("lou", "sent", 50)]).people[0]).toMatchObject({ byYou: 1, unknown: 0 });
  });

  it("does not list a person whose starters are mostly unknown", () => {
    const r = run(days("mo", [...rep(6, "sent"), ...rep(8, "unknown")]));
    expect(r.mostlyYou).toEqual([]);
    expect(code(r.notes, "people-starter-unreliable")?.params).toEqual({ count: 1 });
  });
});

describe("findWhoReachesOutFirst: input hygiene", () => {
  it("leaves out group chats and counts them", () => {
    const r = run([
      ev("group:abc123", "sent", 20, { isGroup: true }),
      ev("group:def456", "sent", 20),
      ev("nat", "sent", 20),
    ]);
    expect(r.people.map((p) => p.username)).toEqual(["nat"]);
    expect(code(r.notes, "group-events-skipped")?.params).toEqual({ count: 2 });
    expect(code(run([ev("group:abc123", "sent", 20, { isGroup: true })]).notes, "no-one-to-one-events")).toBeDefined();
  });

  it("ignores missing or non-finite timestamps and counts them", () => {
    const bad = [
      { ...ev("ola", "received", 0), at: undefined as unknown as number },
      { ...ev("ola", "received", 0), at: Number.NaN },
      { ...ev("ola", "received", 0), at: Infinity },
    ];
    const r = run([...bad, ev("ola", "sent", 20)]);
    expect(code(r.notes, "events-without-time")?.params).toEqual({ count: 3 });
    expect(r.people[0]).toMatchObject({ exchanges: 1, byYou: 1 });
    expect(run(bad).people).toEqual([]);
  });

  it("ignores events dated after now or the export time and counts them", () => {
    const r = run([ev("pam", "sent", 20), ev("pam", "received", -3)]);
    expect(code(r.notes, "events-in-future")?.params).toEqual({ count: 1 });
    expect(r.people[0]).toMatchObject({ exchanges: 1, byThem: 0 });
    const exportedAt = NOW - 10 * HOUR;
    const r2 = run([ev("pam", "sent", 20), ev("pam", "received", 5)], { exportedAt });
    expect(r2.asOf).toBe(exportedAt);
    expect(code(r2.notes, "events-in-future")?.params).toEqual({ count: 1 });
  });

  it("ignores events with no person", () => {
    const r = run([ev("  ", "sent", 5), ev("quin", "sent", 5)]);
    expect(code(r.notes, "events-without-person")?.params).toEqual({ count: 1 });
    expect(r.people).toHaveLength(1);
  });

  it("limits the result to current friends when given", () => {
    const r = run([ev("rex", "sent", 10), ev("sal", "sent", 10)], { friends: ["REX"] });
    expect(r.people.map((p) => p.username)).toEqual(["rex"]);
    expect(code(r.notes, "people-not-in-friends")?.params).toEqual({ count: 1 });
    expect(r.overall.exchanges).toBe(1);
  });
});

describe("findWhoReachesOutFirst: who mostly starts", () => {
  it("lists people you mostly start with and people who mostly start with you", () => {
    const r = run([
      ...days("you_start", [...rep(8, "sent"), "received", "received"]), // 0.8 you
      ...days("they_start", [...rep(1, "sent"), ...rep(9, "received")]), // 0.9 them
      ...days("balanced", [...rep(5, "sent"), ...rep(5, "received")]),
    ]);
    expect(r.mostlyYou.map((p) => p.username)).toEqual(["you_start"]);
    expect(r.mostlyThem.map((p) => p.username)).toEqual(["they_start"]);
    expect(r.summary).toEqual({ people: 3, mostlyThem: 1, mostlyYou: 1 });
    expect(r.overall).toEqual({ exchanges: 30, byYou: 14, byThem: 16, unknown: 0, youShare: 0.47 });
  });

  it("needs the minimum number of exchanges, and counts the people left out", () => {
    const events = days("tia", rep(4, "sent"));
    const r = run(events);
    expect(r.mostlyYou).toEqual([]);
    expect(code(r.notes, "people-too-few-exchanges")?.params).toEqual({ count: 1 });
    expect(run(events, { minExchanges: 4 }).mostlyYou).toHaveLength(1);
    expect(run(events, { minExchanges: Number.NaN }).settings.minExchanges).toBe(REACH_OUT_DEFAULTS.minExchanges);
    expect(run(days("tia", rep(5, "sent"))).mostlyYou).toHaveLength(1);
  });

  it("respects the share threshold and never lists an even split", () => {
    const events = days("uma", [...rep(6, "sent"), ...rep(4, "received")]); // 0.6
    expect(run(events).mostlyYou).toEqual([]);
    expect(run(events, { mostlyShare: 0.6 }).mostlyYou).toHaveLength(1);
    expect(run(days("vic", [...rep(5, "sent"), ...rep(5, "received")]), { mostlyShare: 0.5 }).mostlyYou).toEqual([]);
  });

  it("orders by share, then exchanges, then username; the full list by exchanges", () => {
    const r = run([
      ...days("zoe", [...rep(9, "sent"), "received"]),
      ...days("amy", [...rep(9, "sent"), "received"]),
      ...days("bob", [...rep(18, "sent"), ...rep(2, "received")]),
      ...days("cat", rep(5, "sent")),
    ]);
    expect(r.mostlyYou.map((p) => p.username)).toEqual(["cat", "bob", "amy", "zoe"]);
    expect(r.people.map((p) => p.username)).toEqual(["bob", "amy", "zoe", "cat"]);
  });
});

describe("findWhoReachesOutFirst: scale, determinism and privacy", () => {
  it("handles 12,000 people and 100,000+ events fast, deterministically", () => {
    const events: ChatEvent[] = [];
    for (let i = 0; i < 12_000; i++) {
      const who = `person_${String(i).padStart(5, "0")}`;
      for (let k = 0; k < 9; k++) {
        events.push(ev(who, (i + k) % 3 === 0 ? "received" : "sent", 24 * (k + 1) + (i % 5)));
      }
    }
    const t0 = performance.now();
    const a = run(events);
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(3000);
    expect(a.summary.people).toBe(12_000);
    expect(a.overall.exchanges).toBe(12_000 * 9);
    expect(run([...events].reverse())).toEqual(a);
  });

  it("is a pure function of its inputs", () => {
    const events = [ev("sam", "received", 9), ev("tom", "sent", 12)];
    const copy = JSON.stringify(events);
    expect(run(events)).toEqual(run(events));
    expect(JSON.stringify(events)).toBe(copy);
  });

  it("puts a canary username only in the rows that list people, never in notes", () => {
    const canary = "zqcanary_reachout_user";
    const events: ChatEvent[] = [
      ...days(canary, rep(8, "sent")),
      ...days(`${canary}_b`, rep(8, "received")),
      ev(`${canary}_c`, "unknown", 5),
      ev(`${canary}_d`, "sent", 5, { at: Number.NaN }),
      ev(`${canary}_e`, "sent", -50),
      ev(`${canary}_f`, "sent", 50),
      ev(`${canary}_g`, "sent", 50),
      ev(`${canary}_g`, "received", 50),
      ev("group:" + canary, "sent", 5, { isGroup: true }),
    ];
    const r = run(events, { friends: [canary, `${canary}_b`, `${canary}_c`, `${canary}_e`, `${canary}_g`] });
    expect(r.notes.length).toBeGreaterThan(3);
    expect(JSON.stringify(r.notes)).not.toContain(canary);
    expect(JSON.stringify(r.summary)).not.toContain(canary);
    expect(JSON.stringify(r.overall)).not.toContain(canary);
    expect(JSON.stringify(r.settings)).not.toContain(canary);
    for (const n of r.notes) {
      expect(Object.keys(n).sort()).toEqual(["code", "params"]);
      for (const v of Object.values(n.params)) expect(typeof v).toBe("number");
      expect(n.code).toMatch(/^[a-z-]+$/);
    }
    expect(JSON.stringify(r.mostlyYou)).toContain(canary);
    expect(JSON.stringify(r.mostlyThem)).toContain(`${canary}_b`);
    const rowless = { ...r, people: [], mostlyThem: [], mostlyYou: [] };
    expect(JSON.stringify(rowless)).not.toContain(canary);
  });

  it("works on a built-in synthetic export", () => {
    const parsed = parseExportZip(syntheticExportZip({ now: NOW, seed: 7, friendCount: 40 }));
    const friends = parsed.friends.friends.map((f) => f.username);
    const r = findWhoReachesOutFirst(parsed.chats, { now: NOW, friends });
    expect(r.summary.people).toBeGreaterThan(0);
    expect(findWhoReachesOutFirst(parsed.chats, { now: NOW, friends })).toEqual(r);
    for (const p of r.people) expect(p.byYou + p.byThem).toBe(p.exchanges);
    expect(r.overall.byYou + r.overall.byThem).toBe(r.overall.exchanges);
  });
});
