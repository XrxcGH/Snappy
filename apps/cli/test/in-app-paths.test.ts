/**
 * Inside the app the files live in a virtual folder tree that exists only in the helper. A path from
 * it means nothing on the person's computer, so the terminal text must not print one. The command
 * line keeps printing real paths. Synthetic data only.
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeIo, run, tempDir, writeDemoPair, writeSyntheticParts } from "./helpers.ts";

const PASS = "a long shared passphrase";
const APP = { SNAPPY_APP: "1" };

describe("terminal text inside the app", () => {
  it("history status names no file, while the command line still does", async () => {
    const home = tempDir("home");
    const { later } = writeDemoPair(tempDir("an"));
    await run(["analyze", later], makeIo({ answers: [PASS, PASS], home }));

    const app = await run(["history", "status"], makeIo({ answers: [PASS], home, env: APP }));
    expect(app.code).toBe(0);
    expect(app.out).toContain("Saved history");
    expect(app.out).not.toContain("File:");
    expect(app.out).not.toContain("ledger.sealed");

    const cli = await run(["history", "status"], makeIo({ answers: [PASS], home }));
    expect(cli.out).toContain(`File: ${join(home, ".snappy", "ledger.sealed")}`);
  });

  it("a Memories rescue names the report without a folder path, while the command line prints the full path", async () => {
    const zips = writeSyntheticParts(tempDir("parts"), { memoryCount: 30 });
    const outApp = join(tempDir("out"), "memories");
    const app = await run(["memories", ...zips, "--out", outApp], makeIo({ env: APP }));
    expect(app.code).toBe(0);
    expect(app.out).toContain("Report: memories-report.json");
    expect(app.out).not.toContain(outApp);
    expect(app.out).not.toMatch(/Report: .*[\/]/);

    const outCli = join(tempDir("out"), "memories");
    const cli = await run(["memories", ...zips, "--out", outCli], makeIo());
    expect(cli.out).toContain(`Report: ${join(outCli, "memories-report.json")}`);
  });

  it("demo gives the files plain names and no line that sends the person back to the same command", async () => {
    const plain = await run(["demo"], makeIo({ env: APP }));
    expect(plain.out).toContain("Earlier export: snappy-demo-earlier.zip");
    expect(plain.out).toContain("Later export: snappy-demo-later.zip");
    expect(plain.out).not.toContain("demo/");
    expect(plain.out).not.toMatch(/Run snappy-export demo/);
    expect(plain.out).not.toContain("Commands to try");

    const ran = await run(["demo", "--run"], makeIo({ env: APP }));
    expect(ran.out).not.toContain("demo/");
    expect(ran.out).not.toMatch(/Run snappy-export demo/);
    expect(ran.out).toContain("Running the first command");
  });
});

