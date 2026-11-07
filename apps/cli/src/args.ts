/**
 * Argument parsing, with usage errors in Snappy's voice. The rules are those of node:util
 * parseArgs in strict mode with positionals allowed (long options, one-letter short options,
 * --name=value, grouped short options, "--" ends the options), written here so the same parser
 * runs in a browser worker. A differential test checks it against parseArgs on random input.
 */
import { CliError } from "./errors.ts";

export interface OptionDef {
  type: "string" | "boolean";
  short?: string;
  multiple?: boolean;
}

export type OptionSpec = Record<string, OptionDef>;

export interface Parsed<T> {
  values: T;
  positionals: string[];
}

type Value = string | boolean;

interface OptionToken {
  kind: "option";
  name: string;
  rawName: string;
  value: string | undefined;
  inlineValue: boolean | undefined;
}

type Token = OptionToken | { kind: "positional"; value: string } | { kind: "terminator" };

type ProblemKind = "unknown" | "needs-value" | "no-value" | "ambiguous";

/** A problem with the typed options: its kind and the option as the person typed it. */
class OptionProblem extends Error {
  readonly kind: ProblemKind;
  readonly typed: string;

  constructor(kind: ProblemKind, typed: string) {
    super(kind);
    this.kind = kind;
    this.typed = typed;
  }
}

/** The leading "--name" or "-n" of what was typed, which is all a message echoes. Odd text gives "--". */
const echoed = (typed: string): string => /^--?[\w-]+/.exec(typed)?.[0] ?? "--";

const own = (spec: OptionSpec, name: string): OptionDef | undefined => (Object.hasOwn(spec, name) ? spec[name] : undefined);

function longNameForShort(letter: string, spec: OptionSpec): string {
  for (const [name, def] of Object.entries(spec)) if (def.short === letter) return name;
  return letter;
}

function tokenize(args: string[], spec: OptionSpec): Token[] {
  const tokens: Token[] = [];
  const rest = [...args];
  while (rest.length > 0) {
    const arg = rest.shift() as string;
    const next = rest[0];

    if (arg === "--") {
      tokens.push({ kind: "terminator" });
      for (const value of rest) tokens.push({ kind: "positional", value });
      break;
    }

    const isLoneShort = arg.length === 2 && arg[0] === "-" && arg[1] !== "-";
    if (isLoneShort) {
      const name = longNameForShort(arg[1] as string, spec);
      let value: string | undefined;
      let inlineValue: boolean | undefined;
      if (own(spec, name)?.type === "string" && next !== undefined) {
        value = rest.shift();
        inlineValue = false;
      }
      tokens.push({ kind: "option", name, rawName: arg, value, inlineValue });
      continue;
    }

    const startsShort = arg.length > 2 && arg[0] === "-" && arg[1] !== "-";
    if (startsShort) {
      const firstName = longNameForShort(arg[1] as string, spec);
      if (own(spec, firstName)?.type !== "string") {
        // A group of short options: -abc is -a -b -c, and a string option takes the rest.
        const expanded: string[] = [];
        for (let i = 1; i < arg.length; i++) {
          const letter = arg[i] as string;
          const name = longNameForShort(letter, spec);
          if (own(spec, name)?.type !== "string" || i === arg.length - 1) {
            expanded.push(`-${letter}`);
          } else {
            expanded.push(`-${arg.slice(i)}`);
            break;
          }
        }
        rest.unshift(...expanded);
        continue;
      }
      // -fFILE: a short string option with its value attached.
      const name = longNameForShort(arg[1] as string, spec);
      tokens.push({ kind: "option", name, rawName: `-${arg[1]}`, value: arg.slice(2), inlineValue: true });
      continue;
    }

    if (arg.length > 2 && arg.startsWith("--")) {
      const equals = arg.indexOf("=", 3);
      if (equals === -1) {
        const name = arg.slice(2);
        let value: string | undefined;
        let inlineValue: boolean | undefined;
        if (own(spec, name)?.type === "string" && next !== undefined) {
          value = rest.shift();
          inlineValue = false;
        }
        tokens.push({ kind: "option", name, rawName: arg, value, inlineValue });
      } else {
        const name = arg.slice(2, equals);
        tokens.push({ kind: "option", name, rawName: `--${name}`, value: arg.slice(equals + 1), inlineValue: true });
      }
      continue;
    }

    tokens.push({ kind: "positional", value: arg });
  }
  return tokens;
}

function checkUsage(spec: OptionSpec, token: OptionToken): void {
  const def = own(spec, token.name);
  if (def === undefined) throw new OptionProblem("unknown", token.rawName);
  // A known option is echoed by its short name when it has one, else by its long name.
  const known = def.short ? `-${def.short}` : `--${token.name}`;
  if (def.type === "string" && typeof token.value !== "string") throw new OptionProblem("needs-value", known);
  if (def.type === "boolean" && token.value !== undefined) throw new OptionProblem("no-value", known);
  // A separate value that looks like another option is most likely a forgotten value.
  if (token.inlineValue !== true && token.value !== undefined && token.value.length > 1 && token.value[0] === "-") {
    throw new OptionProblem("ambiguous", token.rawName);
  }
}

function parseOptions(args: string[], spec: OptionSpec): { values: Record<string, Value | Value[]>; positionals: string[] } {
  const values: Record<string, Value | Value[]> = Object.create(null) as Record<string, Value | Value[]>;
  const positionals: string[] = [];
  for (const token of tokenize(args, spec)) {
    if (token.kind === "positional") {
      positionals.push(token.value);
    } else if (token.kind === "option") {
      checkUsage(spec, token);
      if (token.name === "__proto__") continue;
      const value: Value = token.value ?? true;
      if (own(spec, token.name)?.multiple === true) {
        const list = values[token.name];
        if (Array.isArray(list)) list.push(value);
        else values[token.name] = [value];
      } else {
        values[token.name] = value;
      }
    }
  }
  return { values, positionals };
}

/**
 * Parse `args` strictly. `command` names the command for the hint in usage errors; the typed
 * option name is echoed (never its value) so a typo is easy to spot.
 */
export function parseFlags<T>(command: string, args: string[], options: OptionSpec): Parsed<T> {
  try {
    // --verbose works on every command: it adds the short code to errors (and to notes, where a command prints them).
    const { values, positionals } = parseOptions(args, { verbose: { type: "boolean" }, ...options });
    return { values: { ...values } as T, positionals };
  } catch (e) {
    if (!(e instanceof OptionProblem)) throw e;
    const named = echoed(e.typed);
    const problem =
      e.kind === "ambiguous"
        ? `The option ${named} needs a value. If it starts with a dash, write ${named}=value.`
        : e.kind === "needs-value"
          ? `The option ${named} needs a value.`
          : e.kind === "no-value"
            ? `The option ${named} does not take a value.`
            : `Snappy does not know the option ${named} for ${command}.`;
    throw new CliError("usage", `${problem} Run "snappy-export help ${command}" for the options.`);
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
