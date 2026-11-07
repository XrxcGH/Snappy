/**
 * Test helpers: an injected Io that captures output, temp folders, and synthetic exports.
 * Everything here uses SYNTHETIC data only.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";
import { CliError } from "../src/errors.ts";
import type { Io } from "../src/io.ts";
import type { Transport } from "../src/memories-download.ts";
import { runCli } from "../src/main.ts";
import { syntheticExportParts, syntheticExportZip } from "@snappy-export/core";
import type { SyntheticExportOptions } from "@snappy-export/core";

/** Generation time of the later synthetic export, and the "now" every test run uses. */
export const LATER = Date.UTC(2026, 10, 1, 12, 0, 0);
export const NOW = Date.UTC(2026, 10, 6, 12, 0, 0);

export interface TestIo extends Io {
  stdout(): string;
  stderr(): string;
  /** Questions asked through askSecret, in order. */
  asked: string[];
}

export interface TestIoOptions {
  env?: Record<string, string | undefined>;
  home?: string;
  /** Answers to hidden prompts, consumed in order. */
  answers?: string[];
  interactive?: boolean;
  columns?: number;
  now?: () => number;
  transport?: Transport;
  sleep?: (ms: number) => Promise<void>;
}

export function makeIo(opts: TestIoOptions = {}): TestIo {
  let out = "";
  let err = "";
  const answers = [...(opts.answers ?? [])];
  const asked: string[] = [];
  return {
    out: { write: (t) => void (out += t) },
    err: { write: (t) => void (err += t) },
    env: { ...(opts.env ?? {}) },
    interactive: opts.interactive ?? false,
    columns: opts.columns ?? 100,
    now: opts.now ?? (() => NOW),
    homedir: () => opts.home ?? join(tmpdir(), "snappy-cli-no-home"),
    tmpdir: () => tmpdir(),
    askSecret: async (question) => {
      asked.push(question);
      const next = answers.shift();
      if (next === undefined) throw new CliError("no-terminal", "no terminal in this test");
      return next;
    },
    transport: opts.transport,
    sleep: opts.sleep,
    stdout: () => out,
    stderr: () => err,
    asked,
  };
}

export interface RunResult {
  code: number;
  out: string;
  err: string;
}

export async function run(args: string[], io: TestIo = makeIo()): Promise<RunResult> {
  const code = await runCli(args, io);
  return { code, out: io.stdout(), err: io.stderr() };
}

const folders: string[] = [];

/** A fresh temp folder, removed after the test file finishes. */
export function tempDir(label = "t"): string {
  const dir = mkdtempSync(join(tmpdir(), `snappy-cli-${label}-`));
  folders.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Write a synthetic export zip into `dir` and return its path. */
export function writeSyntheticZip(dir: string, name: string, opts: Partial<SyntheticExportOptions> = {}): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, syntheticExportZip({ now: LATER, friendCount: 40, memoryCount: 20, ...opts }));
  return path;
}

/** The earlier (phase 1) and later (phase 2) synthetic exports. */
export function writeDemoPair(dir: string, extra: Partial<SyntheticExportOptions> = {}): { earlier: string; later: string } {
  return {
    earlier: writeSyntheticZip(dir, "earlier.zip", { phase: 1, ...extra }),
    later: writeSyntheticZip(dir, "later.zip", { phase: 2, ...extra }),
  };
}

/**
 * Write the three zips of a realistic export (base name, -2, -3) into `dir` and return their
 * paths in export order. The default size gives a few overlay files and files in both parts.
 */
export function writeSyntheticParts(dir: string, opts: Partial<SyntheticExportOptions> = {}): string[] {
  mkdirSync(dir, { recursive: true });
  return syntheticExportParts({ now: LATER, friendCount: 30, memoryCount: 400, ...opts }).map((part) => {
    const path = join(dir, part.name);
    writeFileSync(path, part.bytes);
    return path;
  });
}

/**
 * Text with file paths replaced by "<path>". A path is data from the machine running the test (a
 * Windows runner's temp folder is C:\Users\RUNNER~1\AppData\Local\Temp\...), not copy, so the
 * wording checks (all-caps words, spelling) must not see it. Covers drive paths, UNC paths,
 * home-relative paths (~/.snappy), absolute POSIX paths, and a bare 8.3 short name such as RUNNER~1.
 */
export function stripPaths(text: string): string {
  return text
    .replace(/[A-Za-z]:[\\/][^\s"'<>|?*]*/g, "<path>")
    .replace(/\\\\[^\s\\/"'<>|]+[\\/][^\s"'<>|]*/g, "<path>")
    .replace(/(^|[\s("'=:])~[\\/][^\s"'<>|]*/g, "$1<path>")
    .replace(/(^|[\s("'=:])\/(?:[\w.~@+%-]+\/)*[\w.~@+%-]+(?:\/[^\s"'<>|]*)?/g, "$1<path>")
    .replace(/\b[A-Za-z0-9_]+~\d+\b/g, "<path>");
}
