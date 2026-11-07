#!/usr/bin/env node
/**
 * Snappy command line: dispatch only. Every command is a function of (args, io), so tests drive
 * them directly. Errors end here as calm messages; the short code appears only with --verbose. Stack traces appear only with
 * SNAPPY_DEBUG=1, and even then only the code locations, never a message that could hold data.
 */
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import pkg from "../package.json" with { type: "json" };
import { analyzeCommand } from "./commands/analyze.ts";
import { demoCommand } from "./commands/demo.ts";
import { helpCommand } from "./commands/help.ts";
import { inspectCommand } from "./commands/inspect.ts";
import { keepCommand } from "./commands/keep.ts";
import { ledgerCommand } from "./commands/ledger.ts";
import { memoriesCommand } from "./commands/memories.ts";
import { CliError } from "./errors.ts";
import { createRealIo } from "./node-io.ts";
import type { Io } from "./io.ts";

type Command = (args: string[], io: Io) => Promise<number>;

const COMMANDS: Record<string, Command> = {
  analyze: analyzeCommand,
  memories: memoriesCommand,
  inspect: inspectCommand,
  keep: (args, io) => keepCommand("keep", args, io),
  unkeep: (args, io) => keepCommand("unkeep", args, io),
  ledger: ledgerCommand,
  demo: demoCommand,
};

/**
 * Print an error for people: what happened, then what to do. The short code is for bug reports, so it
 * is added only with --verbose or SNAPPY_DEBUG=1. Returns the exit code.
 */
function reportError(e: unknown, io: Io, verbose: boolean): number {
  const known = e instanceof CliError;
  io.err.write(
    known
      ? `${e.message}${verbose ? ` (code: ${e.code})` : ""}\n`
      : "Snappy stopped unexpectedly. Run it again with SNAPPY_DEBUG=1 to see where. The output never includes your data.\n",
  );
  if (io.env.SNAPPY_DEBUG === "1" && e instanceof Error) {
    // Frames only: the first line of a stack is the error message, which is exactly what must not be printed.
    const frames = (e.stack ?? "").split("\n").filter((line) => line.trimStart().startsWith("at "));
    io.err.write(`${e.name}\n${frames.join("\n")}\n`);
  }
  return known ? e.exitCode : 1;
}

export async function runCli(argv: string[], io: Io): Promise<number> {
  try {
    const [command, ...rest] = argv;
    if (command === undefined || command === "help" || command === "--help" || command === "-h") {
      return helpCommand(rest, io, pkg.version);
    }
    if (command === "--version" || command === "-v" || command === "version") {
      io.out.write(`snappy-export ${pkg.version}\n`);
      return 0;
    }
    const run = Object.hasOwn(COMMANDS, command) ? COMMANDS[command] : undefined;
    if (run === undefined) {
      throw new CliError("usage", `Unknown command "${command}". Run "snappy-export help" to see the commands.`);
    }
    return await run(rest, io);
  } catch (e) {
    return reportError(e, io, argv.includes("--verbose") || io.env.SNAPPY_DEBUG === "1");
  }
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
