import { describe, expect, it } from "vitest";
import { COMMAND_OPTIONS } from "../../cli/src/cli.ts";
import { ALLOWED_COMMANDS, MAX_ARGS, MAX_ARG_LENGTH, RULES, checkArgv } from "../src/terminal/policy.ts";

const reason = (argv: string[]): string | true => {
  const r = checkArgv(argv);
  return r.ok ? true : r.reason;
};

describe("checkArgv: what runs", () => {
  it("allows the commands the app offers, with their own flags and paths inside the virtual folders", () => {
    for (const argv of [
      ["help"],
      ["help", "analyze"],
      ["demo", "--run"],
      ["inspect", "/in/a.zip", "/in/b.zip"],
      ["inspect", "/in/a.zip", "--layout", "--checks-only"],
      ["analyze", "/in/a.zip", "--no-save"],
      ["analyze", "/in/a.zip", "--earlier", "/in/b.zip", "--limit", "10", "--json"],
      ["analyze", "/tmp/snappy-demo-000001/snappy-demo-later.zip", "--earlier=/tmp/x/snappy-demo-earlier.zip", "--no-save"],
      ["analyze", "/in/a.zip"],
      ["memories", "/in/a.zip", "--dry-run"],
      ["memories", "/in/a.zip", "/in/b.zip", "--out", "/out/memories", "--layout", "year"],
      ["ledger", "status"],
      ["check", "/in/a.zip", "/in/b.zip", "--friend-count", "120", "--json"],
      ["storage", "/in/a.zip"],
      ["friend-count", "/in/a.zip", "--no-save"],
      ["safety"],
      ["privacy"],
      ["remind"],
    ]) {
      expect(reason(argv), argv.join(" ")).toBe(true);
    }
  });

  it("refuses everything else, including look-alike command names", () => {
    for (const argv of [[], [""], ["keep", "x"], ["unkeep", "x"], ["version"], ["--version"], ["Analyze", "/in/a"], ["analyze "], ["rm", "-rf"], ["sh"], ["../analyze"]]) {
      expect(reason(argv), JSON.stringify(argv)).not.toBe(true);
    }
  });
});

describe("checkArgv: the network and the person's own disk", () => {
  it("blocks --download and --concurrency in every spelling", () => {
    for (const flag of ["--download", "--download=true", "--download=", "--concurrency", "--concurrency=8", "--concurrency", "4"]) {
      expect(reason(["memories", "/in/a.zip", "--out", "/out/m", flag]), flag).toBe(flag === "4" ? "outside-folders" : "blocked-flag");
    }
    expect(reason(["analyze", "/in/a.zip", "--download"])).toBe("blocked-flag");
    expect(reason(["inspect", "/in/a.zip", "--concurrency=2"])).toBe("blocked-flag");
  });

  it("blocks flags that name a place on the person's own disk, for every command", () => {
    for (const command of ALLOWED_COMMANDS) {
      for (const flag of ["--passphrase-file", "--passphrase-file=/in/x", "--ledger", "--ledger=/out/x", "--csv", "--csv=/out/q.csv", "--dir", "--dir=/tmp/x"]) {
        expect(reason([command, flag, "/in/a"]), `${command} ${flag}`).toBe("blocked-flag");
      }
    }
  });

  it("keeps the insight commands to reading and printing: no file out, nothing from the person's disk", () => {
    expect(reason(["backup", "/in/a.zip", "--out", "/out/b.json"])).toBe("unknown-flag");
    expect(reason(["remind", "--out", "/out/r.ics"])).toBe("unknown-flag");
    expect(reason(["rescue", "/in/a.zip", "--folder", "/out/x"])).toBe("unknown-flag");
    expect(reason(["friend-count", "/in/a.zip", "--ledger", "/in/x"])).toBe("blocked-flag");
    expect(reason(["privacy", "/in/a.zip"])).toBe("extra-argument");
    expect(reason(["check", "/etc/passwd"])).toBe("outside-folders");
  });

  it("does not accept unknown flags, short flags or a value on a flag that takes none", () => {
    expect(reason(["analyze", "/in/a.zip", "--unknown"])).toBe("unknown-flag");
    expect(reason(["analyze", "/in/a.zip", "-x"])).toBe("unknown-flag");
    expect(reason(["analyze", "/in/a.zip", "--no-save=1"])).toBe("unknown-flag");
    expect(reason(["analyze", "/in/a.zip", "--dry-run"])).toBe("unknown-flag"); // a memories flag
    expect(reason(["memories", "/in/a.zip", "--no-save"])).toBe("unknown-flag");
    expect(reason(["analyze", "/in/a.zip", "--earlier"])).toBe("needs-value");
    expect(reason(["analyze", "/in/a.zip", "-h"])).toBe(true);
  });
});

describe("checkArgv: where files may be", () => {
  it("keeps export files under /in or /tmp and saved files under /out", () => {
    for (const path of ["/etc/passwd", "relative.zip", "C:\\Users\\me\\a.zip", "/app/.snappy/ledger.sealed", "/in", "/in/", "/input/a.zip", "/out/a.zip", "~/a.zip", "../in/a.zip"]) {
      expect(reason(["inspect", path]), path).toBe("outside-folders");
    }
    expect(reason(["analyze", "/in/a.zip", "--earlier", "/etc/passwd"])).toBe("outside-folders");
    expect(reason(["memories", "/in/a.zip", "--out", "/in/x"])).toBe("outside-folders");
    expect(reason(["memories", "/in/a.zip", "--out", "/tmp/x"])).toBe("outside-folders");
    expect(reason(["memories", "/in/a.zip", "--out", "/out"])).toBe("outside-folders");
    expect(reason(["memories", "/in/a.zip", "--out", "relative"])).toBe("outside-folders");
    expect(reason(["memories", "/in/a.zip", "--out"])).toBe("needs-value");
  });

  it("refuses a path that climbs out with ..", () => {
    expect(reason(["inspect", "/in/../app/.snappy/ledger.sealed"])).toBe("outside-folders");
    expect(reason(["inspect", "/in/a/../../etc/x"])).toBe("outside-folders");
    expect(reason(["memories", "/in/a.zip", "--out", "/out/../in/x"])).toBe("outside-folders");
    expect(reason(["analyze", "/in/a.zip", "--earlier=/in/../x"])).toBe("outside-folders");
  });

  it("allows file arguments only where the command takes them", () => {
    expect(reason(["demo", "/in/a.zip"])).toBe("extra-argument");
    expect(reason(["ledger", "/in/a.zip"])).toBe("extra-argument");
    expect(reason(["ledger", "status", "status"])).toBe("extra-argument");
    expect(reason(["help", "keep"])).toBe("extra-argument");
    expect(reason(["help", "analyze", "inspect"])).toBe("extra-argument");
  });

  it("treats what follows -- as arguments, checked the same way", () => {
    expect(reason(["inspect", "--", "/in/a.zip"])).toBe(true);
    expect(reason(["inspect", "--", "--download"])).toBe("outside-folders");
  });
});

describe("checkArgv: shape", () => {
  it("refuses NUL, line breaks, very long arguments and too many arguments", () => {
    expect(reason(["inspect", "/in/a\0.zip"])).toBe("control-character");
    expect(reason(["inspect", "/in/a\n.zip"])).toBe("control-character");
    expect(reason(["inspect", "/in/a\r.zip"])).toBe("control-character");
    expect(reason(["inspect", `/in/${"a".repeat(MAX_ARG_LENGTH)}`])).toBe("too-long");
    expect(reason(["inspect", ...Array.from({ length: MAX_ARGS }, (_, i) => `/in/${i}.zip`)])).toBe("too-many");
    expect(reason(["inspect", ...Array.from({ length: MAX_ARGS - 1 }, (_, i) => `/in/${i}.zip`)])).toBe(true);
    expect(reason(["inspect", 5 as unknown as string])).toBe("command");
  });
});

describe("the rules and the command line's own options", () => {
  it("only name flags the command really has", () => {
    for (const command of ALLOWED_COMMANDS) {
      // help reads its one flag itself; every other command also has --verbose, which the parser adds.
      const real = command === "help" ? ["no-color"] : [...Object.keys(COMMAND_OPTIONS[command] ?? {}), "verbose"];
      const named = [...RULES[command].flags, ...Object.keys(RULES[command].values)];
      for (const flag of named) expect(real, `${command} --${flag}`).toContain(flag);
    }
  });

  it("refuse every flag the network-capable commands have that is not listed", () => {
    // Anything a command accepts that the rules do not name is refused: the rules are an allow list.
    for (const command of ALLOWED_COMMANDS) {
      const listed = new Set([...RULES[command].flags, ...Object.keys(RULES[command].values)]);
      for (const flag of Object.keys(COMMAND_OPTIONS[command] ?? {})) {
        if (listed.has(flag)) continue;
        expect(reason([command, `--${flag}`, "/in/a.zip"]), `${command} --${flag}`).not.toBe(true);
      }
    }
  });
});
