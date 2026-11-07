/**
 * What a command in the app may do, checked on the argument list before anything runs: once on the
 * page, and once more inside the helper. The page never parses text into a command (it builds the
 * argument list from a catalog entry), so this is a second lock, not the first.
 *
 *  - Only help, demo, inspect, analyze, memories, ledger and the insight commands (check, storage and so on) run here.
 *  - Flags that need the network (--download, --concurrency) or a path on the person's own disk
 *    (--passphrase-file, --ledger, --csv, --dir) are refused for every command.
 *  - Every other flag must be one the command really has.
 *  - File arguments must be inside the app's own virtual folders: export files under /in (or /tmp for
 *    the demo's invented ones), saved files under /out.
 *
 * Pure: no imports, so the page and the worker share it unchanged.
 */

/** The insight commands behind the tool pages. They read an export and print; none of them is allowed to write a file here. */
export const INSIGHT_NAMES = ["check", "storage", "backup", "replies", "reply-speed", "reach-out", "habits", "closest", "safety", "anniversaries", "on-this-day", "blocked", "lookalikes", "friend-count", "friends", "rescue", "privacy", "remind", "since", "year"] as const;

export const ALLOWED_COMMANDS = ["help", "demo", "inspect", "analyze", "memories", "ledger", ...INSIGHT_NAMES] as const;

export type PolicyReason =
  | "empty"
  | "too-many"
  | "too-long"
  | "control-character"
  | "command"
  | "blocked-flag"
  | "unknown-flag"
  | "needs-value"
  | "outside-folders"
  | "extra-argument";

export type PolicyResult = { ok: true } | { ok: false; reason: PolicyReason };

export const MAX_ARGS = 64;
export const MAX_ARG_LENGTH = 4096;

/** Flags that are refused whatever the command: they need the network or the person's own disk. */
const BLOCKED = /^--(download|concurrency|passphrase-file|ledger|csv|dir)(=|$)/;

type ValueKind = "in" | "out" | "text";

interface CommandRules {
  /** Flags that stand alone. */
  flags: readonly string[];
  /** Flags that take a value, and what the value is. */
  values: Readonly<Record<string, ValueKind>>;
  /** What positional arguments are: export files, a fixed word, or a topic. */
  positional: "files" | "status" | "topic" | "none";
}

/** Flags every command has. */
const COMMON = ["verbose", "help"] as const;

export const RULES: Readonly<Record<(typeof ALLOWED_COMMANDS)[number], CommandRules>> = {
  help: { flags: ["no-color"], values: {}, positional: "topic" },
  demo: { flags: [...COMMON, "run", "no-color"], values: {}, positional: "none" },
  inspect: { flags: [...COMMON, "show-keys", "layout", "memory-links", "mtime-check", "checks-only"], values: {}, positional: "files" },
  analyze: {
    flags: [...COMMON, "no-save", "json", "no-color"],
    values: { earlier: "in", "friend-count": "text", "min-confidence": "text", allow: "text", limit: "text" },
    positional: "files",
  },
  memories: { flags: [...COMMON, "dry-run", "no-color"], values: { out: "out", layout: "text", "cap-gb": "text" }, positional: "files" },
  ledger: { flags: [...COMMON, "no-color"], values: {}, positional: "status" },
  // Every insight command also has --json and --no-color. Their other options are left out on purpose: the app runs the plain form.
  check: { flags: [...COMMON, "json", "no-color"], values: { "friend-count": "text" }, positional: "files" },
  storage: { flags: [...COMMON, "json", "no-color"], values: {}, positional: "files" },
  backup: { flags: [...COMMON, "json", "no-color"], values: {}, positional: "files" },
  replies: { flags: [...COMMON, "json", "no-color"], values: {}, positional: "files" },
  "reply-speed": { flags: [...COMMON, "json", "no-color"], values: {}, positional: "files" },
  "reach-out": { flags: [...COMMON, "json", "no-color"], values: {}, positional: "files" },
  habits: { flags: [...COMMON, "json", "no-color"], values: {}, positional: "files" },
  closest: { flags: [...COMMON, "json", "no-color"], values: {}, positional: "files" },
  safety: { flags: [...COMMON, "json", "no-color"], values: {}, positional: "files" },
  anniversaries: { flags: [...COMMON, "json", "no-color"], values: {}, positional: "files" },
  "on-this-day": { flags: [...COMMON, "json", "no-color"], values: {}, positional: "files" },
  blocked: { flags: [...COMMON, "json", "no-color"], values: {}, positional: "files" },
  lookalikes: { flags: [...COMMON, "json", "no-color"], values: {}, positional: "files" },
  "friend-count": { flags: [...COMMON, "json", "no-color", "no-save"], values: {}, positional: "files" },
  friends: { flags: [...COMMON, "json", "no-color"], values: {}, positional: "files" },
  rescue: { flags: [...COMMON, "json", "no-color"], values: {}, positional: "files" },
  privacy: { flags: [...COMMON, "json", "no-color"], values: {}, positional: "none" },
  remind: { flags: [...COMMON, "json", "no-color"], values: {}, positional: "none" },
  since: { flags: [...COMMON, "json", "no-color"], values: {}, positional: "files" },
  year: { flags: [...COMMON, "json", "no-color"], values: {}, positional: "files" },
};

/** True when `path` is inside one of the folders, with no ".." part to climb out. */
function inside(path: string, folders: readonly string[]): boolean {
  if (path.split("/").includes("..")) return false;
  return folders.some((folder) => path.startsWith(`${folder}/`) && path.length > folder.length + 1);
}

function valueOk(kind: ValueKind, value: string): boolean {
  if (kind === "in") return inside(value, ["/in", "/tmp"]);
  if (kind === "out") return inside(value, ["/out"]);
  return true;
}

export function checkArgv(argv: readonly string[]): PolicyResult {
  if (!Array.isArray(argv) || argv.length === 0) return { ok: false, reason: "empty" };
  if (argv.length > MAX_ARGS) return { ok: false, reason: "too-many" };
  for (const arg of argv) {
    if (typeof arg !== "string") return { ok: false, reason: "command" };
    if (arg.length > MAX_ARG_LENGTH) return { ok: false, reason: "too-long" };
    if (/[\0\n\r]/.test(arg)) return { ok: false, reason: "control-character" };
  }
  const command = argv[0] as string;
  if (!(ALLOWED_COMMANDS as readonly string[]).includes(command)) return { ok: false, reason: "command" };
  const rules = RULES[command as (typeof ALLOWED_COMMANDS)[number]];

  let positionals = 0;
  let afterDashes = false;
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (!afterDashes && arg === "--") {
      afterDashes = true;
      continue;
    }
    if (!afterDashes && arg.startsWith("-")) {
      if (BLOCKED.test(arg)) return { ok: false, reason: "blocked-flag" };
      if (arg === "-h") continue;
      const name = arg.startsWith("--") ? arg.slice(2).split("=", 1)[0] ?? "" : "";
      if (rules.flags.includes(name)) {
        if (arg.includes("=")) return { ok: false, reason: "unknown-flag" };
        continue;
      }
      const kind = Object.hasOwn(rules.values, name) ? rules.values[name] : undefined;
      if (kind === undefined) return { ok: false, reason: "unknown-flag" };
      const inline = arg.indexOf("=");
      const value = inline >= 0 ? arg.slice(inline + 1) : argv[++i];
      if (value === undefined) return { ok: false, reason: "needs-value" };
      if (!valueOk(kind, value)) return { ok: false, reason: "outside-folders" };
      continue;
    }
    positionals++;
    if (rules.positional === "none") return { ok: false, reason: "extra-argument" };
    if (rules.positional === "status" && (arg !== "status" || positionals > 1)) return { ok: false, reason: "extra-argument" };
    if (rules.positional === "topic" && (positionals > 1 || !(ALLOWED_COMMANDS as readonly string[]).includes(arg))) return { ok: false, reason: "extra-argument" };
    if (rules.positional === "files" && !inside(arg, ["/in", "/tmp"])) return { ok: false, reason: "outside-folders" };
  }
  return { ok: true };
}
