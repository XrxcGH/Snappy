/** snappy-export privacy: the self-reported privacy tune-up checklist. Synthetic data only. */
import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { insights } from "@snappy-export/core";
import { privacyCommand, renderPrivacy } from "../src/commands/privacy.ts";
import { createTerm } from "../src/term.ts";
import { NOW, makeIo, stripPaths, tempDir, writeSyntheticZip } from "./helpers.ts";
import { expectBrandSafe, expectNoLeaks, expectValidDescriptor, runInsight } from "./insights-helpers.ts";

const term = createTerm({ env: {}, isTTY: false, columns: 100 });
const { PRIVACY_TUNEUP_ITEMS, buildPrivacyTuneup } = insights.privacyTuneup;
const IDS = PRIVACY_TUNEUP_ITEMS.map((i) => i.id);

describe("the command", () => {
  it("is a valid descriptor", async () => {
    await expectValidDescriptor(privacyCommand);
    expect(privacyCommand.name).toBe("privacy");
    expect(privacyCommand.group).toBe("Checklists");
  });

  it("prints the whole list with stable ids and nothing marked, and exits 0", async () => {
    const io = makeIo();
    const { code, out, err } = await runInsight(privacyCommand, [], io);
    expect(code).toBe(0);
    expect(err).toBe("");
    expect(out).toContain("Privacy tune-up");
    expect(out).toContain("0 of 9 settings marked done, 0%.");
    for (const id of IDS) expect(out).toContain(id);
    for (const heading of ["Who can reach you", "Who can see you", "Your location", "Public", "Ads and data"]) expect(out).toContain(heading);
    expect(out).toContain("To do");
    expect(out).not.toMatch(/\bDone {2,}/);
    expect(out).toContain("Next\n  Who can contact you.");
    expect(out).toContain("Run again with --done contact-me when you have checked it.");
    expect(out).toContain("Nothing is marked yet.");
    expect(out).toContain("These marks are what you told Snappy. It cannot see your settings.");
    expect(out).toContain("Marks are not saved.");
    expect(out.endsWith("Nothing here has left this device.\n")).toBe(true);
    expect(io.asked).toEqual([]);
    expectBrandSafe(out, "privacy");
  });

  it("computes progress from --done, repeated and comma separated, for this run only", async () => {
    const { code, out } = await runInsight(privacyCommand, ["--done", "contact-me,Search", "--done", " quick-add "]);
    expect(code).toBe(0);
    expect(out).toContain("3 of 9 settings marked done, 33%.");
    expect(out).toMatch(/Done {5}contact-me/);
    expect(out).toMatch(/Done {5}search/);
    expect(out).toMatch(/To do {4}group-invites/);
    expect(out).toContain("Next\n  Group chat invites.");
    // Marks are not saved, so the next command keeps the earlier marks.
    const marked = ["contact-me", "search", "quick-add"];
    const inListOrder = IDS.filter((id) => marked.includes(id));
    expect(out).toContain(`Run again with --done ${[...inListOrder, "group-invites"].join(",")} when you have checked it.`);
    expect(out).not.toContain("(group-invites)");
    expect(out).not.toContain("Run again with --done group-invites when");
    expect(out).not.toContain("Nothing is marked yet.");
    const again = await runInsight(privacyCommand, []);
    expect(again.out).toContain("0 of 9 settings marked done");
  });

  it("counts a repeated id once and finishes the list", async () => {
    const one = await runInsight(privacyCommand, ["--done", "contact-me,contact-me"]);
    expect(one.out).toContain("1 of 9 settings marked done, 11%.");
    const all = await runInsight(privacyCommand, ["--done", IDS.join(",")]);
    expect(all.code).toBe(0);
    expect(all.out).toContain("9 of 9 settings marked done, 100%.");
    expect(all.out).toContain("Everything is marked done.");
    expect(all.out).not.toContain("Next\n");
    expect(all.out).not.toContain("To do");
    expectBrandSafe(all.out, "all done");
  });

  it("names the map setting without the retired word", async () => {
    const { out } = await runInsight(privacyCommand, ["--json"]);
    expect(out).not.toMatch(/ghost/i);
    const text = (await runInsight(privacyCommand, [])).out;
    expect(text).toContain("Map and location sharing");
    expect(text).not.toMatch(/ghost/i);
  });

  it("prints the labels and hints from core, with Snaps capitalized, and no lowercase snaps", async () => {
    const text = (await runInsight(privacyCommand, [], makeIo({ columns: 200 }))).out;
    for (const i of insights.privacyTuneup.PRIVACY_TUNEUP_ITEMS) {
      expect(text, i.id).toContain(i.title);
      expect(text, i.id).toContain(i.hint);
    }
    expect(text).toContain("Check who may send you Snaps and chats.");
    expect(text).not.toMatch(/\bsnaps\b/);
  });

  it("prints JSON with ids, states and counts, and a clock-based date", async () => {
    const { code, out } = await runInsight(privacyCommand, ["--json", "--done", "view-story"]);
    expect(code).toBe(0);
    const json = JSON.parse(out) as insights.privacyTuneup.TuneupResult & { generatedAt: string };
    expect(json.generatedAt).toBe(new Date(NOW).toISOString());
    expect(json.progress).toMatchObject({ total: 9, done: 1, todo: 8, applicable: 9, percent: 11, complete: false });
    expect(json.sections.flatMap((s) => s.items).filter((i) => i.state === "done").map((i) => i.id)).toEqual(["view-story"]);
    expect(json.nextItemId).toBe("contact-me");
    expect(json.notes.map((n) => n.code)).toEqual(["self_reported"]);
    expect(Object.keys(json)).toEqual(["generatedAt", "sections", "progress", "nextItemId", "notes"]);
  });

  it("adds the short code to each note with --verbose only", async () => {
    const quiet = await runInsight(privacyCommand, []);
    expect(quiet.out).not.toContain("code:");
    const verbose = await runInsight(privacyCommand, ["--verbose"]);
    expect(verbose.out).toContain("code: self_reported");
    expect(verbose.out).toContain("code: nothing_reviewed_yet");
  });

  it("uses no color with --no-color or NO_COLOR, and color on a color terminal", async () => {
    const color = await runInsight(privacyCommand, [], makeIo({ interactive: true, env: { COLORTERM: "truecolor" } }));
    expect(color.out).toContain("\x1b[");
    const flagged = await runInsight(privacyCommand, ["--no-color"], makeIo({ interactive: true, env: { COLORTERM: "truecolor" } }));
    expect(flagged.out).not.toContain("\x1b");
    const env = await runInsight(privacyCommand, [], makeIo({ interactive: true, env: { NO_COLOR: "1" } }));
    expect(env.out).not.toContain("\x1b");
  });

  it("writes no file, reads no ledger and asks for no passphrase", async () => {
    const home = tempDir("privacy-home");
    const io = makeIo({ home });
    await runInsight(privacyCommand, ["--done", "search"], io);
    expect(io.asked).toEqual([]);
    expect(readdirSync(home)).toEqual([]);
  });

  it("stops with calm messages for bad input", async () => {
    const unknown = await runInsight(privacyCommand, ["--done", "contact-me,not-a-setting"]);
    expect(unknown).toMatchObject({ code: 1, out: "" });
    expect(unknown.err).toContain("--done has an id Snappy does not know. Run the command without --done to see the ids.");
    expect(unknown.err).not.toContain("not-a-setting");
    expect((await runInsight(privacyCommand, ["--done"])).err).toContain("The option --done needs a value.");
    expect((await runInsight(privacyCommand, ["--bogus"])).err).toContain('Snappy does not know the option --bogus for privacy. Run "snappy-export help privacy"');
    const zip = writeSyntheticZip(tempDir("privacy-zip"), "a.zip");
    const files = await runInsight(privacyCommand, [zip]);
    expect(files).toMatchObject({ code: 1, out: "" });
    expect(files.err).toContain("takes no files");
    expect(files.err).not.toContain("a.zip");
  });
});

describe("privacy", () => {
  it("prints no canary, link, username or path, in text, JSON, --verbose and errors", async () => {
    const zip = writeSyntheticZip(tempDir("privacy-canary"), "export.zip", { bundleMedia: true });
    const runs = [[], ["--json"], ["--verbose"], ["--done", "search", "--verbose"], ["--done", "nope"], ["--done", "nope", "--verbose"], [zip], [zip, "--verbose"], ["--bogus"]];
    for (const args of runs) {
      const { out, err } = await runInsight(privacyCommand, args);
      const text = stripPaths(out + err);
      expectNoLeaks(text, args.join(" "));
      expect(text, args.join(" ")).not.toMatch(/\b(?:ghost|oneway|dormant|active|newfriend)_\d+\b/);
      expect(text, args.join(" ")).not.toContain("export.zip");
    }
  });
});

/** A result with `n` marks, mixing every state and a stale review, to read each sentence at counts of 0, 1, 2 and 12. */
function resultWith(n: number) {
  const old = NOW - 400 * 86_400_000;
  const states = ["done", "skipped", "later", "done"] as const;
  const entries = Array.from({ length: n }, (_, i) => ({
    id: IDS[i % IDS.length]!,
    state: states[i % states.length]!,
    ...(i % 4 === 3 ? { reviewedAt: old } : {}),
  }));
  // Notes only a hand-built list can produce: a future date, an unknown id and a repeated id.
  const extras = n === 0 ? [] : [{ id: IDS[0]!, state: "later" as const, reviewedAt: NOW + 86_400_000 }, { id: "unknown", state: "done" as const }];
  return buildPrivacyTuneup([...entries, ...extras], NOW);
}

describe("wording", () => {
  it.each([0, 1, 2, 12])("reads correctly with %i marks", (n) => {
    const text = renderPrivacy(resultWith(n), term, false);
    expectBrandSafe(text, `marks ${n}`);
    expect(text).toContain("Privacy tune-up");
    expect(text).not.toMatch(/\bunknown\b/);
    expect(text.endsWith("Nothing here has left this device.\n")).toBe(true);
    for (const line of text.split("\n")) expect(line, line).toBe(line.trimEnd());
  });

  it("says one and many correctly", () => {
    const one = renderPrivacy(buildPrivacyTuneup([{ id: "search", state: "done" }, { id: "search", state: "later", reviewedAt: 1 }, { id: "x", state: "done" }], NOW), term, false);
    expect(one).toContain("1 mark could not be used.");
    expect(one).toContain("1 mark was repeated. Snappy used the newest.");
    const many = renderPrivacy(buildPrivacyTuneup([{ id: "x", state: "done" }, { id: "y", state: "done" }, { id: "search", state: "done" }, { id: "search", state: "done" }, { id: "search", state: "done" }], NOW), term, false);
    expect(many).toContain("2 marks could not be used.");
    expect(many).toContain("2 marks were repeated. Snappy used the newest.");
    const future = renderPrivacy(buildPrivacyTuneup([{ id: "search", state: "done", reviewedAt: NOW + 5 }], NOW), term, false);
    expect(future).toContain("1 date in the future was left out.");
  });

  it("flags old reviews and shows skipped and later states", () => {
    const text = renderPrivacy(resultWith(12), term, false);
    expect(text).toContain("(review again)");
    expect(text).toMatch(/Skipped\s+/);
    expect(text).toMatch(/Later\s+/);
    expect(text).toContain("done settings may be worth a second look.");
    expect(text).toContain("skipped");
    expect(text).toContain("for later");
  });

  it("says there is nothing to check when every setting is skipped", () => {
    const text = renderPrivacy(buildPrivacyTuneup(IDS.map((id) => ({ id, state: "skipped" as const })), NOW), term, false);
    expect(text).toContain("No settings to check.");
    expect(text).not.toMatch(/NaN|undefined/);
  });

  it("falls back to a calm sentence for a code it does not know", () => {
    const result = buildPrivacyTuneup([], NOW);
    result.notes.push({ code: "from_the_future" as never, params: {} });
    const text = renderPrivacy(result, term, true);
    expect(text).toContain("Snappy noted something it cannot describe.");
    expect(text).toContain("code: from_the_future");
  });

  it("keeps every sentence short and in sentence case", () => {
    const text = renderPrivacy(resultWith(12), term, false);
    expect(text).not.toMatch(/\b(?:ghosts?|unfriend\w*|dormant|inactive|dead|simply|just|tick\w*)\b/i);
    const prose = text
      .split("\n")
      .map((line) => line.replace(/^\s*(?:Warning|Note|Info|Error)\s+/, "").trim())
      .filter((line) => /[.?]$/.test(line) && !/\s{2,}/.test(line));
    expect(prose.length).toBeGreaterThan(5);
    for (const s of prose.flatMap((line) => line.split(/(?<=[.?])\s+/))) expect(s.split(/\s+/).length, s).toBeLessThanOrEqual(20);
  });
});
