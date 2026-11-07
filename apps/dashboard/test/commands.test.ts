import { describe, expect, it } from "vitest";
import { COMMAND_OPTIONS } from "../../cli/src/cli.ts";
import { terminal } from "../src/copy.ts";
import { CLI_PREFIX, COMMANDS, COMMAND_IDS, OUT_FOLDER, bindArgv, displayText } from "../src/terminal/commands.ts";
import type { CommandSpec } from "../src/terminal/commands.ts";
import { checkArgv } from "../src/terminal/policy.ts";
import { assignInputNames } from "../src/terminal/input-names.ts";

describe("what Copy shows", () => {
  it("is exactly the text the Export guide and Memories pages showed before", () => {
    expect(displayText(COMMANDS.inspect)).toBe("npm run snappy-export -- inspect mydata~1234567890123.zip");
    expect(displayText(COMMANDS["memories-rescue"])).toBe("npm run snappy-export -- memories \"<your export folder>\" --out \"<folder for rescued Memories>\"");
  });

  it("starts with the one prefix constant and quotes words with spaces or angle brackets", () => {
    expect(CLI_PREFIX).toBe("npm run snappy-export --");
    for (const id of COMMAND_IDS) expect(displayText(COMMANDS[id]).startsWith(`${CLI_PREFIX} `)).toBe(true);
    expect(displayText(COMMANDS["analyze-save"])).toBe('npm run snappy-export -- analyze "<your export folder>"');
    expect(displayText(COMMANDS.help)).toBe("npm run snappy-export -- help");
    expect(displayText(COMMANDS["demo-run"])).toBe("npm run snappy-export -- demo --run");
    expect(displayText(COMMANDS["ledger-status"])).toBe("npm run snappy-export -- ledger status");
  });

  it("shows each insight command in its plainest form, and only the ones that read an export ask for files", () => {
    expect(displayText(COMMANDS.check)).toBe('npm run snappy-export -- check "<your export folder>"');
    expect(displayText(COMMANDS["friend-count"])).toBe('npm run snappy-export -- friend-count "<your export folder>" --no-save');
    expect(displayText(COMMANDS.safety)).toBe("npm run snappy-export -- safety");
    for (const id of ["safety", "privacy", "remind"] as const) expect(COMMANDS[id].needsFile, id).toBe(false);
    for (const id of ["check", "storage", "backup", "replies", "habits", "closest", "anniversaries", "on-this-day", "blocked", "friend-count", "rescue-manifest"] as const) expect(COMMANDS[id].needsFile, id).toBe(true);
    for (const id of ["check", "storage", "backup", "replies", "habits", "closest", "safety", "anniversaries", "on-this-day", "blocked", "friend-count", "rescue-manifest", "privacy", "remind"] as const) {
      expect(COMMANDS[id]).toMatchObject({ needsPassphrase: false, effect: "none", network: false });
    }
  });

  it("quotes a word that holds a quote or a dollar sign so the pasted text still means the same", () => {
    const spec: CommandSpec = { ...COMMANDS.inspect, argv: ["inspect", { slot: "export", example: 'my "data" $HOME' }] };
    expect(displayText(spec)).toBe('npm run snappy-export -- inspect "my \\"data\\" \\$HOME"');
  });
});

describe("the catalog", () => {
  it("has one entry per id with a short, one-line, sentence-case title from copy.ts", () => {
    expect(COMMAND_IDS.sort()).toEqual(Object.keys(terminal.titles).sort());
    for (const id of COMMAND_IDS) {
      const spec = COMMANDS[id];
      expect(spec.id).toBe(id);
      expect(spec.title).toBe(terminal.titles[id]);
      expect(spec.title, id).not.toMatch(/[\n.!]/);
      expect(spec.title.length, id).toBeLessThanOrEqual(32);
      expect(spec.title, id).toMatch(/^[A-Z][a-z]/);
      expect(spec.title.split(/\s+/).slice(1).filter((w) => /^[A-Z]/.test(w) && w !== "Memories"), id).toEqual([]);
    }
  });

  it("marks what each command needs and writes", () => {
    expect(COMMANDS["analyze-save"]).toMatchObject({ needsFile: true, needsPassphrase: true, effect: "store" });
    expect(COMMANDS["analyze-preview"]).toMatchObject({ needsFile: true, needsPassphrase: false, effect: "none" });
    expect(COMMANDS["memories-rescue"]).toMatchObject({ needsFile: true, effect: "folder" });
    expect(COMMANDS["memories-preview"]).toMatchObject({ needsFile: true, effect: "none" });
    expect(COMMANDS["ledger-status"]).toMatchObject({ needsFile: false, needsPassphrase: true, effect: "none" });
    expect(COMMANDS["demo-run"]).toMatchObject({ needsFile: false, needsPassphrase: false, effect: "none" });
    expect(COMMANDS.help).toMatchObject({ needsFile: false, effect: "none" });
  });

  it("says a command writes only when its arguments say where, or it saves history", () => {
    for (const id of COMMAND_IDS) {
      const spec = COMMANDS[id];
      const hasOut = spec.argv.some((a) => typeof a !== "string" && a.slot === "out");
      expect(spec.effect === "folder", id).toBe(hasOut);
      if (spec.effect === "store") expect(spec.needsPassphrase, id).toBe(true);
      // A command that opens the saved history without writing (the read-only ones) says so.
      if (spec.argv.includes("--no-save") || spec.argv.includes("--dry-run")) expect(spec.effect, id).toBe("none");
    }
  });

  it("offers no network command, and no flag the policy lets through reaches the network", () => {
    for (const id of COMMAND_IDS) expect(COMMANDS[id].network, id).toBe(false);
    for (const id of COMMAND_IDS) expect(displayText(COMMANDS[id]), id).not.toMatch(/--download|--concurrency/);
    for (const flag of ["--download", "--download=true", "--concurrency", "--concurrency=3"]) {
      expect(checkArgv(["memories", "/in/a.zip", "--out", "/out/m", flag]).ok, flag).toBe(false);
    }
  });
});

describe("every flag in the catalog is a flag the command line really has", () => {
  for (const id of COMMAND_IDS) {
    it(id, () => {
      const [command, ...rest] = COMMANDS[id].argv as string[];
      const known = new Set([...Object.keys(COMMAND_OPTIONS[command as string] ?? {}), "verbose"]);
      for (const arg of rest) {
        if (typeof arg !== "string" || !arg.startsWith("--")) continue;
        if (command === "help") continue;
        expect(known.has(arg.slice(2)), `${id} ${arg}`).toBe(true);
      }
    });
  }
});

describe("bindArgv", () => {
  const files = assignInputNames(["mydata~1.zip", "mydata~1-2.zip"]);

  it("puts the picked files under /in and the saved files under /out", () => {
    expect(bindArgv(COMMANDS["memories-rescue"], { export: files })).toEqual(["memories", "/in/mydata~1.zip", "/in/mydata~1-2.zip", "--out", OUT_FOLDER]);
    expect(bindArgv(COMMANDS["memories-rescue"], { export: files, out: "my-folder" })).toEqual(["memories", "/in/mydata~1.zip", "/in/mydata~1-2.zip", "--out", "/out/my-folder"]);
    expect(bindArgv(COMMANDS["analyze-preview"], { export: ["a.zip"] })).toEqual(["analyze", "/in/a.zip", "--no-save"]);
    expect(bindArgv(COMMANDS.help, { export: [] })).toEqual(["help"]);
  });

  it("gives an argument list the policy accepts, for every command", () => {
    for (const id of COMMAND_IDS) {
      const argv = bindArgv(COMMANDS[id], { export: files });
      expect(checkArgv(argv), `${id}: ${argv.join(" ")}`).toEqual({ ok: true });
    }
  });

  it("does not let an odd file name change the meaning of the command", () => {
    // Names are only ever values after /in/, and the policy refuses anything that climbs out.
    const names = assignInputNames(["--download.zip", "a b.zip", "../x.zip", "x\ny.zip"]);
    const argv = bindArgv(COMMANDS.inspect, { export: names });
    expect(argv.slice(1).every((a) => a.startsWith("/in/"))).toBe(true);
    expect(argv.some((a) => a.split("/").includes(".."))).toBe(false);
    expect(checkArgv(argv).ok).toBe(false); // the line break in one name is refused whole
    expect(checkArgv(bindArgv(COMMANDS.inspect, { export: ["x\ny.zip"] })).ok).toBe(false);
  });
});

describe("assignInputNames", () => {
  it("keeps names, makes duplicates unique and never returns an empty or path-like name", () => {
    expect(assignInputNames(["a.zip", "a.zip", "b", "b", ""])).toEqual(["a.zip", "a (2).zip", "b", "b (2)", "file"]);
    expect(assignInputNames(["dir/x.zip", "..", "a\\b.zip"])).toEqual(["dir_x.zip", "file", "a_b.zip"]);
  });
});
