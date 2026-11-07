/**
 * The in-repo option parser must behave like node:util parseArgs (strict, positionals allowed),
 * which the CLI used before. This runs both on thousands of seeded random command lines and
 * compares values, positionals and the final usage message.
 */
import { parseArgs } from "node:util";
import { describe, expect, it } from "vitest";
import { parseFlags } from "../src/args.ts";
import type { OptionSpec } from "../src/args.ts";
import { CliError } from "../src/errors.ts";

type Outcome = { ok: true; values: Record<string, unknown>; positionals: string[] } | { ok: false; code: string; message: string };

/** The parser the CLI used before, kept here as the reference. */
function reference(command: string, args: string[], options: OptionSpec): Outcome {
  try {
    const { values, positionals } = parseArgs({ args, options: { verbose: { type: "boolean" }, ...options }, allowPositionals: true, strict: true });
    return { ok: true, values: { ...values }, positionals };
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    const named = /'(--?[\w-]+)/.exec(message)?.[1];
    const problem = /ambiguous/i.test(message)
      ? `The option ${named ?? "you typed"} needs a value. If it starts with a dash, write ${named ?? "--option"}=value.`
      : /argument missing/i.test(message)
        ? `The option ${named ?? "you typed"} needs a value.`
        : /does not take an argument/i.test(message)
          ? `The option ${named ?? "you typed"} does not take a value.`
          : named
            ? `Snappy does not know the option ${named} for ${command}.`
            : `Snappy could not read those options for ${command}.`;
    return { ok: false, code: "usage", message: `${problem} Run "snappy-export help ${command}" for the options.` };
  }
}

function actual(command: string, args: string[], options: OptionSpec): Outcome {
  try {
    const { values, positionals } = parseFlags<Record<string, unknown>>(command, args, options);
    return { ok: true, values, positionals };
  } catch (e) {
    if (e instanceof CliError) return { ok: false, code: e.code, message: e.message };
    throw e;
  }
}

/** Option tables shaped like the commands': booleans, strings, repeatable strings and a short flag. */
const TABLES: Record<string, OptionSpec> = {
  analyze: {
    earlier: { type: "string", multiple: true },
    "no-save": { type: "boolean" },
    ledger: { type: "string" },
    "passphrase-file": { type: "string" },
    allow: { type: "string", multiple: true },
    json: { type: "boolean" },
    "no-color": { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
  memories: {
    out: { type: "string" },
    "dry-run": { type: "boolean" },
    download: { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
  keep: { ledger: { type: "string" }, help: { type: "boolean", short: "h" } },
  shortvalue: { file: { type: "string", short: "f" }, all: { type: "boolean", short: "a" }, bare: { type: "boolean", short: "b" } },
};

function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = ["a.zip", "/in/x.zip", "x y", "-", "--", "-5", "---x", "--=x", "--x=y=z", "", "-é", "--fo$o", "-h", "-x", "-hv", "-hx", "-xh", "-fFILE", "-af", "-abf", "-afv", "-ab", "-bfq", "--help=1", "--verbose", "--verbose=yes", "--unknown", "--unknown=1", "--out=", "--__proto__", "--__proto__=1", "--toString", "-", "1", "mydata~1.zip", "--a=-b"];

function randomArgs(rand: () => number, table: OptionSpec): string[] {
  const pool = [...WORDS, ...Object.keys(table).flatMap((name) => [`--${name}`, `--${name}`, `--${name}=v`, `--${name}=-v`, `--${name}=`])];
  const count = Math.floor(rand() * 7);
  return Array.from({ length: count }, () => pool[Math.floor(rand() * pool.length)] as string);
}

describe("parseFlags parity with node:util parseArgs", () => {
  it("agrees on seeded random command lines for every table", () => {
    const rand = prng(20261107);
    for (const [command, table] of Object.entries(TABLES)) {
      for (let i = 0; i < 3000; i++) {
        const args = randomArgs(rand, table);
        expect(actual(command, args, table), `${command} ${JSON.stringify(args)}`).toEqual(reference(command, args, table));
      }
    }
  });

  it("covers the usual shapes by hand", () => {
    const table = TABLES.analyze as OptionSpec;
    const cases: string[][] = [
      ["a.zip", "--earlier", "b.zip", "--earlier=c.zip", "--no-save"],
      ["--earlier"],
      ["--earlier", "--no-save"],
      ["--earlier", "-"],
      ["--no-save=1"],
      ["--nope"],
      ["-h"],
      ["--", "--no-save", "x"],
      ["--ledger=a=b"],
    ];
    for (const args of cases) expect(actual("analyze", args, table), JSON.stringify(args)).toEqual(reference("analyze", args, table));
  });

  it("keeps the calm wording for each kind of mistake", () => {
    const table = TABLES.analyze as OptionSpec;
    expect(actual("analyze", ["--nope"], table)).toMatchObject({ ok: false, message: 'Snappy does not know the option --nope for analyze. Run "snappy-export help analyze" for the options.' });
    expect(actual("analyze", ["--ledger"], table)).toMatchObject({ message: 'The option --ledger needs a value. Run "snappy-export help analyze" for the options.' });
    expect(actual("analyze", ["--ledger", "--json"], table)).toMatchObject({ message: expect.stringContaining("write --ledger=value") as string });
    expect(actual("analyze", ["--json=1"], table)).toMatchObject({ message: 'The option --json does not take a value. Run "snappy-export help analyze" for the options.' });
  });

  it("treats names that exist on every object as unknown options", () => {
    for (const name of ["--__proto__", "--toString", "--constructor"]) {
      expect(() => parseFlags("analyze", [name], {})).toThrow(/does not know the option/);
    }
  });
});
