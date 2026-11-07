/**
 * Privacy gate for the CLI: a synthetic export is seeded with canary strings (message text,
 * display names, group titles, locations, captions, account details, download links). Every
 * command runs over it, and no canary may appear in anything the CLI prints or writes.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { CANARIES, buildSyntheticExport, openLedger, serializeLedger, syntheticExportZip } from "@snappy-export/core";
import type { Transport } from "../src/memories-download.ts";
import { allowlistPathFor } from "../src/ledger-store.ts";
import { describeZips } from "./verify-memories-output.ts";
import { LATER, makeIo, run, tempDir, writeSyntheticParts } from "./helpers.ts";
import { INSIGHT_COMMANDS } from "../src/insight-commands.ts";
import { insightRuns } from "./insight-outputs.ts";
import { SHARED_HOOK_TIMEOUT } from "./shared-runs.ts";

const ALL_CANARIES = Object.values(CANARIES).flat();
const LINK_PIECES = ["demo.snappy.invalid", "uid=demo", "mid=", "/media/", "https://", "http://"];
const PASS = "canary-test-passphrase";

/** Everything a run produced that a user could see or share. */
function leaks(text: string, label: string): void {
  for (const canary of ALL_CANARIES) expect(text, `${label} leaked ${JSON.stringify(canary)}`).not.toContain(canary);
}

function noLinks(text: string, label: string): void {
  for (const piece of LINK_PIECES) expect(text, `${label} leaked a link fragment ${piece}`).not.toContain(piece);
}

function setup() {
  const dir = tempDir("canary");
  const zip = join(dir, "export.zip");
  writeFileSync(zip, syntheticExportZip({ now: LATER, friendCount: 40, memoryCount: 20, bundleMedia: true }));
  const earlier = join(dir, "earlier.zip");
  writeFileSync(earlier, syntheticExportZip({ now: LATER, phase: 1, friendCount: 40, memoryCount: 20 }));
  return { dir, zip, earlier };
}

/** The synthetic export really contains the canaries: otherwise this whole file proves nothing. */
describe("canary premise", () => {
  it("seeds every canary category and the download links into the export being analyzed", () => {
    const files = buildSyntheticExport({ now: LATER, friendCount: 40, memoryCount: 20, bundleMedia: true });
    const text = Object.entries(files)
      .filter(([name]) => name.endsWith(".json"))
      .map(([, bytes]) => new TextDecoder().decode(bytes))
      .join(" ");
    for (const [category, list] of Object.entries<string[]>(CANARIES as unknown as Record<string, string[]>)) {
      expect(list.some((c) => text.includes(c)), `no ${category} canary in the export`).toBe(true);
    }
    expect(text).toContain("demo.snappy.invalid");
  });
});

describe("no canary reaches any output", () => {
  it("analyze: text, JSON, CSV and errors", async () => {
    const { dir, zip, earlier } = setup();
    const csv = join(dir, "q.csv");

    const text = await run(["analyze", zip, "--earlier", earlier, "--no-save", "--csv", csv, "--limit", "0"]);
    expect(text.code).toBe(0);
    leaks(text.out + text.err, "analyze text");
    noLinks(text.out + text.err, "analyze text");
    leaks(readFileSync(csv, "utf8"), "csv");

    const json = await run(["analyze", zip, "--earlier", earlier, "--no-save", "--json"]);
    leaks(json.out + json.err, "analyze json");
    noLinks(json.out + json.err, "analyze json");
    expect(() => JSON.parse(json.out)).not.toThrow();
  });

  it("analyze: the sealed ledger and allowlist hold usernames only, even once decrypted", async () => {
    const { dir, zip, earlier } = setup();
    const ledger = join(dir, "ledger.sealed");
    const env = { SNAPPY_PASSPHRASE: PASS };
    await run(["analyze", earlier, "--ledger", ledger], makeIo({ env }));
    const result = await run(["analyze", zip, "--ledger", ledger], makeIo({ env }));
    leaks(result.out + result.err, "ledger run");
    await run(["keep", "ghost_1", "--ledger", ledger], makeIo({ env }));

    const sealed = readFileSync(ledger);
    leaks(sealed.toString("latin1"), "sealed ledger bytes");
    const plain = serializeLedger(await openLedger(sealed, PASS));
    leaks(plain, "ledger plaintext");
    leaks(readFileSync(allowlistPathFor(ledger)).toString("latin1"), "sealed allowlist bytes");
    expect(readdirSync(dir).sort()).toEqual(["earlier.zip", "export.zip", "ledger.allowlist.sealed", "ledger.sealed"]);
  });

  it("inspect: default and --show-keys", async () => {
    const { zip } = setup();
    for (const extra of [[], ["--show-keys"]]) {
      const { code, out, err } = await run(["inspect", zip, ...extra]);
      expect(code).toBe(0);
      leaks(out + err, `inspect ${extra.join(" ")}`);
      noLinks(out + err, `inspect ${extra.join(" ")}`);
    }
  });

  it("memories: dry run, bundled extraction and downloads, including the report", async () => {
    const { dir, zip } = setup();

    const dry = await run(["memories", zip, "--dry-run", "--download"]);
    leaks(dry.out + dry.err, "memories dry run");
    noLinks(dry.out + dry.err, "memories dry run");

    const transport: Transport = async (url) =>
      url.includes("mid=a") ? new Response("expired", { status: 403 }) : new Response(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), { headers: { "content-type": "image/jpeg" } });
    const out = join(dir, "rescued");
    const real = await run(["memories", zip, "--out", out, "--download"], makeIo({ transport, sleep: async () => undefined }));
    leaks(real.out + real.err, "memories run");
    noLinks(real.out + real.err, "memories run");

    const report = readFileSync(join(out, "memories-report.json"), "utf8");
    leaks(report, "memories report");
    noLinks(report, "memories report");
    const names = readdirSync(out, { recursive: true }).map(String).join("\n");
    leaks(names, "memories file names");
    noLinks(names, "memories file names");
  });

  it("errors on a damaged export stay calm and carry no export data", async () => {
    const { dir } = setup();
    const full = syntheticExportZip({ now: LATER, friendCount: 40, memoryCount: 20, bundleMedia: true });
    const damaged = join(dir, "damaged.zip");
    writeFileSync(damaged, full.subarray(0, Math.floor(full.length * 0.6)));
    for (const args of [["analyze", damaged, "--no-save"], ["inspect", damaged], ["memories", damaged, "--dry-run"]]) {
      const { out, err } = await run(args);
      leaks(out + err, args.join(" "));
      noLinks(out + err, args.join(" "));
    }
  });

  it("debug mode prints code locations, never data", async () => {
    const { zip } = setup();
    const io = makeIo({
      env: { SNAPPY_DEBUG: "1" },
      now: () => {
        throw new Error(`boom ${ALL_CANARIES[0]} ZQCANARY-MSG-1`);
      },
    });
    const { code, out, err } = await run(["analyze", zip, "--no-save"], io);
    expect(code).toBe(1);
    expect(err).toContain("The output never includes your data");
    expect(err).toMatch(/\n\s+at /); // frames only
    leaks(out + err, "debug output");
    expect(err).not.toContain("boom");
  });
});

/**
 * The 14 insight commands, run through the CLI over the canary export (the runs in insight-outputs.ts):
 * nothing they print, in text or JSON, and nothing they write, may carry a canary or a link fragment, and
 * a mistake never names a person.
 */
describe("no canary reaches an insight command", () => {
  // The runs are shared with other test files, so on a busy machine this may wait for another worker.
  beforeAll(async () => {
    await insightRuns();
  }, SHARED_HOOK_TIMEOUT);

  const USERNAME = /\b(?:ghost|oneway|dormant|active|newfriend|friend|user)_\d+\b/;

  it("text output, including every mistake", async () => {
    const { outputs } = await insightRuns();
    expect(Object.keys(outputs).length).toBeGreaterThan(50);
    for (const [name, text] of Object.entries(outputs)) {
      leaks(text, name);
      noLinks(text, name);
      if (name.includes(" error ")) expect(text, `${name} names a person`).not.toMatch(USERNAME);
    }
  });

  it("JSON output, for every command, over the export with download links and the three-part export", async () => {
    const { json } = await insightRuns();
    // A command with no JSON run here would never be checked, so a missing one fails.
    for (const command of INSIGHT_COMMANDS) {
      const runs = Object.keys(json).filter((name) => name.startsWith(`${command.name} `) && name.includes(" json"));
      expect(runs.length, `${command.name} has no JSON run`).toBeGreaterThan(0);
      if (command.name !== "privacy") {
        // Both exports, so a leak of a link and a leak of an entry name can each be seen.
        expect(runs.some((name) => name.endsWith(" json parts")), `${command.name} has no JSON run over the three-part export`).toBe(true);
        expect(runs.some((name) => name.endsWith(" json")), `${command.name} has no JSON run over the export with links`).toBe(true);
      }
    }
    expect(Object.keys(json).length).toBeGreaterThan(40);
    for (const [name, text] of Object.entries(json)) {
      leaks(text, name);
      noLinks(text, name);
      expect(() => JSON.parse(text), name).not.toThrow();
    }
  });

  it("the files they write on purpose, from an export that holds download links", async () => {
    const { files } = await insightRuns();
    const names = Object.keys(files);
    expect(names.length).toBe(8);
    for (const extension of [".json", ".ics"]) expect(names.some((n) => n.endsWith(extension)), extension).toBe(true);
    for (const [path, text] of Object.entries(files)) {
      leaks(text, path);
      noLinks(text, path);
    }
  });
});

/**
 * The same gate over the real shape: three zips whose Memories files are named after their
 * identifiers. Nothing printed, reported, named or written may carry a canary or the name of any
 * zip entry (its folder, its file name or the identifier inside it).
 */
describe("no canary or zip entry name reaches a three-part rescue", () => {
  /** The entry names to look for (every name but the JSON files' own, which inspect may print), and the identifiers inside them. */
  function entryPieces(allNames: string[]): { names: string[]; uuids: string[]; pieces: string[] } {
    const names = allNames.filter((n) => !n.startsWith("json/"));
    const uuids = [...new Set(names.flatMap((n) => /[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}/i.exec(n) ?? []))];
    const pieces = [...new Set([...names, ...names.map((n) => n.slice(n.lastIndexOf("/") + 1))])].filter((p) => p !== "index.html");
    return { names, uuids, pieces };
  }

  const dir = tempDir("canary-parts");
  const zips = writeSyntheticParts(dir, { memoryCount: 200 });
  const { names, uuids, pieces } = entryPieces(describeZips(zips).names);

  /** Text a person could see or share: no canary, no entry name, no identifier. */
  function clean(text: string, label: string, own = { uuids, pieces }): void {
    leaks(text, label);
    noLinks(text, label);
    for (const piece of [...own.pieces, ...own.uuids]) expect(text, `${label} leaked an entry name`).not.toContain(piece);
  }

  it("premise: the zips hold many named entries and Memories files with identifiers", () => {
    expect(names.length).toBeGreaterThan(50);
    expect(uuids.length).toBeGreaterThan(30);
  });

  it("memories: dry run and real run, output, report, file names and file contents", async () => {
    const dry = await run(["memories", dir, "--dry-run", "--download"]);
    clean(dry.out + dry.err, "memories dry run");

    const out = join(tempDir("canary-parts-out"), "rescued");
    const real = await run(["memories", dir, "--out", out, "--download"]);
    expect(real.code).toBe(0);
    clean(real.out + real.err, "memories run");
    const again = await run(["memories", dir, "--out", out]);
    clean(again.out + again.err, "memories second run");

    const all = readdirSync(out, { recursive: true, withFileTypes: true }).filter((e) => e.isFile());
    clean(readFileSync(join(out, "memories-report.json"), "utf8"), "memories report");
    clean(all.map((e) => join(e.parentPath, e.name).slice(out.length)).join("|"), "memories file names");
    // Nothing but rescued files and the report: no part files, no temp files.
    expect(all.every((e) => e.name === "memories-report.json" || /^\d{4}-\d{2}-\d{2}_\d{6}_(image|video)_\d{4}(-overlay)?\.(jpg|mp4|png)$/.test(e.name))).toBe(true);

    // The files themselves: no canary, no entry name. A JPEG also holds no identifier (its comments are dropped);
    // an MP4 keeps its media payload as stored, which in the synthetic files is the identifier, so it is not asked of it.
    for (const e of all) {
      const bytes = readFileSync(join(e.parentPath, e.name));
      const text = bytes.toString("latin1");
      for (const canary of ALL_CANARIES) expect(text, "file bytes").not.toContain(canary);
      for (const piece of pieces) expect(text, "file bytes").not.toContain(piece);
      if (e.name.endsWith(".jpg")) for (const id of uuids) expect(text, "jpeg bytes").not.toContain(id);
    }
    // Three real runs over multi-part zips: about 5 s alone, but it passed the default 30 s limit once under a full parallel run.
  }, 120_000);

  it("the 14 insight commands: text, JSON and the files they write, over a three-part export", async () => {
    const runs = await insightRuns();
    // The runs read their own exports, so the entry names inside them are what must stay out.
    const own = entryPieces(runs.entryNames);
    expect(own.names.length).toBeGreaterThan(50);
    expect(own.uuids.length).toBeGreaterThan(30);
    for (const [name, text] of Object.entries(runs.outputs)) clean(text, name, own);
    for (const [name, text] of Object.entries(runs.json)) clean(text, name, own);
    for (const [path, text] of Object.entries(runs.files)) clean(text, path, own);
  }, SHARED_HOOK_TIMEOUT);

  it("analyze and inspect over all three parts", async () => {
    const csv = join(tempDir("canary-parts-csv"), "q.csv");
    const text = await run(["analyze", dir, "--no-save", "--limit", "0", "--csv", csv]);
    expect(text.code).toBe(0);
    clean(text.out + text.err, "analyze text");
    clean(readFileSync(csv, "utf8"), "analyze csv");
    const json = await run(["analyze", dir, "--no-save", "--json"]);
    clean(json.out + json.err, "analyze json");
    for (const extra of [[], ["--show-keys"], ["--layout", "--memory-links", "--mtime-check", "--checks-only"]]) {
      const inspected = await run(["inspect", dir, ...extra]);
      expect(inspected.code).toBe(0);
      // inspect names the JSON files it knows; every other entry name must stay out.
      clean(inspected.out + inspected.err, `inspect ${extra.join(" ")}`);
    }
  });
});
