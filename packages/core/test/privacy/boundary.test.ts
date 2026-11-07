/**
 * Boundary gate: @snappy-export/core must stay pure. No network, no process spawning, no logging,
 * no persistence, no clock or randomness (callers inject `now`), and nothing outside the
 * export parsers may mention the names of personal export fields.
 *
 * The scan reads src/ with node:fs. That is allowed HERE ONLY (this file is a test); the
 * test itself also asserts that src/ never imports node:fs.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");

function listTs(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...listTs(p));
    else if (e.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** posix-style path relative to src/, e.g. "export/parse.ts". */
const rel = (p: string) => relative(SRC, p).split(sep).join("/");

const files = listTs(SRC)
  .map((p) => ({ path: rel(p), text: readFileSync(p, "utf8") }))
  .sort((a, b) => a.path.localeCompare(b.path));

/** Substrings no core file may contain (comments included: keep the rule mechanical). */
const FORBIDDEN: readonly string[] = [
  // network
  "fetch(", "XMLHttpRequest", "WebSocket", "sendBeacon", "node:http", "node:https", "node:net", "node:dgram",
  "node:http2", "node:tls", "EventSource(",
  // process spawning
  "child_process",
  // filesystem (core does no I/O: adapters do)
  "node:fs", "node:os", "node:worker_threads",
  // logging
  "console.",
  // persistence belongs to the adapters
  "localStorage", "sessionStorage", "indexedDB",
  // clock and randomness are injected
  "Date.now(", "Math.random(", "new Date()", "performance.now(",
];

/**
 * Per-file exceptions. Every entry needs a reason. Currently none: the only randomness core
 * uses is crypto.getRandomValues for the seal salt/IV, which is deliberately not Math.random.
 */
const ALLOW: Record<string, { strings: string[]; why: string }> = {};

/** Names of personal export fields: only the parsers in src/export/ may mention them. */
const FIELD_NAMES: readonly string[] = ["Content", "Display Name", "Location"];

/**
 * Files outside src/export/ allowed to name those fields.
 * testing/synthetic-export.ts WRITES a fake export in the recalled schema (filled with canary
 * strings) so the privacy tests have something to prove against; it never reads personal data.
 */
const FIELD_ALLOW: Record<string, string> = {
  "testing/synthetic-export.ts": "generates a fake export in the real schema; consumes nothing",
};

describe("boundary: scan sanity", () => {
  it("finds the core modules", () => {
    expect(files.length).toBeGreaterThanOrEqual(20);
    for (const must of ["index.ts", "types.ts", "util.ts", "export/parse.ts", "ledger/seal.ts", "memories/plan.ts"]) {
      expect(files.map((f) => f.path)).toContain(must);
    }
  });

  it("allowlist entries refer to real files", () => {
    const paths = new Set(files.map((f) => f.path));
    for (const p of [...Object.keys(ALLOW), ...Object.keys(FIELD_ALLOW)]) expect(paths.has(p), `stale allowlist entry ${p}`).toBe(true);
    for (const a of Object.values(ALLOW)) expect(a.why.length).toBeGreaterThan(10);
  });
});

describe("boundary: no I/O, logging, persistence, clock or randomness in core", () => {
  for (const needle of FORBIDDEN) {
    it(`no src file contains ${JSON.stringify(needle)}`, () => {
      const offenders = files
        .filter((f) => f.text.includes(needle) && !ALLOW[f.path]?.strings.includes(needle))
        .map((f) => f.path);
      expect(offenders).toEqual([]);
    });
  }

  it("no src file imports any node: builtin", () => {
    const offenders = files
      .flatMap((f) => [...f.text.matchAll(/from\s+["'](node:[^"']+)["']|import\(\s*["'](node:[^"']+)["']\s*\)|require\(\s*["'](node:[^"']+)["']\s*\)/g)].map((m) => `${f.path}: ${m[1] ?? m[2] ?? m[3]}`));
    expect(offenders).toEqual([]);
  });

  it("src only imports relative modules and fflate", () => {
    const bad: string[] = [];
    for (const f of files) {
      for (const m of f.text.matchAll(/(?:^|\n)\s*(?:import|export)\b[^"';]*?\bfrom\s+["']([^"']+)["']/g)) {
        const spec = m[1] as string;
        if (!spec.startsWith("./") && !spec.startsWith("../") && spec !== "fflate") bad.push(`${f.path}: ${spec}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("the only crypto used is the platform's WebCrypto (seal.ts), never node:crypto", () => {
    expect(files.filter((f) => /node:crypto|require\(["']crypto["']\)|from ["']crypto["']/.test(f.text)).map((f) => f.path)).toEqual([]);
  });
});

describe("boundary: personal field names stay inside src/export/", () => {
  for (const needle of FIELD_NAMES) {
    it(`only src/export/ mentions ${JSON.stringify(needle)}`, () => {
      const offenders = files
        .filter((f) => !f.path.startsWith("export/") && !FIELD_ALLOW[f.path] && f.text.includes(needle))
        .map((f) => f.path);
      expect(offenders).toEqual([]);
    });
  }

  it("ledger, memories and detector modules never touch raw export field names at all", () => {
    const inner = files.filter((f) => f.path.startsWith("ledger/") || f.path.startsWith("memories/"));
    expect(inner.length).toBeGreaterThanOrEqual(10);
    for (const f of inner) {
      for (const needle of [...FIELD_NAMES, "Conversation Title", "IsSender", "Latitude", "Longitude", "Caption", "Mobile Number", "Email"]) {
        expect(f.text.includes(needle), `${f.path} mentions ${needle}`).toBe(false);
      }
    }
  });
});
