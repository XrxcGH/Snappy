/**
 * Regression tests for the Memories rescue: an overlay in a different zip part than its main
 * file, resuming a run that lacked a part, naming the missing first part, and telling people what a
 * failure means. Everything here is synthetic.
 */
import { existsSync, readFileSync, readdirSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSyntheticExport } from "@snappy-export/core";
import { buildFixtureZip } from "../../../packages/core/test/export/zip-fixture.ts";
import { LATER, run, tempDir } from "./helpers.ts";

const media = buildSyntheticExport({ now: LATER, friendCount: 5, memoryCount: 6, bundleMedia: true });
const JPEG = media[Object.keys(media).find((k) => k.endsWith(".jpg")) as string] as Uint8Array;
const MP4 = media[Object.keys(media).find((k) => k.endsWith(".mp4")) as string] as Uint8Array;
const PNG = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4);

const ID1 = "AAAAAAAA-0000-4000-8000-000000000001";
const ID2 = "BBBBBBBB-0000-4000-8000-000000000002";
const T1 = Date.UTC(2025, 2, 1, 10, 0, 0);
const T2 = Date.UTC(2025, 2, 2, 11, 30, 0);

const enc = (v: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(v));
const stamp = (ms: number): string => new Date(ms).toISOString().slice(0, 19).replace("T", " ") + " UTC";
const list = enc({
  "Saved Media": [
    { Date: stamp(T1), "Media Type": "Image", "Download Link": "", "Media Download URL": "" },
    { Date: stamp(T2), "Media Type": "Video", "Download Link": "", "Media Download URL": "" },
  ],
});

/** Part 1 holds the list, part 2 the first photo, part 3 its overlay and the video: a split between a main file and its overlay. */
function threeParts(label: string): { dir: string; parts: string[] } {
  const dir = tempDir(label);
  const parts = ["mydata~1.zip", "mydata~1-2.zip", "mydata~1-3.zip"].map((n) => join(dir, n));
  writeFileSync(parts[0] as string, buildFixtureZip([{ name: "json/memories_history.json", data: list }]));
  writeFileSync(parts[1] as string, buildFixtureZip([{ name: `memories/2025-03-01_${ID1}-main.jpg`, data: JPEG, utcMs: T1 }]));
  writeFileSync(
    parts[2] as string,
    buildFixtureZip([
      { name: `memories/2025-03-01_${ID1}-overlay.png`, data: PNG, utcMs: T1 },
      { name: `memories/2025-03-02_${ID2}-main.mp4`, data: MP4, utcMs: T2 },
    ]),
  );
  return { dir, parts };
}

const filesOf = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name !== "memories-report.json")
    .map((e) => relative(dir, join(e.parentPath, e.name)).replaceAll("\\", "/"))
    .sort();
const reportOf = (dir: string) => JSON.parse(readFileSync(join(dir, "memories-report.json"), "utf8"));

describe("an overlay in a different zip part than its main file", () => {
  it("is found in its own part, so the Memory is saved with its overlay and the run succeeds", async () => {
    const { dir } = threeParts("cross-part");
    const out = join(tempDir("cross-part-out"), "rescued");
    const result = await run(["memories", dir, "--out", out, "--no-color"]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("2 saved from your ZIP files, 0 already there, 0 failed.");
    const saved = filesOf(out);
    expect(saved.some((f) => /-overlay\.png$/.test(f))).toBe(true);
    expect(saved.filter((f) => /\.(jpg|mp4)$/.test(f))).toHaveLength(2);
    expect(reportOf(out).counts).toMatchObject({ extracted: 2, failed: 0, overlaysWritten: 1 });
  });
});

describe("resuming a run that lacked a part", () => {
  it("adds the overlay a first run could not see, and sets a file time that was lost", async () => {
    const { dir, parts } = threeParts("resume");
    const out = join(tempDir("resume-out"), "rescued");

    // First run: part 3 was forgotten, so the photo is saved without its overlay (and the video is not found).
    const first = await run(["memories", parts[0] as string, parts[1] as string, "--out", out, "--no-color"]);
    expect(first.code).toBe(0);
    expect(filesOf(out).some((f) => /-overlay\.png$/.test(f))).toBe(false);

    // Second run with every part: the finished photo is completed, not skipped, and the video is saved.
    const second = await run(["memories", dir, "--out", out, "--no-color"]);
    expect(second.code).toBe(0);
    expect(second.out).toContain("1 item already there was completed");
    expect(second.out).toContain("1 saved from your ZIP files, 0 already there, 0 failed."); // the completed one is counted on its own line
    expect(filesOf(out).some((f) => /-overlay\.png$/.test(f))).toBe(true);
    expect(reportOf(out).counts).toMatchObject({ repaired: 1, extracted: 1, overlaysWritten: 1 });

    // A file whose time was never set (a run that stopped, or a refused change) gets it back; nothing else changes.
    const photo = filesOf(out).find((f) => f.endsWith(".jpg")) as string;
    const target = join(out, photo);
    utimesSync(target, new Date(2001, 0, 1), new Date(2001, 0, 1));
    const third = await run(["memories", dir, "--out", out, "--no-color"]);
    expect(third.out).toContain("1 item already there was completed");
    expect(Math.abs(statSync(target).mtimeMs - T1)).toBeLessThanOrEqual(2000);

    const fourth = await run(["memories", dir, "--out", out, "--no-color"]);
    expect(fourth.out).toContain("0 saved from your ZIP files, 2 already there, 0 failed.");
    expect(fourth.out).not.toContain("was completed");
  });
});

describe("a zip that repeats an entry name", () => {
  it("saves the entry whose stored time matched the Memory, not the first one with that name", async () => {
    const dir = tempDir("repeat");
    const zip = join(dir, "mydata~1.zip");
    const name = `memories/2025-03-01_${ID1}-main.jpg`;
    writeFileSync(
      zip,
      buildFixtureZip([
        { name: "json/memories_history.json", data: enc({ "Saved Media": [{ Date: stamp(T1), "Media Type": "Image", "Download Link": "", "Media Download URL": "" }] }) },
        { name, data: PNG, utcMs: T1 - 3_600_000 }, // an older copy of the name, stored first
        { name, data: JPEG, utcMs: T1 },
      ]),
    );
    const out = join(dir, "out");
    const result = await run(["memories", zip, "--out", out, "--no-color"]);
    expect(result.code).toBe(0);
    const saved = filesOf(out).filter((f) => f.endsWith(".jpg"));
    expect(saved).toHaveLength(1);
    const bytes = readFileSync(join(out, saved[0] as string));
    expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8]); // the JPEG, not the PNG that came first
  });
});

describe("a missing first part", () => {
  it("is named, instead of reporting an empty export and exiting 0", async () => {
    const { parts } = threeParts("later-only");
    for (const command of ["memories", "analyze"]) {
      const args = command === "memories" ? ["memories", parts[1] as string, parts[2] as string, "--dry-run"] : ["analyze", parts[1] as string, parts[2] as string, "--no-save"];
      const result = await run(args);
      expect(result.code).toBe(1);
      expect(result.err).toContain("later parts");
      expect(result.err).toContain("Add the first part");
      expect(result.out).not.toContain("Request your export again");
    }
  });

  it("does not refuse zips that are named some other way", async () => {
    const dir = tempDir("other-names");
    const zip = join(dir, "export-2.zip");
    writeFileSync(zip, buildFixtureZip([{ name: "json/memories_history.json", data: list }]));
    const result = await run(["memories", zip, "--dry-run"]);
    expect(result.code).toBe(0);
  });
});

describe("what the run says when it ends", () => {
  it("explains each failure code once, with what to do, and keeps the item lines", async () => {
    const dir = tempDir("advice");
    const zip = join(dir, "export.zip");
    const bytes = buildFixtureZip([
      { name: `memories/2025-03-01_${ID1}-main.jpg`, data: JPEG, utcMs: T1 },
      { name: `memories/2025-03-02_${ID2}-main.mp4`, data: MP4, utcMs: T2 },
      { name: "json/memories_history.json", data: list },
    ]);
    // One byte inside the first entry's data (after its 30-byte header, name and 9-byte extra field): it still reads, but its checksum no longer matches.
    const flipAt = 30 + new TextEncoder().encode(`memories/2025-03-01_${ID1}-main.jpg`).length + 9 + 10;
    bytes[flipAt] = (bytes[flipAt] as number) ^ 0xff;
    writeFileSync(zip, bytes);
    const out = join(dir, "out");
    const result = await run(["memories", zip, "--out", out, "--no-color"]);
    expect(result.code).toBe(3);
    expect(result.out).toContain("item 1 failed (corrupt)");
    expect(result.out).toContain("corrupt: A ZIP file looks damaged");
    expect(result.out).toContain("Download that part again");
    expect(result.out.match(/corrupt: A ZIP file looks damaged/g)).toHaveLength(1);
    expect(existsSync(out) && filesOf(out).filter((f) => f.endsWith(".jpg"))).toEqual([]); // damaged bytes are never written as a good file
  });

  it("says how to save for real after a dry run, and what the cap is", async () => {
    const { dir } = threeParts("dry");
    const dry = await run(["memories", dir, "--dry-run", "--no-color"]);
    expect(dry.out).toContain("To save the files, run it again with --out <folder> and no --dry-run.");
    const withOut = await run(["memories", dir, "--dry-run", "--out", join(tempDir("dry-out"), "x"), "--no-color"]);
    expect(withOut.out).toContain("To save the files, run it again without --dry-run.");
  });

  it("says what the storage cap is when sizes are unknown, so a 0% bar is not a mystery", async () => {
    const dir = tempDir("cap");
    const zip = join(dir, "mydata~1.zip");
    writeFileSync(zip, buildFixtureZip([{ name: "json/memories_history.json", data: list }]));
    const dry = await run(["memories", zip, "--dry-run", "--no-color"]);
    expect(dry.out).toContain("2 Memories have no known size, so the real total is higher.");
    expect(dry.out).toContain("The cap is your own goal (change it with --cap-gb). Snappy does not enforce it.");
  });

  it("names the count and the place before the first file is done, without a terminal", async () => {
    const { dir } = threeParts("progress");
    const out = join(tempDir("progress-out"), "rescued");
    const result = await run(["memories", dir, "--out", out, "--no-color"]);
    expect(result.out).toContain("Saving 2 Memories...");
  });

  it("tells people the Memories are still in their account when some had no file", async () => {
    const dir = tempDir("unmatched");
    const zip = join(dir, "mydata~1.zip");
    writeFileSync(zip, buildFixtureZip([{ name: "json/memories_history.json", data: list }]));
    const result = await run(["memories", zip, "--out", join(dir, "out"), "--no-color"]);
    expect(result.out.replace(/\s+/g, " ")).toContain("still in your Snapchat account. If part of your export is missing, add it and run again.");
  });
});
