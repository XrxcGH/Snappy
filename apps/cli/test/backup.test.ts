/** snappy-export backup: save and check a copy of the friends list. Synthetic data only. */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { insights } from "@snappy-export/core";
import { backupCommand, renderBackup } from "../src/commands/backup.ts";
import type { BackupResult, CompareResult, CreateResult } from "../src/commands/backup.ts";
import { createTerm } from "../src/term.ts";
import { NOW, makeIo, stripPaths, tempDir, writeSyntheticParts, writeSyntheticZip } from "./helpers.ts";
import { expectBrandSafe, expectNoLeaks, expectValidDescriptor, runInsight } from "./insights-helpers.ts";

const term = createTerm({ env: {}, isTTY: false, columns: 100 });
const NAMES = /\b(?:active|dormant|newfriend|snapper|blocked|ignored)_\d+\b/;

let shared: string | undefined;
/** One synthetic export with a known friends list, ready to read. It is only ever read, so tests share it. */
function exportDir(label: string): string {
  if (shared === undefined) {
    shared = tempDir(label);
    writeSyntheticParts(shared);
  }
  return shared;
}

type BackupFile = Record<string, { username: string; createdAt?: number }[]>;

/** Save a backup of the export and return the file's path and parsed content. */
async function saveBackup(dir: string, name = "friends.json"): Promise<{ path: string; data: BackupFile }> {
  const path = join(tempDir("backup-file"), name);
  const { code } = await runInsight(backupCommand, [dir, "--out", path]);
  expect(code).toBe(0);
  return { path, data: JSON.parse(readFileSync(path, "utf8")) as BackupFile };
}

describe("the command", () => {
  it("is a valid descriptor", async () => {
    await expectValidDescriptor(backupCommand);
    expect(backupCommand.name).toBe("backup");
    expect(backupCommand.group).toBe("Friends");
  });

  it("describes the backup without printing a username, and saves nothing", async () => {
    const dir = exportDir("backup-run");
    const home = tempDir("backup-home");
    const before = readdirSync(dir).sort();
    const io = makeIo({ home });
    const { code, out, err } = await runInsight(backupCommand, [dir], io);
    expect(code).toBe(0);
    expect(err).toBe("");
    expect(out).toContain("Friends backup");
    expect(out).toContain("30 friends in this backup.");
    expect(out).toContain("Based on your export from Nov 1, 2026.");
    expect(out).toMatch(/Friends\s+30\s+30/);
    expect(out).toMatch(/Blocked\s+1\s+1/);
    expect(out).toContain("Nothing was saved. Add --out friends.json to save this backup.");
    expect(out).not.toMatch(NAMES);
    expect(out.endsWith("Nothing here has left this device.\n")).toBe(true);
    expectBrandSafe(out, "backup");
    expect(io.asked).toEqual([]);
    expect(readdirSync(dir).sort()).toEqual(before);
    expect(readdirSync(home)).toEqual([]);
  });

  it("prints usernames only when asked with --list", async () => {
    const dir = exportDir("backup-list");
    const { out } = await runInsight(backupCommand, [dir, "--list"]);
    expect(out).toMatch(/active_1\s+Nov 20, 2024/);
    expect(out).toContain("blocked_1");
    expect(out).toContain("ignored_1");
    const json = JSON.parse((await runInsight(backupCommand, [dir, "--list", "--json"])).out) as CreateResult;
    expect(json.lists?.friends).toHaveLength(30);
    expect(json.lists?.friends[0]).toEqual({ username: "active_1", createdAt: expect.any(Number) });
  });

  it("prints JSON with counts and no username by default", async () => {
    const dir = exportDir("backup-json");
    const { code, out } = await runInsight(backupCommand, [dir, "--json"]);
    expect(code).toBe(0);
    const json = JSON.parse(out) as CreateResult & { generatedAt: string };
    expect(json.generatedAt).toBe(new Date(NOW).toISOString());
    expect(json.mode).toBe("create");
    expect(json.counts).toEqual({ friends: { people: 30, dated: 30 }, blocked: { people: 1, dated: 1 }, ignored: { people: 1, dated: 1 } });
    expect(json.takenAt).toBe(NOW);
    expect(json.notes).toEqual([]);
    expect(json.lists).toBeUndefined();
    expect(out).not.toMatch(NAMES);
  });

  it("works on a single ZIP file", async () => {
    const zip = writeSyntheticZip(tempDir("backup-one"), "a.zip");
    const { code, out } = await runInsight(backupCommand, [zip]);
    expect(code).toBe(0);
    expect(out).toContain("40 friends in this backup.");
  });

  it("uses no color with --no-color and color on a color terminal", async () => {
    const dir = exportDir("backup-color");
    const color = await runInsight(backupCommand, [dir], makeIo({ interactive: true, env: { COLORTERM: "truecolor" } }));
    expect(color.out).toContain("\x1b[");
    const flagged = await runInsight(backupCommand, [dir, "--no-color"], makeIo({ interactive: true, env: { COLORTERM: "truecolor" } }));
    expect(flagged.out).not.toContain("\x1b");
  });
});

describe("saving a backup", () => {
  it("writes the file only with --out, then says where", async () => {
    const dir = exportDir("backup-out");
    const target = join(tempDir("backup-target"), "nested", "friends.json");
    const io = makeIo({ home: tempDir("backup-out-home") });
    const { code, out } = await runInsight(backupCommand, [dir, "--out", target], io);
    expect(code).toBe(0);
    expect(out).toContain(`Saved to ${target}.`);
    expect(out).toContain("The file is plain text and lists your friends. Keep it somewhere private.");
    expect(out).not.toContain("Nothing was saved");
    expect(out).not.toMatch(NAMES);
    expect(io.asked).toEqual([]);
    expect(readdirSync(io.homedir())).toEqual([]);

    const text = readFileSync(target, "utf8");
    expect(text.endsWith("\n")).toBe(true);
    const data = JSON.parse(text) as BackupFile & { format: string; version: number; takenAt: number };
    expect(data).toMatchObject({ format: "snappy-friends-backup", version: 1, takenAt: NOW });
    expect(data.friends).toHaveLength(30);
    expect(data.friends?.[0]?.username).toBe("active_1");
    expect(data.blocked).toEqual([{ username: "blocked_1", createdAt: expect.any(Number) }]);
    expectNoLeaks(text, "backup file");
  });

  it("includes the saved path in JSON", async () => {
    const dir = exportDir("backup-out-json");
    const target = join(tempDir("backup-target"), "friends.json");
    const { out } = await runInsight(backupCommand, [dir, "--out", target, "--json"]);
    expect((JSON.parse(out) as CreateResult).saved).toBe(target);
    expect(existsSync(target)).toBe(true);
  });

  it("never replaces a file without --force, and replaces it with --force", async () => {
    const dir = exportDir("backup-force");
    const target = join(tempDir("backup-target"), "friends.json");
    writeFileSync(target, "keep me");
    const refused = await runInsight(backupCommand, [dir, "--out", target]);
    expect(refused.code).toBe(1);
    expect(refused.out).toBe("");
    expect(refused.err).toContain("already exists");
    expect(refused.err).toContain("--force");
    expect(readFileSync(target, "utf8")).toBe("keep me");

    const forced = await runInsight(backupCommand, [dir, "--out", target, "--force"]);
    expect(forced.code).toBe(0);
    expect((JSON.parse(readFileSync(target, "utf8")) as { format: string }).format).toBe("snappy-friends-backup");
  });

  it("checks the file name before reading anything", async () => {
    const folder = tempDir("backup-name");
    const missing = join(folder, "missing.zip");
    const wrong = await runInsight(backupCommand, [missing, "--out", join(folder, "friends.txt")]);
    expect(wrong.code).toBe(1);
    expect(wrong.err).toContain("--out needs a file name ending in .json");
    expect(readdirSync(folder)).toEqual([]);
  });

  it("does not save anything for an export with errors", async () => {
    const folder = tempDir("backup-broken");
    const zip = join(folder, "broken.zip");
    writeFileSync(zip, zipSync({ "html/index.html": new TextEncoder().encode("<html></html>") }));
    const target = join(folder, "friends.json");
    const { code, out } = await runInsight(backupCommand, [zip, "--out", target, "--verbose"]);
    expect(code).toBe(2);
    expect(out).toContain("Problems found");
    expect(out).toContain("code: html-only-export");
    expect(out).toContain("no backup was made or checked");
    expect(existsSync(target)).toBe(false);
    expectBrandSafe(out, "broken");

    const json = JSON.parse((await runInsight(backupCommand, [zip, "--json"])).out) as { stopped: boolean; issues: { code: string }[] };
    expect(json.stopped).toBe(true);
    expect(json.issues[0]?.code).toBe("html-only-export");
  });
});

describe("checking a saved backup", () => {
  it("finds no difference between a backup and the export it came from", async () => {
    const dir = exportDir("backup-same");
    const { path } = await saveBackup(dir);
    const { code, out } = await runInsight(backupCommand, [dir, "--compare", path]);
    expect(code).toBe(0);
    expect(out).toContain("Backup check");
    expect(out).toContain("Your lists match the backup.");
    expect(out).toContain("The backup was made Nov 6, 2026.");
    expect(out).toMatch(/Friends\s+30\s+30\s+0\s+0/);
    expect(out).not.toContain("Next step");
    expect(out).not.toMatch(NAMES);
    expectBrandSafe(out, "compare");
  });

  it("reports who is missing and who is new, with names only under --list", async () => {
    const dir = exportDir("backup-diff");
    const { path, data } = await saveBackup(dir);
    data.friends = [...(data.friends ?? []).filter((f) => f.username !== "snapper_1"), { username: "gone_1" }, { username: "gone_2" }];
    writeFileSync(path, JSON.stringify(data));

    const plain = await runInsight(backupCommand, [dir, "--compare", path]);
    expect(plain.code).toBe(0);
    expect(plain.out).toContain("Your lists differ from the backup.");
    expect(plain.out).toMatch(/Friends\s+31\s+30\s+1\s+2/);
    expect(plain.out).toContain("Add --list to see the usernames.");
    expect(plain.out).not.toMatch(/gone_\d|snapper_1/);

    const listed = await runInsight(backupCommand, [dir, "--compare", path, "--list"]);
    expect(listed.out).toContain("Friends: missing from this export");
    expect(listed.out).toContain("Friends: new since the backup");
    expect(listed.out).toMatch(/gone_1\n\s+gone_2/);
    expect(listed.out).toContain("snapper_1");
    expect(listed.out).not.toContain("Add --list");
    expectBrandSafe(listed.out, "compare list");

    const json = JSON.parse((await runInsight(backupCommand, [dir, "--compare", path, "--json"])).out) as CompareResult;
    expect(json.mode).toBe("compare");
    expect(json.identical).toBe(false);
    expect(json.lists.friends).toEqual({ counts: { backup: 31, current: 30, added: 1, removed: 2, unchanged: 29 } });
    const jsonListed = JSON.parse((await runInsight(backupCommand, [dir, "--compare", path, "--json", "--list"])).out) as CompareResult;
    expect(jsonListed.lists.friends?.removed).toEqual(["gone_1", "gone_2"]);
    expect(jsonListed.lists.friends?.added).toEqual(["snapper_1"]);
  });

  it("warns when most of the backed-up friends are missing", async () => {
    const dir = exportDir("backup-many");
    const path = join(tempDir("backup-many-file"), "old.json");
    const friends = Array.from({ length: 12 }, (_, i) => ({ username: `old_${i}` }));
    writeFileSync(path, JSON.stringify({ format: "snappy-friends-backup", version: 1, takenAt: NOW, friends }));
    const { out } = await runInsight(backupCommand, [dir, "--compare", path, "--verbose"]);
    expect(out).toContain("12 of 12 backed-up friends are missing here. This export may be older or cut short.");
    expect(out).toContain("code: many-removed");
    expect(out).toContain("Notes");
    expect(out).not.toMatch(/old_\d/);
  });

  it("does not write a file or ask for a passphrase", async () => {
    const dir = exportDir("backup-cmp-ro");
    const { path } = await saveBackup(dir);
    const before = readdirSync(dir).sort();
    const home = tempDir("backup-cmp-home");
    const io = makeIo({ home });
    await runInsight(backupCommand, [dir, "--compare", path], io);
    expect(io.asked).toEqual([]);
    expect(readdirSync(home)).toEqual([]);
    expect(readdirSync(dir).sort()).toEqual(before);
  });

  it("stops with calm messages for a file it cannot read, without echoing its content", async () => {
    const dir = exportDir("backup-bad");
    const folder = tempDir("backup-bad-files");
    const files: Record<string, string> = {
      "text.json": "secret_name_1 and more text",
      "shape.json": JSON.stringify({ friends: [{ username: "secret_name_1" }] }),
      "version.json": JSON.stringify({ format: "snappy-friends-backup", version: 99, friends: [{ username: "secret_name_1" }] }),
      "nofriends.json": JSON.stringify({ format: "snappy-friends-backup", version: 1, secret_name_1: true }),
    };
    for (const [name, text] of Object.entries(files)) writeFileSync(join(folder, name), text);
    const expected: Record<string, string> = {
      "text.json": "That file is not a Snappy friends backup.",
      "shape.json": "That file is not a Snappy friends backup.",
      "version.json": "That backup comes from another version of Snappy, so it cannot be read safely.",
      "nofriends.json": "That file is not a Snappy friends backup.",
    };
    for (const name of Object.keys(files)) {
      const { code, out, err } = await runInsight(backupCommand, [dir, "--compare", join(folder, name), "--verbose"]);
      expect(code, name).toBe(1);
      expect(out, name).toBe("");
      expect(err, name).toContain(expected[name] as string);
      expect(err, name).toContain("(code: bad-backup)");
      expect(err, name).not.toContain("secret_name_1");
      expectBrandSafe(err, name);
    }
    const missing = await runInsight(backupCommand, [dir, "--compare", join(folder, "missing.json")]);
    expect(missing.code).toBe(1);
    expect(missing.err).toContain("could not find");
    const folderAsFile = await runInsight(backupCommand, [dir, "--compare", folder]);
    expect(folderAsFile.code).toBe(1);
    expect(folderAsFile.err).not.toBe("");
  });

  it("refuses a backup with too many entries", async () => {
    const dir = exportDir("backup-big");
    const path = join(tempDir("backup-big-file"), "big.json");
    const friends = Array.from({ length: insights.friendsBackup.MAX_BACKUP_ENTRIES + 1 }, () => "a");
    writeFileSync(path, JSON.stringify({ format: "snappy-friends-backup", version: 1, friends }));
    const { code, err } = await runInsight(backupCommand, [dir, "--compare", path]);
    expect(code).toBe(1);
    expect(err).toContain("holds more entries than Snappy reads");
  });
});

describe("errors", () => {
  it("stops with calm messages for no input, a missing path and bad options", async () => {
    const folder = tempDir("backup-errors");
    expect((await runInsight(backupCommand, [])).err).toContain("Give Snappy your export");
    const missing = await runInsight(backupCommand, [join(folder, "missing.zip")]);
    expect(missing).toMatchObject({ code: 1, out: "" });
    expect(missing.err).toContain("could not find");
    const zip = writeSyntheticZip(folder, "a.zip");
    expect((await runInsight(backupCommand, [zip, "--friend-count", "x"])).err).toContain("--friend-count must be a whole number");
    expect((await runInsight(backupCommand, [zip, "--bogus"])).err).toContain('Snappy does not know the option --bogus for backup. Run "snappy-export help backup"');
    expect((await runInsight(backupCommand, [zip, "--out"])).err).toContain("The option --out needs a value.");
    expect((await runInsight(backupCommand, [zip, "--compare", "  "])).err).toContain("--compare needs the path of a saved backup.");
    const both = await runInsight(backupCommand, [zip, "--out", join(folder, "x.json"), "--compare", join(folder, "y.json")]);
    expect(both.code).toBe(1);
    expect(both.err).toContain("not both");
    expect(readdirSync(folder)).toEqual(["a.zip"]);
  });

  it("names a file that is not a ZIP calmly", async () => {
    const folder = tempDir("backup-notzip");
    const junk = join(folder, "junk.txt");
    mkdirSync(folder, { recursive: true });
    writeFileSync(junk, "plain text");
    const { code, err } = await runInsight(backupCommand, [junk]);
    expect(code).toBe(1);
    expect(err).not.toBe("");
  });
});

describe("privacy", () => {
  it("prints no canary, link or entry name, and no username outside --list", async () => {
    const folder = tempDir("backup-canary");
    const zip = writeSyntheticZip(folder, "export.zip", { bundleMedia: true });
    const parts = exportDir("backup-canary-parts");
    const saved = (await saveBackup(parts)).path;
    const cases: string[][] = [
      [zip],
      [zip, "--json"],
      [parts, "--verbose"],
      [parts, "--json", "--verbose"],
      [parts, "--compare", saved, "--verbose"],
      [parts, "--compare", saved, "--json"],
      [zip, "--friend-count", "300", "--verbose"],
      [parts, "--compare", join(folder, "nope.json")],
      [zip, "--out", join(folder, "bad.txt")],
    ];
    for (const args of cases) {
      const { out, err } = await runInsight(backupCommand, args);
      const text = stripPaths(out + err);
      expectNoLeaks(text, args.join(" "));
      expect(text, args.join(" ")).not.toMatch(NAMES);
      expect(text, args.join(" ")).not.toMatch(/\.(?:jpg|mp4|png|html)\b|[0-9A-F]{8}-[0-9A-F]{4}/i);
    }
    for (const args of [[parts, "--list"], [parts, "--list", "--json"], [parts, "--compare", saved, "--list"]]) {
      const { out, err } = await runInsight(backupCommand, args);
      expectNoLeaks(out + err, args.join(" "));
    }
  });

  it("keeps usernames out of the notes of a hand-built result", () => {
    const result: CreateResult = {
      mode: "create",
      exportDate: NOW,
      takenAt: NOW,
      counts: { friends: { people: 2, dated: 1 }, blocked: { people: 0, dated: 0 }, ignored: { people: 0, dated: 0 } },
      notes: [{ code: "lists-overlap", params: { count: 2 } }],
      lists: { friends: [{ username: "sam_01", createdAt: NOW }, { username: "alex.k" }], blocked: [], ignored: [] },
    };
    const text = renderBackup(result, term, true);
    const noteLines = text.split("\n").filter((l) => /Note|code:/.test(l));
    expect(noteLines.length).toBeGreaterThan(0);
    for (const l of noteLines) expect(l).not.toMatch(/sam_01|alex\.k/);
    expect(text).toMatch(/sam_01\s+Nov 6, 2026/);
    expect(text).toMatch(/alex\.k\s+-/);
  });
});

const CREATE_CODES = ["usernames-skipped", "duplicates-merged", "timestamps-invalid", "timestamps-in-future", "entries-over-limit", "lists-overlap", "friends-empty", "time-unknown", "a-code-from-the-future"];
const COMPARE_CODES = ["current-empty", "usernames-skipped", "many-removed", "a-code-from-the-future"];

function createResult(n: number): CreateResult {
  const entries = Array.from({ length: n }, (_, i) => ({ username: `person_${i}`, ...(i % 2 === 0 && { createdAt: NOW }) }));
  return {
    mode: "create",
    exportDate: NOW,
    takenAt: n === 0 ? null : NOW,
    counts: { friends: { people: n, dated: Math.ceil(n / 2) }, blocked: { people: n, dated: 0 }, ignored: { people: 0, dated: 0 } },
    notes: CREATE_CODES.map((code) => ({ code: code as insights.friendsBackup.BackupNoteCode, params: { count: n } })),
    lists: { friends: entries, blocked: entries, ignored: [] },
  };
}

function compareResult(n: number, listed: boolean): CompareResult {
  const names = Array.from({ length: n }, (_, i) => `person_${i}`);
  const counts = { backup: n + 1, current: n, added: n, removed: n, unchanged: 1 };
  return {
    mode: "compare",
    exportDate: NOW,
    backupTakenAt: n === 0 ? null : NOW,
    identical: n === 0,
    lists: { friends: { counts, ...(listed && { added: names, removed: names }) }, blocked: null, ignored: { counts, ...(listed && { added: names, removed: [] }) } },
    notes: COMPARE_CODES.map((code) => ({ code: code as insights.friendsBackup.ComparisonNoteCode, params: { count: n, removed: n, backup: n + 1 } })),
    listed,
  };
}

describe("wording", () => {
  it.each([0, 1, 2, 12])("reads correctly with a count of %i", (n) => {
    for (const result of [createResult(n), compareResult(n, false), compareResult(n, true)] as BackupResult[]) {
      for (const verbose of [false, true]) {
        const text = renderBackup(result, term, verbose);
        expectBrandSafe(text, `${result.mode} count ${n}`);
        expect(text.includes("a-code-from-the-future")).toBe(verbose);
        expect(text).toContain("Snappy noted something it cannot describe.");
        expect(text.endsWith("Nothing here has left this device.\n")).toBe(true);
      }
    }
  });

  it("says one, not 1 entries", () => {
    const one = renderBackup(createResult(1), term, false);
    expect(one).toContain("1 friend in this backup.");
    expect(one).toContain("1 username could not be used and was left out.");
    expect(one).toContain("1 repeated entry was merged.");
    expect(one).toContain("1 date is in the future. Snappy leaves it out.");
    expect(one).toContain("1 person may be on both your friends list and your blocked list.");
    const many = renderBackup(createResult(2), term, false);
    expect(many).toContain("2 friends in this backup.");
    expect(many).toContain("2 usernames could not be used and were left out.");
    expect(many).toContain("2 repeated entries were merged.");
    expect(many).toContain("2 dates are in the future. Snappy leaves them out.");
    expect(many).toContain("2 people may be on both your friends list and your blocked list.");
  });

  it("caps a long username list and says how many more", () => {
    const entries = Array.from({ length: 250 }, (_, i) => ({ username: `person_${i}` }));
    const result = { ...createResult(250), lists: { friends: entries, blocked: [], ignored: [] } };
    const text = renderBackup(result, term, false);
    expect(text).toContain("And 50 more people.");
    expect(text).toContain("person_199");
    expect(text).not.toContain("person_200");
    const one = renderBackup({ ...result, lists: { friends: entries.slice(0, 201), blocked: [], ignored: [] } }, term, false);
    expect(one).toContain("And 1 more person.");
  });

  it("marks lists that were not compared and shows lists only when asked", () => {
    const quiet = renderBackup(compareResult(2, false), term, false);
    expect(quiet).toContain("A list that is empty in this export is not compared.");
    expect(quiet).toContain("Add --list to see the usernames.");
    expect(quiet).not.toContain("person_0");
    const listed = renderBackup(compareResult(2, true), term, false);
    expect(listed).toContain("Friends: missing from this export");
    expect(listed).toContain("Ignored: new since the backup");
    expect(listed).not.toContain("Ignored: missing from this export");
    expect(listed).not.toContain("Blocked:");
  });

  it("keeps every sentence short", () => {
    const text = [createResult(2), compareResult(2, false)].map((r) => renderBackup(r, term, false)).join("\n");
    const prose = text
      .split("\n")
      .map((line) => line.replace(/^\s*(?:Warning|Note|Error)\s+/, "").trim())
      .filter((line) => /[.?]$/.test(line) && !/\s{2,}/.test(line));
    expect(prose.length).toBeGreaterThan(8);
    for (const s of prose.flatMap((line) => line.split(/(?<=[.?])\s+/))) expect(s.split(/\s+/).length, s).toBeLessThanOrEqual(20);
    expect(text).not.toMatch(/\b(?:ghosts?|unfriend\w*|dormant|inactive|dead|simply|just)\b/i);
  });
});
