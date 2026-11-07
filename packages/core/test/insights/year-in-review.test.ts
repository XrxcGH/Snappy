import { describe, expect, it } from "vitest";
import {
  FEW_EVENTS,
  MANY_UNKNOWN_SHARE,
  computeYearInReview,
  type YearEvent,
  type YearInput,
  type YearMemory,
} from "../../src/insights/year-in-review.ts";
import { MAX_EVENT_TIME } from "../../src/insights/habits.ts";
import { parseExportZip } from "../../src/export/parse.ts";
import { syntheticExportZip } from "../../src/testing/synthetic-export.ts";
import type { ChatEvent, DeletedFriendRecord, FriendRecord, MemoryItem } from "../../src/types.ts";

const NOW = Date.UTC(2025, 5, 15, 12, 0, 0); // Sunday, Jun 15, 2025
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const at = (y: number, m: number, d: number, h = 0, min = 0) => Date.UTC(y, m - 1, d, h, min);
const sent = (t: number, kind = "TEXT"): YearEvent => ({ direction: "sent", kind, at: t });
const recv = (t: number, kind = "TEXT"): YearEvent => ({ direction: "received", kind, at: t });
const unk = (t: number, kind = "TEXT"): YearEvent => ({ direction: "unknown", kind, at: t });
const codes = (r: { notes: { code: string }[] }) => r.notes.map((n) => n.code);

describe("computeYearInReview", () => {
  it("handles empty input without inventing anything", () => {
    const r = computeYearInReview({}, { now: NOW });
    expect(r).toEqual({
      year: null,
      yearSource: "none",
      utcOffsetMinutes: 0,
      inProgress: false,
      activity: null,
      friends: { added: null, removed: null },
      memories: null,
      skipped: { undated: 0, future: 0 },
      notes: [{ code: "no-data", params: {} }],
    });
    expect(computeYearInReview({ chats: [], friends: [], deletedFriends: [], memories: [] }, { now: NOW }).notes).toEqual([
      { code: "no-data", params: {} },
    ]);
  });

  it("with only unusable dates there is no year, and the skipped entries are counted", () => {
    const r = computeYearInReview(
      {
        chats: [{ direction: "sent" }, sent(NaN), sent(0), sent(NOW + DAY)],
        friends: [{}, { createdAt: null }],
        memories: [{ date: null }],
      },
      { now: NOW },
    );
    expect(r.year).toBeNull();
    expect(r.activity).toBeNull();
    expect(r.skipped).toEqual({ undated: 6, future: 1 });
    expect(codes(r)).toEqual(["no-data", "undated-skipped", "future-skipped"]);
    expect(r.notes[1]).toEqual({ code: "undated-skipped", params: { count: 6 } });
  });

  it("handles one event", () => {
    const r = computeYearInReview({ chats: [sent(at(2024, 3, 5, 14, 30), "IMAGE")] }, { now: NOW });
    expect(r.year).toBe(2024);
    expect(r.yearSource).toBe("latest");
    expect(r.inProgress).toBe(false);
    const a = r.activity!;
    expect(a.total).toEqual({ total: 1, sent: 1, received: 0, unknown: 0 });
    expect(a.snaps.total).toBe(1);
    expect(a.chats.total).toBe(0);
    expect(a.byMonth).toHaveLength(12);
    expect(a.byMonth[2]).toEqual({ month: 3, total: 1, sent: 1, received: 0, unknown: 0 });
    expect(a.busiestMonth).toEqual({ key: 3, count: 1, share: 1, ties: 0 });
    expect(a.busiestDay).toEqual({ key: "2024-03-05", count: 1, share: 1, ties: 0 });
    expect(a.longestQuietGap).toBeNull();
    expect(a.activeDays).toBe(1);
    expect(a.first).toBe(a.last);
    expect(a.firstDay).toBe("2024-03-05");
    expect(a.lastDay).toBe("2024-03-05");
    expect(codes(r)).toEqual(["no-friend-dates", "no-removal-dates", "no-memories", "few-events"]);
  });

  it("splits Snaps from chats by kind, in any letter case, and sent from received", () => {
    const t = at(2024, 6, 1, 9);
    const r = computeYearInReview(
      {
        chats: [
          sent(t, "IMAGE"),
          recv(t + 1, "video"),
          sent(t + 2, " Image "),
          recv(t + 3, "TEXT"),
          sent(t + 4, "MEDIA"),
          sent(t + 5, "NOTE"),
          { direction: "sent", at: t + 6 }, // no kind: a chat
          { direction: "sent", kind: null, at: t + 7 },
        ],
      },
      { now: NOW },
    );
    const a = r.activity!;
    expect(a.snaps).toEqual({ total: 3, sent: 2, received: 1, unknown: 0 });
    expect(a.chats).toEqual({ total: 5, sent: 4, received: 1, unknown: 0 });
    expect(a.total).toEqual({ total: 8, sent: 6, received: 2, unknown: 0 });
  });

  it("counts unknown or odd directions as activity, and notes when they dominate", () => {
    expect(MANY_UNKNOWN_SHARE).toBe(0.5);
    const t = at(2024, 1, 1);
    const mix = (unknown: number, known: number): YearEvent[] => [
      ...Array.from({ length: unknown }, (_, i) => unk(t + i)),
      ...Array.from({ length: known }, (_, i) => sent(t + 1000 + i)),
    ];
    const noteOf = (ev: YearEvent[]) => computeYearInReview({ chats: ev }, { now: NOW }).notes.find((n) => n.code === "many-unknown-direction");
    expect(noteOf(mix(2, 2))).toBeUndefined(); // exactly 50%
    expect(noteOf(mix(51, 49))).toEqual({ code: "many-unknown-direction", params: { count: 51, percent: 51 } });
    expect(noteOf(mix(3, 0))).toEqual({ code: "many-unknown-direction", params: { count: 3, percent: 100 } });

    const odd = computeYearInReview({ chats: [{ at: t }, { direction: "weird", at: t + 1 }, recv(t + 2)] }, { now: NOW });
    expect(odd.activity!.total).toEqual({ total: 3, sent: 0, received: 1, unknown: 2 });
  });

  it("notes thin years only under the threshold", () => {
    const make = (n: number) => Array.from({ length: n }, (_, i) => sent(at(2024, 1, 1) + i * 1000));
    expect(codes(computeYearInReview({ chats: make(FEW_EVENTS - 1) }, { now: NOW }))).toContain("few-events");
    expect(codes(computeYearInReview({ chats: make(FEW_EVENTS) }, { now: NOW }))).not.toContain("few-events");
  });

  it("defaults to the latest year with data in any section", () => {
    const r = computeYearInReview(
      { chats: [sent(at(2023, 5, 1))], friends: [{ createdAt: at(2024, 2, 1) }], memories: [{ date: at(2022, 1, 1), mediaType: "image" }] },
      { now: NOW },
    );
    expect(r.year).toBe(2024);
    expect(r.yearSource).toBe("latest");
    // chats exist, but none in 2024: zero, not missing
    expect(r.activity!.total.total).toBe(0);
    expect(r.activity!.busiestDay).toBeNull();
    expect(r.activity!.busiestMonth).toBeNull();
    expect(r.activity!.first).toBeNull();
    expect(r.activity!.longestQuietGap).toBeNull();
    expect(r.notes).toContainEqual({ code: "no-activity-in-year", params: { year: 2024 } });
    expect(r.friends.added).toBe(1);
    expect(r.memories!.total).toBe(0);
  });

  it("uses the year asked for, and ignores a bad one with a note", () => {
    const ev = [sent(at(2023, 5, 1)), sent(at(2024, 5, 1)), sent(at(2024, 5, 2))];
    const given = computeYearInReview({ chats: ev }, { now: NOW, year: 2023 });
    expect(given.year).toBe(2023);
    expect(given.yearSource).toBe("given");
    expect(given.activity!.total.total).toBe(1);

    for (const bad of [2024.5, NaN, Infinity, 1900, 3000, "2024" as unknown as number]) {
      const r = computeYearInReview({ chats: ev }, { now: NOW, year: bad });
      expect(r.year).toBe(2024);
      expect(r.yearSource).toBe("latest");
      expect(r.notes).toContainEqual({ code: "year-invalid", params: {} });
    }
    // an asked-for year with no data anywhere still reports honestly
    const empty = computeYearInReview({ chats: ev }, { now: NOW, year: 2019 });
    expect(empty.year).toBe(2019);
    expect(empty.activity!.total.total).toBe(0);
    expect(empty.notes).toContainEqual({ code: "no-activity-in-year", params: { year: 2019 } });
    // an invalid year with no data at all is just "no data"
    expect(codes(computeYearInReview({}, { now: NOW, year: NaN }))).toEqual(["year-invalid", "no-data"]);
    // a given year works even when nothing at all is usable
    expect(computeYearInReview({}, { now: NOW, year: 2024 }).year).toBe(2024);
  });

  it("finds the busiest month and day, first and last, with ties going to the earliest", () => {
    const ev = [
      // March: 3 events (two on the 9th), May: 3 events, April: 1
      sent(at(2024, 3, 9, 8)),
      recv(at(2024, 3, 9, 9)),
      sent(at(2024, 3, 20)),
      sent(at(2024, 4, 1)),
      sent(at(2024, 5, 2)),
      sent(at(2024, 5, 3)),
      sent(at(2024, 5, 4, 23, 59)),
      // another year, never counted
      sent(at(2023, 12, 31)),
    ];
    const a = computeYearInReview({ chats: ev }, { now: NOW, year: 2024 }).activity!;
    expect(a.busiestMonth).toEqual({ key: 3, count: 3, share: 3 / 7, ties: 1 });
    expect(a.busiestDay).toEqual({ key: "2024-03-09", count: 2, share: 2 / 7, ties: 0 });
    expect(a.first).toBe(at(2024, 3, 9, 8));
    expect(a.last).toBe(at(2024, 5, 4, 23, 59));
    expect(a.firstDay).toBe("2024-03-09");
    expect(a.lastDay).toBe("2024-05-04");
    expect(a.activeDays).toBe(6);

    // all days with one event: the earliest day wins and ties counts the rest
    const flat = computeYearInReview({ chats: [sent(at(2024, 7, 4)), sent(at(2024, 2, 1)), sent(at(2024, 9, 9))] }, { now: NOW, year: 2024 }).activity!;
    expect(flat.busiestDay).toEqual({ key: "2024-02-01", count: 1, share: 1 / 3, ties: 2 });
    expect(flat.busiestMonth).toMatchObject({ key: 2, ties: 2 });
  });

  it("finds the longest quiet gap between active days, earliest first on a tie", () => {
    const day = (m: number, d: number) => sent(at(2024, m, d, 10));
    // Jan 1, 2, 10 then Feb 1: quiet Jan 3-9 (7 days), Jan 11-31 (21 days)
    const r = computeYearInReview({ chats: [day(1, 1), day(1, 2), day(1, 10), day(2, 1)] }, { now: NOW, year: 2024 }).activity!;
    expect(r.longestQuietGap).toEqual({ days: 21, startDay: "2024-01-11", endDay: "2024-01-31" });
    // equal gaps: Jan 1 to Jan 5 (3 quiet) and Jan 5 to Jan 9 (3 quiet): the first one
    const tie = computeYearInReview({ chats: [day(1, 1), day(1, 5), day(1, 9)] }, { now: NOW, year: 2024 }).activity!;
    expect(tie.longestQuietGap).toEqual({ days: 3, startDay: "2024-01-02", endDay: "2024-01-04" });
    // time before the first and after the last event is not a gap
    const lone = computeYearInReview({ chats: [day(6, 15)] }, { now: NOW, year: 2024 }).activity!;
    expect(lone.longestQuietGap).toBeNull();
    // consecutive days have no gap
    const run = computeYearInReview({ chats: [day(3, 1), day(3, 2), day(3, 3)] }, { now: NOW, year: 2024 }).activity!;
    expect(run.longestQuietGap).toBeNull();
    // a gap may span the end of a month and the leap day
    const leap = computeYearInReview({ chats: [day(2, 27), day(3, 2)] }, { now: NOW, year: 2024 }).activity!;
    expect(leap.longestQuietGap).toEqual({ days: 3, startDay: "2024-02-28", endDay: "2024-03-01" });
    // events at both ends of the year
    const ends = computeYearInReview({ chats: [day(1, 1), day(12, 31)] }, { now: NOW, year: 2024 }).activity!;
    expect(ends.longestQuietGap).toEqual({ days: 364, startDay: "2024-01-02", endDay: "2024-12-30" });
  });

  it("handles the leap day and a common year's Feb 28 to Mar 1", () => {
    const ev = [sent(at(2024, 2, 28, 12)), sent(at(2024, 2, 29, 23, 30)), sent(at(2024, 2, 29, 1)), sent(at(2024, 3, 1, 0, 30))];
    const a = computeYearInReview({ chats: ev }, { now: NOW, year: 2024 }).activity!;
    expect(a.byMonth[1]!.total).toBe(3);
    expect(a.byMonth[2]!.total).toBe(1);
    expect(a.busiestDay).toEqual({ key: "2024-02-29", count: 2, share: 0.5, ties: 0 });
    expect(a.activeDays).toBe(3);
    expect(a.longestQuietGap).toBeNull();

    // UTC+2: Feb 29 23:30 becomes Mar 1 01:30, so February keeps two events and Mar 1 has two
    const plus2 = computeYearInReview({ chats: ev }, { now: NOW, year: 2024, utcOffsetMinutes: 120 }).activity!;
    expect(plus2.byMonth[1]!.total).toBe(2);
    expect(plus2.byMonth[2]!.total).toBe(2);
    expect(plus2.busiestDay).toEqual({ key: "2024-03-01", count: 2, share: 0.5, ties: 0 });
    expect(plus2.activeDays).toBe(3);

    // a common year: Feb 28 23:30 UTC is Mar 1 at UTC+2, and there is no Feb 29
    const common = computeYearInReview({ chats: [sent(at(2023, 2, 28, 23, 30)), sent(at(2023, 3, 1, 0, 30))] }, { now: NOW, year: 2023, utcOffsetMinutes: 120 }).activity!;
    expect(common.byMonth[1]!.total).toBe(0);
    expect(common.byMonth[2]!.total).toBe(2);
    expect(common.busiestDay).toEqual({ key: "2023-03-01", count: 2, share: 1, ties: 0 });
    const days2023 = computeYearInReview({ chats: [sent(at(2023, 12, 31))] }, { now: NOW, year: 2023 }).activity!;
    expect(days2023.busiestDay!.key).toBe("2023-12-31"); // day 365 of a 365-day year
    const days2024 = computeYearInReview({ chats: [sent(at(2024, 12, 31))] }, { now: NOW, year: 2024 }).activity!;
    expect(days2024.busiestDay!.key).toBe("2024-12-31"); // day 366 of a leap year
  });

  it("moves the year boundary with the UTC offset", () => {
    const newYearsEve = sent(at(2024, 12, 31, 23, 30)); // Jan 1, 2025 01:30 at UTC+2
    const newYearUtc = sent(at(2025, 1, 1, 0, 30)); // Dec 31, 2024 19:30 at UTC-5
    const input: YearInput = { chats: [newYearsEve, newYearUtc], friends: [{ createdAt: at(2024, 12, 31, 23, 30) }] };

    const utc24 = computeYearInReview(input, { now: NOW, year: 2024 });
    expect(utc24.activity!.total.total).toBe(1);
    expect(utc24.friends.added).toBe(1);
    const utc25 = computeYearInReview(input, { now: NOW, year: 2025 });
    expect(utc25.activity!.total.total).toBe(1);
    expect(utc25.friends.added).toBe(0);

    const plus2 = computeYearInReview(input, { now: NOW, year: 2025, utcOffsetMinutes: 120 });
    expect(plus2.activity!.total.total).toBe(2);
    expect(plus2.activity!.firstDay).toBe("2025-01-01");
    expect(plus2.friends.added).toBe(1);
    expect(plus2.utcOffsetMinutes).toBe(120);

    const minus5 = computeYearInReview(input, { now: NOW, year: 2024, utcOffsetMinutes: -300 });
    expect(minus5.activity!.total.total).toBe(2);
    expect(minus5.activity!.lastDay).toBe("2024-12-31");

    // the default year follows the offset too: the latest event is Jan 1 in UTC+2 only
    expect(computeYearInReview(input, { now: NOW }).year).toBe(2025);
    expect(computeYearInReview({ chats: [newYearsEve] }, { now: NOW }).year).toBe(2024);
    expect(computeYearInReview({ chats: [newYearsEve] }, { now: NOW, utcOffsetMinutes: 120 }).year).toBe(2025);
    // half-hour offsets
    const india = computeYearInReview({ chats: [sent(at(2024, 12, 31, 18, 45))] }, { now: NOW, year: 2025, utcOffsetMinutes: 330 });
    expect(india.activity!.total.total).toBe(1);
  });

  it("clamps or resets a bad offset and notes it", () => {
    const input = { chats: [sent(at(2024, 3, 5, 10))] };
    expect(computeYearInReview(input, { now: NOW, utcOffsetMinutes: 5000 })).toMatchObject({ utcOffsetMinutes: 840 });
    expect(computeYearInReview(input, { now: NOW, utcOffsetMinutes: -5000 })).toMatchObject({ utcOffsetMinutes: -720 });
    const nan = computeYearInReview(input, { now: NOW, utcOffsetMinutes: NaN });
    expect(nan.utcOffsetMinutes).toBe(0);
    expect(nan.notes).toContainEqual({ code: "offset-adjusted", params: { minutes: 0 } });
    expect(codes(computeYearInReview(input, { now: NOW, utcOffsetMinutes: 60 }))).not.toContain("offset-adjusted");
    expect(computeYearInReview(input, { now: NOW, utcOffsetMinutes: 90.4 }).notes).toContainEqual({ code: "offset-adjusted", params: { minutes: 90 } });
  });

  it("counts undated and future dates without using them", () => {
    const r = computeYearInReview(
      {
        chats: [sent(at(2024, 1, 5)), { direction: "sent" }, sent(NaN), sent(-5), sent(NOW + 1), sent(NOW + 40 * DAY), sent(MAX_EVENT_TIME + 1)],
        friends: [{ createdAt: at(2024, 2, 1) }, { createdAt: NOW + DAY }, {}],
        deletedFriends: [{ deletedAt: null }],
        memories: [{ date: at(2024, 4, 1), mediaType: "image" }, { date: null }, { date: Infinity }, { date: NOW + 1 }],
      },
      { now: NOW },
    );
    expect(r.year).toBe(2024);
    expect(r.activity!.total.total).toBe(1);
    expect(r.friends.added).toBe(1);
    expect(r.memories!.total).toBe(1);
    expect(r.skipped).toEqual({ undated: 4 + 1 + 1 + 2, future: 2 + 1 + 1 });
    expect(r.notes).toContainEqual({ code: "undated-skipped", params: { count: 8 } });
    expect(r.notes).toContainEqual({ code: "future-skipped", params: { count: 4 } });
  });

  it("does not use events after now, so the default year is the last one actually lived", () => {
    const r = computeYearInReview({ chats: [sent(at(2025, 3, 1)), sent(at(2026, 3, 1))] }, { now: NOW });
    expect(r.year).toBe(2025);
    expect(r.skipped.future).toBe(1);
    expect(computeYearInReview({ chats: [sent(NOW)] }, { now: NOW }).activity!.total.total).toBe(1); // exactly now is fine
    // a non-finite now treats everything as future (like the other insights), an infinite one as past
    expect(computeYearInReview({ chats: [sent(at(2024, 1, 1))] }, { now: NaN }).year).toBeNull();
    expect(computeYearInReview({ chats: [sent(at(2024, 1, 1))] }, { now: Infinity }).year).toBe(2024);
  });

  it("says when the year is not over yet", () => {
    const input = { chats: [sent(at(2025, 3, 1)), sent(at(2024, 3, 1))] };
    const current = computeYearInReview(input, { now: NOW });
    expect(current.year).toBe(2025);
    expect(current.inProgress).toBe(true);
    expect(current.notes).toContainEqual({ code: "year-in-progress", params: { year: 2025 } });
    const past = computeYearInReview(input, { now: NOW, year: 2024 });
    expect(past.inProgress).toBe(false);
    expect(codes(past)).not.toContain("year-in-progress");
    // the offset moves the boundary: Dec 31, 2024 22:00 UTC is already 2025 at UTC+3
    const edge = computeYearInReview(input, { now: at(2024, 12, 31, 22), year: 2025, utcOffsetMinutes: 180 });
    expect(edge.inProgress).toBe(true);
    expect(computeYearInReview(input, { now: at(2024, 12, 31, 22), year: 2025 }).inProgress).toBe(false);
  });

  it("counts new friends and removed friends in the year, and reports missing dates as missing", () => {
    const r = computeYearInReview(
      {
        chats: [sent(at(2024, 6, 1))],
        friends: [{ createdAt: at(2024, 1, 1) }, { createdAt: at(2024, 12, 31, 23, 59) }, { createdAt: at(2023, 12, 31, 23, 59) }, {}],
        deletedFriends: [{ deletedAt: at(2024, 5, 5) }, { deletedAt: at(2024, 5, 5) }, { deletedAt: at(2021, 5, 5) }],
      },
      { now: NOW },
    );
    expect(r.friends).toEqual({ added: 2, removed: 2 });

    const none = computeYearInReview({ chats: [sent(at(2024, 6, 1))], friends: [{}, {}], deletedFriends: [] }, { now: NOW });
    expect(none.friends).toEqual({ added: null, removed: null });
    expect(none.notes).toContainEqual({ code: "no-friend-dates", params: {} });
    expect(none.notes).toContainEqual({ code: "no-removal-dates", params: {} });

    // dates exist but none fall in the year: zero, not missing
    const other = computeYearInReview({ chats: [sent(at(2024, 6, 1))], friends: [{ createdAt: at(2020, 1, 1) }], deletedFriends: [{ deletedAt: at(2020, 1, 1) }] }, { now: NOW });
    expect(other.friends).toEqual({ added: 0, removed: 0 });
    expect(codes(other)).not.toContain("no-friend-dates");
  });

  it("counts Memories by month and type", () => {
    const m = (date: number | null, mediaType: string): YearMemory => ({ date, mediaType });
    const r = computeYearInReview(
      {
        memories: [
          m(at(2024, 1, 31, 23, 30), "image"),
          m(at(2024, 2, 1, 0, 30), "video"),
          m(at(2024, 2, 29), "image"),
          m(at(2024, 2, 29, 5), "unknown"),
          m(at(2024, 12, 31, 23, 59), "mystery"),
          { date: at(2024, 7, 4) },
          m(at(2023, 7, 4), "image"),
        ],
      },
      { now: NOW },
    );
    const mem = r.memories!;
    expect(r.year).toBe(2024);
    expect(r.activity).toBeNull();
    expect(codes(r)).toContain("no-activity-data");
    expect(mem).toMatchObject({ total: 6, image: 2, video: 1, unknown: 3 });
    expect(mem.byMonth).toHaveLength(12);
    expect(mem.byMonth[0]).toEqual({ month: 1, total: 1, image: 1, video: 0, unknown: 0 });
    expect(mem.byMonth[1]).toEqual({ month: 2, total: 3, image: 1, video: 1, unknown: 1 });
    expect(mem.byMonth[6]).toEqual({ month: 7, total: 1, image: 0, video: 0, unknown: 1 });
    expect(mem.byMonth[11]).toMatchObject({ month: 12, total: 1, unknown: 1 });
    expect(mem.byMonth.reduce((s, x) => s + x.total, 0)).toBe(mem.total);

    // UTC+2: Jan 31 23:30 moves to Feb 1
    const plus2 = computeYearInReview({ memories: [m(at(2024, 1, 31, 23, 30), "image")] }, { now: NOW, utcOffsetMinutes: 120 });
    expect(plus2.memories!.byMonth[1]!.image).toBe(1);
    expect(plus2.memories!.byMonth[0]!.total).toBe(0);
  });

  it("reports a section as missing only when the whole list has no usable date", () => {
    const r = computeYearInReview({ chats: [sent(at(2024, 6, 1))], memories: [{ date: null, mediaType: "image" }] }, { now: NOW });
    expect(r.memories).toBeNull();
    expect(r.notes).toContainEqual({ code: "no-memories", params: {} });
    expect(r.activity).not.toBeNull();
    const noChats = computeYearInReview({ friends: [{ createdAt: at(2024, 2, 2) }] }, { now: NOW });
    expect(noChats.activity).toBeNull();
    expect(noChats.notes).toContainEqual({ code: "no-activity-data", params: {} });
    expect(noChats.friends.added).toBe(1);
  });

  it("does not depend on input order, and does not change its input", () => {
    const base: YearEvent[] = Array.from({ length: 300 }, (_, i) => ({
      direction: i % 3 === 0 ? "sent" : i % 3 === 1 ? "received" : "unknown",
      kind: i % 4 === 0 ? "IMAGE" : "TEXT",
      at: at(2024, 1, 1) + ((i * 7919) % 9000) * 3_600_000,
    }));
    const shuffled = [...base].sort((a, b) => ((a.at! * 2654435761) % 1013) - ((b.at! * 2654435761) % 1013));
    const o = { now: NOW, utcOffsetMinutes: -480 };
    const copy = JSON.stringify(base);
    expect(computeYearInReview({ chats: shuffled }, o)).toEqual(computeYearInReview({ chats: base }, o));
    expect(JSON.stringify(base)).toBe(copy);
    expect(computeYearInReview({ chats: base }, o)).toEqual(computeYearInReview({ chats: base }, o));
  });

  it("treats conversations that differ only by case as plain events (no per-person logic)", () => {
    const t = at(2024, 4, 1, 8);
    const ev: ChatEvent[] = [
      { conversation: "Alex_Test", isGroup: false, direction: "sent", kind: "TEXT", at: t },
      { conversation: "alex_test", isGroup: false, direction: "sent", kind: "TEXT", at: t },
      { conversation: "group:ab12cd34", isGroup: true, direction: "received", kind: "TEXT", at: t },
    ];
    const r = computeYearInReview({ chats: ev }, { now: NOW });
    expect(r.activity!.total).toEqual({ total: 3, sent: 2, received: 1, unknown: 0 });
    expect(r.activity!.busiestDay).toMatchObject({ key: "2024-04-01", count: 3 });
  });

  it("handles 20,000 events quickly and correctly", () => {
    const n = 20_000;
    const start = at(2024, 1, 1);
    const ev: YearEvent[] = Array.from({ length: n }, (_, i) => ({
      direction: i % 2 ? "sent" : "received",
      kind: i % 5 === 0 ? "VIDEO" : "TEXT",
      at: start + i * 26 * 60_000, // every 26 minutes: 20,000 of them span about 361 days
    }));
    const t0 = performance.now();
    const r = computeYearInReview({ chats: ev, friends: ev.map((e) => ({ createdAt: e.at })), memories: ev.map((e) => ({ date: e.at, mediaType: "image" })) }, { now: NOW, year: 2024, utcOffsetMinutes: 60 });
    expect(performance.now() - t0).toBeLessThan(3000); // coarse guard only, the machine may be loaded
    const a = r.activity!;
    expect(a.total.total).toBe(n);
    expect(a.total.sent).toBe(n / 2);
    expect(a.snaps.total).toBe(n / 5);
    expect(a.byMonth.reduce((s, x) => s + x.total, 0)).toBe(n);
    expect(a.longestQuietGap).toBeNull();
    expect(r.friends.added).toBe(n);
    expect(r.memories!.total).toBe(n);
  });
});

describe("computeYearInReview privacy", () => {
  const CANARY = "zqcanary_year_user";

  it("never carries a username, conversation or text into any part of the result", () => {
    const chats = Array.from({ length: 40 }, (_, i) => ({
      conversation: i % 2 ? CANARY.toUpperCase() : CANARY,
      isGroup: false,
      direction: i % 3 === 0 ? "sent" : "received",
      kind: "TEXT",
      at: at(2024, 1, 1) + i * HOUR,
    })) as ChatEvent[];
    (chats[0] as unknown as Record<string, unknown>).text = "ZQCANARY-MSG-1";
    const friends = [{ username: CANARY, createdAt: at(2024, 1, 2), displayName: "ZQCANARY-NAME" }] as unknown as FriendRecord[];
    const gone = [{ username: `${CANARY}_2`, deletedAt: at(2024, 1, 3) }] as DeletedFriendRecord[];
    const memories = [{ id: "ZQCANARY-ID", date: at(2024, 1, 4), mediaType: "image", downloadUrl: "https://zqcanary.example/x", zipPath: "zqcanary/p.jpg" }] as MemoryItem[];
    const r = computeYearInReview({ chats, friends, deletedFriends: gone, memories }, { now: NOW, utcOffsetMinutes: 99_999 });
    const json = JSON.stringify(r).toLowerCase();
    expect(json).not.toContain("zqcanary");
    expect(r.friends).toEqual({ added: 1, removed: 1 });
    expect(r.memories!.total).toBe(1);
  });

  it("notes hold only a stable code and numbers", () => {
    const r = computeYearInReview(
      { chats: [sent(NOW + DAY), unk(at(2024, 1, 1)), { direction: "sent" }], friends: [{}] },
      { now: NOW, utcOffsetMinutes: 99_999, year: 12.5 },
    );
    expect(r.notes.length).toBeGreaterThan(4);
    for (const n of r.notes) {
      expect(n.code).toMatch(/^[a-z]+(-[a-z]+)*$/);
      for (const v of Object.values(n.params)) expect(typeof v).toBe("number");
    }
  });
});

/** The plain way to compute the same summary: a Date per item, Maps and Sets, a sorted list of days. */
function referenceYear(input: YearInput, year: number, now: number, offsetMinutes: number) {
  const usable = (t: unknown): t is number => typeof t === "number" && Number.isFinite(t) && t > 0 && t <= MAX_EVENT_TIME && t <= now;
  const local = (t: number) => new Date(t + offsetMinutes * 60_000);
  const label = (d: Date) => d.toISOString().slice(0, 10);
  const months = Array.from({ length: 12 }, () => ({ total: 0, sent: 0, received: 0, unknown: 0 }));
  const kinds = { snaps: 0, chats: 0 };
  const days = new Map<string, number>();
  const dir = { sent: 0, received: 0, unknown: 0 };
  let first: number | null = null;
  let last: number | null = null;
  for (const e of input.chats ?? []) {
    if (!usable(e.at)) continue;
    const d = local(e.at);
    if (d.getUTCFullYear() !== year) continue;
    const dr = e.direction === "sent" || e.direction === "received" ? e.direction : "unknown";
    const m = months[d.getUTCMonth()]!;
    m.total++;
    m[dr]++;
    dir[dr]++;
    const k = String(e.kind ?? "").trim().toUpperCase();
    if (k === "IMAGE" || k === "VIDEO") kinds.snaps++;
    else kinds.chats++;
    days.set(label(d), (days.get(label(d)) ?? 0) + 1);
    first = first === null ? e.at : Math.min(first, e.at);
    last = last === null ? e.at : Math.max(last, e.at);
  }
  const sortedDays = [...days.keys()].sort();
  let gap = 0;
  let gapStart = "";
  for (let i = 1; i < sortedDays.length; i++) {
    const quiet = Math.round((Date.parse(sortedDays[i]!) - Date.parse(sortedDays[i - 1]!)) / DAY) - 1;
    if (quiet > gap) {
      gap = quiet;
      gapStart = label(new Date(Date.parse(sortedDays[i - 1]!) + DAY));
    }
  }
  const busiestDayCount = Math.max(0, ...days.values());
  const busiestDay = sortedDays.find((d) => days.get(d) === busiestDayCount) ?? null;
  const inYear = (t: unknown) => usable(t) && local(t).getUTCFullYear() === year;
  const memories = Array.from({ length: 12 }, () => ({ image: 0, video: 0, unknown: 0 }));
  for (const mm of input.memories ?? []) {
    if (!inYear(mm.date)) continue;
    const type = mm.mediaType === "image" || mm.mediaType === "video" ? mm.mediaType : "unknown";
    memories[local(mm.date as number).getUTCMonth()]![type]++;
  }
  return {
    months,
    kinds,
    dir,
    activeDays: days.size,
    gap,
    gapStart,
    busiestDay,
    busiestDayCount,
    first,
    last,
    added: (input.friends ?? []).filter((f) => inYear(f.createdAt)).length,
    removed: (input.deletedFriends ?? []).filter((f) => inYear(f.deletedAt)).length,
    memories,
  };
}

describe("computeYearInReview agrees with the plain way of counting", () => {
  // A small seeded generator, so a failure is reproducible.
  const rng = (seed: number) => () => ((seed = (seed * 1_664_525 + 1_013_904_223) >>> 0) / 2 ** 32);
  const directions = ["sent", "received", "unknown", "mystery", undefined] as const;
  const kinds = ["TEXT", "IMAGE", "video", "MEDIA", undefined] as const;
  const media = ["image", "video", "unknown", "x", undefined] as const;

  function time(next: () => number): number | null | undefined {
    const roll = next();
    return roll < 0.03 ? NaN
      : roll < 0.06 ? -5
      : roll < 0.09 ? NOW + Math.floor(next() * 40) * DAY
      : roll < 0.1 ? MAX_EVENT_TIME + 1
      : roll < 0.12 ? undefined
      : roll < 0.14 ? null
      : roll < 0.2 ? at(2023, 12, 31, 20) + Math.floor(next() * 8 * HOUR) // around a year boundary
      : roll < 0.26 ? at(2024, 2, 28) + Math.floor(next() * 3 * DAY) // around the leap day
      : NOW - Math.floor(next() * 3 * 365 * DAY);
  }

  it("gives the same counts, months, days, gaps and friend and memory totals for many shapes of input and every time zone", () => {
    const next = rng(11);
    const offsets = [-720, -300, -210, 0, 60, 330, 345, 525, 840];
    for (const count of [0, 1, 2, 3, 5, 17, 200, 1200]) {
      const input: YearInput = {
        chats: Array.from({ length: count }, () => ({ direction: directions[Math.floor(next() * 5)], kind: kinds[Math.floor(next() * 5)], at: time(next) })),
        friends: Array.from({ length: count >> 1 }, () => ({ createdAt: time(next) })),
        deletedFriends: Array.from({ length: count >> 2 }, () => ({ deletedAt: time(next) })),
        memories: Array.from({ length: count }, () => ({ date: time(next), mediaType: media[Math.floor(next() * 5)] })),
      };
      for (const offset of offsets) {
        for (const year of [2022, 2023, 2024, 2025]) {
          const label = `${count} items, ${year} at ${offset}`;
          const got = computeYearInReview(input, { now: NOW, year, utcOffsetMinutes: offset });
          const want = referenceYear(input, year, NOW, offset);
          if (got.activity) {
            const a = got.activity;
            expect(a.byMonth.map(({ month: _m, ...c }) => c), label).toEqual(want.months);
            expect({ snaps: a.snaps.total, chats: a.chats.total }, label).toEqual(want.kinds);
            expect({ sent: a.total.sent, received: a.total.received, unknown: a.total.unknown }, label).toEqual(want.dir);
            expect(a.activeDays, label).toBe(want.activeDays);
            expect(a.longestQuietGap?.days ?? 0, label).toBe(want.gap);
            if (want.gap > 0) expect(a.longestQuietGap!.startDay, label).toBe(want.gapStart);
            expect(a.busiestDay?.key ?? null, label).toBe(want.busiestDay);
            expect(a.busiestDay?.count ?? 0, label).toBe(want.busiestDayCount);
            expect(a.first, label).toBe(want.first);
            expect(a.last, label).toBe(want.last);
          }
          if (got.friends.added !== null) expect(got.friends.added, label).toBe(want.added);
          if (got.friends.removed !== null) expect(got.friends.removed, label).toBe(want.removed);
          if (got.memories) {
            expect(got.memories.byMonth.map(({ month: _m, total: _t, ...c }) => c), label).toEqual(want.memories);
          }
        }
      }
    }
  });
});

describe("computeYearInReview on a synthetic export", () => {
  it("summarizes the generated chats, friends and Memories", () => {
    const parsed = parseExportZip(syntheticExportZip({ now: NOW, phase: 2, realisticMemories: true }));
    const input: YearInput = {
      chats: parsed.chats,
      friends: parsed.friends.friends,
      deletedFriends: parsed.friends.deletedFriends,
      memories: parsed.memories,
    };
    const r = computeYearInReview(input, { now: NOW, utcOffsetMinutes: -300 });
    expect(r.year).not.toBeNull();
    const want = referenceYear(input, r.year!, NOW, -300);
    expect(r.activity).not.toBeNull();
    expect(r.activity!.total.total).toBe(want.months.reduce((s, m) => s + m.total, 0));
    expect(r.activity!.total.total).toBeGreaterThan(0);
    expect(r.activity!.busiestMonth).not.toBeNull();
    expect(r.activity!.busiestDay!.key).toBe(want.busiestDay);
    expect(r.friends.added).toBe(want.added);
    expect(r.memories!.byMonth.map(({ month: _m, total: _t, ...c }) => c)).toEqual(want.memories);
    expect(JSON.stringify(r)).not.toMatch(/active_\d|ghost_\d|ZQCANARY/i);
  });
});
