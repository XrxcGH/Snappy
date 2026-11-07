import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CliError } from "../src/errors.ts";
import { promptHidden, resolvePassphrase } from "../src/prompt.ts";
import type { SecretInput } from "../src/prompt.ts";
import { makeIo, tempDir } from "./helpers.ts";

/** A TTY stand-in: records raw-mode changes and lets a test type into it. */
function fakeTty(isTTY = true) {
  const listeners: ((chunk: string) => void)[] = [];
  const raw: boolean[] = [];
  const input: SecretInput = {
    isTTY,
    setRawMode: (mode: boolean) => void raw.push(mode),
    setEncoding: () => undefined,
    resume: () => undefined,
    pause: () => undefined,
    on: (_event, listener) => void listeners.push(listener),
    off: (_event, listener) => void listeners.splice(listeners.indexOf(listener), 1),
  };
  return { input, raw, listeners, type: (text: string) => listeners.slice().forEach((l) => l(text)) };
}

describe("promptHidden", () => {
  it("returns what was typed, handles backspace, and echoes nothing", async () => {
    const tty = fakeTty();
    let shown = "";
    const answer = promptHidden("Passphrase: ", tty.input, { write: (t) => void (shown += t) });
    tty.type("hunte");
    tty.type("x\u007fr2\r");
    await expect(answer).resolves.toBe("hunter2");
    expect(shown).toBe("Passphrase: \n"); // the question and a newline: never a typed character
    expect(tty.raw).toEqual([true, false]);
    expect(tty.listeners).toHaveLength(0);
  });

  it("accepts a pasted passphrase in one chunk and ignores arrow keys", async () => {
    const tty = fakeTty();
    const answer = promptHidden("", tty.input, { write: () => undefined });
    tty.type("ab\x1b[Ac\x1b[D\ncd");
    await expect(answer).resolves.toBe("abc");
  });

  it("cancels on Ctrl+C with a calm error and restores the terminal", async () => {
    const tty = fakeTty();
    const answer = promptHidden("", tty.input, { write: () => undefined });
    tty.type("abc\u0003");
    await expect(answer).rejects.toMatchObject({ code: "canceled", exitCode: 130 });
    expect(tty.raw).toEqual([true, false]);
  });

  it("refuses to run without a terminal", async () => {
    await expect(promptHidden("", fakeTty(false).input, { write: () => undefined })).rejects.toMatchObject({ code: "no-terminal" });
  });
});

describe("resolvePassphrase", () => {
  it("prefers --passphrase-file, then SNAPPY_PASSPHRASE, then the prompt", async () => {
    const dir = tempDir("pass");
    const file = join(dir, "pass.txt");
    writeFileSync(file, "from file\r\n");

    const io = makeIo({ env: { SNAPPY_PASSPHRASE: "from env" }, answers: ["from prompt"] });
    expect(await resolvePassphrase(io, { file, creating: false })).toBe("from file");
    expect(await resolvePassphrase(io, { creating: false })).toBe("from env");
    expect(io.asked).toHaveLength(0);

    const prompted = makeIo({ answers: ["from prompt"] });
    expect(await resolvePassphrase(prompted, { creating: false })).toBe("from prompt");
    expect(prompted.asked).toHaveLength(1);
  });

  it("keeps a trailing space but strips one trailing newline from the file", async () => {
    const file = join(tempDir("pass"), "p.txt");
    writeFileSync(file, "two words \n");
    expect(await resolvePassphrase(makeIo(), { file, creating: false })).toBe("two words ");
  });

  it("asks twice when creating a ledger and refuses a mismatch", async () => {
    const ok = makeIo({ answers: ["three blue horses", "three blue horses"] });
    expect(await resolvePassphrase(ok, { creating: true })).toBe("three blue horses");
    expect(ok.asked).toHaveLength(2);

    const bad = makeIo({ answers: ["three blue horses", "three blue horsez"] });
    await expect(resolvePassphrase(bad, { creating: true })).rejects.toMatchObject({ code: "passphrase-mismatch" });
  });

  it("asks for 12 or more characters on a new ledger, from every source, like the dashboard", async () => {
    const short = "only eleven";
    expect(short).toHaveLength(11);
    const file = join(tempDir("pass"), "short.txt");
    writeFileSync(file, `${short}\n`);
    for (const io of [makeIo({ answers: [short, short] }), makeIo({ env: { SNAPPY_PASSPHRASE: short } })]) {
      const failure = await resolvePassphrase(io, { creating: true }).catch((e: unknown) => e);
      expect(failure).toMatchObject({ code: "passphrase-short" });
      expect((failure as Error).message).toContain("12 or more characters");
      expect((failure as Error).message).toContain("cannot be recovered");
    }
    await expect(resolvePassphrase(makeIo(), { file, creating: true })).rejects.toMatchObject({ code: "passphrase-short" });
    // It is a rule for new ledgers only: an older, shorter passphrase still opens its ledger.
    expect(await resolvePassphrase(makeIo({ env: { SNAPPY_PASSPHRASE: short } }), { creating: false })).toBe(short);
    expect(await resolvePassphrase(makeIo({ env: { SNAPPY_PASSPHRASE: "exactly 12ch" } }), { creating: true })).toBe("exactly 12ch");
  });

  it("rejects an empty file and an empty answer", async () => {
    const file = join(tempDir("pass"), "empty.txt");
    writeFileSync(file, "\n");
    await expect(resolvePassphrase(makeIo(), { file, creating: false })).rejects.toBeInstanceOf(CliError);
    await expect(resolvePassphrase(makeIo({ answers: [""] }), { creating: false })).rejects.toMatchObject({ code: "passphrase-empty" });
  });

  it("reports an unreadable passphrase file without echoing the system message", async () => {
    const missing = join(tempDir("pass"), "nope.txt");
    await expect(resolvePassphrase(makeIo(), { file: missing, creating: false })).rejects.toMatchObject({ code: "not-found" });
  });
});
