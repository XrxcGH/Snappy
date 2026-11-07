import { describe, expect, it } from "vitest";
import {
  addMonths,
  buildExportReminder,
  escapeIcsText,
  foldIcsLine,
  REMINDER_UID,
  reminderUid,
  validateIcs,
  type ReminderOptions,
} from "../../src/insights/export-reminder.ts";

const NOW = Date.UTC(2026, 10, 7, 15, 30, 45); // Nov 7, 2026
const day = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d, 12);
const CANARY = "canary_zq9x_username";

const build = (extra: Partial<ReminderOptions> = {}) =>
  buildExportReminder({ now: NOW, lastExportAt: day(2026, 10, 15), ...extra });

const lineOf = (ics: string, name: string) => ics.split("\r\n").find((l) => l.startsWith(name));

describe("addMonths", () => {
  it("adds calendar months and clamps at month end", () => {
    expect(addMonths({ year: 2026, month: 1, day: 31 }, 1)).toMatchObject({ month: 2, day: 28, clamped: true });
    expect(addMonths({ year: 2024, month: 1, day: 31 }, 1)).toMatchObject({ month: 2, day: 29, clamped: true });
    expect(addMonths({ year: 2026, month: 11, day: 30 }, 3)).toMatchObject({ year: 2027, month: 2, day: 28 });
    expect(addMonths({ year: 2026, month: 8, day: 31 }, 1)).toMatchObject({ month: 9, day: 30 });
    expect(addMonths({ year: 2026, month: 3, day: 15 }, 3)).toEqual({ year: 2026, month: 6, day: 15, clamped: false });
  });
  it("crosses years in both directions of the calendar", () => {
    expect(addMonths({ year: 2026, month: 12, day: 1 }, 1)).toMatchObject({ year: 2027, month: 1 });
    expect(addMonths({ year: 2026, month: 12, day: 31 }, 12)).toMatchObject({ year: 2027, month: 12, day: 31 });
    expect(addMonths({ year: 2026, month: 12, day: 31 }, 24)).toMatchObject({ year: 2028, month: 12, day: 31 });
  });
});

describe("buildExportReminder", () => {
  it("builds a valid all-day event three months after the last export", () => {
    const r = build();
    expect(validateIcs(r.ics)).toEqual({ valid: true, issues: [] });
    expect(r.due).toEqual({ year: 2027, month: 1, day: 15 });
    expect(r.allDay).toBe(true);
    expect(r.intervalMonths).toBe(3);
    expect(r.notes).toEqual([]);
    expect(lineOf(r.ics, "DTSTART")).toBe("DTSTART;VALUE=DATE:20270115");
    expect(lineOf(r.ics, "DTEND")).toBe("DTEND;VALUE=DATE:20270116");
    expect(lineOf(r.ics, "DTSTAMP")).toBe("DTSTAMP:20261107T153045Z");
    expect(r.dueAt).toBe(Date.UTC(2027, 0, 15));
  });

  it("uses CRLF only and ends with a final CRLF", () => {
    const { ics } = build({ alarmDaysBefore: 1 });
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "").includes("\n")).toBe(false);
    expect(ics.replace(/\r\n/g, "").includes("\r")).toBe(false);
  });

  it("clamps the day at month end and says so", () => {
    const r = build({ lastExportAt: day(2026, 11, 30), now: day(2026, 12, 1) });
    expect(r.due).toEqual({ year: 2027, month: 2, day: 28 });
    expect(r.notes).toEqual([{ code: "day-clamped", params: { from: 30, to: 28 } }]);
    expect(validateIcs(r.ics).valid).toBe(true);
  });

  it("honors a custom interval and repairs a bad one", () => {
    expect(build({ intervalMonths: 6 }).due).toEqual({ year: 2027, month: 4, day: 15 });
    for (const bad of [0, -2, 1.5, 121, Number.NaN, Infinity]) {
      const r = build({ intervalMonths: bad });
      expect(r.intervalMonths).toBe(3);
      expect(r.notes).toEqual([{ code: "interval-adjusted", params: { used: 3 } }]);
    }
  });

  it("builds a timed event with floating times and a default of 9:00 for 30 minutes", () => {
    const r = build({ timed: {} });
    expect(r.allDay).toBe(false);
    expect(lineOf(r.ics, "DTSTART")).toBe("DTSTART:20270115T090000");
    expect(lineOf(r.ics, "DTEND")).toBe("DTEND:20270115T093000");
    expect(validateIcs(r.ics).valid).toBe(true);
  });

  it("lets a timed event run past midnight and repairs bad times", () => {
    const r = build({ timed: { hour: 23, minute: 45, durationMinutes: 30 } });
    expect(lineOf(r.ics, "DTEND")).toBe("DTEND:20270116T001500");
    expect(validateIcs(r.ics).valid).toBe(true);
    const bad = build({ timed: { hour: 25, minute: 61, durationMinutes: 0 } });
    expect(lineOf(bad.ics, "DTSTART")).toBe("DTSTART:20270115T090000");
    expect(bad.notes).toEqual([{ code: "time-adjusted", params: { hour: 9, minute: 0, durationMinutes: 30 } }]);
  });

  it("adds a valid alarm only when asked", () => {
    expect(build().ics).not.toContain("VALARM");
    const cases: [Partial<ReminderOptions>, string][] = [
      [{ alarmDaysBefore: 0 }, "TRIGGER:PT9H"],
      [{ alarmDaysBefore: 1 }, "TRIGGER:-PT15H"],
      [{ alarmDaysBefore: 7 }, "TRIGGER:-PT159H"],
      [{ alarmDaysBefore: 0, timed: {} }, "TRIGGER:PT0S"],
      [{ alarmDaysBefore: 2, timed: {} }, "TRIGGER:-P2D"],
    ];
    for (const [extra, trigger] of cases) {
      const r = build(extra);
      expect(r.ics).toContain(trigger);
      expect(r.ics).toContain("ACTION:DISPLAY");
      expect(validateIcs(r.ics)).toEqual({ valid: true, issues: [] });
    }
    const odd = build({ alarmDaysBefore: 99 });
    expect(odd.notes).toEqual([{ code: "alarm-adjusted", params: { used: 0 } }]);
    expect(validateIcs(odd.ics).valid).toBe(true);
  });

  it("treats null like a missing value for the interval, timed and alarm options", () => {
    const r = build({ intervalMonths: null, timed: null, alarmDaysBefore: null });
    expect(r).toEqual(build());
    expect(r.allDay).toBe(true);
    expect(r.notes).toEqual([]);
    expect(r.ics).not.toContain("VALARM");
    const t = build({ timed: { hour: null, minute: null, durationMinutes: null } });
    expect(t.allDay).toBe(false);
    expect(lineOf(t.ics, "DTSTART")).toBe("DTSTART:20270115T090000");
    expect(t.notes).toEqual([]);
  });

  it("repairs odd runtime values instead of throwing", () => {
    const odd = (extra: unknown) => build(extra as Partial<ReminderOptions>);
    expect(odd({ alarmDaysBefore: "2" }).notes).toEqual([{ code: "alarm-adjusted", params: { used: 0 } }]);
    expect(odd({ intervalMonths: "6" }).notes).toEqual([{ code: "interval-adjusted", params: { used: 3 } }]);
    expect(odd({ timed: true }).allDay).toBe(false);
    expect(validateIcs(odd({ timed: "x", alarmDaysBefore: {} }).ics).valid).toBe(true);
  });

  it("starts from today when the last export is missing, invalid or in the future", () => {
    const fromToday = { year: 2027, month: 2, day: 7 };
    for (const [value, code] of [
      [undefined, "no-last-export"],
      [null, "no-last-export"],
      [Number.NaN, "last-export-invalid"],
      [Infinity, "last-export-invalid"],
      [-5, "last-export-invalid"],
      [8.64e15, "last-export-invalid"],
      [NOW + 5 * 86_400_000, "last-export-in-future"],
    ] as const) {
      const r = build({ lastExportAt: value });
      expect(r.due).toEqual(fromToday);
      expect(r.notes).toEqual([{ code, params: {} }]);
      expect(validateIcs(r.ics).valid).toBe(true);
    }
  });

  it("moves a due date that has already passed to tomorrow", () => {
    const r = build({ lastExportAt: day(2025, 1, 10) });
    expect(r.due).toEqual({ year: 2026, month: 11, day: 8 });
    expect(r.notes).toEqual([{ code: "due-date-passed", params: {} }]);
    // Today itself is fine.
    expect(build({ lastExportAt: day(2026, 8, 7) }).due).toEqual({ year: 2026, month: 11, day: 7 });
    expect(build({ lastExportAt: day(2026, 8, 7) }).notes).toEqual([]);
  });

  it("counts UTC calendar days by default: an evening export west of UTC lands on the next UTC day", () => {
    // 2026-10-16 02:00 UTC is still the evening of Oct 15 at UTC-5.
    const lastExportAt = Date.UTC(2026, 9, 16, 2, 0, 0);
    expect(build({ lastExportAt }).due).toEqual({ year: 2027, month: 1, day: 16 });
    expect(build({ lastExportAt, utcOffsetMinutes: -300 }).due).toEqual({ year: 2027, month: 1, day: 15 });
    expect(build({ lastExportAt, utcOffsetMinutes: 0 }).due).toEqual({ year: 2027, month: 1, day: 16 });
    // dueAt stays a midnight-UTC label of the due day.
    expect(build({ lastExportAt, utcOffsetMinutes: -300 }).dueAt).toBe(Date.UTC(2027, 0, 15));
  });

  it("uses the offset for today and for east-of-UTC exports too", () => {
    const early = Date.UTC(2026, 10, 7, 2, 0, 0); // Nov 6, 21:00 at UTC-5
    const noLast = { now: early, lastExportAt: undefined } as const;
    expect(build({ ...noLast }).due).toEqual({ year: 2027, month: 2, day: 7 });
    expect(build({ ...noLast, utcOffsetMinutes: -300 }).due).toEqual({ year: 2027, month: 2, day: 6 });
    const lastExportAt = Date.UTC(2026, 9, 15, 23, 30, 0); // Oct 16, 00:30 at UTC+1
    expect(build({ lastExportAt }).due.day).toBe(15);
    expect(build({ lastExportAt, utcOffsetMinutes: 60 }).due.day).toBe(16);
  });

  it("accepts offsets from -840 to 840 and repairs others", () => {
    for (const ok of [-840, 840, 0, 330]) expect(build({ utcOffsetMinutes: ok }).notes).toEqual([]);
    for (const bad of [-841, 841, 1.5, Number.NaN, Infinity]) {
      const r = build({ utcOffsetMinutes: bad });
      expect(r.notes).toEqual([{ code: "offset-adjusted", params: { used: 0 } }]);
      expect(r.due).toEqual(build().due);
    }
    expect(build({ utcOffsetMinutes: null })).toEqual(build());
  });

  it("rolls tomorrow over a month and year end", () => {
    const r = buildExportReminder({ now: Date.UTC(2026, 11, 31, 23, 59), lastExportAt: day(2020, 1, 1) });
    expect(r.due).toEqual({ year: 2027, month: 1, day: 1 });
  });

  it("throws a plain RangeError for an unusable now", () => {
    for (const now of [Number.NaN, Infinity, -1, Date.UTC(9500, 0, 1)]) {
      expect(() => buildExportReminder({ now })).toThrow(RangeError);
    }
  });

  it("is deterministic", () => {
    expect(build()).toEqual(build());
    expect(build({ timed: {}, alarmDaysBefore: 1 }).ics).toBe(build({ timed: {}, alarmDaysBefore: 1 }).ics);
  });

});

describe("boundaries", () => {
  it("accepts intervals 1 and 120 and rejects 0 and 121", () => {
    expect(build({ intervalMonths: 1 }).due).toEqual({ year: 2026, month: 11, day: 15 });
    expect(build({ intervalMonths: 1 }).notes).toEqual([]);
    const long = build({ intervalMonths: 120 });
    expect(long.due).toEqual({ year: 2036, month: 10, day: 15 });
    expect(long.intervalMonths).toBe(120);
    expect(long.notes).toEqual([]);
    expect(build({ intervalMonths: 0 }).intervalMonths).toBe(3);
    expect(build({ intervalMonths: 121 }).intervalMonths).toBe(3);
  });

  it("accepts alarm days up to 30 and repairs 31 and -1", () => {
    const ok = build({ alarmDaysBefore: 30 });
    expect(ok.notes).toEqual([]);
    expect(ok.ics).toContain("TRIGGER:-PT711H"); // 30 * 24 - 9
    expect(build({ alarmDaysBefore: 30, timed: {} }).ics).toContain("TRIGGER:-P30D");
    for (const bad of [31, -1]) {
      expect(build({ alarmDaysBefore: bad }).notes).toEqual([{ code: "alarm-adjusted", params: { used: 0 } }]);
    }
  });

  it("treats a last export equal to now as today, with no future note", () => {
    const r = build({ lastExportAt: NOW });
    expect(r.due).toEqual({ year: 2027, month: 2, day: 7 });
    expect(r.notes).toEqual([]);
    const justAfter = build({ lastExportAt: NOW + 1 });
    expect(justAfter.notes).toEqual([{ code: "last-export-in-future", params: {} }]);
  });

  it("accepts a last export at the epoch (due date long past) and rejects one before it", () => {
    const r = build({ lastExportAt: 0 });
    expect(r.notes).toEqual([{ code: "due-date-passed", params: {} }]);
    expect(r.due).toEqual({ year: 2026, month: 11, day: 8 });
    expect(build({ lastExportAt: -1 }).notes).toEqual([{ code: "last-export-invalid", params: {} }]);
  });

  it("clamps a Feb 29 base with a 12-month interval to Feb 28", () => {
    const r = build({ now: day(2028, 3, 1), lastExportAt: day(2028, 2, 29), intervalMonths: 12 });
    expect(r.due).toEqual({ year: 2029, month: 2, day: 28 });
    expect(r.notes).toEqual([{ code: "day-clamped", params: { from: 29, to: 28 } }]);
    const leap = build({ now: day(2028, 3, 1), lastExportAt: day(2028, 2, 29), intervalMonths: 48 });
    expect(leap.due).toEqual({ year: 2032, month: 2, day: 29 });
    expect(leap.notes).toEqual([]);
  });

  it("pins UTC-day semantics: 23:59:59 UTC and 00:00:00 UTC fall on different days", () => {
    const before = build({ lastExportAt: Date.UTC(2026, 9, 15, 23, 59, 59) });
    const after = build({ lastExportAt: Date.UTC(2026, 9, 16, 0, 0, 0) });
    expect(before.due).toEqual({ year: 2027, month: 1, day: 15 });
    expect(after.due).toEqual({ year: 2027, month: 1, day: 16 });
  });
});

describe("uid", () => {
  it("is one fixed value that does not depend on any input", () => {
    expect(reminderUid()).toBe(REMINDER_UID);
    expect(REMINDER_UID).toBe("snappy-export-reminder@snappy-export.invalid");
    const uids = new Set<string>();
    for (let i = 0; i < 2_000; i++) {
      uids.add(build({ lastExportAt: NOW - i * 86_400_000, intervalMonths: 1 + (i % 12), timed: i % 2 ? {} : undefined }).uid);
    }
    expect([...uids]).toEqual([REMINDER_UID]);
  });
  it("ignores a username-like value that a caller still passes as a seed (older callers)", () => {
    const legacy = (seed: string) => buildExportReminder({ now: NOW, uidSeed: seed } as unknown as ReminderOptions);
    expect(legacy(CANARY).uid).toBe(REMINDER_UID);
    expect(legacy(CANARY).ics).toBe(legacy("someone_else").ics);
    expect(legacy(CANARY).ics.toLowerCase()).not.toContain("canary");
  });
});

describe("escapeIcsText", () => {
  it("escapes backslash, semicolon, comma and every kind of line break", () => {
    expect(escapeIcsText("a,b;c\\d")).toBe("a\\,b\\;c\\\\d");
    expect(escapeIcsText("one\ntwo\r\nthree\rfour")).toBe("one\\ntwo\\nthree\\nfour");
  });
  it("drops control characters and turns tabs into spaces", () => {
    expect(escapeIcsText("a\u0000b\u0007c\td\u007f")).toBe("abc d");
  });
  it("keeps non-ASCII text", () => {
    expect(escapeIcsText("café 😀")).toBe("café 😀");
  });
});

describe("foldIcsLine", () => {
  const octets = (s: string) => new TextEncoder().encode(s).length;
  it("leaves short lines alone and folds long ones at 75 octets", () => {
    expect(foldIcsLine("A".repeat(75))).toBe("A".repeat(75));
    const folded = foldIcsLine("B".repeat(200)).split("\r\n");
    expect(folded.every((l) => octets(l) <= 75)).toBe(true);
    expect(folded.slice(1).every((l) => l.startsWith(" "))).toBe(true);
    expect(folded.map((l, i) => (i === 0 ? l : l.slice(1))).join("")).toBe("B".repeat(200));
  });
  it("never splits a multi-byte character and unfolds back to the original", () => {
    const text = "SUMMARY:" + "é😀€".repeat(60);
    const folded = foldIcsLine(text);
    const parts = folded.split("\r\n");
    expect(parts.every((l) => octets(l) <= 75)).toBe(true);
    expect(parts.some((l) => /[\ud800-\udbff]$/.test(l))).toBe(false);
    expect(folded.replace(/\r\n /g, "")).toBe(text);
  });
  it("folds a very long line in linear time", () => {
    const t0 = Date.now();
    const out = foldIcsLine("x".repeat(2_000_000));
    expect(out.length).toBeGreaterThan(2_000_000);
    expect(Date.now() - t0).toBeLessThan(3_000);
  });
});

describe("generated text", () => {
  it("folds long lines in the real output and keeps every physical line at 75 octets or fewer", () => {
    const { ics } = build({ alarmDaysBefore: 1, timed: {} });
    const physical = ics.split("\r\n");
    expect(physical.some((l) => l.startsWith(" "))).toBe(true); // the description is long enough to fold
    expect(Math.max(...physical.map((l) => new TextEncoder().encode(l).length))).toBeLessThanOrEqual(75);
    expect(ics.replace(/\r\n /g, "")).toContain("fresh copy of your Snapchat data\\, so your lists stay current.\\nMade by Snappy");
  });
  it("holds no links, people or places", () => {
    const { ics } = build({ alarmDaysBefore: 1 });
    expect(ics).not.toMatch(/https?:|mailto:|:\/\//i);
    for (const name of ["URL", "ATTACH", "ATTENDEE", "ORGANIZER", "LOCATION", "GEO", "CONTACT"]) {
      expect(ics).not.toContain(`\r\n${name}`);
    }
    expect(ics).toContain("TRANSP:TRANSPARENT");
  });
});

describe("privacy canary", () => {
  // A username may reach the builder only through a stray property; it must never be written out.
  const withCanary = (extra: Partial<ReminderOptions>, value = CANARY) =>
    build({ ...extra, uidSeed: value, username: value } as unknown as Partial<ReminderOptions>);
  it("never writes a stray username into the text, uid, notes or validator issues", () => {
    const results = [
      withCanary({}),
      withCanary({ lastExportAt: undefined, timed: { hour: 99 }, alarmDaysBefore: 400, intervalMonths: 0 }, CANARY.toUpperCase()),
      withCanary({ lastExportAt: day(2020, 1, 31) }),
    ];
    for (const r of results) {
      const blob = JSON.stringify(r).toLowerCase();
      expect(blob).not.toContain("canary");
      expect(blob).not.toContain("zq9x");
      expect(JSON.stringify(validateIcs(r.ics))).not.toMatch(/canary|zq9x/i);
    }
    // The validator reports codes only, even for hostile input that contains the canary.
    const hostile = `BEGIN:VCALENDAR\r\nURL:https://${CANARY}.example/x\r\nEND:VCALENDAR\r\n`;
    const v = validateIcs(hostile);
    expect(v.valid).toBe(false);
    expect(JSON.stringify(v)).not.toMatch(/canary|zq9x|example/i);
  });
});

describe("validateIcs", () => {
  const good = build({ alarmDaysBefore: 1 }).ics;
  const codes = (text: string) => validateIcs(text).issues.map((i) => i.code);
  const swap = (from: string, to: string) => {
    expect(good).toContain(from);
    return good.replace(from, to);
  };

  it("accepts the generated text", () => {
    expect(validateIcs(good)).toEqual({ valid: true, issues: [] });
  });
  it("rejects empty and non-string input", () => {
    expect(codes("")).toEqual(["empty-input"]);
    expect(codes(undefined as unknown as string)).toEqual(["empty-input"]);
  });
  it("rejects bare LF and a missing final CRLF", () => {
    expect(codes(good.replace(/\r\n/g, "\n"))).toContain("bare-line-break");
    expect(codes(good.slice(0, -2))).toContain("missing-final-crlf");
  });
  it("rejects a line over 75 octets and a lone continuation", () => {
    expect(codes(swap("SEQUENCE:0", "X-LONG:" + "a".repeat(80)))).toContain("line-too-long");
    expect(codes(" stray\r\n" + good)).toContain("orphan-continuation");
  });
  it("rejects a fold that splits a character", () => {
    const split = swap("SEQUENCE:0", "X-A:\ud83d\r\n \ude00");
    expect(codes(split)).toContain("split-character");
  });
  it("rejects a missing or duplicated required property", () => {
    expect(codes(swap("UID:" + (lineOf(good, "UID") as string).slice(4), ""))).toContain("empty-line");
    expect(codes(good.replace(/UID:[^\r]*\r\n/, ""))).toContain("missing-uid");
    expect(codes(good.replace(/DTSTAMP:[^\r]*\r\n/, ""))).toContain("missing-dtstamp");
    expect(codes(good.replace(/DTSTART[^\r]*\r\n/, ""))).toContain("missing-dtstart");
    expect(codes(good.replace("VERSION:2.0\r\n", ""))).toContain("missing-version");
    expect(codes(good.replace(/PRODID:[^\r]*\r\n/, ""))).toContain("missing-prodid");
    expect(codes(swap("SEQUENCE:0", "UID:dup"))).toContain("duplicate-uid");
  });
  it("rejects bad versions, stamps and dates", () => {
    expect(codes(swap("VERSION:2.0", "VERSION:1.0"))).toContain("bad-version");
    expect(codes(swap("DTSTAMP:20261107T153045Z", "DTSTAMP:20261107T153045"))).toContain("bad-dtstamp");
    expect(codes(swap("DTSTAMP:20261107T153045Z", "DTSTAMP:20261307T153045Z"))).toContain("bad-dtstamp");
    expect(codes(swap("DTSTAMP:20261107T153045Z", "DTSTAMP:20261107T256045Z"))).toContain("bad-dtstamp");
    expect(codes(swap("DTSTART;VALUE=DATE:20270115", "DTSTART;VALUE=DATE:20270230"))).toContain("bad-dtstart");
    expect(codes(swap("DTSTART;VALUE=DATE:20270115", "DTSTART:20270115"))).toContain("bad-dtstart");
    expect(codes(swap("DTSTART;VALUE=DATE:20270115", "DTSTART;TZID=X:20270115T090000"))).toContain("bad-dtstart");
  });
  it("rejects DTEND problems", () => {
    expect(codes(swap("DTEND;VALUE=DATE:20270116", "DTEND;VALUE=DATE:20270115"))).toContain("dtend-not-after-dtstart");
    expect(codes(swap("DTEND;VALUE=DATE:20270116", "DTEND:20270116T000000"))).toContain("dtend-kind-mismatch");
    expect(codes(swap("DTEND;VALUE=DATE:20270116", "DTEND;VALUE=DATE:20270116\r\nDURATION:PT1H"))).toContain("dtend-and-duration");
  });
  it("rejects structure errors", () => {
    expect(codes(good.replace("END:VCALENDAR\r\n", ""))).toContain("unclosed-component");
    expect(codes(good.replace("END:VALARM", "END:VEVENT"))).toContain("mismatched-end");
    expect(codes(good + "X-AFTER:1\r\n")).toContain("content-after-end");
    expect(codes(good.replace("BEGIN:VCALENDAR\r\n", ""))).toContain("missing-vcalendar");
    expect(codes(good.replace("BEGIN:VEVENT", "BEGIN:VTODO").replace("END:VEVENT", "END:VTODO"))).toContain("unexpected-component");
    const two = good.replace("END:VEVENT\r\n", "END:VEVENT\r\nBEGIN:VEVENT\r\nEND:VEVENT\r\n");
    expect(codes(two)).toContain("expected-one-event");
    expect(codes("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n")).toContain("expected-one-event");
    expect(codes("VERSION:2.0\r\n")).toContain("property-outside-calendar");
    expect(codes("garbage\r\n")).toContain("malformed-line");
  });
  it("rejects bad escaping in text", () => {
    expect(codes(swap("SUMMARY:Request your next Snapchat export", "SUMMARY:a, b"))).toContain("bad-text-escape");
    expect(codes(swap("SUMMARY:Request your next Snapchat export", "SUMMARY:a;b"))).toContain("bad-text-escape");
    expect(codes(swap("SUMMARY:Request your next Snapchat export", "SUMMARY:a\\qb"))).toContain("bad-text-escape");
    expect(codes(swap("SUMMARY:Request your next Snapchat export", "SUMMARY:end\\"))).toContain("bad-text-escape");
  });
  it("rejects bad alarms", () => {
    expect(codes(swap("TRIGGER:-PT15H", "TRIGGER:soon"))).toContain("bad-trigger");
    expect(codes(swap("TRIGGER:-PT15H", "TRIGGER:PT"))).toContain("bad-trigger");
    expect(codes(swap("TRIGGER:-PT15H", "TRIGGER:P1DT"))).toContain("bad-trigger");
    expect(codes(swap("ACTION:DISPLAY", "ACTION:EMAIL"))).toContain("bad-alarm-action");
    expect(codes(good.replace(/ACTION:DISPLAY\r\n/, ""))).toContain("missing-action");
    expect(codes(good.replace("END:VALARM\r\n", "END:VALARM\r\nBEGIN:VALARM\r\nEND:VALARM\r\n"))).toContain("too-many-alarms");
  });
  it("accepts valid duration forms", () => {
    for (const t of ["-PT15M", "P1W", "-P1DT2H30M", "PT0S", "+PT5S"]) {
      expect(validateIcs(swap("TRIGGER:-PT15H", `TRIGGER:${t}`)).valid).toBe(true);
    }
  });
  it("rejects forbidden properties, links and control characters", () => {
    for (const name of ["URL", "ATTACH", "ATTENDEE", "ORGANIZER", "LOCATION", "GEO"]) {
      expect(codes(swap("SEQUENCE:0", `${name}:x`))).toContain("forbidden-property");
    }
    expect(codes(swap("SEQUENCE:0", "X-NOTE:see https://example.test/"))).toContain("link-in-value");
    expect(codes(swap("SEQUENCE:0", "X-NOTE:mailto:a"))).toContain("link-in-value");
    expect(codes(swap("SEQUENCE:0", "X-NOTE:a\u0001b"))).toContain("control-character");
    expect(codes(swap("SEQUENCE:0", "lower:1"))).toContain("bad-property-name");
    expect(codes(swap("SEQUENCE:0", "X-A;bad:1"))).toContain("bad-parameter");
  });
  it("reports 1-based line numbers", () => {
    const bad = swap("SEQUENCE:0", "URL:x");
    const line = validateIcs(bad).issues.find((i) => i.code === "forbidden-property")?.line as number;
    expect(bad.split("\r\n")[line - 1]).toBe("URL:x");
  });
  it("validates a large generated batch quickly", () => {
    const t0 = Date.now();
    for (let i = 0; i < 10_000; i++) {
      const r = buildExportReminder({ now: NOW, lastExportAt: NOW - i * 86_400_000, timed: i % 2 ? {} : undefined, alarmDaysBefore: i % 3 === 0 ? 1 : undefined });
      if (!validateIcs(r.ics).valid) throw new Error("invalid output at " + i);
    }
    expect(Date.now() - t0).toBeLessThan(10_000);
  });
});
