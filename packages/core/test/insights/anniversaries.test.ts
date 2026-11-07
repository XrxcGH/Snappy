import { describe, expect, it } from "vitest";
import { findAnniversaries } from "../../src/insights/anniversaries.ts";
import { DAY_MS } from "../../src/util.ts";

const NOW = Date.UTC(2025, 5, 10, 12, 0, 0); // Jun 10, 2025 noon UTC
const at = (y: number, m: number, d: number, h = 12) => Date.UTC(y, m - 1, d, h);

describe("findAnniversaries", () => {
  it("handles empty input", () => {
    const r = findAnniversaries([], { now: NOW });
    expect(r.upcoming).toEqual([]);
    expect(r.milestones).toEqual([]);
    expect(r.notes).toEqual([]);
    expect(r.counts.friends).toBe(0);
    expect(r.windowDays).toBe(30);
  });

  it("finds a single upcoming anniversary with years and day count", () => {
    const r = findAnniversaries([{ username: "alpha_one", createdAt: at(2022, 6, 20) }], { now: NOW });
    expect(r.upcoming).toEqual([
      { username: "alpha_one", years: 3, on: "2025-06-20", daysUntil: 10, milestone: true, leapDayShifted: false },
    ]);
    expect(r.milestones).toHaveLength(1);
    expect(r.notes.map((n) => n.code)).toEqual(["export-date-caveat"]);
  });

  it("includes today (day 0) and the last day of the window, excludes day after and yesterday", () => {
    const r = findAnniversaries(
      [
        { username: "today", createdAt: at(2020, 6, 10, 1) },
        { username: "edge", createdAt: at(2020, 7, 10) },
        { username: "after", createdAt: at(2020, 7, 11) },
        { username: "yesterday", createdAt: at(2020, 6, 9) },
      ],
      { now: NOW },
    );
    expect(r.upcoming.map((x) => [x.username, x.daysUntil, x.years])).toEqual([
      ["today", 0, 5],
      ["edge", 30, 5],
    ]);
  });

  it("rolls into the next year at year end", () => {
    const now = at(2025, 12, 25);
    const r = findAnniversaries([{ username: "ny", createdAt: at(2022, 1, 3) }], { now, windowDays: 30 });
    expect(r.upcoming[0]).toMatchObject({ on: "2026-01-03", years: 4, daysUntil: 9, milestone: false });
  });

  it("never reports a zero-year anniversary", () => {
    const r = findAnniversaries(
      [
        { username: "same_day", createdAt: at(2025, 6, 10, 3) },
        { username: "earlier_this_year", createdAt: NOW - 200 * DAY_MS },
      ],
      { now: NOW, windowDays: 366 },
    );
    expect(r.upcoming.every((x) => x.years >= 1)).toBe(true);
  });

  it("moves a Feb 29 anniversary to Feb 28 in non-leap years and keeps it in leap years", () => {
    const born = at(2020, 2, 29);
    const non = findAnniversaries([{ username: "leap", createdAt: born }], { now: at(2025, 2, 20) });
    expect(non.upcoming[0]).toMatchObject({ on: "2025-02-28", years: 5, daysUntil: 8, leapDayShifted: true });
    const leap = findAnniversaries([{ username: "leap", createdAt: born }], { now: at(2028, 2, 20) });
    expect(leap.upcoming[0]).toMatchObject({ on: "2028-02-29", years: 8, daysUntil: 9, leapDayShifted: false });
  });

  it("uses the caller's UTC offset for both today and the creation day", () => {
    // 2022-06-11 02:00 UTC is still Jun 10 at UTC-5.
    const created = Date.UTC(2022, 5, 11, 2);
    const utc = findAnniversaries([{ username: "tz", createdAt: created }], { now: NOW, windowDays: 5 });
    expect(utc.upcoming[0]?.on).toBe("2025-06-11");
    const west = findAnniversaries([{ username: "tz", createdAt: created }], { now: NOW, windowDays: 5, utcOffsetMinutes: -300 });
    expect(west.upcoming[0]).toMatchObject({ on: "2025-06-10", daysUntil: 0 });
    // 15:00 UTC is already Jun 11 at UTC+10, and the creation day is Jun 11 there too.
    const east = findAnniversaries([{ username: "tz", createdAt: created }], {
      now: Date.UTC(2025, 5, 10, 15),
      windowDays: 5,
      utcOffsetMinutes: 600,
    });
    expect(east.upcoming[0]).toMatchObject({ on: "2025-06-11", daysUntil: 0 });
  });

  it("clamps absurd options", () => {
    const r = findAnniversaries([{ username: "a", createdAt: at(2020, 6, 10) }], {
      now: NOW,
      windowDays: 99999,
      utcOffsetMinutes: Number.NaN,
    });
    expect(r.windowDays).toBe(366);
    expect(findAnniversaries([], { now: NOW, windowDays: -5 }).windowDays).toBe(0);
  });

  it("treats an infinite window as the maximum and keeps NaN at the default", () => {
    const friends = [{ username: "far", createdAt: at(2020, 6, 10) }];
    expect(findAnniversaries(friends, { now: NOW, windowDays: Infinity }).windowDays).toBe(366);
    expect(findAnniversaries(friends, { now: NOW, windowDays: -Infinity }).windowDays).toBe(0);
    expect(findAnniversaries(friends, { now: NOW, windowDays: Number.NaN }).windowDays).toBe(30);
    expect(findAnniversaries(friends, { now: NOW, windowDays: Infinity }).upcoming).toHaveLength(1);
  });

  it("counts and skips empty usernames so counts reconcile with the input", () => {
    const input = [
      { username: "", createdAt: at(2020, 6, 11) },
      { username: "   ", createdAt: at(2020, 6, 11) },
      { username: "real_one", createdAt: at(2020, 6, 11) },
      { username: "REAL_ONE" },
    ];
    const r = findAnniversaries(input, { now: NOW });
    expect(r.counts).toMatchObject({ friends: 1, duplicatesMerged: 1, invalidUsername: 2 });
    expect(r.counts.friends + r.counts.duplicatesMerged + r.counts.invalidUsername).toBe(input.length);
    expect(r.notes).toContainEqual({ code: "invalid-username", params: { count: 2 } });
    expect(findAnniversaries([{ username: " " }], { now: NOW }).notes).toEqual([
      { code: "invalid-username", params: { count: 1 } },
    ]);
  });

  it("counts and skips missing, invalid and future dates", () => {
    const r = findAnniversaries(
      [
        { username: "none" },
        { username: "nan", createdAt: Number.NaN },
        { username: "zero", createdAt: 0 },
        { username: "future", createdAt: NOW + DAY_MS },
        { username: "ok", createdAt: at(2020, 6, 11) },
      ],
      { now: NOW },
    );
    expect(r.counts).toMatchObject({ friends: 5, dated: 1, missingDate: 3, futureDate: 1, upcoming: 1 });
    expect(r.notes).toEqual([
      { code: "export-date-caveat", params: {} },
      { code: "created-at-missing", params: { count: 3 } },
      { code: "created-at-future", params: { count: 1 } },
    ]);
  });

  it("merges case duplicates and keeps the earliest date", () => {
    const r = findAnniversaries(
      [
        { username: "Dup_User", createdAt: at(2023, 6, 12) },
        { username: "dup_user", createdAt: at(2020, 6, 12) },
        { username: "DUP_USER" },
      ],
      { now: NOW },
    );
    expect(r.upcoming).toHaveLength(1);
    expect(r.upcoming[0]).toMatchObject({ username: "dup_user", years: 5 });
    expect(r.counts.duplicatesMerged).toBe(2);
    expect(r.notes).toContainEqual({ code: "duplicate-usernames", params: { count: 2 } });
  });

  it("flags milestones and accepts custom ones", () => {
    const friends = [
      { username: "m10", createdAt: at(2015, 6, 15) },
      { username: "m4", createdAt: at(2021, 6, 15) },
    ];
    const d = findAnniversaries(friends, { now: NOW });
    expect(d.milestones.map((x) => x.username)).toEqual(["m10"]);
    const c = findAnniversaries(friends, { now: NOW, milestones: [4] });
    expect(c.milestones.map((x) => x.username)).toEqual(["m4"]);
  });

  it("flags the default milestones 1, 2, 3, 5 and 10 and not 4", () => {
    const friends = [1, 2, 3, 4, 5, 10].map((y) => ({ username: `y${y}`, createdAt: at(2025 - y, 6, 15) }));
    const r = findAnniversaries(friends, { now: NOW });
    expect(r.upcoming).toHaveLength(6);
    expect(r.upcoming.filter((x) => x.milestone).map((x) => x.years).sort((a, b) => a - b)).toEqual([1, 2, 3, 5, 10]);
    expect(r.upcoming.find((x) => x.years === 4)?.milestone).toBe(false);
  });

  it("treats a date equal to now as not in the future, but a millisecond later as future", () => {
    const same = findAnniversaries([{ username: "same", createdAt: NOW }], { now: NOW, windowDays: 366 });
    expect(same.counts).toMatchObject({ dated: 1, futureDate: 0 });
    expect(same.upcoming[0]).toMatchObject({ years: 1, on: "2026-06-10", daysUntil: 365 });
    const later = findAnniversaries([{ username: "later", createdAt: NOW + 1 }], { now: NOW, windowDays: 366 });
    expect(later.counts).toMatchObject({ dated: 0, futureDate: 1, upcoming: 0 });
  });

  it("orders by days, then more years, then username", () => {
    const r = findAnniversaries(
      [
        { username: "zed", createdAt: at(2023, 6, 15) },
        { username: "amy", createdAt: at(2023, 6, 15) },
        { username: "old", createdAt: at(2015, 6, 15) },
        { username: "soon", createdAt: at(2024, 6, 11) },
      ],
      { now: NOW },
    );
    expect(r.upcoming.map((x) => x.username)).toEqual(["soon", "old", "amy", "zed"]);
  });

  it("is deterministic regardless of input order", () => {
    const friends = Array.from({ length: 50 }, (_, i) => ({ username: `u${i}`, createdAt: at(2020, 6, 11 + (i % 10)) }));
    const a = findAnniversaries(friends, { now: NOW });
    const b = findAnniversaries([...friends].reverse(), { now: NOW });
    expect(b).toEqual(a);
  });

  it("returns a note and nothing else when now is invalid", () => {
    const r = findAnniversaries([{ username: "a", createdAt: at(2020, 6, 11) }], { now: Number.NaN });
    expect(r.upcoming).toEqual([]);
    expect(r.notes).toEqual([{ code: "now-invalid", params: {} }]);
    expect(r.windowDays).toBe(30);
    expect(r.milestones).toEqual([]);
    expect(r.counts).toEqual({
      friends: 0,
      dated: 0,
      missingDate: 0,
      futureDate: 0,
      duplicatesMerged: 0,
      invalidUsername: 0,
      upcoming: 0,
      milestones: 0,
    });
  });

  it("handles 20 000 friends quickly", () => {
    const friends = Array.from({ length: 20_000 }, (_, i) => ({
      username: `bulk_${i}`,
      createdAt: i % 7 === 0 ? undefined : at(2015, 1, 1) + i * 3 * 3_600_000,
    }));
    const t = performance.now();
    const r = findAnniversaries(friends, { now: NOW, windowDays: 366 });
    expect(performance.now() - t).toBeLessThan(1500);
    expect(r.counts.friends).toBe(20_000);
    expect(r.counts.missingDate).toBe(Math.ceil(20_000 / 7));
  });

  it("keeps usernames out of notes, counts and codes (canary)", () => {
    const canary = "zq_canary_9f3k";
    const r = findAnniversaries(
      [
        { username: canary, createdAt: at(2020, 6, 12) },
        { username: canary.toUpperCase(), createdAt: at(2021, 6, 12) },
        { username: `${canary}_nodate` },
        { username: `${canary}_future`, createdAt: NOW + DAY_MS },
      ],
      { now: NOW },
    );
    expect(r.upcoming.map((x) => x.username)).toEqual([canary]);
    const rest = JSON.stringify({ notes: r.notes, counts: r.counts, windowDays: r.windowDays });
    expect(rest).not.toContain("canary");
    const rowsWithoutName = JSON.stringify(r.upcoming.map(({ username: _u, ...x }) => x));
    expect(rowsWithoutName).not.toContain("canary");
  });
});
