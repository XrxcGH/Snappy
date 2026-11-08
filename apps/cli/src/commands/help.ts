/** snappy-export help: the overview, or one command's usage. */
import { parseFlags } from "../args.ts";
import { CliError } from "../errors.ts";
import { INSIGHT_COMMANDS } from "../insight-commands.ts";
import type { InsightGroup } from "../insights-command.ts";
import type { Io } from "../io.ts";
import { NOT_AFFILIATED, PRIVACY_IMPORT } from "../render.ts";
import { createTerm } from "../term.ts";
import { ANALYZE_USAGE } from "./analyze.ts";
import { DEMO_USAGE } from "./demo.ts";
import { HISTORY_USAGE } from "./history.ts";
import { INSPECT_USAGE } from "./inspect.ts";
import { KEEP_USAGE } from "./keep.ts";
import { MEMORIES_USAGE } from "./memories.ts";

const HELP_USAGE = `Usage: snappy-export help [command]

Shows the list of commands, or the options of one command.
`;

const USAGE: Record<string, string> = {
  help: HELP_USAGE,
  inspect: INSPECT_USAGE,
  analyze: ANALYZE_USAGE,
  keep: KEEP_USAGE,
  unkeep: KEEP_USAGE,
  history: HISTORY_USAGE,
  // The older name still shows its help, but the overview does not list it.
  ledger: HISTORY_USAGE,
  memories: MEMORIES_USAGE,
  demo: DEMO_USAGE,
  ...Object.fromEntries(INSIGHT_COMMANDS.map((c) => [c.name, c.usage])),
};

/** One line of the overview. A summary ends with a period here, and the list prints it without. */
interface Row {
  synopsis: string;
  summary: string;
}

/** The overview groups, in print order. The insight commands name their own group. */
const GROUPS: readonly (InsightGroup | "More")[] = ["Your export", "Friends", "Chats", "Memories", "Checklists", "More"];

/** The commands that came before the insights, placed in the same groups. They come first in each group. */
const CORE_ROWS: Record<InsightGroup | "More", Row[]> = {
  "Your export": [
    { synopsis: "inspect <ZIP files...>", summary: "Show your export's shape, never its contents." },
    { synopsis: "history status", summary: "Show which exports are saved." },
  ],
  Friends: [
    { synopsis: "analyze <ZIP files...>", summary: "Find friends to review, and save your history." },
    { synopsis: "keep <username...>", summary: "Add friends to your keep list." },
    { synopsis: "unkeep <username...>", summary: "Take friends off your keep list." },
  ],
  Chats: [],
  Memories: [{ synopsis: "memories <ZIP files...>", summary: "Save your Memories with their dates restored." }],
  Checklists: [],
  More: [
    { synopsis: "demo", summary: "Try Snappy on invented data." },
    { synopsis: "help [command]", summary: "Show help." },
  ],
};

/** The rows of one group: the earlier commands, then the insight commands that name the group. */
function rowsOf(group: InsightGroup | "More"): Row[] {
  return [...CORE_ROWS[group], ...INSIGHT_COMMANDS.filter((c) => c.group === group).map((c) => ({ synopsis: c.synopsis, summary: c.summary }))];
}

export function helpCommand(args: string[], io: Io, version: string): number {
  // help takes --no-color like every command, before or after the topic. Any other option is a mistake.
  const { values: flags, positionals } = parseFlags<{ "no-color"?: boolean }>("help", args, { "no-color": { type: "boolean" }, help: { type: "boolean", short: "h" } });
  const topic = positionals[0];
  if (topic !== undefined) {
    const usage = Object.hasOwn(USAGE, topic) ? USAGE[topic] : undefined;
    if (usage === undefined) {
      throw new CliError("usage", `No help for "${topic}". Run "snappy-export help" to see the commands.`);
    }
    io.out.write(usage);
    return 0;
  }

  const term = createTerm({ env: io.env, isTTY: io.interactive, columns: io.columns, noColorFlag: flags["no-color"] });
  const width = Math.max(...GROUPS.flatMap((g) => rowsOf(g).map((r) => r.synopsis.length)));
  const listing = GROUPS.flatMap((group) => [
    term.bold(group),
    ...rowsOf(group).map((r) => `  ${r.synopsis.padEnd(width)}  ${r.summary.replace(/\.$/, "")}`),
    "",
  ]);
  io.out.write(
    [
      ...term.banner(),
      "",
      `Version ${version}`,
      "",
      "Usage: snappy-export <command> [options]",
      "",
      ...listing,
      "<ZIP files...> means .zip files, or a folder with every part of one export.",
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
