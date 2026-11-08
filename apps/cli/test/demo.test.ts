import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeIo, run, tempDir } from "./helpers.ts";

/** The double-quoted arguments of a printed command, in order. */
const quoted = (line: string): string[] => [...line.matchAll(/"([^"]+)"/g)].map((m) => m[1] as string);

describe("snappy-export demo", () => {
  it("writes two synthetic exports and prints the exact commands to analyze them with --no-save", async () => {
    const dir = tempDir("demo");
    const { code, out, err } = await run(["demo", "--dir", dir]);
    expect(code).toBe(0);
    expect(err).toBe("");
    expect(readdirSync(dir).sort()).toEqual(["snappy-demo-earlier.zip", "snappy-demo-later.zip"]);
    expect(out).toContain("They are invented: made-up friends, no real data.");

    const analyze = out.split("\n").find((l) => l.trim().startsWith("snappy-export analyze")) as string;
    expect(analyze).toBeDefined();
    expect(analyze).toContain("--no-save");
    expect(analyze).toContain("--earlier");
    const [later, earlier] = quoted(analyze) as [string, string];
    expect(basename(later)).toBe("snappy-demo-later.zip");
    expect(basename(earlier)).toBe("snappy-demo-earlier.zip");
    expect(existsSync(later) && existsSync(earlier)).toBe(true);

    // The printed command works as printed.
    const ran = await run(["analyze", later, "--earlier", earlier, "--no-save"]);
    expect(ran.code).toBe(0);
    expect(ran.out).toMatch(/Disappeared friends: [1-9]/);
  });

  it("ends the list of commands with a pointer to the rest", async () => {
    const dir = tempDir("demo");
    const { out } = await run(["demo", "--dir", dir]);
    expect(out.trimEnd().split("\n").at(-1)).toBe("Run snappy-export help for the rest.");
    const viaNpm = await run(["demo", "--dir", dir], makeIo({ env: { npm_lifecycle_event: "snappy-export" } }));
    expect(viaNpm.out.trimEnd().split("\n").at(-1)).toBe("Run npm run snappy-export -- help for the rest.");
  });

  it("inside the app names the files demo/ and lists no commands that could not be pasted anywhere", async () => {
    const app = makeIo({ env: { SNAPPY_APP: "1" } });
    const { code, out } = await run(["demo"], app);
    expect(code).toBe(0);
    expect(out).toContain("Earlier export: demo/snappy-demo-earlier.zip");
    expect(out).toContain("Later export:   demo/snappy-demo-later.zip");
    expect(out).toContain("Commands to try on demo files are for the command line tool.");
    // No temporary folder path and no command built on one.
    expect(out).not.toMatch(/\/tmp\/|snappy-demo-[A-Za-z0-9]{6}\b|\\Temp\\|analyze "|memories "/);
    expect(out).not.toContain("--no-save");
    expect(out).not.toContain("for the rest");
  });

  it("inside the app --run still runs the analysis on the files", async () => {
    const { code, out } = await run(["demo", "--run"], makeIo({ env: { SNAPPY_APP: "1" } }));
    expect(code).toBe(0);
    expect(out).toContain("Running the first command");
    expect(out).toMatch(/ghost_1 +Disappeared/);
  });

  it("--run also runs the analysis", async () => {
    const dir = tempDir("demo");
    const { code, out } = await run(["demo", "--dir", dir, "--run"]);
    expect(code).toBe(0);
    expect(out).toContain("Running the first command");
    expect(out).toContain("Cleanup queue");
    expect(out).toMatch(/ghost_1 +Disappeared/);
    expect(out).toContain("Your saved history was not read or written, as you asked.");
    expect(readdirSync(dir)).toHaveLength(2); // --no-save: the analysis added nothing
  });

  it("writes identical files on every run, because it uses a fixed time", async () => {
    const a = tempDir("demo");
    const b = tempDir("demo");
    await run(["demo", "--dir", a]);
    await run(["demo", "--dir", b], makeIo({ now: () => 0 }));
    for (const name of ["snappy-demo-earlier.zip", "snappy-demo-later.zip"]) {
      expect(readFileSync(join(a, name)).equals(readFileSync(join(b, name)))).toBe(true);
    }
  });

  it("uses a new temporary folder by default and the npm form of the command when started by npm", async () => {
    const tmp = tempDir("demo");
    const io = makeIo({ env: { npm_lifecycle_event: "snappy-export" } });
    io.tmpdir = () => tmp;
    const { out } = await run(["demo"], io);
    const folders = readdirSync(tmp);
    expect(folders).toHaveLength(1);
    expect(folders[0]).toMatch(/^snappy-demo-/);
    expect(out).toContain("npm run snappy-export -- analyze");
  });

  it("only ever writes synthetic data: the files it makes carry no real names", async () => {
    const dir = tempDir("demo");
    await run(["demo", "--dir", dir]);
    const text = readFileSync(join(dir, "snappy-demo-later.zip")).toString("latin1");
    expect(text).not.toMatch(/[A-Z]:\\Users|\/home\/|\/Users\//);
  });
});
