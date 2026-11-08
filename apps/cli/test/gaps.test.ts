/** snappy-export gaps: quiet stretches and the busiest stretch in the Memories timeline. Synthetic data only. */
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { insights } from "@snappy-export/core";
import { gapsCommand, monthText, offsetLabel, oldestFriendDate, renderGaps } from "../src/commands/gaps.ts";
import type { GapsReport } from "../src/commands/gaps.ts";
import { createTerm } from "../src/term.ts";
import { LATER, NOW, makeIo, stripPaths, tempDir, writeSyntheticParts, writeSyntheticZip } from "./helpers.ts";
import { expectBrandSafe, expectNoLeaks, expectValidDescriptor, runInsight } from "./insights-helpers.ts";

const term = createTerm({ env: {}, isTTY: false, columns: 100 });

const stamp = (y: number, m: number, d: number, hour = 10): string => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")} ${String(hour).padStart(2, "0")}:00:00 UTC`;

interface Entry {
  date: string;
  link?: string;
}

let linkNumber = 0;
const entry = (date: string, link?: string): Entry => ({ date, link: link ?? `https://demo.snappy.invalid/dmd/memories?mid=${++linkNumber}` });

/** An export that holds only a friends file and a Memories file, so every date is exactly what a test writes. */
function timelineZip(dir: string, memories: Entry[], friends: Array<[string, string | undefined]>, name = "export.zip"): string {
  const enc = new TextEncoder();
  const friendsJson = { Friends: friends.map(([u, at]) => ({ Username: u, ...(at === undefined ? {} : { "Creation Timestamp": at }) })) };
  const memoriesJson = { "Saved Media": memories.map((m) => ({ Date: m.date, "Media Type": "Image", "Download Link": m.link })) };
  const path = join(dir, name);
  writeFileSync(
    path,
    zipSync({
      "json/friends.json": [enc.encode(JSON.stringify(friendsJson)), { mtime: new Date(LATER) }],
      "json/memories_history.json": [enc.encode(JSON.stringify(memoriesJson)), { mtime: new Date(LATER) }],
    }),
  );
  return path;
}

/**
 * Two in Jan 2022, none in Feb to Apr (a gap of 3), one in May, three in Jun, none in Jul, one in Aug.
 * The oldest friend date is Jun 2021, so Jul to Dec 2021 is an early gap of 6. Then nothing after Aug 2022: a late gap of 50.
 * One undated and one in the future.
 */
function timelineMemories(): Entry[] {
  return [
    entry(stamp(2022, 1, 15)),
    entry(stamp(2022, 1, 20)),
    entry(stamp(2022, 5, 10)),
    entry(stamp(2022, 6, 5)),
    entry(stamp(2022, 6, 6)),
    entry(stamp(2022, 6, 7)),
    entry(stamp(2022, 8, 2)),
    entry("not a date"),
    entry(stamp(2030, 1, 1)),
  ];
}

const FRIENDS: Array<[string, string | undefined]> = [
  ["oldpal_one", stamp(2021, 6, 10)],
  ["newpal_two", stamp(2023, 2, 3)],
  ["nodate_three", undefined],
];

const dir = tempDir("gaps");
const timeline = timelineZip(dir, timelineMemories(), FRIENDS);

/** A parts folder shared by the tests that only read it. */
const parts = tempDir("gaps-parts");
writeSyntheticParts(parts, { memoryCount: 400 });

describe("the command", () => {
  it("is a valid descriptor with a short name that is not taken", async () => {
    await expectValidDescriptor(gapsCommand);
    expect(gapsCommand.name).toBe("gaps");
    expect(gapsCommand.group).toBe("Memories");
    expect(gapsCommand.usage).toContain("--utc-offset <hours>");
  });

  it("lists the gaps, the busiest month and the busiest stretch, and exits 0", async () => {
    const { code, out, err } = await runInsight(gapsCommand, [timeline]);
    expect(err).toBe("");
    expect(code).toBe(0);
    expect(out).toContain("Memories timeline gaps");
    expect(out).toContain("Dates use UTC. Use --utc-offset to change this.");
    expect(out).toContain("7 Memories in 8 months, from Jan 2022 to Aug 2022.");
    expect(out).toContain("4 months have Memories and 4 are empty.");
    expect(out).toMatch(/Before first Memory\s+Jul 2021\s+Dec 2021\s+6/);
    expect(out).toMatch(/Between Memories\s+Feb 2022\s+Apr 2022\s+3/);
    expect(out).toMatch(/Since last Memory\s+Sep 2022\s+Oct 2026\s+50/);
    expect(out).toContain("Early gaps count from your oldest friend date.");
    // Jul 2022 is one empty month, below the default of 2.
    expect(out).not.toMatch(/Between Memories\s+Jul 2022/);
    expect(out).toMatch(/Busiest month\s+Jun 2022\s+3\s+43%/);
    // Apr to Jun, May to Jul and Jun to Aug all hold 4: the earliest wins.
    expect(out).toMatch(/Busiest 3 months\s+Apr 2022 to Jun 2022\s+4\s+57%/);
    expect(out).toContain("These gaps may be a quiet time. Snappy cannot tell if anything is missing.");
    expect(out.endsWith("Nothing here has left this device.\n")).toBe(true);
    expectBrandSafe(out, "timeline");
  });

  it("says what it left out: undated and future Memories", async () => {
    const { out } = await runInsight(gapsCommand, [timeline]);
    expect(out).toContain("1 Memory has no usable date, so Snappy left it out.");
    expect(out).toContain("1 Memory is dated in the future, so Snappy left it out.");
  });

  it("shows fewer gaps with a longer --min-gap, and a different stretch with --stretch", async () => {
    const long = await runInsight(gapsCommand, [timeline, "--min-gap", "4"]);
    expect(long.out).not.toMatch(/Between Memories/);
    expect(long.out).toMatch(/Before first Memory/);
    expect(long.out).toMatch(/Since last Memory/);
    const none = await runInsight(gapsCommand, [timeline, "--min-gap", "100"]);
    expect(none.out).toContain("No gaps of 100 months or more.");
    expect(none.out).toContain("Snappy found no gaps of 100 months or more.");
    const one = await runInsight(gapsCommand, [timeline, "--stretch", "1"]);
    expect(one.out).toMatch(/Busiest month\s+Jun 2022\s+3\s+43%/);
    // A one-month stretch is the busiest month again, so it is not listed twice.
    expect(one.out).not.toContain("Busiest 1 month");
    const short = await runInsight(gapsCommand, [timeline, "--min-gap", "1"]);
    expect(short.out).toMatch(/Between Memories\s+Jul 2022\s+Jul 2022\s+1/);
    expectBrandSafe(long.out + none.out + one.out + short.out, "options");
  });

  it("caps the gap list with --limit and says how many were left out", async () => {
    const { out } = await runInsight(gapsCommand, [timeline, "--limit", "1"]);
    expect(out).toContain("And 2 more gaps. Use --limit to see more.");
    expect(out).toMatch(/Before first Memory/);
    expect(out).not.toMatch(/Between Memories\s+Feb/);
    const two = await runInsight(gapsCommand, [timeline, "--limit", "2"]);
    expect(two.out).toContain("And 1 more gap. Use --limit to see more.");
    const all = await runInsight(gapsCommand, [timeline, "--limit", "3"]);
    expect(all.out).not.toContain("more gap");
    // The JSON always holds every gap.
    const json = JSON.parse((await runInsight(gapsCommand, [timeline, "--limit", "1", "--json"])).out) as { gaps: unknown[] };
    expect(json.gaps).toHaveLength(3);
  });

  it("moves a Memory into the next month under a UTC offset, and says which offset it used", async () => {
    const edge = timelineZip(dir, [entry(stamp(2025, 1, 31, 23)), entry(stamp(2025, 6, 10))], [["pal_edge", stamp(2025, 1, 1)]], "edge.zip");
    const utc = JSON.parse((await runInsight(gapsCommand, [edge, "--json"])).out) as { range: { first: { month: number } }; utcOffsetMinutes: number };
    expect(utc.range.first.month).toBe(1);
    expect(utc.utcOffsetMinutes).toBe(0);
    const east = await runInsight(gapsCommand, [edge, "--utc-offset", "2", "--json"]);
    const parsed = JSON.parse(east.out) as { range: { first: { month: number } }; utcOffsetMinutes: number };
    expect(parsed.range.first.month).toBe(2);
    expect(parsed.utcOffsetMinutes).toBe(120);
    const text = await runInsight(gapsCommand, [edge, "--utc-offset=-5"]);
    expect(text.out).toContain("Dates use UTC-5:00.");
    expect(text.out).not.toContain("to change this");
    const india = JSON.parse((await runInsight(gapsCommand, [edge, "--utc-offset", "5:30", "--json"])).out) as { utcOffsetMinutes: number };
    expect(india.utcOffsetMinutes).toBe(330);
    expect(offsetLabel(0)).toBe("UTC");
    expect(offsetLabel(-210)).toBe("UTC-3:30");
    expect(offsetLabel(840)).toBe("UTC+14:00");
  });

  it("starts early gaps only from a friend date, and not at all without one", async () => {
    const none = timelineZip(dir, timelineMemories(), [["nodate_only", undefined]], "nodate.zip");
    const { out } = await runInsight(gapsCommand, [none]);
    expect(out).not.toMatch(/Before first Memory/);
    expect(out).not.toContain("Early gaps count from");
    expect(out).toMatch(/Between Memories/);
  });

  it("prints JSON with counts, months and codes only, no ids and no names", async () => {
    const { code, out } = await runInsight(gapsCommand, [timeline, "--json"]);
    expect(code).toBe(0);
    const json = JSON.parse(out) as Record<string, unknown> & {
      months: Array<Record<string, unknown>>;
      gaps: Array<Record<string, unknown>>;
      notes: Array<{ code: string; params: Record<string, number> }>;
    };
    expect(json.generatedAt).toBe(new Date(NOW).toISOString());
    expect(Object.keys(json)).toEqual([
      "generatedAt", "utcOffsetMinutes", "minGapMonths", "stretchMonths", "counts", "range", "months", "gaps", "longestGapMonths", "busiestMonth", "busiestStretch", "notes",
    ]);
    expect(json.counts).toEqual({ input: 9, unique: 9, dated: 7, undated: 1, future: 1, duplicateIds: 0 });
    expect(json.months).toHaveLength(8);
    expect(json.months[0]).toEqual({ year: 2022, month: 1, count: 2 });
    expect(json.gaps.map((g) => [g.kind, g.months, g.exportHint])).toEqual([["start", 6, false], ["middle", 3, false], ["end", 50, false]]);
    expect(json.longestGapMonths).toBe(50);
    expect(json.notes.map((n) => n.code)).toEqual(["undated-items", "future-dates-skipped", "gaps-may-be-quiet-time"]);
    expect(out).not.toMatch(/oldpal|newpal|nodate|mid=|demo\.snappy|https?:/);
  });

  it("adds the short code to each note with --verbose", async () => {
    const quiet = await runInsight(gapsCommand, [timeline]);
    expect(quiet.out).not.toContain("code:");
    const verbose = await runInsight(gapsCommand, [timeline, "--verbose"]);
    expect(verbose.out).toContain("code: undated-items");
    expect(verbose.out).toContain("code: gaps-may-be-quiet-time");
  });

  it("works on the synthetic parts", async () => {
    const { code, out } = await runInsight(gapsCommand, [parts]);
    expect(code).toBe(0);
    expect(out).toMatch(/\d+ Memories in \d+ months, from \w{3} \d{4} to \w{3} \d{4}\./);
    expect(out).toContain("Busiest month");
    expectBrandSafe(out, "parts");
  });

  it("exits 2 with a calm note when the export has no Memories list", async () => {
    const zip = writeSyntheticZip(tempDir("gaps-zero"), "a.zip", { memoryCount: 0 });
    const { code, out, err } = await runInsight(gapsCommand, [zip]);
    expect(code).toBe(2);
    expect(err).toBe("");
    expect(out).toContain("Your export has no Memories list. Run check to see what is missing.");
    expect(out).toContain("No Memories have a usable date.");
    expect(out).not.toContain("Gaps\n");
    expectBrandSafe(out, "no memories");
    const json = await runInsight(gapsCommand, [zip, "--json"]);
    expect(json.code).toBe(2);
    expect(JSON.parse(json.out)).toMatchObject({ range: null, months: [], gaps: [], notes: [{ code: "no-memories", params: {} }, { code: "no-dated-items" }] });
    const verbose = await runInsight(gapsCommand, [zip, "--verbose"]);
    expect(verbose.out).toContain("code: no-memories");
  });

  it("uses no color with --no-color or NO_COLOR, and color on a color terminal", async () => {
    const color = await runInsight(gapsCommand, [timeline], makeIo({ interactive: true, env: { COLORTERM: "truecolor" } }));
    expect(color.out).toContain("\x1b[");
    const flagged = await runInsight(gapsCommand, [timeline, "--no-color"], makeIo({ interactive: true, env: { COLORTERM: "truecolor" } }));
    expect(flagged.out).not.toContain("\x1b");
    const env = await runInsight(gapsCommand, [timeline], makeIo({ interactive: true, env: { NO_COLOR: "1" } }));
    expect(env.out).not.toContain("\x1b");
  });

  it("writes no file, reads no ledger and asks for no passphrase", async () => {
    const home = tempDir("gaps-home");
    const folder = tempDir("gaps-ro");
    writeSyntheticParts(folder, { memoryCount: 50 });
    const before = readdirSync(folder).sort();
    for (const args of [[folder], [folder, "--json"], [folder, "--min-gap", "1", "--stretch", "6"], [timeline]]) {
      const io = makeIo({ home });
      await runInsight(gapsCommand, args, io);
      expect(io.asked).toEqual([]);
    }
    expect(readdirSync(home)).toEqual([]);
    expect(readdirSync(folder).sort()).toEqual(before);
  });
});

describe("the friend date", () => {
  it("is the oldest usable date, and ignores missing, future and out-of-range ones", () => {
    const at = (y: number): number => Date.UTC(y, 5, 1);
    expect(oldestFriendDate([], NOW)).toBeUndefined();
    expect(oldestFriendDate([{}, { createdAt: Number.NaN }], NOW)).toBeUndefined();
    expect(oldestFriendDate([{ createdAt: at(2021) }, { createdAt: at(2019) }, { createdAt: at(2024) }], NOW)).toBe(at(2019));
    expect(oldestFriendDate([{ createdAt: at(1985) }, { createdAt: at(2030) }, { createdAt: at(2020) }], NOW)).toBe(at(2020));
    expect(oldestFriendDate([{ createdAt: NOW }], NOW)).toBe(NOW);
  });
});

describe("mistakes", () => {
  it("stops with calm messages for a missing path and no input", async () => {
    const missing = await runInsight(gapsCommand, [join(tempDir("gaps-errors"), "missing.zip")]);
    expect(missing).toMatchObject({ code: 1, out: "" });
    expect(missing.err).toContain("could not find");
    const none = await runInsight(gapsCommand, []);
    expect(none).toMatchObject({ code: 1, out: "" });
    expect(none.err).toContain("Give Snappy your export");
  });

  it("checks every option before it reads anything", async () => {
    const gone = join(tempDir("gaps-gone"), "missing.zip");
    const cases: Array<[string[], string]> = [
      [["--min-gap", "0"], "--min-gap must be a whole number from 1 to 120"],
      [["--min-gap", "121"], "--min-gap must be a whole number from 1 to 120"],
      [["--min-gap", "x"], "--min-gap must be a whole number"],
      [["--stretch", "25"], "--stretch must be a whole number from 1 to 24"],
      [["--stretch", "1.5"], "--stretch must be a whole number"],
      [["--limit", "0"], "--limit must be a whole number from 1 to 1000"],
      [["--utc-offset", "15"], "--utc-offset must be hours from UTC, such as 2, -5 or 5:30, from -12 to 14."],
      [["--utc-offset", "east"], "--utc-offset must be hours from UTC"],
      [["--bogus"], 'Snappy does not know the option --bogus for gaps. Run "snappy-export help gaps"'],
      [["--stretch"], "The option --stretch needs a value."],
    ];
    for (const [args, message] of cases) {
      const result = await runInsight(gapsCommand, [gone, ...args]);
      expect(result.code, args.join(" ")).toBe(1);
      expect(result.out, args.join(" ")).toBe("");
      expect(result.err, args.join(" ")).toContain(message);
      expect(result.err, args.join(" ")).not.toContain("could not find");
    }
  });

  it("says what is wrong with a file that is not an export", async () => {
    const file = join(tempDir("gaps-notzip"), "notes.txt");
    writeFileSync(file, "hello");
    const result = await runInsight(gapsCommand, [file]);
    expect(result.code).toBe(1);
    expect(result.out).toBe("");
    expect(result.err.length).toBeGreaterThan(0);
    expectBrandSafe(result.err, "wrong file");
  });
});

describe("privacy", () => {
  it("prints no canary, link, username or entry name, in text, JSON or errors", async () => {
    const zip = writeSyntheticZip(tempDir("gaps-canary"), "export.zip", { bundleMedia: true, memoryCount: 100 });
    const argLists = [
      [zip], [zip, "--json"], [zip, "--verbose"], [parts, "--min-gap", "1"], [timeline], [timeline, "--json"], [timeline, "--verbose"],
      [timeline, "--stretch", "x"], [zip, "--utc-offset", "99", "--verbose"], [join(tempDir("gaps-c2"), "gone.zip"), "--verbose"],
    ];
    for (const args of argLists) {
      const { out, err } = await runInsight(gapsCommand, args);
      const text = stripPaths(out + err);
      const label = args.map((a) => stripPaths(a)).join(" ");
      expectNoLeaks(text, label);
      expect(text, label).not.toMatch(/\b(?:ghost|oneway|dormant|active|newfriend|oldpal|newpal|nodate)_\w+\b/);
      expect(text, label).not.toMatch(/\.(?:jpg|mp4|png|html|json|zip)\b|[0-9A-F]{8}-[0-9A-F]{4}|mid=/i);
    }
  });
});

const NO_ISSUES: string[] = [];

/** A real core result for the given dates, so the page text is read at real shapes. */
function reportFor(dates: Array<number | null>, opts: Partial<insights.memoriesGaps.MemoryGapsOptions> = {}, problems: GapsReport["problems"] = []): GapsReport {
  const result = insights.memoriesGaps.findMemoryGaps(
    dates.map((date, i) => ({ id: `m${i}`, date })),
    { now: Date.UTC(2026, 10, 6, 12), issueCodes: NO_ISSUES, ...opts },
  );
  return { result, problems };
}
const at = (y: number, m: number, d = 15): number => Date.UTC(y, m - 1, d, 12);

describe("wording", () => {
  it("says one Memory, not 1 Memories, and agrees verbs", () => {
    const one = renderGaps(reportFor([at(2026, 9), null, at(2030, 1)]), term, false);
    expect(one).toContain("1 Memory in 1 month, from Sep 2026.");
    expect(one).toContain("1 month has Memories and 0 are empty.");
    expect(one).toContain("1 Memory has no usable date, so Snappy left it out.");
    expect(one).toContain("1 Memory is dated in the future, so Snappy left it out.");
    expect(one).toContain("All dated Memories fall in one month, so there is no timeline to compare.");
    expect(one).not.toContain("Busiest 1 month");
    expectBrandSafe(one, "one");
    const two = renderGaps(reportFor([at(2026, 9), at(2026, 9), null, null, at(2030, 1), at(2030, 2)]), term, false);
    expect(two).toContain("2 Memories in 1 month, from Sep 2026.");
    expect(two).toContain("2 Memories have no usable date, so Snappy left them out.");
    expect(two).toContain("2 Memories are dated in the future, so Snappy left them out.");
  });

  it("says one gap or many, and one empty month", () => {
    const text = renderGaps(reportFor([at(2020, 1), at(2020, 4), at(2026, 9)], { minGapMonths: 2 }), term, false);
    expect(text).toContain("These gaps may be a quiet time. Snappy cannot tell if anything is missing.");
    const single = renderGaps(reportFor([at(2020, 1), at(2020, 4)], { minGapMonths: 2, now: at(2020, 5, 20) }), term, false);
    expect(single).toContain("This gap may be a quiet time.");
    expect(single).toMatch(/Between Memories\s+Feb 2020\s+Mar 2020\s+2/);
    expect(single).not.toMatch(/Since last Memory/);
    expect(single).toContain("2 months have Memories and 2 are empty.");
  });

  it("reads every note correctly at a count of 0, 1, 2 and 12, and describes an unknown code", () => {
    const base = reportFor([at(2020, 1), at(2020, 4), at(2026, 9)]);
    for (const n of [0, 1, 2, 12]) {
      const codes = [
        "offset-invalid", "now-invalid", "min-gap-adjusted", "stretch-adjusted", "since-invalid", "exported-at-invalid", "exported-at-future", "undated-items",
        "future-dates-skipped", "duplicate-ids-skipped", "no-dated-items", "single-month", "no-gaps", "gaps-may-be-quiet-time", "gap-near-limited-export", "a-code-from-the-future",
      ];
      const notes = codes.map((code) => ({ code: code as insights.memoriesGaps.GapNote["code"], params: { count: n, minGapMonths: n, stretchMonths: n } }));
      const text = renderGaps({ ...base, result: { ...base.result, notes }, problems: ["export-problems", "no-memories"] }, term, false);
      expectBrandSafe(text, `count ${n}`);
      expect(text).not.toContain("a-code-from-the-future");
      expect(text).toContain("Snappy noted something it cannot describe.");
    }
    const one = renderGaps({ ...base, result: { ...base.result, notes: [{ code: "gap-near-limited-export", params: { count: 1 } }, { code: "min-gap-adjusted", params: { minGapMonths: 1 } }] } }, term, false);
    expect(one).toContain("1 gap at the start or end may come from a date range chosen for the export.");
    expect(one).toContain("The shortest gap was changed to 1 month.");
  });

  it("marks start and end gaps as maybe cut off when the export looks date-limited", () => {
    const limited = renderGaps(reportFor([at(2024, 1), at(2024, 2)], { since: at(2022, 1), issueCodes: ["possibly-date-limited"] }), term, false);
    expect(limited).toMatch(/Before first Memory\s+Feb 2022\s+Dec 2023\s+23\s+Export may be limited/);
    expect(limited).toMatch(/Since last Memory\s+Mar 2024\s+Oct 2026\s+32\s+Export may be limited/);
    expect(limited).toContain("2 gaps at the start or end may come from a date range chosen for the export.");
    const plain = renderGaps(reportFor([at(2024, 1), at(2024, 2)], { since: at(2022, 1) }), term, false);
    expect(plain).not.toContain("Export may be limited");
  });

  it("puts the key figure in color and keeps the text readable without it", () => {
    const colored = createTerm({ env: { COLORTERM: "truecolor" }, isTTY: true, columns: 100 });
    const text = renderGaps(reportFor([at(2024, 1), at(2024, 5)]), colored, false);
    expect(text).toContain("\x1b[");
    expect(text.replace(/\x1b\[[0-9;]*m/g, "")).toContain("2 Memories in 5 months, from Jan 2024 to May 2024.");
    expect(text).not.toMatch(/\x1b\[(?:38;2;(?:2[0-5]\d|1\d\d);1[0-9]{2};[0-9]{1,2}|38;5;208)m/);
  });

  it("names months in sentence case", () => {
    expect(monthText({ year: 2021, month: 3 })).toBe("Mar 2021");
    expect(monthText({ year: 1999, month: 12 })).toBe("Dec 1999");
  });

  it("keeps every sentence short and in sentence case", () => {
    const text = renderGaps(reportFor([at(2020, 1), at(2020, 6), at(2026, 9), null], { since: at(2018, 1), issueCodes: ["friend-count-mismatch"] }, ["export-problems"]), term, false);
    const prose = text
      .split("\n")
      .map((line) => line.replace(/^\s*(?:Warning|Note|Error)\s+/, "").trim())
      .filter((line) => /[.?]$/.test(line) && !/\s{2,}/.test(line));
    expect(prose.length).toBeGreaterThan(5);
    for (const s of prose.flatMap((line) => line.split(/(?<=[.?])\s+/))) expect(s.split(/\s+/).length, s).toBeLessThanOrEqual(20);
    expect(text).not.toMatch(/\b(?:ghosts?|unfriend\w*|dormant|inactive|dead|lost|simply|just)\b/i);
  });
});
