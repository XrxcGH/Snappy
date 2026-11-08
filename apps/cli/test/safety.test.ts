/** snappy-export safety: the self-reported account safety checklist. Synthetic data only. */
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { insights, syntheticExportZip } from "@snappy-export/core";
import { SAFETY_USAGE, renderSafety, safetyCommand } from "../src/commands/safety.ts";
import { createTerm } from "../src/term.ts";
import { LATER, NOW, makeIo, stripPaths, tempDir, writeSyntheticParts, writeSyntheticZip } from "./helpers.ts";
import { expectBrandSafe, expectNoLeaks, expectValidDescriptor, runInsight } from "./insights-helpers.ts";

type Checklist = insights.safetyChecklist.SafetyChecklist;
const term = createTerm({ env: {}, isTTY: false, columns: 100 });
const IDS = insights.safetyChecklist.SAFETY_ITEM_IDS;
const USERNAME = /\b(?:ghost|oneway|dormant|active|newfriend|blocked|ignored|pending|suggest)_\d+\b/;

/** A hand-built result with `n` as the count in every note and hint. */
function built(n: number, doneIds: string[] = []): Checklist {
  const base = insights.safetyChecklist.buildSafetyChecklist({
    now: NOW,
    ticks: Object.fromEntries(doneIds.map((id) => [id, true])),
    friends: {
      blocked: Array.from({ length: n }, (_, i) => ({ username: `b${i}` })),
      pendingRequests: Array.from({ length: n }, (_, i) => ({ username: `p${i}` })),
    },
  });
  const notes = ["tick-ids-unknown", "tick-ids-duplicate", "tick-times-future", "export-not-used", "a-code-from-the-future"].map((code) => ({ code, params: { count: n } }));
  return { ...base, notes };
}

describe("the command", () => {
  it("is a valid descriptor", async () => {
    await expectValidDescriptor(safetyCommand);
    expect(safetyCommand.name).toBe("safety");
    expect(safetyCommand.group).toBe("Checklists");
    expect(safetyCommand.usage).toBe(SAFETY_USAGE);
  });

  it("prints the list with stable ids and nothing marked, with no export given", async () => {
    const { code, out, err } = await runInsight(safetyCommand, []);
    expect(code).toBe(0);
    expect(err).toBe("");
    expect(out).toContain("Account safety checklist");
    expect(out).toContain("0 of 7 items marked done (0%).");
    expect(out).toContain("This list is self-reported. Snappy cannot see your settings.");
    for (const id of IDS) expect(out).toContain(id);
    expect(out).not.toContain("From your export");
    expect(out).toContain("Run this again with --done");
    expect(out.endsWith("Nothing here has left this device.\n")).toBe(true);
    expectBrandSafe(out, "safety");
  });

  it("computes progress from --done, repeatable and comma separated", async () => {
    const { code, out } = await runInsight(safetyCommand, ["--done", "two-step-verification,strong-password", "--done", "connected-apps"]);
    expect(code).toBe(0);
    expect(out).toContain("3 of 7 items marked done (43%).");
    expect(out).toMatch(/1\s+Done\s+two-step-verification/);
    expect(out).toMatch(/2\s+To do\s+recovery-contacts/);
    expect(out).toMatch(/4\s+Done\s+connected-apps/);
    expectBrandSafe(out, "partial");
  });

  it("accepts ids in any case, counts a repeated id once, and finishes with a calm line when all are done", async () => {
    const all = await runInsight(safetyCommand, ["--done", IDS.join(",").toUpperCase(), "--done", IDS[0]]);
    expect(all.out).toContain("7 of 7 items marked done (100%).");
    expect(all.out).toContain("Everything on the list is marked done.");
    expect(all.out).not.toContain("Run this again");
    expectBrandSafe(all.out, "all done");
  });

  it("calls the steps names, not ids, in the help, the table and the next step", async () => {
    const help = (await runInsight(safetyCommand, ["--help"])).out;
    expect(help).toContain("--done <names>");
    expect(help).not.toMatch(/\bids?\b/i);
    const out = (await runInsight(safetyCommand, [])).out;
    expect(out).toMatch(/^ *# +Status +Name +What to check/m);
    expect(out).not.toMatch(/\bIds?\b/);
    expect(out).toContain("the names you finished");
  });

  it("wraps its help like every other command, at about 100 characters", () => {
    for (const line of SAFETY_USAGE.split("\n")) expect(line.length, line).toBeLessThanOrEqual(100);
  });

  it("prints JSON with ids, statuses and counts only", async () => {
    const { code, out } = await runInsight(safetyCommand, ["--json", "--done", "blocked-list"]);
    expect(code).toBe(0);
    const json = JSON.parse(out) as Checklist & { generatedAt: string };
    expect(json.generatedAt).toBe(new Date(NOW).toISOString());
    expect(json.selfReported).toBe(true);
    expect(json.items.map((i) => i.id)).toEqual([...IDS]);
    expect(json.items.find((i) => i.id === "blocked-list")?.status).toBe("done");
    expect(json.progress).toMatchObject({ total: 7, done: 1, todo: 6, stale: 0 });
    expect(Object.keys(json)).toEqual(["generatedAt", "selfReported", "items", "progress", "signals", "notes"]);
  });

  it("adds two counts from an export, never a username", async () => {
    const zip = writeSyntheticZip(tempDir("safety-zip"), "a.zip", { bundleMedia: true });
    const text = await runInsight(safetyCommand, [zip, "--done", "blocked-list"]);
    expect(text.code).toBe(0);
    const json = JSON.parse((await runInsight(safetyCommand, [zip, "--json"])).out) as Checklist;
    expect(json.signals.blocked).toBeGreaterThan(0);
    expect(json.signals.pending).toBeGreaterThan(0);
    expect(text.out).toContain("From your export");
    expect(text.out).toMatch(/Your export lists \d+ blocked (?:person|people)\. Item 6 may be worth a look\./);
    expect(text.out).toMatch(/Your export lists \d+ pending requests?\. Item 5 may be worth a look\./);
    expect(text.out).toMatch(/6\s+Done\s+blocked-list/);
    expect(text.out).not.toMatch(USERNAME);
    expectBrandSafe(text.out, "with export");
  });

  it("leaves the counts out when the export cannot be used, and says so", async () => {
    const dir = tempDir("safety-damaged");
    const full = syntheticExportZip({ now: LATER, friendCount: 40, memoryCount: 20 });
    const damaged = join(dir, "damaged.zip");
    writeFileSync(damaged, full.subarray(0, Math.floor(full.length * 0.6)));
    const { code, out } = await runInsight(safetyCommand, [damaged, "--verbose"]);
    expect(code).toBe(0);
    expect(out).toContain("Your export looks unusable, so Snappy left its counts out.");
    expect(out).toContain("code: export-not-used");
    expect(out).not.toContain("From your export");
    expectBrandSafe(out, "damaged");
  });

  it("reads the export from a folder of parts too", async () => {
    const dir = tempDir("safety-parts");
    writeSyntheticParts(dir);
    const { code, out } = await runInsight(safetyCommand, [dir]);
    expect(code).toBe(0);
    expect(out).toContain("Account safety checklist");
  });

  it("uses no color with --no-color, and color on a color terminal", async () => {
    const color = await runInsight(safetyCommand, [], makeIo({ interactive: true, env: { COLORTERM: "truecolor" } }));
    expect(color.out).toContain("\x1b[");
    const plain = await runInsight(safetyCommand, ["--no-color"], makeIo({ interactive: true, env: { COLORTERM: "truecolor" } }));
    expect(plain.out).not.toContain("\x1b");
  });

  it("writes no file, reads no ledger and asks for no passphrase", async () => {
    const home = tempDir("safety-home");
    const dir = tempDir("safety-ro");
    writeSyntheticParts(dir);
    const before = readdirSync(dir).sort();
    const io = makeIo({ home });
    await runInsight(safetyCommand, [dir, "--done", "connected-apps"], io);
    expect(io.asked).toEqual([]);
    expect(readdirSync(home)).toEqual([]);
    expect(readdirSync(dir).sort()).toEqual(before);
  });

  it("stops with calm messages for a bad id, a missing path and an unknown option", async () => {
    const dir = tempDir("safety-errors");
    const bad = await runInsight(safetyCommand, ["--done", "alice_01"]);
    expect(bad).toMatchObject({ code: 1, out: "" });
    expect(bad.err).toContain("--done has a name Snappy does not know.");
    expect(bad.err).not.toContain("alice_01");
    const missing = await runInsight(safetyCommand, [join(dir, "missing.zip")]);
    expect(missing).toMatchObject({ code: 1, out: "" });
    expect(missing.err).toContain("could not find");
    const empty = await runInsight(safetyCommand, ["--done"]);
    expect(empty.err).toContain("The option --done needs a value.");
    expect((await runInsight(safetyCommand, ["--bogus"])).err).toContain('Snappy does not know the option --bogus for safety. Run "snappy-export help safety"');
  });
});

describe("privacy", () => {
  it("prints no canary, link, file name or username, in text, JSON, verbose or error output", async () => {
    const dir = tempDir("safety-canary");
    const zip = writeSyntheticZip(dir, "export.zip", { bundleMedia: true });
    const parts = join(dir, "parts");
    writeSyntheticParts(parts);
    const argsList = [[], [zip], [zip, "--json"], [parts, "--verbose", "--done", "blocked-list"], [zip, "--done", "nope", "--verbose"], [join(dir, "missing.zip"), "--verbose"]];
    for (const args of argsList) {
      const { out, err } = await runInsight(safetyCommand, args);
      const text = stripPaths(out + err);
      expectNoLeaks(text, args.join(" "));
      expect(text, args.join(" ")).not.toMatch(USERNAME);
      expect(text, args.join(" ")).not.toMatch(/\.(?:jpg|mp4|png|html|json)\b|[0-9A-F]{8}-[0-9A-F]{4}/i);
    }
  });
});

describe("wording", () => {
  it.each([0, 1, 2, 12])("reads correctly with a count of %i", (n) => {
    const text = renderSafety(built(n), term, false);
    expectBrandSafe(text, `count ${n}`);
    expect(text).not.toContain("a-code-from-the-future");
    expect(text).toContain("Snappy noted something it cannot describe.");
    expect(text).not.toMatch(USERNAME);
    expect(text).not.toMatch(/\bb\d+\b|\bp\d+\b/);
  });

  it("says one, not 1 ids, and keeps a verb that agrees with the count", () => {
    const one = renderSafety(built(1), term, false);
    expect(one).toContain("Your export lists 1 blocked person. Item 6 may be worth a look.");
    expect(one).toContain("Your export lists 1 pending request. Item 5 may be worth a look.");
    expect(one).toContain("1 name did not match the list. Snappy left it out.");
    expect(one).toContain("1 name was given more than once.");
    expect(one).toContain("1 date is in the future. Snappy left it out.");
    const many = renderSafety(built(2), term, false);
    expect(many).toContain("Your export lists 2 blocked people.");
    expect(many).toContain("Your export lists 2 pending requests.");
    expect(many).toContain("2 names did not match the list. Snappy left them out.");
    expect(many).toContain("2 names were given more than once.");
    expect(many).toContain("2 dates are in the future. Snappy left them out.");
  });

  it("shows the short code only with --verbose", () => {
    expect(renderSafety(built(2), term, false)).not.toContain("code:");
    expect(renderSafety(built(2), term, true)).toContain("code: tick-ids-unknown");
  });

  it("labels an item that needs a fresh look, in words as well as position", () => {
    const stale = insights.safetyChecklist.buildSafetyChecklist({
      now: NOW,
      ticks: { "logged-in-devices": { done: true, at: NOW - 200 * 86_400_000 } },
    });
    const text = renderSafety(stale, term, false);
    expect(text).toMatch(/Look again\s+logged-in-devices/);
    expect(text).toContain("0 of 7 items marked done (0%).");
    expectBrandSafe(text, "stale");
  });

  it("keeps every sentence short and in sentence case", () => {
    const text = renderSafety(built(2), term, false);
    const prose = text
      .split("\n")
      .map((line) => line.replace(/^\s*(?:Warning|Note|Error)\s+/, "").trim())
      .filter((line) => /[.?]$/.test(line) && !/\s{2,}/.test(line));
    expect(prose.length).toBeGreaterThan(5);
    for (const s of prose.flatMap((line) => line.split(/(?<=[.?])\s+/))) expect(s.split(/\s+/).length, s).toBeLessThanOrEqual(20);
    expect(text).not.toMatch(/\b(?:ghosts?|unfriend\w*|dormant|inactive|dead|simply|just|ticked?)\b/i);
  });
});
