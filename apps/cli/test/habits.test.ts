/** snappy-export habits: when you chat and Snap most. Synthetic data only. */
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { insights } from "@snappy-export/core";
import { HABITS_USAGE, habitsCommand, renderHabits } from "../src/commands/habits.ts";
import { createTerm } from "../src/term.ts";
import { NOW, makeIo, stripPaths, tempDir, writeSyntheticParts, writeSyntheticZip } from "./helpers.ts";
import { expectBrandSafe, expectNoLeaks, expectValidDescriptor, runInsight } from "./insights-helpers.ts";

type Habits = insights.habits.HabitsResult;
type Json = Habits & { generatedAt: string };
const term = createTerm({ env: {}, isTTY: false, columns: 100 });
const enc = new TextEncoder();

const HOUR = 3_600_000;
const DAY = 86_400_000;
/** A Monday at 21:00 UTC, in March 2026. */
const MONDAY_9PM = Date.UTC(2026, 2, 2, 21, 0, 0);

interface Entry {
  at: number;
  sent?: boolean;
}

/** A tiny synthetic export: one friend and one conversation with the given entries. */
function writeTinyExport(dir: string, entries: Entry[], name = "tiny.zip"): string {
  mkdirSync(dir, { recursive: true });
  const rows = entries.map((e) => ({
    From: "sam_01",
    "Media Type": "TEXT",
    "Created(microseconds)": e.at * 1000,
    ...(e.sent === undefined ? {} : { IsSender: e.sent }),
  }));
  const zip = join(dir, name);
  writeFileSync(
    zip,
    zipSync({
      "json/friends.json": enc.encode(JSON.stringify({ Friends: [{ Username: "sam_01", "Creation Timestamp": "2026-01-01 00:00:00 UTC" }] })),
      "json/chat_history.json": enc.encode(JSON.stringify({ sam_01: rows })),
    }),
  );
  return zip;
}

/** `n` events spread over the days before NOW, alternating direction. */
function spread(n: number): Entry[] {
  return Array.from({ length: n }, (_, i) => ({ at: NOW - (i + 1) * DAY - (i % 24) * HOUR, sent: i % 2 === 0 }));
}

describe("the command", () => {
  it("is a valid descriptor", async () => {
    await expectValidDescriptor(habitsCommand);
    expect(habitsCommand.name).toBe("habits");
    expect(habitsCommand.group).toBe("Chats");
    expect(habitsCommand.usage).toBe(HABITS_USAGE);
  });

  it("describes every option in the usage, each on one line of 70 characters or fewer", () => {
    const rows = HABITS_USAGE.split("\n").filter((l) => /^ {2}--/.test(l));
    expect(rows.map((r) => r.trim().split(/\s+/)[0])).toEqual(["--utc-offset", "--months", "--detail", "--json", "--verbose", "--no-color"]);
    for (const r of rows) expect(r.replace(/^ {2}--\S+(?: <\w+>)?\s+/, "").length, r).toBeLessThanOrEqual(70);
  });

  it("shows the patterns for a three-part export, and exits 0", async () => {
    const dir = tempDir("habits-parts");
    writeSyntheticParts(dir);
    const { code, out, err } = await runInsight(habitsCommand, [dir]);
    const json = JSON.parse((await runInsight(habitsCommand, [dir, "--json"])).out) as Json;
    expect(code).toBe(0);
    expect(err).toBe("");
    for (const heading of ["Habits", "Overview", "Busiest times", "Sent and received", "By month"]) expect(out).toContain(heading);
    expect(out).toContain(`${json.totals.used.toLocaleString("en-US")} chats and Snaps, on ${json.activeDays.toLocaleString("en-US")} days.`);
    expect(out).toContain("Time zone                 UTC");
    expect(out).toMatch(/Of those with a known direction, you sent about \d+%\./);
    expect(out).not.toContain("By hour");
    expect(out).not.toContain("By weekday");
    expect(out).not.toContain("code:");
    expect(out.endsWith("Nothing here has left this device.\n")).toBe(true);
    expectBrandSafe(out, "habits");
  });

  it("reads one ZIP file too", async () => {
    const zip = writeSyntheticZip(tempDir("habits-one"), "a.zip", { bundleMedia: true });
    const { code, out } = await runInsight(habitsCommand, [zip]);
    expect(code).toBe(0);
    expect(out).toContain("Busiest times");
    expectBrandSafe(out, "one zip");
  });

  it("prints JSON with numbers and codes only", async () => {
    const dir = tempDir("habits-json");
    writeSyntheticParts(dir);
    const { code, out } = await runInsight(habitsCommand, [dir, "--json"]);
    expect(code).toBe(0);
    const json = JSON.parse(out) as Json;
    expect(json.generatedAt).toBe(new Date(NOW).toISOString());
    expect(Object.keys(json)).toEqual([
      "generatedAt", "utcOffsetMinutes", "totals", "byHour", "byWeekday", "byMonth", "sentShare", "busiest", "quietest", "medianGapMs", "activeDays", "first", "last", "notes",
    ]);
    expect(json.byHour).toHaveLength(24);
    expect(json.byWeekday).toHaveLength(7);
    expect(json.totals.used).toBeGreaterThan(0);
    expect(json.totals.used).toBe(json.totals.sent + json.totals.received + json.totals.unknown);
    expect(json.utcOffsetMinutes).toBe(0);
  });

  it("finds the busiest hour and day, and moves them with --utc-offset", async () => {
    const zip = writeTinyExport(
      tempDir("habits-hours"),
      Array.from({ length: 40 }, (_, i) => ({ at: MONDAY_9PM - Math.floor(i / 2) * 7 * DAY + (i % 2) * 60_000, sent: i % 3 !== 0 })),
    );
    const utc = await runInsight(habitsCommand, [zip]);
    expect(utc.out).toMatch(/Hour of day\s+9 pm\s+100%/);
    expect(utc.out).toMatch(/Day of week\s+Monday\s+100%/);
    const east = await runInsight(habitsCommand, [zip, "--utc-offset", "3"]);
    expect(east.out).toMatch(/Hour of day\s+12 am\s+100%/);
    expect(east.out).toMatch(/Day of week\s+Tuesday\s+100%/);
    expect(east.out).toContain("Time zone                 UTC+3:00");
    const west = await runInsight(habitsCommand, [zip, "--utc-offset=-5:30"]);
    expect(west.out).toMatch(/Hour of day\s+3 pm\s+100%/);
    expect(west.out).toContain("UTC-5:30");
    const json = JSON.parse((await runInsight(habitsCommand, [zip, "--utc-offset=-5:30", "--json"])).out) as Json;
    expect(json.utcOffsetMinutes).toBe(-330);
    expect(json.busiest.hour?.key).toBe(15);
    expect(json.notes.map((n) => n.code)).not.toContain("offset-adjusted");
  });

  it("limits the month list with --months and says how many are left out", async () => {
    const zip = writeTinyExport(tempDir("habits-months"), spread(400));
    const all = JSON.parse((await runInsight(habitsCommand, [zip, "--json"])).out) as Json;
    expect(all.byMonth.length).toBeGreaterThan(12);
    const rows = (text: string): number => text.split("\n").filter((l) => /^ {2}[A-Z][a-z]{2} \d{4}\s+\d/.test(l)).length;
    const dflt = await runInsight(habitsCommand, [zip]);
    expect(rows(dflt.out)).toBe(12);
    expect(dflt.out).toContain(`Showing the latest 12 months of ${all.byMonth.length}.`);
    const one = await runInsight(habitsCommand, [zip, "--months", "1"]);
    expect(rows(one.out)).toBe(1);
    expect(one.out).toContain(`Showing the latest 1 month of ${all.byMonth.length}.`);
    const every = await runInsight(habitsCommand, [zip, "--months", "1200"]);
    expect(rows(every.out)).toBe(all.byMonth.length);
    expect(every.out).not.toContain("Showing the latest");
  });

  it("adds a row for every hour and weekday with --detail", async () => {
    const zip = writeTinyExport(tempDir("habits-detail"), spread(60));
    const { out } = await runInsight(habitsCommand, [zip, "--detail"]);
    expect(out).toContain("By hour");
    expect(out).toContain("By weekday");
    expect(out.split("\n").filter((l) => /^ {2}(?:1?\d) (?:am|pm)\s+\d/.test(l))).toHaveLength(24);
    for (const day of ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]) expect(out).toMatch(new RegExp(`^ {2}${day}\\s+\\d`, "m"));
    expectBrandSafe(out, "detail");
  });

  it("notes a small count, a missing direction, and dates in the future", async () => {
    const small = await runInsight(habitsCommand, [writeTinyExport(tempDir("habits-few"), spread(5), "few.zip")]);
    expect(small.code).toBe(0);
    expect(small.out).toContain("Warning  Only 5 chats and Snaps were counted, so these patterns may be weak.");
    const unknown = await runInsight(habitsCommand, [writeTinyExport(tempDir("habits-unknown"), spread(40).map(({ at }) => ({ at })), "unknown.zip")]);
    expect(unknown.out).toContain("have no known direction, so the sent share may be off.");
    expect(unknown.out).not.toContain("Of those with a known direction");
    const future = await runInsight(
      habitsCommand,
      [writeTinyExport(tempDir("habits-future"), [...spread(40), { at: NOW + 3 * DAY, sent: true }, { at: NOW + 9 * DAY, sent: true }], "future.zip"), "--verbose"],
    );
    expect(future.out).toContain("Note     2 chats and Snaps are dated in the future. Snappy leaves them out.");
    expect(future.out).toContain("code: future-skipped");
    const one = await runInsight(habitsCommand, [writeTinyExport(tempDir("habits-future1"), [...spread(40), { at: NOW + DAY, sent: true }], "future1.zip")]);
    expect(one.out).toContain("1 chat or Snap is dated in the future. Snappy leaves it out.");
    for (const r of [small, unknown, future, one]) expectBrandSafe(r.out, "notes");
  });

  it("says there is nothing to count for an export without chats or Snaps", async () => {
    const zip = writeTinyExport(tempDir("habits-none"), []);
    const { code, out } = await runInsight(habitsCommand, [zip]);
    expect(code).toBe(0);
    expect(out).toContain("There is nothing to count yet.");
    expect(out).toContain("No chats or Snaps were found in your export.");
    expect(out).not.toContain("Busiest times");
    expectBrandSafe(out, "none");
    const json = JSON.parse((await runInsight(habitsCommand, [zip, "--json"])).out) as Json;
    expect(json.totals.used).toBe(0);
    expect(json.busiest).toEqual({ hour: null, weekday: null, month: null });
  });

  it("stops with exit 2 for a broken export, in text and in JSON, and touches no ledger", async () => {
    const dir = tempDir("habits-broken");
    const zip = join(dir, "broken.zip");
    writeFileSync(zip, zipSync({ "html/index.html": enc.encode("<html></html>") }));
    const home = tempDir("habits-broken-home");
    const io = makeIo({ home });
    const text = await runInsight(habitsCommand, [zip, "--verbose"], io);
    expect(text.code).toBe(2);
    expect(text.out).toContain("Error");
    expect(text.out).toContain("code: html-only-export");
    expect(text.out).toContain("Snappy stopped, since habits from a broken export may mislead.");
    expect(text.out).not.toContain("Busiest times");
    expect(io.asked).toEqual([]);
    expect(readdirSync(home)).toEqual([]);
    const json = await runInsight(habitsCommand, [zip, "--json"]);
    expect(json.code).toBe(2);
    expect((JSON.parse(json.out) as { stopped: string }).stopped).toBe("export-errors");
    expectBrandSafe(text.out, "broken");
  });

  it("uses no color with --no-color or NO_COLOR, and color on a color terminal", async () => {
    const zip = writeSyntheticZip(tempDir("habits-color"), "a.zip");
    const color = await runInsight(habitsCommand, [zip], makeIo({ interactive: true, env: { COLORTERM: "truecolor" } }));
    expect(color.out).toContain("\x1b[");
    expect((await runInsight(habitsCommand, [zip, "--no-color"], makeIo({ interactive: true, env: { COLORTERM: "truecolor" } }))).out).not.toContain("\x1b");
    expect((await runInsight(habitsCommand, [zip], makeIo({ interactive: true, env: { NO_COLOR: "1" } }))).out).not.toContain("\x1b");
  });

  it("writes no file, reads no ledger and asks for no passphrase", async () => {
    const home = tempDir("habits-home");
    const dir = tempDir("habits-ro");
    writeSyntheticParts(dir);
    const before = readdirSync(dir).sort();
    const io = makeIo({ home, env: { SNAPPY_PASSPHRASE: "never-used" } });
    for (const args of [[dir], [dir, "--json"], [dir, "--detail"]]) await runInsight(habitsCommand, args, io);
    expect(io.asked).toEqual([]);
    expect(readdirSync(home)).toEqual([]);
    expect(readdirSync(dir).sort()).toEqual(before);
  });

  it("stops with calm messages for a missing path, no input and bad options", async () => {
    const dir = tempDir("habits-errors");
    const missing = await runInsight(habitsCommand, [join(dir, "missing.zip")]);
    expect(missing).toMatchObject({ code: 1, out: "" });
    expect(missing.err).toContain("could not find");
    expect((await runInsight(habitsCommand, [])).err).toContain("Give Snappy your export");
    const zip = writeSyntheticZip(dir, "a.zip");
    expect((await runInsight(habitsCommand, [zip, "--bogus"])).err).toContain('Snappy does not know the option --bogus for habits. Run "snappy-export help habits"');
    for (const bad of ["x", "15", "-13", "5:75", "1.5", "", "+", "100"]) {
      const arg = `--utc-offset=${bad}`;
      const r = await runInsight(habitsCommand, [zip, arg]);
      expect(r, arg).toMatchObject({ code: 1, out: "" });
      expect(r.err, arg).toContain("--utc-offset must be hours from UTC");
    }
    for (const bad of ["0", "x", "1.5", "-2", "1201"]) {
      const r = await runInsight(habitsCommand, [zip, `--months=${bad}`]);
      expect(r, bad).toMatchObject({ code: 1, out: "" });
      expect(r.err, bad).toContain("--months must be a whole number from 1 to 1200.");
    }
    const noValue = await runInsight(habitsCommand, [zip, "--utc-offset", "-5"]);
    expect(noValue.err).toContain("If it starts with a dash, write --utc-offset=value.");
  });

  it("checks the options before it reads anything", async () => {
    const dir = tempDir("habits-order");
    const r = await runInsight(habitsCommand, [join(dir, "missing.zip"), "--utc-offset=99"]);
    expect(r.err).toContain("--utc-offset must be hours from UTC");
    expect(r.err).not.toContain("could not find");
  });
});

describe("privacy", () => {
  it("prints no canary, link, entry name or username, in text, JSON, verbose or error output", async () => {
    const dir = tempDir("habits-canary");
    const zip = writeSyntheticZip(dir, "export.zip", { bundleMedia: true });
    const parts = join(dir, "parts");
    writeSyntheticParts(parts, { memoryCount: 200 });
    const tiny = writeTinyExport(join(dir, "tiny"), spread(40));
    const broken = join(dir, "broken.zip");
    writeFileSync(broken, zipSync({ "html/index.html": enc.encode("<html></html>") }));
    const cases = [[zip], [zip, "--json"], [parts], [parts, "--json", "--detail"], [parts, "--verbose", "--detail"], [tiny, "--verbose"], [broken, "--verbose"], [broken, "--json"], [zip, "--utc-offset=99", "--verbose"], [zip, "--bogus", "--verbose"], [join(dir, "missing.zip"), "--verbose"], []];
    for (const args of cases) {
      const { out, err } = await runInsight(habitsCommand, args);
      const text = stripPaths(out + err);
      const label = args.map((a) => stripPaths(a)).join(" ");
      expectNoLeaks(text, label);
      expect(text, label).not.toMatch(/\b(?:ghost|oneway|dormant|active|newfriend|contact|sam)_\d+\b/);
      expect(text, label).not.toMatch(/\.(?:jpg|mp4|png|html|json)\b|[0-9A-F]{8}-[0-9A-F]{4}/i);
    }
  });
});

/** Hand-built events for `n` chats and Snaps. */
function eventsFor(n: number): { direction: string; at: number }[] {
  return Array.from({ length: n }, (_, i) => ({ direction: i % 5 === 4 ? "unknown" : i % 2 === 0 ? "sent" : "received", at: NOW - (i + 1) * 5 * DAY }));
}

describe("wording", () => {
  it.each([0, 1, 2, 12, 40])("reads correctly with %i events", (n) => {
    const result = insights.habits.computeHabits(eventsFor(n), { now: NOW });
    const text = renderHabits(result, term, false);
    expectBrandSafe(text, `count ${n}`);
    expect(text.endsWith("Nothing here has left this device.\n")).toBe(true);
    if (n === 0) expect(text).toContain("There is nothing to count yet.");
    if (n === 1) {
      expect(text).toContain("1 chat or Snap, on 1 day.");
      expect(text).toContain("Only 1 chat or Snap was counted, so these patterns may be weak.");
    }
    if (n === 2) expect(text).toContain("Only 2 chats and Snaps were counted, so these patterns may be weak.");
    if (n >= 12) expect(text).not.toContain("Of those with a known direction, you sent about NaN");
  });

  it("describes every note in a sentence, and never shows an unknown code", () => {
    const codes = ["no-events", "no-usable-events", "undated-skipped", "future-skipped", "few-events", "many-unknown-direction", "offset-adjusted", "a-code-from-the-future"];
    for (const n of [0, 1, 2, 12]) {
      const base = insights.habits.computeHabits(eventsFor(12), { now: NOW });
      const result: Habits = { ...base, notes: codes.map((code) => ({ code: code as insights.habits.HabitsNoteCode, params: { count: n, percent: 60, minutes: 0 } })) };
      const text = renderHabits(result, term, false);
      expectBrandSafe(text, `notes ${n}`);
      expect(text).not.toContain("a-code-from-the-future");
      expect(text).not.toContain("code:");
      expect(text).toContain("Snappy noted something it cannot describe. Run it with --verbose and share the code.");
      expect(text).toContain("The time zone was moved to the nearest allowed one.");
      expect(text).toContain("About 60% have no known direction, so the sent share may be off.");
      const verbose = renderHabits(result, term, true);
      expect(verbose).toContain("code: a-code-from-the-future");
    }
    const one = renderHabits({ ...insights.habits.computeHabits(eventsFor(12), { now: NOW }), notes: [{ code: "undated-skipped", params: { count: 1 } }] }, term, false);
    expect(one).toContain("1 chat or Snap has no usable date. Snappy leaves it out.");
    const many = renderHabits({ ...insights.habits.computeHabits(eventsFor(12), { now: NOW }), notes: [{ code: "undated-skipped", params: { count: 3 } }] }, term, false);
    expect(many).toContain("3 chats and Snaps have no usable date. Snappy leaves them out.");
  });

  it("marks a tied peak and hides a quietest bucket that only won a tie", () => {
    const result = insights.habits.computeHabits([{ direction: "sent", at: MONDAY_9PM }, { direction: "received", at: MONDAY_9PM + HOUR }], { now: NOW });
    const text = renderHabits(result, term, false);
    expect(text).toMatch(/Hour of day\s+9 pm \(tied\)\s+50%\s+-/);
    expect(text).toMatch(/Month\s+Mar 2026\s+100%\s+-/);
  });

  it("words the typical gap in seconds, minutes, hours and days", () => {
    const base = insights.habits.computeHabits(eventsFor(12), { now: NOW });
    const gap = (ms: number): string => renderHabits({ ...base, medianGapMs: ms }, term, false).split("\n").find((l) => l.includes("Typical gap")) ?? "";
    expect(gap(0)).toContain("Under 1 second");
    expect(gap(1000)).toContain("1 second");
    expect(gap(30_000)).toContain("30 seconds");
    expect(gap(60_000)).toContain("1 minute");
    expect(gap(12 * 60_000)).toContain("12 minutes");
    expect(gap(HOUR)).toContain("1 hour");
    expect(gap(5 * HOUR)).toContain("5 hours");
    expect(gap(2 * DAY)).toContain("2 days");
    expect(gap(59_700)).toContain("1 minute");
  });

  it("keeps every sentence short and in sentence case", () => {
    const text = renderHabits(insights.habits.computeHabits(eventsFor(40), { now: NOW }), term, false, { detail: true, months: 3 });
    const prose = text
      .split("\n")
      .map((line) => line.replace(/^\s*(?:Warning|Note|Error)\s+/, "").trim())
      .filter((line) => /[.?]$/.test(line) && !/\s{2,}/.test(line));
    expect(prose.length).toBeGreaterThan(2);
    for (const s of prose.flatMap((line) => line.split(/(?<=[.?])\s+/))) expect(s.split(/\s+/).length, s).toBeLessThanOrEqual(20);
    expect(text).not.toMatch(/\b(?:ghosts?|unfriend\w*|dormant|inactive|dead|simply|just)\b/i);
  });
});
