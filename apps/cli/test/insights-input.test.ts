/** The shared loader behind every insight command: same reading rules as analyze, read-only. */
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { syntheticExportZip } from "@snappy-export/core";
import { CliError } from "../src/errors.ts";
import { friendCountOf, insightTerm, loadInsightInput, parseIdList, parseInsightArgs } from "../src/insights-input.ts";
import { LATER, NOW, makeIo, run, tempDir, writeSyntheticParts, writeSyntheticZip } from "./helpers.ts";

const code = async (p: Promise<unknown>): Promise<string | undefined> => {
  try {
    await p;
    return undefined;
  } catch (e) {
    return e instanceof CliError ? e.code : "other";
  }
};

describe("loadInsightInput", () => {
  it("reads one zip like analyze does and reads the clock once", async () => {
    const zip = writeSyntheticZip(tempDir("in"), "a.zip", { bundleMedia: true });
    let calls = 0;
    const io = makeIo({ now: () => (calls++, NOW) });
    const input = await loadInsightInput([zip], io);
    expect(calls).toBe(1);
    expect(input.now).toBe(NOW);
    expect(input.parsed.friends.friends).toHaveLength(40);
    expect(input.parsed.memories).toHaveLength(20);
    expect(input.parts).toEqual({ count: 1 });
    expect(input.layout).toBeUndefined();
    expect(input.structure).toBeUndefined();
    expect(input.ledger).toBeUndefined();
    expect(input.broken).toBe(false);
  });

  it("uses the export's own date as when the data was true", async () => {
    const input = await loadInsightInput([writeSyntheticZip(tempDir("in-date"), "a.zip")], makeIo());
    expect(input.takenAtSource).toBe("export");
    expect(input.exportedAt).toBeDefined();
    expect(input.takenAt).toBe(input.exportedAt);
  });

  it("reads every part of a folder, in order, and lists them on request", async () => {
    const dir = tempDir("in-parts");
    writeSyntheticParts(dir);
    const input = await loadInsightInput([dir], makeIo(), { layout: true, structure: true });
    expect(input.parts).toEqual({ count: 3, unreadable: [] });
    expect(input.layout?.parts).toHaveLength(3);
    expect(input.structure?.files.length).toBeGreaterThan(0);
    expect(input.parsed.friends.friends.length).toBeGreaterThan(0);
  });

  it("names a damaged part instead of throwing", async () => {
    const dir = tempDir("in-damaged");
    const full = syntheticExportZip({ now: LATER, friendCount: 40, memoryCount: 20 });
    const damaged = join(dir, "damaged.zip");
    writeFileSync(damaged, full.subarray(0, Math.floor(full.length * 0.6)));
    const input = await loadInsightInput([damaged], makeIo(), { layout: true });
    expect(input.parts).toEqual({ count: 1, unreadable: [0] });
  });

  it("passes the friend count on, so a short export is noted", async () => {
    const zip = writeSyntheticZip(tempDir("in-count"), "a.zip");
    const plain = await loadInsightInput([zip], makeIo());
    const short = await loadInsightInput([zip], makeIo(), { friendCount: 400 });
    expect(plain.issues.some((i) => i.code === "friend-count-mismatch")).toBe(false);
    expect(short.issues.some((i) => i.code === "friend-count-mismatch")).toBe(true);
    expect(new Set(short.issues.map((i) => `${i.code}|${i.message}`)).size).toBe(short.issues.length);
  });

  it("stops with the same calm errors as analyze", async () => {
    const dir = tempDir("in-errors");
    const parts = writeSyntheticParts(join(dir, "parts"));
    expect(await code(loadInsightInput([], makeIo()))).toBe("no-input");
    expect(await code(loadInsightInput([join(dir, "missing.zip")], makeIo()))).toBe("not-found");
    expect(await code(loadInsightInput([parts[1] as string], makeIo()))).toBe("later-parts-only");
    writeFileSync(join(dir, "notes.txt"), "x");
    expect(await code(loadInsightInput([join(dir, "notes.txt")], makeIo()))).toBe("not-zip");
  });
});

describe("the sealed ledger", () => {
  const PASS = "insights-test-passphrase";

  it("is opened only when asked for, and never asks for a passphrase otherwise", async () => {
    const dir = tempDir("in-ledger");
    const zip = writeSyntheticZip(dir, "a.zip");
    const ledger = join(dir, "ledger.sealed");
    await run(["analyze", zip, "--ledger", ledger], makeIo({ env: { SNAPPY_PASSPHRASE: PASS } }));

    const io = makeIo();
    expect((await loadInsightInput([zip], io)).ledger).toBeUndefined();
    expect(io.asked).toEqual([]);

    const opened = await loadInsightInput([zip], makeIo({ env: { SNAPPY_PASSPHRASE: PASS } }), { ledger: { path: ledger } });
    expect(opened.ledger?.snapshots).toHaveLength(1);
  });

  it("reads without writing: the folder holds the same files afterwards", async () => {
    const dir = tempDir("in-ledger-ro");
    const zip = writeSyntheticZip(dir, "a.zip");
    const ledger = join(dir, "ledger.sealed");
    await run(["analyze", zip, "--ledger", ledger], makeIo({ env: { SNAPPY_PASSPHRASE: PASS } }));
    const before = readdirSync(dir).sort();
    await loadInsightInput([zip], makeIo({ env: { SNAPPY_PASSPHRASE: PASS } }), { ledger: { path: ledger } });
    expect(readdirSync(dir).sort()).toEqual(before);
  });

  it("leaves the ledger undefined, without a prompt, when none exists yet", async () => {
    const dir = tempDir("in-ledger-none");
    const zip = writeSyntheticZip(dir, "a.zip");
    const io = makeIo();
    const input = await loadInsightInput([zip], io, { ledger: { path: join(dir, "none.sealed") } });
    expect(input.ledger).toBeUndefined();
    expect(io.asked).toEqual([]);
  });

  it("looks in ~/.snappy by default and reads the passphrase file when given", async () => {
    const home = tempDir("in-ledger-home");
    const zip = writeSyntheticZip(tempDir("in-ledger-zip"), "a.zip");
    const ledger = join(home, ".snappy", "ledger.sealed");
    await run(["analyze", zip, "--ledger", ledger], makeIo({ env: { SNAPPY_PASSPHRASE: PASS } }));
    const file = join(home, "pass.txt");
    writeFileSync(file, `${PASS}\n`);
    const input = await loadInsightInput([zip], makeIo({ home }), { ledger: { passphraseFile: file } });
    expect(input.ledger?.snapshots).toHaveLength(1);
  });

  it("refuses a wrong passphrase calmly", async () => {
    const dir = tempDir("in-ledger-wrong");
    const zip = writeSyntheticZip(dir, "a.zip");
    const ledger = join(dir, "ledger.sealed");
    await run(["analyze", zip, "--ledger", ledger], makeIo({ env: { SNAPPY_PASSPHRASE: PASS } }));
    const wrong = loadInsightInput([zip], makeIo({ env: { SNAPPY_PASSPHRASE: "not-the-passphrase" } }), { ledger: { path: ledger } });
    expect(await code(wrong)).toBe("wrong-passphrase");
  });
});

describe("flags", () => {
  it("accepts the common options and the command's own", () => {
    const { values, positionals } = parseInsightArgs<{ done?: string[] }>("safety", ["a.zip", "--json", "--no-color", "-h", "--verbose", "--done", "x,y"], {
      done: { type: "string", multiple: true },
    });
    expect(values).toEqual({ json: true, "no-color": true, help: true, verbose: true, done: ["x,y"] });
    expect(positionals).toEqual(["a.zip"]);
  });

  it("names the command and the option for a mistake, never the value", () => {
    expect(() => parseInsightArgs("safety", ["--bogus"])).toThrow('Snappy does not know the option --bogus for safety. Run "snappy-export help safety"');
  });

  it("styles the terminal from the environment and --no-color", () => {
    const io = makeIo({ interactive: true, env: { COLORTERM: "truecolor" } });
    expect(insightTerm({}, io).color).toBe(true);
    expect(insightTerm({ "no-color": true }, io).color).toBe(false);
    expect(insightTerm({}, makeIo()).color).toBe(false);
  });

  it("reads the friend count as a whole number", () => {
    expect(friendCountOf({})).toBeUndefined();
    expect(friendCountOf({ "friend-count": "250" })).toBe(250);
    for (const bad of ["x", "-1", "1.5", "99999999999"]) expect(() => friendCountOf({ "friend-count": bad })).toThrow("--friend-count must be a whole number");
  });

  it("reads checklist ids from repeated, comma-separated values and rejects unknown ones without echoing them", () => {
    const known = ["alpha", "beta", "gamma"];
    expect(parseIdList("--done", undefined, known)).toEqual([]);
    expect(parseIdList("--done", ["alpha, Beta", "beta,gamma", ""], known)).toEqual(["alpha", "beta", "gamma"]);
    expect(() => parseIdList("--done", ["alpha,sam_01"], known)).toThrow('--done has an id Snappy does not know. Run the command without --done to see the ids.');
    try {
      parseIdList("--done", ["sam_01"], known);
    } catch (e) {
      expect((e as CliError).message).not.toContain("sam_01");
      expect((e as CliError).code).toBe("usage");
    }
  });
});
