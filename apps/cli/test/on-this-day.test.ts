/** snappy-export on-this-day: Memories on this day and calendar views. Synthetic data only. */
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { insights } from "@snappy-export/core";
import { MAX_ROWS, offsetLabel, onThisDayCommand, renderOnThisDay } from "../src/commands/on-this-day.ts";
import type { OnThisDayReport } from "../src/commands/on-this-day.ts";
import { createTerm } from "../src/term.ts";
import { NOW, makeIo, stripPaths, tempDir, writeSyntheticParts, writeSyntheticZip } from "./helpers.ts";
import { expectBrandSafe, expectNoLeaks, expectValidDescriptor, runInsight } from "./insights-helpers.ts";

const term = createTerm({ env: {}, isTTY: false, columns: 100 });

/** A parts folder shared by the tests that only read it. */
const parts = tempDir("otd-parts");
writeSyntheticParts(parts, { memoryCount: 400 });

/** "Now" on Oct 15, 2026, a day with Memories in earlier years. */
const OCT_15 = Date.UTC(2026, 9, 15, 12, 0, 0);

describe("the command", () => {
  it("is a valid descriptor", async () => {
    await expectValidDescriptor(onThisDayCommand);
    expect(onThisDayCommand.name).toBe("on-this-day");
    expect(onThisDayCommand.group).toBe("Memories");
  });

  it("lists earlier years for today when the clock says so, and exits 0", async () => {
    const { code, out, err } = await runInsight(onThisDayCommand, [parts], makeIo({ now: () => OCT_15 }));
    expect(code).toBe(0);
    expect(err).toBe("");
    expect(out).toContain("Memories on this day");
    expect(out).toContain("Dates use UTC.");
    expect(out).toContain("Looking at Oct 15, 2026.");
    expect(out).toMatch(/\d+ Memor(?:y|ies) from this day in \d+ years?\./);
    expect(out).toContain("1 year ago");
    expect(out).not.toContain("Same year");
    expect(out.endsWith("Nothing here has left this device.\n")).toBe(true);
    expectBrandSafe(out, "today");
  });

  it("says so when nothing was taken on this day", async () => {
    const { code, out } = await runInsight(onThisDayCommand, [parts]);
    expect(code).toBe(0);
    expect(out).toContain("Looking at Nov 6, 2026.");
    expect(out).toContain("No Memories were taken on this day in other years.");
    expect(out).not.toContain("Year  When");
    expectBrandSafe(out, "empty day");
  });

  it("looks at a given day and includes that year", async () => {
    const { code, out } = await runInsight(onThisDayCommand, [parts, "--date", "2026-10-15"]);
    expect(code).toBe(0);
    expect(out).toContain("Looking at Oct 15, 2026.");
    expect(out).toContain("Same year");
    expect(out).toContain("1 year ago");
    expectBrandSafe(out, "date");
  });

  it("looks around a day with --window", async () => {
    const { code, out } = await runInsight(onThisDayCommand, [parts, "--date", "2026-10-15", "--window", "5"]);
    expect(code).toBe(0);
    expect(out).toContain("Memories around this day");
    expect(out).toContain("Looking at Oct 15, 2026, with 5 days either side.");
    expect(out).toContain("Same day");
    expect(out).toMatch(/\d+ days? (?:before|after)/);
    expectBrandSafe(out, "window");
    const none = await runInsight(onThisDayCommand, [parts, "--date", "2010-06-01", "--window", "2"]);
    expect(none.out).toContain("No Memories were taken around this day in other years.");
    // A window of 0 is the same as no window.
    const zero = await runInsight(onThisDayCommand, [parts, "--date", "2026-10-15", "--window", "0"]);
    expect(zero.out).toContain("Memories on this day");
  });

  it("shows one year by month with --year", async () => {
    const { code, out } = await runInsight(onThisDayCommand, [parts, "--year", "2025"]);
    expect(code).toBe(0);
    expect(out).toContain("Memories by month");
    expect(out).toMatch(/100 Memories in 2025, on \d+ days\./);
    for (const m of ["Jan", "Jun", "Dec"]) expect(out).toContain(m);
    expect(out).toContain("Busiest days");
    const empty = await runInsight(onThisDayCommand, [parts, "--year", "2010"]);
    expect(empty.out).toContain("No Memories are dated in 2010.");
    expect(empty.code).toBe(0);
    expectBrandSafe(out + empty.out, "year");
  });

  it("shows each year with --by-year", async () => {
    const { code, out } = await runInsight(onThisDayCommand, [parts, "--by-year"]);
    expect(code).toBe(0);
    expect(out).toContain("Memories by year");
    expect(out).toContain("400 Memories in 5 years.");
    expect(out).toContain("Busiest month");
    expectBrandSafe(out, "by-year");
  });

  it("moves the day with --offset and says which offset it used", async () => {
    const west = await runInsight(onThisDayCommand, [parts, "--offset=-5", "--by-year"]);
    expect(west.out).toContain("Dates use UTC-5.");
    const india = await runInsight(onThisDayCommand, [parts, "--offset", "+5:30", "--json"]);
    expect((JSON.parse(india.out) as { utcOffsetMinutes: number }).utcOffsetMinutes).toBe(330);
    const west2 = await runInsight(onThisDayCommand, [parts, "--offset=-5", "--json"]);
    expect((JSON.parse(west2.out) as { utcOffsetMinutes: number }).utcOffsetMinutes).toBe(-300);
    expect(offsetLabel(0)).toBe("UTC");
    expect(offsetLabel(-210)).toBe("UTC-3:30");
    expect(offsetLabel(840)).toBe("UTC+14");
  });

  it("takes --utc-offset like habits and remind, and says how to change the UTC default", async () => {
    const west = await runInsight(onThisDayCommand, [parts, "--utc-offset=-5", "--by-year"]);
    expect(west.out).toContain("Dates use UTC-5.");
    expect(west.out).not.toContain("to change this");
    const india = await runInsight(onThisDayCommand, [parts, "--utc-offset", "5:30", "--json"]);
    expect((JSON.parse(india.out) as { utcOffsetMinutes: number }).utcOffsetMinutes).toBe(330);
    const utc = await runInsight(onThisDayCommand, [parts, "--by-year"]);
    expect(utc.out).toContain("Dates use UTC. Use --utc-offset to change this.");
    expect(onThisDayCommand.usage).toContain("--utc-offset <hours>");
  });

  it("prints JSON with counts and calendar numbers only, no ids", async () => {
    const day = await runInsight(onThisDayCommand, [parts, "--date", "2026-10-15", "--json"]);
    expect(day.code).toBe(0);
    const json = JSON.parse(day.out) as Record<string, unknown> & { years: Array<Record<string, unknown>> };
    expect(json.generatedAt).toBe(new Date(NOW).toISOString());
    expect(Object.keys(json)).toEqual(["generatedAt", "utcOffsetMinutes", "counts", "view", "target", "total", "excluded", "notes", "years"]);
    expect(json.view).toBe("day");
    expect(json.target).toEqual({ year: 2026, month: 10, day: 15 });
    expect(json.years.map((y) => Object.keys(y))).toEqual([["year", "yearsAgo", "count"], ["year", "yearsAgo", "count"]]);
    expect(day.out).not.toMatch(/"ids"|"undatedIds"|"byDay"/);

    const near = await runInsight(onThisDayCommand, [parts, "--date", "2026-10-15", "--window", "3", "--json"]);
    expect(near.out).toContain('"view": "nearby"');
    expect(near.out).toContain('"offsetDays"');
    expect(near.out).not.toMatch(/"ids"/);

    const year = JSON.parse((await runInsight(onThisDayCommand, [parts, "--year", "2025", "--json"])).out) as { view: string; total: number; months: number[] };
    expect(year).toMatchObject({ view: "year", total: 100 });
    expect(year.months).toHaveLength(12);
  });

  it("adds the short code to each note with --verbose", async () => {
    const zip = writeSyntheticZip(tempDir("otd-none"), "a.zip", { memoryCount: 0 });
    const quiet = await runInsight(onThisDayCommand, [zip]);
    expect(quiet.out).not.toContain("code:");
    const verbose = await runInsight(onThisDayCommand, [zip, "--verbose"]);
    expect(verbose.out).toContain("code: no-memories");
  });

  it("exits 2 with a calm note when the export has no Memories list", async () => {
    const zip = writeSyntheticZip(tempDir("otd-zero"), "a.zip", { memoryCount: 0 });
    const { code, out, err } = await runInsight(onThisDayCommand, [zip]);
    expect(code).toBe(2);
    expect(err).toBe("");
    expect(out).toContain("Your export has no Memories list. Run check to see what is missing.");
    expectBrandSafe(out, "no memories");
    const json = await runInsight(onThisDayCommand, [zip, "--json"]);
    expect(json.code).toBe(2);
    expect(JSON.parse(json.out)).toMatchObject({ notes: [{ code: "no-memories", params: {} }, { code: "no-dated-items" }] });
  });

  it("uses no color with --no-color or NO_COLOR, and color on a color terminal", async () => {
    const color = await runInsight(onThisDayCommand, [parts, "--by-year"], makeIo({ interactive: true, env: { COLORTERM: "truecolor" } }));
    expect(color.out).toContain("\x1b[");
    const flagged = await runInsight(onThisDayCommand, [parts, "--by-year", "--no-color"], makeIo({ interactive: true, env: { COLORTERM: "truecolor" } }));
    expect(flagged.out).not.toContain("\x1b");
    const env = await runInsight(onThisDayCommand, [parts, "--by-year"], makeIo({ interactive: true, env: { NO_COLOR: "1" } }));
    expect(env.out).not.toContain("\x1b");
  });

  it("writes no file, reads no ledger and asks for no passphrase", async () => {
    const home = tempDir("otd-home");
    const dir = tempDir("otd-ro");
    writeSyntheticParts(dir, { memoryCount: 50 });
    const before = readdirSync(dir).sort();
    for (const args of [[dir], [dir, "--by-year"], [dir, "--year", "2025", "--json"], [dir, "--date", "2026-10-15", "--window", "4"]]) {
      const io = makeIo({ home });
      await runInsight(onThisDayCommand, args, io);
      expect(io.asked).toEqual([]);
    }
    expect(readdirSync(home)).toEqual([]);
    expect(readdirSync(dir).sort()).toEqual(before);
  });
});

describe("mistakes", () => {
  it("stops with calm messages for a missing path and no input", async () => {
    const dir = tempDir("otd-errors");
    const missing = await runInsight(onThisDayCommand, [join(dir, "missing.zip")]);
    expect(missing).toMatchObject({ code: 1, out: "" });
    expect(missing.err).toContain("could not find");
    const none = await runInsight(onThisDayCommand, []);
    expect(none).toMatchObject({ code: 1, out: "" });
    expect(none.err).toContain("Give Snappy your export");
  });

  it("checks every option before it reads anything", async () => {
    const gone = join(tempDir("otd-gone"), "missing.zip");
    const cases: Array<[string[], string]> = [
      [["--date", "tomorrow"], "--date must be a real day"],
      [["--date", "2026-02-30"], "--date must be a real day"],
      [["--date", "2026-13-01"], "--date must be a real day"],
      [["--date", "1960-01-01"], "--date must be a real day"],
      [["--window", "40"], "--window must be a whole number from 0 to 31"],
      [["--window", "x"], "--window must be a whole number"],
      [["--year", "1800"], "--year must be a whole number from 1970 to 2200"],
      [["--offset", "15"], "--offset must be hours from UTC"],
      [["--offset", "5:75"], "--offset must be hours from UTC"],
      [["--offset", "east"], "--offset must be hours from UTC, such as 2, -5 or 5:30, from -12 to 14."],
      [["--utc-offset=-13"], "--utc-offset must be hours from UTC, such as 2, -5 or 5:30, from -12 to 14."],
      [["--utc-offset", "99"], "--utc-offset must be hours from UTC, such as 2, -5 or 5:30, from -12 to 14."],
      [["--utc-offset", "2", "--offset", "3"], "Use --utc-offset or --offset, not both."],
      [["--year", "2025", "--by-year"], "Choose one view"],
      [["--year", "2025", "--date", "2026-01-01"], "Choose one view"],
      [["--by-year", "--window", "3"], "Choose one view"],
      [["--bogus"], 'Snappy does not know the option --bogus for on-this-day. Run "snappy-export help on-this-day"'],
      [["--date"], "The option --date needs a value."],
    ];
    for (const [args, message] of cases) {
      const result = await runInsight(onThisDayCommand, [gone, ...args]);
      expect(result.code, args.join(" ")).toBe(1);
      expect(result.out, args.join(" ")).toBe("");
      expect(result.err, args.join(" ")).toContain(message);
      expect(result.err, args.join(" ")).not.toContain("could not find");
    }
  });

  it("says what is wrong with a file that is not an export", async () => {
    const dir = tempDir("otd-notzip");
    const file = join(dir, "notes.txt");
    writeFileSync(file, "hello");
    const result = await runInsight(onThisDayCommand, [file]);
    expect(result.code).toBe(1);
    expect(result.out).toBe("");
    expect(result.err.length).toBeGreaterThan(0);
    expectBrandSafe(result.err, "wrong file");
  });
});

describe("privacy", () => {
  it("prints no canary, link, entry name or username, in text, JSON or errors", async () => {
    const zip = writeSyntheticZip(tempDir("otd-canary"), "export.zip", { bundleMedia: true, memoryCount: 100 });
    const argLists = [
      [zip], [zip, "--json"], [zip, "--verbose"], [zip, "--by-year"], [zip, "--year", "2025", "--verbose"],
      [parts, "--date", "2026-10-15", "--window", "6", "--json", "--verbose"], [parts, "--date", "2026-10-15", "--verbose"],
      [zip, "--date", "oops"], [zip, "--offset", "99", "--verbose"], [join(tempDir("otd-c2"), "gone.zip"), "--verbose"],
    ];
    for (const args of argLists) {
      const { out, err } = await runInsight(onThisDayCommand, args);
      const text = stripPaths(out + err);
      const label = args.map((a) => stripPaths(a)).join(" ");
      expectNoLeaks(text, label);
      expect(text, label).not.toMatch(/\b(?:ghost|oneway|dormant|active|newfriend)_\d+\b/);
      expect(text, label).not.toMatch(/\.(?:jpg|mp4|png|html|json|zip)\b|[0-9A-F]{8}-[0-9A-F]{4}/i);
    }
  });
});

const CIVIL = { year: 2026, month: 10, day: 15 };
const NO_NOTES: insights.memoriesOnThisDay.InsightNote[] = [];
const EXCLUDED = { undated: 0, future: 0 };
const COUNTS = { input: 0, unique: 0, dated: 0, undated: 0, future: 0, duplicateIds: 0, invalidIds: 0 };

function report(view: OnThisDayReport["view"], extra: Partial<OnThisDayReport> = {}): OnThisDayReport {
  return { view, utcOffsetMinutes: 0, counts: COUNTS, problems: [], ...extra };
}

const dayView = (n: number, notes = NO_NOTES): OnThisDayReport["view"] => ({
  kind: "day",
  result: {
    target: CIVIL,
    years: n === 0 ? [] : [{ year: 2025, yearsAgo: 1, ids: [], count: n }],
    total: n,
    excluded: EXCLUDED,
    notes,
  },
});

/** Every note core can send, so each sentence is read at the counts below. */
const allNotes = (n: number): insights.memoriesOnThisDay.InsightNote[] =>
  [
    "offset-invalid", "now-invalid", "undated-items", "future-dates-skipped", "duplicate-ids-skipped", "invalid-ids-skipped", "no-dated-items",
    "invalid-target", "invalid-year", "window-adjusted", "leap-day-folded", "a-code-from-the-future",
  ].map((code) => ({ code: code as insights.memoriesOnThisDay.InsightNote["code"], params: { count: n, windowDays: n } }));

describe("wording", () => {
  it.each([0, 1, 2, 12])("reads correctly with a count of %i", (n) => {
    const nearby: OnThisDayReport["view"] = {
      kind: "nearby",
      result: {
        target: CIVIL,
        windowDays: n,
        years: n === 0 ? [] : [{ year: 2025, yearsAgo: 1, count: n, days: [{ date: { year: 2025, month: 10, day: 14 }, offsetDays: -1, ids: new Array<string>(n).fill("x") }] }],
        total: n,
        excluded: EXCLUDED,
        notes: NO_NOTES,
      },
    };
    const year: OnThisDayReport["view"] = {
      kind: "year",
      result: { year: 2025, days: n === 0 ? [] : [{ month: 3, day: 9, count: n }], total: n, activeDays: n === 0 ? 0 : 1, maxDayCount: n, months: new Array<number>(12).fill(n), excluded: EXCLUDED, notes: NO_NOTES },
    };
    const years: OnThisDayReport["view"] = {
      kind: "years",
      result: { years: n === 0 ? [] : [{ year: 2025, months: new Array<number>(12).fill(n), total: n * 12 }], max: n, total: n * 12, excluded: EXCLUDED, notes: NO_NOTES },
    };
    const views = [dayView(n, allNotes(n)), nearby, year, years];
    for (const view of views) {
      const text = renderOnThisDay(report(view, { problems: ["export-problems", "no-memories"] }), term, false);
      expectBrandSafe(text, `${view.kind} count ${n}`);
    }
    const text = renderOnThisDay(report(dayView(n, allNotes(n))), term, false);
    expect(text).not.toContain("a-code-from-the-future");
    expect(text).toContain("Snappy noted something it cannot describe.");
    expect(text).toContain("Snappy cannot use that date.");
  });

  it("says one Memory, not 1 Memories, and agrees verbs", () => {
    const one = renderOnThisDay(report(dayView(1, allNotes(1))), term, false);
    expect(one).toContain("1 Memory from this day in 1 year.");
    expect(one).toContain("1 Memory has no usable date, so Snappy left it out.");
    expect(one).toContain("1 Memory is dated in the future, so Snappy left it out.");
    expect(one).toContain("1 repeated Memory was counted once.");
    expect(one).toContain("1 Memory without an id was left out.");
    expect(one).toContain("1 Memory from Feb 29 is shown on Feb 28, since this year has no Feb 29.");
    expect(one).toContain("The window was changed to 1 day.");
    const many = renderOnThisDay(report(dayView(2, allNotes(2))), term, false);
    expect(many).toContain("2 Memories from this day in 1 year.");
    expect(many).toContain("2 Memories have no usable date, so Snappy left them out.");
    expect(many).toContain("2 Memories are dated in the future, so Snappy left them out.");
    expect(many).toContain("2 repeated Memories were counted once.");
    expect(many).toContain("2 Memories without an id were left out.");
    expect(many).toContain("The window was changed to 2 days.");
  });

  it("puts the key figure in color and keeps the text readable without it", () => {
    const colored = createTerm({ env: { COLORTERM: "truecolor" }, isTTY: true, columns: 100 });
    const text = renderOnThisDay(report(dayView(12)), colored, false);
    expect(text).toContain("\x1b[");
    expect(text.replace(/\x1b\[[0-9;]*m/g, "")).toContain("12 Memories from this day in 1 year.");
    expect(text).not.toMatch(/\x1b\[(?:38;2;(?:2[0-5]\d|1\d\d);1[0-9]{2};[0-9]{1,2}|38;5;208)m/);
  });

  it("caps long lists and says how many were left out", () => {
    const manyYears = Array.from({ length: MAX_ROWS + 5 }, (_, i) => ({ year: 2100 - i, months: new Array<number>(12).fill(1), total: 12 }));
    const text = renderOnThisDay(report({ kind: "years", result: { years: manyYears, max: 1, total: manyYears.length * 12, excluded: EXCLUDED, notes: NO_NOTES } }), term, false);
    expect(text).toContain("And 5 more years.");
    expect(text).not.toContain("1,999");
    const oneOver = renderOnThisDay(
      report({ kind: "years", result: { years: manyYears.slice(0, MAX_ROWS + 1), max: 1, total: 1, excluded: EXCLUDED, notes: NO_NOTES } }),
      term,
      false,
    );
    expect(oneOver).toContain("And 1 more year.");

    const days = Array.from({ length: MAX_ROWS + 2 }, (_, i) => ({ date: { year: 2025, month: 1 + (i % 12), day: 1 + Math.floor(i / 12) }, offsetDays: 0, ids: ["a"] }));
    const nearby = renderOnThisDay(
      report({ kind: "nearby", result: { target: CIVIL, windowDays: 3, years: [{ year: 2025, yearsAgo: 1, count: days.length, days }], total: days.length, excluded: EXCLUDED, notes: NO_NOTES } }),
      term,
      false,
    );
    expect(nearby).toContain("And 2 more days.");
    expectBrandSafe(text + oneOver + nearby, "caps");
  });

  it("says Same year, years ago, and days before and after", () => {
    const text = renderOnThisDay(
      report({
        kind: "nearby",
        result: {
          target: CIVIL,
          windowDays: 3,
          years: [{ year: 2026, yearsAgo: 0, count: 3, days: [
            { date: { year: 2026, month: 10, day: 13 }, offsetDays: -2, ids: ["a"] },
            { date: { year: 2026, month: 10, day: 15 }, offsetDays: 0, ids: ["b"] },
            { date: { year: 2026, month: 10, day: 16 }, offsetDays: 1, ids: ["c"] },
          ] }],
          total: 3,
          excluded: EXCLUDED,
          notes: NO_NOTES,
        },
      }),
      term,
      false,
    );
    expect(text).toContain("2 days before");
    expect(text).toContain("Same day");
    expect(text).toContain("1 day after");
    expect(text).toContain("3 Memories around this day in 1 year.");
  });

  it("keeps every sentence short and in sentence case", () => {
    const text = renderOnThisDay(report(dayView(2, allNotes(2)), { problems: ["export-problems", "no-memories"] }), term, false);
    const prose = text
      .split("\n")
      .map((line) => line.replace(/^\s*(?:Warning|Note|Error)\s+/, "").trim())
      .filter((line) => /[.?]$/.test(line) && !/\s{2,}/.test(line));
    expect(prose.length).toBeGreaterThan(10);
    for (const s of prose.flatMap((line) => line.split(/(?<=[.?])\s+/))) expect(s.split(/\s+/).length, s).toBeLessThanOrEqual(20);
    expect(text).not.toMatch(/\b(?:ghosts?|unfriend\w*|dormant|inactive|dead|simply|just)\b/i);
  });
});
