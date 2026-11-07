#!/usr/bin/env node
/**
 * Snappy command line: the Node entry point. The commands themselves live in cli.ts and reach the
 * world only through the Io; this file adds the real one (node-io.ts) and the version from
 * package.json. It is the only file here that reads process.argv.
 */
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import pkg from "../package.json" with { type: "json" };
import { runCli as runPortableCli } from "./cli.ts";
import type { Io } from "./io.ts";
import { createRealIo } from "./node-io.ts";

/** Run one command line against `io`. Every test drives the CLI through this. */
export function runCli(argv: string[], io: Io): Promise<number> {
  return runPortableCli(argv, io, { version: pkg.version });
}

/** True when this file is the program being run (not imported by a test). */
function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  process.exitCode = await runCli(process.argv.slice(2), createRealIo());
}
