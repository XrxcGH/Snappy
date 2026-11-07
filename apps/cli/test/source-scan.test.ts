/**
 * Source gates for the CLI, in the spirit of core's boundary test: only the Memories downloader
 * may touch the network, only the Io adapter may read process state or the clock, nothing may
 * log directly, and no off-brand color or hard-coded token value may creep in.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(CLI, "src");

function listTs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? listTs(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : []));
}

const files = listTs(SRC)
  .map((p) => ({ path: relative(SRC, p).split(sep).join("/"), text: readFileSync(p, "utf8") }))
  .sort((a, b) => a.path.localeCompare(b.path));

const without = (allowed: string[]) => files.filter((f) => !allowed.includes(f.path));
const offenders = (list: typeof files, pattern: RegExp) => list.filter((f) => pattern.test(f.text)).map((f) => f.path);

describe("source scan", () => {
  it("finds the modules the task calls for", () => {
    const paths = files.map((f) => f.path);
    for (const must of ["main.ts", "fs-reader.ts", "prompt.ts", "term.ts", "memories-download.ts", "ledger-store.ts", "commands/analyze.ts", "commands/memories.ts", "commands/inspect.ts", "commands/demo.ts", "commands/keep.ts", "commands/ledger.ts"]) {
      expect(paths, must).toContain(must);
    }
  });

  it("only memories-download.ts references fetch or any network module", () => {
    const network = /\bfetch\b|XMLHttpRequest|WebSocket|EventSource|sendBeacon|node:https?\b|node:http2|node:net\b|node:tls|node:dgram|node:dns|https?:\/\//;
    expect(offenders(without(["memories-download.ts"]), network)).toEqual([]);
    const download = files.find((f) => f.path === "memories-download.ts");
    expect(download?.text).toMatch(/globalThis\.fetch/);
  });

  it("never spawns processes or evaluates code", () => {
    expect(offenders(files, /child_process|node:worker_threads|\beval\(|new Function\(/)).toEqual([]);
  });

  it("never logs directly: output goes through the injected Io", () => {
    expect(offenders(files, /\bconsole\./)).toEqual([]);
  });

  it("reads the clock only in the Io adapter", () => {
    expect(offenders(without(["io.ts"]), /Date\.now\(|new Date\(\)|performance\.now\(|process\.hrtime/)).toEqual([]);
  });

  it("touches process streams and the environment only in io.ts and main.ts", () => {
    expect(offenders(without(["io.ts", "main.ts"]), /process\.(stdout|stderr|stdin|env|argv|exit)\b/)).toEqual([]);
  });

  it("accepts the passphrase only through the environment, a file or a prompt, never an argument", () => {
    expect(offenders(files, /["']?passphrase["']?\s*:\s*\{\s*type/)).toEqual([]);
    expect(offenders(files, /--passphrase(?!-file)/)).toEqual([]);
  });

  it("uses explicit .ts extensions on every relative import", () => {
    const bad: string[] = [];
    for (const f of files) {
      for (const m of f.text.matchAll(/from\s+"(\.{1,2}\/[^"]+)"/g)) {
        const spec = m[1] as string;
        if (!spec.endsWith(".ts") && !spec.endsWith(".json")) bad.push(`${f.path}: ${spec}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("keeps orange out of code, and brand values out of literals", () => {
    expect(offenders(files, /orange|vermilion|ff3d14|ff4d00|ff5a1f/i)).toEqual([]);
    // ANSI 256-color codes 202 to 208 and 214 and 215 are the oranges: the only 256-color index in use is the violet.
    expect(offenders(files, /38;5;(?!\$\{VIOLET_256\})|(?:202|208|214)m/)).toEqual([]);
    // Colors come from tokens: no hex literals in source (the one RGB triple is checked against tokens.css).
    expect(offenders(files, /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/)).toEqual([]);
  });

  it("has no stubs or leftover markers", () => {
    expect(offenders(files, /\bTODO\b|\bFIXME\b|\bXXX\b|not implemented/i)).toEqual([]);
  });

  it("has no third-party runtime imports beyond @snappy-export/core", () => {
    const bad: string[] = [];
    for (const f of files) {
      for (const m of f.text.matchAll(/from\s+"([^."][^"]*)"/g)) {
        const spec = m[1] as string;
        if (!spec.startsWith("node:") && spec !== "@snappy-export/core") bad.push(`${f.path}: ${spec}`);
      }
    }
    expect(bad).toEqual([]);
    const pkg = JSON.parse(readFileSync(join(CLI, "package.json"), "utf8"));
    expect(Object.keys(pkg.dependencies)).toEqual(["@snappy-export/core"]);
  });
});
