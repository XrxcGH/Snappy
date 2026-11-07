/** snappy-export year: a summary of one calendar year. Synthetic data only. */
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { insights } from "@snappy-export/core";
import { YEAR_USAGE, renderYear, yearCommand } from "../src/commands/year.ts";
import { createTerm } from "../src/term.ts";
import { NOW, makeIo, stripPaths, tempDir, writeSyntheticParts, writeSyntheticZip } from "./helpers.ts";
import { expectBrandSafe, expectNoLeaks, expectValidDescriptor, runInsight } from "./insights-helpers.ts";

type Review = insights.yearInReview.YearInReviewResult;
type Json = Review & { generatedAt: string };
const term = createTerm({ env: {}, isTTY: false, columns: 100 });
const enc = new TextEncoder();
const stamp = (ms: number): string => new Date(ms).toISOString().slice(0, 19).replace("T", " ") + " UTC";

const MINUTE = 60_000;
const DAY = 86_400_000;

interface Entry {
  at: number;
  sent?: boolean;
  kind?: string;
}

interface TinyOptions {
  chats?: Entry[];
  /** Friendship dates of current friends. */
  friends?: (number | null)[];
  /** Removal dates. */
  removed?: (number | null)[];
  /** Capture dates and types of Memories. */
  memories?: { at: number | null; type: "Image" | "Video" }[];
  name?: string;
}

/** A tiny synthetic export with invented names, holding exactly these dates. */
function writeTinyExport(dir: string, o: TinyOptions): string {
  mkdirSync(dir, { recursive: true });
  const rows = (o.chats ?? []).map((e) => ({
    From: "sam_01",
    "Media Type": e.kind ?? "TEXT",
    "Created(microseconds)": e.at * 1000,
    ...(e.sent === undefined ? {} : { IsSender: e.sent }),
  }));
  const zip = join(dir, o.name ?? "tiny.zip");
  writeFileSync(
    zip,
    zipSync({
      "json/friends.json": enc.encode(
        JSON.stringify({
          Friends: (o.friends ?? []).map((at, i) => ({ Username: `pal_${i}`, ...(at === null ? {} : { "Creation Timestamp": stamp(at) }) })),
          "Deleted Friends": (o.removed ?? []).map((at, i) => ({ Username: `gone_${i}`, ...(at === null ? {} : { Date: stamp(at) }) })),
        }),
      ),
      "json/chat_history.json": enc.encode(JSON.stringify(rows.length === 0 ? {} : { sam_01: rows })),
      "json/memories_history.json": enc.encode(
        JSON.stringify({ "Saved Media": (o.memories ?? []).map((m) => ({ Date: m.at === null ? "" : stamp(m.at), "Media Type": m.type, "Download Link": "", "Media Download URL": "" })) }),
      ),
    }),
  );
  return zip;
}

const MAR_1 = Date.UTC(2025, 2, 1, 12);
const MAR_14 = Date.UTC(2025, 2, 14, 12);
const MAR_25 = Date.UTC(2025, 2, 25, 12);
const FEB_2_2026 = Date.UTC(2026, 1, 2, 12);

/** 10 Snaps on Mar 1, 20 chats on Mar 14 (10 sent), 10 received chats on Mar 25 (all 2025), and 5 chats in Feb 2026. */
function crafted(): TinyOptions {
  const run = (n: number, at: number, make: (i: number) => Omit<Entry, "at">): Entry[] => Array.from({ length: n }, (_, i) => ({ at: at + i * MINUTE, ...make(i) }));
  return {
    chats: [
      ...run(10, MAR_1, () => ({ sent: true, kind: "IMAGE" })),
      ...run(20, MAR_14, (i) => ({ sent: i % 2 === 0 })),
      ...run(10, MAR_25, () => ({ sent: false })),
      ...run(5, FEB_2_2026, () => ({ sent: true })),
    ],
    friends: [Date.UTC(2025, 0, 5), Date.UTC(2024, 5, 1)],
    removed: [Date.UTC(2025, 5, 1)],
    memories: [
      { at: Date.UTC(2025, 1, 10), type: "Image" },
      { at: Date.UTC(2025, 1, 11), type: "Video" },
      { at: Date.UTC(2024, 11, 31), type: "Image" },
    ],
  };
}

describe("the command", () => {
  it("is a valid descriptor", async () => {
    await expectValidDescriptor(yearCommand);
    expect(yearCommand.name).toBe("year");
    expect(yearCommand.group).toBe("Your export");
    expect(yearCommand.usage).toBe(YEAR_USAGE);
  });

  it("describes every option in the usage, each on one line of 70 characters or fewer", () => {
    const rows = YEAR_USAGE.split("\n").filter((l) => /^ {2}--/.test(l));
    expect(rows.map((r) => r.trim().split(/\s+/)[0])).toEqual(["--year", "--utc-offset", "--json", "--verbose", "--no-color"]);
    for (const r of rows) expect(r.replace(/^ {2}--\S+(?: <\w+>)?\s+/, "").length, r).toBeLessThanOrEqual(70);
  });

  it("sums up the latest year of a three-part export, and exits 0", async () => {
    const dir = tempDir("year-parts");
    writeSyntheticParts(dir);
    const { code, out, err } = await runInsight(yearCommand, [dir]);
    const json = JSON.parse((await runInsight(yearCommand, [dir, "--json"])).out) as Json;
    expect(code).toBe(0);
    expect(err).toBe("");
    for (const heading of ["Year in review", "Overview", "Busiest times", "Sent and received", "By month", "Notes"]) expect(out).toContain(heading);
    expect(json.activity).not.toBeNull();
    expect(out).toContain(`${(json.activity?.total.total ?? 0).toLocaleString("en-US")} chats and Snaps, on ${json.activity?.activeDays} days of ${json.year}.`);
    expect(out).not.toContain("code:");
    expect(out.endsWith("Nothing here has left this device.\n")).toBe(true);
    expectBrandSafe(out, "year");
  });

  it("reads one ZIP file too", async () => {
    const zip = writeSyntheticZip(tempDir("year-one"), "a.zip", { bundleMedia: true });
    const { code, out } = await runInsight(yearCommand, [zip]);
    expect(code).toBe(0);
    expect(out).toContain("Busiest times");
    expectBrandSafe(out, "one zip");
  });

  it("prints JSON with numbers and codes only", async () => {
    const dir = tempDir("year-json");
    writeSyntheticParts(dir);
    const { code, out } = await runInsight(yearCommand, [dir, "--json"]);
    expect(code).toBe(0);
    const json = JSON.parse(out) as Json;
    expect(json.generatedAt).toBe(new Date(NOW).toISOString());
    expect(Object.keys(json)).toEqual(["generatedAt", "year", "yearSource", "utcOffsetMinutes", "inProgress", "activity", "friends", "memories", "skipped", "notes"]);
    expect(json.yearSource).toBe("latest");
    expect(json.activity?.byMonth).toHaveLength(12);
    expect(json.activity?.total.total).toBe((json.activity?.snaps.total ?? 0) + (json.activity?.chats.total ?? 0));
    expect(json.utcOffsetMinutes).toBe(0);
  });

  it("shows the numbers of a year picked with --year", async () => {
    const zip = writeTinyExport(tempDir("year-pick"), crafted());
    const { code, out } = await runInsight(yearCommand, [zip, "--year", "2025"]);
    expect(code).toBe(0);
    expect(out).toContain("Year in review 2025");
    expect(out).toContain("40 chats and Snaps, on 3 days of 2025.");
    expect(out).toMatch(/Year\s+2025\n/);
    expect(out).toMatch(/Chats and Snaps\s+40\n/);
    expect(out).toMatch(/Active days\s+3\n/);
    expect(out).toMatch(/First\s+Mar 1, 2025\n/);
    expect(out).toMatch(/Last\s+Mar 25, 2025\n/);
    expect(out).toMatch(/Longest quiet stretch\s+12 days, Mar 2, 2025 to Mar 13, 2025\n/);
    expect(out).toMatch(/New friends\s+1\n/);
    expect(out).toMatch(/Friends removed\s+1\n/);
    expect(out).toMatch(/Memories\s+2\n/);
    expect(out).toMatch(/Month\s+March\s+40\s+100%/);
    expect(out).toMatch(/Day\s+Mar 14, 2025\s+20\s+50%/);
    expect(out).toMatch(/Snaps\s+10\s+10\s+0\s+0/);
    expect(out).toMatch(/Saved chats\s+30\s+10\s+20\s+0/);
    expect(out).toMatch(/Both\s+40\s+20\s+20\s+0/);
    expect(out).toMatch(/^ {2}Mar\s+40\s+/m);
    expect(out).toMatch(/^ {2}Feb\s+0\s+.*\s+2\s+/m);
    expect(out).not.toMatch(/not over yet/);
    expectBrandSafe(out, "year 2025");
    const json = JSON.parse((await runInsight(yearCommand, [zip, "--year=2025", "--json"])).out) as Json;
    expect(json.yearSource).toBe("given");
    expect(json.friends).toEqual({ added: 1, removed: 1 });
    expect(json.memories).toMatchObject({ total: 2, image: 1, video: 1 });
  });

  it("uses the latest year by default, and says a year that is not over may still change", async () => {
    const zip = writeTinyExport(tempDir("year-latest"), crafted());
    const { out } = await runInsight(yearCommand, [zip]);
    expect(out).toContain("Year in review 2026");
    expect(out).toMatch(/Year\s+2026, so far\n/);
    expect(out).toContain("2026 is not over yet, so these numbers may still grow.");
    expect(out).toContain("Only 5 chats and Snaps were counted, so this year may look thin.");
    expect(out).toContain("5 chats and Snaps, on 1 day of 2026.");
  });

  it("moves the days with --utc-offset", async () => {
    const zip = writeTinyExport(tempDir("year-zone"), crafted());
    const utc = await runInsight(yearCommand, [zip, "--year", "2025"]);
    expect(utc.out).toMatch(/Time zone\s+UTC\n/);
    expect(utc.out).toMatch(/Day\s+Mar 14, 2025\s+20/);
    const east = await runInsight(yearCommand, [zip, "--year", "2025", "--utc-offset", "14"]);
    expect(east.out).toMatch(/Time zone\s+UTC\+14:00\n/);
    expect(east.out).toMatch(/Day\s+Mar 15, 2025\s+20/);
    const west = await runInsight(yearCommand, [zip, "--year=2025", "--utc-offset=-5:30"]);
    expect(west.out).toMatch(/Time zone\s+UTC-5:30\n/);
    const json = JSON.parse((await runInsight(yearCommand, [zip, "--year=2025", "--utc-offset=-5:30", "--json"])).out) as Json;
    expect(json.utcOffsetMinutes).toBe(-330);
    expect(json.notes.map((n) => n.code)).not.toContain("offset-adjusted");
  });

  it("says nothing was found in a year without activity, and leaves the missing parts out", async () => {
    const zip = writeTinyExport(tempDir("year-empty-year"), crafted());
    const { code, out } = await runInsight(yearCommand, [zip, "--year", "2023"]);
    expect(code).toBe(0);
    expect(out).toContain("Year in review 2023");
    expect(out).toContain("No chats or Snaps to count in 2023.");
    expect(out).toContain("No chats or Snaps are dated in 2023.");
    expect(out).not.toContain("Busiest times");
    expect(out).not.toContain("Sent and received");
    expect(out).toMatch(/Memories\s+0\n/);
    expect(out).not.toContain("By month");
    expect(out).not.toContain("Only saved chats");
    expectBrandSafe(out, "empty year");
  });

  it("says there is nothing to count for an export without dates", async () => {
    const zip = writeTinyExport(tempDir("year-none"), { friends: [null], memories: [{ at: null, type: "Image" }] });
    const { code, out } = await runInsight(yearCommand, [zip]);
    expect(code).toBe(0);
    expect(out).toContain("There is nothing to count yet.");
    expect(out).toContain("2 items have no usable date. Snappy leaves them out.");
    expect(out).toContain("Nothing has a usable date, so there is no year to show.");
    expect(out).not.toContain("Overview");
    expectBrandSafe(out, "none");
    const json = JSON.parse((await runInsight(yearCommand, [zip, "--json"])).out) as Json;
    expect(json.year).toBeNull();
    expect(json.activity).toBeNull();
  });

  it("leaves out dates in the future, and says so", async () => {
    const zip = writeTinyExport(tempDir("year-future"), { chats: [...crafted().chats!, { at: NOW + 3 * DAY, sent: true }], friends: [NOW + DAY] });
    const { out } = await runInsight(yearCommand, [zip, "--year", "2025", "--verbose"]);
    expect(out).toContain("2 items are dated in the future. Snappy leaves them out.");
    expect(out).toContain("code: future-skipped");
  });

  it("stops with exit 2 for a broken export, in text and in JSON, and touches no ledger", async () => {
    const dir = tempDir("year-broken");
    const zip = join(dir, "broken.zip");
    writeFileSync(zip, zipSync({ "html/index.html": enc.encode("<html></html>") }));
    const home = tempDir("year-broken-home");
    const io = makeIo({ home });
    const text = await runInsight(yearCommand, [zip, "--verbose"], io);
    expect(text.code).toBe(2);
    expect(text.out).toContain("code: html-only-export");
    expect(text.out).toContain("Snappy stopped, since a year from a broken export may mislead.");
    expect(text.out).not.toContain("Overview");
    expect(io.asked).toEqual([]);
    expect(readdirSync(home)).toEqual([]);
    const json = await runInsight(yearCommand, [zip, "--json"]);
    expect(json.code).toBe(2);
    expect((JSON.parse(json.out) as { stopped: string }).stopped).toBe("export-errors");
    expectBrandSafe(text.out, "broken");
  });

  it("uses no color with --no-color or NO_COLOR, and color on a color terminal", async () => {
    const zip = writeSyntheticZip(tempDir("year-color"), "a.zip");
    const color = await runInsight(yearCommand, [zip], makeIo({ interactive: true, env: { COLORTERM: "truecolor" } }));
    expect(color.out).toContain("\x1b[");
    expect((await runInsight(yearCommand, [zip, "--no-color"], makeIo({ interactive: true, env: { COLORTERM: "truecolor" } }))).out).not.toContain("\x1b");
    expect((await runInsight(yearCommand, [zip], makeIo({ interactive: true, env: { NO_COLOR: "1" } }))).out).not.toContain("\x1b");
  });

  it("writes no file, reads no ledger and asks for no passphrase", async () => {
    const home = tempDir("year-home");
    const dir = tempDir("year-ro");
    writeSyntheticParts(dir);
    const before = readdirSync(dir).sort();
    const io = makeIo({ home, env: { SNAPPY_PASSPHRASE: "never-used" } });
    for (const args of [[dir], [dir, "--json"], [dir, "--year", "2025"]]) await runInsight(yearCommand, args, io);
    expect(io.asked).toEqual([]);
    expect(readdirSync(home)).toEqual([]);
    expect(readdirSync(dir).sort()).toEqual(before);
  });

  it("stops with calm messages for a missing path, no input and bad options", async () => {
    const dir = tempDir("year-errors");
    const missing = await runInsight(yearCommand, [join(dir, "missing.zip")]);
    expect(missing).toMatchObject({ code: 1, out: "" });
    expect(missing.err).toContain("could not find");
    expect((await runInsight(yearCommand, [])).err).toContain("Give Snappy your export");
    const zip = writeSyntheticZip(dir, "a.zip");
    expect((await runInsight(yearCommand, [zip, "--bogus"])).err).toContain('Snappy does not know the option --bogus for year. Run "snappy-export help year"');
    for (const bad of ["x", "1968", "2201", "2025.5", "-2025", "", "20 25"]) {
      const r = await runInsight(yearCommand, [zip, `--year=${bad}`]);
      expect(r, bad).toMatchObject({ code: 1, out: "" });
      expect(r.err, bad).toContain("--year must be a whole number from 1969 to 2200.");
    }
    for (const bad of ["x", "15", "-13", "5:75", "1.5", ""]) {
      const r = await runInsight(yearCommand, [zip, `--utc-offset=${bad}`]);
      expect(r, bad).toMatchObject({ code: 1, out: "" });
      expect(r.err, bad).toContain("--utc-offset must be hours from UTC");
    }
  });

  it("checks the options before it reads anything", async () => {
    const dir = tempDir("year-order");
    const r = await runInsight(yearCommand, [join(dir, "missing.zip"), "--year=3000"]);
    expect(r.err).toContain("--year must be a whole number");
    expect(r.err).not.toContain("could not find");
  });
});

describe("privacy", () => {
  it("prints no canary, link, entry name or username, in text, JSON, verbose or error output", async () => {
    const dir = tempDir("year-canary");
    const zip = writeSyntheticZip(dir, "export.zip", { bundleMedia: true });
    const parts = join(dir, "parts");
    writeSyntheticParts(parts, { memoryCount: 200 });
    const tiny = writeTinyExport(join(dir, "tiny"), crafted());
    const broken = join(dir, "broken.zip");
    writeFileSync(broken, zipSync({ "html/index.html": enc.encode("<html></html>") }));
    const cases = [[zip], [zip, "--json"], [parts], [parts, "--json"], [parts, "--verbose"], [tiny, "--verbose"], [tiny, "--year=2025", "--verbose"], [broken, "--verbose"], [broken, "--json"], [zip, "--year=1", "--verbose"], [zip, "--bogus", "--verbose"], [join(dir, "missing.zip"), "--verbose"], []];
    for (const args of cases) {
      const { out, err } = await runInsight(yearCommand, args);
      const text = stripPaths(out + err);
      const label = args.map((a) => stripPaths(a)).join(" ");
      expectNoLeaks(text, label);
      expect(text, label).not.toMatch(/\b(?:ghost|oneway|dormant|active|newfriend|contact|sam|pal|gone)_\d+\b/);
      expect(text, label).not.toMatch(/\.(?:jpg|mp4|png|html|json)\b|[0-9A-F]{8}-[0-9A-F]{4}/i);
    }
  });
});

/** A result from hand-made dates, for the wording checks. */
function review(n: number, extra: Partial<Parameters<typeof insights.yearInReview.computeYearInReview>[0]> = {}): Review {
  const chats = Array.from({ length: n }, (_, i) => ({ direction: i % 5 === 4 ? "unknown" : i % 2 === 0 ? "sent" : "received", kind: i % 3 === 0 ? "IMAGE" : "TEXT", at: Date.UTC(2025, i % 12, 5 + (i % 20), 10) }));
  return insights.yearInReview.computeYearInReview({ chats, ...extra }, { now: NOW, year: 2025 });
}

describe("wording", () => {
  it.each([0, 1, 2, 12, 40])("reads correctly with %i events", (n) => {
    const text = renderYear(review(n, { friends: [{ createdAt: Date.UTC(2025, 3, 1) }], memories: [{ date: Date.UTC(2025, 3, 1), mediaType: "image" }] }), term, false);
    expectBrandSafe(text, `count ${n}`);
    expect(text.endsWith("Nothing here has left this device.\n")).toBe(true);
    if (n === 0) expect(text).toContain("No chats or Snaps to count in 2025.");
    if (n === 1) {
      expect(text).toContain("1 chat or Snap, on 1 day of 2025.");
      expect(text).toContain("Only 1 chat or Snap was counted, so this year may look thin.");
    }
    if (n === 2) expect(text).toContain("Only 2 chats and Snaps were counted, so this year may look thin.");
  });

  it("describes every note in a sentence, and never shows an unknown code", () => {
    const codes = [
      "no-data", "year-invalid", "no-activity-data", "no-friend-dates", "no-removal-dates", "no-memories", "no-activity-in-year", "few-events", "many-unknown-direction", "year-in-progress",
      "undated-skipped", "future-skipped", "offset-adjusted", "a-code-from-the-future",
    ];
    for (const n of [0, 1, 2, 12]) {
      const result: Review = { ...review(12), notes: codes.map((code) => ({ code: code as insights.yearInReview.YearNoteCode, params: { count: n, percent: 60, minutes: 0, year: 2025 } })) };
      const text = renderYear(result, term, false);
      expectBrandSafe(text, `notes ${n}`);
      expect(text).not.toContain("a-code-from-the-future");
      expect(text).not.toContain("code:");
      expect(text).toContain("Snappy noted something it cannot describe. Run it with --verbose and share the code.");
      expect(text).toContain("About 60% have no known direction, so sent and received may be off.");
      expect(text).toContain("2025 is not over yet, so these numbers may still grow.");
      expect(text).toContain("The time zone was moved to the nearest allowed one.");
      expect(renderYear(result, term, true)).toContain("code: a-code-from-the-future");
    }
    const one = renderYear({ ...review(12), notes: [{ code: "undated-skipped", params: { count: 1 } }] }, term, false);
    expect(one).toContain("1 item has no usable date. Snappy leaves it out.");
    const many = renderYear({ ...review(12), notes: [{ code: "undated-skipped", params: { count: 3 } }] }, term, false);
    expect(many).toContain("3 items have no usable date. Snappy leaves them out.");
  });

  it("marks a tied busiest month and day", () => {
    const text = renderYear(review(2, { friends: [] }), term, false);
    expect(text).toMatch(/Month\s+\w+ \(tied\)\s+1\s+50%/);
    expect(text).toMatch(/Day\s+\w+ \d+, 2025 \(tied\)\s+1\s+50%/);
  });

  it("keeps every sentence short and in sentence case", () => {
    const text = renderYear(review(40, { friends: [{ createdAt: Date.UTC(2025, 3, 1) }], memories: [{ date: Date.UTC(2025, 3, 1), mediaType: "video" }] }), term, false);
    const prose = text
      .split("\n")
      .map((line) => line.replace(/^\s*(?:Warning|Note|Error)\s+/, "").trim())
      .filter((line) => /[.?]$/.test(line) && !/\s{2,}/.test(line));
    expect(prose.length).toBeGreaterThan(2);
    for (const s of prose.flatMap((line) => line.split(/(?<=[.?])\s+/))) expect(s.split(/\s+/).length, s).toBeLessThanOrEqual(20);
    expect(text).not.toMatch(/\b(?:ghosts?|unfriend\w*|dormant|inactive|dead|simply|just)\b/i);
  });
});
