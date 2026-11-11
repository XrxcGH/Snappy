/** snappy-export lookalikes: the lookalike usernames check. Synthetic data and invented names only. */
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { zipSync } from "fflate";
import type { insights } from "@snappy-export/core";
import { describe, expect, it } from "vitest";
import { lookalikesCommand, renderLookalikes } from "../src/commands/lookalikes.ts";
import { createTerm } from "../src/term.ts";
import { LATER, NOW, makeIo, stripPaths, tempDir, writeSyntheticParts, writeSyntheticZip } from "./helpers.ts";
import { expectBrandSafe, expectNoLeaks, expectValidDescriptor, runInsight } from "./insights-helpers.ts";

type LookalikeNote = insights.lookalikeUsernames.LookalikeNote;
type LookalikePair = insights.lookalikeUsernames.LookalikePair;
type LookalikeUsernames = insights.lookalikeUsernames.LookalikeUsernames;

/** Wrapped note lines joined back into one line. */
const flat = (text: string): string => text.replace(/\n {10,}/g, " ");
const term = createTerm({ env: {}, isTTY: false, columns: 100 });

type Rows = Record<string, unknown>[];
const row = (username: string): Record<string, unknown> => ({ Username: username, "Creation Timestamp": "2024-03-01 10:00:00 UTC" });

/** An export that holds only a friends file, so every list is exactly what a test writes. */
function friendsZip(dir: string, lists: Record<string, Rows>, name = "export.zip"): string {
  const path = join(dir, name);
  const bytes = new TextEncoder().encode(JSON.stringify(lists));
  writeFileSync(path, zipSync({ "json/friends.json": [bytes, { mtime: new Date(LATER) }] }));
  return path;
}

/** Four pairs of invented names: one very close, three close. */
function lookalikeZip(dir: string): string {
  return friendsZip(dir, {
    Friends: [row("mike_t"), row("sam_k"), row("jordan_p"), row("tom_lee")],
    "Pending Requests": [row("mike.t"), row("jordann_p")],
    "Blocked Users": [row("sam_k0"), row("t0m_lee")],
  });
}

const NAMES = /\b(?:mike|sam|jordann?|tom|t0m|evil|many)[._]\w+\b/i;

describe("the command", () => {
  it("is a valid descriptor", async () => {
    await expectValidDescriptor(lookalikesCommand);
    expect(lookalikesCommand.name).toBe("lookalikes");
    expect(lookalikesCommand.group).toBe("Friends");
    expect(lookalikesCommand.synopsis).toBe("lookalikes <ZIP files...>");
    expect(lookalikesCommand.summary).toBe("Find usernames that look alike.");
  });

  it("checks the built-in synthetic export and exits 0", async () => {
    const dir = tempDir("lookalikes-parts");
    writeSyntheticParts(dir);
    const { code, out, err } = await runInsight(lookalikesCommand, [dir]);
    expect(code).toBe(0);
    expect(err).toBe("");
    expect(flat(out)).toContain("Lookalike usernames");
    expect(flat(out)).toMatch(/\d+ usernames compared\./);
    expect(flat(out)).toContain("Lookalikes are common and prove nothing. Snappy only compares names in your export.");
    expect(out.endsWith("Nothing here has left this device.\n")).toBe(true);
    expectBrandSafe(out, "synthetic");
  });

  it("lists each pair with a calm reason, the closest first", async () => {
    const zip = lookalikeZip(tempDir("lookalikes-pairs"));
    const { code, out } = await runInsight(lookalikesCommand, [zip]);
    expect(code).toBe(0);
    expect(flat(out)).toContain("8 usernames compared.");
    expect(flat(out)).toContain("How alike");
    expect(out).toMatch(/Very close\s+1\n/);
    expect(out).toMatch(/Close\s+3\n/);
    expect(out).toMatch(/Slight\s+0\n/);
    expect(flat(out)).toContain("Pairs found");
    const text = flat(out);
    expect(text).toMatch(/t0m_lee\s+tom_lee\s+Very close\s+Blocked \/ Friend\s+Similar-looking characters, resembles someone you blocked/);
    expect(text).toMatch(/jordan_p\s+jordann_p\s+Close\s+Friend \/ Request in\s+Repeated letters, a request resembles a friend/);
    expect(text).toMatch(/mike\.t\s+mike_t\s+Close\s+Request in \/ Friend\s+Dots or underscores differ/);
    expect(text).toMatch(/sam_k\s+sam_k0\s+Close\s+Friend \/ Blocked\s+Digits added, resembles someone you blocked/);
    expect(out.indexOf("t0m_lee")).toBeLessThan(out.indexOf("jordan_p"));
    expect(out.indexOf("jordan_p")).toBeLessThan(out.indexOf("sam_k"));
    expect(flat(out)).toContain("4 pairs may be worth a second look.");
    expectBrandSafe(out, "pairs");
  });

  it("prints JSON with the pairs, the totals and note codes", async () => {
    const zip = lookalikeZip(tempDir("lookalikes-json"));
    const { code, out } = await runInsight(lookalikesCommand, [zip, "--json"]);
    expect(code).toBe(0);
    const json = JSON.parse(out) as LookalikeUsernames & { generatedAt: string };
    expect(json.generatedAt).toBe(new Date(NOW).toISOString());
    expect(Object.keys(json)).toEqual(["generatedAt", "pairs", "totals", "notes"]);
    expect(json.pairs.map((p) => [p.a, p.b, p.level])).toEqual([
      ["t0m_lee", "tom_lee", "high"],
      ["jordan_p", "jordann_p", "medium"],
      ["mike.t", "mike_t", "medium"],
      ["sam_k", "sam_k0", "medium"],
    ]);
    expect(json.pairs[0]?.reasons).toEqual(["lookalike-swap"]);
    expect(json.totals).toEqual({ people: 8, pairs: 4, byLevel: { low: 0, medium: 3, high: 1 } });
    expect(json.notes).toEqual([{ code: "lookalikes-found", params: { count: 4 } }]);
  });

  it("says so when nothing looks alike", async () => {
    const zip = friendsZip(tempDir("lookalikes-none"), { Friends: [row("ada_one"), row("bob_two"), row("cy_three")] });
    const { code, out } = await runInsight(lookalikesCommand, [zip]);
    expect(code).toBe(0);
    expect(flat(out)).toContain("3 usernames compared.");
    expect(flat(out)).toContain("Snappy found no pairs of names that look alike.");
    expect(out).not.toContain("How alike");
    expect(out).not.toContain("Pairs found");
    expectBrandSafe(out, "none");
  });

  it("says one username, not 1 usernames", async () => {
    const one = await runInsight(lookalikesCommand, [friendsZip(tempDir("lookalikes-one"), { Friends: [row("ada_one")] })]);
    expect(flat(one.out)).toContain("1 username compared.");
    expect(one.out).not.toContain("1 usernames");
  });

  it("caps the table with --limit and says how many more there are", async () => {
    const zip = lookalikeZip(tempDir("lookalikes-cap"));
    const small = await runInsight(lookalikesCommand, [zip, "--limit", "2"]);
    expect(small.out).toContain("t0m_lee");
    expect(small.out).toContain("jordan_p");
    expect(small.out).not.toContain("mike_t");
    expect(small.out).toContain("And 2 more. Use --limit to see more.");
    const all = await runInsight(lookalikesCommand, [zip, "--limit", "4"]);
    expect(all.out).toContain("sam_k0");
    expect(all.out).not.toContain("more. Use --limit");
    // The cap is for text only: JSON keeps every pair.
    const json = JSON.parse((await runInsight(lookalikesCommand, [zip, "--json", "--limit", "1"])).out) as LookalikeUsernames;
    expect(json.pairs).toHaveLength(4);
  });

  it("shows counts only, with no username, with --counts", async () => {
    const zip = lookalikeZip(tempDir("lookalikes-counts"));
    const { code, out } = await runInsight(lookalikesCommand, [zip, "--counts"]);
    expect(code).toBe(0);
    expect(flat(out)).toContain("How alike");
    expect(out).toMatch(/Very close\s+1\n/);
    expect(out).not.toContain("Pairs found");
    expect(out).not.toMatch(NAMES);
    const json = JSON.parse((await runInsight(lookalikesCommand, [zip, "--counts", "--json"])).out) as LookalikeUsernames;
    expect(json.pairs).toEqual([]);
    expect(json.totals.pairs).toBe(4);
    expect(JSON.stringify(json)).not.toMatch(NAMES);
  });

  it("adds the short code to each note with --verbose", async () => {
    const zip = lookalikeZip(tempDir("lookalikes-verbose"));
    expect((await runInsight(lookalikesCommand, [zip])).out).not.toContain("code:");
    expect((await runInsight(lookalikesCommand, [zip, "--verbose"])).out).toContain("code: lookalikes-found");
  });

  it("counts a person once across lists and notes repeated rows", async () => {
    const zip = friendsZip(tempDir("lookalikes-notes"), {
      Friends: [row("mike_t"), row("MIKE_T")],
      "Blocked Users": [row("mike_t")],
    });
    const { out } = await runInsight(lookalikesCommand, [zip]);
    expect(flat(out)).toContain("1 username compared.");
    expect(flat(out)).toContain("1 extra row repeats a person already listed. Snappy counts each person once.");
  });

  it("stops with exit 2 for a broken export, in text and in JSON", async () => {
    const dir = tempDir("lookalikes-broken");
    const zip = join(dir, "broken.zip");
    writeFileSync(zip, zipSync({ "html/index.html": new TextEncoder().encode("<html></html>") }));
    const text = await runInsight(lookalikesCommand, [zip]);
    expect(text.code).toBe(2);
    expect(text.out).toContain("Snappy stopped, since a broken export could give wrong results.");
    expect(text.out).toContain("Run the check command to see what to fix.");
    expect(text.out).not.toContain("How alike");
    expect(text.out).not.toContain("code:");
    expect((await runInsight(lookalikesCommand, [zip, "--verbose"])).out).toContain("code: html-only-export");
    expectBrandSafe(text.out, "broken");
    const json = await runInsight(lookalikesCommand, [zip, "--json"]);
    expect(json.code).toBe(2);
    const data = JSON.parse(json.out) as { stopped: string; issues: { code: string; severity: string }[]; pairs?: unknown };
    expect(data.stopped).toBe("export-errors");
    expect(data.issues[0]).toEqual({ severity: "error", code: "html-only-export" });
    expect(data.pairs).toBeUndefined();
  });

  it("uses no color with --no-color or NO_COLOR, and color on a color terminal", async () => {
    const zip = writeSyntheticZip(tempDir("lookalikes-color"), "a.zip");
    const color = await runInsight(lookalikesCommand, [zip], makeIo({ interactive: true, env: { COLORTERM: "truecolor" } }));
    expect(color.out).toContain("\x1b[");
    const flagged = await runInsight(lookalikesCommand, [zip, "--no-color"], makeIo({ interactive: true, env: { COLORTERM: "truecolor" } }));
    expect(flagged.out).not.toContain("\x1b");
    const env = await runInsight(lookalikesCommand, [zip], makeIo({ interactive: true, env: { NO_COLOR: "1" } }));
    expect(env.out).not.toContain("\x1b");
  });

  it("writes no file, reads no ledger and asks for no passphrase", async () => {
    const home = tempDir("lookalikes-home");
    const dir = tempDir("lookalikes-ro");
    writeSyntheticParts(dir);
    const before = readdirSync(dir).sort();
    for (const args of [[dir], [dir, "--json"], [dir, "--counts"]]) {
      const io = makeIo({ home, env: { SNAPPY_PASSPHRASE: "should-not-be-used" } });
      await runInsight(lookalikesCommand, args, io);
      expect(io.asked).toEqual([]);
    }
    expect(readdirSync(home)).toEqual([]);
    expect(readdirSync(dir).sort()).toEqual(before);
  });

  it("does not let a hostile username reach the table raw", async () => {
    const evil = "evil\u001b]0;pwned\u0007\u001b[2Jx";
    const zip = friendsZip(tempDir("lookalikes-evil"), { Friends: [row(evil), row(`${evil}x`)] });
    const { out } = await runInsight(lookalikesCommand, [zip]);
    expect(out).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f]/);
  });

  it("stops with calm messages for a missing path, no input and bad options", async () => {
    const dir = tempDir("lookalikes-errors");
    const missing = await runInsight(lookalikesCommand, [join(dir, "missing.zip")]);
    expect(missing).toMatchObject({ code: 1, out: "" });
    expect(missing.err).toContain("could not find");
    expect((await runInsight(lookalikesCommand, [])).err).toContain("Give Snappy your export");
    const zip = writeSyntheticZip(dir, "a.zip");
    expect((await runInsight(lookalikesCommand, [zip, "--limit", "x"])).err).toContain("--limit must be a whole number from 1 to 1000.");
    expect((await runInsight(lookalikesCommand, [zip, "--limit", "0"])).err).toContain("--limit must be a whole number from 1 to 1000.");
    expect((await runInsight(lookalikesCommand, [zip, "--limit", "1001"])).err).toContain("--limit must be a whole number");
    expect((await runInsight(lookalikesCommand, [zip, "--limit"])).err).toContain("The option --limit needs a value.");
    expect((await runInsight(lookalikesCommand, [zip, "--bogus"])).err).toContain('Snappy does not know the option --bogus for lookalikes. Run "snappy-export help lookalikes"');
    expect((await runInsight(lookalikesCommand, [zip, "--out", join(dir, "x.txt")])).err).toContain("Snappy does not know the option --out for lookalikes.");
  });

  it("stops for a file that is not a zip, and for a later part alone", async () => {
    const dir = tempDir("lookalikes-wrong");
    const notZip = join(dir, "notes.txt");
    writeFileSync(notZip, "this is not a zip file at all");
    const bad = await runInsight(lookalikesCommand, [notZip]);
    expect(bad.code).toBe(1);
    expect(bad.out).toBe("");
    const parts = writeSyntheticParts(join(dir, "parts"));
    const later = await runInsight(lookalikesCommand, [parts[1] as string]);
    expect(later.code).toBe(1);
    expect(later.out).toBe("");
    expect(later.err.length).toBeGreaterThan(0);
  });
});

describe("privacy", () => {
  it("prints no canary, link or entry name from the export, in text or JSON", async () => {
    const dir = tempDir("lookalikes-canary");
    const zip = writeSyntheticZip(dir, "export.zip", { bundleMedia: true });
    const parts = join(dir, "parts");
    writeSyntheticParts(parts, { memoryCount: 200 });
    for (const args of [[zip], [zip, "--json"], [parts], [parts, "--json", "--verbose"], [zip, "--counts", "--verbose"], [zip, "--limit", "1"]]) {
      const { out, err } = await runInsight(lookalikesCommand, args);
      const text = stripPaths(out + err);
      expectNoLeaks(text, args.join(" "));
      expect(text, args.join(" ")).not.toMatch(/\.(?:jpg|mp4|png|html|json)\b|[0-9A-F]{8}-[0-9A-F]{4}/i);
    }
  });

  it("puts usernames only in the pair table, never in notes, codes or errors", async () => {
    const zip = friendsZip(tempDir("lookalikes-notes-names"), {
      Friends: [row("mike_t"), row("MIKE_T"), row("sam_k")],
      "Pending Requests": [row("mike.t")],
      "Blocked Users": [row("sam_k0")],
    });
    const { out } = await runInsight(lookalikesCommand, [zip, "--verbose"]);
    const notes = out.slice(out.indexOf("Notes"));
    expect(notes).toContain("code: lookalikes-found");
    expect(notes).toContain("code: case-duplicates");
    expect(notes).not.toMatch(NAMES);
    const head = out.slice(0, out.indexOf("Pairs found"));
    expect(head).not.toMatch(NAMES);
    const json = JSON.parse((await runInsight(lookalikesCommand, [zip, "--json"])).out) as LookalikeUsernames;
    expect(JSON.stringify(json.notes)).not.toMatch(NAMES);
    expect(JSON.stringify(json.totals)).not.toMatch(NAMES);
    for (const args of [[], [zip, "--limit", "x"], [zip, "--bogus"], [join(tempDir("lookalikes-missing"), "no.zip")]]) {
      const r = await runInsight(lookalikesCommand, args, makeIo());
      expect(r.out + r.err, args.join(" ")).not.toMatch(NAMES);
    }
  });

  it("names nobody when the export is broken", async () => {
    const dir = tempDir("lookalikes-broken-names");
    const zip = join(dir, "broken.zip");
    writeFileSync(zip, zipSync({ "html/index.html": new TextEncoder().encode("<html></html>") }));
    const r = await runInsight(lookalikesCommand, [zip, "--verbose"]);
    expect(r.out + r.err).not.toMatch(NAMES);
  });
});

/** A result with every note, and `n` as each count, to read each sentence at counts of 0, 1, 2 and 12. */
function fullResult(n: number): LookalikeUsernames {
  const pair = (i: number): LookalikePair => ({
    a: `person_${i}`,
    b: `persson_${i}`,
    aLists: ["friends", "blocked"],
    bLists: ["pendingRequests", "sentRequests"],
    reasons: ["lookalike-swap", "separator-differs", "repeated-characters", "appended-digits", "digits-differ", "one-edit"],
    contexts: ["pending-resembles-friend", "resembles-blocked"],
    score: 1,
    level: "high",
  });
  const codes = ["no-people", "no-lookalikes", "lookalikes-found", "list-truncated", "case-duplicates", "blank-entries", "overlong-entries", "crowded-groups", "a-code-from-the-future"] as const;
  const notes: LookalikeNote[] = codes.map((code) => ({ code: code as LookalikeNote["code"], params: { count: n, people: n, shown: n, total: n + 5 } }));
  return {
    generatedAt: NOW,
    pairs: Array.from({ length: n }, (_, i) => pair(i + 1)),
    totals: { people: n, pairs: n, byLevel: { low: 0, medium: 0, high: n } },
    notes,
  };
}

describe("wording", () => {
  it.each([0, 1, 2, 12])("reads correctly with a count of %i", (n) => {
    const text = renderLookalikes(fullResult(n), term, false);
    expectBrandSafe(text, `count ${n}`);
    expect(text).not.toContain("a-code-from-the-future");
    expect(text).toContain("Snappy noted something it cannot describe.");
    expect(text).toContain("Run it with --verbose and share the code.");
    const counts = renderLookalikes(fullResult(n), term, false, { counts: true });
    expect(counts).not.toContain("person_");
    expectBrandSafe(counts, `counts only ${n}`);
  });

  it("says one, not 1 plural, and agrees the verbs", () => {
    const one = flat(renderLookalikes(fullResult(1), term, false));
    expect(one).toContain("1 username compared.");
    expect(one).toContain("1 pair may be worth a second look.");
    expect(one).toContain("1 extra row repeats a person already listed.");
    expect(one).toContain("1 row has no username. Snappy leaves it out.");
    expect(one).toContain("1 username is too long to compare. Snappy leaves it out.");
    expect(one).toContain("1 person has a name in a long numbered family. Snappy does not compare it.");
    const two = flat(renderLookalikes(fullResult(2), term, false));
    expect(two).toContain("2 usernames compared.");
    expect(two).toContain("2 pairs may be worth a second look.");
    expect(two).toContain("2 extra rows repeat a person already listed.");
    expect(two).toContain("2 rows have no username. Snappy leaves them out.");
    expect(two).toContain("2 usernames are too long to compare. Snappy leaves them out.");
    expect(two).toContain("2 people have names in a long numbered family. Snappy does not compare them.");
    expect(two).toContain("Snappy kept the closest 2 of 7 pairs.");
  });

  it("names every reason and context in plain words", () => {
    const text = flat(renderLookalikes(fullResult(1), term, false));
    expect(text).toContain("Similar-looking characters, dots or underscores differ, repeated letters, digits added, digits differ, one character apart");
    expect(text).toContain("a request resembles a friend, resembles someone you blocked");
    expect(text).toContain("Friend, Blocked / Request in, Request sent");
  });

  it("caps rows at the limit and counts the rest", () => {
    const text = renderLookalikes(fullResult(12), term, false, { limit: 5 });
    expect(text).toContain("person_5");
    expect(text).not.toContain("person_6");
    expect(text).toContain("And 7 more. Use --limit to see more.");
  });

  it("counts only the very close and close pairs as worth a second look", () => {
    const base = fullResult(2);
    const slightPair = (i: number): LookalikePair => ({ ...(base.pairs[0] as LookalikePair), a: `slight_${i}`, b: `sliight_${i}`, level: "low" });
    const mixed: LookalikeUsernames = {
      ...base,
      pairs: [...base.pairs, slightPair(1), slightPair(2), slightPair(3)],
      totals: { people: 9, pairs: 5, byLevel: { low: 3, medium: 0, high: 2 } },
    };
    const text = flat(renderLookalikes(mixed, term, false));
    expect(text).not.toContain("Worth a second look");
    expect(text).toContain("Pairs found");
    expect(text).toContain("2 pairs may be worth a second look.");
    expect(text).not.toContain("5 pairs may be worth a second look.");
    const slight = flat(renderLookalikes({ ...mixed, pairs: mixed.pairs.slice(2), totals: { people: 9, pairs: 3, byLevel: { low: 3, medium: 0, high: 0 } }, notes: [{ code: "lookalikes-found", params: { count: 3 } }] }, term, false));
    expect(slight).not.toContain("worth a second look");
    expect(slight).toContain("3 pairs are only slightly alike.");
    const one = flat(renderLookalikes({ ...mixed, totals: { people: 9, pairs: 4, byLevel: { low: 3, medium: 1, high: 0 } }, notes: [{ code: "lookalikes-found", params: { count: 4 } }] }, term, false));
    expect(one).toContain("1 pair may be worth a second look.");
  });

  it("keeps every sentence short and in sentence case", () => {
    const text = renderLookalikes(fullResult(2), term, false);
    const prose = text
      .split("\n")
      .map((line) => line.replace(/^\s*(?:Warning|Note|Error)\s+/, "").trim())
      .filter((line) => /[.?]$/.test(line) && !/\s{2,}/.test(line));
    expect(prose.length).toBeGreaterThan(8);
    for (const s of prose.flatMap((line) => line.split(/(?<=[.?])\s+/))) expect(s.split(/\s+/).length, s).toBeLessThanOrEqual(20);
    expect(text).not.toMatch(/\b(?:ghosts?|unfriend\w*|dormant|inactive|dead|simply|just|fake|impostor|scam\w*|fraud\w*)\b/i);
  });
});
