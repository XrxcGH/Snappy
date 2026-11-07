/**
 * The commands the app can show and run. Every command block on every page comes from one entry
 * here. An entry is data: the argument list is written in code (never parsed from display text), and
 * the words shown to people (the title) come from copy.ts. The page builds the real argument list
 * from an entry plus the files the person picked, then checks it with policy.ts.
 *
 * This module imports no command code, so the page never carries the commands themselves.
 */
import { terminal } from "../copy.ts";

export type CommandId =
  | "help"
  | "demo-run"
  | "inspect"
  | "analyze-preview"
  | "analyze-save"
  | "memories-preview"
  | "memories-rescue"
  | "ledger-status"
  // The insight commands, one per tool page: each is shown in its plainest form, which reads the export and writes nothing.
  | "check"
  | "storage"
  | "backup"
  | "replies"
  | "reply-speed"
  | "reach-out"
  | "habits"
  | "calendar"
  | "closest"
  | "safety"
  | "anniversaries"
  | "on-this-day"
  | "gaps"
  | "blocked"
  | "lookalikes"
  | "friend-count"
  | "friends"
  | "rescue-manifest"
  | "privacy"
  | "remind"
  | "since"
  | "year-in-review";

/** A place in a command that the person fills: their export files, or the folder for saved files. */
export interface Slot {
  slot: "export" | "out";
  /** What Copy shows until anything is chosen. */
  example: string;
}

export type Arg = string | Slot;

export interface CommandSpec {
  id: CommandId;
  /** One short line, from copy.ts. */
  title: string;
  /** Written in code, never parsed from display text. */
  argv: readonly Arg[];
  /** The command reads the person's export files (an "export" slot). */
  needsFile: boolean;
  /** The command asks for the passphrase of the saved history. */
  needsPassphrase: boolean;
  /** What the command writes: nothing, the saved history, or files in the virtual folder. */
  effect: "none" | "store" | "folder";
  /** The command needs the network. Such a command is shown and copied, never run here. */
  network: boolean;
}

/**
 * What Copy shows in front of every command. The npm script is the form that works in a fresh
 * clone of the repository; one constant, so a later switch to a bare snappy-export is one line.
 */
export const CLI_PREFIX = "npm run snappy-export --";

const EXPORT_EXAMPLE = "<your export folder>";
const OUT_EXAMPLE = "<folder for rescued Memories>";
const SHAPE_EXAMPLE = "mydata~1234567890123.zip";

const exportSlot = (example: string = EXPORT_EXAMPLE): Slot => ({ slot: "export", example });
const outSlot: Slot = { slot: "out", example: OUT_EXAMPLE };

function entry(id: CommandId, argv: readonly Arg[], extra: Partial<Pick<CommandSpec, "needsPassphrase" | "effect" | "network">> = {}): CommandSpec {
  return {
    id,
    title: terminal.titles[id],
    argv,
    needsFile: argv.some((a) => typeof a !== "string" && a.slot === "export"),
    needsPassphrase: extra.needsPassphrase ?? false,
    effect: extra.effect ?? "none",
    network: extra.network ?? false,
  };
}

export const COMMANDS: Readonly<Record<CommandId, CommandSpec>> = {
  help: entry("help", ["help"]),
  "demo-run": entry("demo-run", ["demo", "--run"]),
  inspect: entry("inspect", ["inspect", exportSlot(SHAPE_EXAMPLE)]),
  "analyze-preview": entry("analyze-preview", ["analyze", exportSlot(), "--no-save"]),
  "analyze-save": entry("analyze-save", ["analyze", exportSlot()], { needsPassphrase: true, effect: "store" }),
  "memories-preview": entry("memories-preview", ["memories", exportSlot(), "--dry-run"]),
  "memories-rescue": entry("memories-rescue", ["memories", exportSlot(), "--out", outSlot], { effect: "folder" }),
  "ledger-status": entry("ledger-status", ["ledger", "status"], { needsPassphrase: true }),
  check: entry("check", ["check", exportSlot()]),
  storage: entry("storage", ["storage", exportSlot()]),
  backup: entry("backup", ["backup", exportSlot()]),
  replies: entry("replies", ["replies", exportSlot()]),
  "reply-speed": entry("reply-speed", ["reply-speed", exportSlot()]),
  "reach-out": entry("reach-out", ["reach-out", exportSlot()]),
  habits: entry("habits", ["habits", exportSlot()]),
  calendar: entry("calendar", ["calendar", exportSlot()]),
  closest: entry("closest", ["closest", exportSlot()]),
  safety: entry("safety", ["safety"]),
  anniversaries: entry("anniversaries", ["anniversaries", exportSlot()]),
  "on-this-day": entry("on-this-day", ["on-this-day", exportSlot()]),
  gaps: entry("gaps", ["gaps", exportSlot()]),
  blocked: entry("blocked", ["blocked", exportSlot()]),
  lookalikes: entry("lookalikes", ["lookalikes", exportSlot()]),
  // --no-save keeps it from opening the saved history, so it needs no passphrase.
  "friend-count": entry("friend-count", ["friend-count", exportSlot(), "--no-save"]),
  friends: entry("friends", ["friends", exportSlot()]),
  "rescue-manifest": entry("rescue-manifest", ["rescue", exportSlot()]),
  privacy: entry("privacy", ["privacy"]),
  remind: entry("remind", ["remind"]),
  since: entry("since", ["since", exportSlot()], { needsPassphrase: true }),
  "year-in-review": entry("year-in-review", ["year", exportSlot()]),
};

export const COMMAND_IDS = Object.keys(COMMANDS) as CommandId[];

/** A word that the shell would split or read as redirection is quoted, as in the Copy text people paste. */
const quoted = (token: string): string => (/[\s<>"'|&;$`\\*?]/.test(token) ? `"${token.replace(/(["\\$`])/g, "\\$1")}"` : token);

/** The text Copy puts on the clipboard and the block shows: the prefix, then the words with their examples. */
export function displayText(spec: CommandSpec): string {
  const words = spec.argv.map((a) => (typeof a === "string" ? a : a.example)).map(quoted);
  return [CLI_PREFIX, ...words].join(" ");
}

export interface Binding {
  /** The /in names of the picked files, in the order they were chosen. */
  export: readonly string[];
  /** The folder under /out for saved files. Default: memories. */
  out?: string;
}

export const OUT_FOLDER = "/out/memories";

/** The argument list the helper receives: files under /in, saved files under /out. */
export function bindArgv(spec: CommandSpec, binding: Binding): string[] {
  const out: string[] = [];
  for (const arg of spec.argv) {
    if (typeof arg === "string") out.push(arg);
    else if (arg.slot === "export") out.push(...binding.export.map((name) => `/in/${name}`));
    else out.push(binding.out === undefined ? OUT_FOLDER : `/out/${binding.out}`);
  }
  return out;
}
