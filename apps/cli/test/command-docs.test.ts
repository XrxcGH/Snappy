/**
 * Every registered command is documented: a row in the help overview, its own help text, and a
 * mention in the CLI README. Adding a command to main.ts without those fails here, and so does a
 * help row or README entry for a command that no longer exists.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { INSIGHT_COMMANDS } from "../src/insight-commands.ts";
import { COMMAND_NAMES } from "../src/main.ts";
import { COMMAND_ALIASES, COMMAND_OPTIONS } from "../src/cli.ts";
import { run } from "./helpers.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const README = readFileSync(join(ROOT, "apps", "cli", "README.md"), "utf8");
const ROOT_README = readFileSync(join(ROOT, "README.md"), "utf8");
const GUIDE = readFileSync(join(ROOT, "docs", "EXPORT-GUIDE.md"), "utf8");

/** What a person can type as a command: everything main.ts dispatches, plus help. */
const ALL = [...COMMAND_NAMES, "help"];

let overview = "";
/** The first word of each command row in the help overview: the indented lines before the footnotes. */
let rowNames: string[] = [];

beforeAll(async () => {
  overview = (await run(["help"])).out;
  const lines = overview.split("\n");
  const start = lines.findIndex((l) => l.startsWith("Usage: snappy-export <command>"));
  const end = lines.findIndex((l) => l.startsWith("<ZIP files...> means"));
  rowNames = lines
    .slice(start, end)
    .filter((l) => /^ {2}\S/.test(l))
    .map((l) => l.trim().split(/\s+/)[0] ?? "");
});

describe("the command list", () => {
  it("registers the 22 insight commands next to the earlier ones", () => {
    expect(INSIGHT_COMMANDS).toHaveLength(22);
    for (const c of INSIGHT_COMMANDS) expect(COMMAND_NAMES, c.name).toContain(c.name);
    for (const name of ["analyze", "memories", "inspect", "keep", "unkeep", "history", "demo"]) expect(COMMAND_NAMES, name).toContain(name);
    expect(new Set(COMMAND_NAMES).size, "no name is registered twice").toBe(COMMAND_NAMES.length);
  });
});

describe("--no-color", () => {
  const COMMANDS = ALL.filter((name) => name !== "help");

  it.each(COMMANDS)("%s accepts it, and says so in its help", async (name) => {
    expect(Object.keys(COMMAND_OPTIONS[name] ?? {}), name).toContain("no-color");
    const { code, out, err } = await run([name, "--no-color", "--help"]);
    expect(err, name).toBe("");
    expect(code, name).toBe(0);
    expect(out, name).toContain("--no-color");
  });

  it("is accepted by help, and the older names take it too", async () => {
    expect((await run(["help", "--no-color"])).code).toBe(0);
    for (const alias of Object.keys(COMMAND_ALIASES)) expect((await run([alias, "--no-color", "--help"])).err, alias).toBe("");
  });
});

describe("older command names", () => {
  it("run a documented command and stay out of the help overview", async () => {
    for (const [from, to] of Object.entries(COMMAND_ALIASES)) {
      expect(COMMAND_NAMES, from).not.toContain(from);
      expect(COMMAND_NAMES, to).toContain(to);
      expect(rowNames, from).not.toContain(from);
      const { code, out } = await run([from, "--help"]);
      expect(code, from).toBe(0);
      expect(out, from).toContain(`snappy-export ${to}`);
    }
  });
});

describe("every registered command has a help line", () => {
  it.each(ALL)("%s is a row in the help overview", (name) => {
    expect(rowNames, name).toContain(name);
  });

  it("lists nothing that is not a command, and lists each command once", () => {
    expect(rowNames.filter((n) => !ALL.includes(n))).toEqual([]);
    expect(new Set(rowNames).size, "a command appears in two rows").toBe(rowNames.length);
  });

  it("puts each insight command in the group it names, in one line", () => {
    const lines = overview.split("\n");
    for (const c of INSIGHT_COMMANDS) {
      const at = lines.findIndex((l) => l.startsWith(`  ${c.synopsis} `));
      expect(at, c.name).toBeGreaterThan(-1);
      expect(lines[at]?.trim().endsWith(c.summary.slice(0, -1)), `${c.name}: its summary ends the line`).toBe(true);
      const heading = lines
        .slice(0, at)
        .reverse()
        .find((l) => /^\S/.test(l) && l.trim() !== "");
      expect(heading, c.name).toBe(c.group);
    }
  });

  it.each(ALL)("help %s prints its own usage", async (name) => {
    const { code, out, err } = await run(["help", name]);
    expect(code).toBe(0);
    expect(err).toBe("");
    expect(out).toContain(`snappy-export ${name}`);
  });
});

describe("every registered command is in the README", () => {
  // An entry names the command, or the older name it stands for until the README catches up.
  const namesFor = (name: string): string => [name, ...Object.entries(COMMAND_ALIASES).filter(([, to]) => to === name).map(([from]) => from)].join("|");

  it.each(ALL)("%s has an entry", (name) => {
    expect(README, name).toMatch(new RegExp(`snappy-export (?:-- )?(?:${namesFor(name)})\\b`));
  });

  it("gives each insight command an example in the form the repo uses", () => {
    for (const c of INSIGHT_COMMANDS) expect(README, c.name).toContain(`npm run snappy-export -- ${c.name}`);
  });

  it("points the root README at the insight commands, with the right count and real names", () => {
    const words = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen", "Twenty", "Twenty-one", "Twenty-two"];
    expect(ROOT_README).toContain(`${words[INSIGHT_COMMANDS.length] ?? "?"} more commands`);
    expect(ROOT_README).toContain("apps/cli/README.md");
    const line = ROOT_README.split(/\r?\n/).find((l) => l.includes("more commands")) ?? "";
    const named = [...line.matchAll(/`([a-z-]+)`/g)].map((m) => m[1] ?? "");
    expect(named.length).toBeGreaterThan(0);
    for (const name of named) expect(INSIGHT_COMMANDS.map((c) => c.name), name).toContain(name);
  });

  it("lists each insight command in the export guide, with an example", () => {
    for (const c of INSIGHT_COMMANDS) {
      expect(GUIDE, `${c.name} row`).toContain(`| \`${c.name}\` |`);
      expect(GUIDE, `${c.name} example`).toContain(`npm run snappy-export -- ${c.name}`);
    }
  });
});
