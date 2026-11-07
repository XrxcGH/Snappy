import { describe, expect, it } from "vitest";
import {
  CALENDAR_FEW_EVENTS,
  KIND_ORDER,
  MANY_OTHER_KIND_SHARE,
  MAX_CALENDAR_TIME,
  computeActivityCalendar,
  type CalendarEvent,
} from "../../src/insights/activity-calendar.ts";
import { parseExportZip } from "../../src/export/parse.ts";
import { syntheticExportZip } from "../../src/testing/synthetic-export.ts";
import type { ChatEvent } from "../../src/types.ts";

const NOW = Date.UTC(2025, 5, 15, 12, 0, 0); // Sunday, Jun 15, 2025
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const at = (y: number, m: number, d: number, h = 12, min = 0) => Date.UTC(y, m - 1, d, h, min);
const ev = (t: number, kind: string | null = "TEXT"): CalendarEvent => ({ kind, at: t });
/** n events on one day. */
const onDay = (y: number, m: number, d: number, n: number, kind = "TEXT"): CalendarEvent[] =>
  Array.from({ length: n }, (_, i) => ev(at(y, m, d, 8) + i * 1000, kind));
const count = (r: ReturnType<typeof computeActivityCalendar>, date: string) => r.calendar!.days.find((d) => d.date === date)?.count;

describe("computeActivityCalendar", () => {
  it("handles empty input", () => {
    const r = computeActivityCalendar([], { now: NOW });
    expect(r.totals).toEqual({ events: 0, used: 0, undated: 0, future: 0, activeDays: 0 });
    expect(r.calendar).toBeNull();
    expect(r.years).toEqual([]);
    expect(r.mixByYear).toEqual([]);
    expect(r.mix).toEqual({ text: 0, image: 0, video: 0, note: 0, sticker: 0, other: 0, total: 0 });
    expect(r.streaks).toEqual({ longestActive: null, longestQuiet: null });
    expect(r.first).toBeNull();
    expect(r.last).toBeNull();
    expect(r.notes).toEqual([{ code: "no-events", params: {} }]);
  });

  it("lists an empty calendar for a requested year when there is no data", () => {
    const r = computeActivityCalendar([], { now: NOW, year: 2024 });
    expect(r.calendar!.days).toHaveLength(366);
    expect(r.calendar!.total).toBe(0);
    expect(r.calendar!.busiestWeek).toBeNull();
    expect(r.calendar!.quietestWeek).toBeNull();
    expect(r.notes.map((n) => n.code)).toEqual(["year-empty", "no-events"]);
  });

  it("handles one event", () => {
    const r = computeActivityCalendar([ev(at(2025, 3, 5, 14, 30), "IMAGE")], { now: NOW });
    expect(r.years).toEqual([2025]);
    const c = r.calendar!;
    expect(c.year).toBe(2025);
    expect(c.days).toHaveLength(31 + 28 + 31 + 30 + 31 + 15); // Jan 1 to Jun 15
    expect(c.days[0]).toEqual({ date: "2025-01-01", count: 0 });
    expect(c.days.at(-1)!.date).toBe("2025-06-15");
    expect(count(r, "2025-03-05")).toBe(1);
    expect(c.months.map((m) => m.month)).toEqual(["2025-01", "2025-02", "2025-03", "2025-04", "2025-05", "2025-06"]);
    expect(c.months[2]).toEqual({ month: "2025-03", count: 1, activeDays: 1 });
    expect(c.total).toBe(1);
    expect(c.activeDays).toBe(1);
    expect(c.weeks).toEqual([]); // no complete week inside a single day
    expect(c.busiestWeek).toBeNull();
    expect(c.quietestWeek).toBeNull();
    expect(r.streaks.longestActive).toEqual({ days: 1, start: "2025-03-05", end: "2025-03-05" });
    expect(r.streaks.longestQuiet).toBeNull();
    expect(r.mix).toEqual({ text: 0, image: 1, video: 0, note: 0, sticker: 0, other: 0, total: 1 });
    expect(r.notes.map((n) => n.code)).toEqual(["few-events"]);
  });

  it("sorts events into the six kinds, ignoring case and spaces, with everything else as other", () => {
    expect(KIND_ORDER).toEqual(["text", "image", "video", "note", "sticker", "other"]);
    const t = at(2025, 2, 1);
    const r = computeActivityCalendar(
      [
        ev(t, "TEXT"),
        ev(t, "text"),
        ev(t, " Image "),
        ev(t, "VIDEO"),
        ev(t, "NOTE"),
        ev(t, "STICKER"),
        ev(t, "MEDIA"), // a saved chat media file: not known to be an image or a video
        ev(t, "SOMETHING_NEW"),
        ev(t, ""),
        ev(t, null),
        { at: t },
        { kind: 7 as unknown as string, at: t },
      ],
      { now: NOW },
    );
    expect(r.mix).toEqual({ text: 2, image: 1, video: 1, note: 1, sticker: 1, other: 6, total: 12 });
    expect(r.calendar!.mix).toEqual(r.mix);
  });

  it("notes many other kinds only above the share threshold", () => {
    expect(MANY_OTHER_KIND_SHARE).toBe(0.5);
    const t = at(2025, 1, 1);
    const mix = (other: number, text: number) => [
      ...Array.from({ length: other }, (_, i) => ev(t + i, "MEDIA")),
      ...Array.from({ length: text }, (_, i) => ev(t + 1000 + i, "TEXT")),
    ];
    const noteOf = (e: CalendarEvent[]) => computeActivityCalendar(e, { now: NOW }).notes.find((n) => n.code === "many-other-kind");
    expect(noteOf(mix(2, 2))).toBeUndefined(); // exactly 50%
    expect(noteOf(mix(1, 2))).toBeUndefined();
    expect(noteOf(mix(2, 1))).toEqual({ code: "many-other-kind", params: { count: 2, percent: 67 } });
  });

  it("counts undated events without using them", () => {
    const r = computeActivityCalendar([{ kind: "TEXT" }, { kind: "TEXT", at: null }, { at: NaN }, { at: 0 }, { at: -5 }, { at: Infinity }, ev(at(2025, 2, 1))], { now: NOW });
    expect(r.totals).toMatchObject({ events: 7, used: 1, undated: 6, future: 0 });
    expect(r.notes).toContainEqual({ code: "undated-skipped", params: { count: 6 } });
  });

  it("treats out-of-range times as undated and keeps every list bounded", () => {
    const e = [ev(at(2025, 2, 1)), ev(8.64e15), ev(8.64e15 + 1), ev(1e18), ev(MAX_CALENDAR_TIME + 1)];
    const r = computeActivityCalendar(e, { now: Infinity });
    expect(r.totals).toMatchObject({ used: 1, undated: 4, future: 0 });
    expect(r.years).toEqual([2025]);
    // The latest allowed time is still read, and the calendar never lists days past the year 2200.
    const edge = computeActivityCalendar([ev(MAX_CALENDAR_TIME)], { now: Infinity });
    expect(edge.totals.used).toBe(1);
    expect(edge.calendar!.year).toBe(2200);
    expect(edge.calendar!.days.map((d) => d.date)).toEqual(["2200-01-01"]);
    expect(edge.calendar!.total).toBe(1);
  });

  it("only undated events gives no calendar and a clear note", () => {
    const r = computeActivityCalendar([{ kind: "TEXT" }, { at: null }], { now: NOW });
    expect(r.calendar).toBeNull();
    expect(r.notes.map((n) => n.code)).toEqual(["no-usable-events", "undated-skipped"]);
  });

  it("leaves out events after now and does not list days past it", () => {
    const r = computeActivityCalendar([ev(NOW), ev(NOW + 1), ev(NOW + 5 * DAY), ev(at(2025, 1, 1))], { now: NOW });
    expect(r.totals).toMatchObject({ used: 2, future: 2 });
    expect(r.last).toBe(NOW);
    expect(r.calendar!.days.at(-1)).toEqual({ date: "2025-06-15", count: 1 });
    expect(r.notes).toContainEqual({ code: "future-skipped", params: { count: 2 } });
    // An unusable now (NaN) leaves nothing usable.
    expect(computeActivityCalendar([ev(at(2025, 1, 1))], { now: NaN }).totals).toMatchObject({ used: 0, future: 1 });
  });

  it("lists a whole past year, 365 days, and a leap year, 366", () => {
    const e = [ev(at(2023, 5, 1)), ev(at(2024, 5, 1)), ev(at(2025, 5, 1))];
    const r = computeActivityCalendar(e, { now: NOW });
    expect(r.years).toEqual([2023, 2024, 2025]);
    expect(computeActivityCalendar(e, { now: NOW, year: 2023 }).calendar!.days).toHaveLength(365);
    const leap = computeActivityCalendar(e, { now: NOW, year: 2024 }).calendar!;
    expect(leap.days).toHaveLength(366);
    expect(leap.days.map((d) => d.date)).toContain("2024-02-29");
    expect(leap.months.find((m) => m.month === "2024-02")).toEqual({ month: "2024-02", count: 0, activeDays: 0 });
    expect(leap.days.find((d) => d.date === "2024-03-01")!.count).toBe(0);
    expect(new Set(leap.days.map((d) => d.date)).size).toBe(366);
  });

  it("buckets a leap day correctly in UTC and across offsets", () => {
    const e = [ev(at(2024, 2, 28, 12)), ev(at(2024, 2, 29, 23, 30)), ev(at(2024, 3, 1, 0, 30))];
    const utc = computeActivityCalendar(e, { now: NOW, year: 2024 });
    expect(count(utc, "2024-02-28")).toBe(1);
    expect(count(utc, "2024-02-29")).toBe(1);
    expect(count(utc, "2024-03-01")).toBe(1);
    expect(utc.streaks.longestActive).toEqual({ days: 3, start: "2024-02-28", end: "2024-03-01" });

    // UTC+2: Feb 29 23:30 becomes Mar 1 01:30 and Mar 1 00:30 becomes 02:30, so Mar 1 holds two and Feb 29 is empty.
    const plus2 = computeActivityCalendar(e, { now: NOW, year: 2024, utcOffsetMinutes: 120 });
    expect(count(plus2, "2024-02-29")).toBe(0);
    expect(count(plus2, "2024-03-01")).toBe(2);
    expect(plus2.streaks.longestQuiet).toEqual({ days: 1, start: "2024-02-29", end: "2024-02-29" });

    // UTC-5: Mar 1 00:30 becomes Feb 29 19:30.
    const minus5 = computeActivityCalendar(e, { now: NOW, year: 2024, utcOffsetMinutes: -300 });
    expect(count(minus5, "2024-02-29")).toBe(2);
    expect(count(minus5, "2024-03-01")).toBe(0);
  });

  it("rolls Feb 28 into March the same way in a non-leap year", () => {
    const e = [ev(at(2023, 2, 28, 23, 30)), ev(at(2023, 3, 1, 0, 30))];
    const utc = computeActivityCalendar(e, { now: NOW });
    expect(utc.calendar!.days.map((d) => d.date)).not.toContain("2023-02-29");
    expect(count(utc, "2023-02-28")).toBe(1);
    expect(count(utc, "2023-03-01")).toBe(1);
    expect(utc.streaks.longestActive!.days).toBe(2); // consecutive days
    const plus2 = computeActivityCalendar(e, { now: NOW, utcOffsetMinutes: 120 });
    expect(count(plus2, "2023-03-01")).toBe(2);
    expect(plus2.totals.activeDays).toBe(1);
  });

  it("moves an event across the new year with the offset, including the year it belongs to", () => {
    const e = [ev(at(2024, 12, 31, 23, 30)), ev(at(2024, 12, 31, 10))];
    const utc = computeActivityCalendar(e, { now: NOW });
    expect(utc.years).toEqual([2024]);
    expect(utc.mixByYear.map((y) => [y.year, y.total])).toEqual([[2024, 2]]);
    const plus2 = computeActivityCalendar(e, { now: NOW, utcOffsetMinutes: 120 });
    expect(plus2.years).toEqual([2024, 2025]);
    expect(plus2.mixByYear.map((y) => [y.year, y.total])).toEqual([[2024, 1], [2025, 1]]);
    expect(plus2.calendar!.year).toBe(2025);
    expect(count(plus2, "2025-01-01")).toBe(1);
    const minus5 = computeActivityCalendar([ev(at(2025, 1, 1, 3))], { now: NOW, utcOffsetMinutes: -300 });
    expect(minus5.years).toEqual([2024]); // Dec 31, 22:00 local
  });

  it("supports half-hour offsets and reports the clamp of a bad one", () => {
    const half = computeActivityCalendar([ev(at(2025, 3, 5, 20, 15))], { now: NOW, utcOffsetMinutes: 330 });
    expect(count(half, "2025-03-06")).toBe(1); // 01:45 next day
    const e = [ev(at(2025, 3, 5, 10))];
    expect(computeActivityCalendar(e, { now: NOW, utcOffsetMinutes: 5000 }).utcOffsetMinutes).toBe(840);
    expect(computeActivityCalendar(e, { now: NOW, utcOffsetMinutes: -5000 }).utcOffsetMinutes).toBe(-720);
    const nan = computeActivityCalendar(e, { now: NOW, utcOffsetMinutes: NaN });
    expect(nan.utcOffsetMinutes).toBe(0);
    expect(nan.notes).toContainEqual({ code: "offset-adjusted", params: { minutes: 0 } });
    expect(computeActivityCalendar(e, { now: NOW, utcOffsetMinutes: 60 }).notes.map((n) => n.code)).not.toContain("offset-adjusted");
  });

  it("reads an event just after the epoch in the right year at extreme offsets", () => {
    const r = computeActivityCalendar([ev(1)], { now: NOW, utcOffsetMinutes: -720 });
    expect(r.years).toEqual([1969]);
    expect(r.calendar!.year).toBe(1969);
    expect(r.calendar!.total).toBe(1);
    expect(r.streaks.longestActive).toEqual({ days: 1, start: "1969-12-31", end: "1969-12-31" });
    const utc = computeActivityCalendar([ev(1)], { now: NOW });
    expect(utc.years).toEqual([1970]);
    expect(utc.calendar!.days[0]).toEqual({ date: "1970-01-01", count: 1 });
  });

  it("sums months and finds their active days", () => {
    const e = [...onDay(2025, 1, 5, 3), ...onDay(2025, 1, 6, 2), ...onDay(2025, 3, 1, 4)];
    const r = computeActivityCalendar(e, { now: NOW });
    expect(r.calendar!.months.slice(0, 3)).toEqual([
      { month: "2025-01", count: 5, activeDays: 2 },
      { month: "2025-02", count: 0, activeDays: 0 },
      { month: "2025-03", count: 4, activeDays: 1 },
    ]);
  });

  it("finds the longest active run and the longest quiet run, earliest first on a tie", () => {
    const e = [
      ...onDay(2025, 1, 1, 1),
      ...onDay(2025, 1, 2, 2),
      ...onDay(2025, 1, 3, 1), // run of 3 (Jan 1-3)
      ...onDay(2025, 1, 10, 1),
      ...onDay(2025, 1, 11, 1), // run of 2, after 6 quiet days (Jan 4-9)
      ...onDay(2025, 1, 20, 1), // run of 1, after 8 quiet days (Jan 12-19)
      ...onDay(2025, 1, 21, 1),
      ...onDay(2025, 1, 22, 1), // run of 3 again (Jan 20-22), later so it does not win
    ];
    const r = computeActivityCalendar(e, { now: NOW });
    expect(r.streaks.longestActive).toEqual({ days: 3, start: "2025-01-01", end: "2025-01-03" });
    expect(r.streaks.longestQuiet).toEqual({ days: 8, start: "2025-01-12", end: "2025-01-19" });
    expect(r.calendar!.streaks).toEqual(r.streaks);
  });

  it("does not count the time before the first or after the last event as a quiet run", () => {
    const r = computeActivityCalendar([...onDay(2025, 3, 1, 1), ...onDay(2025, 3, 2, 1)], { now: NOW });
    expect(r.streaks.longestQuiet).toBeNull();
    expect(r.streaks.longestActive!.days).toBe(2);
  });

  it("measures runs across months, years and a leap day, and inside the listed year separately", () => {
    // Dec 30, 2023 to Jan 2, 2024 is four active days in a row; then Feb 27 to Mar 2 (through Feb 29) is five.
    const days: [number, number, number][] = [[2023, 12, 30], [2023, 12, 31], [2024, 1, 1], [2024, 1, 2], [2024, 2, 27], [2024, 2, 28], [2024, 2, 29], [2024, 3, 1], [2024, 3, 2]];
    const r = computeActivityCalendar(days.map(([y, m, d]) => ev(at(y, m, d))), { now: NOW, year: 2024 });
    expect(r.streaks.longestActive).toEqual({ days: 5, start: "2024-02-27", end: "2024-03-02" });
    expect(r.streaks.longestQuiet).toEqual({ days: 55, start: "2024-01-03", end: "2024-02-26" }); // Jan 3-31 (29) + Feb 1-26 (26)
    const y23 = computeActivityCalendar(days.map(([y, m, d]) => ev(at(y, m, d))), { now: NOW, year: 2023 });
    expect(y23.calendar!.streaks.longestActive).toEqual({ days: 2, start: "2023-12-30", end: "2023-12-31" });
    expect(y23.calendar!.streaks.longestQuiet).toBeNull();
    expect(y23.streaks).toEqual(r.streaks);
  });

  it("finds the busiest and quietest complete weeks (Monday to Sunday)", () => {
    // Jan 1, 2025 is a Wednesday, so the first complete week starts Monday Jan 6. The last event is Friday Feb 28,
    // so the last complete week is Feb 17-23.
    const e = [
      ...onDay(2025, 1, 1, 9), // a partial week: left out of the weeks
      ...onDay(2025, 1, 7, 3),
      ...onDay(2025, 1, 21, 5),
      ...onDay(2025, 2, 4, 1),
      ...onDay(2025, 2, 11, 1),
      ...onDay(2025, 2, 18, 1),
      ...onDay(2025, 2, 28, 7), // a partial week: left out
    ];
    const c = computeActivityCalendar(e, { now: NOW }).calendar!;
    expect(c.weeks).toEqual([
      { start: "2025-01-06", count: 3 },
      { start: "2025-01-13", count: 0 },
      { start: "2025-01-20", count: 5 },
      { start: "2025-01-27", count: 0 },
      { start: "2025-02-03", count: 1 },
      { start: "2025-02-10", count: 1 },
      { start: "2025-02-17", count: 1 },
    ]);
    expect(c.busiestWeek).toEqual({ start: "2025-01-20", count: 5, ties: 0 });
    expect(c.quietestWeek).toEqual({ start: "2025-01-13", count: 0, ties: 1 }); // earliest of two empty weeks
  });

  it("puts Sunday at the end of the week and Monday at the start", () => {
    // Span Sun Jan 5 to Sun Jan 19: only Mon Jan 6 to Sun Jan 12 is complete. Jan 5 and Jan 13-19 are outside it.
    const e = [...onDay(2025, 1, 5, 4), ...onDay(2025, 1, 6, 1), ...onDay(2025, 1, 12, 2), ...onDay(2025, 1, 13, 8), ...onDay(2025, 1, 19, 1)];
    const c = computeActivityCalendar(e, { now: NOW }).calendar!;
    expect(c.weeks).toEqual([
      { start: "2025-01-06", count: 3 },
      { start: "2025-01-13", count: 9 },
    ]);
  });

  it("keeps weeks inside the calendar year and gives a tie to the earliest", () => {
    const all: CalendarEvent[] = [];
    for (let d = at(2023, 12, 1); d <= at(2025, 2, 1); d += DAY) all.push(ev(d));
    const c = computeActivityCalendar(all, { now: NOW, year: 2024 }).calendar!;
    // Mon Jan 1, 2024 starts the first week; the week of Mon Dec 30 runs into 2025 and is left out.
    expect(c.weeks[0]).toEqual({ start: "2024-01-01", count: 7 });
    expect(c.weeks.at(-1)).toEqual({ start: "2024-12-23", count: 7 });
    expect(c.weeks).toHaveLength(52);
    expect(c.busiestWeek).toEqual({ start: "2024-01-01", count: 7, ties: 51 });
    expect(c.quietestWeek).toEqual({ start: "2024-01-01", count: 7, ties: 51 });
  });

  it("has no quiet week with a single complete week, and no busiest week when it is empty", () => {
    const one = computeActivityCalendar([...onDay(2025, 1, 6, 1), ...onDay(2025, 1, 13, 1)], { now: NOW }).calendar!;
    expect(one.weeks).toEqual([{ start: "2025-01-06", count: 1 }]);
    expect(one.busiestWeek).toEqual({ start: "2025-01-06", count: 1, ties: 0 });
    expect(one.quietestWeek).toBeNull();
    const empty = computeActivityCalendar([...onDay(2025, 1, 5, 1), ...onDay(2025, 1, 20, 1)], { now: NOW }).calendar!;
    expect(empty.weeks).toEqual([
      { start: "2025-01-06", count: 0 },
      { start: "2025-01-13", count: 0 },
    ]);
    expect(empty.busiestWeek).toBeNull(); // 0 is not "busiest"
    expect(empty.quietestWeek).toEqual({ start: "2025-01-06", count: 0, ties: 1 });
  });

  it("does not count the days before someone started, or since the last event, as quiet weeks", () => {
    // Only 2025-03-10 (Monday) to 2025-03-23 (Sunday) has activity; 2025 has many empty weeks outside that span.
    const e = [...onDay(2025, 3, 10, 2), ...onDay(2025, 3, 23, 1)];
    const c = computeActivityCalendar(e, { now: NOW }).calendar!;
    expect(c.weeks.map((w) => w.start)).toEqual(["2025-03-10", "2025-03-17"]);
  });

  it("picks the default year, honors a requested one and says when it had to change it", () => {
    const e = [ev(at(2022, 6, 1)), ev(at(2023, 6, 1)), ev(at(2025, 3, 1))];
    const dflt = computeActivityCalendar(e, { now: NOW });
    expect(dflt.calendar!.year).toBe(2025);
    expect(dflt.years).toEqual([2022, 2023, 2024, 2025]); // gap-free
    expect(computeActivityCalendar(e, { now: NOW, year: 2023 }).calendar!.year).toBe(2023);
    expect(dflt.notes.map((n) => n.code)).toEqual(["few-events"]);

    for (const bad of [1800, 3000, 2023.5, NaN, Infinity]) {
      const r = computeActivityCalendar(e, { now: NOW, year: bad });
      expect(r.calendar!.year).toBe(2025);
      expect(r.notes).toContainEqual({ code: "year-adjusted", params: { year: 2025 } });
    }

    const empty = computeActivityCalendar(e, { now: NOW, year: 2024 });
    expect(empty.calendar!.total).toBe(0);
    expect(empty.notes).toContainEqual({ code: "year-empty", params: { year: 2024 } });

    // A year that has not started yet is listed with no rows, and noted as empty.
    const later = computeActivityCalendar(e, { now: NOW, year: 2030 });
    expect(later.calendar!.days).toEqual([]);
    expect(later.calendar!.months).toEqual([]);
    expect(later.calendar!.weeks).toEqual([]);
    expect(later.notes).toContainEqual({ code: "year-empty", params: { year: 2030 } });
  });

  it("gives the mix overall and by year, gap-free", () => {
    const e = [ev(at(2023, 1, 1), "TEXT"), ev(at(2023, 2, 1), "IMAGE"), ev(at(2025, 1, 1), "VIDEO"), ev(at(2025, 1, 2), "video"), ev(at(2025, 1, 3), "STICKER"), ev(at(2025, 2, 1), "NOTE"), ev(at(2025, 2, 2), "MEDIA")];
    const r = computeActivityCalendar(e, { now: NOW });
    expect(r.mix).toEqual({ text: 1, image: 1, video: 2, note: 1, sticker: 1, other: 1, total: 7 });
    expect(r.mixByYear).toEqual([
      { year: 2023, text: 1, image: 1, video: 0, note: 0, sticker: 0, other: 0, total: 2 },
      { year: 2024, text: 0, image: 0, video: 0, note: 0, sticker: 0, other: 0, total: 0 },
      { year: 2025, text: 0, image: 0, video: 2, note: 1, sticker: 1, other: 1, total: 5 },
    ]);
    expect(r.calendar!.mix).toEqual({ text: 0, image: 0, video: 2, note: 1, sticker: 1, other: 1, total: 5 });
    expect(computeActivityCalendar(e, { now: NOW, year: 2023 }).calendar!.mix).toMatchObject({ text: 1, image: 1, total: 2 });
  });

  it("does not depend on input order", () => {
    const kinds = ["TEXT", "IMAGE", "VIDEO", "NOTE", "STICKER", "MEDIA"];
    const base: CalendarEvent[] = Array.from({ length: 300 }, (_, i) => ev(at(2024, 1, 1) + ((i * 7919) % 5000) * 600_000, kinds[i % kinds.length]));
    const shuffled = [...base].sort((a, b) => ((a.at! * 2654435761) % 1013) - ((b.at! * 2654435761) % 1013));
    const o = { now: NOW, utcOffsetMinutes: -480 };
    expect(computeActivityCalendar(shuffled, o)).toEqual(computeActivityCalendar(base, o));
  });

  it("is deterministic and does not change its input", () => {
    const e = [ev(at(2025, 1, 1)), ev(at(2025, 1, 2), "IMAGE")];
    const copy = JSON.stringify(e);
    expect(computeActivityCalendar(e, { now: NOW })).toEqual(computeActivityCalendar(e, { now: NOW }));
    expect(JSON.stringify(e)).toBe(copy);
  });

  it("treats conversations that differ only by case as plain events (no per-person logic)", () => {
    const t = at(2025, 4, 1, 8);
    const chats: ChatEvent[] = [
      { conversation: "Alex_Test", isGroup: false, direction: "sent", kind: "TEXT", at: t },
      { conversation: "alex_test", isGroup: false, direction: "unknown", kind: "TEXT", at: t },
      { conversation: "group:abc", isGroup: true, direction: "received", kind: "SNAP", at: t + 1 },
    ];
    const r = computeActivityCalendar(chats, { now: NOW });
    expect(r.totals.used).toBe(3);
    expect(count(r, "2025-04-01")).toBe(3);
    expect(r.mix).toMatchObject({ text: 2, other: 1 });
  });

  it("notes few events only under the threshold", () => {
    const make = (n: number) => Array.from({ length: n }, (_, i) => ev(at(2025, 1, 1) + i * 1000));
    expect(computeActivityCalendar(make(CALENDAR_FEW_EVENTS - 1), { now: NOW }).notes.map((n) => n.code)).toContain("few-events");
    expect(computeActivityCalendar(make(CALENDAR_FEW_EVENTS), { now: NOW }).notes).toEqual([]);
  });

  it("handles 20,000 events quickly and every total adds up", () => {
    const n = 20_000;
    const start = at(2023, 1, 1, 0);
    const kinds = ["TEXT", "IMAGE", "VIDEO", "NOTE", "STICKER", "MEDIA"];
    const e = Array.from({ length: n }, (_, i) => ev(start + i * 45 * 60_000, kinds[i % 6])); // every 45 minutes
    const t0 = performance.now();
    const r = computeActivityCalendar(e, { now: NOW, utcOffsetMinutes: 60, year: 2023 });
    expect(performance.now() - t0).toBeLessThan(3000); // coarse guard only, the machine may be loaded
    expect(r.totals.used).toBe(n);
    expect(r.mix.total).toBe(n);
    expect(r.mixByYear.reduce((s, y) => s + y.total, 0)).toBe(n);
    expect(r.calendar!.days.reduce((s, d) => s + d.count, 0)).toBe(r.calendar!.total);
    expect(r.calendar!.months.reduce((s, m) => s + m.count, 0)).toBe(r.calendar!.total);
    expect(r.calendar!.months.reduce((s, m) => s + m.activeDays, 0)).toBe(r.calendar!.activeDays);
    expect(r.streaks.longestActive!.days).toBe(r.totals.activeDays); // an event every 45 minutes: no day is empty
    expect(r.streaks.longestQuiet).toBeNull();
    expect(KIND_ORDER.reduce((s, k) => s + r.mix[k], 0)).toBe(n);
  });

  it("handles a million events", () => {
    const n = 1_000_000;
    const start = at(2020, 1, 1, 0);
    const e = Array.from({ length: n }, (_, i) => ({ kind: i % 2 ? "TEXT" : "IMAGE", at: start + (i % 50_000) * 1_800_000 }));
    const t0 = performance.now();
    const r = computeActivityCalendar(e, { now: NOW });
    expect(performance.now() - t0).toBeLessThan(5000);
    expect(r.totals.used).toBe(n);
  });
});

describe("computeActivityCalendar privacy", () => {
  const CANARY = "zqcanary_calendar_user";

  it("never carries a username or conversation into any part of the result", () => {
    const chats: ChatEvent[] = Array.from({ length: 40 }, (_, i) => ({
      conversation: i % 2 ? CANARY.toUpperCase() : CANARY,
      isGroup: false,
      direction: i % 3 === 0 ? "sent" : "received",
      kind: i % 4 === 0 ? "IMAGE" : "TEXT",
      at: at(2025, 1, 1) + i * HOUR,
    }));
    (chats[0] as unknown as Record<string, unknown>).text = "ZQCANARY-MSG-1";
    (chats[1] as unknown as Record<string, unknown>).kind = "ZQCANARY-KIND";
    const json = JSON.stringify(computeActivityCalendar(chats, { now: NOW })).toLowerCase();
    expect(json).not.toContain(CANARY);
    expect(json).not.toContain("zqcanary");
  });

  it("notes hold only a stable code and numbers", () => {
    const r = computeActivityCalendar([ev(NOW + DAY), ev(at(2025, 1, 1), "MEDIA"), { kind: "TEXT" }], { now: NOW, utcOffsetMinutes: 99_999, year: 1 });
    expect(r.notes.length).toBeGreaterThan(3);
    for (const n of r.notes) {
      expect(n.code).toMatch(/^[a-z]+(-[a-z]+)*$/);
      for (const v of Object.values(n.params)) expect(typeof v).toBe("number");
    }
  });
});

describe("computeActivityCalendar on a synthetic export", () => {
  it("summarizes the generated chats and Snaps", () => {
    const parsed = parseExportZip(syntheticExportZip({ now: NOW, phase: 2, realisticMemories: true }));
    expect(parsed.chats.length).toBeGreaterThan(0);
    const r = computeActivityCalendar(parsed.chats, { now: NOW, utcOffsetMinutes: -300 });
    expect(r.totals.used).toBe(parsed.chats.filter((c) => c.at <= NOW).length);
    expect(r.mix.total).toBe(r.totals.used);
    expect(r.mix.text).toBeGreaterThan(0);
    expect(r.mixByYear.reduce((s, y) => s + y.total, 0)).toBe(r.totals.used);
    expect(r.calendar).not.toBeNull();
    expect(r.streaks.longestActive).not.toBeNull();
    expect(JSON.stringify(r)).not.toMatch(/active_\d|ghost_\d|ZQCANARY/i);
  });
});

/** The plain way to count: a Map of days from real Dates, then walk every day. */
function referenceCalendar(events: readonly CalendarEvent[], now: number, offsetMinutes: number, year: number) {
  const perDay = new Map<string, number>();
  const kinds = new Map<number, number>();
  const label = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  for (const e of events) {
    const t = e.at;
    if (typeof t !== "number" || !Number.isFinite(t) || t <= 0 || t > MAX_CALENDAR_TIME || !(t <= now)) continue;
    const shifted = t + offsetMinutes * 60_000;
    perDay.set(label(shifted), (perDay.get(label(shifted)) ?? 0) + 1);
    const y = new Date(shifted).getUTCFullYear();
    kinds.set(y, (kinds.get(y) ?? 0) + 1);
  }
  const sorted = [...perDay.keys()].sort();
  const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
  let bestActive = 0;
  let bestQuiet = 0;
  let run = 0;
  for (let i = 0; i < sorted.length; i++) {
    const gap = i === 0 ? 1 : (dayMs(sorted[i]!) - dayMs(sorted[i - 1]!)) / DAY;
    if (gap === 1) run++;
    else {
      run = 1;
      bestQuiet = Math.max(bestQuiet, gap - 1);
    }
    bestActive = Math.max(bestActive, run);
  }
  const days: { date: string; count: number }[] = [];
  const todayMs = dayMs(label(Math.min(now, MAX_CALENDAR_TIME) + offsetMinutes * 60_000));
  for (let d = Date.UTC(year, 0, 1); d <= Date.UTC(year, 11, 31) && d <= todayMs; d += DAY) days.push({ date: label(d), count: perDay.get(label(d)) ?? 0 });
  return { days, bestActive, bestQuiet, kinds, activeDays: sorted.length };
}

describe("computeActivityCalendar agrees with the plain way of counting", () => {
  const rng = (seed: number) => () => ((seed = (seed * 1_664_525 + 1_013_904_223) >>> 0) / 2 ** 32);

  it("gives the same days, runs and years for many shapes of input and every time zone", () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const next = rng(seed);
      const e: CalendarEvent[] = [];
      for (let i = 0; i < 400; i++) {
        const roll = next();
        const t =
          roll < 0.04 ? NaN
          : roll < 0.08 ? -5
          : roll < 0.12 ? NOW + Math.floor(next() * 40) * DAY
          : roll < 0.14 ? MAX_CALENDAR_TIME + 1
          : roll < 0.17 ? Math.floor(next() * 3 * HOUR) + 1
          : roll < 0.45 ? NOW - Math.floor(next() * 20) * DAY - Math.floor(next() * DAY)
          : NOW - Math.floor(next() * 4 * 365 * DAY);
        e.push({ kind: "TEXT", at: t });
      }
      for (const offset of [0, 90, -300, 330, 840, -720]) {
        for (const year of [2025, 2024, 2022]) {
          const r = computeActivityCalendar(e, { now: NOW, utcOffsetMinutes: offset, year });
          const ref = referenceCalendar(e, NOW, offset, year);
          expect(r.calendar!.days).toEqual(ref.days);
          expect(r.totals.activeDays).toBe(ref.activeDays);
          expect(r.streaks.longestActive?.days ?? 0).toBe(ref.bestActive);
          expect(r.streaks.longestQuiet?.days ?? 0).toBe(ref.bestQuiet);
          for (const y of r.mixByYear) expect(y.total).toBe(ref.kinds.get(y.year) ?? 0);
        }
      }
    }
  });
});
