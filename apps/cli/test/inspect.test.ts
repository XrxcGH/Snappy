import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CANARIES, buildSyntheticExport, syntheticExportZip } from "@snappy-export/core";
import { buildFixtureZip } from "../../../packages/core/test/export/zip-fixture.ts";
import { LATER, makeIo, run, tempDir, writeDemoPair } from "./helpers.ts";

const enc = (v: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(v));
const LEFT_OUT = /Left out on purpose: \d+ HTML, \d+ photo\/video\/audio and \d+ other files \(not opened\)\./;

describe("snappy-export inspect", () => {
  it("prints the structure report with unknown keys masked, and never a value", async () => {
    const { later } = writeDemoPair(tempDir("insp"));
    const { code, out, err } = await run(["inspect", later]);
    expect(code).toBe(0);
    expect(err).toBe("");
    expect(out).toContain("Snappy export structure report (names, types and bucketed counts only; no values)");
    expect(out).toContain("key names: known vocabulary only");
    expect(out).not.toContain("Review before sharing");
    expect(out).toContain("friends.json");
    // Not a single synthetic username survives into the report.
    expect(out).not.toMatch(/ghost_|oneway_|dormant_|active_/);
  });

  it("describes only JSON and counts the rest: no media or page is listed", async () => {
    const dir = tempDir("insp");
    const zip = join(dir, "export.zip");
    writeFileSync(zip, syntheticExportZip({ now: LATER, friendCount: 40, memoryCount: 20, bundleMedia: true }));
    const { out } = await run(["inspect", zip]);
    expect(out).toMatch(LEFT_OUT);
    expect(out).not.toContain("<media-");
    expect(out).not.toContain("[media,");
    expect(out).not.toContain("[html,");
    expect(out).toMatch(/Left out on purpose: 0 HTML, [1-9]\d* photo\/video\/audio and 0 other files/);
  });

  it("--show-keys prints the review-before-sharing header", async () => {
    const { later } = writeDemoPair(tempDir("insp"));
    const { code, out } = await run(["inspect", later, "--show-keys"]);
    expect(code).toBe(0);
    expect(out).toContain("Review before sharing");
    expect(out).not.toMatch(/ghost_|oneway_|dormant_|active_/);
  });

  it("describes every part of a multi-part export", async () => {
    const dir = tempDir("insp");
    const { earlier, later } = writeDemoPair(dir);
    const parts = join(dir, "parts");
    mkdirSync(parts);
    copyFileSync(earlier, join(parts, "part-1.zip"));
    copyFileSync(later, join(parts, "part-2.zip"));
    const both = await run(["inspect", parts]);
    expect(both.code).toBe(0);
    expect(both.out).toContain("friends.json");
    expect(both.out).not.toContain("note:");
  });

  it("exits 2 when nothing can be read, and still prints a calm note", async () => {
    const dir = tempDir("insp");
    const junk = join(dir, "junk.zip");
    writeFileSync(junk, "not a zip");
    const { code, out } = await run(["inspect", junk]);
    expect(code).toBe(2);
    expect(out).toContain("note: zip unreadable");
    const checks = await run(["inspect", junk, "--layout", "--checks-only"]);
    expect(checks.code).toBe(2);
    expect(checks.out).toContain("note: zip unreadable");
  });

  it("needs an export, and says how to ask for help", async () => {
    const result = await run(["inspect"], makeIo());
    expect(result.code).toBe(1);
    expect(result.err).toContain("(code: no-input)");
  });

  it("shows its options in help", async () => {
    const { out } = await run(["help", "inspect"]);
    for (const flag of ["--show-keys", "--layout", "--memory-links", "--mtime-check", "--checks-only"]) expect(out).toContain(flag);
    expect(out).toContain("mydata~1234567890123-2.zip");
  });
});

// ---------------------------------------------------------------- the checks ---

/** A three-part export shaped like the real one: JSON in part 1, Memories media in parts 2 and 3. */
function writeThreeParts(dir: string, base = "mydata~1234567890123"): { part1: string; part2: string; part3: string } {
  const stamp = (i: number) => Date.UTC(2025, 2, i, 10, 0, 0);
  const id = (i: number) => `0000000${i}-0000-4000-8000-00000000000${i}`;
  const media = (i: number) => ({ name: `memories/2025-03-0${i}_${id(i)}-main.${i % 2 === 0 ? "mp4" : "jpg"}`, data: new Uint8Array(30).fill(97), utcMs: stamp(i) });
  const saved = [1, 2, 3, 4, 5].map((i) => ({ Date: `2025-03-0${i} 10:00:00 UTC`, "Media Type": i % 2 === 0 ? "Video" : "Image", Location: "never read", "Download Link": "", "Media Download URL": "" }));
  const part1 = join(dir, `${base}.zip`);
  const part2 = join(dir, `${base}-2.zip`);
  const part3 = join(dir, `${base}-3.zip`);
  writeFileSync(part1, buildFixtureZip([{ name: "json/friends.json", data: enc({ Friends: [] }) }, { name: "json/memories_history.json", data: enc({ "Saved Media": saved }) }, { name: "html/index.html", data: enc("<p>x</p>") }]));
  writeFileSync(part2, buildFixtureZip([media(1), media(2), media(3), { name: "memories/page.html", data: enc("<p>x</p>") }]));
  writeFileSync(part3, buildFixtureZip([media(4), media(5)]));
  return { part1, part2, part3 };
}

describe("snappy-export inspect checks", () => {
  it("--layout adds folder totals after the structure", async () => {
    const dir = tempDir("insp");
    const { part1 } = writeThreeParts(dir);
    const { code, out } = await run(["inspect", part1, "--layout"]);
    expect(code).toBe(0);
    expect(out.indexOf("Snappy export structure report")).toBeLessThan(out.indexOf("Folder totals (names of files are never shown)"));
    expect(out).toContain("part 1: 3 files");
    expect(out).toContain("  json/  2 files");
    expect(out).not.toContain("Memories link check");
  });

  it("--checks-only prints only the requested checks, in plain text", async () => {
    const dir = tempDir("insp");
    const { part1 } = writeThreeParts(dir);
    const { code, out } = await run(["inspect", part1, "--layout", "--checks-only"]);
    expect(code).toBe(0);
    expect(out.startsWith("Folder totals")).toBe(true);
    expect(out).not.toContain("Snappy export structure report");
    expect(out).not.toContain("Left out on purpose");
  });

  it("--checks-only on its own is a usage error that names the checks", async () => {
    const { part1 } = writeThreeParts(tempDir("insp"));
    const { code, err, out } = await run(["inspect", part1, "--checks-only"]);
    expect(code).toBe(1);
    expect(out).toBe("");
    expect(err).toContain("--layout, --memory-links or --mtime-check");
    expect(err).toContain("(code: usage)");
  });

  it("reads all three parts from a wildcard in order, whatever order they are named in", async () => {
    const dir = tempDir("insp");
    const { part1, part2, part3 } = writeThreeParts(dir);
    const flags = ["--layout", "--memory-links", "--mtime-check", "--checks-only"];
    const wildcard = await run(["inspect", join(dir, "mydata~1234567890123*.zip"), ...flags]);
    expect(wildcard.code).toBe(0);
    expect(wildcard.err).toBe("");
    expect(wildcard.out).toContain("part 1: 3 files");
    expect(wildcard.out).toContain("part 2: 4 files");
    expect(wildcard.out).toContain("part 3: 2 files");
    // The time check pairs files from parts 2 and 3 with the list in part 1.
    expect(wildcard.out).toContain("pairing method: exact stored UTC time");
    expect(wildcard.out).toContain("paired: 5 of 5 entries");
    expect(wildcard.out).toContain("Result: stored times match the list's dates directly");
    expect(wildcard.out).toContain("entries with a non-empty link value: 0");

    const scrambled = await run(["inspect", part3, part2, part1, ...flags]);
    expect(scrambled.out).toBe(wildcard.out);
    const folder = await run(["inspect", dir, ...flags]);
    expect(folder.out).toBe(wildcard.out);
  });

  it("--memory-links says when links are empty", async () => {
    const dir = tempDir("insp");
    const { part1 } = writeThreeParts(dir);
    const { out } = await run(["inspect", part1, join(dir, "mydata~1234567890123-2.zip"), "--memory-links", "--checks-only"]);
    expect(out).toContain("Memories link check (counts and patterns only; no values)");
    expect(out).toContain("5x Download Link: empty");
    expect(out).toContain("Result: no entry has an ID in its links");
  });

  it("a wildcard that matches nothing is a calm error with a code", async () => {
    const dir = tempDir("insp");
    const { code, err } = await run(["inspect", join(dir, "nothing*.zip")]);
    expect(code).toBe(1);
    expect(err).toContain("No .zip files match");
    expect(err).toContain("(code: no-zips)");
  });

  it("a wildcard in a folder that does not exist is a calm error", async () => {
    const { code, err } = await run(["inspect", join(tempDir("insp"), "missing", "x*.zip")]);
    expect(code).toBe(1);
    expect(err).toContain("(code: not-found)");
  });

  it("says plainly when the list file is not there", async () => {
    const dir = tempDir("insp");
    const zip = join(dir, "only-json.zip");
    writeFileSync(zip, buildFixtureZip([{ name: "json/friends.json", data: enc({}) }]));
    const { code, out } = await run(["inspect", zip, "--memory-links", "--mtime-check", "--checks-only"]);
    expect(code).toBe(0);
    expect(out).toContain("memories_history.json was not found in these zips.");
  });
});

// -------------------------------------------------------------------- privacy ---

describe("no planted value reaches any inspect output", () => {
  const ALL_CANARIES = Object.values(CANARIES).flat();
  // Link pieces of the synthetic Memories links and anything that is shaped like a URL.
  const LINK_PIECES = ["demo.snappy.invalid", "uid=demo", "mid=", "/media/", "https://", "http://", "://"];
  const USERNAMES = /\b(?:ghost|oneway|dormant|active|newfriend)_\d+\b|demo_user/;

  const variants: string[][] = [
    [],
    ["--show-keys"],
    ["--layout"],
    ["--memory-links"],
    ["--mtime-check"],
    ["--layout", "--memory-links", "--mtime-check"],
    ["--layout", "--memory-links", "--mtime-check", "--show-keys"],
    ["--layout", "--memory-links", "--mtime-check", "--checks-only"],
  ];

  it("plants the canaries in the export being inspected, so the test proves something", () => {
    const files = buildSyntheticExport({ now: LATER, friendCount: 40, memoryCount: 40, bundleMedia: true });
    const text = Object.entries(files)
      .filter(([name]) => name.endsWith(".json"))
      .map(([, bytes]) => new TextDecoder().decode(bytes))
      .join(" ");
    for (const [category, list] of Object.entries<string[]>(CANARIES as unknown as Record<string, string[]>)) {
      expect(list.some((c) => text.includes(c)), `no ${category} canary in the export`).toBe(true);
    }
    expect(text).toContain("demo.snappy.invalid");
  });

  for (const flags of variants) {
    it(`inspect ${flags.join(" ") || "(no options)"}`, async () => {
      const dir = tempDir("insp-canary");
      const zip = join(dir, "export.zip");
      writeFileSync(zip, syntheticExportZip({ now: LATER, friendCount: 40, memoryCount: 40, bundleMedia: true }));
      const { code, out, err } = await run(["inspect", zip, ...flags]);
      expect(code).toBe(0);
      const text = out + err;
      for (const canary of ALL_CANARIES) expect(text, `leaked ${JSON.stringify(canary)}`).not.toContain(canary);
      for (const piece of LINK_PIECES) expect(text, `leaked link piece ${piece}`).not.toContain(piece);
      expect(text).not.toMatch(USERNAMES);
      expect(text.toLowerCase()).not.toContain("zqcanary");
      expect(text).not.toContain(dir);
      expect(text).not.toContain("export.zip");
    });
  }

  it("never echoes a name from the export in an error or note", async () => {
    const dir = tempDir("insp-canary");
    const zip = join(dir, "export.zip");
    writeFileSync(zip, buildFixtureZip([{ name: "json/ZQCANARY-name.json", data: new TextEncoder().encode("{ broken ZQCANARY-value") }, { name: "memories/ZQCANARY-m-main.jpg", data: new Uint8Array(4) }]));
    const { out, err } = await run(["inspect", zip, "--layout", "--memory-links", "--mtime-check"]);
    expect((out + err).toLowerCase()).not.toContain("zqcanary");
    expect(out).toContain("unparseable json");
  });
});

// ---------------------------------------------------------------------- voice ---

describe("inspect output follows the brand guide", () => {
  it("uses no exclamation marks, no emoji, no banned words and no shouting", async () => {
    const dir = tempDir("insp-voice");
    const { part1 } = writeThreeParts(dir);
    const outputs = [
      (await run(["inspect", part1, "--layout", "--memory-links", "--mtime-check"])).out,
      (await run(["inspect", dir, "--layout", "--memory-links", "--mtime-check", "--checks-only"])).out,
      (await run(["inspect", part1, "--checks-only"])).err,
      (await run(["help", "inspect"])).out,
    ];
    const banned = /\b(ghosts?|unfriend\w*|unadded|purge\w*|oops|whoops|awesome|simply|just|stalker\w*|exposed|leaked|dormant|inactive|dead|failed adds?|data dump)\b/i;
    for (const text of outputs) {
      expect(text).not.toContain("!");
      expect(/\p{Extended_Pictographic}/u.test(text)).toBe(false);
      expect(banned.exec(text)?.[0]).toBeUndefined();
      const shouting = (text.match(/\b[A-Z]{4,}\b/g) ?? []).filter((w) => !["JSON", "HTML"].includes(w));
      expect(shouting).toEqual([]);
    }
  });
});
