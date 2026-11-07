/** snappy-export blocked: the blocked, ignored and hidden suggestion review. Synthetic data only. */
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { insights } from "@snappy-export/core";
import { blockedCommand, renderBlocked } from "../src/commands/blocked.ts";
import { createTerm } from "../src/term.ts";
import { LATER, NOW, makeIo, stripPaths, tempDir, writeSyntheticParts, writeSyntheticZip } from "./helpers.ts";
import { expectBrandSafe, expectNoLeaks, expectValidDescriptor, runInsight } from "./insights-helpers.ts";

type Review = insights.blockedReview.BlockedReview;
/** Wrapped note lines joined back into one line. */
const flat = (text: string): string => text.replace(/\n {10,}/g, " ");
const term = createTerm({ env: {}, isTTY: false, columns: 100 });

type Rows = Record<string, unknown>[];
const ts = (day: number): string => `2024-03-${String(day).padStart(2, "0")} 10:00:00 UTC`;
const row = (username: string, day?: number): Record<string, unknown> => ({ Username: username, ...(day === undefined ? {} : { "Creation Timestamp": ts(day) }) });
const FUTURE = "2030-01-01 10:00:00 UTC";

/** An export that holds only a friends file, so every list is exactly what a test writes. */
function friendsZip(dir: string, lists: Record<string, Rows>, name = "export.zip"): string {
  const path = join(dir, name);
  const bytes = new TextEncoder().encode(JSON.stringify(lists));
  writeFileSync(path, zipSync({ "json/friends.json": [bytes, { mtime: new Date(LATER) }] }));
  return path;
}

/** Overlaps of every kind, a repeated row, a future date and an undated person. */
function conflictZip(dir: string): string {
  return friendsZip(dir, {
    Friends: [row("pal_one", 1), row("pal_two", 2)],
    "Friend Requests Sent": [row("sent_one", 3)],
    "Pending Requests": [row("pend_one", 4)],
    "Blocked Users": [row("pal_one", 5), row("both_one", 6), row("Dupe_One", 9), row("dupe_one", 7), { Username: "future_one", "Creation Timestamp": FUTURE }],
    "Ignored Snapchatters": [row("both_one", 8), row("pend_one", 10)],
    "Hidden Friend Suggestions": [row("sent_one"), row("lonely_one")],
  });
}

describe("the command", () => {
  it("is a valid descriptor", async () => {
    await expectValidDescriptor(blockedCommand);
    expect(blockedCommand.name).toBe("blocked");
    expect(blockedCommand.group).toBe("Friends");
    expect(blockedCommand.synopsis).toBe("blocked <ZIP files...>");
    expect(blockedCommand.summary).toBe("Review blocked and ignored people.");
  });

  it("reviews the built-in synthetic export, oldest first, and exits 0", async () => {
    const dir = tempDir("blocked-parts");
    writeSyntheticParts(dir);
    const { code, out, err } = await runInsight(blockedCommand, [dir]);
    expect(code).toBe(0);
    expect(err).toBe("");
    expect(flat(out)).toContain("Blocked and ignored review");
    expect(flat(out)).toContain("4 people in your lists.");
    expect(flat(out)).toContain("Snappy only lists them. It changes nothing in Snapchat.");
    expect(flat(out)).toContain("Your lists");
    expect(flat(out)).toContain("Hidden suggestions");
    expect(flat(out)).toContain("What to look at first");
    expect(flat(out)).toContain("1. Look over your blocked list (1 person).");
    expect(flat(out)).toContain("3. Look over your hidden suggestions (2 people).");
    expect(flat(out)).toContain("blocked_1");
    expect(flat(out)).toContain("ignored_1");
    expect(flat(out)).toContain("suggest_2");
    expect(flat(out)).toContain("2 people in your hidden suggestions list have no date.");
    expect(out).not.toContain("Worth a second look");
    expect(out.endsWith("Nothing here has left this device.\n")).toBe(true);
    expectBrandSafe(out, "blocked");
  });

  it("prints JSON with the people and codes", async () => {
    const dir = tempDir("blocked-json");
    const zip = writeSyntheticZip(dir, "a.zip");
    const { code, out } = await runInsight(blockedCommand, [zip, "--json"]);
    expect(code).toBe(0);
    const json = JSON.parse(out) as Review & { generatedAt: string };
    expect(json.generatedAt).toBe(new Date(NOW).toISOString());
    expect(Object.keys(json)).toEqual(["generatedAt", "lists", "conflicts", "reviewOrder", "totals", "notes"]);
    expect(json.lists.map((l) => l.id)).toEqual(["blocked", "ignored", "hiddenSuggestions"]);
    expect(json.lists[0]?.entries[0]?.username).toBe("blocked_1");
    expect(json.totals.conflicts).toBe(0);
  });

  it("lists people who show up in more than one place, with a calm reason", async () => {
    const zip = conflictZip(tempDir("blocked-conflicts"));
    const { code, out } = await runInsight(blockedCommand, [zip]);
    expect(code).toBe(0);
    expect(flat(out)).toContain("Worth a second look");
    expect(out).toMatch(/pal_one\s+Blocked\s+Also a friend/);
    expect(out).toMatch(/both_one\s+Blocked, Ignored\s+More than one list/);
    expect(out).toMatch(/pend_one\s+Ignored\s+Request pending/);
    expect(out).toMatch(/sent_one\s+Hidden suggestions\s+Request sent/);
    expect(flat(out)).toContain("1. Look at the 4 people who show up in more than one place.");
    expect(flat(out)).toContain("4 people may be worth a second look.");
    expect(flat(out)).toContain("1 extra row in your blocked list repeats a person already listed. Snappy counts each person once.");
    expect(flat(out)).toContain("1 person in your blocked list has a date in the future. Snappy leaves it out.");
    expect(flat(out)).toContain("2 people in your hidden suggestions list have no date.");
    // Oldest first inside a list, undated last, and one row for a repeated person.
    const blocked = out.slice(out.indexOf("Blocked, oldest first"), out.indexOf("Ignored, oldest first"));
    expect(blocked.indexOf("pal_one")).toBeLessThan(blocked.indexOf("both_one"));
    expect(blocked.indexOf("both_one")).toBeLessThan(blocked.indexOf("dupe_one"));
    expect(blocked.indexOf("dupe_one")).toBeLessThan(blocked.indexOf("future_one"));
    expect(blocked.match(/dupe_one/g)).toHaveLength(1);
    expectBrandSafe(out, "conflicts");
  });

  it("says so when the lists are empty", async () => {
    const zip = friendsZip(tempDir("blocked-empty"), { Friends: [row("pal_one", 1)] });
    const { code, out } = await runInsight(blockedCommand, [zip]);
    expect(code).toBe(0);
    expect(flat(out)).toContain("0 people in your lists.");
    expect(flat(out)).toContain("Snappy found no blocked, ignored or hidden people in this export.");
    expect(out).not.toContain("What to look at first");
    expect(out).not.toContain("oldest first");
    expectBrandSafe(out, "empty");
  });

  it("says one person, not 1 people, and mentions an empty friends list", async () => {
    const zip = friendsZip(tempDir("blocked-one"), { "Blocked Users": [row("lone_one", 3)] });
    const { out } = await runInsight(blockedCommand, [zip]);
    expect(flat(out)).toContain("1 person in your lists.");
    expect(flat(out)).toContain("1. Look over your blocked list (1 person).");
    expect(flat(out)).toContain("Your friends list is empty, so Snappy cannot tell who is also a friend. The export may be short.");
    expectBrandSafe(out, "one");
  });

  it("caps each list with --limit and says how many more there are", async () => {
    const many = Array.from({ length: 30 }, (_, i) => row(`many_${String(i + 1).padStart(2, "0")}`, i + 1));
    const zip = friendsZip(tempDir("blocked-cap"), { Friends: [row("pal_one", 1)], "Blocked Users": many });
    const byDefault = await runInsight(blockedCommand, [zip]);
    expect(byDefault.out).toContain("many_25");
    expect(byDefault.out).not.toContain("many_26");
    expect(byDefault.out).toContain("And 5 more. Use --limit to see more.");
    const small = await runInsight(blockedCommand, [zip, "--limit", "3"]);
    expect(small.out).toContain("many_03");
    expect(small.out).not.toContain("many_04");
    expect(small.out).toContain("And 27 more. Use --limit to see more.");
    const all = await runInsight(blockedCommand, [zip, "--limit", "30"]);
    expect(all.out).toContain("many_30");
    expect(all.out).not.toContain("more. Use --limit");
    // The cap is for text only: JSON keeps every person.
    const json = JSON.parse((await runInsight(blockedCommand, [zip, "--json", "--limit", "3"])).out) as Review;
    expect(json.lists[0]?.entries).toHaveLength(30);
  });

  it("caps the second look table too", async () => {
    const dir = tempDir("blocked-cap-conflicts");
    const people = Array.from({ length: 8 }, (_, i) => row(`mix_${i + 1}`, i + 1));
    const zip = friendsZip(dir, { Friends: people, "Blocked Users": people });
    const { out } = await runInsight(blockedCommand, [zip, "--limit", "5"]);
    const second = out.slice(out.indexOf("Worth a second look"), out.indexOf("Blocked, oldest first"));
    expect(second).toContain("mix_5");
    expect(second).not.toContain("mix_6");
    expect(second).toContain("And 3 more. Use --limit to see more.");
  });

  it("shows counts only, with no username, with --counts", async () => {
    const zip = conflictZip(tempDir("blocked-counts"));
    const { code, out } = await runInsight(blockedCommand, [zip, "--counts"]);
    expect(code).toBe(0);
    expect(flat(out)).toContain("Your lists");
    expect(flat(out)).toContain("What to look at first");
    expect(out).not.toMatch(/_one\b/);
    expect(out).not.toContain("oldest first");
    expect(out).not.toContain("Worth a second look");
    const json = JSON.parse((await runInsight(blockedCommand, [zip, "--counts", "--json"])).out) as Review;
    expect(json.conflicts).toEqual([]);
    expect(json.lists.every((l) => l.entries.length === 0)).toBe(true);
    expect(json.lists[0]?.count).toBe(4);
    expect(json.totals.conflicts).toBe(4);
    expect(JSON.stringify(json)).not.toMatch(/_one\b/);
  });

  it("adds the short code to each note with --verbose", async () => {
    const zip = conflictZip(tempDir("blocked-verbose"));
    const quiet = await runInsight(blockedCommand, [zip]);
    expect(quiet.out).not.toContain("code:");
    const verbose = await runInsight(blockedCommand, [zip, "--verbose"]);
    expect(verbose.out).toContain("code: conflicts-found");
    expect(verbose.out).toContain("code: case-duplicates");
  });

  it("stops with exit 2 for a broken export, in text and in JSON", async () => {
    const dir = tempDir("blocked-broken");
    const zip = join(dir, "broken.zip");
    writeFileSync(zip, zipSync({ "html/index.html": new TextEncoder().encode("<html></html>") }));
    const text = await runInsight(blockedCommand, [zip]);
    expect(text.code).toBe(2);
    expect(text.out).toContain("Snappy stopped, since a broken export could give wrong results.");
    expect(text.out).toContain("Run the check command to see what to fix.");
    expect(text.out).not.toContain("Your lists");
    expect(text.out).not.toContain("code:");
    expect((await runInsight(blockedCommand, [zip, "--verbose"])).out).toContain("code: html-only-export");
    expectBrandSafe(text.out, "broken");
    const json = await runInsight(blockedCommand, [zip, "--json"]);
    expect(json.code).toBe(2);
    const data = JSON.parse(json.out) as { stopped: string; issues: { code: string; severity: string }[]; lists?: unknown };
    expect(data.stopped).toBe("export-errors");
    expect(data.issues[0]).toEqual({ severity: "error", code: "html-only-export" });
    expect(data.lists).toBeUndefined();
  });

  it("uses no color with --no-color or NO_COLOR, and color on a color terminal", async () => {
    const zip = writeSyntheticZip(tempDir("blocked-color"), "a.zip");
    const color = await runInsight(blockedCommand, [zip], makeIo({ interactive: true, env: { COLORTERM: "truecolor" } }));
    expect(color.out).toContain("\x1b[");
    const flagged = await runInsight(blockedCommand, [zip, "--no-color"], makeIo({ interactive: true, env: { COLORTERM: "truecolor" } }));
    expect(flagged.out).not.toContain("\x1b");
    const env = await runInsight(blockedCommand, [zip], makeIo({ interactive: true, env: { NO_COLOR: "1" } }));
    expect(env.out).not.toContain("\x1b");
  });

  it("writes no file, reads no ledger and asks for no passphrase", async () => {
    const home = tempDir("blocked-home");
    const dir = tempDir("blocked-ro");
    writeSyntheticParts(dir);
    const before = readdirSync(dir).sort();
    for (const args of [[dir], [dir, "--json"], [dir, "--counts"]]) {
      const io = makeIo({ home, env: { SNAPPY_PASSPHRASE: "should-not-be-used" } });
      await runInsight(blockedCommand, args, io);
      expect(io.asked).toEqual([]);
    }
    expect(readdirSync(home)).toEqual([]);
    expect(readdirSync(dir).sort()).toEqual(before);
  });

  it("does not let a hostile username reach the table raw", async () => {
    const evil = "evil\u001b]0;pwned\u0007\u001b[2Jx";
    const zip = friendsZip(tempDir("blocked-evil"), { Friends: [row("pal_one", 1)], "Blocked Users": [row(evil, 2)] });
    const { out } = await runInsight(blockedCommand, [zip]);
    expect(flat(out)).toContain("evil?]0;pwned");
    expect(out).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f]/);
  });

  it("stops with calm messages for a missing path, no input and bad options", async () => {
    const dir = tempDir("blocked-errors");
    const missing = await runInsight(blockedCommand, [join(dir, "missing.zip")]);
    expect(missing).toMatchObject({ code: 1, out: "" });
    expect(missing.err).toContain("could not find");
    expect((await runInsight(blockedCommand, [])).err).toContain("Give Snappy your export");
    const zip = writeSyntheticZip(dir, "a.zip");
    expect((await runInsight(blockedCommand, [zip, "--limit", "x"])).err).toContain("--limit must be a whole number from 1 to 1000.");
    expect((await runInsight(blockedCommand, [zip, "--limit", "0"])).err).toContain("--limit must be a whole number from 1 to 1000.");
    expect((await runInsight(blockedCommand, [zip, "--limit", "1001"])).err).toContain("--limit must be a whole number");
    expect((await runInsight(blockedCommand, [zip, "--limit"])).err).toContain("The option --limit needs a value.");
    expect((await runInsight(blockedCommand, [zip, "--bogus"])).err).toContain('Snappy does not know the option --bogus for blocked. Run "snappy-export help blocked"');
    expect((await runInsight(blockedCommand, [zip, "--out", join(dir, "x.txt")])).err).toContain("Snappy does not know the option --out for blocked.");
  });

  it("stops for a file that is not a zip, and for a later part alone", async () => {
    const dir = tempDir("blocked-wrong");
    const notZip = join(dir, "notes.txt");
    writeFileSync(notZip, "this is not a zip file at all");
    const bad = await runInsight(blockedCommand, [notZip]);
    expect(bad.code).toBe(1);
    expect(bad.out).toBe("");
    const parts = writeSyntheticParts(join(dir, "parts"));
    const later = await runInsight(blockedCommand, [parts[1] as string]);
    expect(later.code).toBe(1);
    expect(later.out).toBe("");
    expect(later.err.length).toBeGreaterThan(0);
  });
});

describe("privacy", () => {
  const USERNAME = /\b(?:blocked|ignored|suggest|pal|both|pend|sent|dupe|future|lonely|many|evil)_\w+\b/i;

  it("prints no canary, link or entry name from the export, in text or JSON", async () => {
    const dir = tempDir("blocked-canary");
    const zip = writeSyntheticZip(dir, "export.zip", { bundleMedia: true });
    const parts = join(dir, "parts");
    writeSyntheticParts(parts, { memoryCount: 200 });
    for (const args of [[zip], [zip, "--json"], [parts], [parts, "--json", "--verbose"], [zip, "--counts", "--verbose"], [zip, "--limit", "1"]]) {
      const { out, err } = await runInsight(blockedCommand, args);
      const text = stripPaths(out + err);
      expectNoLeaks(text, args.join(" "));
      expect(text, args.join(" ")).not.toMatch(/\.(?:jpg|mp4|png|html|json)\b|[0-9A-F]{8}-[0-9A-F]{4}/i);
    }
  });

  it("puts usernames only in the result tables, never in notes, codes or errors", async () => {
    const zip = conflictZip(tempDir("blocked-notes"));
    const { out } = await runInsight(blockedCommand, [zip, "--verbose"]);
    const notes = out.slice(out.indexOf("Notes"));
    expect(notes).toContain("code: conflicts-found");
    expect(notes).not.toMatch(USERNAME);
    const steps = out.slice(out.indexOf("What to look at first"), out.indexOf("Worth a second look"));
    expect(steps).not.toMatch(USERNAME);
    const json = JSON.parse((await runInsight(blockedCommand, [zip, "--json"])).out) as Review;
    expect(JSON.stringify(json.notes)).not.toMatch(USERNAME);
    expect(JSON.stringify(json.reviewOrder)).not.toMatch(USERNAME);
    for (const args of [[], [zip, "--limit", "x"], [zip, "--bogus"], [join(tempDir("blocked-missing"), "no.zip")]]) {
      const r = await runInsight(blockedCommand, args, makeIo());
      expect(r.out + r.err, args.join(" ")).not.toMatch(USERNAME);
    }
  });

  it("names nobody when the export is broken", async () => {
    const dir = tempDir("blocked-broken-names");
    const zip = join(dir, "broken.zip");
    writeFileSync(zip, zipSync({ "html/index.html": new TextEncoder().encode("<html></html>") }));
    const r = await runInsight(blockedCommand, [zip, "--verbose"]);
    expect(r.out + r.err).not.toMatch(USERNAME);
  });
});

/** A review with every note and step, and `n` people in each list, to read each sentence at counts of 0, 1, 2 and 12. */
function fullReview(n: number): Review {
  const people = Array.from({ length: n }, (_, i) => `person_${i + 1}`);
  const list = (id: "blocked" | "ignored" | "hiddenSuggestions"): Review["lists"][number] => ({
    id,
    count: n,
    caseDuplicates: n,
    oldestAt: n > 0 ? NOW : null,
    newestAt: n > 0 ? NOW : null,
    datedCount: n,
    undatedCount: 0,
    futureCount: 0,
    entries: people.map((username) => ({ username, at: NOW, lists: [id], conflicts: [] })),
  });
  const codes = ["no-entries", "list-empty", "undated-entries", "future-dated-entries", "case-duplicates", "blank-entries", "conflicts-found", "friends-list-empty", "a-code-from-the-future"] as const;
  const notes = (["blocked", "ignored", "hiddenSuggestions"] as const).flatMap((id) =>
    codes.map((code) => ({ code: code as Review["notes"][number]["code"], params: { list: id, count: n } })),
  );
  return {
    generatedAt: NOW,
    lists: [list("blocked"), list("ignored"), list("hiddenSuggestions")],
    conflicts: people.map((username) => ({ username, lists: ["blocked", "ignored"], kinds: ["multiple-lists", "also-friend", "also-pending", "also-sent"] })),
    reviewOrder: [
      { kind: "conflicts", code: "review-conflicts", count: n },
      { kind: "list", list: "blocked", code: "review-blocked", count: n },
      { kind: "list", list: "ignored", code: "review-ignored", count: n },
      { kind: "list", list: "hiddenSuggestions", code: "review-hidden-suggestions", count: n },
      { kind: "list", code: "review-from-the-future" as never, count: n },
    ],
    totals: { people: n, conflicts: n },
    notes,
  };
}

describe("wording", () => {
  it.each([0, 1, 2, 12])("reads correctly with a count of %i", (n) => {
    const text = renderBlocked(fullReview(n), term, false);
    expectBrandSafe(text, `count ${n}`);
    expect(text).not.toContain("a-code-from-the-future");
    expect(text).toContain("Snappy noted something it cannot describe.");
    expect(text).toContain("Run Snappy with --verbose and share the code.");
    // list-empty is in the JSON, but the table already shows a zero.
    expect(text).not.toContain("list-empty");
    const counts = renderBlocked(fullReview(n), term, false, { counts: true });
    expect(counts).not.toContain("person_");
    expectBrandSafe(counts, `counts only ${n}`);
  });

  it("says one person, not 1 people, and agrees the verbs", () => {
    const one = renderBlocked(fullReview(1), term, false);
    expect(flat(one)).toContain("1 person in your lists.");
    expect(flat(one)).toContain("Look at the 1 person who shows up in more than one place.");
    expect(flat(one)).toContain("1 person in your blocked list has no date.");
    expect(flat(one)).toContain("1 extra row in your ignored list repeats a person already listed.");
    expect(flat(one)).toContain("1 row in your blocked list has no username. Snappy leaves it out.");
    expect(flat(one)).toContain("1 person may be worth a second look.");
    const two = renderBlocked(fullReview(2), term, false);
    expect(flat(two)).toContain("2 people in your lists.");
    expect(flat(two)).toContain("Look at the 2 people who show up in more than one place.");
    expect(flat(two)).toContain("2 people in your hidden suggestions list have a date in the future. Snappy leaves them out.");
    expect(flat(two)).toContain("2 extra rows in your ignored list repeat a person already listed.");
    expect(flat(two)).toContain("2 rows in your blocked list have no username. Snappy leaves them out.");
  });

  it("caps rows at the limit and counts the rest", () => {
    const text = renderBlocked(fullReview(12), term, false, { limit: 5 });
    expect(text).toContain("person_5");
    expect(text).not.toContain("person_6");
    expect(text).toContain("And 7 more. Use --limit to see more.");
  });

  it("keeps every sentence short and in sentence case", () => {
    const text = renderBlocked(fullReview(2), term, false);
    const prose = text
      .split("\n")
      .map((line) => line.replace(/^\s*(?:Warning|Note|Error)\s+/, "").replace(/^\s*\d+\. /, "").trim())
      .filter((line) => /[.?]$/.test(line) && !/\s{2,}/.test(line));
    expect(prose.length).toBeGreaterThan(10);
    for (const s of prose.flatMap((line) => line.split(/(?<=[.?])\s+/))) expect(s.split(/\s+/).length, s).toBeLessThanOrEqual(20);
    expect(text).not.toMatch(/\b(?:ghosts?|unfriend\w*|dormant|inactive|dead|simply|just)\b/i);
  });
});
