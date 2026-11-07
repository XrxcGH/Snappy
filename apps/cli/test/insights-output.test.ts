/** Saving an insight's file: explicit name, right extension, never replaced without --force. */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CliError } from "../src/errors.ts";
import { checkOutputPath, saveInsightFile } from "../src/insights-output.ts";
import { makeIo, tempDir } from "./helpers.ts";

const opts = { option: "--out", extension: ".ics", force: false };

const fails = async (p: Promise<unknown>): Promise<CliError | undefined> => {
  try {
    await p;
  } catch (e) {
    return e as CliError;
  }
  return undefined;
};

describe("saveInsightFile", () => {
  it("writes the text, creating folders on the way", async () => {
    const dir = tempDir("out");
    const target = join(dir, "more", "reminder.ics");
    await saveInsightFile(makeIo(), target, "BEGIN\n", opts);
    expect(readFileSync(target, "utf8")).toBe("BEGIN\n");
    expect(readdirSync(join(dir, "more"))).toEqual(["reminder.ics"]);
  });

  it("insists on the extension, in either case, before anything is written", async () => {
    const dir = tempDir("out-ext");
    const error = await fails(saveInsightFile(makeIo(), join(dir, "reminder.txt"), "x", opts));
    expect(error?.code).toBe("usage");
    expect(error?.message).toBe("--out needs a file name ending in .ics, so no other file is replaced.");
    expect(readdirSync(dir)).toEqual([]);
    await saveInsightFile(makeIo(), join(dir, "UPPER.ICS"), "x", opts);
    expect(existsSync(join(dir, "UPPER.ICS"))).toBe(true);
  });

  it("never replaces a file without --force", async () => {
    const dir = tempDir("out-exists");
    const target = join(dir, "reminder.ics");
    writeFileSync(target, "mine");
    const error = await fails(saveInsightFile(makeIo(), target, "new", opts));
    expect(error?.code).toBe("exists");
    expect(error?.message).toContain("already exists");
    expect(error?.message).toContain("--force");
    expect(readFileSync(target, "utf8")).toBe("mine");

    await saveInsightFile(makeIo(), target, "new", { ...opts, force: true });
    expect(readFileSync(target, "utf8")).toBe("new");
    expect(readdirSync(dir)).toEqual(["reminder.ics"]);
  });

  it("can check the name early with checkOutputPath", async () => {
    const dir = tempDir("out-check");
    await expect(checkOutputPath(makeIo(), join(dir, "ok.ics"), opts)).resolves.toBeUndefined();
    expect((await fails(checkOutputPath(makeIo(), join(dir, "bad.json"), opts)))?.code).toBe("usage");
    expect(readdirSync(dir)).toEqual([]);
  });
});
