/**
 * What the Io lets a command do: no network when the host says so, a size limit the host sets, and a
 * cooperative stop. These are the controls the dashboard's terminal relies on.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { limitText } from "../src/commands/memories.ts";
import { CliError, fsError } from "../src/errors.ts";
import type { FsPort } from "../src/ports.ts";
import { makeIo, run, tempDir, writeSyntheticParts } from "./helpers.ts";

describe("--download without a network", () => {
  it("is refused up front with a calm message, before any file is read", async () => {
    const io = makeIo({ network: false });
    const { code, err, out } = await run(["memories", "does-not-exist.zip", "--out", "somewhere", "--download"], io);
    expect(code).toBe(1);
    expect(err).toContain("This needs a terminal on your computer. Copy the command to run it there.");
    expect(out).toBe("");
  });

  it("still works as before when the host has a network", async () => {
    const io = makeIo({ network: true });
    const { err } = await run(["memories", join(tempDir("none"), "missing.zip"), "--out", "x", "--download"], io);
    expect(err).not.toContain("needs a terminal");
  });
});

describe("a size limit set by the host", () => {
  it("is the one used when a file is too large, and the advice names it", async () => {
    const dir = tempDir("limit");
    writeSyntheticParts(dir, { memoryCount: 60 });
    const out = join(tempDir("limit-out"), "rescued");
    const result = await run(["memories", dir, "--out", out, "--no-color"], makeIo({ limits: { maxBundledBytes: 1 } }));
    expect(result.code).toBe(3);
    expect(result.out.replace(/\s+/g, " ")).toContain("over the 1 byte limit");
  });

  it("names a limit set in binary steps as MiB, so it matches the README and the limit", () => {
    expect(limitText(512 * 1024 * 1024)).toBe("512 MiB");
    expect(limitText(128 * 1024 * 1024)).toBe("128 MiB");
    expect(limitText(64 * 1024 * 1024)).toBe("64 MiB");
    expect(limitText(1)).toBe("1 byte");
  });
});

describe("a stop request inside a file call", () => {
  it("is not turned into a file error by the code that wraps file calls", () => {
    const stopped = new CliError("canceled", "Stopped. Nothing was changed.", 130);
    expect(fsError(stopped, "open", "/in/a.zip")).toBe(stopped);
    expect(fsError({ code: "ENOENT" }, "open", "/in/a.zip").code).toBe("not-found");
  });
});

describe("stopping a run", () => {
  const files = (dir: string): number => (existsSync(dir) ? readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).length : 0);

  it("stops before reading when the signal is already aborted, and writes no report", async () => {
    const dir = tempDir("stop");
    writeSyntheticParts(dir, { memoryCount: 60 });
    const out = join(tempDir("stop-out"), "rescued");
    const controller = new AbortController();
    controller.abort();
    const result = await run(["memories", dir, "--out", out], makeIo({ signal: controller.signal }));
    expect(result.code).toBe(130);
    // Stopped while the export is still being read: nothing was saved yet, and the message says so.
    expect(result.err).toContain("Stopped. Nothing was changed.");
    expect(existsSync(join(out, "memories-report.json"))).toBe(false);
  });

  it("keeps the files already saved when the signal fires part way", async () => {
    const dir = tempDir("stop");
    writeSyntheticParts(dir, { memoryCount: 60 });
    const out = join(tempDir("stop-out"), "rescued");
    const controller = new AbortController();
    const io = makeIo({ signal: controller.signal });
    const real = io.fs;
    let writes = 0;
    const fs: FsPort = {
      ...real,
      writeFileAtomic: async (path, bytes, opts) => {
        await real.writeFileAtomic(path, bytes, opts);
        if (++writes === 3) controller.abort();
      },
    };
    const result = await run(["memories", dir, "--out", out], { ...io, fs } as typeof io);
    expect(result.code).toBe(130);
    expect(files(out)).toBeGreaterThanOrEqual(3);
    expect(existsSync(join(out, "memories-report.json"))).toBe(false);
  });
});
