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
      throw new CliError("usage", `No help for "${topic}". Run "snappy-export help" to see the commands.`);
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
      "  analyze <ZIP files...>   Find friends to review and update your saved history",
      "  memories <ZIP files...>  Save your Memories with their dates restored",
      "  inspect <ZIP files...>   Show the shape of your export, never its contents",
      "  keep <username...>       Add friends to your keep list",
      "  unkeep <username...>     Take friends off your keep list",
      "  ledger status            Show which exports are saved",
      "  demo                     Try Snappy on invented data",
      "  help [command]           Show help",
      "",
      "<ZIP files...> means .zip files, or a folder with every part of one export.",
      'The "ledger" is your saved history: the sealed file that holds your past exports.',
      'Run "snappy-export help <command>" for its options. Add --verbose to see short codes for bug reports.',
      "",
      PRIVACY_IMPORT,
      "",
      NOT_AFFILIATED,
      "",
    ].join("\n"),
  );
  return 0;
}
