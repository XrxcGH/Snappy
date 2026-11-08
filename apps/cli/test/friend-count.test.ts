/** snappy-export friend-count: the friend count over time. Synthetic data only. */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { insights, syntheticExportZip } from "@snappy-export/core";
import { friendCountCommand, monthText, renderFriendCount } from "../src/commands/friend-count.ts";
import type { FriendCountReport } from "../src/commands/friend-count.ts";
import { createTerm } from "../src/term.ts";
import { LATER, NOW, makeIo, run, stripPaths, tempDir, writeDemoPair, writeSyntheticParts, writeSyntheticZip } from "./helpers.ts";
import { expectBrandSafe, expectNoLeaks, expectValidDescriptor, runInsight } from "./insights-helpers.ts";

const term = createTerm({ env: {}, isTTY: false, columns: 100 });
const USERNAME = /\b(?:ghost|oneway|dormant|active|newfriend|friend|user)_\d+\b/;
const PASS = "friend-count-test-passphrase";

/** A sealed ledger with two saved exports, made by analyze the way a person would. */
type LedgerFixture = { ledger: string; later: string; dir: string };
let fixture: Promise<LedgerFixture> | undefined;
/** Built once: it is only read by the tests, and sealing is slow on purpose. */
function makeLedger(): Promise<LedgerFixture> {
  fixture ??= buildLedger();
  return fixture;
}

async function buildLedger(): Promise<LedgerFixture> {
  const dir = tempDir("fc-ledger");
  const { earlier, later } = writeDemoPair(dir);
  const ledger = join(dir, "ledger.sealed");
  const env = { SNAPPY_PASSPHRASE: PASS };
  expect((await run(["analyze", earlier, "--ledger", ledger], makeIo({ env }))).code).toBe(0);
  expect((await run(["analyze", later, "--ledger", ledger], makeIo({ env }))).code).toBe(0);
  return { ledger, later, dir };
}

/** A hand-built result with the given number of months (the last one is the partial month). */
function report(n: number, extra: Partial<FriendCountReport> = {}): FriendCountReport {
  const months = Array.from({ length: n }, (_, i) => ({
    month: `${2020 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`,
    joined: i % 3,
    left: i % 2,
    net: (i % 3) - (i % 2),
    count: 10 + i,
    snapshotCount: null,
    partial: i === n - 1,
  }));
  return {
    months,
    best: n > 1 ? { month: "2020-01", net: 2 } : null,
    worst: n > 1 ? { month: "2020-02", net: -1 } : null,
    totals: { joined: n, left: n > 1 ? 1 : 0, net: n - 1, startingCount: 0, currentCount: n === 0 ? null : 10 + n - 1 },
    comparisons: [],
    notes: [],
    ledger: "none",
    exportHasErrors: false,
    ...extra,
  };
}

describe("the command", () => {
  it("is a valid descriptor", async () => {
    await expectValidDescriptor(friendCountCommand);
    expect(friendCountCommand.name).toBe("friend-count");
    expect(friendCountCommand.group).toBe("Friends");
  });

  it("prints the curve from a synthetic export without a ledger, and exits 0", async () => {
    const dir = tempDir("fc-parts");
    writeSyntheticParts(dir);
    const io = makeIo({ home: tempDir("fc-home") });
    const { code, out, err } = await runInsight(friendCountCommand, [dir, "--no-save"], io);
    expect(code).toBe(0);
    expect(err).toBe("");
    expect(out).toContain("Friend count over time");
    expect(out).toContain("Summary");
    expect(out).toContain("Your friends list holds");
    expect(out).toContain("Month by month");
    expect(out).toContain("(so far)");
    expect(out).toContain("Your saved history was skipped, as you asked.");
    expect(out.endsWith("Nothing here has left this device.\n")).toBe(true);
    expect(io.asked).toEqual([]);
    expectBrandSafe(out, "friend-count");
  });

  it("says no saved history was compared when no ledger exists, and asks for no passphrase", async () => {
    const zip = writeSyntheticZip(tempDir("fc-one"), "a.zip");
    const home = tempDir("fc-fresh-home");
    const io = makeIo({ home });
    const { code, out } = await runInsight(friendCountCommand, [zip], io);
    expect(code).toBe(0);
    expect(out).toContain("No saved history was compared. Run analyze to start one.");
    expect(io.asked).toEqual([]);
    expect(readdirSync(home)).toEqual([]);
  });

  it("prints JSON with codes and counts only", async () => {
    const zip = writeSyntheticZip(tempDir("fc-json"), "a.zip");
    const { code, out } = await runInsight(friendCountCommand, [zip, "--json", "--no-save"]);
    expect(code).toBe(0);
    const json = JSON.parse(out) as FriendCountReport & { generatedAt: string };
    expect(json.generatedAt).toBe(new Date(NOW).toISOString());
    expect(json.ledger).toBe("skipped");
    expect(json.exportHasErrors).toBe(false);
    expect(Object.keys(json)).toEqual(["generatedAt", "months", "best", "worst", "totals", "comparisons", "notes", "ledger", "exportHasErrors"]);
    expect(json.notes.map((n) => n.code)).toContain("no-snapshots");
    expect(json.months.at(-1)?.partial).toBe(true);
    expect(stripPaths(out)).not.toMatch(USERNAME);
  });

  it("limits the months with --months and prints all of them with 0", async () => {
    const zip = writeSyntheticZip(tempDir("fc-months"), "a.zip");
    const full = JSON.parse((await runInsight(friendCountCommand, [zip, "--json", "--no-save"])).out) as FriendCountReport;
    const total = full.months.length;
    expect(total).toBeGreaterThan(3);
    const two = await runInsight(friendCountCommand, [zip, "--months", "2", "--no-save"]);
    expect(two.out).toContain(`Showing the latest 2 months of ${total}. Use --months 0 for all.`);
    const all = await runInsight(friendCountCommand, [zip, "--months", "0", "--no-save"]);
    expect(all.out).not.toContain("Showing the latest");
    expect(all.out).toContain(monthText(full.months[0]!.month));
  });

  it("exits 2 and says so when the export has errors", async () => {
    const dir = tempDir("fc-damaged");
    const full = syntheticExportZip({ now: LATER, friendCount: 40, memoryCount: 20 });
    const damaged = join(dir, "damaged.zip");
    writeFileSync(damaged, full.subarray(0, Math.floor(full.length * 0.6)));
    const { code, out, err } = await runInsight(friendCountCommand, [damaged, "--no-save"]);
    expect(code).toBe(2);
    expect(err).toBe("");
    expect(out).toContain("Your export has errors, so the curve may be off. Run check for details.");
    expectBrandSafe(out, "damaged");
  });

  it("uses no color with --no-color, and color on a color terminal", async () => {
    const zip = writeSyntheticZip(tempDir("fc-color"), "a.zip");
    const color = await runInsight(friendCountCommand, [zip, "--no-save"], makeIo({ interactive: true, env: { COLORTERM: "truecolor" } }));
    expect(color.out).toContain("\x1b[");
    const flagged = await runInsight(friendCountCommand, [zip, "--no-save", "--no-color"], makeIo({ interactive: true, env: { COLORTERM: "truecolor" } }));
    expect(flagged.out).not.toContain("\x1b");
  });
});

describe("the sealed ledger", () => {
  it("compares the curve with saved snapshots, reads the ledger only, and asks for the passphrase once", async () => {
    const { ledger, later, dir } = await makeLedger();
    const before = readFileSync(ledger);
    const files = readdirSync(dir).sort();
    const io = makeIo({ env: { SNAPPY_PASSPHRASE: PASS }, home: tempDir("fc-home2") });
    const { code, out, err } = await runInsight(friendCountCommand, [later, "--ledger", ledger], io);
    expect(code).toBe(0);
    expect(err).toBe("");
    expect(out).toContain("Against your saved history");
    expect(out).toContain("Saved on");
    expect(out).toMatch(/Close|Differs/);
    expect(out).not.toContain("No saved history was compared");
    expect(readFileSync(ledger).equals(before)).toBe(true);
    expect(readdirSync(dir).sort()).toEqual(files);
    expectBrandSafe(out, "ledger");
    expectNoLeaks(out, "ledger");
    expect(stripPaths(out)).not.toMatch(USERNAME);

    const json = JSON.parse((await runInsight(friendCountCommand, [later, "--ledger", ledger, "--json"], makeIo({ env: { SNAPPY_PASSPHRASE: PASS } }))).out) as FriendCountReport;
    expect(json.ledger).toBe("read");
    expect(json.comparisons.length).toBeGreaterThan(0);
  });

  it("asks for the passphrase from the prompt when none is set, and takes a passphrase file", async () => {
    const { ledger, later, dir } = await makeLedger();
    const prompted = makeIo({ answers: [PASS] });
    expect((await runInsight(friendCountCommand, [later, "--ledger", ledger], prompted)).code).toBe(0);
    expect(prompted.asked.length).toBe(1);
    const file = join(dir, "pass.txt");
    writeFileSync(file, `${PASS}\n`);
    const filed = makeIo();
    expect((await runInsight(friendCountCommand, [later, "--ledger", ledger, "--passphrase-file", file], filed)).code).toBe(0);
    expect(filed.asked).toEqual([]);
  });

  it("skips the ledger with --no-save: no passphrase asked, no snapshot compared", async () => {
    const { ledger, later } = await makeLedger();
    const io = makeIo({ env: { SNAPPY_PASSPHRASE: "not the passphrase" } });
    const { code, out } = await runInsight(friendCountCommand, [later, "--ledger", ledger, "--no-save"], io);
    expect(code).toBe(0);
    expect(io.asked).toEqual([]);
    expect(out).not.toContain("Against your saved history");
    expect(out).toContain("Your saved history was skipped, as you asked.");
  });

  it("refuses a wrong passphrase calmly and leaves the ledger as it was", async () => {
    const { ledger, later } = await makeLedger();
    const before = readFileSync(ledger);
    const result = await runInsight(friendCountCommand, [later, "--ledger", ledger, "--verbose"], makeIo({ env: { SNAPPY_PASSPHRASE: "not the passphrase" } }));
    expect(result.code).toBe(1);
    expect(result.out).toBe("");
    expect(result.err).toContain("passphrase");
    expectNoLeaks(result.err, "wrong passphrase");
    expect(readFileSync(ledger).equals(before)).toBe(true);
  });
});

describe("errors", () => {
  it("stops with calm messages for a missing path, no input, a bad option and a bad value", async () => {
    const dir = tempDir("fc-errors");
    const missing = await runInsight(friendCountCommand, [join(dir, "missing.zip")]);
    expect(missing).toMatchObject({ code: 1, out: "" });
    expect(missing.err).toContain("could not find");
    expect((await runInsight(friendCountCommand, [])).err).toContain("Give Snappy your export");
    const zip = writeSyntheticZip(dir, "a.zip");
    expect((await runInsight(friendCountCommand, [zip, "--months", "x"])).err).toContain("--months must be a whole number");
    expect((await runInsight(friendCountCommand, [zip, "--months=-3"])).err).toContain("--months must be a whole number");
    expect((await runInsight(friendCountCommand, [zip, "--months"])).code).toBe(1);
    expect((await runInsight(friendCountCommand, [zip, "--bogus"])).err).toContain('Snappy does not know the option --bogus for friend-count. Run "snappy-export help friend-count"');
  });

  it("rejects a file that is not a ZIP file, and reads no ledger when it does", async () => {
    const dir = tempDir("fc-notzip");
    const text = join(dir, "notes.txt");
    writeFileSync(text, "hello");
    const io = makeIo({ env: { SNAPPY_PASSPHRASE: PASS } });
    const result = await runInsight(friendCountCommand, [text], io);
    expect(result.code).toBe(1);
    expect(result.out).toBe("");
    expect(io.asked).toEqual([]);
  });

  it("checks the option value before it reads anything", async () => {
    const io = makeIo();
    const result = await runInsight(friendCountCommand, [join(tempDir("fc-early"), "missing.zip"), "--months", "x"], io);
    expect(result.err).toContain("--months must be a whole number");
  });
});

describe("privacy", () => {
  it("prints no canary, link, entry name or username, in text, JSON, verbose or errors", async () => {
    const dir = tempDir("fc-canary");
    const zip = writeSyntheticZip(dir, "export.zip", { bundleMedia: true });
    const parts = join(dir, "parts");
    writeSyntheticParts(parts, { memoryCount: 200 });
    const { ledger, later } = await makeLedger();
    const env = { SNAPPY_PASSPHRASE: PASS };
    const cases: [string[], Record<string, string>][] = [
      [[zip, "--no-save"], {}],
      [[zip, "--json", "--no-save"], {}],
      [[parts, "--months", "0", "--verbose", "--no-save"], {}],
      [[parts, "--json", "--verbose", "--no-save"], {}],
      [[later, "--ledger", ledger, "--verbose"], env],
      [[later, "--ledger", ledger, "--json"], env],
      [[later, "--ledger", ledger, "--verbose"], { SNAPPY_PASSPHRASE: "not the passphrase" }],
      [[join(dir, "missing.zip")], {}],
      [[zip, "--months", "x"], {}],
      [[zip, "--bogus"], {}],
      [[], {}],
    ];
    for (const [args, e] of cases) {
      const { out, err } = await runInsight(friendCountCommand, args, makeIo({ env: e }));
      const text = stripPaths(out + err);
      const label = args.join(" ");
      expectNoLeaks(text, label);
      expect(text, label).not.toMatch(USERNAME);
      expect(text, label).not.toMatch(/\.(?:jpg|mp4|png|html|json)\b|[0-9A-F]{8}-[0-9A-F]{4}/i);
    }
  });

  it("writes no file", async () => {
    const home = tempDir("fc-home3");
    const dir = tempDir("fc-ro");
    writeSyntheticParts(dir);
    const before = readdirSync(dir).sort();
    await runInsight(friendCountCommand, [dir], makeIo({ home }));
    await runInsight(friendCountCommand, [dir, "--no-save", "--json"], makeIo({ home }));
    expect(readdirSync(home)).toEqual([]);
    expect(readdirSync(dir).sort()).toEqual(before);
  });
});

/** Every note the core can give, so each sentence is read at each count. */
function fullNotes(n: number): FriendCountReport["notes"] {
  const codes: insights.friendCountHistory.FriendCountNoteCode[] = [
    "no-dated-friendships", "curve-may-run-high", "undated-joins", "undated-leaves", "unusable-dates-ignored", "leave-before-join",
    "re-added-friends", "snapshots-ignored", "no-snapshots", "single-snapshot", "sources-agree", "sources-disagree",
  ];
  return [
    ...codes.map((code) => ({ code, params: { count: n, compared: n, disagreeing: n, largestGap: n } })),
    { code: "a-code-from-the-future" as insights.friendCountHistory.FriendCountNoteCode, params: {} },
  ];
}

describe("wording", () => {
  it.each([0, 1, 2, 12])("reads correctly with a count of %i", (n) => {
    const comparisons = Array.from({ length: n }, (_, i) => ({ takenAt: NOW - i * 86_400_000, snapshotCount: 20 + i, curveCount: 20, gap: i, disagrees: i > 3 }));
    for (const ledger of ["none", "skipped", "read"] as const) {
      const text = renderFriendCount(report(n, { notes: fullNotes(n), comparisons, ledger, exportHasErrors: true }), term, false);
      expectBrandSafe(text, `count ${n} ${ledger}`);
      expect(text).not.toContain("a-code-from-the-future");
      expect(text).toContain("Snappy noted something it cannot describe.");
      expect(text).toContain("Run it with --verbose and share the code.");
    }
  });

  it("handles an export with no dated friendships and with one month", () => {
    const none = renderFriendCount(report(0, { notes: [{ code: "no-dated-friendships", params: {} }] }), term, false);
    expect(none).toContain("No friendship in your export has a usable date, so Snappy cannot draw a curve.");
    expect(none).not.toContain("Month by month");
    expect(none).not.toContain("Summary");
    const one = renderFriendCount(report(1), term, false);
    expect(one).toContain("Your friends list holds 10 friends.");
    expect(one).toContain("1 friend added and 0 removed by you.");
    expect(one).not.toContain("Biggest gain");
    expect(one).not.toContain("Biggest drop");
  });

  it("says one, not 1 friends, in the notes and the summary", () => {
    const text = renderFriendCount(report(1, { totals: { joined: 1, left: 0, net: 1, startingCount: 0, currentCount: 1 }, notes: fullNotes(1) }), term, false);
    expect(text).toContain("Your friends list holds 1 friend.");
    expect(text).toContain("1 friend has no start date. Snappy counts that friend from the first month.");
    expect(text).toContain("1 removed friend has no removal date, so Snappy leaves that friend out.");
    expect(text).toContain("1 date is in the future or too old to be real. Snappy ignores it.");
    expect(text).toContain("1 saved snapshot had a missing or odd date. Snappy ignored it.");
    expect(text).toContain("agree at 1 point.");
    const many = renderFriendCount(report(3, { notes: fullNotes(2) }), term, false);
    expect(many).toContain("2 friends have no start date. Snappy counts them from the first month.");
    expect(many).toContain("2 dates are in the future or too old to be real. Snappy ignores them.");
    expect(many).toContain("differ at 2 of 2 points. The largest gap is 2 friends.");
  });

  it("caps the months and the comparisons, and shows the Saved column only when there are snapshots", () => {
    const big = report(60);
    const capped = renderFriendCount(big, term, false);
    expect(capped).toContain("Showing the latest 24 months of 60. Use --months 0 for all.");
    expect(capped).not.toContain("Saved  ");
    const all = renderFriendCount(big, term, false, { months: 0 });
    expect(all).not.toContain("Showing the latest");
    const withSaved = report(3, { months: report(3).months.map((m, i) => ({ ...m, snapshotCount: i === 1 ? 11 : null })) });
    expect(renderFriendCount(withSaved, term, false)).toContain("Saved");
    const comparisons = Array.from({ length: 20 }, (_, i) => ({ takenAt: NOW - i * 86_400_000, snapshotCount: 20, curveCount: 20, gap: 0, disagrees: false }));
    const many = renderFriendCount(report(3, { comparisons, ledger: "read" }), term, false);
    expect(many).toContain("Showing the latest 12 of 20.");
  });

  it("adds the short code to each note with verbose, and not otherwise", () => {
    const r = report(3, { notes: [{ code: "curve-may-run-high", params: {} }] });
    expect(renderFriendCount(r, term, false)).not.toContain("code:");
    expect(renderFriendCount(r, term, true)).toContain("code: curve-may-run-high");
  });

  it("hedges the note about friends who are missing from the curve", () => {
    const text = renderFriendCount(report(3, { notes: [{ code: "curve-may-run-high", params: {} }] }), term, false).replace(/\s+/g, " ");
    expect(text).toContain("Friends who left your list on their own are not on the curve, so earlier months may run high.");
    expect(text).not.toContain("People who removed you");
  });

  it("names months in sentence case, with a plain sign on the net change", () => {
    expect(monthText("2026-03")).toBe("Mar 2026");
    expect(monthText("0999-12")).toBe("Dec 999");
    const text = renderFriendCount(report(3), term, false);
    expect(text).toMatch(/Jan 2020 +0 +0 +0 +10/);
    expect(text).toMatch(/Feb 2020 +1 +1 +0 +11/);
    expect(text).toMatch(/Mar 2020 \(so far\) +2 +0 +\+2 +12/);
  });

  it("keeps every sentence short", () => {
    const text = renderFriendCount(report(3, { notes: fullNotes(2), exportHasErrors: true }), term, false);
    const prose = text
      .split("\n")
      .map((line) => line.replace(/^\s*(?:Warning|Note|Error)\s+/, "").trim())
      .filter((line) => /[.?]$/.test(line) && !/\s{2,}/.test(line));
    expect(prose.length).toBeGreaterThan(8);
    for (const s of prose.flatMap((line) => line.split(/(?<=[.?])\s+/))) expect(s.split(/\s+/).length, s).toBeLessThanOrEqual(20);
    expect(text).not.toMatch(/\b(?:ghosts?|unfriend\w*|dormant|inactive|dead|simply|just)\b/i);
  });
});
