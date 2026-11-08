import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { NOT_AFFILIATED } from "../src/render.ts";
import { TAGLINE } from "../src/term.ts";
import { CLI_ENTRY_HELP } from "./constants.ts";
import { makeIo, run, tempDir } from "./helpers.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const VERSION = JSON.parse(readFileSync(join(ROOT, "apps", "cli", "package.json"), "utf8")).version as string;

describe("help and version", () => {
  it("prints the banner, the commands, the privacy line and the non-affiliation line", async () => {
    for (const args of [[], ["help"], ["--help"], ["-h"]]) {
      const { code, out, err } = await run(args);
      expect(code, args.join(" ")).toBe(0);
      expect(err).toBe("");
      expect(out).toContain("▐█████████▌");
      expect(out).toContain("Snappy");
      for (const name of ["analyze", "memories", "inspect", "keep", "unkeep", "history status", "demo", "help"]) expect(out).toContain(name);
      const flat = out.replace(/\s+/g, " ");
      expect(flat).toContain("Your export stays on this device. Snappy reads friend names and dates, and skips messages, photos, and locations.");
      expect(flat).toContain(NOT_AFFILIATED);
      expect(NOT_AFFILIATED).toBe(
        "Snappy is an independent tool. It is not affiliated with, endorsed by, or sponsored by Snap Inc. Snapchat is a trademark of Snap Inc.",
      );
    }
  });

  it("colors the banner spine violet on a color terminal and nothing otherwise", async () => {
    const plain = await run(["help"], makeIo({ interactive: false }));
    expect(plain.out).not.toContain("\x1b");
    const color = await run(["help"], makeIo({ interactive: true, env: { COLORTERM: "truecolor" } }));
    expect(color.out).toContain("\x1b[38;2;155;134;255m");
    const fallback = await run(["help"], makeIo({ interactive: true }));
    expect(fallback.out).toContain("\x1b[38;5;99m");
    expect((await run(["help"], makeIo({ interactive: true, env: { NO_COLOR: "1" } }))).out).not.toContain("\x1b");
  });

  it("prints the version", async () => {
    for (const flag of ["--version", "-v", "version"]) {
      expect(await run([flag])).toEqual({ code: 0, out: `snappy-export ${VERSION}\n`, err: "" });
    }
  });

  it("shows the release the app passes, in the banner and in --version, and ignores anything odd", async () => {
    const withRelease = (release: string) => makeIo({ env: { SNAPPY_RELEASE: release } });
    const help = await run(["help"], withRelease("0.1.0-beta.1"));
    expect(help.out).toContain("Version 0.1.0-beta.1\n");
    expect(help.out).not.toContain(`Version ${VERSION}\n`);
    expect((await run(["--version"], withRelease("0.1.0-beta.1"))).out).toBe("snappy-export 0.1.0-beta.1\n");
    for (const odd of ["", "  ", "beta 1", "1.0\u001b[31m", "x".repeat(41), "../../etc", "<b>1</b>"]) {
      expect((await run(["help"], withRelease(odd))).out, JSON.stringify(odd)).toContain(`Version ${VERSION}\n`);
    }
    expect((await run(["help"])).out).toContain(`Version ${VERSION}\n`);
  });

  it("prints the tagline in the banner", async () => {
    expect((await run(["help"], makeIo({ columns: 160 }))).out).toContain(TAGLINE);
    expect((await run(["help"])).out.replace(/\s+/g, " ")).toContain(TAGLINE);
  });

  it("shows per-command help three ways", async () => {
    for (const [command, usage] of Object.entries(CLI_ENTRY_HELP)) {
      for (const args of [["help", command], [command, "--help"]]) {
        const { code, out } = await run(args);
        expect(code, args.join(" ")).toBe(0);
        expect(out, args.join(" ")).toContain(usage);
      }
    }
    expect((await run(["help", "unkeep"])).out).toContain("snappy-export unkeep <username...>");
    expect((await run(["history"])).out).toContain("snappy-export history status");
  });

  it("does not use the word ledger in the overview or in any help", async () => {
    const pages = [["help"], ...Object.keys(CLI_ENTRY_HELP).map((c) => ["help", c]), ["help", "since"], ["help", "friend-count"], ["help", "unkeep"]];
    for (const args of pages) {
      const { out } = await run(args);
      expect(out, args.join(" ")).not.toMatch(/ledger(?!\.sealed)/i);
    }
  });

  it("still answers to the older ledger command and --ledger option, which help leaves out", async () => {
    expect((await run(["ledger"])).out).toContain("snappy-export history status");
    expect((await run(["help", "ledger"])).out).toContain("snappy-export history status");
    expect((await run(["help"])).out).not.toMatch(/^ {2}ledger /m);
  });
});

describe("mistakes", () => {
  it("answers an unknown command or help topic with a short message and exit code 1", async () => {
    for (const args of [["frobnicate"], ["help", "frobnicate"], ["__proto__"], ["toString"]]) {
      const { code, out, err } = await run(args);
      expect(code, args.join(" ")).toBe(1);
      expect(out).toBe("");
      expect(err).not.toContain("code");
      expect((await run([...args, "--verbose"])).err).toMatch(/\(code: usage\)\n$/);
      expect(err).toContain("snappy-export help");
      expect(err.split("\n").length).toBeLessThanOrEqual(2);
    }
  });

  it("names the option that is wrong and where to read more", async () => {
    const unknown = await run(["analyze", "x.zip", "--frobnicate"]);
    expect(unknown.err).toContain("Snappy does not know the option --frobnicate for analyze. Run \"snappy-export help analyze\"");
    const missing = await run(["memories", "x.zip", "--out"]);
    expect(missing.err).toContain("The option --out needs a value.");
    const surplus = await run(["inspect", "x.zip", "--show-keys=yes"]);
    expect(surplus.err).toContain("The option --show-keys does not take a value.");
  });

  it("asks for usernames when keep gets none, and for a known history command", async () => {
    expect((await run(["keep"])).err).toContain("Name at least one friend");
    expect((await run(["unkeep", "--history", "x"])).err).toContain("Name at least one friend");
    expect((await run(["unkeep", "--ledger", "x"])).err).toContain("Name at least one friend");
    expect((await run(["history", "ledger"])).err).toContain('The only history command is "snappy-export history status".');
    expect((await run(["ledger", "history"])).err).not.toMatch(/ledger/i);
  });

  it("turns unexpected failures into a calm message with a code and no stack by default", async () => {
    const io = makeIo({
      now: () => {
        throw new Error("secret-detail-12345");
      },
    });
    const { code, err } = await run(["demo", "--dir", tempDir("boom"), "--run"], io);
    // demo never reads the clock before --run: the failure comes from deeper in, and must still be calm.
    expect(code).toBe(1);
    expect(err).toContain("The output never includes your data");
    expect(err).not.toContain("secret-detail-12345");
    expect(err).not.toMatch(/\n\s+at /);
    expect(err.split("\n").length).toBeLessThanOrEqual(2);
  });

  it("writes nothing to stdout when it fails", async () => {
    const { out } = await run(["analyze", "missing.zip"]);
    expect(out).toBe("");
  });
});

describe("running it for real", () => {
  const script = (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts as Record<string, string>)["snappy-export"] as string;

  it("npm run snappy-export starts node with type stripping on this platform, resolving @snappy-export/core through the workspace link", () => {
    const [command, ...flags] = script.split(" ");
    expect(command).toBe("node");
    const result = spawnSync(process.execPath, [...flags, "--version"], { cwd: ROOT, encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`snappy-export ${VERSION}\n`);
    expect(result.stderr).toBe("");
  });

  it("runs a command that reaches into core, and exits with the command's code", () => {
    const [, ...flags] = script.split(" ");
    const result = spawnSync(process.execPath, [...flags, "analyze", "does-not-exist.zip", "--verbose"], { cwd: ROOT, encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("(code: not-found)");
  });
});
