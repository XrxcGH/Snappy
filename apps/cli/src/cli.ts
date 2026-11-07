/**
 * Snappy's portable command runner: dispatch only. Every command is a function of (args, io), so
 * tests drive them directly and the dashboard runs them in a worker. This file and everything it
 * imports reach the outside world only through the Io (see ports.ts); main.ts is the one Node
 * entry point. Errors end here as calm messages; the short code appears only with --verbose. Stack
 * traces appear only with SNAPPY_DEBUG=1, and even then only the code locations, never a message
 * that could hold data.
 */
import type { OptionSpec } from "./args.ts";
import { ANALYZE_OPTIONS, analyzeCommand } from "./commands/analyze.ts";
import { DEMO_OPTIONS, demoCommand } from "./commands/demo.ts";
import { helpCommand } from "./commands/help.ts";
import { INSPECT_OPTIONS, inspectCommand } from "./commands/inspect.ts";
import { KEEP_OPTIONS, keepCommand } from "./commands/keep.ts";
import { LEDGER_OPTIONS, ledgerCommand } from "./commands/ledger.ts";
import { MEMORIES_OPTIONS, memoriesCommand } from "./commands/memories.ts";
import { CliError } from "./errors.ts";
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

/** The options each command accepts, for tools that must agree with the parser (the in-app command catalog). */
export const COMMAND_OPTIONS: Readonly<Record<string, OptionSpec>> = {
  analyze: ANALYZE_OPTIONS,
  memories: MEMORIES_OPTIONS,
  inspect: INSPECT_OPTIONS,
  keep: KEEP_OPTIONS,
  unkeep: KEEP_OPTIONS,
  ledger: LEDGER_OPTIONS,
  demo: DEMO_OPTIONS,
};

/** The names of the commands, plus help and version, which are handled here. */
export const COMMAND_NAMES: readonly string[] = ["help", "version", ...Object.keys(COMMANDS)];

export interface CliMeta {
  version: string;
}

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

export async function runCli(argv: string[], io: Io, meta: CliMeta): Promise<number> {
  try {
    const [command, ...rest] = argv;
    if (command === undefined || command === "help" || command === "--help" || command === "-h") {
      return helpCommand(rest, io, meta.version);
    }
    if (command === "--version" || command === "-v" || command === "version") {
      io.out.write(`snappy-export ${meta.version}\n`);
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
