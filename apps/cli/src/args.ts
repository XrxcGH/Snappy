/** Argument parsing on node:util parseArgs, with usage errors in Snappy's voice. */
import { parseArgs } from "node:util";
import type { ParseArgsConfig } from "node:util";
import { CliError } from "./errors.ts";

type OptionSpec = NonNullable<ParseArgsConfig["options"]>;

export interface Parsed<T> {
  values: T;
  positionals: string[];
}

/**
 * Parse `args` strictly. `command` names the command for the hint in usage errors; the typed
 * option name is echoed (never its value) so a typo is easy to spot.
 */
export function parseFlags<T>(command: string, args: string[], options: OptionSpec): Parsed<T> {
  try {
    const { values, positionals } = parseArgs({ args, options, allowPositionals: true, strict: true });
    return { values: values as T, positionals };
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    const named = /'(--?[\w-]+)/.exec(message)?.[1];
    const problem = /ambiguous/i.test(message)
      ? `The option ${named ?? "you typed"} needs a value, and the next word starts with a dash. If the value really starts with a dash, write it as ${named ?? "--option"}=value.`
      : /argument missing/i.test(message)
      ? `The option ${named ?? "you typed"} needs a value.`
      : /does not take an argument/i.test(message)
        ? `The option ${named ?? "you typed"} does not take a value.`
        : named
          ? `Snappy does not know the option ${named} for ${command}.`
          : `Snappy could not read those options for ${command}.`;
    throw new CliError("usage", `${problem} Run "snappy-export help ${command}" to see what it accepts.`);
  }
}

/** Parse a whole number in [min, max] from a flag value. */
export function intOption(name: string, raw: string | undefined, min: number, max: number): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!/^\d+$/.test(raw.trim()) || !Number.isSafeInteger(n) || n < min || n > max) {
    throw new CliError("usage", `${name} must be a whole number from ${min} to ${max}.`);
  }
  return n;
}
