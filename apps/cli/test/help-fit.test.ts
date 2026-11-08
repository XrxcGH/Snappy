/**
 * The help overview is fitted to the width of the screen by the command itself, so the in-app terminal
 * (which asks for as many columns as really fit) does not wrap its lines a second time.
 */
import { describe, expect, it } from "vitest";
import { COMMAND_NAMES } from "../src/main.ts";
import { makeIo, run } from "./helpers.ts";

const ALL = [...COMMAND_NAMES, "help"];

const helpAt = async (columns: number): Promise<string[]> => (await run(["help"], makeIo({ columns }))).out.split("\n");

describe("the overview is fitted to the width of the screen", () => {
  it.each([100, 80, 62, 40])("has no line wider than %i columns, and keeps every row", async (columns) => {
    const lines = await helpAt(columns);
    expect(lines.filter((l) => Array.from(l).length > columns)).toEqual([]);
    const rows = lines.filter((l) => /^ {2}\S/.test(l)).map((l) => l.trim().split(/\s+/)[0] ?? "");
    for (const name of ALL) expect(rows, name).toContain(name);
  });

  it("continues a long summary under itself", async () => {
    const lines = await helpAt(62);
    const at = lines.findIndex((l) => l.startsWith("  inspect <ZIP files...>"));
    expect(at).toBeGreaterThan(-1);
    expect(lines[at + 1]).toMatch(/^ {30,}\S/);
  });

  it("moves the summary under the synopsis on a very narrow screen", async () => {
    const lines = await helpAt(40);
    const at = lines.findIndex((l) => l === "  inspect <ZIP files...>");
    expect(at).toBeGreaterThan(-1);
    expect(lines[at + 1]).toMatch(/^ {4}\S/);
  });

  it("is unchanged where everything fits on one line", async () => {
    const lines = await helpAt(200);
    expect(lines).toContain("  inspect <ZIP files...>        Show your export's shape, never its contents");
  });
});
