/** snappy-export reach-out: who tends to reach out first. Synthetic data only. */
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { syntheticExportZip } from "@snappy-export/core";
import type { insights } from "@snappy-export/core";
import { reachOutCommand, renderReachOut } from "../src/commands/reach-out.ts";
import { createTerm } from "../src/term.ts";
import { LATER, NOW, makeIo, stripPaths, tempDir, writeSyntheticParts, writeSyntheticZip } from "./helpers.ts";
import { expectBrandSafe, expectNoLeaks, expectValidDescriptor, runInsight } from "./insights-helpers.ts";

type Report = insights.reachOutFirst.ReachOutReport;
type Code = insights.reachOutFirst.ReachOutNoteCode;
const term = createTerm({ env: {}, isTTY: false, columns: 100 });
const USERNAME = /\b(?:ghost|oneway|dormant|active|newfriend|friend)_\d+\b/;

describe("the command", () => {
  it("is a valid descriptor", async () => {
    await expectValidDescriptor(reachOutCommand);
    expect(reachOutCommand.name).toBe("reach-out");
    expect(reachOutCommand.group).toBe("Chats");
  });

  it("shows who tends to start the exchanges for a three-part export, and exits 0", async () => {
    const dir = tempDir("reach-parts");
    writeSyntheticParts(dir);
    const { code, out, err } = await runInsight(reachOutCommand, [dir]);
    expect(code).toBe(0);
    expect(err).toBe("");
    expect(out).toContain("Who reaches out first");
    expect(out).toContain("You started 51% of 673 exchanges, and they started 49%.");
    expect(out).toContain("They mostly reach out first in 1 chat, and you in 1 chat.");
    expect(out).toContain("Checked 28 one-to-one chats, using saved chats and Snaps.");
    expect(out).toContain("A new exchange starts after 6 hours of silence.");
    expect(out).toContain("These are hints.");
    expect(out).toContain("In chats with at least 5 exchanges, they started 70% or more.");
    expect(out).toMatch(/newfriend_1\s+2\s+13\s+87%/);
    expect(out).toMatch(/active_18\s+8\s+3\s+73%/);
    expect(out).toContain("451 group chat events were left out.");
    expect(out).toContain("4 chats have too few exchanges to judge. Snappy does not list them.");
    expect(out).not.toContain("code:");
    expect(out.endsWith("Nothing here has left this device.\n")).toBe(true);
    expectBrandSafe(out, "reach-out");
  });

  it("reads a single ZIP file", async () => {
    const zip = writeSyntheticZip(tempDir("reach-one"), "a.zip");
    const { code, out } = await runInsight(reachOutCommand, [zip]);
    expect(code).toBe(0);
    expect(out).toContain("Who reaches out first");
    expect(out).toMatch(/You started \d+% of [\d,]+ exchanges, and they started \d+%\./);
    expectBrandSafe(out, "single zip");
  });

  it("changes the lists with --gap-hours, --min-exchanges and --share, and caps each list with --limit", async () => {
    const zip = writeSyntheticZip(tempDir("reach-opts"), "a.zip");
    const { code, out } = await runInsight(reachOutCommand, [zip, "--gap-hours", "1", "--min-exchanges", "1", "--share", "50", "--limit", "2"]);
    expect(code).toBe(0);
    expect(out).toContain("A new exchange starts after 1 hour of silence.");
    expect(out).toContain("In chats with at least 1 exchange, they started 50% or more.");
    expect(out).toMatch(/\d+ more not shown\. Use --limit to show more\./);
    expect(out.match(/_\d+ +\d+ +\d+ +\d+%/g)).toHaveLength(4);
    const strict = await runInsight(reachOutCommand, [zip, "--min-exchanges", "100"]);
    expect(strict.out).toContain("No chat leans clearly one way.");
    expect(strict.out.match(/None found\./g)).toHaveLength(2);
  });

  it("prints JSON with the lists, counts and note codes only", async () => {
    const dir = tempDir("reach-json");
    writeSyntheticParts(dir);
    const { code, out } = await runInsight(reachOutCommand, [dir, "--json"]);
    expect(code).toBe(0);
    const json = JSON.parse(out) as Report & { generatedAt: string };
    expect(json.generatedAt).toBe(new Date(NOW).toISOString());
    expect(Object.keys(json)).toEqual(["generatedAt", "asOf", "settings", "people", "mostlyThem", "mostlyYou", "overall", "summary", "notes"]);
    expect(json.asOf).toBe(LATER);
    expect(json.settings).toEqual({ gapHours: 6, minExchanges: 5, mostlyShare: 0.7 });
    expect(json.mostlyThem.map((p) => p.username)).toEqual(["newfriend_1"]);
    expect(json.summary).toEqual({ people: 28, mostlyThem: 1, mostlyYou: 1 });
    expect(JSON.stringify(json.notes)).not.toMatch(USERNAME);
    expect(json.notes.every((n) => /^[a-z-]+$/.test(n.code) && Object.values(n.params).every(Number.isInteger))).toBe(true);
  });

  it("adds the short code to each note only with --verbose", async () => {
    const dir = tempDir("reach-verbose");
    writeSyntheticParts(dir);
    const verbose = await runInsight(reachOutCommand, [dir, "--verbose"]);
    expect(verbose.out).toContain("code: group-events-skipped");
    expect(verbose.out).toContain("code: people-too-few-exchanges");
  });

  it("stops on a damaged ZIP file with the problems and exit code 2", async () => {
    const dir = tempDir("reach-damaged");
    const full = syntheticExportZip({ now: LATER, friendCount: 40, memoryCount: 20 });
    const damaged = join(dir, "damaged.zip");
    writeFileSync(damaged, full.subarray(0, Math.floor(full.length * 0.6)));
    const { code, out, err } = await runInsight(reachOutCommand, [damaged]);
    expect(code).toBe(2);
    expect(err).toBe("");
    expect(out).toContain("Problems found");
    expect(out).toContain("Snappy did not read your chats from a broken export.");
    expect(out).not.toContain("They mostly reach out first");
    expect(out.endsWith("Nothing here has left this device.\n")).toBe(true);
    expectBrandSafe(out, "damaged");
    const json = await runInsight(reachOutCommand, [damaged, "--json"]);
    expect(json.code).toBe(2);
    expect(JSON.parse(json.out)).toMatchObject({ stopped: "export-errors" });
  });

  it("uses no color with --no-color or NO_COLOR, and color on a color terminal", async () => {
    const dir = tempDir("reach-color");
    writeSyntheticParts(dir);
    const color = await runInsight(reachOutCommand, [dir], makeIo({ interactive: true, env: { COLORTERM: "truecolor" } }));
    expect(color.out).toContain("\x1b[");
    const flagged = await runInsight(reachOutCommand, [dir, "--no-color"], makeIo({ interactive: true, env: { COLORTERM: "truecolor" } }));
    expect(flagged.out).not.toContain("\x1b");
    const env = await runInsight(reachOutCommand, [dir], makeIo({ interactive: true, env: { NO_COLOR: "1" } }));
    expect(env.out).not.toContain("\x1b");
  });

  it("writes no file, reads no ledger and asks for no passphrase", async () => {
    const home = tempDir("reach-home");
    const dir = tempDir("reach-ro");
    writeSyntheticParts(dir);
    const before = readdirSync(dir).sort();
    for (const args of [[dir], [dir, "--json"]]) {
      const io = makeIo({ home });
      await runInsight(reachOutCommand, args, io);
      expect(io.asked).toEqual([]);
    }
    expect(readdirSync(home)).toEqual([]);
    expect(readdirSync(dir).sort()).toEqual(before);
  });

  it("stops with calm messages for a missing path, no input, a wrong file and bad options", async () => {
    const dir = tempDir("reach-errors");
    const missing = await runInsight(reachOutCommand, [join(dir, "missing.zip")]);
    expect(missing).toMatchObject({ code: 1, out: "" });
    expect(missing.err).toContain("could not find");
    expect((await runInsight(reachOutCommand, [])).err).toContain("Give Snappy your export");
    const notZip = join(dir, "notes.txt");
    writeFileSync(notZip, "not a zip file");
    const wrong = await runInsight(reachOutCommand, [notZip]);
    expect(wrong.code).toBe(1);
    expect(wrong.out).toBe("");

    const zip = writeSyntheticZip(dir, "a.zip");
    const err = async (...args: string[]): Promise<string> => (await runInsight(reachOutCommand, [zip, ...args])).err;
    expect(await err("--limit", "x")).toContain("--limit must be a whole number from 1 to 1000.");
    expect(await err("--gap-hours", "0")).toContain("--gap-hours must be a whole number from 1 to 72.");
    expect(await err("--gap-hours=73")).toContain("--gap-hours must be a whole number from 1 to 72.");
    expect(await err("--min-exchanges", "0")).toContain("--min-exchanges must be a whole number from 1 to 100.");
    expect(await err("--share", "49")).toContain("--share must be a whole number from 50 to 100.");
    expect(await err("--share", "101")).toContain("--share must be a whole number from 50 to 100.");
    expect(await err("--share", "x")).toContain("--share must be a whole number");
    expect(await err("--limit")).toContain("needs a value");
    expect(await err("--utc-offset", "2")).toContain('Snappy does not know the option --utc-offset for reach-out. Run "snappy-export help reach-out"');
    expect(await err("--bogus")).toContain('Snappy does not know the option --bogus for reach-out. Run "snappy-export help reach-out"');
    for (const args of [[zip, "--limit", "x"], [zip, "--bogus"], []]) expect((await runInsight(reachOutCommand, args)).out).toBe("");
  });

  it("checks the options before it reads anything", async () => {
    const dir = tempDir("reach-order");
    const { code, err } = await runInsight(reachOutCommand, [join(dir, "missing.zip"), "--share", "x"]);
    expect(code).toBe(1);
    expect(err).toContain("--share must be a whole number");
    expect(err).not.toContain("could not find");
  });
});

describe("privacy", () => {
  it("prints no canary, link or entry name, and no username outside the result tables", async () => {
    const dir = tempDir("reach-canary");
    const zip = writeSyntheticZip(dir, "export.zip", { bundleMedia: true });
    const parts = join(dir, "parts");
    writeSyntheticParts(parts, { memoryCount: 200 });
    const argSets = [[zip], [zip, "--json"], [parts], [parts, "--json", "--verbose"], [zip, "--gap-hours", "1", "--min-exchanges", "1", "--share", "50", "--verbose"]];
    for (const args of argSets) {
      const { out, err } = await runInsight(reachOutCommand, args);
      const text = stripPaths(out + err);
      const label = args.join(" ");
      expectNoLeaks(text, label);
      expect(text, label).not.toMatch(/\.(?:jpg|mp4|png|html|json)\b|[0-9A-F]{8}-[0-9A-F]{4}/i);
      if (!args.includes("--json")) {
        const notes = out.slice(out.indexOf("\nNotes\n"));
        expect(notes, label).not.toMatch(USERNAME);
        // Every line that is not a table row is free of usernames.
        const prose = out.split("\n").filter((line) => !/^\s{2}\S+\s+\d+\s+\d+\s+\d+%$/.test(line));
        expect(prose.join("\n"), label).not.toMatch(USERNAME);
      } else {
        expect(JSON.stringify((JSON.parse(out) as Report).notes), label).not.toMatch(USERNAME);
      }
    }
  });

  it("puts no username in any error path", async () => {
    const dir = tempDir("reach-err-privacy");
    const zip = writeSyntheticZip(dir, "a.zip");
    const notZip = join(dir, "friend_1.txt");
    writeFileSync(notZip, "x");
    const damaged = join(dir, "damaged.zip");
    writeFileSync(damaged, syntheticExportZip({ now: LATER, friendCount: 40, memoryCount: 20 }).subarray(0, 900));
    const argSets = [[], [join(dir, "missing.zip")], [notZip], [zip, "--bogus"], [zip, "--limit", "x"], [zip, "--gap-hours", "999"], [damaged], [damaged, "--verbose"], [damaged, "--json"]];
    for (const args of argSets) {
      const { out, err } = await runInsight(reachOutCommand, args);
      const text = stripPaths(out + err);
      expect(text, args.join(" ")).not.toMatch(USERNAME);
      expectNoLeaks(text, args.join(" "));
    }
  });

  it("makes a hostile username safe to print", () => {
    const report = bigReport(1);
    const first = report.mostlyThem[0];
    if (first) first.username = "evil\x1b]0;title\x07name";
    const text = renderReachOut(report, term, false);
    expect(text).not.toContain("\x1b");
    expect(text).not.toContain("\x07");
    expect(text).toContain("evil?]0;title?name");
  });
});

const person = (username: string, byYou: number, byThem: number) => ({
  username,
  exchanges: byYou + byThem,
  byYou,
  byThem,
  unknown: 0,
  youShare: byYou + byThem > 0 ? Math.round((byYou / (byYou + byThem)) * 100) / 100 : null,
});

/** A report with n people in each list and every note, to read each sentence at counts of 1 and 2. */
function bigReport(n: number): Report {
  const codes: Code[] = [
    "group-events-skipped", "events-without-time", "events-in-future", "events-without-person", "people-not-in-friends", "exchanges-starter-unknown",
    "exchanges-starter-tied", "people-too-few-exchanges", "people-starter-unreliable",
  ];
  const them = Array.from({ length: n }, (_, i) => person(`friend_${i + 1}`, 1, 9));
  const you = Array.from({ length: n }, (_, i) => person(`friend_${n + i + 1}`, 8, 2));
  return {
    asOf: NOW,
    settings: { gapHours: 6, minExchanges: 5, mostlyShare: 0.7 },
    people: [...them, ...you],
    mostlyThem: them,
    mostlyYou: you,
    overall: { exchanges: n * 20, byYou: n * 9, byThem: n * 11, unknown: 0, youShare: 0.45 },
    summary: { people: n * 3, mostlyThem: n, mostlyYou: n },
    notes: [...codes.map((code) => ({ code, params: { count: n } })), { code: "a-code-from-the-future" as Code, params: { count: n } }],
  };
}

const emptyReport = (code?: Code): Report => ({
  asOf: NOW,
  settings: { gapHours: 6, minExchanges: 5, mostlyShare: 0.7 },
  people: [],
  mostlyThem: [],
  mostlyYou: [],
  overall: { exchanges: 0, byYou: 0, byThem: 0, unknown: 0, youShare: null },
  summary: { people: 0, mostlyThem: 0, mostlyYou: 0 },
  notes: code ? [{ code, params: {} }] : [],
});

describe("wording", () => {
  it.each([1, 2, 12])("reads correctly with %i people in each list", (n) => {
    const text = renderReachOut(bigReport(n), term, false);
    expectBrandSafe(text, `count ${n}`);
    expect(text).not.toContain("a-code-from-the-future");
    expect(text).toContain("Snappy noted something it cannot describe.");
    expect(text).toContain("You started 45% of");
    expect(text.match(/friend_\d+/g)?.length).toBe(n * 2);
  });

  it("says one, not 1 people or 1 chats", () => {
    const one = renderReachOut(bigReport(1), term, false);
    expect(one).toContain("They mostly reach out first in 1 chat, and you in 1 chat.");
    expect(one).toContain("You started 45% of 20 exchanges, and they started 55%.");
    expect(one).toContain("1 group chat event was left out.");
    expect(one).toContain("1 event is dated after the export. Snappy left it out.");
    expect(one).toContain("1 exchange could not be counted, since the export does not say who wrote first.");
    expect(one).toContain("1 exchange began with a sent and a received message at the same moment.");
    expect(one).toContain("1 chat has too few exchanges to judge. Snappy does not list it.");
    expect(one).toContain("1 chat had too many exchanges with no known starter to judge.");
    const many = renderReachOut(bigReport(2), term, false);
    expect(many).toContain("They mostly reach out first in 2 chats, and you in 2 chats.");
    expect(many).toContain("2 group chat events were left out.");
    expect(many).toContain("2 events are dated after the export. Snappy left them out.");
    expect(many).toContain("2 exchanges began with a sent and a received message at the same moment.");
    expect(many).toContain("2 chats have too few exchanges to judge. Snappy does not list them.");
  });

  it("shows both counts and the share of the side that starts most", () => {
    const text = renderReachOut(bigReport(2), term, false);
    expect(text).toMatch(/friend_1\s+1\s+9\s+90%/);
    expect(text).toMatch(/friend_3\s+8\s+2\s+80%/);
  });

  it("says the settings in use", () => {
    const report = bigReport(1);
    report.settings = { gapHours: 12, minExchanges: 8, mostlyShare: 0.85 };
    const text = renderReachOut(report, term, false);
    expect(text).toContain("A new exchange starts after 12 hours of silence.");
    expect(text).toContain("In chats with at least 8 exchanges, they started 85% or more.");
    expect(text).toContain("In chats with at least 8 exchanges, you started 85% or more.");
  });

  it("caps each list at the limit and counts the rest", () => {
    const text = renderReachOut(bigReport(12), term, false, { limit: 5 });
    expect(text.match(/7 more not shown\. Use --limit to show more\./g)).toHaveLength(2);
    expect(text.match(/friend_\d+/g)).toHaveLength(10);
    expect(renderReachOut(bigReport(12), term, false)).not.toContain("more not shown");
  });

  it("says so when no chat leans one way, and when no exchange has a known starter", () => {
    const quiet = bigReport(1);
    quiet.mostlyThem = [];
    quiet.mostlyYou = [];
    quiet.summary = { people: 3, mostlyThem: 0, mostlyYou: 0 };
    const text = renderReachOut(quiet, term, false);
    expect(text).toContain("No chat leans clearly one way.");
    expect(text.match(/None found\./g)).toHaveLength(2);
    const unclear = bigReport(1);
    unclear.overall = { exchanges: 0, byYou: 0, byThem: 0, unknown: 4, youShare: null };
    expect(renderReachOut(unclear, term, false)).toContain("No exchange has a known starter, so Snappy cannot tell who reaches out first.");
  });

  it("describes a chat-free or unreadable export with one calm line", () => {
    const none = renderReachOut(emptyReport("no-events"), term, false);
    expect(none).toContain("No one-to-one chats to check.");
    expect(none).toContain("Your export has no saved chats or Snaps, so there is nothing to check.");
    expect(none).not.toContain("They mostly reach out first");
    expect(renderReachOut(emptyReport("no-one-to-one-events"), term, false)).toContain("Your saved chats are all group chats");
    expect(renderReachOut(emptyReport("invalid-now"), term, false)).toContain("could not read today's date");
  });

  it("adds a code to each note only with verbose", () => {
    expect(renderReachOut(bigReport(1), term, false)).not.toContain("code:");
    expect(renderReachOut(bigReport(1), term, true)).toContain("code: exchanges-starter-tied");
  });

  it("keeps every sentence short and in sentence case, and hedges the reading", () => {
    const text = renderReachOut(bigReport(2), term, false);
    const prose = text
      .split("\n")
      .map((line) => line.replace(/^\s*(?:Warning|Note|Error)\s+/, "").trim())
      .filter((line) => /[.?]$/.test(line) && !/\s{2,}/.test(line));
    expect(prose.length).toBeGreaterThan(8);
    for (const s of prose.flatMap((line) => line.split(/(?<=[.?])\s+/))) expect(s.split(/\s+/).length, s).toBeLessThanOrEqual(20);
    expect(text).not.toMatch(/\b(?:ghosts?|unfriend\w*|dormant|inactive|dead|simply|just|clingy|needy)\b/i);
    expect(text).toContain("These are hints.");
  });

  it("uses violet for one key figure only and never orange", () => {
    const color = createTerm({ env: { FORCE_COLOR: "1" }, isTTY: true, columns: 100 });
    const text = renderReachOut(bigReport(2), color, false);
    const opening = (paint: (s: string) => string): string => paint("x").split("x")[0] ?? "";
    expect(opening(color.violet)).toContain("\x1b[");
    expect(text.split(opening(color.violet))).toHaveLength(2);
    expect(text).not.toContain(opening(color.orange));
  });
});
