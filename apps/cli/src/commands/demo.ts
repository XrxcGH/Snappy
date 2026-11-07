/**
 * snappy-export demo: write two SYNTHETIC exports (invented friends, no real data) and show how to try
 * Snappy on them. Nothing here ever touches a real Snapchat export.
 */
import { mkdir, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { syntheticExportZip } from "@snappy-export/core";
import { parseFlags } from "../args.ts";
import { fsError } from "../errors.ts";
import type { Io } from "../io.ts";
import { atomicWrite } from "../ledger-store.ts";
import { createTerm } from "../term.ts";
import { analyzeCommand } from "./analyze.ts";

export const DEMO_USAGE = `Usage: snappy-export demo [--dir <folder>] [--run]

Writes two invented exports, an earlier and a later one, and prints the commands to try.

Options
  --dir <folder>   Where to write the two files. Default: a new temporary folder.
  --run            Also run the analysis now.
  --no-color       Plain text.
`;

/** Fixed, so the demo files are identical on every run. The earlier export is 120 days older. */
const DEMO_NOW = Date.UTC(2026, 10, 1, 12, 0, 0);

interface Flags {
  dir?: string;
  run?: boolean;
  "no-color"?: boolean;
  help?: boolean;
}

/** `snappy-export`, or the npm script form when that is how Snappy was started. */
function commandPrefix(io: Io): string {
  return io.env.npm_lifecycle_event === "snappy-export" ? "npm run snappy-export --" : "snappy-export";
}

export async function demoCommand(args: string[], io: Io): Promise<number> {
  const { values: flags } = parseFlags<Flags>("demo", args, {
    dir: { type: "string" },
    run: { type: "boolean" },
    "no-color": { type: "boolean" },
    help: { type: "boolean", short: "h" },
  });
  if (flags.help) {
    io.out.write(DEMO_USAGE);
    return 0;
  }
  const term = createTerm({ env: io.env, isTTY: io.interactive, columns: io.columns, noColorFlag: flags["no-color"] });

  let dir: string;
  try {
    if (flags.dir === undefined) dir = await mkdtemp(join(io.tmpdir(), "snappy-demo-"));
    else {
      dir = flags.dir;
      await mkdir(dir, { recursive: true });
    }
  } catch (e) {
    throw fsError(e, "create the demo folder", flags.dir ?? io.tmpdir());
  }

  const earlier = join(dir, "snappy-demo-earlier.zip");
  const later = join(dir, "snappy-demo-later.zip");
  // The real export shape: empty Memories links, files paired by time, a Snap history.
  const common = { now: DEMO_NOW, friendCount: 60, memoryCount: 40, realisticMemories: true };
  await atomicWrite(earlier, syntheticExportZip({ ...common, phase: 1 }), { sync: false });
  await atomicWrite(later, syntheticExportZip({ ...common, phase: 2 }), { sync: false });

  const snappy = commandPrefix(io);
  const analyze = `${snappy} analyze "${later}" --earlier "${earlier}" --no-save`;
  const memories = `${snappy} memories "${later}" --dry-run`;
  io.out.write(
    [
      ...term.banner(),
      "",
      "Two demo exports are ready. They are invented: made-up friends, no real data.",
      "",
      `  Earlier export: ${earlier}`,
      `  Later export:   ${later}`,
      "",
      "Find friends to review (saves nothing):",
      `  ${analyze}`,
      "",
      "Preview a Memories rescue (writes nothing):",
      `  ${memories}`,
      "",
    ].join("\n") + "\n",
  );

  if (flags.run) {
    io.out.write(term.bold("Running the first command") + "\n\n");
    return analyzeCommand([later, "--earlier", earlier, "--no-save", ...(flags["no-color"] ? ["--no-color"] : [])], io);
  }
  return 0;
}
