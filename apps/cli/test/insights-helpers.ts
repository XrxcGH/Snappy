/**
 * Test helpers for insight commands. A command module is tested through its descriptor, so a test
 * needs no registration in main.ts: `runInsight(command, args)` calls `command.run` the way main.ts
 * does and turns a CliError into the calm message and exit code a person would get.
 * Everything here uses SYNTHETIC data only.
 */
import { expect } from "vitest";
import { CANARIES } from "@snappy-export/core";
import { CliError } from "../src/errors.ts";
import type { InsightCommand } from "../src/insights-command.ts";
import { makeIo, stripPaths } from "./helpers.ts";
import type { RunResult, TestIo } from "./helpers.ts";

/** Commands that already exist. An insight must not reuse one of these names. */
export const EXISTING_COMMANDS = ["analyze", "memories", "inspect", "keep", "unkeep", "ledger", "demo", "help", "version"] as const;

export async function runInsight(command: InsightCommand, args: string[], io: TestIo = makeIo()): Promise<RunResult> {
  try {
    const code = await command.run(args, io);
    return { code, out: io.stdout(), err: io.stderr() };
  } catch (e) {
    if (!(e instanceof CliError)) throw e;
    const verbose = args.includes("--verbose");
    io.err.write(`${e.message}${verbose ? ` (code: ${e.code})` : ""}\n`);
    return { code: e.exitCode, out: io.stdout(), err: io.stderr() };
  }
}

/** The shape every descriptor must have: what the wire-up step and the help overview rely on. */
export async function expectValidDescriptor(command: InsightCommand): Promise<void> {
  expect(command.name, "name").toMatch(/^[a-z]+(?:-[a-z]+)*$/);
  expect(EXISTING_COMMANDS as readonly string[], "name is already a command").not.toContain(command.name);
  expect(command.synopsis.startsWith(command.name), "synopsis starts with the name").toBe(true);
  expect(command.synopsis.length, "synopsis length").toBeLessThanOrEqual(28);
  expect(command.summary.length, "summary length with its period").toBeLessThanOrEqual(49);
  expect(command.summary, "summary starts with a capital").toMatch(/^[A-Z]/);
  expect(command.summary, "summary is one sentence ending in a period").toMatch(/^[^.!?]+\.$/);
  const row = `  ${command.synopsis.padEnd(28)}  ${command.summary.slice(0, -1)}`;
  expect(row.length, "help row length").toBeLessThanOrEqual(80);
  expect(command.usage.startsWith(`Usage: snappy-export ${command.name}`), "usage starts with the command").toBe(true);
  expect(command.usage.endsWith("\n"), "usage ends with a line break").toBe(true);
  for (const flag of ["--help", "-h"]) {
    const result = await runInsight(command, [flag]);
    expect(result, flag).toEqual({ code: 0, out: command.usage, err: "" });
  }
}

const LINK_PIECES = ["demo.snappy.invalid", "uid=demo", "mid=", "/media/", "https://", "http://"];

/** Nothing the export holds beyond usernames and dates may be in text a person could share. */
export function expectNoLeaks(text: string, label: string): void {
  for (const canary of Object.values(CANARIES).flat()) expect(text, `${label} leaked ${JSON.stringify(canary)}`).not.toContain(canary);
  for (const piece of LINK_PIECES) expect(text, `${label} leaked a link fragment ${piece}`).not.toContain(piece);
}

const ACRONYMS = new Set(["JSON", "HTML", "ZIP", "CSV", "AES", "ICS", "NO"]);

/** The brand rules that are cheap to check on any output: no exclamation marks, emoji or shouting. */
export function expectBrandSafe(text: string, label: string): void {
  expect(text, `${label}: exclamation mark`).not.toContain("!");
  expect(/\p{Extended_Pictographic}/u.test(text), `${label}: emoji`).toBe(false);
  const shouting = (stripPaths(text).match(/\b[A-Z]{4,}\b/g) ?? []).filter((w) => !ACRONYMS.has(w));
  expect(shouting, `${label}: all-caps words`).toEqual([]);
  expect(text, `${label}: undefined or NaN`).not.toMatch(/\bundefined\b|\bNaN\b|\[object/);
  expect(text, `${label}: a count of one next to a plural`).not.toMatch(/\b1 (friends|requests|exports|Memories|files|items|photos|videos|parts|days|entries|dates|usernames)\b|\b1 (are|have|do|were) /);
}
