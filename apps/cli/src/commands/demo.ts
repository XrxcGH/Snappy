/**
 * snappy-export demo: write two SYNTHETIC exports (invented friends, no real data) and show how to try
 * Snappy on them. Nothing here ever touches a real Snapchat export.
 */
import { syntheticExportZip } from "@snappy-export/core";
import { parseFlags } from "../args.ts";
import type { OptionSpec } from "../args.ts";
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

/** The options this command accepts, shared with the in-app command catalog's checks. */
export const DEMO_OPTIONS: OptionSpec = {
  dir: { type: "string" },
  run: { type: "boolean" },
  "no-color": { type: "boolean" },
  help: { type: "boolean", short: "h" },
};

interface Flags {
  dir?: string;
  run?: boolean;
  "no-color"?: boolean;
  help?: boolean;
}

/** What the app calls the temporary folder of the demo files, instead of its real path. */
const APP_FOLDER = "demo";

/** `snappy-export`, or the npm script form when that is how Snappy was started. */
function commandPrefix(io: Io): string {
  return io.env.npm_lifecycle_event === "snappy-export" ? "npm run snappy-export --" : "snappy-export";
}

export async function demoCommand(args: string[], io: Io): Promise<number> {
  const { values: flags } = parseFlags<Flags>("demo", args, DEMO_OPTIONS);
  if (flags.help) {
    io.out.write(DEMO_USAGE);
    return 0;
  }
  const term = createTerm({ env: io.env, isTTY: io.interactive, columns: io.columns, noColorFlag: flags["no-color"] });

  let dir: string;
  try {
    if (flags.dir === undefined) dir = await io.fs.makeTempDir(io.path.join(io.tmpdir(), "snappy-demo-"));
    else {
      dir = flags.dir;
      await io.fs.mkdir(dir, { recursive: true });
    }
  } catch (e) {
    throw fsError(e, "create the demo folder", flags.dir ?? io.tmpdir());
  }

  const earlier = io.path.join(dir, "snappy-demo-earlier.zip");
  const later = io.path.join(dir, "snappy-demo-later.zip");
  // The real export shape: empty Memories links, files paired by time, a Snap history.
  const common = { now: DEMO_NOW, friendCount: 60, memoryCount: 40, realisticMemories: true };
  await atomicWrite(io, earlier, syntheticExportZip({ ...common, phase: 1 }), { sync: false });
  await atomicWrite(io, later, syntheticExportZip({ ...common, phase: 2 }), { sync: false });

  const snappy = commandPrefix(io);
  const intro = [...term.banner(), "", "Two demo exports are ready. They are invented: made-up friends, no real data.", ""];
  if (io.env.SNAPPY_APP === "1") {
    // Inside the app the files live in a temporary folder that exists only in this window. Its path means nothing on the
    // person's computer, and the commands built on it cannot be pasted anywhere, so the files get a plain name and no list.
    io.out.write(
      [
        ...intro,
        `  Earlier export: ${APP_FOLDER}/snappy-demo-earlier.zip`,
        `  Later export:   ${APP_FOLDER}/snappy-demo-later.zip`,
        "",
        "These files exist only inside the app, for this run.",
        "Commands to try on demo files are for the command line tool. Run snappy-export demo there.",
        "",
      ].join("\n") + "\n",
    );
  } else {
    const analyze = `${snappy} analyze "${later}" --earlier "${earlier}" --no-save`;
    const memories = `${snappy} memories "${later}" --dry-run`;
    io.out.write(
      [
        ...intro,
        `  Earlier export: ${earlier}`,
        `  Later export:   ${later}`,
        "",
        "Find friends to review (saves nothing):",
        `  ${analyze}`,
        "",
        "Preview a Memories rescue (writes nothing):",
        `  ${memories}`,
        "",
        `Run ${snappy} help for the rest.`,
        "",
      ].join("\n") + "\n",
    );
  }

  if (flags.run) {
    io.out.write(term.bold("Running the first command") + "\n\n");
    return analyzeCommand([later, "--earlier", earlier, "--no-save", ...(flags["no-color"] ? ["--no-color"] : [])], io);
  }
  return 0;
}
