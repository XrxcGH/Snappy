/**
 * The commands must run in a browser worker, so everything reachable from cli.ts has to stay free of
 * Node. This walks the relative imports from cli.ts and checks each file. The one allowed exception
 * is memories-download.ts (files and the network): the dashboard's worker build replaces it with a
 * stub that cannot download.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

function importsOf(text: string): string[] {
  return [...text.matchAll(/(?:from|import)\s+"([^"]+)"/g)].map((m) => m[1] as string);
}

function graphFrom(entry: string): Map<string, string> {
  const seen = new Map<string, string>();
  const visit = (file: string): void => {
    if (seen.has(file)) return;
    const text = readFileSync(file, "utf8");
    seen.set(file, text);
    for (const spec of importsOf(text)) if (spec.startsWith(".") && spec.endsWith(".ts")) visit(resolve(dirname(file), spec));
  };
  visit(entry);
  return seen;
}

const graph = graphFrom(join(SRC, "cli.ts"));
const named = [...graph.entries()].map(([file, text]) => ({ name: file.slice(SRC.length + 1).replaceAll("\\", "/"), text }));
const offenders = (pattern: RegExp, allowed: string[] = []): string[] => named.filter((f) => !allowed.includes(f.name) && pattern.test(f.text)).map((f) => f.name);

describe("the portable command graph", () => {
  it("reaches every command and no Node entry point or adapter", () => {
    const names = named.map((f) => f.name);
    for (const must of ["cli.ts", "commands/analyze.ts", "commands/memories.ts", "commands/inspect.ts", "commands/demo.ts", "ports.ts", "ledger-store.ts"]) expect(names, must).toContain(must);
    for (const never of ["main.ts", "node-io.ts", "node-ports.ts"]) expect(names, never).not.toContain(never);
  });

  it("imports node: modules only in memories-download.ts", () => {
    expect(offenders(/["']node:/, ["memories-download.ts"])).toEqual([]);
  });

  it("reads no process state and uses no Node-only globals", () => {
    expect(offenders(/\bprocess\./)).toEqual([]);
    expect(offenders(/\bBuffer\b/)).toEqual([]);
    expect(offenders(/NodeJS\./)).toEqual([]);
    expect(offenders(/\brequire\(|__dirname|__filename|import\.meta/)).toEqual([]);
  });

  it("does not import the package manifest or the dashboard", () => {
    expect(offenders(/package\.json|apps\/dashboard/)).toEqual([]);
  });
});
