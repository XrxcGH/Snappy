/** snappy-export remind: the next-export reminder (.ics). Synthetic data only. */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { insights } from "@snappy-export/core";
import { remindCommand, renderRemind } from "../src/commands/remind.ts";
import type { RemindView } from "../src/commands/remind.ts";
import { createTerm } from "../src/term.ts";
import { LATER, NOW, makeIo, stripPaths, tempDir, writeSyntheticParts, writeSyntheticZip } from "./helpers.ts";
import { expectBrandSafe, expectNoLeaks, expectValidDescriptor, runInsight } from "./insights-helpers.ts";

const term = createTerm({ env: {}, isTTY: false, columns: 100 });
const USERNAME = /\b(?:ghost|oneway|dormant|active|newfriend)_\d+\b/;

/** Unfolds the .ics lines (a continuation starts with a space) and splits them. */
function icsLines(text: string): string[] {
  return text.replace(/\r\n /g, "").split("\r\n").filter((l) => l !== "");
}

describe("the command", () => {
  it("is a valid descriptor", async () => {
    await expectValidDescriptor(remindCommand);
    expect(remindCommand.name).toBe("remind");
    expect(remindCommand.group).toBe("Your export");
  });

  it("works with no export at all, counting from today", async () => {
    const { code, out, err } = await runInsight(remindCommand, []);
    expect(code).toBe(0);
    expect(err).toBe("");
    expect(out).toContain("Export reminder");
    expect(out).toContain("Request your next export on Feb 6, 2027.");
    expect(out).toContain("Last export    Not known");
    expect(out).toContain("Wait           3 months");
    expect(out).toContain("Event          All day");
    expect(out).toContain("Alert          None");
    expect(out).toContain("Note     No last export date was found, so the wait counts from today.");
    expect(out).toContain("Nothing was saved.");
    expect(out).toContain("Add --out snappy-export-reminder.ics to make the calendar file.");
    expect(out.endsWith("Nothing here has left this device.\n")).toBe(true);
    expect(out).not.toContain("code:");
    expectBrandSafe(out, "remind");
  });

  it("takes the last export date from the ZIP files", async () => {
    const dir = tempDir("remind-parts");
    writeSyntheticParts(dir);
    const { code, out } = await runInsight(remindCommand, [dir]);
    expect(code).toBe(0);
    expect(out).toContain("Request your next export on Feb 1, 2027.");
    expect(out).toContain("Last export    Nov 1, 2026, from your export");
    expect(out).not.toContain("Notes");
    expectBrandSafe(out, "remind parts");
  });

  it("reads a single ZIP file the same way", async () => {
    const zip = writeSyntheticZip(tempDir("remind-one"), "a.zip");
    const { code, out } = await runInsight(remindCommand, [zip, "--months", "6"]);
    expect(code).toBe(0);
    expect(out).toContain("Request your next export on May 1, 2027.");
    expect(out).toContain("Wait           6 months");
  });

  it("takes a date with --last-export, and says one month, not 1 months", async () => {
    const { code, out } = await runInsight(remindCommand, ["--last-export", "2026-10-15", "--months", "1"]);
    expect(code).toBe(0);
    expect(out).toContain("Request your next export on Nov 15, 2026.");
    expect(out).toContain("Last export    Oct 15, 2026, from the date you gave");
    expect(out).toContain("Wait           1 month");
    expect(out).not.toMatch(/\b1 months\b/);
  });

  it("clamps the day at the end of a short month, and says so", async () => {
    const { out } = await runInsight(remindCommand, ["--last-export", "2026-10-31", "--months", "1"]);
    expect(out).toContain("Request your next export on Nov 30, 2026.");
    expect(out).toContain("That day does not exist in the reminder month, so it falls on the last day of it.");
  });

  it("moves a date that has passed to tomorrow", async () => {
    const { code, out } = await runInsight(remindCommand, ["--last-export", "2025-01-10"]);
    expect(code).toBe(0);
    expect(out).toContain("Request your next export on Nov 7, 2026.");
    expect(out).toContain("Warning  Your next export may be due already, so the reminder is set for tomorrow.");
  });

  it("counts from today when the last export date is in the future", async () => {
    const { out } = await runInsight(remindCommand, ["--last-export", "2027-05-01"]);
    expect(out).toContain("Request your next export on Feb 6, 2027.");
    expect(out).toContain("Last export    Not known");
    expect(out).toContain("The last export date is in the future, so the wait counts from today.");
  });

  it("makes a timed event with a length and an alert", async () => {
    const { code, out } = await runInsight(remindCommand, ["--last-export", "2026-11-01", "--time", "14:05", "--length", "45", "--alarm", "2"]);
    expect(code).toBe(0);
    expect(out).toContain("Event          2:05 PM, 45 minutes");
    expect(out).toContain("Alert          2 days before");
    const one = await runInsight(remindCommand, ["--time", "0:00", "--length", "1", "--alarm", "1"]);
    expect(one.out).toContain("Event          12:00 AM, 1 minute");
    expect(one.out).toContain("Alert          1 day before");
    const same = await runInsight(remindCommand, ["--alarm", "0"]);
    expect(same.out).toContain("Alert          Same day");
    expectBrandSafe(out + one.out + same.out, "timed");
  });

  it("uses the offset to decide which calendar day the last export fell on", async () => {
    const { out } = await runInsight(remindCommand, ["--last-export", "2026-10-31", "--utc-offset=-300"]);
    expect(out).toContain("Last export    Oct 31, 2026, from the date you gave");
    expect(out).toContain("Request your next export on Jan 31, 2027.");
  });

  it("prints JSON with the calendar text and no export data", async () => {
    const dir = tempDir("remind-json");
    writeSyntheticParts(dir);
    const { code, out } = await runInsight(remindCommand, [dir, "--json"]);
    expect(code).toBe(0);
    const json = JSON.parse(out) as insights.exportReminder.ExportReminder & Record<string, unknown>;
    expect(json.generatedAt).toBe(new Date(NOW).toISOString());
    expect(json.lastExportAt).toBe(new Date(LATER).toISOString());
    expect(json.lastExportSource).toBe("export");
    expect(json.saved).toBe(false);
    expect(json.due).toEqual({ year: 2027, month: 2, day: 1 });
    expect(json.allDay).toBe(true);
    expect(json.intervalMonths).toBe(3);
    expect(json.uid).toBe(insights.exportReminder.REMINDER_UID);
    expect(json.notes).toEqual([]);
    expect(String(json.ics)).toContain("BEGIN:VCALENDAR");
    expect(Object.keys(json)).toEqual(["generatedAt", "lastExportAt", "lastExportSource", "saved", "ics", "due", "dueAt", "intervalMonths", "allDay", "uid", "notes"]);
  });

  it("adds the short code to each note with --verbose, and none without it", async () => {
    const quiet = await runInsight(remindCommand, []);
    expect(quiet.out).not.toContain("code:");
    const verbose = await runInsight(remindCommand, ["--verbose"]);
    expect(verbose.out).toContain("code: no-last-export");
  });

  it("uses no color with --no-color or NO_COLOR, and color on a color terminal", async () => {
    const color = await runInsight(remindCommand, [], makeIo({ interactive: true, env: { COLORTERM: "truecolor" } }));
    expect(color.out).toContain("\x1b[");
    expect((await runInsight(remindCommand, ["--no-color"], makeIo({ interactive: true, env: { COLORTERM: "truecolor" } }))).out).not.toContain("\x1b");
    expect((await runInsight(remindCommand, [], makeIo({ interactive: true, env: { NO_COLOR: "1" } }))).out).not.toContain("\x1b");
  });
});

describe("saving the file", () => {
  it("writes the calendar file only with --out, and prints the path the person typed", async () => {
    const dir = tempDir("remind-save");
    const home = tempDir("remind-home");
    const target = join(dir, "next.ics");
    const io = makeIo({ home });
    const { code, out } = await runInsight(remindCommand, ["--last-export", "2026-11-01", "--out", target], io);
    expect(code).toBe(0);
    expect(out).toContain(`Saved to ${target}.`);
    expect(out).toContain("Open it in your calendar app to add the event.");
    expect(out).not.toContain("Nothing was saved.");
    expect(readdirSync(dir)).toEqual(["next.ics"]);
    const text = readFileSync(target, "utf8");
    const lines = icsLines(text);
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(lines.at(-1)).toBe("END:VCALENDAR");
    expect(lines).toContain("DTSTART;VALUE=DATE:20270201");
    expect(lines).toContain("DTEND;VALUE=DATE:20270202");
    expect(lines).toContain(`UID:${insights.exportReminder.REMINDER_UID}`);
    expect(insights.exportReminder.validateIcs(text).valid).toBe(true);
    expect(text).not.toMatch(/URL|ATTACH|ATTENDEE|ORGANIZER/);
    // No ledger, no passphrase and nothing else written.
    expect(io.asked).toEqual([]);
    expect(readdirSync(home)).toEqual([]);
  });

  it("writes a timed event with an alert", async () => {
    const dir = tempDir("remind-timed");
    const target = join(dir, "t.ics");
    await runInsight(remindCommand, ["--last-export", "2026-11-01", "--time", "09:30", "--length", "15", "--alarm", "1", "--out", target]);
    const text = readFileSync(target, "utf8");
    const lines = icsLines(text);
    expect(lines).toContain("DTSTART:20270201T093000");
    expect(lines).toContain("DTEND:20270201T094500");
    expect(lines).toContain("TRIGGER:-P1D");
    expect(insights.exportReminder.validateIcs(text).valid).toBe(true);
  });

  it("saves the text it printed JSON for, and says so", async () => {
    const dir = tempDir("remind-json-save");
    const target = join(dir, "j.ics");
    const { code, out } = await runInsight(remindCommand, ["--json", "--out", target]);
    expect(code).toBe(0);
    expect((JSON.parse(out) as { saved: boolean }).saved).toBe(true);
    expect(readFileSync(target, "utf8")).toBe((JSON.parse(out) as { ics: string }).ics);
  });

  it("holds no personal data, even when an export was read", async () => {
    const dir = tempDir("remind-private");
    writeSyntheticParts(join(dir, "export"));
    const target = join(dir, "p.ics");
    await runInsight(remindCommand, [join(dir, "export"), "--out", target]);
    const text = readFileSync(target, "utf8");
    expectNoLeaks(text, "ics");
    expect(text).not.toMatch(USERNAME);
    expect(text).toContain("SUMMARY:Request your next Snapchat export");
  });

  it("never replaces an existing file without --force", async () => {
    const dir = tempDir("remind-force");
    const target = join(dir, "keep.ics");
    writeFileSync(target, "old");
    const refused = await runInsight(remindCommand, ["--out", target]);
    expect(refused.code).toBe(1);
    expect(refused.out).toBe("");
    expect(refused.err).toContain("already exists, so Snappy did not replace it");
    expect(readFileSync(target, "utf8")).toBe("old");
    const forced = await runInsight(remindCommand, ["--out", target, "--force"]);
    expect(forced.code).toBe(0);
    expect(readFileSync(target, "utf8")).toContain("BEGIN:VCALENDAR");
  });

  it("creates missing folders, and writes nothing when no output flag is given", async () => {
    const dir = tempDir("remind-nested");
    const nested = join(dir, "a", "b", "n.ics");
    expect((await runInsight(remindCommand, ["--out", nested])).code).toBe(0);
    expect(existsSync(nested)).toBe(true);

    const home = tempDir("remind-quiet-home");
    const work = tempDir("remind-quiet");
    writeSyntheticParts(work);
    const before = readdirSync(work).sort();
    const io = makeIo({ home });
    await runInsight(remindCommand, [work], io);
    expect(readdirSync(work).sort()).toEqual(before);
    expect(readdirSync(home)).toEqual([]);
    expect(io.asked).toEqual([]);
  });

  it("checks the file name before reading anything", async () => {
    const dir = tempDir("remind-name");
    const wrong = await runInsight(remindCommand, [join(dir, "missing.zip"), "--out", join(dir, "x.txt")]);
    expect(wrong.code).toBe(1);
    expect(wrong.err).toContain("--out needs a file name ending in .ics");
    expect(readdirSync(dir)).toEqual([]);
  });
});

describe("mistakes", () => {
  it("stops with calm messages for bad options", async () => {
    const dir = tempDir("remind-errors");
    const cases: Array<[string[], string]> = [
      [["--last-export", "yesterday"], "--last-export must be a date such as 2026-11-01"],
      [["--last-export", "2026-02-30"], "--last-export must be a date such as 2026-11-01"],
      [["--months", "0"], "--months must be a whole number from 1 to 120"],
      [["--months", "x"], "--months must be a whole number from 1 to 120"],
      [["--alarm", "31"], "--alarm must be a whole number from 0 to 30"],
      [["--time", "25:00"], "--time must be a 24-hour time such as 09:30"],
      [["--time", "9"], "--time must be a 24-hour time such as 09:30"],
      [["--length", "30"], "--length needs --time"],
      [["--time", "09:00", "--length", "0"], "--length must be a whole number from 1 to 1440"],
      [["--utc-offset=900"], "--utc-offset must be a whole number of minutes from -840 to 840"],
      [["--utc-offset=abc"], "--utc-offset must be a whole number of minutes from -840 to 840"],
      [["--force"], "--force needs --out"],
      [["--last-export", "2026-11-01", join(dir, "a.zip")], "Give ZIP files or --last-export, not both."],
      [["--bogus"], 'Snappy does not know the option --bogus for remind. Run "snappy-export help remind"'],
      [["--out"], "The option --out needs a value."],
    ];
    for (const [args, message] of cases) {
      const result = await runInsight(remindCommand, args);
      expect(result.code, args.join(" ")).toBe(1);
      expect(result.out, args.join(" ")).toBe("");
      expect(result.err, args.join(" ")).toContain(message);
    }
    expect(readdirSync(dir)).toEqual([]);
  });

  it("stops calmly for a missing path or a file that is not a ZIP file", async () => {
    const dir = tempDir("remind-paths");
    const missing = await runInsight(remindCommand, [join(dir, "missing.zip")]);
    expect(missing).toMatchObject({ code: 1, out: "" });
    expect(missing.err).toContain("could not find");
    const notZip = join(dir, "notes.txt");
    writeFileSync(notZip, "hello");
    const wrong = await runInsight(remindCommand, [notZip]);
    expect(wrong.code).toBe(1);
    expect(wrong.out).toBe("");
    expect(wrong.err).not.toBe("");
  });

  it("does not echo what was typed for a bad value", async () => {
    const result = await runInsight(remindCommand, ["--last-export", "SECRET-VALUE"]);
    expect(result.err).not.toContain("SECRET-VALUE");
  });
});

describe("privacy", () => {
  it("prints no canary, link, username or file name, in text, JSON, --verbose and errors", async () => {
    const dir = tempDir("remind-canary");
    const zip = writeSyntheticZip(dir, "export.zip", { bundleMedia: true });
    const parts = join(dir, "parts");
    writeSyntheticParts(parts, { memoryCount: 200 });
    const argLists = [[zip], [zip, "--json"], [parts], [parts, "--json", "--verbose"], [zip, "--verbose", "--time", "08:00"], [], ["--last-export", "2020-01-01", "--verbose"], [zip, "--bogus"], [join(dir, "missing.zip")], [zip, "--months", "x"]];
    for (const args of argLists) {
      const { out, err } = await runInsight(remindCommand, args);
      const text = stripPaths(out + err);
      expectNoLeaks(text, args.join(" "));
      expect(text, args.join(" ")).not.toMatch(USERNAME);
      expect(text, args.join(" ")).not.toMatch(/\.(?:jpg|mp4|png|html|json)\b|[0-9A-F]{8}-[0-9A-F]{4}/i);
    }
  });
});

/** A hand-built view, to read each sentence at counts of 0, 1, 2 and 12. */
function view(n: number, codes: string[]): RemindView {
  const reminder = insights.exportReminder.buildExportReminder({ now: NOW, lastExportAt: LATER, intervalMonths: Math.max(1, n) });
  return {
    reminder: { ...reminder, notes: codes.map((code) => ({ code, params: { used: n } })) },
    lastExportAt: LATER,
    lastSource: "export",
    utcOffsetMinutes: 0,
    timed: { hour: 13, minute: 0, durationMinutes: Math.max(1, n) },
    alarmDaysBefore: n,
  };
}
const ALL_CODES = [
  "no-last-export", "last-export-invalid", "last-export-in-future", "interval-adjusted", "time-adjusted", "alarm-adjusted",
  "offset-adjusted", "day-clamped", "due-date-passed", "a-code-from-the-future",
];

describe("wording", () => {
  it.each([0, 1, 2, 12])("reads correctly with a count of %i", (n) => {
    const text = renderRemind(view(n, ALL_CODES), term, false);
    expectBrandSafe(text, `count ${n}`);
    expect(text).not.toContain("a-code-from-the-future");
    expect(text).toContain("Snappy noted something it cannot describe.");
    expect(text).toContain("Run it with --verbose and share the code.");
  });

  it("says one month, one minute and one day, and the plural for more", () => {
    const one = renderRemind(view(1, ["interval-adjusted"]), term, false);
    expect(one).toContain("Wait           1 month");
    expect(one).toContain("1:00 PM, 1 minute");
    expect(one).toContain("1 day before");
    expect(one).toContain("so Snappy used 1 month.");
    const many = renderRemind(view(2, ["interval-adjusted"]), term, false);
    expect(many).toContain("Wait           2 months");
    expect(many).toContain("1:00 PM, 2 minutes");
    expect(many).toContain("2 days before");
    expect(many).toContain("so Snappy used 2 months.");
    expect(renderRemind(view(12, []), term, false)).toContain("Wait           12 months");
  });

  it("shows the saved path only when there is one", () => {
    const saved = renderRemind({ ...view(3, []), savedTo: "next.ics" }, term, false);
    expect(saved).toContain("Saved to next.ics.");
    expect(saved).not.toContain("Nothing was saved.");
    expect(renderRemind(view(3, []), term, false)).toContain("Nothing was saved.");
  });

  it("keeps every sentence short and in sentence case", () => {
    const text = renderRemind(view(2, ALL_CODES), term, false);
    const prose = text
      .split("\n")
      .map((line) => line.replace(/^\s*(?:Warning|Note|Error)\s+/, "").trim())
      .filter((line) => /[.?]$/.test(line) && !/\s{2,}/.test(line));
    expect(prose.length).toBeGreaterThan(8);
    for (const s of prose.flatMap((line) => line.split(/(?<=[.?])\s+/))) expect(s.split(/\s+/).length, s).toBeLessThanOrEqual(20);
    expect(text).not.toMatch(/\b(?:ghosts?|unfriend\w*|dormant|inactive|dead|simply|just)\b/i);
  });
});
