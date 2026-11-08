/**
 * End to end: the Memories rescue over a synthetic export shaped like the real 2026 one (three
 * zips, empty links, files paired by exact UTC time, overlay files). The output folder is checked
 * by an independent script (verify-memories-output.ts) that shares no code with @snappy-export/core.
 * Everything here is synthetic.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { CANARIES, buildSyntheticExport, syntheticExportZip } from "@snappy-export/core";
import { buildFixtureZip } from "../../../packages/core/test/export/zip-fixture.ts";
import { formatCount } from "../src/format.ts";
import { parseParts, resolveZipPaths, withReaders } from "../src/inputs.ts";
import type { Transport } from "../src/memories-download.ts";
import { describeZips, verifyRescue } from "./verify-memories-output.ts";
import { LATER, makeIo, run, tempDir, writeSyntheticParts } from "./helpers.ts";

const FORBIDDEN = Object.values(CANARIES).flat();

function files(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => relative(dir, join(e.parentPath, e.name)).replaceAll("\\", "/"))
    .sort();
}

/** Every rescued file with its size and modification time (the report is rewritten by each run, so it is left out). */
function snapshot(dir: string): Record<string, string> {
  return Object.fromEntries(
    files(dir)
      .filter((f) => f !== "memories-report.json")
      .map((f) => [f, `${statSync(join(dir, f)).size}:${statSync(join(dir, f)).mtimeMs}`]),
  );
}

/** Terminal text with its line wraps undone, so a sentence can be matched whole. */
const flat = (text: string): string => text.replace(/\s+/g, " ");

const reportOf = (dir: string) => JSON.parse(readFileSync(join(dir, "memories-report.json"), "utf8"));

describe("memories rescue of a three-part export", () => {
  const dir = tempDir("rescue");
  const zips = writeSyntheticParts(dir);
  const facts = describeZips(zips);
  const mains = facts.mainsPerZip.reduce((a, b) => a + b, 0);

  /** A fresh rescue of the export (all three parts unless told otherwise) into its own folder. */
  async function rescue(label: string, extra: string[] = [], args: string[] = [dir]) {
    const folder = join(tempDir(label), "rescued");
    const result = await run(["memories", ...args, "--out", folder, "--no-color", ...extra]);
    return { folder, ...result };
  }

  it("starts from an export that has files in both memory parts and some overlays", () => {
    expect(facts.mainsPerZip[0]).toBe(0);
    expect(facts.mainsPerZip[1]).toBeGreaterThan(50);
    expect(facts.mainsPerZip[2]).toBeGreaterThan(5);
    expect(facts.overlays).toBeGreaterThan(1);
  });

  it("numbers the parts in export order, even though a folder listing puts -2 first", async () => {
    const paths = await resolveZipPaths(makeIo(), [dir]);
    expect(paths.map((p) => p.split(/[\\/]/).pop())).toEqual(zips.map((p) => p.split(/[\\/]/).pop()));
    const io = makeIo();
    const parsed = await withReaders(io, paths, (readers) => parseParts(readers, io));
    expect(new Set(parsed.bundledMedia?.map((f) => f.part))).toEqual(new Set([2, 3]));
    expect(new Set(parsed.memories.flatMap((m) => (m.partIndex === undefined ? [] : [m.partIndex])))).toEqual(new Set([2, 3]));
  });

  it("saves every file with its exact capture time, the overlays unchanged, and no location", async () => {
    const { folder, code, out } = await rescue("rescue-a");
    expect(code).toBe(0);
    expect(out).toContain(`${formatCount(mains)} saved from your ZIP files, 0 already there, 0 failed.`);
    expect(out).toContain(`${facts.overlays} overlay files saved next to their Memory, unchanged.`);
    expect(out).toContain("matched to a file in your ZIP files by exact capture time");

    const verified = verifyRescue(folder, zips, FORBIDDEN);
    expect(verified.problems).toEqual([]);
    expect(verified.checked.jpeg + verified.checked.mp4).toBe(mains);
    expect(verified.checked.overlays).toBe(facts.overlays);
    expect(verified.checked.other).toBe(0);

    // Folders by month, names with the time of day, overlays next to their file.
    for (const f of files(folder).filter((f) => f !== "memories-report.json")) {
      expect(f).toMatch(/^\d{4}\/\d{4}-\d{2}\/\d{4}-\d{2}-\d{2}_\d{6}_(image|video)_\d{4}(-overlay)?\.(jpg|mp4|png)$/);
    }
    // This test writes and checks every file of a real-sized rescue: a busy machine needs more than the default 30 s.
  }, 120_000);

  it("writes a report of counts and statuses and nothing that identifies a file, a place or a date", async () => {
    const { folder } = await rescue("rescue-report");
    const text = readFileSync(join(folder, "memories-report.json"), "utf8");
    const report = JSON.parse(text);
    expect(report.pairing).toMatchObject({ method: "utc-time", paired: mains, overlays: facts.overlays, offsetHours: 0 });
    expect(report.counts).toMatchObject({ paired: mains, extracted: mains, downloaded: 0, skippedExisting: 0, failed: 0, linkOnly: 0, overlaysWritten: facts.overlays });
    expect(report.counts.extracted + report.counts.unmatchedItems).toBe(report.counts.planned);
    expect(report.counts.unmatchedItems).toBeGreaterThan(0);
    expect(report.failures).toEqual([]);
    expect(report.items).toHaveLength(report.counts.planned);
    for (const item of report.items) {
      expect(Object.keys(item).every((k) => ["item", "status", "reason", "dateStatus"].includes(k))).toBe(true);
      expect(["extracted", "no-file"]).toContain(item.status);
    }
    // No path, name, link, coordinate or timestamp of any kind.
    expect(text).not.toMatch(/memories\/|\.jpg|\.mp4|\.png|https?:|\d{4}-\d{2}-\d{2}|\b1[5-9]\d{8}(?:\d{3})?\b|[A-F0-9]{8}-[A-F0-9]{4}/i);
    for (const canary of FORBIDDEN) expect(text).not.toContain(canary);
  });

  it("skips what is already there, so a second run saves nothing and changes nothing", async () => {
    const { folder } = await rescue("rescue-resume");
    const before = snapshot(folder);
    const again = await run(["memories", dir, "--out", folder, "--no-color"]);
    expect(again.code).toBe(0);
    expect(again.out).toContain(`0 saved from your ZIP files, ${formatCount(mains)} already there, 0 failed.`);
    expect(again.out).not.toContain("overlay files saved");
    expect(snapshot(folder)).toEqual(before);
    expect(reportOf(folder).counts).toMatchObject({ extracted: 0, skippedExisting: mains, failed: 0, overlaysWritten: 0 });
  });

  it("resumes an interrupted run: only the missing files are extracted again, overlays included", async () => {
    const { folder } = await rescue("rescue-partial");
    const all = files(folder).filter((f) => f !== "memories-report.json");
    const overlay = all.find((f) => f.includes("-overlay")) as string;
    const mainOfOverlay = overlay.replace("-overlay", "").replace(/\.png$/, "");
    const mainFile = all.find((f) => f.startsWith(mainOfOverlay + ".")) as string;
    const others = all.filter((f) => !f.includes("-overlay") && f !== mainFile).slice(0, 4);
    const removed = [mainFile, ...others];
    for (const f of removed) rmSync(join(folder, f));

    const again = await run(["memories", dir, "--out", folder, "--no-color"]);
    expect(again.code).toBe(0);
    expect(again.out).toContain(`${removed.length} saved from your ZIP files, ${formatCount(mains - removed.length)} already there, 0 failed.`);
    // The overlay of the restored file was never lost, so it is not written twice.
    expect(again.out).not.toContain("overlay files saved");
    const verified = verifyRescue(folder, zips, FORBIDDEN);
    expect(verified.problems).toEqual([]);
    expect(verified.checked.jpeg + verified.checked.mp4).toBe(mains);
    expect(verified.checked.overlays).toBe(facts.overlays);
  });

  it("gives the same result for any argument order, a wildcard, or a folder", async () => {
    const base = await rescue("rescue-order");
    const reversed = await rescue("rescue-order", [], [...zips].reverse());
    const wildcard = await rescue("rescue-order", [], [join(dir, "mydata*.zip")]);
    for (const other of [reversed, wildcard]) {
      expect(other.code).toBe(0);
      expect(files(other.folder)).toEqual(files(base.folder));
      expect(snapshot(other.folder)).toEqual(snapshot(base.folder));
    }
    expect(verifyRescue(reversed.folder, zips).problems).toEqual([]);
  });

  it("says that a newer export has no links, and stays offline even with --download", async () => {
    let calls = 0;
    const transport: Transport = async () => (calls++, new Response("x"));
    const out = join(tempDir("rescue-offline"), "rescued");
    const io = makeIo({ transport, sleep: async () => undefined });
    const result = await run(["memories", dir, "--out", out, "--download", "--no-color"], io);
    expect(result.code).toBe(0);
    expect(calls).toBe(0);
    expect(flat(result.out)).toContain("This export has no download links, so Snappy did not use the network.");
    expect(result.out).not.toContain("only Snappy command that uses the network");
    expect(result.out).not.toContain("were contacted");
    expect(result.out).toContain("Nothing here has left this device.");
    expect(result.out).toContain(`${formatCount(mains)} saved from your ZIP files, 0 already there, 0 failed.`);
    expect(reportOf(out).download).toBe(false);
    expect(verifyRescue(out, zips).problems).toEqual([]);

    const dry = await run(["memories", dir, "--dry-run", "--download", "--no-color"], makeIo({ transport }));
    expect(calls).toBe(0);
    expect(flat(dry.out)).toContain("This export has no download links");
    expect(dry.out).toContain(`A real run would copy ${formatCount(mains)} files from your ZIP files.`);
    expect(dry.out).not.toContain("and download");
  });

  it("explains Memories that have no file, in the words core gives, and counts them", async () => {
    const { folder, out } = await rescue("rescue-unmatched");
    const report = reportOf(folder);
    // The pairing sentence gives the count once, and one line of advice follows it.
    expect(flat(out)).toContain(`${report.counts.unmatchedItems} have no matching file.`);
    expect(flat(out)).toContain("If part of your export is missing, add it and run again.");
    expect(flat(out)).not.toContain("saved Memories have no file in your ZIP files");
    expect(flat(out).match(new RegExp(`${report.counts.unmatchedItems} (?:of \\d+ )?(?:saved )?Memories have no (?:matching )?file`, "g"))).toBeNull();
    expect(flat(out).match(/If part of your export is missing, add it and run again\./g)).toHaveLength(1);
    expect(out).toContain(`${report.counts.unmatchedItems} Memories had no file or link, so they were not saved.`);
  });

  it("works from parts 1 and 2 alone, and from part 1 alone, without failing", async () => {
    const two = await rescue("rescue-two", [], [zips[0] as string, zips[1] as string]);
    expect(two.code).toBe(0);
    expect(two.out).toContain(`${formatCount(facts.mainsPerZip[1] as number)} saved from your ZIP files, 0 already there, 0 failed.`);
    expect(verifyRescue(two.folder, zips.slice(0, 2)).problems).toEqual([]);

    const one = await rescue("rescue-one", [], [zips[0] as string]);
    expect(one.code).toBe(0);
    expect(one.out).toContain("0 saved from your ZIP files");
    expect(files(one.folder)).toEqual(["memories-report.json"]);
  });

  it("shows the plan without writing, with the pairing summary", async () => {
    const out = join(tempDir("rescue-dry"), "rescued");
    const dry = await run(["memories", dir, "--out", out, "--dry-run", "--no-color"]);
    expect(dry.code).toBe(0);
    expect(existsSync(out)).toBe(false);
    expect(dry.out).toContain(`${formatCount(mains)} are in your ZIP files, 0 are only links.`);
    expect(dry.out).toContain(`A real run would copy ${formatCount(mains)} files from your ZIP files.`);
    expect(dry.out).toContain(`${facts.overlays} overlay files go with them.`);
  });
});

describe("analyze over a three-part export", () => {
  const dir = tempDir("analyze-parts");
  const zips = writeSyntheticParts(dir);
  const mains = describeZips(zips).mainsPerZip.reduce((a, b) => a + b, 0);

  it("shows the Memories pairing as counts, and says Snaps count as recent activity", async () => {
    const { code, out } = await run(["analyze", dir, "--no-save", "--no-color"]);
    expect(code).toBe(0);
    expect(out).toContain(`${formatCount(mains)} of 400 Memories are matched to a file in your ZIP files by exact capture time.`);
    expect(out).toContain("overlay files go with them.");
    expect(out).toContain("Saved chats and Snaps count as recent activity.");
    expect(out).not.toMatch(/\.jpg|\.mp4|memories\//);
  });

  it("puts the same counts in the JSON result", async () => {
    const { out } = await run(["analyze", dir, "--no-save", "--json"]);
    const data = JSON.parse(out);
    expect(data.counts.memories).toBe(400);
    expect(data.memoriesPairing).toMatchObject({ items: 400, paired: mains, method: "utc-time", offsetHours: 0 });
  });

  it("does not call a friend quiet who only exchanges Snaps", async () => {
    const { out } = await run(["analyze", dir, "--no-save", "--json"]);
    const data = JSON.parse(out) as { queue: { username: string; category: string }[]; protected: { username: string }[] };
    const snappers = [...data.queue, ...data.protected].filter((c) => c.username.startsWith("snapper_"));
    expect(snappers.filter((c) => "category" in c && (c as { category: string }).category === "quiet")).toEqual([]);
  });

  it("describes the structure of all three parts without a single name", async () => {
    const { code, out } = await run(["inspect", dir, "--layout", "--memory-links", "--mtime-check"]);
    expect(code).toBe(0);
    expect(out).toContain("Left out on purpose");
    for (const name of describeZips(zips).names.filter((n) => !n.startsWith("json/"))) {
      expect(out).not.toContain(name);
    }
  });
});

describe("a single archive, as the demo writes it", () => {
  it("rescues from one zip that holds both the list and the files", async () => {
    const dir = tempDir("single");
    const zip = join(dir, "export.zip");
    writeFileSync(zip, syntheticExportZip({ now: LATER, friendCount: 30, memoryCount: 120, realisticMemories: true }));
    const out = join(dir, "rescued");
    const result = await run(["memories", zip, "--out", out]);
    expect(result.code).toBe(0);
    expect(verifyRescue(out, [zip], FORBIDDEN).problems).toEqual([]);
    expect(reportOf(out).counts.extracted).toBeGreaterThan(30);
  });
});

// -------------------------------------------------------------- edge cases ---

const enc = (v: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(v));

/** A real (tiny, synthetic) JPEG and MP4 from the generator, to put into hand-made zips. */
const sample = buildSyntheticExport({ now: LATER, friendCount: 5, memoryCount: 40, realisticMemories: true });
const JPEG = sample[Object.keys(sample).find((k) => k.endsWith(".jpg") && k.startsWith("memories/")) as string] as Uint8Array;
const MP4 = sample[Object.keys(sample).find((k) => k.endsWith(".mp4") && k.startsWith("memories/")) as string] as Uint8Array;
const ID1 = "AAAAAAAA-1111-4111-8111-111111111111";
const ID2 = "BBBBBBBB-2222-4222-8222-222222222222";
const T1 = Date.UTC(2025, 2, 1, 10, 11, 12);
const T2 = Date.UTC(2025, 2, 2, 13, 14, 15);
const stamp = (ms: number): string => new Date(ms).toISOString().slice(0, 19).replace("T", " ") + " UTC";
const listOf = (dates: number[], types: string[]) => ({
  "Saved Media": dates.map((d, i) => ({ Date: stamp(d), "Media Type": types[i], Location: "Latitude, Longitude: 13.371337, 73.37", "Download Link": "", "Media Download URL": "" })),
});

/** A JPEG carrying a GPS block, a location in a comment and an XMP packet: all of it must be dropped. */
function jpegWithLocation(base: Uint8Array): Uint8Array {
  const tiff = Uint8Array.of(
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, // II, 42, IFD0 at 8
    0x01, 0x00, 0x25, 0x88, 0x04, 0x00, 0x01, 0x00, 0x00, 0x00, 0x1a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // IFD0: GPS pointer to 26
    0x01, 0x00, 0x01, 0x00, 0x02, 0x00, 0x02, 0x00, 0x00, 0x00, 0x4e, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // GPS IFD: latitude ref "N"
  );
  const segment = (marker: number, payload: Uint8Array): Uint8Array => Uint8Array.from([0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff, ...payload]);
  const text = (s: string): number[] => [...new TextEncoder().encode(s)];
  const exif = segment(0xe1, Uint8Array.from([...text("Exif\0\0"), ...tiff]));
  const comment = segment(0xfe, Uint8Array.from(text("13.371337, 73.37 ZQCANARY-LOC-4")));
  const xmp = segment(0xe1, Uint8Array.from(text("http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>GPSLatitude 13.371337</x:xmpmeta>")));
  return Uint8Array.from([...base.subarray(0, 2), ...exif, ...comment, ...xmp, ...base.subarray(2)]);
}

describe("memories rescue: edge cases", () => {
  it("drops every location a source JPEG carries and writes the capture time instead", async () => {
    const dir = tempDir("edge");
    const zip = join(dir, "export.zip");
    writeFileSync(
      zip,
      buildFixtureZip([
        { name: `memories/2025-03-01_${ID1}-main.jpg`, data: jpegWithLocation(JPEG), utcMs: T1 },
        { name: "json/memories_history.json", data: enc(listOf([T1], ["Image"])) },
      ]),
    );
    const out = join(dir, "out");
    expect((await run(["memories", zip, "--out", out])).code).toBe(0);
    const verified = verifyRescue(out, [zip], ["13.371337", "ZQCANARY-LOC-4", "xmpmeta", "GPSLatitude"]);
    expect(verified.problems).toEqual([]);
    expect(verified.checked.jpeg).toBe(1);
  });

  it("reports a damaged entry by number and failure class, keeps going, and exits with 3", async () => {
    const dir = tempDir("edge");
    const zip = join(dir, "export.zip");
    const bytes = buildFixtureZip([
      { name: `memories/2025-03-01_${ID1}-main.jpg`, data: JPEG, utcMs: T1 },
      { name: `memories/2025-03-02_${ID2}-main.mp4`, data: MP4, utcMs: T2 },
      { name: "json/memories_history.json", data: enc(listOf([T1, T2], ["Image", "Video"])) },
    ]);
    bytes[0] = 0; // the first entry's local header no longer starts with its signature
    writeFileSync(zip, bytes);
    const out = join(dir, "out");
    const result = await run(["memories", zip, "--out", out]);
    expect(result.code).toBe(3);
    expect(result.out).toContain("1 saved from your ZIP files, 0 already there, 1 failed.");
    expect(result.out).toContain("item 1 failed (corrupt)");
    expect(result.out).not.toMatch(/memories\/|\.jpg|\.mp4|AAAAAAAA|BBBBBBBB/);
    const report = reportOf(out);
    expect(report.failures).toEqual([{ item: 1, reason: "corrupt" }]);
    expect(report.counts).toMatchObject({ extracted: 1, failed: 1 });
    expect(files(out).filter((f) => f !== "memories-report.json")).toHaveLength(1);

    // The next run, with the damage fixed, saves just the missing one.
    bytes[0] = 0x50;
    writeFileSync(zip, bytes);
    const again = await run(["memories", zip, "--out", out]);
    expect(again.code).toBe(0);
    expect(again.out).toContain("1 saved from your ZIP files, 1 already there, 0 failed.");
    expect(verifyRescue(out, [zip]).problems).toEqual([]);
  });

  it("allows for a zipper whose clock is not UTC, and says so", async () => {
    const dir = tempDir("edge");
    const zip = join(dir, "export.zip");
    // DOS times only, written in a clock 2 hours ahead of UTC: no extended timestamp at all.
    writeFileSync(
      zip,
      buildFixtureZip([
        { name: `memories/2025-03-01_${ID1}-main.jpg`, data: JPEG, dosMs: T1 + 2 * 3600_000 },
        { name: `memories/2025-03-02_${ID2}-main.mp4`, data: MP4, dosMs: T2 + 2 * 3600_000 },
        { name: "json/memories_history.json", data: enc(listOf([T1, T2], ["Image", "Video"])) },
      ]),
    );
    const out = join(dir, "out");
    const result = await run(["memories", zip, "--out", out, "--no-color"]);
    expect(result.code).toBe(0);
    expect(flat(result.out)).toContain("by capture time, allowing for a 2-hour clock difference");
    expect(result.out).toContain("2 saved from your ZIP files, 0 already there, 0 failed.");
    // The dates written are the list's exact dates, not the shifted file times.
    const names = files(out).filter((f) => f !== "memories-report.json");
    expect(names.map((n) => n.split("/").pop()?.slice(0, 17)).sort()).toEqual(["2025-03-01_101112", "2025-03-02_131415"]);
  });

  it("still works for an export that only has links, and says what --download does", async () => {
    const dir = tempDir("edge");
    const zip = join(dir, "export.zip");
    writeFileSync(zip, syntheticExportZip({ now: LATER, friendCount: 5, memoryCount: 8 }));
    let calls = 0;
    const transport: Transport = async () => (calls++, new Response(new Uint8Array(JPEG), { headers: { "content-type": "image/jpeg" } }));
    const out = join(dir, "out");
    const result = await run(["memories", zip, "--out", out, "--download", "--no-color"], makeIo({ transport, sleep: async () => undefined }));
    expect(result.code).toBe(0);
    expect(calls).toBeGreaterThan(0);
    expect(result.out).toContain("This is the only Snappy command that uses the network.");
    expect(result.out).not.toContain("has no download links");
    expect(reportOf(out).counts.downloaded).toBe(calls);
  });
});

describe("the independent verifier", () => {
  it("catches a wrong file time, a wrong name, and a changed overlay", async () => {
    const dir = tempDir("verifier");
    const zips = writeSyntheticParts(dir);
    const out = join(dir, "rescued");
    await run(["memories", dir, "--out", out]);
    expect(verifyRescue(out, zips).problems).toEqual([]);

    const all = files(out).filter((f) => f !== "memories-report.json");
    const mainFiles = all.filter((f) => !f.includes("-overlay"));
    const overlay = all.find((f) => f.includes("-overlay")) as string;

    utimesSync(join(out, mainFiles[0] as string), new Date(1_000_000_000_000), new Date(1_000_000_000_000));
    const renamed = join(out, (mainFiles[1] as string).replace(/_\d{6}_/, "_000000_"));
    renameSync(join(out, mainFiles[1] as string), renamed);
    writeFileSync(join(out, overlay), Buffer.concat([readFileSync(join(out, overlay)), Buffer.from([0])]));

    const { problems } = verifyRescue(out, zips);
    expect(problems.some((p) => p.includes("modification time"))).toBe(true);
    expect(problems.some((p) => p.includes("no zip entry is stored with the time"))).toBe(true);
    expect(problems.some((p) => p.includes("byte-for-byte"))).toBe(true);
  });

  it("is happy to check a folder it was given nothing in", () => {
    const empty = tempDir("verifier");
    mkdirSync(join(empty, "x"));
    expect(verifyRescue(empty, writeSyntheticParts(tempDir("verifier"), { memoryCount: 10 })).problems).toEqual([]);
  });
});
