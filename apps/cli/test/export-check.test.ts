/** snappy-export check: the export completeness check. Synthetic data only. */
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { insights, syntheticExportZip } from "@snappy-export/core";
import { exportCheckCommand, renderExportCheck } from "../src/commands/export-check.ts";
import { createTerm } from "../src/term.ts";
import { LATER, NOW, makeIo, stripPaths, tempDir, writeSyntheticParts, writeSyntheticZip } from "./helpers.ts";
import { expectBrandSafe, expectNoLeaks, expectValidDescriptor, runInsight } from "./insights-helpers.ts";

type Check = insights.exportCheck.ExportCheck;
const term = createTerm({ env: {}, isTTY: false, columns: 100 });

describe("the command", () => {
  it("is a valid descriptor", async () => {
    await expectValidDescriptor(exportCheckCommand);
    expect(exportCheckCommand.name).toBe("check");
  });

  it("calls a complete three-part export ready, and exits 0", async () => {
    const dir = tempDir("check-parts");
    writeSyntheticParts(dir);
    const { code, out, err } = await runInsight(exportCheckCommand, [dir]);
    expect(code).toBe(0);
    expect(err).toBe("");
    expect(out).toContain("Export check");
    expect(out).toContain("Your export looks ready to use.");
    expect(out).toContain("3 ZIP files read.");
    for (const label of ["Friends list", "Chat history", "Snap history", "Memories list", "Memories files"]) expect(out).toContain(label);
    expect(out).toContain("Dates covered");
    expect(out).toContain("Made Nov 1, 2026, 5 days ago.");
    expect(out).not.toContain("What to do");
    expect(out.endsWith("Nothing here has left this device.\n")).toBe(true);
    expectBrandSafe(out, "check");
  });

  it("says what is missing and what to do for a single part, and exits 2", async () => {
    const zip = writeSyntheticZip(tempDir("check-one"), "a.zip", { bundleMedia: true });
    const { code, out } = await runInsight(exportCheckCommand, [zip]);
    expect(code).toBe(2);
    expect(out).toContain("Your export may be missing some parts.");
    expect(out).toContain("Snap history    Not found");
    expect(out).toContain("Warning  Your export may have more parts. Add the other ZIP files.");
    expect(out).toContain("What to do");
    expect(out).toContain("1. Add the other parts of your export.");
    expect(out).toContain("2. Request your data again and include: Snap history.");
    expect(out).not.toContain("code:");
    expectBrandSafe(out, "check");
  });

  it("describes a damaged ZIP file instead of refusing it", async () => {
    const dir = tempDir("check-damaged");
    const full = syntheticExportZip({ now: LATER, friendCount: 40, memoryCount: 20 });
    const damaged = join(dir, "damaged.zip");
    writeFileSync(damaged, full.subarray(0, Math.floor(full.length * 0.6)));
    const { code, out, err } = await runInsight(exportCheckCommand, [damaged]);
    expect(code).toBe(2);
    expect(err).toBe("");
    expect(out).toContain("Snappy cannot use this export yet.");
    expect(out).toContain("Error    1 ZIP file could not be read.");
    expect(out).toContain("Download your ZIP files again, since they may be damaged.");
    expectBrandSafe(out, "damaged");
  });

  it("adds the short code to each note with --verbose, and a note for a friend count that does not fit", async () => {
    const dir = tempDir("check-count");
    writeSyntheticParts(dir);
    const quiet = await runInsight(exportCheckCommand, [dir, "--friend-count", "300"]);
    expect(quiet.out).toContain("The friends list differs from the count you gave. The export may be short.");
    expect(quiet.out).toContain("When you request a new export, choose all time as the date range.");
    expect(quiet.out).not.toContain("code:");
    const verbose = await runInsight(exportCheckCommand, [dir, "--friend-count", "300", "--verbose"]);
    expect(verbose.out).toContain("code: friend-count-mismatch");
  });

  it("prints JSON with codes and counts only", async () => {
    const dir = tempDir("check-json");
    writeSyntheticParts(dir);
    const { code, out } = await runInsight(exportCheckCommand, [dir, "--json"]);
    expect(code).toBe(0);
    const json = JSON.parse(out) as Check & { generatedAt: string };
    expect(json.generatedAt).toBe(new Date(NOW).toISOString());
    expect(json.status).toBe("ready");
    expect(json.sections.map((s) => s.id)).toEqual(["friends", "chat_history", "snap_history", "memories_list", "memories_files"]);
    expect(json.parts).toEqual({ count: 3, unreadable: 0, empty: 0 });
    expect(Object.keys(json)).toEqual(["generatedAt", "status", "parts", "sections", "coverage", "age", "notes", "todo"]);
  });

  it("counts only the ZIP files it could read, so a file that is not a ZIP is not read", async () => {
    const dir = tempDir("check-notzip");
    const junk = join(dir, "notzip.zip");
    writeFileSync(junk, "not a zip");
    const one = await runInsight(exportCheckCommand, [junk, "--no-color"]);
    expect(one.out).toContain("0 of 1 ZIP file read.");
    expect(one.out).toContain("1 ZIP file could not be read.");
    expect(one.out).not.toMatch(/^ +1 ZIP file read\.$/m);
    const fine = tempDir("check-fine");
    writeSyntheticParts(fine);
    expect((await runInsight(exportCheckCommand, [fine, "--no-color"])).out).toMatch(/^ +3 ZIP files read\.$/m);
  });

  it("uses no color with --no-color or NO_COLOR, and color on a color terminal", async () => {
    const dir = tempDir("check-color");
    writeSyntheticParts(dir);
    const color = await runInsight(exportCheckCommand, [dir], makeIo({ interactive: true, env: { COLORTERM: "truecolor" } }));
    expect(color.out).toContain("\x1b[");
    const flagged = await runInsight(exportCheckCommand, [dir, "--no-color"], makeIo({ interactive: true, env: { COLORTERM: "truecolor" } }));
    expect(flagged.out).not.toContain("\x1b");
    const env = await runInsight(exportCheckCommand, [dir], makeIo({ interactive: true, env: { NO_COLOR: "1" } }));
    expect(env.out).not.toContain("\x1b");
  });

  it("writes no file, reads no ledger and asks for no passphrase", async () => {
    const home = tempDir("check-home");
    const dir = tempDir("check-ro");
    writeSyntheticParts(dir);
    const before = readdirSync(dir).sort();
    const io = makeIo({ home });
    await runInsight(exportCheckCommand, [dir], io);
    expect(io.asked).toEqual([]);
    expect(readdirSync(home)).toEqual([]);
    expect(readdirSync(dir).sort()).toEqual(before);
  });

  it("stops with calm messages for a missing path, no input and a bad friend count", async () => {
    const dir = tempDir("check-errors");
    const missing = await runInsight(exportCheckCommand, [join(dir, "missing.zip")]);
    expect(missing).toMatchObject({ code: 1, out: "" });
    expect(missing.err).toContain("could not find");
    expect((await runInsight(exportCheckCommand, [])).err).toContain("Give Snappy your export");
    const zip = writeSyntheticZip(dir, "a.zip");
    expect((await runInsight(exportCheckCommand, [zip, "--friend-count", "x"])).err).toContain("--friend-count must be a whole number");
    expect((await runInsight(exportCheckCommand, [zip, "--bogus"])).err).toContain('Snappy does not know the option --bogus for check. Run "snappy-export help check"');
  });
});

describe("privacy", () => {
  it("prints no canary, link or entry name from the export, in text or JSON", async () => {
    const dir = tempDir("check-canary");
    const zip = writeSyntheticZip(dir, "export.zip", { bundleMedia: true });
    const parts = join(dir, "parts");
    writeSyntheticParts(parts, { memoryCount: 200 });
    for (const args of [[zip], [zip, "--json"], [parts], [parts, "--json", "--verbose"], [zip, "--friend-count", "300", "--verbose"]]) {
      const { out, err } = await runInsight(exportCheckCommand, args);
      const text = stripPaths(out + err);
      expectNoLeaks(text, args.join(" "));
      // No usernames either: the check never lists a person.
      expect(text, args.join(" ")).not.toMatch(/\b(?:ghost|oneway|dormant|active|newfriend)_\d+\b/);
      // No file or entry names: only the fixed section labels appear.
      expect(text, args.join(" ")).not.toMatch(/\.(?:jpg|mp4|png|html|json)\b|[0-9A-F]{8}-[0-9A-F]{4}/i);
    }
  });
});

/** A check with every note and every step, to read each sentence at counts of 1 and 2. */
function fullCheck(n: number): Check {
  const notes = [
    "html-only-export", "no-parts", "parts-unreadable", "parts-empty", "duplicate-usernames", "friends-empty-but-deleted", "possibly-date-limited",
    "friend-count-mismatch", "future-timestamps", "dates-in-future", "dates-missing", "export-stale", "export-aging", "export-date-in-future",
    "age-from-activity", "memories-without-file", "memories-files-not-found", "more-parts-may-exist", "a-code-from-the-future",
  ].map((code) => ({ code, severity: "warning" as const, params: { count: n, ageDays: n, section: "snap_history" } }));
  const todo: Check["todo"] = [
    { code: "add-export-files", params: {} }, { code: "request-json-export", params: {} }, { code: "reread-parts", params: { count: n } },
    { code: "add-other-parts", params: {} }, { code: "request-sections", params: { sections: ["friends", "snap_history"] } },
    { code: "choose-all-time", params: {} }, { code: "request-newer-export", params: {} }, { code: "check-export-date", params: {} }, { code: "a-code-from-the-future", params: {} },
  ];
  const empty = { count: 0, dated: 0, undated: 0, future: 0, oldest: null, newest: null, spanDays: null };
  return {
    status: "incomplete",
    parts: { count: n, unreadable: 0, empty: 0 },
    sections: [{ id: "friends", need: "required", status: "present", count: n }],
    coverage: { chats: { ...empty, count: n, dated: n, oldest: NOW, newest: NOW, spanDays: n }, snaps: empty, memories: empty },
    age: { basis: "export-time", at: NOW, ageDays: n, level: "stale" },
    notes,
    todo,
  };
}

describe("wording", () => {
  it.each([0, 1, 2, 12])("reads correctly with a count of %i", (n) => {
    const text = renderExportCheck(fullCheck(n), term, false);
    expectBrandSafe(text, `count ${n}`);
    expect(text).not.toContain("a-code-from-the-future");
    expect(text).toContain("Snappy noted something it cannot describe.");
    expect(text).toContain("Run Snappy with --verbose and share the code.");
  });

  it("says one day, not 1 days", () => {
    const text = renderExportCheck(fullCheck(1), term, false);
    expect(text).toContain("about 1 day old");
    expect(text).toContain("1 Memory has no matching file");
    expect(text).toContain("1 ZIP file holds no files.");
    expect(text).toContain("1 date in your Snap history is in the future. Snappy leaves it out.");
    const many = renderExportCheck(fullCheck(2), term, false);
    expect(many).toContain("2 Memories have no matching file");
    expect(many).toContain("2 ZIP files hold no files.");
    expect(many).toContain("2 dates in your Snap history are in the future. Snappy leaves them out.");
  });

  it("keeps every sentence short and in sentence case", () => {
    const text = renderExportCheck(fullCheck(2), term, false);
    const prose = text
      .split("\n")
      .map((line) => line.replace(/^\s*(?:Warning|Note|Error)\s+/, "").replace(/^\s*\d+\. /, "").trim())
      .filter((line) => /[.?]$/.test(line) && !/\s{2,}/.test(line));
    expect(prose.length).toBeGreaterThan(10);
    for (const s of prose.flatMap((line) => line.split(/(?<=[.?])\s+/))) expect(s.split(/\s+/).length, s).toBeLessThanOrEqual(20);
    expect(text).not.toMatch(/\b(?:ghosts?|unfriend\w*|dormant|inactive|dead|simply|just)\b/i);
  });
});
