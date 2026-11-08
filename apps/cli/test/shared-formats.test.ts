/**
 * One way to write a size, a time zone, an hour, a length of time, an empty value and a one-day
 * stretch, for every command. Each command used to carry its own copy, and the copies drifted.
 * Synthetic data only.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { insights } from "@snappy-export/core";
import { formatBytes as dashboardBytes } from "../../dashboard/src/format.ts";
import { renderCalendar } from "../src/commands/calendar.ts";
import { renderFriendCount } from "../src/commands/friend-count.ts";
import type { FriendCountReport } from "../src/commands/friend-count.ts";
import { renderStorage } from "../src/commands/storage.ts";
import { renderYear } from "../src/commands/year.ts";
import { MINUS, NO_VALUE, formatBytes, formatDuration, formatHour, formatOffset, stretchDates } from "../src/format.ts";
import { createTerm } from "../src/term.ts";
import { NOW } from "./helpers.ts";

const term = createTerm({ env: {}, isTTY: false, columns: 100 });
const DAY = 86_400_000;
const COMMANDS = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "commands");

describe("the shared formatters", () => {
  it("writes a size the way the dashboard does, so one size reads the same everywhere", () => {
    for (const bytes of [0, 2, 512, 1000, 1023, 1024, 2263, 10_240, 61_440, 102_400, 1_048_576, 6_900_000, 340 * 1024 ** 2, 5 * 1024 ** 3, 1.5 * 1024 ** 4]) {
      expect(formatBytes(bytes), String(bytes)).toBe(dashboardBytes(bytes));
    }
    expect(formatBytes(2263)).toBe("2.21 KB");
    // The one place it differs on purpose: a single byte is "1 byte".
    expect(formatBytes(1)).toBe("1 byte");
  });

  it("writes a time zone as UTC, UTC+2:00 or UTC-5:30, everywhere", () => {
    expect(formatOffset(0)).toBe("UTC");
    expect(formatOffset(120)).toBe("UTC+2:00");
    expect(formatOffset(-300)).toBe("UTC-5:00");
    expect(formatOffset(-210)).toBe("UTC-3:30");
    expect(formatOffset(840)).toBe("UTC+14:00");
  });

  it("writes an hour with capital AM and PM", () => {
    expect([0, 7, 12, 15, 23].map(formatHour)).toEqual(["12 AM", "7 AM", "12 PM", "3 PM", "11 PM"]);
  });

  it("writes a length of time with one rule: minutes up to 119, then hours, then days", () => {
    expect(formatDuration(500)).toBe("Under 1 second");
    expect(formatDuration(30_000)).toBe("30 seconds");
    expect(formatDuration(83 * 60_000)).toBe("83 minutes");
    expect(formatDuration(119 * 60_000)).toBe("119 minutes");
    expect(formatDuration(120 * 60_000)).toBe("2 hours");
    expect(formatDuration(47 * 3_600_000)).toBe("47 hours");
    expect(formatDuration(3 * DAY)).toBe("3 days");
  });

  it("keeps an en dash for no value and a true minus for a negative number", () => {
    expect(NO_VALUE).toBe("–");
    expect(MINUS).toBe("−");
  });

  it("says 'on' for a one-day stretch and 'to' for a longer one", () => {
    expect(stretchDates("Jan 21, 2026", "Jan 21, 2026")).toBe("on Jan 21, 2026");
    expect(stretchDates("Jan 21, 2026", "Jan 23, 2026")).toBe("Jan 21, 2026 to Jan 23, 2026");
  });
});

describe("what the commands print", () => {
  it("never writes a stretch of one day as 'Jan 21, 2026 to Jan 21, 2026'", () => {
    const base = insights.yearInReview.computeYearInReview(
      { chats: Array.from({ length: 12 }, (_, i) => ({ direction: "sent", kind: "TEXT", at: Date.UTC(2025, i % 12, 5 + i, 10) })) },
      { now: NOW, year: 2025 },
    );
    const activity = { ...(base.activity as NonNullable<typeof base.activity>), longestQuietGap: { days: 1, startDay: "2025-01-21", endDay: "2025-01-21" } };
    const one = renderYear({ ...base, activity }, term, false);
    expect(one).toMatch(/Longest quiet stretch +1 day, on Jan 21, 2025/);
    expect(one).not.toMatch(/Jan 21, 2025 to Jan 21, 2025/);
    const many = renderYear({ ...base, activity: { ...activity, longestQuietGap: { days: 3, startDay: "2025-01-21", endDay: "2025-01-23" } } }, term, false);
    expect(many).toMatch(/Longest quiet stretch +3 days, Jan 21, 2025 to Jan 23, 2025/);
  });

  it("says 'on' for a one-day run in the calendar", () => {
    const events = [0, 1, 2, 3].map((i) => ({ kind: "snap", at: NOW - (3 + i * 5) * DAY }));
    const calendar = insights.activityCalendar.computeActivityCalendar(events, { now: NOW });
    expect(renderCalendar(calendar, term, false)).not.toMatch(/(\w{3} \d+, \d{4}) to \1/);
  });

  it("writes a drop in the friend count with a true minus, not a hyphen", () => {
    const months = [
      { month: "2020-01", joined: 1, left: 0, net: 1, count: 11, snapshotCount: null, partial: false },
      { month: "2020-02", joined: 0, left: 3, net: -3, count: 8, snapshotCount: null, partial: false },
    ];
    const report = {
      months,
      best: { month: "2020-01", net: 1 },
      worst: { month: "2020-02", net: -3 },
      totals: { joined: 1, left: 3, net: -2, startingCount: 10, currentCount: 8 },
      comparisons: [],
      notes: [],
      ledger: "none",
    } as unknown as FriendCountReport;
    const text = renderFriendCount(report, term, false);
    expect(text).toContain(`${MINUS}3`);
    expect(text).not.toMatch(/(^|\s)-\d/m);
  });

  it("calls partial storage totals 'At least', and shows no empty type row", () => {
    const items = [
      { id: "a", date: Date.UTC(2026, 0, 1), mediaType: "image" as const, sizeBytes: 2263 },
      { id: "b", date: Date.UTC(2026, 0, 2), mediaType: "image" as const },
    ];
    const text = renderStorage(insights.storagePlanner.planMemoryStorage(items, 5 * 1024 ** 3, { now: NOW }), term, false);
    expect(text).toMatch(/At least 2\.21 KB/);
    expect(text).not.toMatch(/\bKB\+|\bB\+/);
    expect(text).toContain("Photos");
    expect(text).not.toMatch(/^ *Videos/m);
    expect(text).not.toMatch(/^ *Other/m);
  });
});

describe("the command sources", () => {
  const files = readdirSync(COMMANDS).filter((f) => f.endsWith(".ts"));

  it("write no empty table value as a hyphen", () => {
    for (const file of files) {
      const source = readFileSync(join(COMMANDS, file), "utf8");
      expect(source, file).not.toMatch(/\? "-" :|: "-"[)\]]|\[name, "-"|\?\? "-"/);
    }
  });

  it("keep no private copy of the time zone, hour or duration formatters", () => {
    for (const file of files) {
      const source = readFileSync(join(COMMANDS, file), "utf8");
      expect(source, file).not.toMatch(/UTC\$\{minutes < 0/);
      expect(source, file).not.toMatch(/"am" : "pm"/);
      expect(source, file).not.toMatch(/Math\.round\(ms \/ 60_000\)/);
    }
  });
});
