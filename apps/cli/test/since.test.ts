/** snappy-export since: what changed since the last export. Synthetic data only, with invented names. */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { syntheticExportZip } from "@snappy-export/core";
import type { Snapshot } from "@snappy-export/core";
import { choosePrevious, peopleByChange, personRows, renderSince, sinceCommand, sinceToCsv } from "../src/commands/since.ts";
import type { SinceReport } from "../src/commands/since.ts";
import { createTerm } from "../src/term.ts";
import { LATER, NOW, makeIo, run, stripPaths, tempDir, writeDemoPair, writeSyntheticParts } from "./helpers.ts";
import { expectBrandSafe, expectNoLeaks, expectValidDescriptor, runInsight } from "./insights-helpers.ts";

const term = createTerm({ env: {}, isTTY: false, columns: 100 });
const PASS = "since-test-passphrase";
const DAY = 86_400_000;
/** Names the synthetic generator invents. */
const USERNAME = /\b(?:ghost|oneway|dormant|active|newfriend|removed|friend|user)_\d+\b/;
/** Wrapped note lines joined back into one line. */
const flat = (text: string): string => text.replace(/\n {10,}/g, " ");
/** The notes block alone: nothing in it may name anyone. */
const notesOf = (text: string): string => text.split("\nNotes\n")[1] ?? "";

type Fixture = { ledger: string; earlier: string; later: string; dir: string };
let fixture: Promise<Fixture> | undefined;
/** Built once: sealing the ledger is slow on purpose. Two real analyze runs, the way a person would make one. */
function makeLedger(): Promise<Fixture> {
  fixture ??= (async () => {
    const dir = tempDir("since-ledger");
    const { earlier, later } = writeDemoPair(dir);
    const ledger = join(dir, "ledger.sealed");
    const env = { SNAPPY_PASSPHRASE: PASS };
    expect((await run(["analyze", earlier, "--ledger", ledger], makeIo({ env }))).code).toBe(0);
    expect((await run(["analyze", later, "--ledger", ledger], makeIo({ env }))).code).toBe(0);
    return { ledger, earlier, later, dir };
  })();
  return fixture;
}

// ---------------------------------------------------------------- hand-made inputs ---

const person = (username: string, at?: number) => ({ username, ...(at === undefined ? {} : { at }) });

function snap(id: string, takenAt: number, friends: string[] = []): Snapshot {
  return { id, takenAt, source: "export", friends, sentRequests: [], deleted: {}, friendSince: {}, sentAt: {} };
}

/** A result with every list filled by `n` invented people, for the wording and the limits. */
function report(n: number, extra: Partial<SinceReport> = {}): SinceReport {
  const list = (prefix: string) => Array.from({ length: n }, (_, i) => ({ username: `${prefix}_${i + 1}`, at: i % 2 === 0 ? LATER - i * DAY : null }));
  return {
    comparable: true,
    previousAt: LATER - 30 * DAY,
    currentAt: LATER,
    daysBetween: 30,
    friends: { previousCount: 10, currentCount: 10 + n, net: n, added: list("nf"), disappeared: list("gone"), removedByYou: list("rm"), blockedByYou: list("bl") },
    requests: { accepted: list("acc"), stillPending: list("pend"), vanished: list("van") },
    memories: { total: 40, newCount: n, totalChange: null },
    activity: { since: { sent: 5, received: 6, unknown: 1 }, earlier: { sent: 2, received: 9, unknown: 0 }, change: { sent: 3, received: -3 } },
    counts: { added: n, disappeared: n, removedByYou: n, requestsAccepted: n, requestsPending: n, newMemories: n },
    notes: [],
    source: "ledger",
    dateGuessed: false,
    ...extra,
  };
}

function allNotes(n: number): SinceReport["notes"] {
  const codes = [
    "no-previous-export", "unusable-snapshot-time", "order-swapped", "same-time", "same-day", "long-gap", "snapshot-time-in-future", "friends-may-have-left",
    "possible-partial-export", "blocked-excluded", "requests-may-be-declined", "no-activity-data", "earlier-period-not-covered", "unusable-times-ignored",
    "no-memories-data", "memories-dates-unusable",
  ] as const;
  return [
    ...codes.map((code) => ({ code, params: { count: n, days: n, previous: n + 5, undated: n, future: 0 } })),
    { code: "a-code-from-the-future" as SinceReport["notes"][number]["code"], params: {} },
  ];
}

// ----------------------------------------------------------------------- the command ---

describe("the command", () => {
  it("is a valid descriptor in the Your export group", async () => {
    await expectValidDescriptor(sinceCommand);
    expect(sinceCommand.name).toBe("since");
    expect(sinceCommand.group).toBe("Your export");
    expect(sinceCommand.synopsis).toBe("since <ZIP files...>");
    expect(sinceCommand.summary).toBe("See what changed since your last export.");
  });

  it("documents every option it accepts", () => {
    for (const flag of ["--earlier", "--utc-offset", "--limit", "--counts", "--out", "--force", "--no-save", "--history", "--passphrase-file", "--json", "--verbose", "--no-color"]) {
      expect(sinceCommand.usage, flag).toContain(flag);
    }
    for (const line of sinceCommand.usage.split("\n")) expect(line.length, line).toBeLessThanOrEqual(100);
  });

  it("compares with the sealed ledger, reads it only, and asks for the passphrase once", async () => {
    const { ledger, later, dir } = await makeLedger();
    const before = readFileSync(ledger);
    const files = readdirSync(dir).sort();
    const io = makeIo({ env: { SNAPPY_PASSPHRASE: PASS }, home: tempDir("since-home") });
    const { code, out, err } = await runInsight(sinceCommand, [later, "--ledger", ledger], io);
    expect(code).toBe(0);
    expect(err).toBe("");
    const text = flat(out);
    expect(text).toContain("Since your last export");
    expect(text).toContain("Compared Jul 4, 2026 with Nov 1, 2026, 120 days apart.");
    expect(text).toContain("Friends: 43 before, 40 now (down 3).");
    expect(text).toMatch(/New friends +2\n/);
    expect(text).toMatch(/No longer listed +3\n/);
    expect(text).toMatch(/Removed by you +2\n/);
    expect(text).toContain("3 friends are no longer listed. They may have removed you or closed their account.");
    expect(text).toContain("Chats and Snaps");
    expect(text).toContain("Sent: up 61. Received: up 101.");
    expect(text).toContain("20 Memories in this export, 3 captured since your last export.");
    expect(text.endsWith("Nothing here has left this device.\n")).toBe(true);
    expect(readFileSync(ledger).equals(before)).toBe(true);
    expect(readdirSync(dir).sort()).toEqual(files);
    expectBrandSafe(out, "since");
    expectNoLeaks(out, "since");
  });

  it("lists the people in their own tables, with the date that goes with each change", async () => {
    const { later, earlier } = await makeLedger();
    const { out } = await runInsight(sinceCommand, [later, "--earlier", earlier]);
    expect(out).toContain("New friends\n  Username");
    expect(out).toMatch(/newfriend_1 +Aug 1, 2026/);
    expect(out).toMatch(/ghost_1 +Sep 10, 2022/);
    expect(out).toContain("Friends since");
    expect(out).toContain("Removed on");
    expect(out).toContain("Requests still waiting");
    expect(out).toContain("Sent on");
    expect(out).not.toContain("Blocked by you\n  Username");
  });

  it("compares two exports with --earlier, and never opens the ledger or asks for a passphrase", async () => {
    const { later, earlier, ledger } = await makeLedger();
    const io = makeIo({ env: { SNAPPY_PASSPHRASE: "not the passphrase" } });
    const { code, out, err } = await runInsight(sinceCommand, [later, "--earlier", earlier, "--ledger", ledger], io);
    expect(code).toBe(0);
    expect(err).toBe("");
    expect(out).toContain("Compared Jul 4, 2026 with Nov 1, 2026, 120 days apart.");
    expect(io.asked).toEqual([]);
  });

  it("says the earlier export is newer when they are given the wrong way round, and shows no activity or Memories", async () => {
    const { later, earlier } = await makeLedger();
    const { code, out } = await runInsight(sinceCommand, [earlier, "--earlier", later]);
    expect(code).toBe(0);
    const text = flat(out);
    expect(text).toContain("The saved export is newer than this one, so Snappy compared them the other way round. Chats, Snaps and Memories are not shown.");
    expect(text).toContain("Compared Jul 4, 2026 with Nov 1, 2026");
    expect(text).not.toContain("Chats and Snaps\n");
    expect(text).not.toContain("Memories\n  ");
    expect(text).toContain("Warning");
  });

  it("falls back to a newer saved export, and says so, when it is older than every saved one", async () => {
    const { ledger, earlier } = await makeLedger();
    // The ledger holds the earlier export itself (same id), so only the later one is another export.
    const { out } = await runInsight(sinceCommand, [earlier, "--ledger", ledger], makeIo({ env: { SNAPPY_PASSPHRASE: PASS } }));
    expect(flat(out)).toContain("compared them the other way round");
  });

  it("says there is nothing to compare when no ledger exists, with no passphrase asked and no file written", async () => {
    const { later } = await makeLedger();
    const home = tempDir("since-fresh");
    const io = makeIo({ home });
    const { code, out } = await runInsight(sinceCommand, [later], io);
    expect(code).toBe(0);
    expect(out).toContain("No earlier export is saved yet. Run analyze on each export, or use --earlier.");
    expect(out).not.toContain("What changed");
    expect(io.asked).toEqual([]);
    expect(readdirSync(home)).toEqual([]);
  });

  it("skips the ledger with --no-save: no passphrase asked, nothing compared", async () => {
    const { ledger, later } = await makeLedger();
    const io = makeIo({ env: { SNAPPY_PASSPHRASE: "not the passphrase" } });
    const { code, out } = await runInsight(sinceCommand, [later, "--ledger", ledger, "--no-save"], io);
    expect(code).toBe(0);
    expect(io.asked).toEqual([]);
    expect(flat(out)).toContain("Your saved history was skipped, as you asked, so there is nothing to compare.");
    expect(out).not.toContain("What changed");
  });

  it("says the saved history holds no earlier export when the ledger only has this one", async () => {
    const dir = tempDir("since-single");
    const { later } = writeDemoPair(dir);
    const ledger = join(dir, "single.sealed");
    const env = { SNAPPY_PASSPHRASE: PASS };
    expect((await run(["analyze", later, "--ledger", ledger], makeIo({ env }))).code).toBe(0);
    const { out } = await runInsight(sinceCommand, [later, "--ledger", ledger], makeIo({ env }));
    expect(flat(out)).toContain("Your saved history holds no earlier export, so there is nothing to compare.");
  });

  it("takes a passphrase file, and refuses a wrong passphrase calmly", async () => {
    const { ledger, later, dir } = await makeLedger();
    const file = join(dir, "pass.txt");
    writeFileSync(file, `${PASS}\n`);
    const filed = makeIo();
    expect((await runInsight(sinceCommand, [later, "--ledger", ledger, "--passphrase-file", file], filed)).code).toBe(0);
    expect(filed.asked).toEqual([]);
    const bad = await runInsight(sinceCommand, [later, "--ledger", ledger], makeIo({ env: { SNAPPY_PASSPHRASE: "not the passphrase" } }));
    expect(bad.code).toBe(1);
    expect(bad.out).toBe("");
    expect(bad.err).toContain("passphrase");
    expectNoLeaks(bad.err, "wrong passphrase");
  });

  it("counts days in the given time zone and rejects a bad offset before reading anything", async () => {
    const { later, earlier } = await makeLedger();
    const east = await runInsight(sinceCommand, [later, "--earlier", earlier, "--utc-offset", "14", "--json"]);
    const west = await runInsight(sinceCommand, [later, "--earlier", earlier, "--utc-offset=-12", "--json"]);
    expect(JSON.parse(east.out).daysBetween).toBeGreaterThanOrEqual(119);
    expect(JSON.parse(west.out).daysBetween).toBeGreaterThanOrEqual(119);
    const missing = join(tempDir("since-early"), "missing.zip");
    expect((await runInsight(sinceCommand, [missing, "--utc-offset", "99"])).err).toContain("--utc-offset must be hours from UTC");
    expect((await runInsight(sinceCommand, [missing, "--limit", "x"])).err).toContain("--limit must be a whole number from 1 to 1000");
    expect((await runInsight(sinceCommand, [missing, "--limit", "0"])).err).toContain("--limit must be a whole number");
  });

  it("limits each list in text, and says how to see the rest", async () => {
    const { later, earlier } = await makeLedger();
    const one = await runInsight(sinceCommand, [later, "--earlier", earlier, "--limit", "1"]);
    expect(one.out).toContain("And 1 more. Use --limit to see more, or --out to save them all.");
    expect(one.out).toContain("And 2 more.");
    const all = await runInsight(sinceCommand, [later, "--earlier", earlier]);
    expect(all.out).not.toContain("more. Use --limit");
  });

  it("exits 2 and names no one when an export has errors", async () => {
    const dir = tempDir("since-damaged");
    const { later, earlier } = await makeLedger();
    const full = syntheticExportZip({ now: LATER, friendCount: 40, memoryCount: 20 });
    const damaged = join(dir, "damaged.zip");
    writeFileSync(damaged, full.subarray(0, Math.floor(full.length * 0.6)));
    for (const args of [[damaged, "--no-save"], [later, "--earlier", damaged], [damaged, "--earlier", earlier]]) {
      const { code, out, err } = await runInsight(sinceCommand, args);
      expect(code, args.join(" ")).toBe(2);
      expect(err).toBe("");
      expect(out).toContain("Snappy stopped, since a broken export could make friends look as if they left.");
      expect(stripPaths(out)).not.toMatch(USERNAME);
      expectBrandSafe(out, "damaged");
    }
    const json = JSON.parse((await runInsight(sinceCommand, [damaged, "--no-save", "--json"])).out);
    expect(json.stopped).toBe("export-errors");
    expect(Object.keys(json)).toEqual(["generatedAt", "issues", "stopped"]);
  });

  it("uses no color with --no-color, and color on a color terminal", async () => {
    const { later, earlier } = await makeLedger();
    const color = await runInsight(sinceCommand, [later, "--earlier", earlier], makeIo({ interactive: true, env: { COLORTERM: "truecolor" } }));
    expect(color.out).toContain("\x1b[");
    const plain = await runInsight(sinceCommand, [later, "--earlier", earlier, "--no-color"], makeIo({ interactive: true, env: { COLORTERM: "truecolor" } }));
    expect(plain.out).not.toContain("\x1b");
  });

  it("handles an export with no Memories list and no chats", async () => {
    const dir = tempDir("since-bare");
    const bare = (name: string, mtime: number, friends: string[]): string => {
      const bytes = new TextEncoder().encode(JSON.stringify({ Friends: friends.map((u) => ({ Username: u, "Creation Timestamp": "2024-03-01 10:00:00 UTC" })) }));
      const path = join(dir, name);
      writeFileSync(path, zipSync({ "json/friends.json": [bytes, { mtime: new Date(mtime) }] }));
      return path;
    };
    const before = bare("before.zip", LATER - 20 * DAY, ["pal_one", "pal_two"]);
    const now = bare("now.zip", LATER, ["pal_one", "pal_three"]);
    const { code, out } = await runInsight(sinceCommand, [now, "--earlier", before]);
    expect(code).toBe(0);
    const text = flat(out);
    expect(text).toContain("20 days apart.");
    expect(text).toMatch(/New friends +1\n/);
    expect(text).toContain("Your export has no saved chats or Snaps, so activity is not shown.");
    expect(text).toContain("Your export has no Memories list, so Memories are not shown.");
    expect(text).not.toContain("Chats and Snaps\n");
    expectBrandSafe(out, "bare");
  });
});

// --------------------------------------------------------------------------- JSON and CSV ---

describe("JSON", () => {
  it("prints the result with a list of people and the count of each list", async () => {
    const { later, earlier } = await makeLedger();
    const { code, out } = await runInsight(sinceCommand, [later, "--earlier", earlier, "--json"]);
    expect(code).toBe(0);
    const json = JSON.parse(out);
    expect(json.generatedAt).toBe(new Date(NOW).toISOString());
    expect(json.comparable).toBe(true);
    expect(json.source).toBe("file");
    expect(json.listCounts).toEqual({ added: 2, "no-longer-listed": 3, "removed-by-you": 2, "blocked-by-you": 0, "request-accepted": 0, "request-pending": 3, "request-no-longer-listed": 0 });
    expect(json.friends.added.map((p: { username: string }) => p.username)).toEqual(["newfriend_1", "newfriend_2"]);
    expect(json.notes.map((n: { code: string }) => n.code)).toContain("friends-may-have-left");
  });

  it("empties the lists of people with --counts but keeps their counts", async () => {
    const { later, earlier } = await makeLedger();
    const { out } = await runInsight(sinceCommand, [later, "--earlier", earlier, "--json", "--counts"]);
    const json = JSON.parse(out);
    expect(json.friends.added).toEqual([]);
    expect(json.friends.disappeared).toEqual([]);
    expect(json.requests.stillPending).toEqual([]);
    expect(json.listCounts["no-longer-listed"]).toBe(3);
    expect(json.friends.currentCount).toBe(40);
    expect(stripPaths(out)).not.toMatch(USERNAME);
  });

  it("is plain JSON for a first export, with nothing compared", async () => {
    const { later } = await makeLedger();
    const { out } = await runInsight(sinceCommand, [later, "--no-save", "--json"]);
    const json = JSON.parse(out);
    expect(json).toMatchObject({ comparable: false, friends: null, requests: null, memories: null, activity: null, source: "skipped" });
    expect(json.notes).toEqual([{ code: "no-previous-export", params: {} }]);
  });
});

describe("--out", () => {
  it("saves the people as CSV, replaces nothing without --force, and writes nothing unless asked", async () => {
    const { later, earlier } = await makeLedger();
    const dir = tempDir("since-out");
    const file = join(dir, "changes.csv");
    const { code, out } = await runInsight(sinceCommand, [later, "--earlier", earlier, "--out", file]);
    expect(code).toBe(0);
    expect(out).toContain(`CSV saved: ${file}`);
    const csv = readFileSync(file, "utf8");
    expect(csv.split("\r\n")[0]).toBe("username,change,date");
    expect(csv).toContain("newfriend_1,added,2026-08-01\r\n");
    expect(csv).toMatch(/ghost_1,no-longer-listed,2022-09-10\r\n/);
    expect(csv).toMatch(/oneway_1,request-pending,2025-05-29\r\n/);
    expect(csv.split("\r\n").length).toBe(2 + 2 + 3 + 2 + 3);

    const again = await runInsight(sinceCommand, [later, "--earlier", earlier, "--out", file]);
    expect(again.code).toBe(1);
    expect(again.err).toContain("already exists");
    expect(again.err).toContain("--force");
    expect(readFileSync(file, "utf8")).toBe(csv);
    expect((await runInsight(sinceCommand, [later, "--earlier", earlier, "--out", file, "--force"])).code).toBe(0);

    const none = tempDir("since-none");
    await runInsight(sinceCommand, [later, "--earlier", earlier], makeIo({ home: none }));
    await runInsight(sinceCommand, [later, "--earlier", earlier, "--json"], makeIo({ home: none }));
    expect(readdirSync(none)).toEqual([]);
  });

  it("checks the name before reading anything, and will not save usernames with --counts", async () => {
    const dir = tempDir("since-out-bad");
    const missing = join(dir, "missing.zip");
    const wrong = await runInsight(sinceCommand, [missing, "--out", join(dir, "x.json")]);
    expect(wrong.code).toBe(1);
    expect(wrong.err).toBe("--out needs a file name ending in .csv, so no other file is replaced.\n");
    const counts = await runInsight(sinceCommand, [missing, "--out", join(dir, "x.csv"), "--counts"]);
    expect(counts.err).toContain("--out saves usernames, so it cannot be used with --counts.");
    expect(readdirSync(dir)).toEqual([]);
  });

  it("saves a header alone when nothing was compared, and neutralizes a name that could run as a formula", () => {
    expect(sinceToCsv(report(0))).toBe("username,change,date\r\n");
    const r = report(0, {
      friends: { previousCount: 1, currentCount: 2, net: 1, added: [person("=cmd|calc", LATER), person("+one", undefined), person("a,\"b\"", undefined)].map((p) => ({ at: null, ...p })), disappeared: [], removedByYou: [], blockedByYou: [] },
    });
    const lines = sinceToCsv(r).split("\r\n");
    expect(lines[1]).toBe("'=cmd|calc,added,2026-11-01");
    expect(lines[2]).toBe("'+one,added,");
    expect(lines[3]).toBe('"a,""b""",added,');
  });
});

// ----------------------------------------------------------------- choosing the earlier one ---

describe("choosePrevious", () => {
  const current = snap("now", 1000);

  it("takes the newest saved export at or before this one, and never this export itself", () => {
    expect(choosePrevious([snap("a", 100), snap("b", 400), snap("now", 1000), snap("c", 700)], current)?.id).toBe("c");
    expect(choosePrevious([snap("a", 100), snap("b", 1000)], current)?.id).toBe("b");
    expect(choosePrevious([snap("a", 100), snap("z", 5000)], current)?.id).toBe("a");
  });

  it("falls back to the nearest newer export when every other one is newer, and finds nothing for an empty or lone history", () => {
    expect(choosePrevious([snap("later", 9000), snap("late", 5000)], current)?.id).toBe("late");
    expect(choosePrevious([], current)).toBeUndefined();
    expect(choosePrevious([snap("now", 1000)], current)).toBeUndefined();
  });

  it("ignores a snapshot with no usable time", () => {
    expect(choosePrevious([snap("bad", Number.NaN), snap("ok", 10)], current)?.id).toBe("ok");
    expect(choosePrevious([snap("bad", Number.NaN)], current)).toBeUndefined();
  });

  it("is quick on a long history", () => {
    const list = Array.from({ length: 20_000 }, (_, i) => snap(`s${i}`, i));
    const started = Date.now();
    expect(choosePrevious(list, snap("now", 15_000))?.id).toBe("s15000");
    expect(Date.now() - started).toBeLessThan(500);
  });
});

describe("the people lists", () => {
  it("are empty when nothing was compared, and keep the order every table and the CSV use", () => {
    const none: SinceReport = { ...report(0), comparable: false, friends: null, requests: null, memories: null, activity: null };
    expect(personRows(none)).toEqual([]);
    expect(Object.values(peopleByChange(none)).every((l) => l.length === 0)).toBe(true);
    expect(personRows(report(1)).map((p) => p.change)).toEqual(["added", "no-longer-listed", "removed-by-you", "blocked-by-you", "request-accepted", "request-pending", "request-no-longer-listed"]);
  });
});

// ----------------------------------------------------------------------------------- wording ---

describe("wording", () => {
  it.each([0, 1, 2, 30])("reads correctly with a count of %i, for every note", (n) => {
    for (const source of ["ledger", "file", "none", "skipped"] as const) {
      const text = renderSince(report(n, { notes: allNotes(n), source, dateGuessed: true }), term, false);
      expectBrandSafe(text, `count ${n} ${source}`);
      expect(text).not.toContain("a-code-from-the-future");
      expect(flat(text)).toContain("Snappy noted something it cannot describe. Run it with --verbose and share the code.");
    }
  });

  it("says one, not 1 friends, and names no one in a note", () => {
    const text = flat(renderSince(report(1, { notes: allNotes(1) }), term, false));
    expect(text).toContain("1 friend is no longer listed. That friend may have removed you or closed their account.");
    expect(text).toContain("1 request you sent is no longer listed. It may have been declined.");
    expect(text).toContain("1 export has a date in the future. A device clock may have been wrong.");
    expect(text).toContain("1 Memory has no date or a date in the future. Snappy leaves it out of the new count.");
    expect(text).toContain("1 chat or Snap has a missing or future date. Snappy leaves it out.");
    expect(text).toContain("The exports are 1 day apart.");
    expect(notesOf(text)).not.toMatch(/\b(?:gone|nf|rm|bl|acc|pend|van)_\d/);
    const many = flat(renderSince(report(2, { notes: allNotes(2) }), term, false));
    expect(many).toContain("2 friends are no longer listed. They may have removed you or closed their account.");
    expect(many).toContain("2 requests you sent are no longer listed. They may have been declined.");
    expect(many).toContain("2 exports have a date in the future.");
    expect(many).toContain("2 of 7 friends are gone. This may be a partial export, so check it before you trust the list.");
  });

  it("says up, down and no change, and shows the earlier period only when there is one", () => {
    const flatChange = renderSince(report(1, { friends: { ...report(1).friends!, net: 0 }, activity: { since: { sent: 1, received: 1, unknown: 0 }, earlier: { sent: 1, received: 1, unknown: 0 }, change: { sent: 0, received: 0 } } }), term, false);
    expect(flatChange).toContain("(no change)");
    expect(flatChange).toContain("Sent: no change. Received: no change.");
    const noEarlier = renderSince(report(1, { activity: { since: { sent: 4, received: 2, unknown: 1 }, earlier: null, change: null } }), term, false);
    expect(noEarlier).toMatch(/Since your last export +4 +2 +1/);
    expect(noEarlier).not.toContain("Before that");
    const down = renderSince(report(1, { friends: { ...report(1).friends!, net: -4 } }), term, false);
    expect(down).toContain("(down 4)");
  });

  it("leaves out the sections whose data is null, and every section when nothing was compared", () => {
    const text = renderSince(report(1, { memories: null, activity: null }), term, false);
    expect(text).not.toContain("Memories\n");
    expect(text).not.toContain("Chats and Snaps");
    const none = renderSince({ ...report(0), comparable: false, friends: null, requests: null, memories: null, activity: null, previousAt: null, currentAt: null, daysBetween: null, notes: [{ code: "no-previous-export", params: {} }] }, term, false);
    expect(none).not.toContain("What changed");
    expect(none).not.toContain("Compared");
    expect(none).toContain("Notes");
  });

  it("shows counts only, with no username anywhere, when asked", () => {
    const text = renderSince(report(3), term, false, { counts: true });
    expect(text).toContain("What changed");
    expect(text).not.toMatch(/\b(?:nf|gone|rm|bl|acc|pend|van)_\d/);
    expect(text).not.toContain("Username");
  });

  it("caps each list and says how many were left out", () => {
    const text = renderSince(report(40), term, false, { limit: 25 });
    expect(text).toContain("And 15 more. Use --limit to see more, or --out to save them all.");
    expect(text).toContain("nf_25");
    expect(text).not.toContain("nf_26");
  });

  it("writes an invisible or direction-changing character in a username as a question mark", () => {
    const text = renderSince(report(0, { friends: { previousCount: 1, currentCount: 2, net: 1, added: [{ username: "pal‮one​", at: null }], disappeared: [], removedByYou: [], blockedByYou: [] } }), term, false);
    expect(text).toContain("pal?one?");
    expect(text).not.toContain("‮");
  });

  it("adds the short code to each note with verbose, and not otherwise", () => {
    const r = report(1, { notes: [{ code: "same-day", params: {} }] });
    expect(renderSince(r, term, false)).not.toContain("code:");
    expect(renderSince(r, term, true)).toContain("code: same-day");
  });

  it("keeps every sentence short, and avoids words the brand avoids", () => {
    const text = renderSince(report(2, { notes: allNotes(2), dateGuessed: true }), term, false);
    const prose = flat(text)
      .split("\n")
      .map((line) => line.replace(/^\s*(?:Warning|Note|Error)\s+/, "").trim())
      .filter((line) => /[.?]$/.test(line) && !/\s{2,}/.test(line));
    expect(prose.length).toBeGreaterThan(8);
    for (const s of prose.flatMap((line) => line.split(/(?<=[.?])\s+/))) expect(s.split(/\s+/).length, s).toBeLessThanOrEqual(25);
    expect(text).not.toMatch(/\b(?:ghosts?|unfriend\w*|dormant|inactive|dead|simply|just)\b/i);
    expect(text).not.toMatch(/\b(?<!may )(?:has|have) (?:removed|blocked|deleted) you\b/i);
  });
});

// ---------------------------------------------------------------------------------- privacy ---

describe("privacy", () => {
  it("names people only in the result tables: never in a note, an error, JSON notes or with --counts", async () => {
    const { later, earlier, ledger } = await makeLedger();
    const dir = tempDir("since-canary");
    const zip = join(dir, "bundled.zip");
    writeFileSync(zip, syntheticExportZip({ now: LATER, friendCount: 40, memoryCount: 20, bundleMedia: true }));
    const parts = join(dir, "parts");
    writeSyntheticParts(parts, { memoryCount: 200 });
    const env = { SNAPPY_PASSPHRASE: PASS };
    const cases: [string[], Record<string, string>][] = [
      [[later, "--ledger", ledger, "--verbose"], env],
      [[later, "--earlier", earlier, "--verbose"], {}],
      [[later, "--earlier", earlier, "--counts", "--verbose"], {}],
      [[earlier, "--earlier", later, "--verbose"], {}],
      [[zip, "--earlier", earlier, "--json", "--verbose"], {}],
      [[parts, "--earlier", earlier, "--verbose"], {}],
      [[later, "--ledger", ledger, "--verbose"], { SNAPPY_PASSPHRASE: "not the passphrase" }],
      [[join(dir, "missing.zip")], {}],
      [[later, "--limit", "x"], {}],
      [[later, "--bogus"], {}],
      [[], {}],
    ];
    for (const [args, e] of cases) {
      const { out, err } = await runInsight(sinceCommand, args, makeIo({ env: e }));
      const label = args.join(" ");
      const text = stripPaths(out + err);
      expectNoLeaks(text, label);
      expect(text, label).not.toMatch(/\.(?:jpg|mp4|png|html)\b|[0-9A-F]{8}-[0-9A-F]{4}/i);
      expect(stripPaths(err), label).not.toMatch(USERNAME);
      if (!args.includes("--json")) expect(stripPaths(notesOf(out)), `${label}: notes`).not.toMatch(USERNAME);
      if (args.includes("--counts")) expect(text, label).not.toMatch(USERNAME);
    }
    const json = JSON.parse((await runInsight(sinceCommand, [later, "--earlier", earlier, "--json"])).out) as { notes: unknown };
    expect(JSON.stringify(json.notes)).not.toMatch(USERNAME);
  });

  it("writes no file unless --out is given, and never touches the files it reads", async () => {
    const { later, earlier, dir } = await makeLedger();
    const home = tempDir("since-ro-home");
    const before = readdirSync(dir).sort();
    await runInsight(sinceCommand, [later, "--earlier", earlier], makeIo({ home }));
    await runInsight(sinceCommand, [later, "--no-save", "--json"], makeIo({ home }));
    expect(readdirSync(home)).toEqual([]);
    expect(readdirSync(dir).sort()).toEqual(before);
    expect(existsSync(join(home, ".snappy"))).toBe(false);
  });
});
