/** snappy-export closest: closest and fading friends. Synthetic data only. */
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { insights, syntheticExportZip } from "@snappy-export/core";
import { closestCommand, renderClosest } from "../src/commands/closest.ts";
import { createTerm } from "../src/term.ts";
import { LATER, NOW, makeIo, stripPaths, tempDir, writeSyntheticParts, writeSyntheticZip } from "./helpers.ts";
import { expectBrandSafe, expectNoLeaks, expectValidDescriptor, runInsight } from "./insights-helpers.ts";

type Result = insights.closestFading.ClosestFadingResult;
const DEFAULTS = insights.closestFading.DEFAULT_CLOSEST_FADING_SETTINGS;
const term = createTerm({ env: {}, isTTY: false, columns: 100 });

/** The synthetic usernames: only the two result tables may hold one. */
const USERNAME = /\b(?:ghost|oneway|dormant|active|newfriend|contact)_\d+\b/;

/** The Notes section of a text result, or "" when there is none. */
function notesOf(text: string): string {
  const start = text.indexOf("Notes\n");
  return start === -1 ? "" : text.slice(start, text.indexOf("Nothing here has left this device."));
}

describe("the command", () => {
  it("is a valid descriptor", async () => {
    await expectValidDescriptor(closestCommand);
    expect(closestCommand.name).toBe("closest");
    expect(closestCommand.group).toBe("Friends");
  });

  it("lists the closest friends from a normal export, and exits 0", async () => {
    const dir = tempDir("closest-parts");
    writeSyntheticParts(dir);
    const { code, out, err } = await runInsight(closestCommand, [dir]);
    expect(code).toBe(0);
    expect(err).toBe("");
    expect(out).toContain("Closest and fading friends");
    expect(out).toContain("10 friends in the closest list, 0 friends fading.");
    expect(out).toContain("Closest\n  Rank  Friend");
    expect(out).toContain("Activity is shown against your top friend.");
    expect(out).toContain("No friend shows a clear drop in activity.");
    expect(out).toContain("Counted back from Nov 1, 2026. Recent means the last 90 days.");
    expect(out).toContain("Older activity counts less, by half every 30 days.");
    expect(out.endsWith("Nothing here has left this device.\n")).toBe(true);
    // The top row is the whole scale.
    expect(out).toMatch(/^\s+1  \S+\s+100%/m);
    expectBrandSafe(out, "closest");
    expectNoLeaks(out, "closest");
  });

  it("works on a single ZIP file too", async () => {
    const zip = writeSyntheticZip(tempDir("closest-one"), "a.zip");
    const { code, out } = await runInsight(closestCommand, [zip]);
    expect(code).toBe(0);
    expect(out).toContain("in the closest list");
    expectBrandSafe(out, "one zip");
  });

  it("shows fading friends with a short window, and caps the list with --top", async () => {
    const dir = tempDir("closest-fading");
    writeSyntheticParts(dir);
    const all = await runInsight(closestCommand, [dir, "--window", "7"]);
    expect(all.code).toBe(0);
    expect(all.out).toContain("3 friends fading.");
    expect(all.out).toContain("Fading\n  Friend");
    expect(all.out).toMatch(/Down \d+%|Stopped/);
    expect(all.out).toContain("Fading means fewer saved chats and Snaps than before. It does not mean a friendship ended.");
    expect(all.out).toContain("Recent means the last 7 days.");
    expect(all.out).not.toContain("not shown");
    expectBrandSafe(all.out, "window 7");

    const capped = await runInsight(closestCommand, [dir, "--window", "7", "--top", "2"]);
    expect(capped.out).toContain("2 friends in the closest list, 3 friends fading.");
    expect(capped.out).toContain("1 more friend not shown. Use --top to show more.");
    const rows = capped.out.split("\n").filter((l) => /^\s+\d+  \S+_\d+\s+\d+%/.test(l));
    expect(rows).toHaveLength(2);
    expectBrandSafe(capped.out, "top 2");
  });

  it("changes the settings with --window and --half-life", async () => {
    const dir = tempDir("closest-settings");
    writeSyntheticParts(dir);
    const { code, out } = await runInsight(closestCommand, [dir, "--window", "45", "--half-life", "10", "--json"]);
    expect(code).toBe(0);
    const json = JSON.parse(out) as Result;
    expect(json.settings.windowDays).toBe(45);
    expect(json.settings.halfLifeDays).toBe(10);
    expect(json.settings.topCount).toBe(DEFAULTS.topCount);
  });

  it("prints JSON with the core result, the date and no prose", async () => {
    const dir = tempDir("closest-json");
    writeSyntheticParts(dir);
    const { code, out } = await runInsight(closestCommand, [dir, "--json"]);
    expect(code).toBe(0);
    const json = JSON.parse(out) as Result & { generatedAt: string };
    expect(json.generatedAt).toBe(new Date(NOW).toISOString());
    expect(Object.keys(json)).toEqual(["generatedAt", "asOf", "basis", "settings", "closest", "fading", "notes", "counts"]);
    expect(json.basis).toBe("saved-chats-and-snaps");
    expect(json.closest).toHaveLength(10);
    expect(json.closest[0]?.rank).toBe(1);
    expect(json.closest[0]?.relativeScore).toBe(1);
    // Notes hold codes and numbers, never a name or a sentence.
    for (const note of json.notes) expect(Object.keys(note).sort()).toEqual(["code", "params"]);
    expect(JSON.stringify(json.notes)).not.toMatch(USERNAME);
  });

  it("adds the short code to each note with --verbose, and not without it", async () => {
    const dir = tempDir("closest-verbose");
    writeSyntheticParts(dir);
    const quiet = await runInsight(closestCommand, [dir]);
    expect(quiet.out).toContain("Note     This export is about 5 days old, so Snappy counted back from its date.");
    expect(quiet.out).not.toContain("code:");
    const verbose = await runInsight(closestCommand, [dir, "--verbose"]);
    expect(verbose.out).toContain("code: measured-to-export-date");
    expect(verbose.out).toContain("code: non-friend-events-ignored");
  });

  it("uses no color with --no-color or NO_COLOR, and color on a color terminal", async () => {
    const dir = tempDir("closest-color");
    writeSyntheticParts(dir);
    const color = await runInsight(closestCommand, [dir], makeIo({ interactive: true, env: { COLORTERM: "truecolor" } }));
    expect(color.out).toContain("\x1b[");
    const flagged = await runInsight(closestCommand, [dir, "--no-color"], makeIo({ interactive: true, env: { COLORTERM: "truecolor" } }));
    expect(flagged.out).not.toContain("\x1b");
    const env = await runInsight(closestCommand, [dir], makeIo({ interactive: true, env: { NO_COLOR: "1" } }));
    expect(env.out).not.toContain("\x1b");
  });

  it("never reads the ledger, asks for a passphrase or writes a file", async () => {
    const home = tempDir("closest-home");
    const dir = tempDir("closest-ro");
    writeSyntheticParts(dir);
    const before = readdirSync(dir).sort();
    const io = makeIo({ home });
    await runInsight(closestCommand, [dir], io);
    await runInsight(closestCommand, [dir, "--json"], io);
    expect(io.asked).toEqual([]);
    expect(readdirSync(home)).toEqual([]);
    expect(readdirSync(dir).sort()).toEqual(before);
    // The command has no ledger or output option.
    const ledger = await runInsight(closestCommand, [dir, "--ledger", join(home, "x")]);
    expect(ledger.err).toContain("does not know the option --ledger for closest");
    const out = await runInsight(closestCommand, [dir, "--out", join(home, "x.txt")]);
    expect(out.err).toContain("does not know the option --out for closest");
    expect(readdirSync(home)).toEqual([]);
  });

  it("stops on a damaged export, says what is wrong and lists nobody", async () => {
    const dir = tempDir("closest-damaged");
    const full = syntheticExportZip({ now: LATER, friendCount: 40, memoryCount: 20 });
    const damaged = join(dir, "damaged.zip");
    writeFileSync(damaged, full.subarray(0, Math.floor(full.length * 0.6)));

    const text = await runInsight(closestCommand, [damaged]);
    expect(text.code).toBe(2);
    expect(text.err).toBe("");
    expect(text.out).toContain("Export problems");
    expect(text.out).toContain("Error    Snappy could not read this file as a ZIP file.");
    expect(text.out).toContain("Snappy stopped. It will not list friends from a broken export.");
    expect(text.out).not.toContain("Closest and fading friends");
    expect(text.out).not.toContain("code:");
    expectBrandSafe(text.out, "damaged");

    const verbose = await runInsight(closestCommand, [damaged, "--verbose"]);
    expect(verbose.out).toContain("code: zip-unreadable");

    const json = await runInsight(closestCommand, [damaged, "--json"]);
    expect(json.code).toBe(2);
    const parsed = JSON.parse(json.out) as { stopped: string; issues: { code: string }[] };
    expect(parsed.stopped).toBe("export-errors");
    expect(parsed.issues.map((i) => i.code)).toContain("zip-unreadable");
    for (const o of [text.out, verbose.out, json.out]) {
      expectNoLeaks(stripPaths(o), "damaged");
      expect(o).not.toMatch(USERNAME);
    }
  });
});

describe("errors", () => {
  it("stops with calm messages for no input, a missing path and a file that is not a ZIP file", async () => {
    const dir = tempDir("closest-errors");
    expect((await runInsight(closestCommand, [])).err).toContain("Give Snappy your export");
    const missing = await runInsight(closestCommand, [join(dir, "missing.zip")]);
    expect(missing).toMatchObject({ code: 1, out: "" });
    expect(missing.err).toContain("could not find");
    const notes = join(dir, "notes.txt");
    writeFileSync(notes, "hello");
    const wrong = await runInsight(closestCommand, [notes]);
    expect(wrong).toMatchObject({ code: 1, out: "" });
    expect(wrong.err).toContain("is not a .zip file");
  });

  it("checks every option before it reads anything", async () => {
    const missing = join(tempDir("closest-order"), "missing.zip");
    const cases: [string[], string][] = [
      [["--window", "x"], "--window must be a whole number from 1 to 365."],
      [["--window", "0"], "--window must be a whole number from 1 to 365."],
      [["--window", "400"], "--window must be a whole number from 1 to 365."],
      [["--window", "-5"], "--window"],
      [["--half-life", "0"], "--half-life must be a whole number from 1 to 365."],
      [["--half-life", "1.5"], "--half-life must be a whole number from 1 to 365."],
      [["--top", "0"], "--top must be a whole number from 1 to 100."],
      [["--top", "101"], "--top must be a whole number from 1 to 100."],
      [["--top", "many"], "--top must be a whole number from 1 to 100."],
    ];
    for (const [args, message] of cases) {
      const result = await runInsight(closestCommand, [missing, ...args]);
      expect(result.code, args.join(" ")).toBe(1);
      expect(result.out).toBe("");
      expect(result.err, args.join(" ")).toContain(message);
      expect(result.err, args.join(" ")).not.toContain("could not find");
    }
  });

  it("names an unknown option, and an option with no value, without echoing values", async () => {
    const zip = writeSyntheticZip(tempDir("closest-flags"), "a.zip");
    const unknown = await runInsight(closestCommand, [zip, "--bogus"]);
    expect(unknown.err).toContain('Snappy does not know the option --bogus for closest. Run "snappy-export help closest"');
    const noValue = await runInsight(closestCommand, [zip, "--top"]);
    expect(noValue.err).toContain("The option --top needs a value.");
  });
});

describe("privacy", () => {
  it("prints no canary, link or file name, and names a friend only in the two tables", async () => {
    const dir = tempDir("closest-canary");
    const zip = writeSyntheticZip(dir, "export.zip", { bundleMedia: true });
    const parts = join(dir, "parts");
    writeSyntheticParts(parts, { memoryCount: 200 });
    const runs = [[zip], [zip, "--json"], [parts], [parts, "--verbose"], [parts, "--window", "7"], [parts, "--window", "7", "--verbose", "--top", "1"]];
    for (const args of runs) {
      const { out, err } = await runInsight(closestCommand, args);
      const text = stripPaths(out + err);
      const label = args.join(" ");
      expectNoLeaks(text, label);
      expect(text, label).not.toMatch(/\.(?:jpg|mp4|png|html|json)\b|[0-9A-F]{8}-[0-9A-F]{4}/i);
      if (!args.includes("--json")) {
        // Everything outside the tables is free of names: notes, headings, method lines and codes.
        expect(notesOf(out), label).not.toMatch(USERNAME);
        expect(out.split("\n").filter((l) => !/^\s+(?:\d+  )?\S+_\d+\s+\d/.test(l) && !/^\s+\d+  \S+_\d+\s/.test(l)).join("\n"), label).not.toMatch(USERNAME);
      }
    }
  });

  it("names no one in any error path", async () => {
    const dir = tempDir("closest-error-names");
    const zip = writeSyntheticZip(dir, "a.zip");
    const attempts = [[], [join(dir, "missing.zip")], [zip, "--bogus"], [zip, "--window", "x"], [zip, "--top"], [zip, "--top", "0", "--verbose"]];
    for (const args of attempts) {
      const { out, err } = await runInsight(closestCommand, args);
      const text = stripPaths(out + err);
      expect(text, args.join(" ")).not.toMatch(USERNAME);
      expectNoLeaks(text, args.join(" "));
    }
  });
});

/** A result with `n` friends in each list and every note code, to read each sentence at counts of 0, 1, 2 and 12. */
function built(n: number, notes = true): Result {
  const names = Array.from({ length: n }, (_, i) => `friend_${String(i + 1).padStart(2, "0")}`);
  const noteList: Result["notes"] = notes
    ? [
        "invalid-reference-time", "no-activity-data", "no-one-to-one-activity", "measured-to-export-date", "history-starts-inside-earlier-window",
        "future-events-ignored", "undated-events-ignored", "non-friend-events-ignored", "a-code-from-the-future",
      ].map((code) => ({ code: code as Result["notes"][number]["code"], params: { count: n, daysBeforeNow: n } }))
    : [];
  return {
    asOf: NOW,
    basis: "saved-chats-and-snaps",
    settings: { ...DEFAULTS, topCount: 10 },
    closest: names.map((key, i) => ({
      key,
      rank: i + 1,
      score: 10 - i * 0.1,
      relativeScore: 1 - i * 0.05,
      events: { total: 9, sent: 4, received: 4, unknown: 1 },
      weighted: { sent: 4, received: 4, unknown: 1 },
      lastAt: NOW,
    })),
    fading: names.map((key, i) => ({
      key,
      earlierEvents: 20,
      recentEvents: i % 2 === 0 ? 0 : 4,
      dropFraction: i % 2 === 0 ? 1 : 0.8,
      stopped: i % 2 === 0,
      lastAt: NOW,
    })),
    notes: noteList,
    counts: { friends: n, withRecentActivity: n, eventsUsed: n * 29 },
  };
}

describe("wording", () => {
  it.each([0, 1, 2, 12])("reads correctly with %i friends in each list", (n) => {
    const text = renderClosest(built(n), term, false);
    expectBrandSafe(text, `count ${n}`);
    expect(text).not.toContain("a-code-from-the-future");
    expect(text).toContain("Snappy noted something it cannot describe.");
    expect(text).toContain("Run it with --verbose and share the code.");
    expect(text).toContain(`${n} friend`);
    expect(renderClosest(built(n), term, true)).toContain("code: a-code-from-the-future");
  });

  it("says friend and friends correctly, and shows the empty lists", () => {
    const none = renderClosest(built(0, false), term, false);
    expect(none).toContain("0 friends in the closest list, 0 friends fading.");
    expect(none).toContain("No friend has 3 saved chats or Snaps in the recent window.");
    expect(none).toContain("No friend shows a clear drop in activity.");
    expect(none).not.toContain("Notes");
    const one = renderClosest(built(1, false), term, false);
    expect(one).toContain("1 friend in the closest list, 1 friend fading.");
    expect(one).toContain("Stopped");
    const two = renderClosest(built(2, false), term, false);
    expect(two).toContain("2 friends in the closest list, 2 friends fading.");
    expect(two).toContain("Down 80%");
  });

  it("caps each table at the top count and says how many are hidden", () => {
    const r = built(12, false);
    const text = renderClosest(r, term, false);
    expect(text).toContain("12 friends in the closest list, 12 friends fading.");
    expect(text).toContain("2 more friends not shown. Use --top to show more.");
    expect(text.match(/friend_\d\d/g)).toHaveLength(20);
    const oneHidden = renderClosest({ ...r, settings: { ...r.settings, topCount: 11 } }, term, false);
    expect(oneHidden).toContain("1 more friend not shown.");
  });

  it("agrees nouns and verbs in the notes at counts of 1 and 2", () => {
    const one = renderClosest(built(1), term, false);
    expect(one).toContain("1 entry has a date in the future. Snappy leaves it out.");
    expect(one).toContain("1 entry has no usable date. Snappy leaves it out.");
    expect(one).toContain("1 chat or Snap is with someone not on your friends list. Snappy leaves it out.");
    expect(one).toContain("about 1 day old");
    const two = renderClosest(built(2), term, false);
    expect(two).toContain("2 entries have a date in the future. Snappy leaves them out.");
    expect(two).toContain("2 entries have no usable date. Snappy leaves them out.");
    expect(two).toContain("2 chats or Snaps are with people not on your friends list. Snappy leaves them out.");
  });

  it("hedges, and keeps every sentence short and in sentence case", () => {
    const text = renderClosest(built(2), term, false);
    expect(text).toContain("It does not mean a friendship ended.");
    expect(text).toMatch(/may start inside the earlier window/);
    const prose = text
      .split("\n")
      .map((line) => line.replace(/^\s*(?:Warning|Note|Error)\s+/, "").trim())
      .filter((line) => /[.?]$/.test(line) && !/\s{2,}/.test(line));
    expect(prose.length).toBeGreaterThan(8);
    for (const s of prose.flatMap((line) => line.split(/(?<=[.?])\s+/))) expect(s.split(/\s+/).length, s).toBeLessThanOrEqual(25);
    expect(text).not.toMatch(/\b(?:ghosts?|unfriend\w*|dormant|inactive|dead|simply|just|purge)\b/i);
  });
});
