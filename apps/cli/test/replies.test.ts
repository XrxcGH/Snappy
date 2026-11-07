/** snappy-export replies: who may be waiting on a reply. Synthetic data only. */
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { insights, syntheticExportZip } from "@snappy-export/core";
import { renderReplies, repliesCommand } from "../src/commands/replies.ts";
import { createTerm } from "../src/term.ts";
import { LATER, NOW, makeIo, stripPaths, tempDir, writeSyntheticParts, writeSyntheticZip } from "./helpers.ts";
import { expectBrandSafe, expectNoLeaks, expectValidDescriptor, runInsight } from "./insights-helpers.ts";

type Report = insights.waitingOnReply.WaitingReport;
const term = createTerm({ env: {}, isTTY: false, columns: 100 });
const USERNAME = /\b(?:ghost|oneway|dormant|active|newfriend|friend)_\d+\b/;

describe("the command", () => {
  it("is a valid descriptor", async () => {
    await expectValidDescriptor(repliesCommand);
    expect(repliesCommand.name).toBe("replies");
    expect(repliesCommand.group).toBe("Chats");
  });

  it("lists who may be waiting on a reply for a three-part export, and exits 0", async () => {
    const dir = tempDir("replies-parts");
    writeSyntheticParts(dir);
    const { code, out, err } = await runInsight(repliesCommand, [dir]);
    expect(code).toBe(0);
    expect(err).toBe("");
    expect(out).toContain("Replies");
    expect(out).toContain("1 person may be waiting on a reply from you.");
    expect(out).toContain("You may not be waiting on anyone. No chats look one-sided.");
    expect(out).toContain("Checked 28 one-to-one chats, using saved chats and Snaps.");
    expect(out).toContain("These are hints.");
    expect(out).toMatch(/active_17\s+Oct 28, 2026\s+4 days/);
    expect(out).toContain("One-sided chats");
    expect(out).toContain("None found.");
    expect(out).toContain("451 group chat events were left out.");
    expect(out).not.toContain("code:");
    expect(out.endsWith("Nothing here has left this device.\n")).toBe(true);
    expectBrandSafe(out, "replies");
  });

  it("reads a single ZIP file and lists several people", async () => {
    const zip = writeSyntheticZip(tempDir("replies-one"), "a.zip");
    const { code, out } = await runInsight(repliesCommand, [zip]);
    expect(code).toBe(0);
    expect(out).toContain("5 people may be waiting on a reply from you.");
    for (const name of ["newfriend_1", "active_15", "active_17", "active_25", "active_4"]) expect(out).toContain(name);
    expectBrandSafe(out, "single zip");
  });

  it("lists people you may be waiting on when the wait is shortened, and caps each list with --limit", async () => {
    const zip = writeSyntheticZip(tempDir("replies-days"), "a.zip");
    const { code, out } = await runInsight(repliesCommand, [zip, "--you-days", "0", "--them-days", "0", "--limit", "2"]);
    expect(code).toBe(0);
    expect(out).toContain("They wrote last, and Snappy saw no reply for 0 days or more.");
    expect(out).toContain("You wrote last, and Snappy saw no reply for 0 days or more.");
    expect(out).toMatch(/active_13\s+Oct 27, 2026\s+5 days/);
    expect(out).toContain("15 more not shown. Use --limit to show more.");
    expect(out).toContain("13 more not shown. Use --limit to show more.");
    expect(out.match(/_\d+ +[A-Z][a-z]{2} \d+, 2026/g)).toHaveLength(4);
    const quiet = await runInsight(repliesCommand, [zip, "--you-days", "30"]);
    expect(quiet.out).toContain("No one looks to be waiting on a reply from you.");
    expect(quiet.out).toContain("saw no reply for 30 days or more.");
  });

  it("prints JSON with the lists, counts and note codes only", async () => {
    const dir = tempDir("replies-json");
    writeSyntheticParts(dir);
    const { code, out } = await runInsight(repliesCommand, [dir, "--json"]);
    expect(code).toBe(0);
    const json = JSON.parse(out) as Report & { generatedAt: string };
    expect(json.generatedAt).toBe(new Date(NOW).toISOString());
    expect(Object.keys(json)).toEqual(["generatedAt", "asOf", "waitingOnYou", "waitingOnThem", "oneSided", "summary", "notes"]);
    expect(json.asOf).toBe(LATER);
    expect(json.waitingOnYou.map((p) => p.username)).toEqual(["active_17"]);
    expect(json.summary).toEqual({ people: 28, waitingOnYou: 1, waitingOnThem: 0, oneSided: 0 });
    // Notes hold codes and whole numbers, never a person.
    expect(JSON.stringify(json.notes)).not.toMatch(USERNAME);
    expect(json.notes.every((n) => /^[a-z-]+$/.test(n.code) && Object.values(n.params).every(Number.isInteger))).toBe(true);
  });

  it("adds the short code to each note only with --verbose", async () => {
    const dir = tempDir("replies-verbose");
    writeSyntheticParts(dir);
    const verbose = await runInsight(repliesCommand, [dir, "--verbose"]);
    expect(verbose.out).toContain("code: group-events-skipped");
    expect(verbose.out).toContain("code: people-not-in-friends");
  });

  it("stops on a damaged ZIP file with the problems and exit code 2", async () => {
    const dir = tempDir("replies-damaged");
    const full = syntheticExportZip({ now: LATER, friendCount: 40, memoryCount: 20 });
    const damaged = join(dir, "damaged.zip");
    writeFileSync(damaged, full.subarray(0, Math.floor(full.length * 0.6)));
    const { code, out, err } = await runInsight(repliesCommand, [damaged]);
    expect(code).toBe(2);
    expect(err).toBe("");
    expect(out).toContain("Problems found");
    expect(out).toContain("Error");
    expect(out).toContain("Snappy did not read your chats from a broken export.");
    expect(out).not.toContain("Waiting on you");
    expect(out.endsWith("Nothing here has left this device.\n")).toBe(true);
    expectBrandSafe(out, "damaged");
    const json = await runInsight(repliesCommand, [damaged, "--json"]);
    expect(json.code).toBe(2);
    expect(JSON.parse(json.out)).toMatchObject({ stopped: "export-errors" });
  });

  it("uses no color with --no-color or NO_COLOR, and color on a color terminal", async () => {
    const dir = tempDir("replies-color");
    writeSyntheticParts(dir);
    const color = await runInsight(repliesCommand, [dir], makeIo({ interactive: true, env: { COLORTERM: "truecolor" } }));
    expect(color.out).toContain("\x1b[");
    const flagged = await runInsight(repliesCommand, [dir, "--no-color"], makeIo({ interactive: true, env: { COLORTERM: "truecolor" } }));
    expect(flagged.out).not.toContain("\x1b");
    const env = await runInsight(repliesCommand, [dir], makeIo({ interactive: true, env: { NO_COLOR: "1" } }));
    expect(env.out).not.toContain("\x1b");
  });

  it("writes no file, reads no ledger and asks for no passphrase", async () => {
    const home = tempDir("replies-home");
    const dir = tempDir("replies-ro");
    writeSyntheticParts(dir);
    const before = readdirSync(dir).sort();
    for (const args of [[dir], [dir, "--json"]]) {
      const io = makeIo({ home });
      await runInsight(repliesCommand, args, io);
      expect(io.asked).toEqual([]);
    }
    expect(readdirSync(home)).toEqual([]);
    expect(readdirSync(dir).sort()).toEqual(before);
  });

  it("stops with calm messages for a missing path, no input, a wrong file and bad options", async () => {
    const dir = tempDir("replies-errors");
    const missing = await runInsight(repliesCommand, [join(dir, "missing.zip")]);
    expect(missing).toMatchObject({ code: 1, out: "" });
    expect(missing.err).toContain("could not find");
    expect((await runInsight(repliesCommand, [])).err).toContain("Give Snappy your export");
    const notZip = join(dir, "notes.txt");
    writeFileSync(notZip, "not a zip file");
    const wrong = await runInsight(repliesCommand, [notZip]);
    expect(wrong.code).toBe(1);
    expect(wrong.out).toBe("");
    expect(wrong.err).not.toBe("");

    const zip = writeSyntheticZip(dir, "a.zip");
    expect((await runInsight(repliesCommand, [zip, "--limit", "x"])).err).toContain("--limit must be a whole number from 1 to 1000.");
    expect((await runInsight(repliesCommand, [zip, "--limit", "0"])).err).toContain("--limit must be a whole number");
    expect((await runInsight(repliesCommand, [zip, "--you-days=-1"])).err).toContain("--you-days must be a whole number from 0 to 90.");
    expect((await runInsight(repliesCommand, [zip, "--them-days", "91"])).err).toContain("--them-days must be a whole number from 0 to 90.");
    expect((await runInsight(repliesCommand, [zip, "--limit"])).err).toContain("needs a value");
    expect((await runInsight(repliesCommand, [zip, "--bogus"])).err).toContain('Snappy does not know the option --bogus for replies. Run "snappy-export help replies"');
    for (const args of [[zip, "--limit", "x"], [zip, "--bogus"], []]) {
      const { out } = await runInsight(repliesCommand, args);
      expect(out).toBe("");
    }
  });

  it("checks the options before it reads anything", async () => {
    const dir = tempDir("replies-order");
    const { code, err } = await runInsight(repliesCommand, [join(dir, "missing.zip"), "--limit", "x"]);
    expect(code).toBe(1);
    expect(err).toContain("--limit must be a whole number");
    expect(err).not.toContain("could not find");
  });
});

describe("privacy", () => {
  it("prints no canary, link or entry name, and no username outside the result tables", async () => {
    const dir = tempDir("replies-canary");
    const zip = writeSyntheticZip(dir, "export.zip", { bundleMedia: true });
    const parts = join(dir, "parts");
    writeSyntheticParts(parts, { memoryCount: 200 });
    const argSets = [[zip], [zip, "--json"], [parts], [parts, "--json", "--verbose"], [zip, "--you-days", "0", "--them-days", "0", "--verbose"]];
    for (const args of argSets) {
      const { out, err } = await runInsight(repliesCommand, args);
      const text = stripPaths(out + err);
      const label = args.join(" ");
      expectNoLeaks(text, label);
      expect(text, label).not.toMatch(/\.(?:jpg|mp4|png|html|json)\b|[0-9A-F]{8}-[0-9A-F]{4}/i);
      if (!args.includes("--json")) {
        // Everything from the notes down, and every line that is not a table row, is free of usernames.
        const notes = out.slice(out.indexOf("\nNotes\n"));
        expect(notes, label).not.toMatch(USERNAME);
        const prose = out.split("\n").filter((line) => !/^\s{2}\S+\s+[A-Z][a-z]{2} \d+, 2026\s/.test(line));
        expect(prose.join("\n"), label).not.toMatch(USERNAME);
      } else {
        const json = JSON.parse(out) as Report;
        expect(JSON.stringify(json.notes), label).not.toMatch(USERNAME);
      }
    }
  });

  it("puts no username in any error path", async () => {
    const dir = tempDir("replies-err-privacy");
    const zip = writeSyntheticZip(dir, "a.zip");
    const notZip = join(dir, "friend_1.txt");
    writeFileSync(notZip, "x");
    const damaged = join(dir, "damaged.zip");
    writeFileSync(damaged, syntheticExportZip({ now: LATER, friendCount: 40, memoryCount: 20 }).subarray(0, 900));
    const argSets = [[], [join(dir, "missing.zip")], [notZip], [zip, "--bogus"], [zip, "--limit", "x"], [zip, "--you-days", "999"], [damaged], [damaged, "--verbose"], [damaged, "--json"]];
    for (const args of argSets) {
      const { out, err } = await runInsight(repliesCommand, args);
      const text = stripPaths(out + err);
      expect(text, args.join(" ")).not.toMatch(USERNAME);
      expectNoLeaks(text, args.join(" "));
    }
  });

  it("makes a hostile username safe to print", () => {
    const report = bigReport(1);
    const first = report.waitingOnYou[0];
    if (first) first.username = "evil\x1b]0;title\x07name";
    const text = renderReplies(report, createTerm({ env: {}, isTTY: false, columns: 100 }), false);
    expect(text).not.toContain("\x1b");
    expect(text).not.toContain("\x07");
    expect(text).toContain("evil?]0;title?name");
  });
});

/** A report with n people in each list and every note, to read each sentence at counts of 1 and 2. */
function bigReport(n: number): Report {
  const people = (prefix: string) =>
    Array.from({ length: n }, (_, i) => ({ username: `${prefix}_${i + 1}`, since: Date.UTC(2026, 9, 20, 12), days: n }));
  const codes = [
    "group-events-skipped", "events-without-time", "events-in-future", "events-without-person", "people-not-in-friends", "people-last-direction-unknown",
    "people-last-event-tied", "people-wait-too-old", "people-one-sided-direction-unreliable", "a-code-from-the-future",
  ] as const;
  return {
    asOf: NOW,
    waitingOnYou: people("friend"),
    waitingOnThem: people("friend"),
    oneSided: Array.from({ length: n }, (_, i) => ({
      username: `friend_${i + 1}`,
      dominant: i % 2 === 0 ? ("you" as const) : ("them" as const),
      sent: 20,
      received: 2,
      unknown: 0,
      share: 0.91,
    })),
    summary: { people: n * 3, waitingOnYou: n, waitingOnThem: n, oneSided: n },
    notes: codes.map((code) => ({ code: code as insights.waitingOnReply.WaitingNoteCode, params: { count: n } })),
  };
}

const emptyReport = (code?: insights.waitingOnReply.WaitingNoteCode): Report => ({
  asOf: NOW,
  waitingOnYou: [],
  waitingOnThem: [],
  oneSided: [],
  summary: { people: 0, waitingOnYou: 0, waitingOnThem: 0, oneSided: 0 },
  notes: code ? [{ code, params: {} }] : [],
});

describe("wording", () => {
  it.each([0, 1, 2, 12])("reads correctly with %i people in each list", (n) => {
    const report = n === 0 ? { ...emptyReport(), notes: bigReport(0).notes } : bigReport(n);
    if (n === 0) report.summary.people = 5;
    const text = renderReplies(report, term, false);
    expectBrandSafe(text, `count ${n}`);
    expect(text).not.toContain("a-code-from-the-future");
    expect(text).toContain("Snappy noted something it cannot describe.");
    if (n === 0) {
      expect(text).toContain("No one looks to be waiting on a reply from you.");
      expect(text).toContain("You may not be waiting on anyone. No chats look one-sided.");
      expect(text.match(/None found\./g)).toHaveLength(3);
    } else {
      expect(text.match(/friend_\d+/g)?.length).toBe(n * 3);
    }
  });

  it("says one, not 1 people or 1 chats", () => {
    const one = renderReplies(bigReport(1), term, false);
    expect(one).toContain("1 person may be waiting on a reply from you.");
    expect(one).toContain("You may be waiting on 1 person.");
    expect(one).toContain("1 chat is mostly one-sided.");
    expect(one).toContain("Checked 3 one-to-one chats");
    expect(one).toContain("1 group chat event was left out.");
    expect(one).toContain("1 event is dated after the export. Snappy left it out.");
    expect(one).toContain("1 chat has a sent and a received message at the same moment.");
    expect(one).toContain("1 chat has been quiet for over 90 days. Snappy does not list it.");
    const many = renderReplies(bigReport(2), term, false);
    expect(many).toContain("2 people may be waiting on a reply from you.");
    expect(many).toContain("2 chats are mostly one-sided.");
    expect(many).toContain("2 group chat events were left out.");
    expect(many).toContain("2 events are dated after the export. Snappy left them out.");
    expect(many).toContain("2 chats have been quiet for over 90 days. Snappy does not list them.");
  });

  it("shows days and a date in each row, and who sends most in one-sided chats", () => {
    const text = renderReplies(bigReport(2), term, false);
    expect(text).toMatch(/friend_1\s+Oct 20, 2026\s+2 days/);
    expect(text).toMatch(/friend_1\s+You\s+20\s+2\s+91%/);
    expect(text).toMatch(/friend_2\s+They do\s+20\s+2\s+91%/);
    expect(renderReplies(bigReport(1), term, false)).toMatch(/Oct 20, 2026\s+1 day\n/);
  });

  it("caps each list at the limit and counts the rest", () => {
    const text = renderReplies(bigReport(12), term, false, { limit: 5 });
    expect(text.match(/7 more not shown\. Use --limit to show more\./g)).toHaveLength(3);
    expect(text.match(/friend_\d+/g)).toHaveLength(15);
    expect(renderReplies(bigReport(12), term, false)).not.toContain("more not shown");
  });

  it("describes a chat-free or unreadable export with one calm line", () => {
    const none = renderReplies(emptyReport("no-events"), term, false);
    expect(none).toContain("No one-to-one chats to check.");
    expect(none).toContain("Your export has no saved chats or Snaps, so there is nothing to check.");
    expect(none).not.toContain("Waiting on you");
    expect(renderReplies(emptyReport("no-one-to-one-events"), term, false)).toContain("Your saved chats are all group chats");
    expect(renderReplies(emptyReport("invalid-now"), term, false)).toContain("could not read today's date");
  });

  it("adds a code to each note only with verbose", () => {
    expect(renderReplies(bigReport(1), term, false)).not.toContain("code:");
    expect(renderReplies(bigReport(1), term, true)).toContain("code: people-last-event-tied");
  });

  it("keeps every sentence short and in sentence case", () => {
    const text = renderReplies(bigReport(2), term, false);
    const prose = text
      .split("\n")
      .map((line) => line.replace(/^\s*(?:Warning|Note|Error)\s+/, "").trim())
      .filter((line) => /[.?]$/.test(line) && !/\s{2,}/.test(line));
    expect(prose.length).toBeGreaterThan(8);
    for (const s of prose.flatMap((line) => line.split(/(?<=[.?])\s+/))) expect(s.split(/\s+/).length, s).toBeLessThanOrEqual(20);
    expect(text).not.toMatch(/\b(?:ghosts?|unfriend\w*|dormant|inactive|dead|simply|just)\b/i);
  });

  it("uses violet for one key figure only and never orange", () => {
    const color = createTerm({ env: { FORCE_COLOR: "1" }, isTTY: true, columns: 100 });
    const text = renderReplies(bigReport(2), color, false);
    const opening = (paint: (s: string) => string): string => paint("x").split("x")[0] ?? "";
    expect(opening(color.violet)).toContain("\x1b[");
    expect(text.split(opening(color.violet))).toHaveLength(2);
    expect(text).not.toContain(opening(color.orange));
  });
});
