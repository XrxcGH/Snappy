/** snappy-export friends: the friends table. Synthetic data only. */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { insights, syntheticExportZip } from "@snappy-export/core";
import { friendsCommand, renderFriends } from "../src/commands/friends.ts";
import type { FriendsView } from "../src/commands/friends.ts";
import { createTerm } from "../src/term.ts";
import { LATER, NOW, makeIo, stripPaths, tempDir, writeSyntheticParts, writeSyntheticZip } from "./helpers.ts";
import { expectBrandSafe, expectNoLeaks, expectValidDescriptor, runInsight } from "./insights-helpers.ts";

type Table = insights.friendsTable.FriendsTable;
type Row = insights.friendsTable.FriendRow;
type Json = {
  generatedAt: string;
  asOf: string | null;
  utcOffsetMinutes: number;
  saved: boolean;
  summary: Table["summary"];
  matching: number;
  rows: Row[];
  notes: Table["notes"];
};

const term = createTerm({ env: {}, isTTY: false, columns: 100 });
const USERNAME = /\b(?:active|dormant|ghost|removed|oneway|newfriend|exfriend|blocked|ignored|pending|suggest|snapper|friend)_\d+\b/;
/** A table row: a username, then the added date. */
const TABLE_ROW = /^ {2}\S+ +(?:[A-Z][a-z]{2} \d+, \d{4}|-) /;
const CRLF = "\r\n";

async function json(args: string[]): Promise<Json> {
  const { code, out } = await runInsight(friendsCommand, [...args, "--json"]);
  expect(code).toBe(0);
  return JSON.parse(out) as Json;
}

/** The three-part export, written once per call. */
function parts(label: string): string {
  const dir = tempDir(label);
  writeSyntheticParts(dir);
  return dir;
}

describe("the command", () => {
  it("is a valid descriptor", async () => {
    await expectValidDescriptor(friendsCommand);
    expect(friendsCommand.name).toBe("friends");
    expect(friendsCommand.group).toBe("Friends");
  });

  it("lists the friends in a table with counts, hints and what was left out, and exits 0", async () => {
    const dir = parts("friends-parts");
    const { code, out, err } = await runInsight(friendsCommand, [dir]);
    expect(code).toBe(0);
    expect(err).toBe("");
    expect(out).toContain("Friends");
    expect(out).toContain("30 friends in your export. 28 have saved chats or Snaps.");
    expect(out).toContain("Counted up to Nov 1, 2026.");
    expect(out).toContain("Hints come from saved chats and Snaps, so check in Snapchat.");
    expect(out).toMatch(/Quiet +6\n/);
    expect(out).toMatch(/One-sided +0\n/);
    expect(out).toMatch(/Waiting on a reply +1\n/);
    expect(out).toContain("Showing 25 of 30 friends. Sorted by username, A to Z.");
    expect(out).toMatch(/Friend +Added +Last +Total +Sent +Received +Hints/);
    expect(out).toMatch(/active_1 +Nov 20, 2024 +Oct 31, 2026 +62 +29 +33 +–\n/);
    expect(out).toContain("5 more not shown. Use --limit to show more.");
    expect(out).toContain("Quiet: no chat or Snap for 180 days.");
    expect(out).toContain("451 group chat events were left out.");
    expect(out).toContain("443 events with people outside your friends list were left out.");
    expect(out).toContain("Nothing was saved.");
    expect(out).toContain("Add --out friends.csv to save every match as a spreadsheet file.");
    expect(out).not.toContain("code:");
    expect(out.endsWith("Nothing here has left this device.\n")).toBe(true);
    expectBrandSafe(out, "friends");
  });

  it("reads a single ZIP file", async () => {
    const zip = writeSyntheticZip(tempDir("friends-one"), "a.zip");
    const { code, out } = await runInsight(friendsCommand, [zip, "--limit", "3"]);
    expect(code).toBe(0);
    expect(out).toContain("40 friends in your export.");
    expect(out).toContain("Showing 3 of 40 friends.");
    expectBrandSafe(out, "single zip");
  });

  it("shows the hints on a row: quiet for a friend with no recent chats, waiting on you for a reply that is due", async () => {
    const dir = parts("friends-hints");
    const quiet = await runInsight(friendsCommand, [dir, "--quiet", "--limit", "10"]);
    expect(quiet.out).toMatch(/dormant_1 +Oct 7, 2022 +Aug 6, 2023 +3 +1 +2 +Quiet\n/);
    expect(quiet.out).toMatch(/dormant_3 +Jul 31, 2020 +– +0 +0 +0 +Quiet\n/);
    const waiting = await runInsight(friendsCommand, [dir, "--waiting"]);
    expect(waiting.out).toMatch(/active_17 +Aug 15, 2025 +Oct 28, 2026 +31 +16 +15 +Waiting on you\n/);
    expect(waiting.out).toContain("Showing 1 of 1 friend that matches your filters.");
  });

  describe("sorting and filtering", () => {
    it("sorts by each key in either direction, with undated rows last and ties by username", async () => {
      const dir = parts("friends-sort");
      const all = (await json([dir])).rows;
      expect(all).toHaveLength(30);
      expect(all.map((r) => r.username)).toEqual(all.map((r) => r.username).sort());
      for (const key of ["added", "first", "last", "recent", "total", "sent", "received", "username"] as const) {
        for (const desc of [false, true]) {
          const rows = (await json([dir, "--sort", key, ...(desc ? ["--desc"] : [])])).rows;
          expect(rows.map((r) => r.id), `${key} ${desc}`).toEqual(insights.friendsTable.sortRows(all, key, desc ? "desc" : "asc").map((r) => r.id));
        }
      }
      const byLast = (await json([dir, "--sort", "last", "--desc"])).rows;
      expect(byLast.at(-1)?.lastAt).toBeNull();
      expect(byLast.at(-2)?.lastAt).toBeNull();
      const text = await runInsight(friendsCommand, [dir, "--sort", "total", "--desc", "--limit", "2"]);
      const top = [...all].sort((a, b) => b.total - a.total || (a.username < b.username ? -1 : 1))[0] as Row;
      expect(text.out).toContain("Sorted by total chats and Snaps, most first.");
      expect(text.out.split("\n").find((line) => TABLE_ROW.test(line))).toContain(top.username);
      expect((await runInsight(friendsCommand, [dir, "--sort", "LAST"])).out).toContain("Sorted by last chat or Snap, oldest first.");
    });

    it("filters by name start without regard to case, and by each hint", async () => {
      const dir = parts("friends-filter");
      const all = (await json([dir])).rows;
      const named = await json([dir, "--starts-with", "DORM"]);
      expect(named.rows.length).toBeGreaterThan(0);
      expect(named.rows.every((r) => r.username.startsWith("dormant_"))).toBe(true);
      expect(named.matching).toBe(named.rows.length);
      expect(named.summary.friends).toBe(30);
      expect((await json([dir, "--quiet"])).rows).toEqual(all.filter((r) => r.quiet));
      expect((await json([dir, "--one-sided"])).rows).toEqual(all.filter((r) => r.oneSided));
      expect((await json([dir, "--waiting"])).rows).toEqual(all.filter((r) => r.waiting));
      expect((await json([dir, "--waiting-on", "you"])).rows.map((r) => r.username)).toEqual(["active_17"]);
      expect((await json([dir, "--waiting-on=THEM"])).rows).toEqual([]);
      expect((await json([dir, "--quiet", "--waiting"])).rows).toEqual([]);
      const none = await runInsight(friendsCommand, [dir, "--waiting-on", "them"]);
      expect(none.out).toContain("No friends match your filters.");
      expect(none.out).not.toMatch(TABLE_ROW);
      expect(none.out).toContain("Hints come from saved chats");
    });

    it("filters by the day a friend was added and by the last chat or Snap, inclusive at both ends", async () => {
      const dir = parts("friends-dates");
      const all = (await json([dir])).rows;
      const days = all.map((r) => r.addedDay).filter((d): d is string => d !== null).sort();
      const first = days[0] as string;
      const last = days.at(-1) as string;
      const one = await json([dir, "--added-from", first, "--added-to", first]);
      expect(one.rows.map((r) => r.addedDay)).toEqual(all.filter((r) => r.addedDay === first).map((r) => r.addedDay));
      expect(one.rows.length).toBeGreaterThan(0);
      const recent = await json([dir, "--added-from", "2025-01-01"]);
      expect(recent.rows).toEqual(all.filter((r) => r.addedDay !== null && r.addedDay >= "2025-01-01"));
      expect((await json([dir, "--added-to", last])).rows).toHaveLength(all.filter((r) => r.addedDay !== null).length);
      const lastDay = (all.map((r) => r.lastDay).filter((d): d is string => d !== null).sort().at(-1)) as string;
      const lastly = await json([dir, "--last-from", lastDay]);
      expect(lastly.rows.length).toBeGreaterThan(0);
      expect(lastly.rows.every((r) => r.lastDay === lastDay)).toBe(true);
      // A friend with no chats never matches a last-chat range.
      expect((await json([dir, "--last-to", "2100-01-01"])).rows.every((r) => r.lastAt !== null)).toBe(true);
      expect((await runInsight(friendsCommand, [dir, "--added-from", "2025-01-01"])).out).toMatch(/Showing \d+ of \d+ friends that match your filters\./);
    });

    it("reads days and dates in the --utc-offset time zone", async () => {
      const dir = parts("friends-offset");
      const shifted = await json([dir, "--utc-offset", "5:30"]);
      expect(shifted.utcOffsetMinutes).toBe(330);
      for (const r of shifted.rows) {
        if (r.addedAt !== null) expect(r.addedDay).toBe(new Date(r.addedAt + 330 * 60_000).toISOString().slice(0, 10));
      }
      const some = shifted.rows.find((r) => r.addedDay !== null) as Row;
      const same = await json([dir, "--utc-offset", "5:30", "--added-from", some.addedDay as string, "--added-to", some.addedDay as string]);
      expect(same.rows.map((r) => r.id)).toContain(some.id);
      expect(same.rows.every((r) => r.addedDay === some.addedDay)).toBe(true);
      const west = await json([dir, "--utc-offset=-5"]);
      expect(west.utcOffsetMinutes).toBe(-300);
      expect((await json([dir])).utcOffsetMinutes).toBe(0);
    });

    it("caps the text table with --limit, and counts the rest", async () => {
      const dir = parts("friends-limit");
      const text = await runInsight(friendsCommand, [dir, "--limit", "4"]);
      expect(text.out.split("\n").filter((line) => TABLE_ROW.test(line))).toHaveLength(4);
      expect(text.out).toContain("26 more not shown. Use --limit to show more.");
      const all = await runInsight(friendsCommand, [dir, "--limit", "30"]);
      expect(all.out.split("\n").filter((line) => TABLE_ROW.test(line))).toHaveLength(30);
      expect(all.out).not.toContain("more not shown");
      // JSON holds every match whatever the limit.
      expect((await json([dir, "--limit", "1"])).rows).toHaveLength(30);
    });
  });

  it("prints JSON with the rows, the counts and note codes only", async () => {
    const dir = parts("friends-json");
    const { code, out } = await runInsight(friendsCommand, [dir, "--json"]);
    expect(code).toBe(0);
    const data = JSON.parse(out) as Json;
    expect(Object.keys(data)).toEqual(["generatedAt", "asOf", "utcOffsetMinutes", "saved", "summary", "matching", "rows", "notes"]);
    expect(data.generatedAt).toBe(new Date(NOW).toISOString());
    expect(data.asOf).toBe(new Date(LATER).toISOString());
    expect(data.saved).toBe(false);
    expect(data.summary).toEqual({ friends: 30, withEvents: 28, quiet: 6, oneSided: 0, waiting: 1 });
    expect(data.matching).toBe(30);
    expect(Object.keys(data.rows[0] as Row)).toEqual([
      "id", "username", "addedAt", "firstAt", "lastAt", "addedDay", "firstDay", "lastDay", "recent", "total", "sent", "received", "unknown", "quiet", "oneSided", "waiting", "waitingOn",
    ]);
    expect(out.endsWith("\n")).toBe(true);
    // Notes hold codes and whole numbers, never a person.
    expect(JSON.stringify(data.notes)).not.toMatch(USERNAME);
    expect(data.notes.every((n) => /^[a-z-]+$/.test(n.code) && Object.values(n.params).every(Number.isInteger))).toBe(true);
  });

  it("adds the short code to each note only with --verbose", async () => {
    const dir = parts("friends-verbose");
    const verbose = await runInsight(friendsCommand, [dir, "--verbose"]);
    expect(verbose.out).toContain("code: group-events-skipped");
    expect(verbose.out).toContain("code: events-not-with-friends");
  });

  it("stops on a damaged ZIP file with the problems and exit code 2, and saves no file", async () => {
    const dir = tempDir("friends-damaged");
    const full = syntheticExportZip({ now: LATER, friendCount: 40, memoryCount: 20 });
    const damaged = join(dir, "damaged.zip");
    writeFileSync(damaged, full.subarray(0, Math.floor(full.length * 0.6)));
    const target = join(dir, "friends.csv");
    const { code, out, err } = await runInsight(friendsCommand, [damaged, "--out", target]);
    expect(code).toBe(2);
    expect(err).toBe("");
    expect(out).toContain("Problems found");
    expect(out).toContain("Snappy did not list friends from a broken export.");
    expect(out).not.toContain("At a glance");
    expect(out.endsWith("Nothing here has left this device.\n")).toBe(true);
    expectBrandSafe(out, "damaged");
    expect(existsSync(target)).toBe(false);
    const asJson = await runInsight(friendsCommand, [damaged, "--json"]);
    expect(asJson.code).toBe(2);
    expect(JSON.parse(asJson.out)).toMatchObject({ stopped: "export-errors" });
  });

  it("uses no color with --no-color or NO_COLOR, and color on a color terminal", async () => {
    const dir = parts("friends-color");
    const color = await runInsight(friendsCommand, [dir], makeIo({ interactive: true, env: { COLORTERM: "truecolor" } }));
    expect(color.out).toContain("\x1b[");
    const flagged = await runInsight(friendsCommand, [dir, "--no-color"], makeIo({ interactive: true, env: { COLORTERM: "truecolor" } }));
    expect(flagged.out).not.toContain("\x1b");
    const env = await runInsight(friendsCommand, [dir], makeIo({ interactive: true, env: { NO_COLOR: "1" } }));
    expect(env.out).not.toContain("\x1b");
  });

  it("reads no ledger, asks for no passphrase and writes no file without --out", async () => {
    const home = tempDir("friends-home");
    const dir = parts("friends-ro");
    const before = readdirSync(dir).sort();
    for (const args of [[dir], [dir, "--json"], [dir, "--quiet", "--sort", "total", "--desc"]]) {
      const io = makeIo({ home });
      await runInsight(friendsCommand, args, io);
      expect(io.asked).toEqual([]);
    }
    expect(readdirSync(home)).toEqual([]);
    expect(readdirSync(dir).sort()).toEqual(before);
  });
});

describe("the spreadsheet file", () => {
  it("saves every matching row as CSV with CRLF line endings and the documented header", async () => {
    const dir = parts("friends-csv");
    const target = join(dir, "out", "friends.csv");
    const { code, out } = await runInsight(friendsCommand, [dir, "--limit", "2", "--out", target]);
    expect(code).toBe(0);
    expect(out).toContain(`Saved to ${target}.`);
    expect(out).toContain("It lists usernames, so keep it private.");
    expect(out).not.toContain("Nothing was saved.");
    const csv = readFileSync(target, "utf8");
    expect(csv.endsWith(CRLF)).toBe(true);
    expect(csv.startsWith(`${insights.friendsTable.FRIENDS_CSV_HEADER.join(",")}${CRLF}`)).toBe(true);
    // --limit shortens the screen, not the file.
    const lines = csv.split(CRLF);
    expect(lines).toHaveLength(32);
    expect(lines.at(-1)).toBe("");
    expect(csv).not.toMatch(/(?<!\r)\n/);
    const all = (await json([dir])).rows;
    expect(csv).toBe(insights.friendsTable.toCsv(all));
    expect(lines[1]).toBe("active_1,2024-11-20,2025-05-20,2026-10-31,11,62,29,33,0,no,no,");
  });

  it("saves the filtered and sorted rows, with days in the chosen time zone", async () => {
    const dir = parts("friends-csv-filter");
    const target = join(dir, "quiet.csv");
    await runInsight(friendsCommand, [dir, "--quiet", "--sort", "added", "--desc", "--out", target, "--utc-offset", "5:30"]);
    const rows = (await json([dir, "--quiet", "--sort", "added", "--desc", "--utc-offset", "5:30"])).rows;
    expect(rows).toHaveLength(6);
    expect(readFileSync(target, "utf8")).toBe(insights.friendsTable.toCsv(rows));
    const waiting = join(dir, "waiting.csv");
    await runInsight(friendsCommand, [dir, "--waiting", "--out", waiting]);
    expect(readFileSync(waiting, "utf8").split(CRLF)[1]).toMatch(/^active_17,.*,you\r?$/);
  });

  it("saves a header alone when nothing matches", async () => {
    const dir = parts("friends-csv-none");
    const target = join(dir, "none.csv");
    const { code, out } = await runInsight(friendsCommand, [dir, "--waiting-on", "them", "--out", target]);
    expect(code).toBe(0);
    expect(out).toContain("Saved to");
    expect(readFileSync(target, "utf8")).toBe(`${insights.friendsTable.FRIENDS_CSV_HEADER.join(",")}${CRLF}`);
  });

  it("reports the file in JSON and never replaces one without --force", async () => {
    const dir = parts("friends-csv-force");
    const target = join(dir, "friends.csv");
    const saved = await runInsight(friendsCommand, [dir, "--out", target, "--json"]);
    expect(JSON.parse(saved.out)).toMatchObject({ saved: true });
    expect(saved.out).not.toContain(target);
    writeFileSync(target, "keep me");
    const refused = await runInsight(friendsCommand, [dir, "--out", target]);
    expect(refused.code).toBe(1);
    expect(refused.out).toBe("");
    expect(refused.err).toContain("already exists");
    expect(refused.err).toContain("--force");
    expect(readFileSync(target, "utf8")).toBe("keep me");
    const forced = await runInsight(friendsCommand, [dir, "--out", target, "--force"]);
    expect(forced.code).toBe(0);
    expect(readFileSync(target, "utf8")).toContain("username,added");
  });

  it("needs a .csv name, and --force needs --out, before anything is read", async () => {
    const dir = tempDir("friends-csv-names");
    const wrong = await runInsight(friendsCommand, [join(dir, "missing.zip"), "--out", join(dir, "friends.txt")]);
    expect(wrong.code).toBe(1);
    expect(wrong.err).toContain("--out needs a file name ending in .csv");
    expect(wrong.err).not.toContain("could not find");
    const lonely = await runInsight(friendsCommand, [join(dir, "missing.zip"), "--force"]);
    expect(lonely.err).toContain("--force needs --out");
    expect(readdirSync(dir)).toEqual([]);
  });

  it("writes no file when an option is wrong", async () => {
    const dir = parts("friends-csv-bad");
    const target = join(dir, "friends.csv");
    for (const bad of [["--sort", "name"], ["--limit", "0"], ["--waiting-on", "both"], ["--added-from", "2026-02-30"]]) {
      const { code } = await runInsight(friendsCommand, [dir, ...bad, "--out", target]);
      expect(code).toBe(1);
    }
    expect(existsSync(target)).toBe(false);
  });
});

describe("options", () => {
  it("stops with calm messages for a missing path, no input, a wrong file and bad options", async () => {
    const dir = tempDir("friends-errors");
    const missing = await runInsight(friendsCommand, [join(dir, "missing.zip")]);
    expect(missing).toMatchObject({ code: 1, out: "" });
    expect(missing.err).toContain("could not find");
    expect((await runInsight(friendsCommand, [])).err).toContain("Give Snappy your export");
    const notZip = join(dir, "notes.txt");
    writeFileSync(notZip, "not a zip file");
    const wrong = await runInsight(friendsCommand, [notZip]);
    expect(wrong.code).toBe(1);
    expect(wrong.out).toBe("");

    const zip = writeSyntheticZip(dir, "a.zip");
    const err = async (...args: string[]): Promise<string> => (await runInsight(friendsCommand, [zip, ...args])).err;
    expect(await err("--limit", "x")).toContain("--limit must be a whole number from 1 to 1000.");
    expect(await err("--limit", "1001")).toContain("--limit must be a whole number");
    expect(await err("--sort", "name")).toContain("--sort must be one of username, added, first, last, recent, total, sent or received.");
    expect(await err("--waiting-on", "both")).toContain("--waiting-on must be you or them.");
    expect(await err("--utc-offset", "99")).toContain("--utc-offset must be hours from UTC");
    expect(await err("--added-from", "yesterday")).toContain("--added-from must be a date such as 2026-11-01.");
    expect(await err("--added-to", "2026-13-01")).toContain("--added-to must be a date such as 2026-11-01.");
    expect(await err("--last-from", "2026-02-29")).toContain("--last-from must be a date such as 2026-11-01.");
    expect(await err("--last-to", "2026-1-1")).toContain("--last-to must be a date such as 2026-11-01.");
    expect(await err("--added-from", "2026-05-02", "--added-to", "2026-05-01")).toContain("--added-from must not be after --added-to.");
    expect(await err("--sort")).toContain("needs a value");
    expect(await err("--bogus")).toContain('Snappy does not know the option --bogus for friends. Run "snappy-export help friends"');
  });

  it("accepts a leap day and a time zone at the edges", async () => {
    const dir = parts("friends-edges");
    expect((await runInsight(friendsCommand, [dir, "--added-from", "2024-02-29", "--added-to", "2024-02-29", "--json"])).code).toBe(0);
    for (const offset of ["14", "+0", "0:00", "5:45"]) expect((await runInsight(friendsCommand, [dir, "--utc-offset", offset, "--json"])).code, offset).toBe(0);
    for (const offset of ["-12", "-3:30"]) expect((await runInsight(friendsCommand, [dir, `--utc-offset=${offset}`, "--json"])).code, offset).toBe(0);
    expect((await runInsight(friendsCommand, [dir, "--utc-offset", "14:30"])).code).toBe(1);
  });

  it("checks the options before it reads anything", async () => {
    const dir = tempDir("friends-order");
    const { code, err } = await runInsight(friendsCommand, [join(dir, "missing.zip"), "--sort", "x"]);
    expect(code).toBe(1);
    expect(err).toContain("--sort must be one of");
    expect(err).not.toContain("could not find");
  });

  it("does not echo a typed value in an error", async () => {
    const dir = tempDir("friends-echo");
    const zip = writeSyntheticZip(dir, "a.zip");
    for (const bad of [["--starts-with"], ["--sort", "zq_secret_1"], ["--waiting-on", "zq_secret_1"], ["--added-from", "zq_secret_1"], ["--utc-offset", "zq_secret_1"], ["--limit", "zq_secret_1"]]) {
      const { err } = await runInsight(friendsCommand, [zip, ...bad]);
      expect(err, bad.join(" ")).not.toContain("zq_secret_1");
    }
  });
});

describe("privacy", () => {
  it("prints no canary, link or entry name, and no username outside the table", async () => {
    const dir = tempDir("friends-canary");
    const zip = writeSyntheticZip(dir, "export.zip", { bundleMedia: true });
    const folder = join(dir, "parts");
    writeSyntheticParts(folder, { memoryCount: 200 });
    const argSets = [
      [zip],
      [zip, "--json"],
      [folder],
      [folder, "--json", "--verbose"],
      [folder, "--quiet", "--verbose", "--limit", "100"],
      [folder, "--waiting", "--sort", "last", "--desc"],
      [folder, "--starts-with", "active_1", "--utc-offset", "-5"],
      [folder, "--waiting-on", "them"],
    ];
    for (const args of argSets) {
      const { out, err } = await runInsight(friendsCommand, args);
      const text = stripPaths(out + err);
      const label = args.join(" ");
      expectNoLeaks(text, label);
      expect(text, label).not.toMatch(/\.(?:jpg|mp4|png|html|json)\b|[0-9A-F]{8}-[0-9A-F]{4}/i);
      if (!args.includes("--json")) {
        // Every line that is not a table row, and everything from the notes down, is free of usernames.
        const notes = out.slice(out.indexOf("\nNotes\n"));
        expect(notes, label).not.toMatch(USERNAME);
        const prose = out.split("\n").filter((line) => !TABLE_ROW.test(line));
        expect(prose.join("\n"), label).not.toMatch(USERNAME);
      } else {
        const data = JSON.parse(out) as Json;
        expect(JSON.stringify(data.notes), label).not.toMatch(USERNAME);
        expect(JSON.stringify(data.summary), label).not.toMatch(USERNAME);
        // A row holds a username and numbers, nothing else.
        for (const r of data.rows) expect(Object.keys(r).length, label).toBe(17);
      }
    }
  });

  it("puts no username in any error path, and none in the file name it was given", async () => {
    const dir = tempDir("friends-err-privacy");
    const zip = writeSyntheticZip(dir, "a.zip");
    const notZip = join(dir, "friend_1.txt");
    writeFileSync(notZip, "x");
    const damaged = join(dir, "damaged.zip");
    writeFileSync(damaged, syntheticExportZip({ now: LATER, friendCount: 40, memoryCount: 20 }).subarray(0, 900));
    const argSets = [
      [],
      [join(dir, "missing.zip")],
      [notZip],
      [zip, "--bogus"],
      [zip, "--sort", "x"],
      [zip, "--limit", "x"],
      [zip, "--added-from", "x"],
      [zip, "--out", join(dir, "a.txt")],
      [damaged],
      [damaged, "--verbose"],
      [damaged, "--json"],
    ];
    for (const args of argSets) {
      const { out, err } = await runInsight(friendsCommand, args);
      const text = stripPaths(out + err);
      expect(text, args.join(" ")).not.toMatch(USERNAME);
      expectNoLeaks(text, args.join(" "));
    }
  });

  it("makes a hostile username safe to print", () => {
    const rows = [row(1, { username: "evil\x1b]0;title\x07name" })];
    const text = renderFriends(tableOf(rows), viewOf(rows), createTerm({ env: {}, isTTY: false, columns: 100 }), false);
    expect(text).not.toContain("\x1b");
    expect(text).not.toContain("\x07");
    expect(text).toContain("evil?]0;title?name");
  });
});

// ------------------------------------------------------------------ wording ---

const DAY = 86_400_000;

/** A hand-made row for friend n. Names are invented. */
function row(n: number, extra: Partial<Row> = {}): Row {
  const at = Date.UTC(2026, 9, 20, 12);
  return {
    id: `u:friend_${n}`,
    username: `friend_${n}`,
    addedAt: Date.UTC(2024, 1, 29, 12),
    firstAt: at - 30 * DAY,
    lastAt: at,
    addedDay: "2024-02-29",
    firstDay: "2026-09-20",
    lastDay: "2026-10-20",
    recent: 5,
    total: 12,
    sent: 7,
    received: 5,
    unknown: 0,
    quiet: false,
    oneSided: false,
    waiting: false,
    waitingOn: null,
    ...extra,
  };
}

function tableOf(rows: Row[], notes: Table["notes"] = []): Table {
  return {
    asOf: NOW,
    rows,
    summary: {
      friends: rows.length,
      withEvents: rows.filter((r) => r.total > 0).length,
      quiet: rows.filter((r) => r.quiet).length,
      oneSided: rows.filter((r) => r.oneSided).length,
      waiting: rows.filter((r) => r.waiting).length,
    },
    notes,
  };
}

const viewOf = (rows: Row[], extra: Partial<FriendsView> = {}): FriendsView => ({ sort: "username", desc: false, limit: 25, filtered: false, rows, ...extra });

const ALL_CODES = [
  "no-events", "events-without-time", "events-in-future", "group-events-skipped", "events-not-with-friends", "friends-duplicates-merged", "friends-invalid-username",
  "friends-without-added-date", "quiet-not-judged-no-activity", "quiet-not-judged-short-history", "a-code-from-the-future",
] as const;

const allNotes = (count: number): Table["notes"] => ALL_CODES.map((code) => ({ code: code as insights.friendsTable.FriendsTableNoteCode, params: { count } }));

describe("wording", () => {
  it.each([0, 1, 2, 12])("reads correctly with %i friends", (n) => {
    const rows = Array.from({ length: n }, (_, i) => row(i + 1));
    const text = renderFriends(tableOf(rows, allNotes(n)), viewOf(rows), term, false);
    expectBrandSafe(text, `count ${n}`);
    expect(text).not.toContain("a-code-from-the-future");
    expect(text).toContain("Snappy noted something it cannot describe.");
    if (n === 0) {
      expect(text).toContain("No friends to list.");
      expect(text).not.toContain("At a glance");
    } else {
      expect(text.split("\n").filter((line) => TABLE_ROW.test(line))).toHaveLength(n);
    }
  });

  it("says one, not 1 friends or 1 events", () => {
    const rows = [row(1)];
    const one = renderFriends(tableOf(rows, allNotes(1)), viewOf(rows), term, false);
    expect(one).toContain("1 friend in your export. 1 has saved chats or Snaps.");
    expect(one).toContain("Showing 1 of 1 friend. Sorted by");
    expect(one).toContain("1 event had no usable date and was left out.");
    expect(one).toContain("1 event is dated after your export. Snappy left it out.");
    expect(one).toContain("1 group chat event was left out.");
    expect(one).toContain("1 event with people outside your friends list was left out.");
    expect(one).toContain("1 repeated friend was merged, so each person is listed once.");
    expect(one).toContain("1 friend had no usable username and was left out.");
    expect(one).toContain("1 friend has no added date, so Snappy could not check them for quiet.");
    expect(one).toContain("1 friend without chats was not checked for quiet, since your chats start too recently.");
    const many = Array.from({ length: 2 }, (_, i) => row(i + 1));
    const two = renderFriends(tableOf(many, allNotes(2)), viewOf(many), term, false);
    expect(two).toContain("2 friends in your export. 2 have saved chats or Snaps.");
    expect(two).toContain("2 events had no usable date and were left out.");
    expect(two).toContain("2 events are dated after your export. Snappy left them out.");
    expect(two).toContain("2 repeated friends were merged, so each person is listed once.");
    expect(two).toContain("2 friends have no added date, so Snappy could not check them for quiet.");
  });

  it("shows each hint in words, in sentence case, and never as a verdict", () => {
    const rows = [
      row(1, { quiet: true }),
      row(2, { oneSided: true }),
      row(3, { waiting: true, waitingOn: "you" }),
      row(4, { waiting: true, waitingOn: "them", oneSided: true }),
      row(5),
    ];
    const text = renderFriends(tableOf(rows), viewOf(rows), term, false);
    expect(text).toMatch(/friend_1 .* Quiet\n/);
    expect(text).toMatch(/friend_2 .* One-sided\n/);
    expect(text).toMatch(/friend_3 .* Waiting on you\n/);
    expect(text).toMatch(/friend_4 .* One-sided, waiting on them\n/);
    expect(text).toMatch(/friend_5 .* –\n/);
    expect(text).toMatch(/Quiet +1\n/);
    expect(text).toMatch(/Waiting on a reply +2\n/);
    expect(text).not.toMatch(/\b(?:ghosts?|unfriend\w*|dormant|inactive|dead|simply|just)\b/i);
  });

  it("shows added and last dates in the day text it was given, and a dash for no date", () => {
    const rows = [row(1), row(2, { addedDay: null, lastDay: null, total: 0, sent: 0, received: 0 }), row(3, { addedDay: "2025-12-31", lastDay: "2026-01-01" })];
    const text = renderFriends(tableOf(rows), viewOf(rows), term, false);
    expect(text).toMatch(/friend_1 +Feb 29, 2024 +Oct 20, 2026 +12 +7 +5 +–\n/);
    expect(text).toMatch(/friend_2 +– +– +0 +0 +0 +–\n/);
    expect(text).toMatch(/friend_3 +Dec 31, 2025 +Jan 1, 2026 /);
  });

  it("says how the rows are sorted and filtered", () => {
    const rows = [row(1), row(2)];
    const asc = renderFriends(tableOf(rows), viewOf(rows, { sort: "added" }), term, false);
    expect(asc).toContain("Sorted by date added, oldest first.");
    const desc = renderFriends(tableOf(rows), viewOf(rows, { sort: "received", desc: true, filtered: true }), term, false);
    expect(desc).toContain("Showing 2 of 2 friends that match your filters. Sorted by chats and Snaps you received, most first.");
    expect(renderFriends(tableOf(rows), viewOf(rows, { sort: "recent" }), term, false)).toContain("Sorted by chats and Snaps in the last 90 days, fewest first.");
    expect(renderFriends(tableOf(rows), viewOf(rows, { sort: "username", desc: true }), term, false)).toContain("Sorted by username, Z to A.");
    const none = renderFriends(tableOf(rows), viewOf([], { filtered: true }), term, false);
    expect(none).toContain("No friends match your filters.");
    expect(none).toContain("2 friends in your export.");
  });

  it("caps the table at the limit and counts the rest, on a long list", () => {
    const rows = Array.from({ length: 12_000 }, (_, i) => row(i + 1));
    const text = renderFriends(tableOf(rows), viewOf(rows, { limit: 25 }), term, false);
    expect(text).toContain("Showing 25 of 12,000 friends.");
    expect(text).toContain("11,975 more not shown. Use --limit to show more.");
    expect(text.split("\n").filter((line) => TABLE_ROW.test(line))).toHaveLength(25);
  });

  it("describes an empty or unreadable table with one calm line", () => {
    const none = renderFriends(tableOf([], [{ code: "no-friends", params: {} }]), viewOf([]), term, false);
    expect(none).toContain("No friends to list.");
    expect(none).toContain("Your export has no usable friends, so the table is empty.");
    const now = renderFriends({ ...tableOf([], [{ code: "invalid-now", params: {} }]), asOf: null }, viewOf([]), term, false);
    expect(now).toContain("Snappy could not read today's date, so it left the table empty.");
    const nothing = renderFriends(tableOf([row(1)], [{ code: "no-events", params: {} }]), viewOf([row(1)]), term, false);
    expect(nothing).toContain("no saved chats or Snaps, so the chat columns are empty.");
    expect(renderFriends({ ...tableOf([row(1)]), asOf: null }, viewOf([row(1)]), term, false)).not.toContain("Counted up to");
  });

  it("names the saved file, or says nothing was saved", () => {
    const rows = [row(1)];
    expect(renderFriends(tableOf(rows), viewOf(rows), term, false)).toContain("Nothing was saved.");
    const saved = renderFriends(tableOf(rows), viewOf(rows, { savedTo: "out.csv" }), term, false);
    expect(saved).toContain("Saved to out.csv.");
    expect(saved).toContain("It lists usernames, so keep it private.");
    expect(saved).not.toContain("Nothing was saved.");
  });

  it("adds a code to each note only with verbose", () => {
    const rows = [row(1)];
    expect(renderFriends(tableOf(rows, allNotes(1)), viewOf(rows), term, false)).not.toContain("code:");
    expect(renderFriends(tableOf(rows, allNotes(1)), viewOf(rows), term, true)).toContain("code: quiet-not-judged-short-history");
  });

  it("keeps every sentence short and in sentence case", () => {
    const rows = [row(1, { quiet: true }), row(2, { waiting: true, waitingOn: "you" })];
    const text = renderFriends(tableOf(rows, allNotes(2)), viewOf(rows, { filtered: true, limit: 1 }), term, false);
    const prose = text
      .split("\n")
      .map((line) => line.replace(/^\s*(?:Warning|Note|Error)\s+/, "").trim())
      .filter((line) => /[.?]$/.test(line) && !/\s{2,}/.test(line));
    expect(prose.length).toBeGreaterThan(8);
    for (const s of prose.flatMap((line) => line.split(/(?<=[.?])\s+/))) expect(s.split(/\s+/).length, s).toBeLessThanOrEqual(20);
  });

  it("uses violet for one key figure only and never orange", () => {
    const color = createTerm({ env: { FORCE_COLOR: "1" }, isTTY: true, columns: 100 });
    const rows = [row(1), row(2)];
    const text = renderFriends(tableOf(rows), viewOf(rows), color, false);
    const opening = (paint: (s: string) => string): string => paint("x").split("x")[0] ?? "";
    expect(opening(color.violet)).toContain("\x1b[");
    expect(text.split(opening(color.violet))).toHaveLength(2);
    expect(text).not.toContain(opening(color.orange));
  });

  it("fits a narrow terminal by shortening the friend column", () => {
    const rows = [row(1, { username: "a".repeat(80) })];
    const narrow = createTerm({ env: {}, isTTY: false, columns: 80 });
    const text = renderFriends(tableOf(rows), viewOf(rows), narrow, false);
    const line = text.split("\n").find((l) => l.startsWith("  aaaa")) ?? "";
    expect(line.length).toBeLessThanOrEqual(80);
  });
});
