/** snappy-export calendar: when your chats and Snaps happened, and what kind they were. Synthetic data only. */
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { insights } from "@snappy-export/core";
import { CALENDAR_USAGE, calendarCommand, renderCalendar } from "../src/commands/calendar.ts";
import { createTerm } from "../src/term.ts";
import { NOW, makeIo, stripPaths, tempDir, writeSyntheticParts, writeSyntheticZip } from "./helpers.ts";
import { expectBrandSafe, expectNoLeaks, expectValidDescriptor, runInsight } from "./insights-helpers.ts";

type Calendar = insights.activityCalendar.ActivityCalendarResult;
type Json = Calendar & { generatedAt: string };
const term = createTerm({ env: {}, isTTY: false, columns: 100 });
const enc = new TextEncoder();

const HOUR = 3_600_000;
const DAY = 86_400_000;
/** A Monday at 23:30 UTC, in March 2026. */
const LATE_MONDAY = Date.UTC(2026, 2, 2, 23, 30, 0);

interface Entry {
  at: number;
  kind?: string;
}

/** A tiny synthetic export: one friend and one conversation. IMAGE and VIDEO go in the Snap history, the rest in the chat history. */
function writeTinyExport(dir: string, entries: Entry[], name = "tiny.zip"): string {
  mkdirSync(dir, { recursive: true });
  const rows = (list: Entry[]): unknown[] => list.map((e) => ({ From: "sam_01", "Media Type": e.kind ?? "TEXT", "Created(microseconds)": e.at * 1000, IsSender: true }));
  const isSnap = (e: Entry): boolean => e.kind === "IMAGE" || e.kind === "VIDEO";
  const zip = join(dir, name);
  writeFileSync(
    zip,
    zipSync({
      "json/friends.json": enc.encode(JSON.stringify({ Friends: [{ Username: "sam_01", "Creation Timestamp": "2026-01-01 00:00:00 UTC" }] })),
      "json/chat_history.json": enc.encode(JSON.stringify({ sam_01: rows(entries.filter((e) => !isSnap(e))) })),
      "json/snap_history.json": enc.encode(JSON.stringify({ sam_01: rows(entries.filter(isSnap)) })),
    }),
  );
  return zip;
}

const KINDS = ["TEXT", "IMAGE", "VIDEO", "NOTE", "STICKER", "TEXT"];
/** `n` events, one a day before NOW, with the kinds taken in turn. */
function spread(n: number): Entry[] {
  return Array.from({ length: n }, (_, i) => ({ at: NOW - (i + 1) * DAY - (i % 24) * HOUR, kind: KINDS[i % KINDS.length] as string }));
}

describe("the command", () => {
  it("is a valid descriptor", async () => {
    await expectValidDescriptor(calendarCommand);
    expect(calendarCommand.name).toBe("calendar");
    expect(calendarCommand.group).toBe("Chats");
    expect(calendarCommand.usage).toBe(CALENDAR_USAGE);
  });

  it("describes every option in the usage, each on one line of 70 characters or fewer", () => {
    const rows = CALENDAR_USAGE.split("\n").filter((l) => /^ {2}--/.test(l));
    expect(rows.map((r) => r.trim().split(/\s+/)[0])).toEqual(["--year", "--utc-offset", "--limit", "--detail", "--json", "--verbose", "--no-color"]);
    for (const r of rows) expect(r.replace(/^ {2}--\S+(?: <\w+>)?\s+/, "").length, r).toBeLessThanOrEqual(70);
  });

  it("shows the calendar for a three-part export, and exits 0", async () => {
    const dir = tempDir("calendar-parts");
    writeSyntheticParts(dir);
    const { code, out, err } = await runInsight(calendarCommand, [dir]);
    const json = JSON.parse((await runInsight(calendarCommand, [dir, "--json"])).out) as Json;
    expect(code).toBe(0);
    expect(err).toBe("");
    for (const heading of ["Activity calendar", "Overview", "Across all time", "Kinds", "Kinds by year"]) expect(out).toContain(heading);
    expect(out).toContain(`Year ${json.calendar?.year}`);
    expect(out).toContain(`${json.totals.used.toLocaleString("en-US")} chats and Snaps, on ${json.totals.activeDays.toLocaleString("en-US")} days.`);
    expect(out).toMatch(/Time zone\s+UTC\n/);
    expect(out).not.toContain("By week in");
    expect(out).not.toContain("code:");
    expect(out.endsWith("Nothing here has left this device.\n")).toBe(true);
    expectBrandSafe(out, "calendar");
  });

  it("reads one ZIP file too", async () => {
    const zip = writeSyntheticZip(tempDir("calendar-one"), "a.zip", { bundleMedia: true });
    const { code, out } = await runInsight(calendarCommand, [zip]);
    expect(code).toBe(0);
    expect(out).toContain("Kinds by year");
    expectBrandSafe(out, "one zip");
  });

  it("prints JSON with numbers, dates and codes only", async () => {
    const dir = tempDir("calendar-json");
    writeSyntheticParts(dir);
    const { code, out } = await runInsight(calendarCommand, [dir, "--json"]);
    expect(code).toBe(0);
    const json = JSON.parse(out) as Json;
    expect(json.generatedAt).toBe(new Date(NOW).toISOString());
    expect(Object.keys(json)).toEqual(["generatedAt", "utcOffsetMinutes", "totals", "first", "last", "years", "calendar", "streaks", "mix", "mixByYear", "notes"]);
    expect(json.totals.used).toBeGreaterThan(0);
    expect(json.mix.total).toBe(json.totals.used);
    expect(json.utcOffsetMinutes).toBe(0);
    expect(Object.keys(json.calendar?.mix ?? {})).toEqual(["text", "image", "video", "note", "sticker", "other", "total"]);
  });

  it("counts the kinds and the days of a small export", async () => {
    const entries: Entry[] = [
      ...Array.from({ length: 12 }, (_, i) => ({ at: Date.UTC(2026, 2, 2, 10, i), kind: "TEXT" })),
      ...Array.from({ length: 8 }, (_, i) => ({ at: Date.UTC(2026, 2, 3, 10, i), kind: "IMAGE" })),
      ...Array.from({ length: 5 }, (_, i) => ({ at: Date.UTC(2026, 2, 10, 10, i), kind: "VIDEO" })),
      ...Array.from({ length: 3 }, (_, i) => ({ at: Date.UTC(2026, 2, 10, 11, i), kind: "NOTE" })),
      ...Array.from({ length: 2 }, (_, i) => ({ at: Date.UTC(2026, 2, 11, 11, i), kind: "STICKER" })),
      ...Array.from({ length: 4 }, (_, i) => ({ at: Date.UTC(2026, 2, 12, 11, i), kind: "MEDIA" })),
    ];
    const zip = writeTinyExport(tempDir("calendar-kinds"), entries);
    const json = JSON.parse((await runInsight(calendarCommand, [zip, "--json"])).out) as Json;
    expect(json.totals).toMatchObject({ used: 34, activeDays: 5 });
    expect(json.mix).toMatchObject({ text: 12, image: 8, video: 5, note: 3, sticker: 2, other: 4, total: 34 });
    expect(json.streaks.longestActive).toEqual({ days: 3, start: "2026-03-10", end: "2026-03-12" });
    expect(json.streaks.longestQuiet).toEqual({ days: 6, start: "2026-03-04", end: "2026-03-09" });
    const { out } = await runInsight(calendarCommand, [zip]);
    expect(out).toMatch(/Longest active run\s+3 days\s+Mar 10, 2026\s+Mar 12, 2026/);
    expect(out).toMatch(/Longest quiet run\s+6 days\s+Mar 4, 2026\s+Mar 9, 2026/);
    expect(out).toMatch(/^ {2}Text\s+12\s+35%\s+12$/m);
    expect(out).toMatch(/^ {2}Other\s+4\s+12%\s+4$/m);
    expect(out).toContain("Other holds chat media, which may be a photo or a video.");
    expect(out).toMatch(/^ {2}Mar 2026\s+34\s+5\s/m);
    expect(out).toContain("34 chats and Snaps, on 5 days.");
    expect(out).toMatch(/Busiest full week\s+Week of Mar 2, 2026, 20 chats and Snaps/);
    expect(out).toMatch(/Longest active run this year\s+3 days, Mar 10, 2026 to Mar 12, 2026/);
    expectBrandSafe(out, "kinds");
  });

  it("moves the days with --utc-offset", async () => {
    const zip = writeTinyExport(tempDir("calendar-zone"), Array.from({ length: 40 }, (_, i) => ({ at: LATE_MONDAY + (i % 2) * 60_000 })));
    const days = async (args: string[]): Promise<string[]> => {
      const json = JSON.parse((await runInsight(calendarCommand, [zip, "--json", ...args])).out) as Json;
      return (json.calendar?.days ?? []).filter((d) => d.count > 0).map((d) => d.date);
    };
    expect(await days([])).toEqual(["2026-03-02"]);
    expect(await days(["--utc-offset", "3"])).toEqual(["2026-03-03"]);
    expect(await days(["--utc-offset=-5:30"])).toEqual(["2026-03-02"]);
    const east = await runInsight(calendarCommand, [zip, "--utc-offset", "3"]);
    expect(east.out).toMatch(/Time zone\s+UTC\+3:00/);
    const json = JSON.parse((await runInsight(calendarCommand, [zip, "--utc-offset=-5:30", "--json"])).out) as Json;
    expect(json.utcOffsetMinutes).toBe(-330);
    expect(json.notes.map((n) => n.code)).not.toContain("offset-adjusted");
  });

  it("lists the year you ask for, and says when it holds nothing", async () => {
    const entries = [...Array.from({ length: 40 }, (_, i) => ({ at: Date.UTC(2025, 5, 1 + i, 12) })), ...Array.from({ length: 35 }, (_, i) => ({ at: Date.UTC(2026, 1, 1 + i, 12) }))];
    const zip = writeTinyExport(tempDir("calendar-year"), entries);
    const dflt = await runInsight(calendarCommand, [zip]);
    expect(dflt.out).toContain("Year 2026");
    expect(dflt.out).toContain("By month in 2026");
    const older = await runInsight(calendarCommand, [zip, "--year", "2025"]);
    expect(older.out).toContain("Year 2025");
    expect(older.out).toContain("By month in 2025");
    expect(older.out).toMatch(/Kind\s+All time\s+Share\s+2025/);
    const empty = await runInsight(calendarCommand, [zip, "--year", "2020", "--verbose"]);
    expect(empty.code).toBe(0);
    expect(empty.out).toContain("Year 2020");
    expect(empty.out).not.toContain("By month in 2020");
    expect(empty.out).toContain("No chats or Snaps were found in 2020, so its calendar is empty.");
    expect(empty.out).toContain("code: year-empty");
    const future = JSON.parse((await runInsight(calendarCommand, [zip, "--year", "2030", "--json"])).out) as Json;
    expect(future.calendar?.days).toEqual([]);
    expect(future.notes.map((n) => n.code)).toContain("year-empty");
  });

  it("limits the kinds-by-year list with --limit and says how many are left out", async () => {
    const entries = Array.from({ length: 14 }, (_, i) => ({ at: Date.UTC(2012 + i, 5, 10, 12) }));
    const zip = writeTinyExport(tempDir("calendar-limit"), entries);
    const rows = (text: string): number => text.split("\n").filter((l) => /^ {2}20\d\d\s+\d+\s+\d+/.test(l)).length;
    const dflt = await runInsight(calendarCommand, [zip]);
    expect(rows(dflt.out)).toBe(10);
    expect(dflt.out).toContain("Showing the latest 10 years of 14.");
    const one = await runInsight(calendarCommand, [zip, "--limit", "1"]);
    expect(rows(one.out)).toBe(1);
    expect(one.out).toContain("Showing the latest 1 year of 14.");
    const every = await runInsight(calendarCommand, [zip, "--limit", "1000"]);
    expect(rows(every.out)).toBe(14);
    expect(every.out).not.toContain("Showing the latest");
  });

  it("adds a row for every full week with --detail", async () => {
    const zip = writeTinyExport(tempDir("calendar-detail"), spread(120));
    const json = JSON.parse((await runInsight(calendarCommand, [zip, "--json"])).out) as Json;
    const weeks = json.calendar?.weeks.length ?? 0;
    expect(weeks).toBeGreaterThan(10);
    const { out } = await runInsight(calendarCommand, [zip, "--detail"]);
    expect(out).toContain("By week in 2026");
    expect(out.split("\n").filter((l) => /^ {2}[A-Z][a-z]{2} \d{1,2}, 2026\s+\d+\s/.test(l))).toHaveLength(weeks);
    expect(out).toContain("Only full weeks between your first and last active day are listed.");
    expectBrandSafe(out, "detail");
  });

  it("notes a small count, an unsorted kind, and dates in the future", async () => {
    const small = await runInsight(calendarCommand, [writeTinyExport(tempDir("calendar-few"), spread(5), "few.zip")]);
    expect(small.code).toBe(0);
    expect(small.out).toContain("Warning  Only 5 chats and Snaps were counted, so this picture may be weak.");
    const media = await runInsight(calendarCommand, [writeTinyExport(tempDir("calendar-media"), spread(40).map(({ at }) => ({ at, kind: "MEDIA" })), "media.zip")]);
    expect(media.out).toContain("have a kind Snappy cannot sort, so the mix may be off.");
    const future = await runInsight(
      calendarCommand,
      [writeTinyExport(tempDir("calendar-future"), [...spread(40), { at: NOW + 3 * DAY }, { at: NOW + 9 * DAY }], "future.zip"), "--verbose"],
    );
    expect(future.out).toContain("Note     2 chats and Snaps are dated in the future. Snappy leaves them out.");
    expect(future.out).toContain("code: future-skipped");
    const one = await runInsight(calendarCommand, [writeTinyExport(tempDir("calendar-future1"), [...spread(40), { at: NOW + DAY }], "future1.zip")]);
    expect(one.out).toContain("1 chat or Snap is dated in the future. Snappy leaves it out.");
    for (const r of [small, media, future, one]) expectBrandSafe(r.out, "notes");
  });

  it("says there is nothing to count for an export without chats or Snaps", async () => {
    const zip = writeTinyExport(tempDir("calendar-none"), []);
    const { code, out } = await runInsight(calendarCommand, [zip]);
    expect(code).toBe(0);
    expect(out).toContain("There is nothing to count yet.");
    expect(out).toContain("No chats or Snaps were found in your export.");
    expect(out).not.toContain("Kinds by year");
    expectBrandSafe(out, "none");
    const json = JSON.parse((await runInsight(calendarCommand, [zip, "--json"])).out) as Json;
    expect(json.totals.used).toBe(0);
    expect(json.calendar).toBeNull();
    expect(json.streaks).toEqual({ longestActive: null, longestQuiet: null });
  });

  it("stops with exit 2 for a broken export, in text and in JSON, and touches no ledger", async () => {
    const dir = tempDir("calendar-broken");
    const zip = join(dir, "broken.zip");
    writeFileSync(zip, zipSync({ "html/index.html": enc.encode("<html></html>") }));
    const home = tempDir("calendar-broken-home");
    const io = makeIo({ home });
    const text = await runInsight(calendarCommand, [zip, "--verbose"], io);
    expect(text.code).toBe(2);
    expect(text.out).toContain("Error");
    expect(text.out).toContain("code: html-only-export");
    expect(text.out).toContain("Snappy stopped, since a calendar from a broken export may mislead.");
    expect(text.out).not.toContain("Kinds");
    expect(io.asked).toEqual([]);
    expect(readdirSync(home)).toEqual([]);
    const json = await runInsight(calendarCommand, [zip, "--json"]);
    expect(json.code).toBe(2);
    expect((JSON.parse(json.out) as { stopped: string }).stopped).toBe("export-errors");
    expectBrandSafe(text.out, "broken");
  });

  it("uses no color with --no-color or NO_COLOR, and color on a color terminal", async () => {
    const zip = writeSyntheticZip(tempDir("calendar-color"), "a.zip");
    const color = await runInsight(calendarCommand, [zip], makeIo({ interactive: true, env: { COLORTERM: "truecolor" } }));
    expect(color.out).toContain("\x1b[");
    expect((await runInsight(calendarCommand, [zip, "--no-color"], makeIo({ interactive: true, env: { COLORTERM: "truecolor" } }))).out).not.toContain("\x1b");
    expect((await runInsight(calendarCommand, [zip], makeIo({ interactive: true, env: { NO_COLOR: "1" } }))).out).not.toContain("\x1b");
  });

  it("writes no file, reads no ledger and asks for no passphrase", async () => {
    const home = tempDir("calendar-home");
    const dir = tempDir("calendar-ro");
    writeSyntheticParts(dir);
    const before = readdirSync(dir).sort();
    const io = makeIo({ home, env: { SNAPPY_PASSPHRASE: "never-used" } });
    for (const args of [[dir], [dir, "--json"], [dir, "--detail"]]) await runInsight(calendarCommand, args, io);
    expect(io.asked).toEqual([]);
    expect(readdirSync(home)).toEqual([]);
    expect(readdirSync(dir).sort()).toEqual(before);
  });

  it("stops with calm messages for a missing path, no input and bad options", async () => {
    const dir = tempDir("calendar-errors");
    const missing = await runInsight(calendarCommand, [join(dir, "missing.zip")]);
    expect(missing).toMatchObject({ code: 1, out: "" });
    expect(missing.err).toContain("could not find");
    expect((await runInsight(calendarCommand, [])).err).toContain("Give Snappy your export");
    const zip = writeSyntheticZip(dir, "a.zip");
    expect((await runInsight(calendarCommand, [zip, "--bogus"])).err).toContain('Snappy does not know the option --bogus for calendar. Run "snappy-export help calendar"');
    for (const bad of ["x", "15", "-13", "5:75", "1.5", "", "+", "100"]) {
      const arg = `--utc-offset=${bad}`;
      const r = await runInsight(calendarCommand, [zip, arg]);
      expect(r, arg).toMatchObject({ code: 1, out: "" });
      expect(r.err, arg).toContain("--utc-offset must be hours from UTC");
    }
    for (const bad of ["0", "x", "1.5", "-2", "1001"]) {
      const r = await runInsight(calendarCommand, [zip, `--limit=${bad}`]);
      expect(r, bad).toMatchObject({ code: 1, out: "" });
      expect(r.err, bad).toContain("--limit must be a whole number from 1 to 1000.");
    }
    for (const bad of ["1968", "2201", "x", "2026.5", "-2026", ""]) {
      const r = await runInsight(calendarCommand, [zip, `--year=${bad}`]);
      expect(r, bad).toMatchObject({ code: 1, out: "" });
      expect(r.err, bad).toContain("--year must be a whole number from 1969 to 2200.");
    }
    const noValue = await runInsight(calendarCommand, [zip, "--utc-offset", "-5"]);
    expect(noValue.err).toContain("If it starts with a dash, write --utc-offset=value.");
  });

  it("checks the options before it reads anything", async () => {
    const dir = tempDir("calendar-order");
    const r = await runInsight(calendarCommand, [join(dir, "missing.zip"), "--year=1900"]);
    expect(r.err).toContain("--year must be a whole number");
    expect(r.err).not.toContain("could not find");
  });
});

describe("privacy", () => {
  it("prints no canary, link, entry name or username, in text, JSON, verbose or error output", async () => {
    const dir = tempDir("calendar-canary");
    const zip = writeSyntheticZip(dir, "export.zip", { bundleMedia: true });
    const parts = join(dir, "parts");
    writeSyntheticParts(parts, { memoryCount: 200 });
    const tiny = writeTinyExport(join(dir, "tiny"), spread(40));
    const broken = join(dir, "broken.zip");
    writeFileSync(broken, zipSync({ "html/index.html": enc.encode("<html></html>") }));
    const cases = [
      [zip], [zip, "--json"], [parts], [parts, "--json", "--detail"], [parts, "--verbose", "--detail", "--year", "2025"], [tiny, "--verbose"], [broken, "--verbose"], [broken, "--json"],
      [zip, "--utc-offset=99", "--verbose"], [zip, "--year=1", "--verbose"], [zip, "--bogus", "--verbose"], [join(dir, "missing.zip"), "--verbose"], [],
    ];
    for (const args of cases) {
      const { out, err } = await runInsight(calendarCommand, args);
      const text = stripPaths(out + err);
      const label = args.map((a) => stripPaths(a)).join(" ");
      expectNoLeaks(text, label);
      expect(text, label).not.toMatch(/\b(?:ghost|oneway|dormant|active|newfriend|contact|sam)_\d+\b/);
      expect(text, label).not.toMatch(/\.(?:jpg|mp4|png|html|json)\b|[0-9A-F]{8}-[0-9A-F]{4}/i);
    }
  });

  it("hands core only a kind and a time", async () => {
    const zip = writeTinyExport(tempDir("calendar-fields"), spread(40));
    const json = JSON.parse((await runInsight(calendarCommand, [zip, "--json"])).out) as Json;
    expect(JSON.stringify(json)).not.toContain("sam_01");
    expect(JSON.stringify(json)).not.toMatch(/conversation|direction|username/i);
  });
});

/** Hand-built events for `n` chats and Snaps. */
function eventsFor(n: number): { kind: string; at: number }[] {
  return Array.from({ length: n }, (_, i) => ({ kind: KINDS[i % KINDS.length] as string, at: NOW - (i + 1) * 5 * DAY }));
}
const compute = (n: number): Calendar => insights.activityCalendar.computeActivityCalendar(eventsFor(n), { now: NOW });

describe("wording", () => {
  it.each([0, 1, 2, 12, 40])("reads correctly with %i events", (n) => {
    const text = renderCalendar(compute(n), term, false);
    expectBrandSafe(text, `count ${n}`);
    expect(text.endsWith("Nothing here has left this device.\n")).toBe(true);
    if (n === 0) expect(text).toContain("There is nothing to count yet.");
    if (n === 1) {
      expect(text).toContain("1 chat or Snap, on 1 day.");
      expect(text).toContain("Only 1 chat or Snap was counted, so this picture may be weak.");
      expect(text).toMatch(/Longest active run\s+1 day\s/);
      expect(text).toMatch(/Longest quiet run\s+–\s+–\s+–/);
    }
    if (n === 2) expect(text).toContain("Only 2 chats and Snaps were counted, so this picture may be weak.");
    if (n >= 12) expect(text).toContain("By month in");
  });

  it("describes every note in a sentence, and never shows an unknown code", () => {
    const codes = ["no-events", "no-usable-events", "undated-skipped", "future-skipped", "few-events", "many-other-kind", "year-adjusted", "year-empty", "offset-adjusted", "a-code-from-the-future"];
    for (const n of [0, 1, 2, 12]) {
      const base = compute(12);
      const result: Calendar = { ...base, notes: codes.map((code) => ({ code: code as insights.activityCalendar.ActivityCalendarNoteCode, params: { count: n, percent: 60, minutes: 0, year: 2024 } })) };
      const text = renderCalendar(result, term, false);
      expectBrandSafe(text, `notes ${n}`);
      expect(text).not.toContain("a-code-from-the-future");
      expect(text).not.toContain("code:");
      expect(text).toContain("Snappy noted something it cannot describe. Run it with --verbose and share the code.");
      expect(text).toContain("The time zone was moved to the nearest allowed one.");
      expect(text).toContain("About 60% have a kind Snappy cannot sort, so the mix may be off.");
      expect(text).toContain("That year was not usable, so Snappy shows 2024.");
      expect(text).toContain("No chats or Snaps were found in 2024, so its calendar is empty.");
      expect(renderCalendar(result, term, true)).toContain("code: a-code-from-the-future");
    }
    const one = renderCalendar({ ...compute(12), notes: [{ code: "undated-skipped", params: { count: 1 } }] }, term, false);
    expect(one).toContain("1 chat or Snap has no usable date. Snappy leaves it out.");
    const many = renderCalendar({ ...compute(12), notes: [{ code: "undated-skipped", params: { count: 3 } }] }, term, false);
    expect(many).toContain("3 chats and Snaps have no usable date. Snappy leaves them out.");
  });

  it("marks a tied busiest week and names no quietest week when there are fewer than two", () => {
    const at = (day: number): number => Date.UTC(2026, 2, day, 12);
    // Full weeks Mar 9 to 15 and Mar 16 to 22 have 3 each, inside a longer active period.
    const events = [1, 2, 9, 10, 11, 16, 17, 18, 24, 25].map((day) => ({ kind: "TEXT", at: at(day) }));
    const text = renderCalendar(insights.activityCalendar.computeActivityCalendar(events, { now: NOW }), term, false);
    expect(text).toMatch(/Busiest full week\s+Week of Mar 9, 2026, 3 chats and Snaps \(tied\)/);
    const single = renderCalendar(insights.activityCalendar.computeActivityCalendar(events.slice(0, 5), { now: NOW }), term, false);
    expect(single).toMatch(/Quietest full week\s+–/);
  });

  it("keeps every sentence short and in sentence case", () => {
    const text = renderCalendar(compute(40), term, false, { detail: true, limit: 3 });
    const prose = text
      .split("\n")
      .map((line) => line.replace(/^\s*(?:Warning|Note|Error)\s+/, "").trim())
      .filter((line) => /[.?]$/.test(line) && !/\s{2,}/.test(line));
    expect(prose.length).toBeGreaterThan(2);
    for (const s of prose.flatMap((line) => line.split(/(?<=[.?])\s+/))) expect(s.split(/\s+/).length, s).toBeLessThanOrEqual(20);
    expect(text).not.toMatch(/\b(?:ghosts?|unfriend\w*|dormant|inactive|dead|simply|just|streaks?)\b/i);
  });
});
