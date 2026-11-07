/** snappy-export storage: the Memories storage planner. Synthetic data only. */
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { insights, syntheticExportZip } from "@snappy-export/core";
import type { MemoryItem } from "@snappy-export/core";
import { renderStorage, storageCommand } from "../src/commands/storage.ts";
import { createTerm } from "../src/term.ts";
import { LATER, NOW, makeIo, stripPaths, tempDir, writeSyntheticParts, writeSyntheticZip } from "./helpers.ts";
import { expectBrandSafe, expectNoLeaks, expectValidDescriptor, runInsight } from "./insights-helpers.ts";

type Plan = insights.storagePlanner.StoragePlan;
const term = createTerm({ env: {}, isTTY: false, columns: 100 });
const GB = 1024 ** 3;

/** Hand-built Memories: `n` items spread over `years` years, alternating photo and video. */
function memories(n: number, opts: { years?: number; size?: number | null; part?: number } = {}): MemoryItem[] {
  const years = opts.years ?? 3;
  return Array.from({ length: n }, (_, i) => ({
    id: `m${i}`,
    date: Date.UTC(2026 - (i % years), 0, 1) + i * 3_600_000,
    mediaType: Math.floor(i / years) % 2 === 0 ? ("image" as const) : ("video" as const),
    ...(opts.size === null ? {} : { sizeBytes: opts.size ?? 1000 + i }),
    ...(opts.part !== undefined && { partIndex: opts.part }),
  }));
}

const plan = (items: MemoryItem[], goal = 5 * GB, opts: insights.storagePlanner.StoragePlanOptions = {}): Plan =>
  insights.storagePlanner.planMemoryStorage(items, goal, { now: NOW, ...opts });

describe("the command", () => {
  it("is a valid descriptor", async () => {
    await expectValidDescriptor(storageCommand);
    expect(storageCommand.name).toBe("storage");
    expect(storageCommand.group).toBe("Memories");
  });

  it("plans a single export and exits 0", async () => {
    const zip = writeSyntheticZip(tempDir("storage-one"), "a.zip", { bundleMedia: true });
    const { code, out, err } = await runInsight(storageCommand, [zip]);
    expect(code).toBe(0);
    expect(err).toBe("");
    for (const heading of ["Memories storage plan", "Your goal", "By year", "By type", "By ZIP part", "Download order", "Batches", "Notes"]) {
      expect(out).toContain(heading);
    }
    expect(out).toContain("of 5 GB");
    expect(out).toContain("20 Memories counted.");
    expect(out).toContain("Everything with a known size fits under your goal.");
    expect(out).toContain("Sizes marked with + may be short.");
    expect(out).not.toContain("code:");
    expect(out.endsWith("Nothing here has left this device.\n")).toBe(true);
    expectBrandSafe(out, "storage");
  });

  it("plans a three-part export with sizes by part", async () => {
    const dir = tempDir("storage-parts");
    writeSyntheticParts(dir);
    const { code, out } = await runInsight(storageCommand, [dir]);
    expect(code).toBe(0);
    expect(out).toContain("400 Memories counted.");
    expect(out).toMatch(/Part 2\s+\d+/);
    expect(out).toMatch(/Part 3\s+\d+/);
    expect(out).toMatch(/Photos\s+\d+/);
    expect(out).toMatch(/Videos\s+\d+/);
    expect(out).toMatch(/\n\s+1\s+2026\s+Photos/);
    expectBrandSafe(out, "parts");
  });

  it("says when a small goal fits only part of the Memories", async () => {
    const dir = tempDir("storage-small");
    writeSyntheticParts(dir);
    const { code, out } = await runInsight(storageCommand, [dir, "--goal-gb", "0.00003"]);
    expect(code).toBe(0);
    expect(out).toMatch(/Your goal fits \d+ Memories\. \d+ Memories would wait for more space\./);
    expect(out).toMatch(/\d+ Memories would not fit under your goal\./);
    expect(out).toContain("Partly");
    expect(out).toContain("No");
    expectBrandSafe(out, "small goal");
  });

  it("puts the oldest year first with --oldest-first", async () => {
    const dir = tempDir("storage-order");
    writeSyntheticParts(dir);
    const newest = await runInsight(storageCommand, [dir]);
    const oldest = await runInsight(storageCommand, [dir, "--oldest-first"]);
    expect(newest.out).toContain("Newest year first.");
    expect(oldest.out).toContain("Oldest year first.");
    expect(oldest.out).toMatch(/\n\s+1\s+2022\s+Photos/);
    expect(oldest.out).not.toContain("Newest year first.");
  });

  it("shows a few batches and says how many more follow", async () => {
    const dir = tempDir("storage-batches");
    writeSyntheticParts(dir);
    const { code, out } = await runInsight(storageCommand, [dir, "--batch-gb", "0.0000001"]);
    expect(code).toBe(0);
    expect(out).toMatch(/\d+ batches of up to \d+ B, for what fits under your goal\./);
    expect(out).toMatch(/\d+ more batches follow\. Add --json for all of them\./);
    expect(out).toMatch(/\d+ Memories are larger than a batch and get batches alone\./);
    // Ten batch rows, not hundreds.
    const rows = out.split("\n").filter((l) => /^\s+\d+\s+1\s+\d+ B\s+\d{4}/.test(l));
    expect(rows.length).toBeLessThanOrEqual(10);
  });

  it("adds the short code to each note with --verbose", async () => {
    const zip = writeSyntheticZip(tempDir("storage-verbose"), "a.zip", { bundleMedia: true });
    const quiet = await runInsight(storageCommand, [zip]);
    expect(quiet.out).not.toContain("code:");
    const verbose = await runInsight(storageCommand, [zip, "--verbose"]);
    expect(verbose.out).toContain("code: lower-bound");
  });

  it("describes an export with no Memories without failing", async () => {
    const zip = writeSyntheticZip(tempDir("storage-empty"), "e.zip", { memoryCount: 0 });
    const { code, out } = await runInsight(storageCommand, [zip]);
    expect(code).toBe(0);
    expect(out).toContain("0 Memories counted.");
    expect(out).toContain("No Memories were found in this export.");
    expect(out).not.toContain("By year");
    expectBrandSafe(out, "empty");
  });

  it("stops with exit 2 and plans nothing from a broken export", async () => {
    const dir = tempDir("storage-broken");
    const full = syntheticExportZip({ now: LATER, friendCount: 40, memoryCount: 20 });
    const damaged = join(dir, "damaged.zip");
    writeFileSync(damaged, full.subarray(0, Math.floor(full.length * 0.6)));
    const text = await runInsight(storageCommand, [damaged]);
    expect(text.code).toBe(2);
    expect(text.out).toContain("Error");
    expect(text.out).toContain("Snappy did not plan from a broken export.");
    expect(text.out).not.toContain("Memories storage plan");
    expect(text.out).not.toContain("code:");
    expectBrandSafe(text.out, "broken");
    const json = await runInsight(storageCommand, [damaged, "--json"]);
    expect(json.code).toBe(2);
    const parsed = JSON.parse(json.out) as { stopped: string; issues: { severity: string }[]; byYear?: unknown };
    expect(parsed.stopped).toBe("export-errors");
    expect(parsed.issues.some((i) => i.severity === "error")).toBe(true);
    expect(parsed.byYear).toBeUndefined();
    const verbose = await runInsight(storageCommand, [damaged, "--verbose"]);
    expect(verbose.out).toContain("code: zip-unreadable");
  });

  it("prints JSON with numbers and codes only, and no Memory ids", async () => {
    const dir = tempDir("storage-json");
    writeSyntheticParts(dir);
    const { code, out } = await runInsight(storageCommand, [dir, "--json", "--goal-gb", "0.00003"]);
    expect(code).toBe(0);
    const json = JSON.parse(out) as Omit<Plan, "batches"> & { generatedAt: string; batches: Record<string, unknown>[] };
    expect(json.generatedAt).toBe(new Date(NOW).toISOString());
    expect(Object.keys(json)).toEqual(["generatedAt", "goalBytes", "batchBytes", "order", "totals", "byYear", "byType", "byPart", "fit", "priority", "batches", "meter", "notes"]);
    expect(json.goalBytes).toBe(0.00003 * GB);
    expect(json.totals.items).toBe(400);
    expect(json.order).toBe("newest-first");
    expect(json.byYear.map((y) => y.year)).toEqual([2022, 2023, 2024, 2025, 2026]);
    expect(json.fit.fitsAll).toBe(false);
    expect(json.batches.length).toBeGreaterThan(0);
    expect(out).not.toContain("itemIds");
    for (const b of json.batches) expect(Object.keys(b)).not.toContain("itemIds");
    const oldest = JSON.parse((await runInsight(storageCommand, [dir, "--json", "--oldest-first"])).out) as Plan;
    expect(oldest.order).toBe("oldest-first");
  });

  it("uses no color with --no-color or NO_COLOR, and color on a color terminal", async () => {
    const zip = writeSyntheticZip(tempDir("storage-color"), "a.zip", { bundleMedia: true });
    const color = await runInsight(storageCommand, [zip], makeIo({ interactive: true, env: { COLORTERM: "truecolor" } }));
    expect(color.out).toContain("\x1b[");
    const flagged = await runInsight(storageCommand, [zip, "--no-color"], makeIo({ interactive: true, env: { COLORTERM: "truecolor" } }));
    expect(flagged.out).not.toContain("\x1b");
    const env = await runInsight(storageCommand, [zip], makeIo({ interactive: true, env: { NO_COLOR: "1" } }));
    expect(env.out).not.toContain("\x1b");
    // Orange belongs to the Memories rescue only.
    expect(color.out).not.toContain("38;2;255");
  });

  it("writes no file, reads no ledger and asks for no passphrase", async () => {
    const home = tempDir("storage-home");
    const dir = tempDir("storage-ro");
    writeSyntheticParts(dir);
    const before = readdirSync(dir).sort();
    const io = makeIo({ home });
    await runInsight(storageCommand, [dir], io);
    await runInsight(storageCommand, [dir, "--json"], io);
    expect(io.asked).toEqual([]);
    expect(readdirSync(home)).toEqual([]);
    expect(readdirSync(dir).sort()).toEqual(before);
  });

  it("does not accept the ledger options, since it never reads the ledger", async () => {
    const zip = writeSyntheticZip(tempDir("storage-ledger"), "a.zip");
    const r = await runInsight(storageCommand, [zip, "--ledger", "x.sealed"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain('Snappy does not know the option --ledger for storage. Run "snappy-export help storage"');
  });
});

describe("errors", () => {
  it("stops with calm messages for no input, a missing path and a wrong file", async () => {
    const dir = tempDir("storage-errors");
    const missing = await runInsight(storageCommand, [join(dir, "missing.zip")]);
    expect(missing).toMatchObject({ code: 1, out: "" });
    expect(missing.err).toContain("could not find");
    expect((await runInsight(storageCommand, [])).err).toContain("Give Snappy your export");
    const notZip = join(dir, "notes.txt");
    writeFileSync(notZip, "not a zip");
    const wrong = await runInsight(storageCommand, [notZip]);
    expect(wrong.code).toBe(1);
    expect(wrong.out).toBe("");
    expect(wrong.err).not.toContain("not a zip");
  });

  it("rejects a bad option or option value before reading anything", async () => {
    const dir = tempDir("storage-bad");
    const gone = join(dir, "missing.zip");
    for (const [args, message] of [
      [[gone, "--goal-gb", "x"], "--goal-gb must be a number above 0, for example --goal-gb 5."],
      [[gone, "--goal-gb", "0"], "--goal-gb must be a number above 0"],
      [[gone, "--goal-gb", "1e3"], "--goal-gb must be a number above 0"],
      [[gone, "--goal-gb", "-5"], "--goal-gb"],
      [[gone, "--goal-gb", "200000"], "--goal-gb must be a number above 0"],
      [[gone, "--batch-gb", "abc"], "--batch-gb must be a number above 0, for example --batch-gb 5."],
      [[gone, "--batch-gb"], "The option --batch-gb needs a value."],
      [[gone, "--bogus"], 'Snappy does not know the option --bogus for storage. Run "snappy-export help storage"'],
      [[gone, "--oldest-first=yes"], "does not take a value"],
    ] as const) {
      const r = await runInsight(storageCommand, [...args]);
      expect(r.code, args.join(" ")).toBe(1);
      expect(r.out, args.join(" ")).toBe("");
      expect(r.err, args.join(" ")).toContain(message);
      expect(r.err, args.join(" ")).not.toContain("could not find");
    }
  });

  it("accepts a decimal goal and batch size", async () => {
    const zip = writeSyntheticZip(tempDir("storage-decimal"), "a.zip", { bundleMedia: true });
    const r = await runInsight(storageCommand, [zip, "--goal-gb", "2.5", "--batch-gb", "0.5"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("of 2.5 GB");
    expect(r.out).toContain("of up to 512 MB");
  });
});

describe("privacy", () => {
  it("prints no canary, link, entry name or username, in text, JSON, verbose or errors", async () => {
    const dir = tempDir("storage-canary");
    const zip = writeSyntheticZip(dir, "export.zip", { bundleMedia: true });
    const parts = join(dir, "parts");
    writeSyntheticParts(parts, { memoryCount: 200 });
    const damaged = join(dir, "damaged.zip");
    writeFileSync(damaged, syntheticExportZip({ now: LATER, friendCount: 40, memoryCount: 20 }).subarray(0, 900));
    const argLists = [
      [zip],
      [zip, "--json"],
      [parts],
      [parts, "--json", "--verbose"],
      [parts, "--verbose", "--goal-gb", "0.00002", "--batch-gb", "0.0000001"],
      [damaged, "--verbose"],
      [damaged, "--json"],
      [join(dir, "missing.zip"), "--verbose"],
      [zip, "--goal-gb", "x", "--verbose"],
      [zip, "--bogus"],
    ];
    for (const args of argLists) {
      const { out, err } = await runInsight(storageCommand, args);
      const text = stripPaths(out + err);
      const label = args.map((a) => stripPaths(a)).join(" ");
      expectNoLeaks(text, label);
      expect(text, label).not.toMatch(/\b(?:ghost|oneway|dormant|active|newfriend)_\d+\b/);
      expect(text, label).not.toMatch(/\.(?:jpg|mp4|png|html|json)\b|[0-9A-F]{8}-[0-9A-F]{4}/i);
    }
  });
});

describe("wording", () => {
  it.each([0, 1, 2, 12])("reads correctly with %i Memories", (n) => {
    for (const items of [memories(n), memories(n, { size: null }), memories(n, { part: 2 })]) {
      for (const goal of [5 * GB, 2500]) {
        const text = renderStorage(plan(items, goal), term, true);
        expectBrandSafe(text, `count ${n}`);
        expect(text).toContain(`${n === 1 ? "1 Memory" : `${n} Memories`} counted.`);
      }
    }
  });

  it("says one Memory, not 1 Memories", () => {
    const one = renderStorage(plan(memories(1, { size: null })), term, false);
    expect(one).toContain("1 Memory has no known size.");
    const some = renderStorage(plan(memories(2, { size: null })), term, false);
    expect(some).toContain("2 Memories have no known size.");
    const wait = renderStorage(plan(memories(6), 3100), term, false);
    expect(wait).toMatch(/Your goal fits 3 Memories\. 3 Memories would wait for more space\./);
    const single = renderStorage(plan(memories(2), 1100), term, false);
    expect(single).toContain("Your goal fits 1 Memory. 1 Memory would wait for more space.");
    expect(single).toContain("1 Memory would not fit under your goal.");
  });

  /** A plan carrying every note, to read each sentence at counts of 1 and 2. */
  function allNotes(n: number): Plan {
    const codes = ["empty", "goal-defaulted", "batch-size-defaulted", "lower-bound", "over-goal", "undated-items", "future-dates", "oversize-items", "duplicates-skipped", "a-code-from-the-future"];
    return { ...plan(memories(3)), notes: codes.map((code) => ({ code, params: { count: n } }) as Plan["notes"][number]) };
  }

  it.each([0, 1, 2, 12])("words every note with a count of %i", (n) => {
    const text = renderStorage(allNotes(n), term, false);
    expectBrandSafe(text, `notes ${n}`);
    expect(text).not.toContain("a-code-from-the-future");
    expect(text).toContain("Snappy noted something it cannot describe.");
    expect(text).toContain("Run it with --verbose and share the code.");
  });

  it("agrees the verbs for one and for many", () => {
    const one = renderStorage(allNotes(1), term, false);
    expect(one).toContain("1 Memory has no usable date and comes last.");
    expect(one).toContain("1 Memory has a date in the future. Snappy treats it as undated.");
    expect(one).toContain("1 Memory is larger than a batch and gets a batch alone.");
    expect(one).toContain("1 probable duplicate was left out of these numbers.");
    const many = renderStorage(allNotes(2), term, false);
    expect(many).toContain("2 Memories have no usable date and come last.");
    expect(many).toContain("2 Memories have a date in the future. Snappy treats them as undated.");
    expect(many).toContain("2 Memories are larger than a batch and get batches alone.");
    expect(many).toContain("2 probable duplicates were left out of these numbers.");
  });

  it("keeps every sentence short and in sentence case", () => {
    const text = renderStorage(allNotes(2), term, false);
    const prose = text
      .split("\n")
      .map((line) => line.replace(/^\s*(?:Warning|Note|Error)\s+/, "").trim())
      .filter((line) => /[.?]$/.test(line) && !/\s{2,}/.test(line));
    expect(prose.length).toBeGreaterThan(8);
    for (const s of prose.flatMap((line) => line.split(/(?<=[.?])\s+/))) expect(s.split(/\s+/).length, s).toBeLessThanOrEqual(20);
    expect(text).not.toMatch(/\b(?:ghosts?|unfriend\w*|dormant|inactive|dead|simply|just)\b/i);
  });
});

describe("rendering branches", () => {
  it("shows undated and unsized Memories without a number for what is not known", () => {
    const items: MemoryItem[] = [
      ...memories(4),
      { id: "u1", date: null, mediaType: "unknown", sizeBytes: 500 },
      { id: "u2", date: null, mediaType: "image" },
    ];
    const text = renderStorage(plan(items), term, false);
    expect(text).toContain("No date");
    expect(text).toContain("Other");
    expect(text).toMatch(/\dB?\+|B\+/);
    expect(text).toContain("2 Memories have no usable date and come last.");
    expectBrandSafe(text, "undated");
  });

  it("skips the ZIP part table when no Memory has a part", () => {
    expect(renderStorage(plan(memories(4)), term, false)).not.toContain("By ZIP part");
    expect(renderStorage(plan(memories(4, { part: 3 })), term, false)).toContain("Part 3");
  });

  it("caps the download order and says how many steps follow", () => {
    const text = renderStorage(plan(memories(60, { years: 8 })), term, false);
    expect(text).toMatch(/4 more steps follow in the same order\. Add --json for all of them\./);
    const steps = text.split("\n").filter((l) => /^\s+\d+\s+20\d\d\s+(?:Photos|Videos)/.test(l));
    expect(steps).toHaveLength(12);
    const small = renderStorage(plan(memories(12, { years: 3 })), term, false);
    expect(small).not.toContain("more steps follow");
  });

  it("caps the batches and says how many follow", () => {
    const text = renderStorage(plan(memories(40, { size: 100 }), 5 * GB, { batchBytes: 250 }), term, false);
    expect(text).toMatch(/20 batches of up to 250 B/);
    expect(text).toContain("10 more batches follow. Add --json for all of them.");
    const one = renderStorage(plan(memories(1)), term, false);
    expect(one).toContain("1 batch of up to 1 GB, for what fits under your goal.");
  });

  it("describes a span of years in a batch", () => {
    const text = renderStorage(plan(memories(6, { years: 3 })), term, false);
    expect(text).toContain("2026 to 2024");
  });

  it("prints no Memory id", () => {
    const text = renderStorage(plan(memories(12)), term, true);
    expect(text).not.toMatch(/\bm\d+\b/);
  });
});
