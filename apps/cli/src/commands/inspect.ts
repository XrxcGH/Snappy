/**
 * snappy-export inspect: print the SHAPE of an export (field names, types, bucketed counts) so a parser
 * problem can be reported without sharing any value. Unknown keys are masked unless --show-keys.
 * The optional checks add aggregates about the folder layout and the Memories files; all of them
 * are built in core, which never copies a name or value from the export into its output.
 */
import { inspectExport } from "@snappy-export/core";
import { parseFlags } from "../args.ts";
import { CliError } from "../errors.ts";
import type { Io } from "../io.ts";
import { resolveZipPaths, withReaders } from "../inputs.ts";

export const INSPECT_USAGE = `Usage: snappy-export inspect <ZIP files or folder...> [--show-keys] [--layout] [--memory-links] [--mtime-check] [--checks-only]

Prints the shape of your export: field names, types and rough counts. It never prints a
value, so the report is safe to share once you have read it. Photos, videos and other files
are counted, never opened or listed.

Give it every part of your export. The parts are named like mydata~1234567890123.zip,
mydata~1234567890123-2.zip and mydata~1234567890123-3.zip. A folder or a wildcard such as
"mydata*.zip" works too.

Options
  --show-keys      Also print unknown field names. Read them before sharing.
  --layout         Add folder totals: files per type, sizes and masked file name shapes.
  --memory-links   Check whether Memories link to files by an identifier. Counts only.
  --mtime-check    Check whether zip times match your Memories dates. Counts only.
  --checks-only    Print only the checks you asked for.
`;

interface Flags {
  "show-keys"?: boolean;
  layout?: boolean;
  "memory-links"?: boolean;
  "mtime-check"?: boolean;
  "checks-only"?: boolean;
  help?: boolean;
}

export async function inspectCommand(args: string[], io: Io): Promise<number> {
  const { values: flags, positionals } = parseFlags<Flags>("inspect", args, {
    "show-keys": { type: "boolean" },
    layout: { type: "boolean" },
    "memory-links": { type: "boolean" },
    "mtime-check": { type: "boolean" },
    "checks-only": { type: "boolean" },
    help: { type: "boolean", short: "h" },
  });
  if (flags.help) {
    io.out.write(INSPECT_USAGE);
    return 0;
  }
  const wantsCheck = flags.layout === true || flags["memory-links"] === true || flags["mtime-check"] === true;
  if (flags["checks-only"] === true && !wantsCheck) {
    throw new CliError("usage", 'The option --checks-only needs at least one check: --layout, --memory-links, or --mtime-check. Run "snappy-export help inspect" to see what each one does.');
  }

  const paths = await resolveZipPaths(positionals);
  const report = await withReaders(paths, (readers) =>
    inspectExport(readers, {
      showKeys: flags["show-keys"] === true,
      layout: flags.layout === true,
      memoryLinks: flags["memory-links"] === true,
      mtimeCheck: flags["mtime-check"] === true,
      checksOnly: flags["checks-only"] === true,
    }),
  );
  io.out.write(report.text);
  // Nothing readable at all: say so through the exit code too.
  return report.readable ? 0 : 2;
}
