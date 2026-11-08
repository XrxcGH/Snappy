/** snappy-export rescue: the Memories rescue manifest and the folder check. Synthetic data only. */
import { existsSync, mkdirSync, readFileSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { insights, syntheticExportZip } from "@snappy-export/core";
import { renderRescueManifest, rescueCommand } from "../src/commands/rescue.ts";
import type { RescueView } from "../src/commands/rescue.ts";
import { createTerm } from "../src/term.ts";
import { LATER, NOW, makeIo, run, stripPaths, tempDir, writeSyntheticParts, writeSyntheticZip } from "./helpers.ts";
import { expectBrandSafe, expectNoLeaks, expectValidDescriptor, runInsight } from "./insights-helpers.ts";

const term = createTerm({ env: {}, isTTY: false, columns: 100 });
type Manifest = insights.rescueManifest.RescueManifest;
type Counts = insights.rescueManifest.ManifestCounts;

const readManifest = (path: string): Manifest => JSON.parse(readFileSync(path, "utf8")) as Manifest;

/** Make the files a rescue would have saved, from a manifest: the listed size (or 10 bytes) and the capture date. */
function populate(folder: string, manifest: Manifest, opts: { size?: (index: number) => number } = {}): void {
  manifest.items.forEach((item, index) => {
    for (const [name, size] of [[item.path, opts.size?.(index) ?? 10] as const, ...item.overlayFiles.map((o) => [o, 5] as const)]) {
      const target = join(folder, ...name.split("/"));
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, "x".repeat(size));
      if (item.capturedAt !== null) utimesSync(target, new Date(item.capturedAt), new Date(item.capturedAt));
    }
  });
}

/** A saved manifest of the synthetic export, without sizes, and its folder. */
async function sampleRescue(label: string): Promise<{ dir: string; zip: string; manifestPath: string; manifest: Manifest; folder: string }> {
  const dir = tempDir(label);
  const zip = writeSyntheticZip(dir, "export.zip", { bundleMedia: true });
  const manifestPath = join(dir, "first.json");
  const built = await runInsight(rescueCommand, [zip, "--out", manifestPath]);
  expect(built.code, built.err).toBe(0);
  const manifest = readManifest(manifestPath);
  const folder = join(dir, "rescued");
  populate(folder, manifest);
  return { dir, zip, manifestPath, manifest, folder };
}

describe("what the overview says rescue is", () => {
  it("calls it a check against a list, and points to memories for the real rescue", async () => {
    expect(rescueCommand.summary).toBe("Check a Memories rescue against a list.");
    const overview = (await run(["help"])).out;
    expect(overview).toMatch(/^ {2}rescue <ZIP files\.\.\.> +Check a Memories rescue against a list$/m);
    expect(overview).toMatch(/^ {2}memories <ZIP files\.\.\.> +Save your Memories with their dates restored$/m);
    expect(rescueCommand.usage).toContain("To save your Memories into folders, use snappy-export memories.");
    expect((await run(["help", "rescue"])).out).toContain("use snappy-export memories");
  });
});

describe("the command", () => {
  it("is a valid descriptor", async () => {
    await expectValidDescriptor(rescueCommand);
    expect(rescueCommand.name).toBe("rescue");
    expect(rescueCommand.group).toBe("Memories");
  });

  it("lists the Memories from the export, writes nothing, and says how to save", async () => {
    const dir = tempDir("rescue-list");
    const zip = writeSyntheticZip(dir, "export.zip", { bundleMedia: true });
    const home = tempDir("rescue-home");
    const before = readdirSync(dir).sort();
    const io = makeIo({ home });
    const { code, out, err } = await runInsight(rescueCommand, [zip], io);
    expect(code).toBe(0);
    expect(err).toBe("");
    expect(out).toContain("Rescue manifest");
    expect(out).toMatch(/\d+ Memories listed from your export\./);
    expect(out).toContain("What it holds");
    for (const label of ["Photos", "Videos", "Overlay files", "Without a date", "With a saved size"]) expect(out).toContain(label);
    expect(out).toContain("Add --out <file>.json to save the manifest.");
    expect(out).toContain("Sizes were not recorded.");
    expect(out.endsWith("Nothing here has left this device.\n")).toBe(true);
    expectBrandSafe(out, "rescue");
    expect(readdirSync(dir).sort()).toEqual(before);
    expect(readdirSync(home)).toEqual([]);
    expect(io.asked).toEqual([]);
  });

  it("prints JSON with counts and codes only", async () => {
    const dir = tempDir("rescue-json");
    const zip = writeSyntheticZip(dir, "export.zip", { bundleMedia: true });
    const { code, out } = await runInsight(rescueCommand, [zip, "--json"]);
    expect(code).toBe(0);
    const json = JSON.parse(out) as { generatedAt: string; mode: string; saved: boolean; counts: Counts; planned: number; notes: { code: string }[] };
    expect(json.generatedAt).toBe(new Date(NOW).toISOString());
    expect(json).toMatchObject({ mode: "build", saved: false, fromFolder: false });
    expect(json.counts.items).toBe(json.planned);
    expect(json.counts.items).toBeGreaterThan(0);
    expect(Object.keys(json)).toEqual(["generatedAt", "mode", "planned", "fromFolder", "saved", "counts", "notes"]);
    expect(out).not.toContain('"path"');
  });

  it("describes a manifest from several parts the same way, and honors --layout", async () => {
    const dir = tempDir("rescue-parts");
    writeSyntheticParts(dir);
    const flat = join(dir, "flat.json");
    const nested = join(dir, "nested.json");
    expect((await runInsight(rescueCommand, [dir, "--layout", "flat", "--out", flat])).code).toBe(0);
    expect((await runInsight(rescueCommand, [dir, "--out", nested])).code).toBe(0);
    const a = readManifest(flat);
    const b = readManifest(nested);
    expect(a.items.length).toBe(b.items.length);
    expect(a.items.every((i) => !i.path.includes("/"))).toBe(true);
    expect(b.items.some((i) => i.path.includes("/"))).toBe(true);
  });

  it("saves the manifest only with --out, and reports the path as typed", async () => {
    const dir = tempDir("rescue-out");
    const zip = writeSyntheticZip(dir, "export.zip", { bundleMedia: true });
    const target = join(dir, "sub", "folders", "rescue.json");
    const { code, out } = await runInsight(rescueCommand, [zip, "--out", target]);
    expect(code).toBe(0);
    expect(out).toContain(`Saved to ${target}.`);
    expect(out).toContain("To check a rescue folder later");
    const manifest = readManifest(target);
    expect(manifest.version).toBe(1);
    expect(manifest.createdAt).toBe(NOW);
    expect(manifest.items.length).toBeGreaterThan(0);
    expect(manifest.items.every((i) => /^\d{4}\/\d{4}-\d{2}\/|^undated\/|^[\w-]+\.\w+$|^[\w-]+\/[\w.-]+$/.test(i.path))).toBe(true);
    // The file holds no link, canary or export entry name.
    expectNoLeaks(readFileSync(target, "utf8"), "manifest file");
    expect(readFileSync(target, "utf8")).not.toMatch(/zipPath|downloadUrl|https?:/);
  });

  it("never replaces a file without --force, and replaces it with --force", async () => {
    const dir = tempDir("rescue-force");
    const zip = writeSyntheticZip(dir, "export.zip", { bundleMedia: true });
    const target = join(dir, "rescue.json");
    writeFileSync(target, "keep me");
    const refused = await runInsight(rescueCommand, [zip, "--out", target]);
    expect(refused.code).toBe(1);
    expect(refused.err).toContain("already exists");
    expect(refused.out).toBe("");
    expect(readFileSync(target, "utf8")).toBe("keep me");
    const forced = await runInsight(rescueCommand, [zip, "--out", target, "--force"]);
    expect(forced.code).toBe(0);
    expect(readManifest(target).version).toBe(1);
  });

  it("checks the output name before reading anything", async () => {
    const dir = tempDir("rescue-early");
    const wrong = await runInsight(rescueCommand, [join(dir, "missing.zip"), "--out", join(dir, "rescue.txt")]);
    expect(wrong.code).toBe(1);
    expect(wrong.err).toContain("--out needs a file name ending in .json");
    expect(readdirSync(dir)).toEqual([]);
    const existing = join(dir, "there.json");
    writeFileSync(existing, "{}");
    const exists = await runInsight(rescueCommand, [join(dir, "missing.zip"), "--out", existing]);
    expect(exists.err).toContain("already exists");
  });

  it("records the sizes of the saved files when given the folder, and checks clean", async () => {
    const s = await sampleRescue("rescue-folder");
    const second = join(s.dir, "second.json");
    const built = await runInsight(rescueCommand, [s.zip, "--folder", s.folder, "--out", second]);
    expect(built.code).toBe(0);
    expect(built.out).toMatch(/\d+ of \d+ Memories found in the folder\./);
    const manifest = readManifest(second);
    expect(manifest.counts.withSize).toBe(manifest.counts.items);
    expect(manifest.items.every((i) => i.size === 10)).toBe(true);

    const verified = await runInsight(rescueCommand, ["--verify", second, "--folder", s.folder]);
    expect(verified.code).toBe(0);
    expect(verified.out).toContain("Rescue check");
    expect(verified.out).toContain("The folder matches the manifest.");
    expect(verified.out).toContain("Manifest made Nov 6, 2026.");
    expect(verified.out).not.toContain("What to do");
    expectBrandSafe(verified.out, "verify clean");
  });

  it("lists only the saved files in the manifest when the folder holds some of them", async () => {
    const s = await sampleRescue("rescue-partial");
    const gone = s.manifest.items[0]!;
    const { rmSync } = await import("node:fs");
    rmSync(join(s.folder, ...gone.path.split("/")));
    const out = join(s.dir, "partial.json");
    const built = await runInsight(rescueCommand, [s.zip, "--folder", s.folder, "--out", out]);
    expect(built.code).toBe(0);
    expect(readManifest(out).items.length).toBe(s.manifest.items.length - 1);
  });

  it("says so, saves nothing and exits 2 when the folder holds none of the files", async () => {
    const dir = tempDir("rescue-none");
    const zip = writeSyntheticZip(dir, "export.zip", { bundleMedia: true });
    const folder = join(dir, "empty");
    mkdirSync(folder);
    const target = join(dir, "never.json");
    const { code, out } = await runInsight(rescueCommand, [zip, "--folder", folder, "--out", target]);
    expect(code).toBe(2);
    expect(out).toContain("None of the planned files were found in that folder.");
    expect(out).toContain("No manifest was saved, since it would be empty.");
    expect(existsSync(target)).toBe(false);
    expectBrandSafe(out, "none");
  });

  it("stops without writing for a damaged export, and exits 2", async () => {
    const dir = tempDir("rescue-damaged");
    const full = syntheticExportZip({ now: LATER, friendCount: 40, memoryCount: 20 });
    const damaged = join(dir, "damaged.zip");
    writeFileSync(damaged, full.subarray(0, Math.floor(full.length * 0.6)));
    const target = join(dir, "never.json");
    const { code, err, out } = await runInsight(rescueCommand, [damaged, "--out", target]);
    expect(code).toBe(2);
    expect(out).toBe("");
    expect(err).toContain("This export has errors, so Snappy listed nothing.");
    expect(existsSync(target)).toBe(false);
  });
});

describe("verify", () => {
  it("counts what is missing, extra, the wrong size or the wrong date, and exits 2", async () => {
    const s = await sampleRescue("rescue-problems");
    const { rmSync } = await import("node:fs");
    const [a, b, c] = s.manifest.items;
    const pathOf = (p: string): string => join(s.folder, ...p.split("/"));
    const sized = join(s.dir, "sized.json");
    expect((await runInsight(rescueCommand, [s.zip, "--folder", s.folder, "--out", sized])).code).toBe(0);
    rmSync(pathOf(a!.path));
    writeFileSync(pathOf("stray-file.bin"), "abc");
    writeFileSync(pathOf(b!.path), "much longer than before");
    const bumped = new Date((c!.capturedAt ?? NOW) + 3_600_000);
    utimesSync(pathOf(c!.path), bumped, bumped);

    const { code, out } = await runInsight(rescueCommand, ["--verify", sized, "--folder", s.folder]);
    expect(code).toBe(2);
    expect(out).toContain("The folder may not match the manifest.");
    expect(out).toMatch(/Missing\s+1\b/);
    expect(out).toMatch(/Not in manifest\s+1\b/);
    expect(out).toMatch(/Wrong size\s+1\b/);
    expect(out).toMatch(/Wrong date\s+[12]\b/);
    expect(out).toContain("What to do");
    expect(out).toContain("Add --list to see which files.");
    expect(out).not.toContain("stray-file");
    expectBrandSafe(out, "verify problems");
  });

  it("names the files to look at only with --list, in text and in JSON", async () => {
    const s = await sampleRescue("rescue-list-files");
    const sized = join(s.dir, "sized.json");
    expect((await runInsight(rescueCommand, [s.zip, "--folder", s.folder, "--out", sized])).code).toBe(0);
    const { rmSync } = await import("node:fs");
    const gone = s.manifest.items[0]!;
    rmSync(join(s.folder, ...gone.path.split("/")));
    writeFileSync(join(s.folder, "stray-file.bin"), "abc");

    const plain = await runInsight(rescueCommand, ["--verify", sized, "--folder", s.folder]);
    expect(plain.code).toBe(2);
    expect(plain.out).not.toContain(gone.path);
    expect(plain.out).not.toContain("stray-file");
    expect(plain.out).toMatch(/Missing\s+1\b/);

    const listed = await runInsight(rescueCommand, ["--verify", sized, "--folder", s.folder, "--list"]);
    expect(listed.out).toContain("Files to look at");
    expect(listed.out).toContain(gone.path);
    expect(listed.out).toContain("stray-file.bin");
    expect(listed.out).not.toContain("Add --list to see which files.");
    expectBrandSafe(listed.out, "verify list");

    const quietJson = JSON.parse((await runInsight(rescueCommand, ["--verify", sized, "--folder", s.folder, "--json"])).out) as Record<string, unknown>;
    expect(quietJson).toMatchObject({ mode: "verify", ok: false, counts: { missing: 1, extra: 1 } });
    expect(quietJson).not.toHaveProperty("missing");
    const listedJson = JSON.parse((await runInsight(rescueCommand, ["--verify", sized, "--folder", s.folder, "--json", "--list"])).out) as { missing: { path: string }[]; extra: { path: string }[] };
    expect(listedJson.missing.map((m) => m.path)).toEqual([gone.path]);
    expect(listedJson.extra.map((m) => m.path)).toEqual(["stray-file.bin"]);
  });

  it("does not count the manifest as an extra file when it sits in the folder", async () => {
    const s = await sampleRescue("rescue-inside");
    const inside = join(s.folder, "manifest.json");
    expect((await runInsight(rescueCommand, [s.zip, "--folder", s.folder, "--out", inside])).code).toBe(0);
    const { code, out } = await runInsight(rescueCommand, ["--verify", inside, "--folder", s.folder]);
    expect(code, out).toBe(0);
    expect(out).toContain("The folder matches the manifest.");
  });

  it("allows a wider date gap with --tolerance", async () => {
    const s = await sampleRescue("rescue-tolerance");
    const dated = s.manifest.items.find((i) => i.capturedAt !== null)!;
    const target = join(s.folder, ...dated.path.split("/"));
    const later = new Date(dated.capturedAt! + 30_000);
    utimesSync(target, later, later);
    expect((await runInsight(rescueCommand, ["--verify", s.manifestPath, "--folder", s.folder])).code).toBe(2);
    const wide = await runInsight(rescueCommand, ["--verify", s.manifestPath, "--folder", s.folder, "--tolerance", "60"]);
    expect(wide.code).toBe(0);
  });

  it("adds the short code to each note with --verbose", async () => {
    const s = await sampleRescue("rescue-verbose");
    const quiet = await runInsight(rescueCommand, ["--verify", s.manifestPath, "--folder", s.folder]);
    expect(quiet.out).toContain("no saved size, so");
    expect(quiet.out).not.toContain("code:");
    expect(quiet.out.match(/no saved size/g)).toHaveLength(1);
    const verbose = await runInsight(rescueCommand, ["--verify", s.manifestPath, "--folder", s.folder, "--verbose"]);
    expect(verbose.out).toContain("code: size-not-checked");
  });

  it("changes nothing in the folder or the manifest", async () => {
    const s = await sampleRescue("rescue-readonly");
    const manifestBefore = readFileSync(s.manifestPath, "utf8");
    const listing = (): string[] => readdirSync(s.folder, { recursive: true }).map(String).sort();
    const before = listing();
    const home = tempDir("rescue-ro-home");
    const io = makeIo({ home });
    await runInsight(rescueCommand, ["--verify", s.manifestPath, "--folder", s.folder, "--json"], io);
    expect(listing()).toEqual(before);
    expect(readFileSync(s.manifestPath, "utf8")).toBe(manifestBefore);
    expect(readdirSync(home)).toEqual([]);
    expect(io.asked).toEqual([]);
  });
});

describe("mistakes", () => {
  it("stops with calm messages when the input is wrong", async () => {
    const dir = tempDir("rescue-errors");
    const zip = writeSyntheticZip(dir, "a.zip");
    const folder = join(dir, "folder");
    mkdirSync(folder);
    const notes = join(dir, "notes.json");
    writeFileSync(notes, "this is not json");
    const other = join(dir, "other.json");
    writeFileSync(other, JSON.stringify({ version: 99, items: [] }));
    const shape = join(dir, "shape.json");
    writeFileSync(shape, JSON.stringify({ hello: "world" }));
    const manifest = join(dir, "m.json");
    expect((await runInsight(rescueCommand, [zip, "--out", manifest])).code).toBe(0);

    const cases: [string[], string][] = [
      [[], "Give Snappy your export"],
      [[join(dir, "missing.zip")], "could not find"],
      [[zip, "--layout", "deep"], "--layout must be flat, year, or year-month."],
      [[zip, "--force"], "--force replaces the file named by --out."],
      [[zip, "--list"], "--list and --tolerance work only with --verify."],
      [[zip, "--tolerance", "5"], "--list and --tolerance work only with --verify."],
      [[zip, "--out", "  "], "--out needs a file name"],
      [[zip, "--folder", join(dir, "nowhere")], "could not find"],
      [[zip, "--folder", zip], "needs a folder"],
      [[zip, "--bogus"], 'Snappy does not know the option --bogus for rescue. Run "snappy-export help rescue"'],
      [["--verify", manifest], "--verify needs --folder"],
      [["--verify", manifest, "--folder", folder, zip], "--verify reads no export."],
      [["--verify", manifest, "--folder", folder, "--out", join(dir, "x.json")], "belong to the manifest"],
      [["--verify", manifest, "--folder", folder, "--tolerance", "x"], "--tolerance must be a whole number"],
      [["--verify", join(dir, "missing.json"), "--folder", folder], "could not find"],
      [["--verify", folder, "--folder", folder], "needs a file"],
      [["--verify", manifest, "--folder", join(dir, "nowhere")], "could not find"],
      [["--verify", notes, "--folder", folder], "That file is not a Snappy rescue manifest."],
      [["--verify", shape, "--folder", folder], "That file is not a Snappy rescue manifest."],
      [["--verify", other, "--folder", folder], "different version of Snappy"],
    ];
    for (const [args, message] of cases) {
      const result = await runInsight(rescueCommand, args);
      expect(result.code, args.join(" ")).toBe(1);
      expect(result.out, args.join(" ")).toBe("");
      expect(result.err, args.join(" ")).toContain(message);
      expectBrandSafe(stripPaths(result.err), args.join(" "));
    }
    // Nothing was written by a mistake.
    expect(existsSync(join(dir, "x.json"))).toBe(false);
  });
});

describe("privacy", () => {
  it("prints no canary, link, entry name or username, in text, JSON, verbose and error output", async () => {
    const dir = tempDir("rescue-canary");
    const zip = writeSyntheticZip(dir, "export.zip", { bundleMedia: true });
    const parts = join(dir, "parts");
    writeSyntheticParts(parts, { memoryCount: 200 });
    const target = join(dir, "m.json");
    expect((await runInsight(rescueCommand, [zip, "--out", target])).code).toBe(0);
    const folder = join(dir, "folder");
    populate(folder, readManifest(target));
    const damaged = join(dir, "damaged.zip");
    const full = syntheticExportZip({ now: LATER, friendCount: 40, memoryCount: 20 });
    writeFileSync(damaged, full.subarray(0, Math.floor(full.length * 0.6)));

    const runs: string[][] = [
      [zip],
      [zip, "--json", "--verbose"],
      [parts],
      [parts, "--layout", "flat", "--verbose"],
      [zip, "--folder", folder],
      ["--verify", target, "--folder", folder],
      ["--verify", target, "--folder", folder, "--json", "--verbose"],
      ["--verify", target, "--folder", tempDir("rescue-canary-empty"), "--verbose"],
      [damaged],
      [damaged, "--verbose"],
      [join(dir, "missing.zip"), "--verbose"],
      [zip, "--layout", "no"],
    ];
    for (const args of runs) {
      const { out, err } = await runInsight(rescueCommand, args);
      const text = stripPaths(out + err);
      const label = args.map((a) => (a.startsWith(dir) ? "<tmp>" : a)).join(" ");
      expectNoLeaks(text, label);
      expect(text, label).not.toMatch(/\b(?:ghost|oneway|dormant|active|newfriend)_\d+\b/);
      expect(text, label).not.toMatch(/\.(?:jpg|mp4|png|html)\b|[0-9A-F]{8}-[0-9A-F]{4}/i);
    }
  });

  it("prints a saved name only in the listing the person asked for", async () => {
    const s = await sampleRescue("rescue-names");
    const sample = s.manifest.items[0]!.path;
    for (const args of [[s.zip], [s.zip, "--json"], ["--verify", s.manifestPath, "--folder", s.folder], ["--verify", s.manifestPath, "--folder", s.folder, "--json", "--verbose"]]) {
      const { out } = await runInsight(rescueCommand, args);
      expect(out, args.join(" ")).not.toContain(sample);
    }
  });
});

const baseCounts = (n: number): Counts => ({ items: n, images: n, videos: 0, unknown: 0, overlayFiles: n, undated: n, withSize: n });

const buildView = (n: number, over: Partial<Extract<RescueView, { mode: "build" }>> = {}): RescueView => ({
  mode: "build",
  planned: n,
  fromFolder: true,
  counts: baseCounts(n),
  notes: ["path-skipped", "path-duplicate", "overlay-skipped", "id-replaced", "time-in-future", "time-invalid", "size-missing", "a-code-from-the-future"].map((code) => ({ code, params: { count: n } })),
  wantedFile: true,
  savedTo: "rescue.json",
  ...over,
});

const verifyView = (n: number): RescueView => ({
  mode: "verify",
  createdAt: NOW,
  manifestCounts: baseCounts(n),
  manifestNotes: [{ code: "path-skipped", params: { count: n } }],
  list: true,
  result: {
    ok: false,
    expectedFiles: n,
    diskFiles: n,
    counts: { matched: n, missing: n, extra: n, sizeMismatch: n, timeMismatch: n },
    missing: [{ id: "a", path: "2023/2023-04/one.jpg", kind: "main" }],
    extra: [{ path: "two.jpg" }],
    sizeMismatch: [{ id: "b", path: "three.jpg", expected: 4, actual: 5 }],
    timeMismatch: [{ id: "c", path: "four.jpg", kind: "main", expected: NOW, actual: null }],
    truncated: true,
    notes: ["size-not-checked", "time-not-checked", "case-differs", "duplicate-disk-entry", "a-code-from-the-future"].map((code) => ({ code, params: { count: n } })) as insights.rescueManifest.VerifyResult["notes"],
  },
});

describe("wording", () => {
  it.each([0, 1, 2, 12])("reads correctly with a count of %i", (n) => {
    for (const view of [buildView(n), buildView(n, { fromFolder: false, savedTo: undefined }), verifyView(n)]) {
      const text = renderRescueManifest(view, term, false);
      expectBrandSafe(text, `count ${n}`);
      expect(text).not.toContain("a-code-from-the-future");
      expect(text).toContain("Snappy noted something it cannot describe.");
      expect(text.endsWith("Nothing here has left this device.\n")).toBe(true);
    }
  });

  it("says one item and one date, not 1 items", () => {
    const one = renderRescueManifest(buildView(1), term, false);
    expect(one).toContain("1 item had no usable file name and was left out.");
    expect(one).toContain("1 overlay file had no usable name and was left out.");
    expect(one).toContain("1 date is in the future, so it counts as missing.");
    expect(one).toContain("1 item has no saved size, so a later check compares it by name and date only.");
    expect(one).toContain("1 of 1 Memory found in the folder.");
    const many = renderRescueManifest(buildView(2), term, false);
    expect(many).toContain("2 items had no usable file name and were left out.");
    expect(many).toContain("2 dates are in the future, so they count as missing.");
    expect(many).toContain("2 items have no saved size, so a later check compares them by name and date only.");
    const check = renderRescueManifest(verifyView(1), term, false);
    expect(check).toContain("1 file in the manifest, 1 in the folder.");
    expect(check).toContain("1 file has no capture date, so its date was not checked.");
    expect(check).toContain("1 file name differs from the manifest only in letter case.");
    expect(renderRescueManifest(verifyView(2), term, false)).toContain("2 files have no capture date, so their date was not checked.");
  });

  it("handles an empty plan", () => {
    const text = renderRescueManifest(buildView(0, { planned: 0, notes: [], savedTo: undefined }), term, false);
    expect(text).toContain("This export has no Memories to list.");
    expect(text).toContain("No manifest was saved, since it would be empty.");
  });

  it("shows the capped list note and the problem labels", () => {
    const text = renderRescueManifest(verifyView(12), term, false);
    for (const label of ["Missing", "Not in manifest", "Wrong size", "Wrong date", "Files to look at"]) expect(text).toContain(label);
    expect(text).toContain("Each list stops at 50 files. The counts are complete.");
    expect(text).toContain("12 files in the manifest, 12 in the folder.");
  });

  it("keeps every sentence short and in sentence case", () => {
    const text = [buildView(2), verifyView(2)].map((v) => renderRescueManifest(v, term, false)).join("\n");
    const prose = text
      .split("\n")
      .map((line) => line.replace(/^\s*(?:Warning|Note|Error)\s+/, "").replace(/^\s*\d+\. /, "").trim())
      .filter((line) => /[.?]$/.test(line) && !/\s{2,}/.test(line));
    expect(prose.length).toBeGreaterThan(8);
    for (const s of prose.flatMap((line) => line.split(/(?<=[.?])\s+/))) expect(s.split(/\s+/).length, s).toBeLessThanOrEqual(20);
    expect(text).not.toMatch(/\b(?:ghosts?|unfriend\w*|dormant|inactive|dead|simply|just)\b/i);
  });

  it("uses no color with --no-color or NO_COLOR, and color on a color terminal", async () => {
    const dir = tempDir("rescue-color");
    const zip = writeSyntheticZip(dir, "export.zip", { bundleMedia: true });
    const color = await runInsight(rescueCommand, [zip], makeIo({ interactive: true, env: { COLORTERM: "truecolor" } }));
    expect(color.out).toContain("\x1b[");
    expect(color.out).not.toContain("\x1b[38;2;255;");
    const flagged = await runInsight(rescueCommand, [zip, "--no-color"], makeIo({ interactive: true, env: { COLORTERM: "truecolor" } }));
    expect(flagged.out).not.toContain("\x1b");
  });
});
