/** snappy-export help: the overview, or one command's usage. */
import { CliError } from "../errors.ts";
import type { Io } from "../io.ts";
import { NOT_AFFILIATED, PRIVACY_IMPORT } from "../render.ts";
import { createTerm } from "../term.ts";
import { ANALYZE_USAGE } from "./analyze.ts";
import { DEMO_USAGE } from "./demo.ts";
import { INSPECT_USAGE } from "./inspect.ts";
import { KEEP_USAGE } from "./keep.ts";
import { LEDGER_USAGE } from "./ledger.ts";
import { MEMORIES_USAGE } from "./memories.ts";

const USAGE: Record<string, string> = {
  inspect: INSPECT_USAGE,
  analyze: ANALYZE_USAGE,
  keep: KEEP_USAGE,
  unkeep: KEEP_USAGE,
  ledger: LEDGER_USAGE,
  memories: MEMORIES_USAGE,
  demo: DEMO_USAGE,
};

export function helpCommand(args: string[], io: Io, version: string): number {
  const topic = args[0];
  if (topic !== undefined) {
    const usage = USAGE[topic];
    if (usage === undefined) {
      throw new CliError("usage", `Snappy has no help for "${topic}". Run "snappy-export help" to see its commands.`);
    }
    io.out.write(usage);
    return 0;
  }

  const term = createTerm({ env: io.env, isTTY: io.interactive, columns: io.columns, noColorFlag: args.includes("--no-color") });
  io.out.write(
    [
      ...term.banner(),
      "",
      `Version ${version}`,
      "",
      "Usage: snappy-export <command> [options]",
      "",
      term.bold("Commands"),
      "  analyze <zips...>     Find friends worth reviewing and update your sealed ledger",
      "  memories <zips...>    Plan your Memories rescue and save the files with their dates",
      "  inspect <zips...>     Show the structure of your export, never its contents",
      "  keep <username...>    Protect friends from the cleanup queue",
      "  unkeep <username...>  Take friends off your allowlist",
      "  ledger status         Show which exports are in your ledger",
      "  demo                  Try Snappy on invented data",
      "  help [command]        Show help",
      "",
      "<zips...> are one or more .zip files, or a folder holding the parts of one export.",
      'Run "snappy-export help <command>" for the options of a command.',
      "",
      PRIVACY_IMPORT,
      "",
      NOT_AFFILIATED,
      "",
    ].join("\n"),
  );
  return 0;
}
