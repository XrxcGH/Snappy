/** snappy-export anniversaries: upcoming friendship anniversaries. Synthetic data only. */
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { insights, syntheticExportZip } from "@snappy-export/core";
import { anniversariesCommand, renderAnniversaries } from "../src/commands/anniversaries.ts";
import { createTerm } from "../src/term.ts";
import { LATER, NOW, makeIo, stripPaths, tempDir, writeSyntheticParts, writeSyntheticZip } from "./helpers.ts";
import { expectBrandSafe, expectNoLeaks, expectValidDescriptor, runInsight } from "./insights-helpers.ts";

type Result = insights.anniversaries.AnniversaryResult;
const term = createTerm({ env: {}, isTTY: false, columns: 100 });
const USERNAME = /\b(?:ghost|oneway|dormant|active|newfriend|snapper)_\d+\b/;

describe("the command", () => {
  it("is a valid descriptor", async () => {
    await expectValidDescriptor(anniversariesCommand);
    expect(anniversariesCommand.name).toBe("anniversaries");
    expect(anniversariesCommand.group).toBe("Friends");
  });

  it("lists upcoming anniversaries in a table, with a hedged note, and exits 0", async () => {
    const zip = writeSyntheticZip(tempDir("anniv-one"), "a.zip");
    const { code, out, err } = await runInsight(anniversariesCommand, [zip]);
    expect(code).toBe(0);
    expect(err).toBe("");
    expect(out).toContain("Friendship anniversaries");
    expect(out).toMatch(/\d+ friendships? reach(?:es)? a whole year in the next 30 days\./);
    expect(out).toContain("Coming up");
    for (const header of ["Friend", "Date", "In", "Reaches", "Details"]) expect(out).toContain(header);
    expect(out).toMatch(/active_\d+ +[A-Z][a-z]{2} \d{1,2}, 20\d\d/);
    expect(out).toContain("Milestone");
    expect(out).toContain("Dates come from when each connection was created. They may not match when you first met.");
    expect(out).not.toContain("code:");
    expect(out.endsWith("Nothing here has left this device.\n")).toBe(true);
    expectBrandSafe(out, "anniversaries");
  });

  it("looks further ahead with --days, caps rows with --limit and filters with --milestones", async () => {
    const zip = writeSyntheticZip(tempDir("anniv-days"), "a.zip");
    const wide = await runInsight(anniversariesCommand, [zip, "--days", "366", "--limit", "3"]);
    expect(wide.code).toBe(0);
    expect(wide.out).toContain("in the next 366 days.");
    expect(wide.out).toMatch(/\d+ more rows? not shown\. Use --limit to see more\./);
    expect((wide.out.match(/active_\d+|dormant_\d+|newfriend_\d+|snapper_\d+|ghost_\d+|oneway_\d+/g) ?? []).length).toBe(3);
    const milestones = await runInsight(anniversariesCommand, [zip, "--days", "366", "--milestones", "--limit", "100"]);
    expect(milestones.out).toContain("a milestone year in the next 366 days.");
    expect(milestones.out).not.toMatch(/ \d+ years? +\n/);
    expect(milestones.out).not.toContain("more rows not shown");
    expectBrandSafe(wide.out + milestones.out, "wide");
  });

  it("says so when nothing is coming up", async () => {
    const zip = writeSyntheticZip(tempDir("anniv-none"), "a.zip");
    const { code, out } = await runInsight(anniversariesCommand, [zip, "--days", "0"]);
    expect(code).toBe(0);
    expect(out).toContain("No friendship anniversaries today.");
    expect(out).not.toContain("Coming up");
    expect(out).not.toContain("Notes");
    const milestones = await runInsight(anniversariesCommand, [zip, "--days", "0", "--milestones"]);
    expect(milestones.out).toContain("No milestone anniversaries today.");
  });

  it("reads a three-part export", async () => {
    const dir = tempDir("anniv-parts");
    writeSyntheticParts(dir);
    const { code, out } = await runInsight(anniversariesCommand, [dir, "--days", "90"]);
    expect(code).toBe(0);
    expect(out).toContain("in the next 90 days.");
    expect(out).toContain("Coming up");
  });

  it("adds the short code to each note with --verbose", async () => {
    const zip = writeSyntheticZip(tempDir("anniv-verbose"), "a.zip");
    const { out } = await runInsight(anniversariesCommand, [zip, "--verbose"]);
    expect(out).toContain("code: export-date-caveat");
  });

  it("prints JSON with every row, whatever --limit says", async () => {
    const zip = writeSyntheticZip(tempDir("anniv-json"), "a.zip");
    const { code, out } = await runInsight(anniversariesCommand, [zip, "--json", "--days", "366", "--limit", "2"]);
    expect(code).toBe(0);
    const json = JSON.parse(out) as Result & { generatedAt: string };
    expect(json.generatedAt).toBe(new Date(NOW).toISOString());
    expect(Object.keys(json)).toEqual(["generatedAt", "windowDays", "upcoming", "milestones", "counts", "notes"]);
    expect(json.windowDays).toBe(366);
    expect(json.upcoming.length).toBe(json.counts.upcoming);
    expect(json.upcoming.length).toBeGreaterThan(2);
    expect(Object.keys(json.upcoming[0] ?? {})).toEqual(["username", "years", "on", "daysUntil", "milestone", "leapDayShifted"]);
    // Notes hold codes and counts, never a name.
    expect(JSON.stringify(json.notes)).not.toMatch(USERNAME);
  });

  it("stops with exit 2 on a damaged export and lists no friend", async () => {
    const dir = tempDir("anniv-damaged");
    const full = syntheticExportZip({ now: LATER, friendCount: 40, memoryCount: 20 });
    const damaged = join(dir, "damaged.zip");
    writeFileSync(damaged, full.subarray(0, Math.floor(full.length * 0.6)));
    const { code, out, err } = await runInsight(anniversariesCommand, [damaged]);
    expect(code).toBe(2);
    expect(err).toBe("");
    expect(out).toContain("Error    Snappy could not read this file as a ZIP file.");
    expect(out).toContain("Snappy stopped, since a broken export can give wrong dates.");
    expect(out).not.toContain("Coming up");
    expect(out).not.toMatch(USERNAME);
    expectBrandSafe(out, "damaged");
    const json = await runInsight(anniversariesCommand, [damaged, "--json"]);
    expect(json.code).toBe(2);
    expect(JSON.parse(json.out)).toMatchObject({ stopped: "export-errors" });
  });

  it("uses no color with --no-color or NO_COLOR, and color on a color terminal", async () => {
    const zip = writeSyntheticZip(tempDir("anniv-color"), "a.zip");
    const color = await runInsight(anniversariesCommand, [zip], makeIo({ interactive: true, env: { COLORTERM: "truecolor" } }));
    expect(color.out).toContain("\x1b[");
    const flagged = await runInsight(anniversariesCommand, [zip, "--no-color"], makeIo({ interactive: true, env: { COLORTERM: "truecolor" } }));
    expect(flagged.out).not.toContain("\x1b");
    const env = await runInsight(anniversariesCommand, [zip], makeIo({ interactive: true, env: { NO_COLOR: "1" } }));
    expect(env.out).not.toContain("\x1b");
  });

  it("writes no file, reads no ledger and asks for no passphrase", async () => {
    const home = tempDir("anniv-home");
    const dir = tempDir("anniv-ro");
    writeSyntheticParts(dir);
    const before = readdirSync(dir).sort();
    const io = makeIo({ home });
    await runInsight(anniversariesCommand, [dir, "--days", "366"], io);
    await runInsight(anniversariesCommand, [dir, "--json"], io);
    expect(io.asked).toEqual([]);
    expect(readdirSync(home)).toEqual([]);
    expect(readdirSync(dir).sort()).toEqual(before);
  });

  it("does not accept the ledger or output options", async () => {
    const zip = writeSyntheticZip(tempDir("anniv-flags"), "a.zip");
    for (const flag of ["--ledger", "--out", "--no-save", "--passphrase-file"]) {
      const r = await runInsight(anniversariesCommand, [zip, flag, "x"]);
      expect(r.code, flag).toBe(1);
      expect(r.err, flag).toContain(`Snappy does not know the option ${flag} for anniversaries.`);
    }
  });

  it("stops with calm messages for a missing path, no input, a wrong file and bad options", async () => {
    const dir = tempDir("anniv-errors");
    const missing = await runInsight(anniversariesCommand, [join(dir, "missing.zip")]);
    expect(missing).toMatchObject({ code: 1, out: "" });
    expect(missing.err).toContain("could not find");
    expect((await runInsight(anniversariesCommand, [])).err).toContain("Give Snappy your export");
    const notZip = join(dir, "notes.txt");
    writeFileSync(notZip, "not a zip file");
    const wrong = await runInsight(anniversariesCommand, [notZip]);
    expect(wrong.code).toBe(1);
    expect(wrong.out).toBe("");
    expect(wrong.err.length).toBeGreaterThan(0);
    const zip = writeSyntheticZip(dir, "a.zip");
    expect((await runInsight(anniversariesCommand, [zip, "--days", "x"])).err).toContain("--days must be a whole number from 0 to 366.");
    expect((await runInsight(anniversariesCommand, [zip, "--days", "400"])).err).toContain("--days must be a whole number from 0 to 366.");
    expect((await runInsight(anniversariesCommand, [zip, "--limit", "0"])).err).toContain("--limit must be a whole number");
    expect((await runInsight(anniversariesCommand, [zip, "--days"])).err).toContain("The option --days needs a value.");
    expect((await runInsight(anniversariesCommand, [zip, "--bogus"])).err).toContain(
      'Snappy does not know the option --bogus for anniversaries. Run "snappy-export help anniversaries"',
    );
  });

  it("checks the options before reading anything", async () => {
    const dir = tempDir("anniv-early");
    const r = await runInsight(anniversariesCommand, [join(dir, "missing.zip"), "--days", "x"]);
    expect(r.err).toContain("--days must be a whole number");
    expect(r.err).not.toContain("could not find");
  });
});

describe("privacy", () => {
  it("prints usernames only in the result table, and nothing else from the export", async () => {
    const dir = tempDir("anniv-canary");
    const zip = writeSyntheticZip(dir, "export.zip", { bundleMedia: true });
    const parts = join(dir, "parts");
    writeSyntheticParts(parts, { memoryCount: 200 });
    const runs = [[zip], [zip, "--json"], [parts, "--days", "366", "--verbose"], [zip, "--milestones", "--days", "200"], [parts, "--json", "--verbose"]];
    for (const args of runs) {
      const { out, err } = await runInsight(anniversariesCommand, args);
      const text = stripPaths(out + err);
      const label = args.join(" ");
      expectNoLeaks(text, label);
      expect(text, label).not.toMatch(/\.(?:jpg|mp4|png|html|json)\b|[0-9A-F]{8}-[0-9A-F]{4}/i);
      if (!args.includes("--json")) {
        // Outside the table (the lines before "Coming up" and after the table) no name may appear.
        const notes = text.slice(text.indexOf("Notes"));
        expect(notes, label).not.toMatch(USERNAME);
        expect(err, label).toBe("");
      }
    }
  });

  it("prints no username in any error path", async () => {
    const dir = tempDir("anniv-errpaths");
    const zip = writeSyntheticZip(dir, "export.zip");
    const damaged = join(dir, "damaged.zip");
    writeFileSync(damaged, syntheticExportZip({ now: LATER, friendCount: 40, memoryCount: 20 }).subarray(0, 900));
    for (const args of [[], [join(dir, "missing.zip")], [zip, "--days", "x"], [zip, "--bogus"], [damaged], [damaged, "--verbose"], [join(dir, "export.zip", "x")]]) {
      const { out, err } = await runInsight(anniversariesCommand, args);
      expect(stripPaths(out + err), args.join(" ")).not.toMatch(USERNAME);
      expectNoLeaks(out + err, args.join(" "));
    }
  });
});

/** A hand-built result with `n` upcoming rows, every note, and a leap day row. */
function resultOf(n: number): Result {
  const upcoming = Array.from({ length: n }, (_, i) => ({
    username: `friend_${i + 1}`,
    years: (i % 6) + 1,
    on: "2026-11-10",
    daysUntil: i,
    milestone: i % 2 === 0,
    leapDayShifted: i < 2,
  }));
  const notes = (["export-date-caveat", "created-at-missing", "created-at-future", "duplicate-usernames", "invalid-username", "now-invalid", "a-code-from-the-future"] as const).map(
    (code) => ({ code: code as insights.anniversaries.AnniversaryNoteCode, params: { count: n } }),
  );
  return {
    windowDays: 30,
    upcoming,
    milestones: upcoming.filter((r) => r.milestone),
    counts: { friends: n, dated: n, missingDate: n, futureDate: n, duplicatesMerged: n, invalidUsername: n, upcoming: n, milestones: upcoming.filter((r) => r.milestone).length },
    notes,
  };
}

describe("wording", () => {
  it.each([0, 1, 2, 12])("reads correctly with a count of %i", (n) => {
    const text = renderAnniversaries(resultOf(n), term, false);
    expectBrandSafe(text, `count ${n}`);
    expect(text).toContain("Snappy noted something it cannot describe.");
    expect(text).not.toContain("a-code-from-the-future");
    expect(text.endsWith("Nothing here has left this device.\n")).toBe(true);
    if (n === 0) expect(text).toContain("No friendship anniversaries in the next 30 days.");
  });

  it("says one friendship, not 1 friendships, and agrees the verb", () => {
    const one = renderAnniversaries(resultOf(1), term, false);
    expect(one).toContain("1 friendship reaches a whole year in the next 30 days.");
    expect(one).toContain("1 friend has no date and is left out.");
    expect(one).toContain("1 date is in the future. Snappy leaves it out.");
    expect(one).toContain("1 entry had no username and was left out.");
    expect(one).toContain("today");
    const two = renderAnniversaries(resultOf(2), term, false);
    expect(two).toContain("2 friendships reach a whole year in the next 30 days.");
    expect(two).toContain("2 friends have no date and are left out.");
    expect(two).toContain("2 dates are in the future. Snappy leaves them out.");
    expect(two).toContain("2 entries had no username and were left out.");
    expect(two).toContain("1 day");
    expect(two).toContain("Milestone, shown on Feb 28");
    expect(two).toContain("Shown on Feb 28");
  });

  it("describes the window and the row cap", () => {
    expect(renderAnniversaries({ ...resultOf(0), windowDays: 0 }, term, false)).toContain("No friendship anniversaries today.");
    expect(renderAnniversaries({ ...resultOf(0), windowDays: 1 }, term, false)).toContain("No friendship anniversaries today or tomorrow.");
    const capped = renderAnniversaries(resultOf(12), term, false, { limit: 5 });
    expect(capped).toContain("7 more rows not shown. Use --limit to see more.");
    expect(capped).toContain("friend_5");
    expect(capped).not.toContain("friend_6");
    expect(renderAnniversaries(resultOf(6), term, false, { limit: 5 })).toContain("1 more row not shown.");
    expect(renderAnniversaries(resultOf(12), term, false, { milestonesOnly: true })).toContain("6 friendships reach a milestone year");
  });

  it("keeps every sentence short and in sentence case", () => {
    const text = renderAnniversaries(resultOf(2), term, true);
    const prose = text
      .split("\n")
      .map((line) => line.replace(/^\s*(?:Warning|Note|Error)\s+/, "").trim())
      .filter((line) => /[.?]$/.test(line) && !/\s{2,}/.test(line));
    expect(prose.length).toBeGreaterThan(5);
    for (const s of prose.flatMap((line) => line.split(/(?<=[.?])\s+/))) expect(s.split(/\s+/).length, s).toBeLessThanOrEqual(20);
    expect(text).not.toMatch(/\b(?:ghosts?|unfriend\w*|dormant|inactive|dead|simply|just)\b/i);
  });
});
