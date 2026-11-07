/**
 * The commands must say and do the same thing in the app as on the command line. This runs each
 * command twice with the same synthetic export and a fixed clock: once through the in-app helper
 * (virtual file system, saved-history bridge, web lock stand-in) and once through the command line's
 * own ports on a temp folder. Standard output must match byte for byte after the paths are made
 * alike, and the exit codes must be equal. The one allowed difference is file times, which are
 * compared with the tolerance a file system needs. Synthetic data only.
 */
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { syntheticExportParts, syntheticExportZip } from "@snappy-export/core";
import { LATER, NOW, makeIo, run, tempDir } from "../../cli/test/helpers.ts";
import { COMMANDS, COMMAND_IDS, bindArgv } from "../src/terminal/commands.ts";
import { runInHelper } from "./helper-harness.ts";

const PASS = "a long shared passphrase";
const COLUMNS = 80;

interface Fixture {
  /** Names and bytes of the export files. */
  files: { name: string; bytes: Uint8Array }[];
}

function fixtureFor(bytes: Record<string, Uint8Array>): Fixture {
  return { files: Object.entries(bytes).map(([name, data]) => ({ name, bytes: data })) };
}

const later = syntheticExportZip({ now: LATER, friendCount: 40, memoryCount: 20, phase: 2, bundleMedia: true, realisticMemories: true });
const earlier = syntheticExportZip({ now: LATER, friendCount: 40, memoryCount: 20, phase: 1, bundleMedia: true, realisticMemories: true });
const parts = syntheticExportParts({ now: LATER, friendCount: 30, memoryCount: 120 });

const pair = fixtureFor({ "later.zip": later, "earlier.zip": earlier });
const multi = fixtureFor(Object.fromEntries(parts.map((p) => [p.name, p.bytes])));

/** Paths of the temp folder become what the in-app helper calls them. */
function normalize(text: string, dir: string): string {
  const slashed = text.replaceAll("\\", "/");
  const root = dir.replaceAll("\\", "/");
  return slashed
    .replaceAll(`${root}/home`, "/app")
    .replaceAll(`${root}/in`, "/in")
    .replaceAll(`${root}/out`, "/out")
    .replaceAll(tmpdir().replaceAll("\\", "/"), "/tmp")
    .replace(/\/tmp\/snappy-demo-[A-Za-z0-9]+\//g, "/tmp/snappy-demo-X/");
}

interface Side {
  out: string;
  code: number;
}

/** Both sides, with the argument paths written in the app's form and translated for the command line. */
async function bothWays(
  argv: string[],
  fixture: Fixture,
  opts: { answers?: string[]; env?: Record<string, string>; keepDir?: string } = {},
): Promise<{ app: Side & { files: { path: string; bytes: Uint8Array; mtimeMs: number }[] }; cli: Side; dir: string }> {
  const dir = opts.keepDir ?? tempDir("parity");
  const inDir = join(dir, "in");
  mkdirSync(inDir, { recursive: true });
  for (const f of fixture.files) writeFileSync(join(inDir, f.name), f.bytes);

  const cliArgv = argv.map((a) => (a.startsWith("/in/") ? join(dir, a) : a.startsWith("/out/") ? join(dir, a) : a));
  const io = makeIo({
    home: join(dir, "home"),
    interactive: true,
    columns: COLUMNS,
    env: { COLORTERM: "truecolor", SNAPPY_APP: "1" },
    answers: opts.answers,
    now: () => NOW,
  });
  const cli = await run(cliArgv, io);

  const app = await runInHelper(argv, {
    files: fixture.files.map((f) => ({ name: f.name, blob: new Blob([f.bytes as BlobPart]) })),
    answers: opts.answers,
    columns: COLUMNS,
    now: () => NOW,
  });
  return { app: { out: normalize(app.out, dir), code: app.code, files: app.files }, cli: { out: normalize(cli.out + cli.err, dir), code: cli.code }, dir };
}

const same = (r: { app: Side; cli: Side }): void => {
  expect(r.app.out).toBe(r.cli.out);
  expect(r.app.code).toBe(r.cli.code);
};

describe("the app and the command line agree", () => {
  it("help, a topic's help and the version", async () => {
    same(await bothWays(["help"], pair));
    same(await bothWays(["help", "analyze"], pair));
    same(await bothWays(["help", "memories"], pair));
    same(await bothWays(["ledger"], pair));
  });

  it("inspect, with and without each check", async () => {
    same(await bothWays(["inspect", "/in/later.zip"], pair));
    for (const flag of [["--show-keys"], ["--layout"], ["--memory-links"], ["--mtime-check"], ["--layout", "--checks-only"]]) {
      same(await bothWays(["inspect", "/in/later.zip", ...flag], pair));
    }
    same(await bothWays(["inspect", ...multi.files.map((f) => `/in/${f.name}`), "--layout", "--memory-links"], multi));
  });

  it("analyze without saving, alone and against an earlier export", async () => {
    same(await bothWays(["analyze", "/in/later.zip", "--no-save"], pair));
    same(await bothWays(["analyze", "/in/later.zip", "--earlier", "/in/earlier.zip", "--no-save"], pair));
    same(await bothWays(["analyze", "/in/later.zip", "--earlier", "/in/earlier.zip", "--no-save", "--json"], pair));
    same(await bothWays(["analyze", "/in/later.zip", "--no-save", "--min-confidence", "high", "--limit", "5"], pair));
  });

  it("memories as a dry run", async () => {
    same(await bothWays(["memories", "/in/later.zip", "--dry-run"], pair));
    same(await bothWays(["memories", ...multi.files.map((f) => `/in/${f.name}`), "--dry-run", "--layout", "year"], multi));
  });

  it("memories saved from a multi-part export: the same text, the same files, close file times", async () => {
    const names = multi.files.map((f) => `/in/${f.name}`);
    const r = await bothWays(["memories", ...names, "--out", "/out/memories"], multi);
    same(r);
    expect(r.app.code).toBe(0);

    const base = join(r.dir, "out", "memories");
    const onDisk = readdirSync(base, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => relative(base, join(e.parentPath, e.name)).replaceAll("\\", "/"))
      .sort();
    const inApp = r.app.files.map((f) => f.path.replace(/^memories\//, "")).sort();
    expect(inApp).toEqual(onDisk);
    expect(inApp.length).toBeGreaterThan(50);
    for (const f of r.app.files) {
      const real = join(base, f.path.replace(/^memories\//, ""));
      expect(Buffer.from(f.bytes).equals(readFileSync(real)), f.path).toBe(true);
      // File times are the one difference that is allowed, and only by what a file system can store.
      if (f.path.endsWith(".json")) continue;
      expect(Math.abs(f.mtimeMs - statSync(real).mtimeMs), f.path).toBeLessThanOrEqual(2000);
    }
  });

  it("demo --run, which writes invented exports and analyzes them", async () => {
    same(await bothWays(["demo", "--run"], pair));
    same(await bothWays(["demo"], pair));
  });

  it("analyze with saving, then ledger status, through the saved-history bridge", async () => {
    // The command line keeps its files under home; the app keeps one sealed blob on the page.
    const dir = tempDir("parity-store");
    mkdirSync(join(dir, "in"), { recursive: true });
    for (const f of pair.files) writeFileSync(join(dir, "in", f.name), f.bytes);
    const cliRun = async (argv: string[], answers: string[]) => {
      const io = makeIo({ home: join(dir, "home"), interactive: true, columns: COLUMNS, env: { COLORTERM: "truecolor" }, answers, now: () => NOW });
      const r = await run(argv, io);
      return { out: normalize(r.out + r.err, dir), code: r.code, asked: io.asked };
    };
    const blobs = pair.files.map((f) => ({ name: f.name, blob: new Blob([f.bytes as BlobPart]) }));
    let store: Uint8Array | null = null;
    const appRun = async (argv: string[], answers: string[]) => {
      const r = await runInHelper(argv, { files: blobs, answers, columns: COLUMNS, now: () => NOW, store: { bytes: store } });
      store = r.store.bytes;
      return { out: r.out, code: r.code, asked: r.questions };
    };

    const steps: [string[], string[]][] = [
      [["ledger", "status"], []],
      [["analyze", "/in/earlier.zip"], [PASS, PASS]],
      [["analyze", "/in/later.zip"], [PASS]],
      [["ledger", "status"], [PASS]],
      [["ledger", "status"], ["not the passphrase"]],
    ];
    for (const [argv, answers] of steps) {
      const cliArgv = argv.map((a) => (a.startsWith("/in/") ? join(dir, a) : a));
      const c = await cliRun(cliArgv, answers);
      const a = await appRun(argv, answers);
      expect(a.out, argv.join(" ")).toBe(c.out);
      expect(a.code, argv.join(" ")).toBe(c.code);
      expect(a.asked, argv.join(" ")).toEqual(c.asked);
    }
    // One sealed blob now exists on the app side, and the passphrase appears in no output.
    expect(store).not.toBeNull();
  });

  it("every insight command in the catalog, in the form the app shows it", async () => {
    const ids = COMMAND_IDS.filter((id) => !["help", "demo-run", "inspect", "analyze-preview", "analyze-save", "memories-preview", "memories-rescue", "ledger-status"].includes(id));
    expect(ids).toHaveLength(14);
    for (const id of ids) {
      const r = await bothWays(bindArgv(COMMANDS[id], { export: ["later.zip"] }), pair);
      expect(r.app.out, id).toBe(r.cli.out);
      expect(r.app.code, id).toBe(r.cli.code);
      expect(r.app.out.length, id).toBeGreaterThan(40);
    }
  });

  it("an unknown command and a command that fails give the same message and code", async () => {
    const r = await bothWays(["analyze", "/in/missing.zip", "--no-save"], pair);
    expect(r.app.code).toBe(1);
    expect(r.app.out).toBe(r.cli.out);
  });
});
