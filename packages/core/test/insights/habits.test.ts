import { describe, expect, it } from "vitest";
import { FEW_EVENTS, MANY_UNKNOWN_SHARE, MAX_EVENT_TIME, computeHabits, type HabitEvent } from "../../src/insights/habits.ts";
import { parseExportZip } from "../../src/export/parse.ts";
import { syntheticExportZip } from "../../src/testing/synthetic-export.ts";
import type { ChatEvent } from "../../src/types.ts";

const NOW = Date.UTC(2025, 5, 15, 12, 0, 0); // Sunday, Jun 15, 2025
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const at = (y: number, m: number, d: number, h = 0, min = 0) => Date.UTC(y, m - 1, d, h, min);
const sent = (t: number): HabitEvent => ({ direction: "sent", at: t });
const recv = (t: number): HabitEvent => ({ direction: "received", at: t });
const unk = (t: number): HabitEvent => ({ direction: "unknown", at: t });

describe("computeHabits", () => {
  it("handles empty input", () => {
    const r = computeHabits([], { now: NOW });
    expect(r.totals).toEqual({ total: 0, sent: 0, received: 0, unknown: 0, events: 0, used: 0, undated: 0, future: 0 });
    expect(r.byHour).toHaveLength(24);
    expect(r.byWeekday).toHaveLength(7);
    expect(r.byMonth).toEqual([]);
    expect(r.sentShare).toBeNull();
    expect(r.busiest).toEqual({ hour: null, weekday: null, month: null });
    expect(r.quietest).toEqual({ hour: null, weekday: null, month: null });
    expect(r.medianGapMs).toBeNull();
    expect(r.first).toBeNull();
    expect(r.notes).toEqual([{ code: "no-events", params: {} }]);
  });

  it("handles one event", () => {
    const r = computeHabits([sent(at(2025, 3, 5, 14, 30))], { now: NOW }); // a Wednesday
    expect(r.totals.used).toBe(1);
    expect(r.byHour[14]!.sent).toBe(1);
    expect(r.byWeekday[3]!.total).toBe(1);
    expect(r.byMonth).toEqual([{ month: "2025-03", total: 1, sent: 1, received: 0, unknown: 0 }]);
    expect(r.busiest.hour).toEqual({ key: 14, count: 1, share: 1, ties: 0 });
    expect(r.quietest.month).toBeNull();
    expect(r.medianGapMs).toBeNull();
    expect(r.activeDays).toBe(1);
    expect(r.sentShare).toBe(1);
    expect(r.notes.map((n) => n.code)).toEqual(["few-events"]);
  });

  it("splits sent and received and ignores unknown direction in the share", () => {
    const t = at(2025, 3, 5, 9);
    const r = computeHabits([sent(t), sent(t + 1), sent(t + 2), recv(t + 3), unk(t + 4), { at: t + 5 }, { direction: "weird", at: t + 6 }], {
      now: NOW,
    });
    expect(r.totals).toMatchObject({ total: 7, sent: 3, received: 1, unknown: 3 });
    expect(r.sentShare).toBe(0.75);
    expect(r.byHour[9]).toMatchObject({ total: 7, sent: 3, received: 1, unknown: 3 });
  });

  it("has a null sent share when every direction is unknown, and says so", () => {
    const r = computeHabits([unk(at(2025, 1, 1)), unk(at(2025, 1, 2))], { now: NOW });
    expect(r.sentShare).toBeNull();
    expect(r.notes).toContainEqual({ code: "many-unknown-direction", params: { count: 2, percent: 100 } });
  });

  it("notes many unknown directions only above the share threshold", () => {
    expect(MANY_UNKNOWN_SHARE).toBe(0.5);
    const t = at(2025, 1, 1);
    const mix = (unknown: number, known: number) => [
      ...Array.from({ length: unknown }, (_, i) => unk(t + i)),
      ...Array.from({ length: known }, (_, i) => sent(t + 1000 + i)),
    ];
    const noteOf = (ev: HabitEvent[]) => computeHabits(ev, { now: NOW }).notes.find((n) => n.code === "many-unknown-direction");

    expect(noteOf(mix(2, 2))).toBeUndefined(); // exactly 50%
    expect(noteOf(mix(50, 50))).toBeUndefined();
    expect(noteOf(mix(1, 2))).toBeUndefined(); // 33%
    expect(noteOf(mix(51, 49))).toEqual({ code: "many-unknown-direction", params: { count: 51, percent: 51 } });
    expect(noteOf(mix(2, 1))).toEqual({ code: "many-unknown-direction", params: { count: 2, percent: 67 } }); // 66.7 rounds up
    expect(noteOf(mix(3, 0))).toEqual({ code: "many-unknown-direction", params: { count: 3, percent: 100 } });
  });

  it("counts undated events without using them", () => {
    const r = computeHabits(
      [{ direction: "sent" }, { direction: "sent", at: null }, { direction: "sent", at: NaN }, { direction: "sent", at: 0 }, { direction: "sent", at: Infinity }, sent(at(2025, 2, 1))],
      { now: NOW },
    );
    expect(r.totals).toMatchObject({ events: 6, used: 1, undated: 5, future: 0 });
    expect(r.notes).toContainEqual({ code: "undated-skipped", params: { count: 5 } });
  });

  it("treats out-of-range times as undated and keeps the month list bounded", () => {
    const ev = [sent(at(2025, 2, 1)), sent(8.64e15), sent(8.64e15 + 1), sent(1e18), sent(MAX_EVENT_TIME + 1)];
    const r = computeHabits(ev, { now: Infinity });
    expect(r.totals).toMatchObject({ events: 5, used: 1, undated: 4, future: 0 });
    expect(r.byMonth.map((m) => m.month)).toEqual(["2025-02"]);
    expect(r.byMonth.reduce((s, m) => s + m.total, 0)).toBe(r.totals.used);
    // The latest allowed time is still read.
    const edge = computeHabits([sent(MAX_EVENT_TIME)], { now: Infinity });
    expect(edge.totals.used).toBe(1);
    expect(edge.byMonth).toEqual([{ month: "2200-01", total: 1, sent: 1, received: 0, unknown: 0 }]);
  });

  it("only undated events gives no patterns and a clear note", () => {
    const r = computeHabits([{ direction: "sent" }, { direction: "received", at: null }], { now: NOW });
    expect(r.busiest.hour).toBeNull();
    expect(r.notes.map((n) => n.code)).toEqual(["no-usable-events", "undated-skipped"]);
  });

  it("leaves out events after now", () => {
    const r = computeHabits([sent(NOW), sent(NOW + 1), recv(NOW + 5 * DAY), sent(at(2025, 1, 1))], { now: NOW });
    expect(r.totals).toMatchObject({ used: 2, future: 2 });
    expect(r.last).toBe(NOW);
    expect(r.byMonth.at(-1)!.month).toBe("2025-06");
    expect(r.notes).toContainEqual({ code: "future-skipped", params: { count: 2 } });
  });

  it("shifts hour, weekday and month by the UTC offset", () => {
    // Mar 1, 2025 23:30 UTC is a Saturday. At UTC+2 it is Sunday Mar 2, 01:30; at UTC-5 it is Saturday 18:30.
    // Mar 31, 2025 23:30 UTC is a Monday. At UTC+2 it is Tuesday Apr 1, 01:30.
    const ev = [sent(at(2025, 3, 31, 23, 30)), sent(at(2025, 3, 1, 23, 30))];
    const utc = computeHabits(ev, { now: NOW });
    expect(utc.byHour[23]!.total).toBe(2);
    expect(utc.byMonth.map((m) => m.month)).toEqual(["2025-03"]);

    const plus2 = computeHabits(ev, { now: NOW, utcOffsetMinutes: 120 });
    expect(plus2.byHour[1]!.total).toBe(2);
    expect(plus2.byWeekday[0]!.total).toBe(1); // Mar 2 is a Sunday
    expect(plus2.byWeekday[2]!.total).toBe(1); // Apr 1 is a Tuesday
    expect(plus2.byMonth.map((m) => m.month)).toEqual(["2025-03", "2025-04"]);

    const minus5 = computeHabits(ev, { now: NOW, utcOffsetMinutes: -300 });
    expect(minus5.byHour[18]!.total).toBe(2);
    expect(minus5.byWeekday[6]!.total).toBe(1);
    expect(minus5.utcOffsetMinutes).toBe(-300);
  });

  it("buckets a leap day correctly in UTC and across offsets", () => {
    // 2024-02-29 is a Thursday. Jan 31 is a Wednesday, Feb 28 a Wednesday, Mar 1 a Friday.
    const ev = [sent(at(2024, 1, 31, 12)), sent(at(2024, 2, 28, 12)), sent(at(2024, 2, 29, 23, 30)), sent(at(2024, 3, 1, 0, 30))];

    const utc = computeHabits(ev, { now: NOW });
    expect(utc.byWeekday.map((w) => w.total)).toEqual([0, 0, 0, 2, 1, 1, 0]); // Wed x2, Thu, Fri
    expect(utc.byHour[23]!.total).toBe(1);
    expect(utc.byMonth.map((m) => [m.month, m.total])).toEqual([
      ["2024-01", 1],
      ["2024-02", 2],
      ["2024-03", 1],
    ]);
    expect(utc.activeDays).toBe(4);

    // UTC+2: Feb 29 23:30 becomes Friday Mar 1 01:30, Mar 1 00:30 becomes 02:30 (Mar), Feb 28 12:00 stays in Feb.
    const plus2 = computeHabits(ev, { now: NOW, utcOffsetMinutes: 120 });
    expect(plus2.byMonth.map((m) => [m.month, m.total])).toEqual([
      ["2024-01", 1],
      ["2024-02", 1],
      ["2024-03", 2],
    ]);
    expect(plus2.byWeekday[5]!.total).toBe(2); // both Mar 1 events are Friday
    expect(plus2.byHour[1]!.total).toBe(1);
    expect(plus2.activeDays).toBe(3);

    // UTC-5: Mar 1 00:30 becomes Thursday Feb 29 19:30, so March is empty and only Jan and Feb remain.
    const minus5 = computeHabits(ev, { now: NOW, utcOffsetMinutes: -300 });
    expect(minus5.byMonth.map((m) => [m.month, m.total])).toEqual([
      ["2024-01", 1],
      ["2024-02", 3],
    ]);
    expect(minus5.byWeekday[4]!.total).toBe(2); // Feb 29 18:30 and 19:30
    expect(minus5.byHour[19]!.total).toBe(1);
    expect(minus5.activeDays).toBe(3);
  });

  it("rolls Feb 28 into March the same way in a non-leap year", () => {
    // 2023-02-28 is a Tuesday and 2023-03-01 a Wednesday; there is no Feb 29.
    const ev = [sent(at(2023, 2, 28, 23, 30)), sent(at(2023, 3, 1, 0, 30))];
    const utc = computeHabits(ev, { now: NOW });
    expect(utc.byMonth.map((m) => [m.month, m.total])).toEqual([
      ["2023-02", 1],
      ["2023-03", 1],
    ]);
    expect(utc.byWeekday[2]!.total).toBe(1);
    expect(utc.byWeekday[3]!.total).toBe(1);
    const plus2 = computeHabits(ev, { now: NOW, utcOffsetMinutes: 120 });
    expect(plus2.byMonth.map((m) => [m.month, m.total])).toEqual([["2023-03", 2]]);
    expect(plus2.activeDays).toBe(1);
  });

  it("supports half-hour offsets", () => {
    const r = computeHabits([sent(at(2025, 3, 5, 20, 15))], { now: NOW, utcOffsetMinutes: 330 });
    expect(r.byHour[1]!.total).toBe(1); // 01:45 next day
    expect(r.byWeekday[4]!.total).toBe(1); // Thursday
  });

  it("clamps or resets a bad offset and notes it", () => {
    const e = [sent(at(2025, 3, 5, 10))];
    expect(computeHabits(e, { now: NOW, utcOffsetMinutes: 5000 })).toMatchObject({ utcOffsetMinutes: 840 });
    expect(computeHabits(e, { now: NOW, utcOffsetMinutes: -5000 })).toMatchObject({ utcOffsetMinutes: -720 });
    const nan = computeHabits(e, { now: NOW, utcOffsetMinutes: NaN });
    expect(nan.utcOffsetMinutes).toBe(0);
    expect(nan.notes).toContainEqual({ code: "offset-adjusted", params: { minutes: 0 } });
    expect(computeHabits(e, { now: NOW, utcOffsetMinutes: 60 }).notes.map((n) => n.code)).not.toContain("offset-adjusted");
  });

  it("finds busiest and quietest periods with a stable tiebreak", () => {
    const ev = [
      // hour 10 is busiest (3), hour 5 has 1, the other 22 hours have 0
      sent(at(2025, 1, 6, 10)),
      sent(at(2025, 1, 7, 10)),
      recv(at(2025, 1, 8, 10)),
      sent(at(2025, 1, 9, 5)),
    ];
    const r = computeHabits(ev, { now: NOW });
    expect(r.busiest.hour).toEqual({ key: 10, count: 3, share: 0.75, ties: 0 });
    expect(r.quietest.hour).toEqual({ key: 0, count: 0, share: 0, ties: 21 }); // lowest hour wins the tie
    // Mon, Tue, Wed, Thu each have one event; Monday (1) wins the busiest tie, Sunday (0) is quietest
    expect(r.busiest.weekday).toMatchObject({ key: 1, count: 1, ties: 3 });
    expect(r.quietest.weekday).toMatchObject({ key: 0, count: 0, ties: 2 });
  });

  it("lists months without gaps and picks the busiest and quietest", () => {
    const ev = [sent(at(2024, 11, 3)), sent(at(2024, 11, 4)), sent(at(2025, 2, 1)), recv(at(2025, 2, 2)), recv(at(2025, 2, 3)), sent(at(2025, 3, 3))];
    const r = computeHabits(ev, { now: NOW });
    expect(r.byMonth.map((m) => [m.month, m.total])).toEqual([
      ["2024-11", 2],
      ["2024-12", 0],
      ["2025-01", 0],
      ["2025-02", 3],
      ["2025-03", 1],
    ]);
    expect(r.busiest.month).toMatchObject({ key: "2025-02", count: 3 });
    expect(r.quietest.month).toMatchObject({ key: "2024-12", count: 0, ties: 1 });
  });

  it("computes the median gap (odd, even, and zero gaps)", () => {
    const t = at(2025, 1, 1);
    // gaps 1, 2, 10 minutes -> median 2 min
    const odd = computeHabits([sent(t), sent(t + 60_000), sent(t + 180_000), sent(t + 780_000)], { now: NOW });
    expect(odd.medianGapMs).toBe(120_000);
    // gaps 1, 3 minutes -> median 2 min
    const even = computeHabits([sent(t), sent(t + 60_000), sent(t + 240_000)], { now: NOW });
    expect(even.medianGapMs).toBe(120_000);
    // two events at the same instant
    expect(computeHabits([sent(t), recv(t)], { now: NOW }).medianGapMs).toBe(0);
  });

  it("does not depend on input order", () => {
    const base = Array.from({ length: 200 }, (_, i) => ({
      direction: i % 3 === 0 ? "sent" : i % 3 === 1 ? "received" : "unknown",
      at: at(2025, 1, 1) + ((i * 7919) % 5000) * 600_000,
    })) as HabitEvent[];
    const shuffled = [...base].sort((a, b) => ((a.at! * 2654435761) % 1013) - ((b.at! * 2654435761) % 1013));
    const o = { now: NOW, utcOffsetMinutes: -480 };
    expect(computeHabits(shuffled, o)).toEqual(computeHabits(base, o));
  });

  it("is deterministic and does not change its input", () => {
    const ev = [sent(at(2025, 1, 1)), recv(at(2025, 1, 2))];
    const copy = JSON.stringify(ev);
    expect(computeHabits(ev, { now: NOW })).toEqual(computeHabits(ev, { now: NOW }));
    expect(JSON.stringify(ev)).toBe(copy);
  });

  it("treats conversations that differ only by case as plain events (no per-person logic)", () => {
    const t = at(2025, 4, 1, 8);
    const ev: ChatEvent[] = [
      { conversation: "Alex_Test", isGroup: false, direction: "sent", kind: "TEXT", at: t },
      { conversation: "alex_test", isGroup: false, direction: "sent", kind: "TEXT", at: t },
    ];
    const r = computeHabits(ev, { now: NOW });
    expect(r.totals.used).toBe(2);
    expect(r.byHour[8]!.sent).toBe(2);
    expect(r.medianGapMs).toBe(0);
  });

  it("notes few events only under the threshold", () => {
    const make = (n: number) => Array.from({ length: n }, (_, i) => sent(at(2025, 1, 1) + i * 1000));
    expect(computeHabits(make(FEW_EVENTS - 1), { now: NOW }).notes.map((n) => n.code)).toContain("few-events");
    expect(computeHabits(make(FEW_EVENTS), { now: NOW }).notes).toEqual([]);
  });

  it("handles 20,000 events quickly and correctly", () => {
    const n = 20_000;
    const start = at(2023, 1, 1);
    const ev: HabitEvent[] = Array.from({ length: n }, (_, i) => ({
      direction: i % 2 ? "sent" : "received",
      at: start + i * 30 * 60_000, // every 30 minutes
    }));
    const t0 = performance.now();
    const r = computeHabits(ev, { now: NOW, utcOffsetMinutes: 60 });
    expect(performance.now() - t0).toBeLessThan(3000); // coarse guard only, the machine may be loaded
    expect(r.totals.used).toBe(n);
    expect(r.medianGapMs).toBe(30 * 60_000);
    expect(r.byHour.every((h) => h.total === n / 24 || Math.abs(h.total - n / 24) < 2)).toBe(true);
    expect(r.sentShare).toBe(0.5);
    expect(r.byMonth.reduce((s, m) => s + m.total, 0)).toBe(n);
  });

  it("every total adds up", () => {
    const ev = Array.from({ length: 500 }, (_, i) => ({
      direction: (["sent", "received", "unknown"] as const)[i % 3],
      at: at(2024, 1, 1) + i * 5 * HOUR + (i % 7) * 1234,
    }));
    const r = computeHabits(ev, { now: NOW, utcOffsetMinutes: -420 });
    const sum = (rows: { total: number }[]) => rows.reduce((s, x) => s + x.total, 0);
    expect(sum(r.byHour)).toBe(500);
    expect(sum(r.byWeekday)).toBe(500);
    expect(sum(r.byMonth)).toBe(500);
    expect(r.totals.sent + r.totals.received + r.totals.unknown).toBe(500);
  });
});

describe("computeHabits privacy", () => {
  const CANARY = "zqcanary_habits_user";

  it("never carries a username or conversation into any part of the result", () => {
    const ev: ChatEvent[] = Array.from({ length: 40 }, (_, i) => ({
      conversation: i % 2 ? CANARY.toUpperCase() : CANARY,
      isGroup: false,
      direction: i % 3 === 0 ? "sent" : "received",
      kind: "TEXT",
      at: at(2025, 1, 1) + i * HOUR,
    }));
    (ev[0] as unknown as Record<string, unknown>).text = "ZQCANARY-MSG-1";
    const json = JSON.stringify(computeHabits(ev, { now: NOW })).toLowerCase();
    expect(json).not.toContain(CANARY);
    expect(json).not.toContain("zqcanary");
  });

  it("notes hold only a stable code and numbers", () => {
    const r = computeHabits([sent(NOW + DAY), unk(at(2025, 1, 1)), { direction: "sent" }], { now: NOW, utcOffsetMinutes: 99_999 });
    expect(r.notes.length).toBeGreaterThan(3);
    for (const n of r.notes) {
      expect(n.code).toMatch(/^[a-z]+(-[a-z]+)*$/);
      for (const v of Object.values(n.params)) expect(typeof v).toBe("number");
    }
  });
});

describe("computeHabits on a synthetic export", () => {
  it("summarizes the generated chats and Snaps", () => {
    const parsed = parseExportZip(syntheticExportZip({ now: NOW, phase: 2, realisticMemories: true }));
    expect(parsed.chats.length).toBeGreaterThan(0);
    const r = computeHabits(parsed.chats, { now: NOW, utcOffsetMinutes: -300 });
    expect(r.totals.used).toBe(parsed.chats.filter((c) => c.at <= NOW).length);
    expect(r.byHour.reduce((s, h) => s + h.total, 0)).toBe(r.totals.used);
    expect(r.busiest.hour).not.toBeNull();
    expect(r.medianGapMs).not.toBeNull();
    expect(JSON.stringify(r)).not.toMatch(/active_\d|ghost_\d|ZQCANARY/i);
  });
});

/** The plain way to compute what the tuned pass computes: an object per bucket, a Set of days, a full sort of the gaps. */
function referenceHabits(events: readonly HabitEvent[], now: number, offsetMinutes: number) {
  const offsetMs = offsetMinutes * 60_000;
  type Counts = { total: number; sent: number; received: number; unknown: number };
  const empty = (): Counts => ({ total: 0, sent: 0, received: 0, unknown: 0 });
  const hours = Array.from({ length: 24 }, empty);
  const weekdays = Array.from({ length: 7 }, empty);
  const months = new Map<number, Counts>();
  const days = new Set<number>();
  const times: number[] = [];
  const totals = { ...empty(), undated: 0, future: 0 };
  const bump = (c: Counts, d: "sent" | "received" | "unknown") => {
    c.total++;
    c[d]++;
  };
  for (const e of events) {
    const t = e.at;
    if (typeof t !== "number" || !Number.isFinite(t) || t <= 0 || t > MAX_EVENT_TIME) {
      totals.undated++;
      continue;
    }
    if (!(t <= now)) {
      totals.future++;
      continue;
    }
    const d = e.direction === "sent" || e.direction === "received" ? e.direction : "unknown";
    const shifted = t + offsetMs;
    const day = Math.floor(shifted / DAY);
    const dt = new Date(shifted);
    const monthIndex = dt.getUTCFullYear() * 12 + dt.getUTCMonth();
    bump(totals, d);
    bump(hours[Math.floor((((shifted % DAY) + DAY) % DAY) / HOUR)]!, d);
    bump(weekdays[(((day + 4) % 7) + 7) % 7]!, d);
    const m = months.get(monthIndex) ?? empty();
    months.set(monthIndex, m);
    bump(m, d);
    days.add(day);
    times.push(t);
  }
  let median: number | null = null;
  if (times.length >= 2) {
    const ordered = [...times].sort((a, b) => a - b);
    const gaps = ordered.slice(1).map((v, i) => v - ordered[i]!).sort((a, b) => a - b);
    const mid = gaps.length >> 1;
    median = gaps.length % 2 === 1 ? gaps[mid]! : Math.round((gaps[mid - 1]! + gaps[mid]!) / 2);
  }
  return { hours, weekdays, months, activeDays: days.size, totals, median, first: times.length ? Math.min(...times) : null, last: times.length ? Math.max(...times) : null };
}

describe("computeHabits agrees with the plain way of counting", () => {
  // A small seeded generator, so a failure is reproducible.
  const rng = (seed: number) => () => ((seed = (seed * 1_664_525 + 1_013_904_223) >>> 0) / 2 ** 32);
  const directions = ["sent", "received", "unknown", "mystery", undefined] as const;

  function crafted(next: () => number, count: number): HabitEvent[] {
    const out: HabitEvent[] = [];
    for (let i = 0; i < count; i++) {
      const roll = next();
      const t =
        roll < 0.04 ? NaN
        : roll < 0.08 ? -5
        : roll < 0.12 ? NOW + Math.floor(next() * 40) * DAY
        : roll < 0.14 ? MAX_EVENT_TIME + 1
        : roll < 0.17 ? Math.floor(next() * 3 * HOUR) + 1
        : roll < 0.2 ? MAX_EVENT_TIME - Math.floor(next() * 5 * HOUR)
        : roll < 0.4 ? NOW - Math.floor(next() * 3) * HOUR
        : NOW - Math.floor(next() * 4 * 365 * DAY);
      out.push({ direction: directions[Math.floor(next() * directions.length)], at: t });
    }
    return out;
  }

  it("gives the same counts, months, days and median gap for many shapes of input and every time zone", () => {
    const next = rng(7);
    const offsets = [-720, -300, -210, 0, 60, 330, 345, 525, 840];
    for (const count of [0, 1, 2, 3, 4, 5, 17, 200, 1500]) {
      const events = crafted(next, count);
      for (const offset of offsets) {
        const got = computeHabits(events, { now: NOW, utcOffsetMinutes: offset });
        const want = referenceHabits(events, NOW, offset);
        const label = `${count} events at ${offset}`;
        expect(got.totals, label).toMatchObject({ ...want.totals, used: want.totals.total, events: count });
        expect(got.byHour.map(({ hour: _h, ...c }) => c), label).toEqual(want.hours);
        expect(got.byWeekday.map(({ weekday: _w, ...c }) => c), label).toEqual(want.weekdays);
        const keys = [...want.months.keys()];
        expect(got.byMonth.length, label).toBe(keys.length === 0 ? 0 : Math.max(...keys) - Math.min(...keys) + 1);
        for (const b of got.byMonth) {
          const [y, m] = b.month.split("-").map(Number) as [number, number];
          const c = want.months.get(y * 12 + m - 1) ?? { total: 0, sent: 0, received: 0, unknown: 0 };
          expect({ total: b.total, sent: b.sent, received: b.received, unknown: b.unknown }, `${label} ${b.month}`).toEqual(c);
        }
        expect(got.activeDays, label).toBe(want.activeDays);
        expect(got.medianGapMs, label).toBe(want.median);
        expect(got.first, label).toBe(want.first);
        expect(got.last, label).toBe(want.last);
      }
    }
  });

  it("finds the median gap when most gaps are zero", () => {
    const events = [...Array.from({ length: 9 }, () => sent(NOW - DAY)), sent(NOW - HOUR), sent(NOW - 1000)];
    // Ten gaps: eight zeros, then two larger. The median is the mean of the two middle values, both zero.
    expect(computeHabits(events, { now: NOW }).medianGapMs).toBe(0);
    // Gaps 10, 1 and 29 sort to 1, 10, 29.
    expect(computeHabits([sent(NOW - 40), sent(NOW - 30), sent(NOW - 29), sent(NOW)], { now: NOW }).medianGapMs).toBe(10);
  });
});
