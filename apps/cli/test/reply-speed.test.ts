/** snappy-export reply-speed: how fast you and your friends reply. Synthetic data and invented names only. */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { insights } from "@snappy-export/core";
import { REPLY_SPEED_USAGE, durationText, friendsCsv, renderReplySpeed, replySpeedCommand } from "../src/commands/reply-speed.ts";
import { createTerm } from "../src/term.ts";
import { NOW, makeIo, stripPaths, tempDir, writeSyntheticParts, writeSyntheticZip } from "./helpers.ts";
import { expectBrandSafe, expectNoLeaks, expectValidDescriptor, runInsight } from "./insights-helpers.ts";

type Report = insights.replySpeed.ReplySpeedReport;
type Json = Report & { generatedAt: string; saved?: string };
const term = createTerm({ env: {}, isTTY: false, columns: 100 });
const enc = new TextEncoder();

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

interface Turns {
  /** Minutes you took to answer them, one entry per reply. */
  you?: number[];
  /** Minutes they took to answer you, one entry per reply. */
  them?: number[];
  /** Hour of the day (UTC) the first message of each turn is sent. Default 20. */
  hour?: number;
}
interface Row {
  at: number;
  sent: boolean;
  from: string;
}

/** A synthetic export: the friends list and the given one-to-one chats, plus any raw conversations. */
function writeExport(dir: string, chats: Record<string, Turns>, raw: Record<string, Row[]> = {}, friends: string[] = Object.keys(chats), name = "tiny.zip"): string {
  mkdirSync(dir, { recursive: true });
  const conversations: Record<string, unknown[]> = {};
  const toRows = (rows: Row[]): unknown[] =>
    rows.map((r) => ({ From: r.sent ? "owner_01" : r.from, "Media Type": "TEXT", "Created(microseconds)": r.at * 1000, IsSender: r.sent }));
  for (const [friend, turns] of Object.entries(chats)) {
    const rows: Row[] = [];
    let day = 0;
    // Each turn starts three days after the last, so no two turns touch.
    const start = (): number => Date.UTC(2026, 7, 1) + ++day * 3 * DAY + (turns.hour ?? 20) * HOUR;
    for (const m of turns.you ?? []) {
      const t = start();
      rows.push({ at: t, sent: false, from: friend }, { at: t + m * MINUTE, sent: true, from: friend });
    }
    for (const m of turns.them ?? []) {
      const t = start();
      rows.push({ at: t, sent: true, from: friend }, { at: t + m * MINUTE, sent: false, from: friend });
    }
    conversations[friend] = toRows(rows);
  }
  for (const [key, rows] of Object.entries(raw)) conversations[key] = toRows(rows);
  const zip = join(dir, name);
  writeFileSync(
    zip,
    zipSync({
      "json/friends.json": enc.encode(JSON.stringify({ Friends: friends.map((u) => ({ Username: u, "Creation Timestamp": "2026-01-01 00:00:00 UTC" })) })),
      "json/chat_history.json": enc.encode(JSON.stringify(conversations)),
    }),
  );
  return zip;
}

const six = (minutes: number): number[] => Array.from({ length: 6 }, () => minutes);

/** Two friends with enough replies on both sides, and a third with too few. */
const PEOPLE: Record<string, Turns> = {
  sam_01: { you: six(10), them: six(30) },
  kit_02: { you: six(40), them: six(5) },
  lee_03: { you: [2, 2] },
};
const NAMES = Object.keys(PEOPLE);

/** The lines of a section: from its heading to the blank line after it. */
function sectionOf(text: string, heading: string): string {
  const lines = text.split("\n");
  const start = lines.indexOf(heading);
  if (start < 0) return "";
  const end = lines.findIndex((l, i) => i > start && l === "");
  return lines.slice(start, end < 0 ? undefined : end).join("\n");
}

describe("the command", () => {
  it("is a valid descriptor", async () => {
    await expectValidDescriptor(replySpeedCommand);
    expect(replySpeedCommand.name).toBe("reply-speed");
    expect(replySpeedCommand.group).toBe("Chats");
    expect(replySpeedCommand.usage).toBe(REPLY_SPEED_USAGE);
  });

  it("describes every option in the usage, each on one line of 70 characters or fewer", () => {
    const rows = REPLY_SPEED_USAGE.split("\n").filter((l) => /^ {2}--/.test(l));
    expect(rows.map((r) => r.trim().split(/\s+/)[0])).toEqual(["--utc-offset", "--limit", "--out", "--force", "--json", "--verbose", "--no-color"]);
    for (const r of rows) expect(r.replace(/^ {2}--\S+(?: <[\w.-]+>)?\s+/, "").length, r).toBeLessThanOrEqual(70);
  });

  it("shows typical times, who is fastest and slowest, the hours and the friends table, and exits 0", async () => {
    const zip = writeExport(tempDir("rs-people"), PEOPLE);
    const { code, out, err } = await runInsight(replySpeedCommand, [zip]);
    expect(code).toBe(0);
    expect(err).toBe("");
    for (const heading of ["Reply speed", "Overall", "You reply fastest to", "You reply slowest to", "Friends reply fastest", "Friends reply slowest", "By hour of day", "Friends", "How this is measured", "Notes"]) {
      expect(out, heading).toContain(heading);
    }
    expect(out).toContain("You typically reply in 10 minutes. Friends typically reply in 18 minutes.");
    expect(out).toContain("Based on 14 replies of yours and 12 replies of theirs, as of Nov 6, 2026.");
    expect(out).toMatch(/You reply\s+14\s+10 minutes\s+40 minutes/);
    expect(out).toMatch(/Friends reply\s+12\s+18 minutes\s+30 minutes/);
    expect(sectionOf(out, "You reply fastest to")).toMatch(/sam_01\s+10 minutes\s+10 minutes\s+6/);
    expect(sectionOf(out, "You reply slowest to")).toMatch(/kit_02\s+40 minutes/);
    expect(sectionOf(out, "Friends reply fastest")).toMatch(/kit_02\s+5 minutes/);
    expect(sectionOf(out, "Friends reply slowest")).toMatch(/sam_01\s+30 minutes/);
    // Most replies first, then username; the friend with too few replies has no row.
    const friends = sectionOf(out, "Friends").split("\n").filter((l) => /_0\d/.test(l));
    expect(friends).toHaveLength(2);
    expect(friends[0]).toMatch(/kit_02\s+6\s+40 minutes\s+6\s+5 minutes/);
    expect(friends[1]).toMatch(/sam_01\s+6\s+10 minutes\s+6\s+30 minutes/);
    expect(out).not.toContain("lee_03");
    expect(out).toContain("Add --out reply-speed.csv to save every row.");
    expect(out).not.toContain("code:");
    expect(out.endsWith("Nothing here has left this device.\n")).toBe(true);
    expectBrandSafe(out, "people");
  });

  it("works on a built-in synthetic export, from a ZIP file and from three parts", async () => {
    const zip = writeSyntheticZip(tempDir("rs-one"), "a.zip", { bundleMedia: true });
    const dir = tempDir("rs-parts");
    writeSyntheticParts(dir);
    for (const input of [zip, dir]) {
      const { code, out } = await runInsight(replySpeedCommand, [input]);
      expect(code).toBe(0);
      expect(out).toContain("Reply speed");
      expectBrandSafe(out, "synthetic");
    }
  });

  it("prints JSON that is the report plus the time of the run", async () => {
    const zip = writeExport(tempDir("rs-json"), PEOPLE);
    const { code, out } = await runInsight(replySpeedCommand, [zip, "--json"]);
    expect(code).toBe(0);
    const json = JSON.parse(out) as Json;
    expect(json.generatedAt).toBe(new Date(NOW).toISOString());
    expect(Object.keys(json)).toEqual(["generatedAt", "asOf", "windowMs", "minReplies", "utcOffsetMinutes", "overall", "friends", "fastest", "slowest", "byHour", "summary", "notes"]);
    expect(json.byHour).toHaveLength(24);
    expect(json.friends.map((f) => f.username)).toEqual(["kit_02", "sam_01"]);
    expect(json.overall.you?.medianMs).toBe(10 * MINUTE);
    expect(json.summary).toMatchObject({ people: 3, peopleWithReplies: 3, peopleListed: 2, youReplies: 14, themReplies: 12 });
    expect(json.saved).toBeUndefined();
  });

  it("moves the hours with --utc-offset", async () => {
    const zip = writeExport(tempDir("rs-hours"), { sam_01: { you: six(10), them: six(10), hour: 20 } });
    // The first message is at 20:00 UTC, so the reply is sent at 20:10 UTC.
    const utc = await runInsight(replySpeedCommand, [zip]);
    expect(sectionOf(utc.out, "By hour of day")).toMatch(/\n {2}8 pm\s+6\s+10 minutes\s+6\s+10 minutes/);
    expect(utc.out).toContain("The hour is when the reply was sent, in UTC.");
    const east = await runInsight(replySpeedCommand, [zip, "--utc-offset", "4"]);
    expect(sectionOf(east.out, "By hour of day")).toMatch(/\n {2}12 am\s+6/);
    expect(east.out).toContain("in UTC+4:00.");
    const west = await runInsight(replySpeedCommand, [zip, "--utc-offset=-5:30"]);
    expect(sectionOf(west.out, "By hour of day")).toMatch(/\n {2}2 pm\s+6/);
    const json = JSON.parse((await runInsight(replySpeedCommand, [zip, "--utc-offset=-5:30", "--json"])).out) as Json;
    expect(json.utcOffsetMinutes).toBe(-330);
    expect(json.byHour[14]?.youReplies).toBe(6);
  });

  it("shows a dash for an hour with too few replies to time", async () => {
    const zip = writeExport(tempDir("rs-dash"), { sam_01: { you: six(10), them: [10] } });
    const { out } = await runInsight(replySpeedCommand, [zip]);
    expect(sectionOf(out, "By hour of day")).toMatch(/8 pm\s+6\s+10 minutes\s+1\s+-/);
    expect(out).toContain("A dash means fewer than 5 replies, too few to time.");
  });

  it("limits each table with --limit and says how many are left out", async () => {
    const many: Record<string, Turns> = {};
    for (let i = 0; i < 6; i++) many[`pal_0${i}`] = { you: six(5 + i), them: six(20 + i) };
    const zip = writeExport(tempDir("rs-limit"), many);
    const rows = (text: string): number => sectionOf(text, "Friends").split("\n").filter((l) => /^ {2}pal_0\d/.test(l)).length;
    const dflt = await runInsight(replySpeedCommand, [zip]);
    expect(rows(dflt.out)).toBe(6);
    expect(dflt.out).not.toContain("not shown");
    const two = await runInsight(replySpeedCommand, [zip, "--limit", "2"]);
    expect(rows(two.out)).toBe(2);
    expect(two.out).toContain("4 more friends not shown. Use --limit to show more.");
    const one = await runInsight(replySpeedCommand, [zip, "--limit=5"]);
    expect(one.out).toContain("1 more friend not shown. Use --limit to show more.");
    // JSON always holds everyone.
    expect((JSON.parse((await runInsight(replySpeedCommand, [zip, "--limit", "1", "--json"])).out) as Json).friends).toHaveLength(6);
  });

  it("ranks nobody with fewer than two friends who have enough replies, and says so", async () => {
    const zip = writeExport(tempDir("rs-one-friend"), { sam_01: { you: six(10), them: six(30) } });
    const { out } = await runInsight(replySpeedCommand, [zip]);
    expect(out).toContain("No friend has enough replies to rank yet.");
    expect(out).not.toContain("You reply fastest to");
    expect(sectionOf(out, "Friends")).toMatch(/sam_01\s+6\s+10 minutes\s+6\s+30 minutes/);
  });

  it("notes group chats, an unknown direction, the same moment, slow replies and people outside the list", async () => {
    const t = Date.UTC(2026, 8, 10, 10);
    const raw: Record<string, Row[]> = {
      // Two people write in it, so it is a group chat.
      "weekend crew": [
        { at: t, sent: false, from: "pal_a1" },
        { at: t + MINUTE, sent: false, from: "pal_b2" },
        { at: t + 2 * MINUTE, sent: true, from: "pal_a1" },
      ],
      // Same moment from both sides, then a reply after two days.
      sam_01: [
        { at: t, sent: false, from: "sam_01" },
        { at: t, sent: true, from: "sam_01" },
        { at: t + 2 * DAY, sent: false, from: "sam_01" },
      ],
      // Not on the friends list.
      stranger_9: [
        { at: t, sent: false, from: "stranger_9" },
        { at: t + MINUTE, sent: true, from: "stranger_9" },
      ],
    };
    const zip = writeExport(tempDir("rs-notes"), {}, raw, ["sam_01"]);
    const { out } = await runInsight(replySpeedCommand, [zip, "--verbose"]);
    expect(out).toContain("Note     3 group chat events were left out.");
    expect(out).toContain("Note     1 person outside your friends list was left out.");
    expect(out).toContain("Note     1 message pair shares one exact time, so Snappy cannot tell the order and left it out.");
    expect(out).toContain("Note     1 change of sender took over 24 hours. Snappy treats it as a new chat, not a reply.");
    expect(out).toContain("Warning  Snappy found no replies to time. A reply is a change of sender within 24 hours.");
    expect(out).toContain("code: no-replies-found");
    expect(out).toContain("No replies to time yet.");
    expect(out).not.toContain("Overall");
    expectBrandSafe(out, "notes");
  });

  it("says there are no replies to time for a chat with a single message", async () => {
    const zip = writeExport(tempDir("rs-none"), {}, { sam_01: [{ at: Date.UTC(2026, 8, 10, 10), sent: false, from: "sam_01" }] }, ["sam_01"]);
    const { code, out } = await runInsight(replySpeedCommand, [zip]);
    expect(code).toBe(0);
    expect(out).toContain("No replies to time yet.");
    expect(out).toContain("Warning  Snappy found no replies to time. A reply is a change of sender within 24 hours.");
    expect(out).not.toContain("Overall");
    expectBrandSafe(out, "none");
    const json = JSON.parse((await runInsight(replySpeedCommand, [zip, "--json"])).out) as Json;
    expect(json.overall).toEqual({ you: null, them: null });
    expect(json.friends).toEqual([]);
  });

  it("warns when one side has very few replies", async () => {
    const zip = writeExport(tempDir("rs-few"), { sam_01: { you: six(10), them: [30, 30] } });
    const { out } = await runInsight(replySpeedCommand, [zip]);
    expect(out).toContain("Warning  One side has only 2 replies, so the overall times may be off.");
    expect(out).toContain("You typically reply in 10 minutes. Friends typically reply in 30 minutes.");
  });

  it("says when only one side has replies", async () => {
    const zip = writeExport(tempDir("rs-oneside"), { sam_01: { you: six(10) } });
    const { out } = await runInsight(replySpeedCommand, [zip]);
    expect(out).toContain("You typically reply in 10 minutes. No replies from friends were found.");
    expect(out).toMatch(/Friends reply\s+0\s+-\s+-/);
  });
});

describe("the file", () => {
  it("writes no file unless --out is given, reads no ledger and asks for no passphrase", async () => {
    const home = tempDir("rs-home");
    const dir = tempDir("rs-ro");
    const zip = writeExport(join(dir, "export"), PEOPLE);
    const before = readdirSync(join(dir, "export")).sort();
    const io = makeIo({ home, env: { SNAPPY_PASSPHRASE: "never-used" } });
    for (const args of [[zip], [zip, "--json"], [zip, "--limit", "1"]]) await runInsight(replySpeedCommand, args, io);
    expect(io.asked).toEqual([]);
    expect(readdirSync(home)).toEqual([]);
    expect(readdirSync(join(dir, "export")).sort()).toEqual(before);
  });

  it("saves every friend row as CSV with --out, and says where", async () => {
    const dir = tempDir("rs-csv");
    const zip = writeExport(join(dir, "export"), PEOPLE);
    const file = join(dir, "speed.csv");
    const { code, out } = await runInsight(replySpeedCommand, [zip, "--out", file, "--limit", "1"]);
    expect(code).toBe(0);
    const text = readFileSync(file, "utf8");
    expect(text.startsWith("﻿")).toBe(true);
    expect(text.split("\r\n")).toEqual([
      '﻿"Username","Your replies","Your typical reply (seconds)","Your 90% within (seconds)","Their replies","Their typical reply (seconds)","Their 90% within (seconds)"',
      '"kit_02","6","2400","2400","6","300","300"',
      '"sam_01","6","600","600","6","1800","1800"',
      "",
    ]);
    // --limit trims the table on screen, not the file.
    expect(out).toContain(`Saved every row to ${file}.`);
    expect(out).toContain("The file lists your friends. Keep it somewhere private.");
    expect(out).toContain("1 more friend not shown.");
    expect(out).not.toContain("lee_03");
    const json = JSON.parse((await runInsight(replySpeedCommand, [zip, "--out", file, "--force", "--json"])).out) as Json;
    expect(json.saved).toBe(file);
  });

  it("leaves a time empty when a friend has too few replies on that side", async () => {
    const dir = tempDir("rs-csv-empty");
    const zip = writeExport(join(dir, "export"), { sam_01: { you: six(10), them: [30] } });
    const file = join(dir, "speed.csv");
    await runInsight(replySpeedCommand, [zip, "--out", file]);
    expect(readFileSync(file, "utf8").split("\r\n")[1]).toBe('"sam_01","6","600","600","1","",""');
  });

  it("does not replace a file without --force, and checks the name before reading anything", async () => {
    const dir = tempDir("rs-force");
    const zip = writeExport(join(dir, "export"), PEOPLE);
    const file = join(dir, "speed.csv");
    writeFileSync(file, "keep me");
    const refused = await runInsight(replySpeedCommand, [zip, "--out", file]);
    expect(refused).toMatchObject({ code: 1, out: "" });
    expect(refused.err).toContain("already exists, so Snappy did not replace it. Choose another name, or add --force.");
    expect(readFileSync(file, "utf8")).toBe("keep me");
    const forced = await runInsight(replySpeedCommand, [zip, "--out", file, "--force"]);
    expect(forced.code).toBe(0);
    expect(readFileSync(file, "utf8")).toContain('"kit_02"');

    const wrong = await runInsight(replySpeedCommand, [join(dir, "missing.zip"), "--out", join(dir, "speed.txt")]);
    expect(wrong.err).toContain("--out needs a file name ending in .csv, so no other file is replaced.");
    expect(wrong.err).not.toContain("could not find");
    expect(existsSync(join(dir, "speed.txt"))).toBe(false);
  });

  it("writes no file when there are no rows, and says so", async () => {
    const dir = tempDir("rs-csv-none");
    const zip = writeExport(join(dir, "export"), {}, { sam_01: [{ at: Date.UTC(2026, 8, 10, 10), sent: false, from: "sam_01" }] }, ["sam_01"]);
    const file = join(dir, "speed.csv");
    const { code, out } = await runInsight(replySpeedCommand, [zip, "--out", file]);
    expect(code).toBe(0);
    expect(existsSync(file)).toBe(false);
    expect(out).not.toContain("Saved every row");
  });

  it("says so in the Friends section when a file was asked for but the table is empty of rows to save", () => {
    const report = insights.replySpeed.findReplySpeed([], { now: NOW });
    expect(renderReplySpeed(report, term, false, { nothingToSave: true })).not.toContain("Add --out");
    const full = insights.replySpeed.findReplySpeed(
      Array.from({ length: 12 }, (_, i) => ({ conversation: "sam_01", direction: i % 2 === 0 ? "received" : "sent", at: NOW - (30 - i) * HOUR - (i % 2) * 0 })),
      { now: NOW, minReplies: 1 },
    );
    expect(renderReplySpeed(full, term, false, { nothingToSave: true })).toContain("There are no rows to save, so Snappy wrote no file.");
  });

  it("makes a spreadsheet cell safe: a username that looks like a formula gets an apostrophe, and quotes are doubled", () => {
    const base = insights.replySpeed.findReplySpeed([], { now: NOW });
    const row = { youReplies: 5, themReplies: 5, you: { medianMs: 1500, p90Ms: 2500 }, them: null };
    const csv = friendsCsv({ ...base, friends: [{ username: "=cmd|x", ...row }, { username: '-a"b', ...row }, { username: "@x\n+y", ...row }] });
    const lines = csv.split("\r\n");
    expect(lines[1]).toBe('"\'=cmd|x","5","2","3","5","",""');
    expect(lines[2]).toBe('"\'-a""b","5","2","3","5","",""');
    expect(lines[3]?.startsWith('"\'@x +y"')).toBe(true);
  });
});

describe("errors", () => {
  it("stops with exit 2 for a broken export, in text and in JSON, and saves nothing", async () => {
    const dir = tempDir("rs-broken");
    const zip = join(dir, "broken.zip");
    writeFileSync(zip, zipSync({ "html/index.html": enc.encode("<html></html>") }));
    const file = join(dir, "speed.csv");
    const home = tempDir("rs-broken-home");
    const io = makeIo({ home });
    const text = await runInsight(replySpeedCommand, [zip, "--verbose", "--out", file], io);
    expect(text.code).toBe(2);
    expect(text.out).toContain("code: html-only-export");
    expect(text.out).toContain("Snappy stopped, since reply times from a broken export may mislead.");
    expect(text.out).not.toContain("Overall");
    expect(existsSync(file)).toBe(false);
    expect(io.asked).toEqual([]);
    expect(readdirSync(home)).toEqual([]);
    const json = await runInsight(replySpeedCommand, [zip, "--json"]);
    expect(json.code).toBe(2);
    expect((JSON.parse(json.out) as { stopped: string }).stopped).toBe("export-errors");
  });

  it("stops with calm messages for a missing path, no input and bad options", async () => {
    const dir = tempDir("rs-errors");
    const missing = await runInsight(replySpeedCommand, [join(dir, "missing.zip")]);
    expect(missing).toMatchObject({ code: 1, out: "" });
    expect(missing.err).toContain("could not find");
    expect((await runInsight(replySpeedCommand, [])).err).toContain("Give Snappy your export");
    const zip = writeSyntheticZip(dir, "a.zip");
    expect((await runInsight(replySpeedCommand, [zip, "--bogus"])).err).toContain('Snappy does not know the option --bogus for reply-speed. Run "snappy-export help reply-speed"');
    for (const bad of ["x", "15", "-13", "5:75", "1.5", "", "+"]) {
      const r = await runInsight(replySpeedCommand, [zip, `--utc-offset=${bad}`]);
      expect(r, bad).toMatchObject({ code: 1, out: "" });
      expect(r.err, bad).toContain("--utc-offset must be hours from UTC");
    }
    for (const bad of ["0", "x", "1.5", "-2", "1001"]) {
      const r = await runInsight(replySpeedCommand, [zip, `--limit=${bad}`]);
      expect(r, bad).toMatchObject({ code: 1, out: "" });
      expect(r.err, bad).toContain("--limit must be a whole number from 1 to 1000.");
    }
    expect((await runInsight(replySpeedCommand, [zip, "--utc-offset", "-5"])).err).toContain("If it starts with a dash, write --utc-offset=value.");
  });

  it("checks the options before it reads anything", async () => {
    const dir = tempDir("rs-order");
    const r = await runInsight(replySpeedCommand, [join(dir, "missing.zip"), "--utc-offset=99"]);
    expect(r.err).toContain("--utc-offset must be hours from UTC");
    expect(r.err).not.toContain("could not find");
  });

  it("uses no color with --no-color or NO_COLOR, and color on a color terminal", async () => {
    const zip = writeExport(tempDir("rs-color"), PEOPLE);
    const color = await runInsight(replySpeedCommand, [zip], makeIo({ interactive: true, env: { COLORTERM: "truecolor" } }));
    expect(color.out).toContain("\x1b[");
    expect((await runInsight(replySpeedCommand, [zip, "--no-color"], makeIo({ interactive: true, env: { COLORTERM: "truecolor" } }))).out).not.toContain("\x1b");
    expect((await runInsight(replySpeedCommand, [zip], makeIo({ interactive: true, env: { NO_COLOR: "1" } }))).out).not.toContain("\x1b");
  });
});

describe("privacy", () => {
  it("names a friend only in a result table row, and prints no canary, link or entry name anywhere", async () => {
    const dir = tempDir("rs-canary");
    const zip = writeSyntheticZip(dir, "export.zip", { bundleMedia: true });
    const parts = join(dir, "parts");
    writeSyntheticParts(parts, { memoryCount: 200 });
    const tiny = writeExport(join(dir, "tiny"), PEOPLE);
    const broken = join(dir, "broken.zip");
    writeFileSync(broken, zipSync({ "html/index.html": enc.encode("<html></html>") }));
    const cases = [
      [tiny], [tiny, "--verbose"], [tiny, "--json"], [tiny, "--limit", "1", "--verbose"], [zip], [zip, "--json"], [parts], [parts, "--verbose"],
      [broken, "--verbose"], [broken, "--json"], [zip, "--utc-offset=99", "--verbose"], [zip, "--bogus", "--verbose"], [join(dir, "missing.zip"), "--verbose"], [tiny, "--out", join(dir, "missing", "x.txt")], [],
    ];
    for (const args of cases) {
      const { out, err } = await runInsight(replySpeedCommand, args);
      const text = stripPaths(out + err);
      const label = args.map((a) => stripPaths(a)).join(" ");
      expectNoLeaks(text, label);
      expect(text, label).not.toMatch(/\.(?:jpg|mp4|png|html)\b|[0-9A-F]{8}-[0-9A-F]{4}/i);
      if (args.includes("--json")) continue;
      // Every line that holds a username is a table row that starts with it.
      for (const line of text.split("\n")) {
        if (/\b(?:ghost|oneway|dormant|active|newfriend|contact|sam|kit|lee)_\d+\b/.test(line)) expect(line, label).toMatch(/^ {2}\w+_\d+ {2,}/);
      }
      const notes = text.slice(text.indexOf("Notes") < 0 ? text.length : text.indexOf("Notes"));
      expect(notes, label).not.toMatch(/\b\w+_\d+\b/);
    }
  });

  it("shows no username in the text for a run on the three-part synthetic export except in its tables", async () => {
    const parts = tempDir("rs-canary-parts");
    writeSyntheticParts(parts);
    const { out } = await runInsight(replySpeedCommand, [parts, "--verbose"]);
    const text = out.split("\n");
    const names = text.filter((l) => /\b(?:ghost|oneway|dormant|active|newfriend|contact)_\d+\b/.test(l));
    for (const l of names) expect(l).toMatch(/^ {2}\w+_\d+ {2,}/);
  });
});

describe("wording", () => {
  const turns = (n: number): Report => {
    const events = Array.from({ length: n * 2 }, (_, i) => ({ conversation: "sam_01", direction: i % 2 === 0 ? "received" : "sent", at: NOW - (n * 2 - i) * 2 * HOUR }));
    return insights.replySpeed.findReplySpeed(events, { now: NOW, minReplies: 2 });
  };

  it.each([0, 1, 2, 3, 12])("reads correctly with %i replies", (n) => {
    const text = renderReplySpeed(turns(n), term, false);
    expectBrandSafe(text, `replies ${n}`);
    expect(text.endsWith("Nothing here has left this device.\n")).toBe(true);
    if (n === 0) expect(text).toContain("No replies to time yet.");
    if (n === 1) expect(text).toContain("Based on 1 reply of yours and 0 replies of theirs");
    if (n === 2) expect(text).toContain("Based on 2 replies of yours and 1 reply of theirs");
    if (n === 12) expect(text).toContain("Based on 12 replies of yours and 11 replies of theirs");
  });

  it("describes every note in a sentence, and never shows an unknown code", () => {
    const codes = [
      "invalid-now", "no-events", "no-one-to-one-events", "no-replies-found", "events-without-time", "events-in-future", "events-without-person", "group-events-skipped",
      "events-direction-unknown", "people-not-in-friends", "turns-after-window", "turns-at-same-time", "people-below-minimum", "few-replies-overall", "offset-adjusted", "a-code-from-the-future",
    ];
    for (const n of [0, 1, 2, 12]) {
      const base = turns(12);
      const report: Report = { ...base, notes: codes.map((code) => ({ code: code as insights.replySpeed.ReplySpeedNoteCode, params: { count: n, minimum: 5, minutes: 0 } })) };
      const text = renderReplySpeed(report, term, false);
      expectBrandSafe(text, `notes ${n}`);
      expect(text).not.toContain("a-code-from-the-future");
      expect(text).not.toContain("code:");
      expect(text).toContain("Snappy noted something it cannot describe. Run it with --verbose and share the code.");
      expect(text).toContain("The time zone was moved to the nearest allowed one.");
      expect(renderReplySpeed(report, term, true)).toContain("code: a-code-from-the-future");
    }
    const one = renderReplySpeed({ ...turns(12), notes: [{ code: "events-direction-unknown", params: { count: 1 } }] }, term, false);
    expect(one).toContain("1 event does not say who wrote, so Snappy skipped it.");
    const many = renderReplySpeed({ ...turns(12), notes: [{ code: "events-direction-unknown", params: { count: 4 } }] }, term, false);
    expect(many).toContain("4 events do not say who wrote, so Snappy skipped them.");
    const people = renderReplySpeed({ ...turns(12), notes: [{ code: "people-below-minimum", params: { count: 3 } }] }, term, false);
    expect(people).toContain("3 people have replies, but fewer than 2. Snappy shows the counts only.");
  });

  it("words a reply time in seconds, minutes, hours and days", () => {
    expect(durationText(0)).toBe("Under 1 second");
    expect(durationText(999)).toBe("Under 1 second");
    expect(durationText(1000)).toBe("1 second");
    expect(durationText(30_000)).toBe("30 seconds");
    expect(durationText(MINUTE)).toBe("1 minute");
    expect(durationText(59_700)).toBe("1 minute");
    expect(durationText(12 * MINUTE)).toBe("12 minutes");
    expect(durationText(119 * MINUTE)).toBe("119 minutes");
    expect(durationText(2 * HOUR)).toBe("2 hours");
    expect(durationText(47 * HOUR)).toBe("47 hours");
    expect(durationText(2 * DAY)).toBe("2 days");
  });

  it("keeps every sentence short and in sentence case", () => {
    const text = renderReplySpeed(turns(12), term, false, { limit: 3 });
    const prose = text
      .split("\n")
      .map((line) => line.replace(/^\s*(?:Warning|Note|Info|Error)\s+/, "").trim())
      .filter((line) => /[.?]$/.test(line) && !/\s{2,}/.test(line));
    expect(prose.length).toBeGreaterThan(3);
    for (const s of prose.flatMap((line) => line.split(/(?<=[.?])\s+/))) expect(s.split(/\s+/).length, s).toBeLessThanOrEqual(20);
    expect(text).not.toMatch(/\b(?:ghosts?|unfriend\w*|dormant|inactive|dead|simply|just|slow friends?|ignor\w*)\b/i);
  });
});
