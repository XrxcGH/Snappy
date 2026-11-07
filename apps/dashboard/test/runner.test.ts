/**
 * The page side of a Run, against a fake helper. Every message crosses a structured clone in both
 * directions, as it does between a page and a real worker.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { COMMANDS, bindArgv } from "../src/terminal/commands.ts";
import type { CommandSpec } from "../src/terminal/commands.ts";
import type { FromWorker, ToWorker } from "../src/terminal/protocol.ts";
import { MAX_STORE_BYTES, createRunner } from "../src/terminal/runner.ts";
import { CANCEL_GRACE_MS } from "../src/terminal/run-types.ts";
import type { Channel, OutFile, RunHooks, RunInput, RunnerDeps } from "../src/terminal/run-types.ts";
import type { VaultStore } from "../src/vault.ts";

afterEach(() => vi.restoreAllMocks());

interface FakeChannel extends Channel {
  sent: ToWorker[];
  stops: number;
  emit(message: unknown): void;
  fail(): void;
}

function fakeChannel(): FakeChannel {
  let onMessage: (m: unknown) => void = () => undefined;
  let onFailure: () => void = () => undefined;
  const channel: FakeChannel = {
    sent: [],
    stops: 0,
    post: (m) => void channel.sent.push(structuredClone(m)),
    onMessage: (h) => void (onMessage = h),
    onFailure: (h) => void (onFailure = h),
    stop: () => void channel.stops++,
    emit: (m) => onMessage(structuredClone(m)),
    fail: () => onFailure(),
  };
  return channel;
}

function fakeVault(initial: Uint8Array | null = null): VaultStore & { bytes: Uint8Array | null; reads: number; writes: number; failWith?: Error } {
  const vault = {
    bytes: initial,
    reads: 0,
    writes: 0,
    failWith: undefined as Error | undefined,
    supported: () => true,
    async read() {
      vault.reads++;
      if (vault.failWith) throw vault.failWith;
      return vault.bytes;
    },
    async write(bytes: Uint8Array) {
      vault.writes++;
      if (vault.failWith) throw vault.failWith;
      vault.bytes = bytes;
    },
    async clear() {
      vault.bytes = null;
    },
  };
  return vault;
}

interface Timers {
  pending: { fn: () => void; ms: number; live: boolean }[];
  fire(): void;
}

function setup(over: Partial<RunnerDeps> = {}) {
  const channels: FakeChannel[] = [];
  const timers: Timers = {
    pending: [],
    fire() {
      for (const t of this.pending.splice(0)) if (t.live) t.fn();
    },
  };
  let clock = 1000;
  const vault = fakeVault();
  const deps: RunnerDeps = {
    spawn: () => {
      const c = fakeChannel();
      channels.push(c);
      return c;
    },
    vault,
    vaultPhase: () => "locked",
    now: () => (clock += 10),
    setTimer: (fn, ms) => {
      const t = { fn, ms, live: true };
      timers.pending.push(t);
      return () => void (t.live = false);
    },
    outCap: 1024,
    coarse: false,
    ...over,
  };
  return { runner: createRunner(deps), channels, timers, vault, deps };
}

function hooks(over: Partial<RunHooks> = {}): RunHooks & { out: string[]; files: OutFile[][]; asked: string[] } {
  const state = {
    out: [] as string[],
    files: [] as OutFile[][],
    asked: [] as string[],
  };
  return {
    ...state,
    onOut: (t) => void state.out.push(t),
    onFiles: (f) => void state.files.push(f),
    askSecret: async (q) => {
      state.asked.push(q);
      return "typed";
    },
    ...over,
  };
}

const input = (spec: CommandSpec, names: string[] = ["a.zip"]): RunInput => ({
  spec,
  argv: bindArgv(spec, { export: names }),
  files: names.map((name) => ({ name, blob: new Blob(["x"]) })),
  columns: 80,
});

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("a normal Run", () => {
  it("starts one helper, sends the run request, relays output in order and ends on exit", async () => {
    const { runner, channels } = setup();
    const h = hooks();
    const handle = runner.run(input(COMMANDS["analyze-preview"]), h);
    const channel = channels[0] as FakeChannel;
    expect(channels).toHaveLength(1);
    expect(channel.sent).toHaveLength(1);
    expect(channel.sent[0]).toMatchObject({ type: "run", argv: ["analyze", "/in/a.zip", "--no-save"], columns: 80, coarse: false, outCap: 1024 });
    channel.emit({ type: "out", text: "one " });
    channel.emit({ type: "out", text: "two" });
    channel.emit({ type: "exit", code: 0 });
    const result = await handle.done;
    expect(h.out).toEqual(["one ", "two"]);
    expect(result).toMatchObject({ end: "done", code: 0 });
    expect(result.ms).toBeGreaterThan(0);
    expect(channel.stops).toBe(1);
  });

  it("reports a non-zero exit as done with that code, and ignores everything after the exit", async () => {
    const { runner, channels } = setup();
    const h = hooks();
    const handle = runner.run(input(COMMANDS.inspect), h);
    const channel = channels[0] as FakeChannel;
    channel.emit({ type: "exit", code: 2 });
    channel.emit({ type: "out", text: "late" });
    channel.emit({ type: "exit", code: 0 });
    expect(await handle.done).toMatchObject({ end: "done", code: 2 });
    expect(h.out).toEqual([]);
  });

  it("hands the saved files over once, before the result, and only for a command that saves to the folder", async () => {
    const file = { path: "memories/a.jpg", bytes: new Uint8Array([1]), mtimeMs: 1 };
    const { runner, channels } = setup();
    const h = hooks();
    const handle = runner.run(input(COMMANDS["memories-rescue"]), h);
    const channel = channels[0] as FakeChannel;
    channel.emit({ type: "files", files: [file] });
    channel.emit({ type: "files", files: [{ ...file, path: "again.jpg" }] });
    channel.emit({ type: "exit", code: 0 });
    await handle.done;
    expect(h.files).toEqual([[file]]);

    const other = setup();
    const h2 = hooks();
    const second = other.runner.run(input(COMMANDS["memories-preview"]), h2);
    (other.channels[0] as FakeChannel).emit({ type: "files", files: [file] });
    (other.channels[0] as FakeChannel).emit({ type: "exit", code: 0 });
    await second.done;
    expect(h2.files).toEqual([]);
  });

  it("drops messages that do not fit the protocol", async () => {
    const { runner, channels } = setup();
    const h = hooks();
    const handle = runner.run(input(COMMANDS.help), h);
    const channel = channels[0] as FakeChannel;
    for (const bad of [null, 5, "out", { type: "out", text: 5 }, { type: "nope" }, { type: "exit", code: "0" }, { type: "files", files: [{ path: "../x", bytes: new Uint8Array(), mtimeMs: 0 }] }]) channel.emit(bad);
    channel.emit({ type: "exit", code: 0 });
    expect(await handle.done).toMatchObject({ end: "done", code: 0 });
    expect(h.out).toEqual([]);
  });

  it("gives each Run its own helper, so nothing carries over", async () => {
    const { runner, channels } = setup();
    const a = runner.run(input(COMMANDS.help), hooks());
    (channels[0] as FakeChannel).emit({ type: "exit", code: 0 });
    await a.done;
    const b = runner.run(input(COMMANDS.help), hooks());
    expect(channels).toHaveLength(2);
    expect((channels[1] as FakeChannel).sent[0]).toMatchObject({ type: "run", runId: "run-2" });
    (channels[1] as FakeChannel).emit({ type: "exit", code: 0 });
    await b.done;
  });
});

describe("blocked and failed", () => {
  it("never starts a helper for a command that needs the network, or an argument list the policy refuses", async () => {
    const { runner, channels } = setup();
    const networked: CommandSpec = { ...COMMANDS["memories-rescue"], network: true };
    expect(await runner.run(input(networked), hooks()).done).toMatchObject({ end: "blocked", code: null });
    for (const argv of [["memories", "/in/a.zip", "--out", "/out/m", "--download"], ["analyze", "/in/a.zip", "--ledger", "/out/x"], ["keep", "x"], ["inspect", "/etc/passwd"], []]) {
      expect(await runner.run({ ...input(COMMANDS.inspect), argv }, hooks()).done, argv.join(" ")).toMatchObject({ end: "blocked" });
    }
    expect(channels).toHaveLength(0);
  });

  it("fails with no detail when this browser cannot make a helper, or making one throws", async () => {
    expect(await setup({ spawn: () => null }).runner.run(input(COMMANDS.help), hooks()).done).toMatchObject({ end: "failed", code: null });
    const throwing = setup({
      spawn: () => {
        throw new Error("secret detail");
      },
    });
    const result = await throwing.runner.run(input(COMMANDS.help), hooks()).done;
    expect(result).toEqual({ end: "failed", code: null, ms: result.ms });
    expect(JSON.stringify(result)).not.toContain("secret detail");
  });

  it("fails with no detail when the helper dies, and stops it", async () => {
    const { runner, channels } = setup();
    const handle = runner.run(input(COMMANDS.help), hooks());
    (channels[0] as FakeChannel).fail();
    expect(await handle.done).toMatchObject({ end: "failed", code: null });
    expect((channels[0] as FakeChannel).stops).toBe(1);
  });

  it("fails when the run request cannot be sent", async () => {
    const channel = fakeChannel();
    channel.post = () => {
      throw new Error("DataCloneError");
    };
    const handle = setup({ spawn: () => channel }).runner.run(input(COMMANDS.help), hooks());
    expect(await handle.done).toMatchObject({ end: "failed" });
  });
});

describe("passphrase questions", () => {
  it("passes the question to the person and sends the answer once, in one message", async () => {
    const { runner, channels } = setup();
    const h = hooks();
    const handle = runner.run(input(COMMANDS["analyze-save"]), h);
    const channel = channels[0] as FakeChannel;
    channel.emit({ type: "ask-secret", id: 7, question: "Passphrase for your saved history: " });
    await tick();
    expect(h.asked).toEqual(["Passphrase for your saved history: "]);
    expect(channel.sent.filter((m) => m.type === "secret")).toEqual([{ type: "secret", id: 7, value: "typed" }]);
    channel.emit({ type: "exit", code: 0 });
    await handle.done;
  });

  it("sends null when the person cancels, or the prompt fails", async () => {
    const { runner, channels } = setup();
    const handle = runner.run(input(COMMANDS["analyze-save"]), hooks({ askSecret: async () => null }));
    const channel = channels[0] as FakeChannel;
    channel.emit({ type: "ask-secret", id: 1, question: "Q" });
    await tick();
    const failing = runner.run(
      input(COMMANDS["analyze-save"]),
      hooks({
        askSecret: async () => {
          throw new Error("x");
        },
      }),
    );
    (channels[1] as FakeChannel).emit({ type: "ask-secret", id: 2, question: "Q" });
    await tick();
    expect(channel.sent.filter((m) => m.type === "secret")).toEqual([{ type: "secret", id: 1, value: null }]);
    expect((channels[1] as FakeChannel).sent.filter((m) => m.type === "secret")).toEqual([{ type: "secret", id: 2, value: null }]);
    channel.emit({ type: "exit", code: 130 });
    (channels[1] as FakeChannel).emit({ type: "exit", code: 130 });
    await Promise.all([handle.done, failing.done]);
  });

  it("does not send an answer that arrives after the Run was stopped", async () => {
    const { runner, channels } = setup();
    let answer: (v: string | null) => void = () => undefined;
    const handle = runner.run(input(COMMANDS["analyze-save"]), hooks({ askSecret: () => new Promise((r) => (answer = r)) }));
    const channel = channels[0] as FakeChannel;
    channel.emit({ type: "ask-secret", id: 3, question: "Q" });
    handle.cancel();
    answer("late answer");
    await tick();
    expect(channel.sent.filter((m) => m.type === "secret")).toEqual([]);
    channel.emit({ type: "exit", code: 130 });
    expect(await handle.done).toMatchObject({ end: "canceled", code: 130 });
  });

  it("keeps a distinctive passphrase out of everything but the one message to the helper", async () => {
    const PASS = "CANARY-pass-phrase-zq81-7777";
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "info"), vi.spyOn(console, "warn"), vi.spyOn(console, "error"), vi.spyOn(console, "debug")];
    const { runner, channels } = setup();
    const heard: unknown[] = [];
    const h = hooks({ askSecret: async () => PASS, onOut: (t) => void heard.push(t) });
    const handle = runner.run(input(COMMANDS["analyze-save"]), h);
    const channel = channels[0] as FakeChannel;
    channel.emit({ type: "out", text: "Passphrase for your saved history: " });
    channel.emit({ type: "ask-secret", id: 1, question: "Passphrase for your saved history: " });
    await tick();
    channel.emit({ type: "out", text: "\nDone.\n" });
    channel.emit({ type: "exit", code: 0 });
    const result = await handle.done;

    const secretMessages = channel.sent.filter((m) => m.type === "secret");
    expect(secretMessages).toEqual([{ type: "secret", id: 1, value: PASS }]);
    const others = JSON.stringify([channel.sent.filter((m) => m.type !== "secret").map((m) => (m.type === "run" ? { ...m, files: m.files.length } : m)), heard, result, h.asked, h.out, h.files]);
    expect(others).not.toContain(PASS);
    expect(others).not.toContain("CANARY");
    for (const log of logs) expect(JSON.stringify(log.mock.calls)).not.toContain("CANARY");
  });
});

describe("stopping a Run", () => {
  it("before the helper has said anything: asks it to stop, and cuts it off after the grace period", async () => {
    const { runner, channels, timers } = setup();
    const handle = runner.run(input(COMMANDS.inspect), hooks());
    const channel = channels[0] as FakeChannel;
    handle.cancel();
    expect(channel.sent.map((m) => m.type)).toEqual(["run", "cancel"]);
    expect(timers.pending.map((t) => t.ms)).toEqual([CANCEL_GRACE_MS]);
    timers.fire();
    expect(await handle.done).toMatchObject({ end: "terminated", code: 130 });
    expect(channel.stops).toBe(1);
  });

  it("mid-read: a command that stops in time ends as canceled and the timer is dropped", async () => {
    const { runner, channels, timers } = setup();
    const handle = runner.run(input(COMMANDS["analyze-save"]), hooks());
    const channel = channels[0] as FakeChannel;
    channel.emit({ type: "store-read", id: 1 });
    handle.cancel();
    channel.emit({ type: "exit", code: 130 });
    expect(await handle.done).toMatchObject({ end: "canceled", code: 130 });
    timers.fire();
    expect(channel.stops).toBe(1);
  });

  it("mid-write: a helper that does not stop is cut off, and its files are lost", async () => {
    const { runner, channels, timers } = setup();
    const h = hooks();
    const handle = runner.run(input(COMMANDS["memories-rescue"]), h);
    const channel = channels[0] as FakeChannel;
    channel.emit({ type: "out", text: "Saving 3 Memories..." });
    handle.cancel();
    timers.fire();
    expect(await handle.done).toMatchObject({ end: "terminated", code: 130 });
    expect(h.files).toEqual([]);
    channel.emit({ type: "files", files: [{ path: "a", bytes: new Uint8Array(1), mtimeMs: 1 }] });
    expect(h.files).toEqual([]);
  });

  it("a stopped command that still exits 0 is just done, and a second cancel does nothing", async () => {
    const { runner, channels, timers } = setup();
    const handle = runner.run(input(COMMANDS.inspect), hooks());
    handle.cancel();
    handle.cancel();
    expect(timers.pending).toHaveLength(1);
    (channels[0] as FakeChannel).emit({ type: "exit", code: 0 });
    expect(await handle.done).toMatchObject({ end: "done", code: 0 });
  });

  it("resolves exactly once, whatever order the exit, the failure and the timer come in", async () => {
    const { runner, channels, timers } = setup();
    const handle = runner.run(input(COMMANDS.inspect), hooks());
    const channel = channels[0] as FakeChannel;
    let calls = 0;
    void handle.done.then(() => calls++);
    handle.cancel();
    channel.emit({ type: "exit", code: 130 });
    channel.fail();
    timers.fire();
    handle.cancel();
    await tick();
    expect(calls).toBe(1);
    expect(channel.stops).toBe(1);
  });

  it("does nothing for a Run that was never started", () => {
    const { runner } = setup({ spawn: () => null });
    expect(() => runner.run(input(COMMANDS.help), hooks()).cancel()).not.toThrow();
  });
});

describe("the saved history bridge", () => {
  async function ask(spec: CommandSpec, message: FromWorker, over: Partial<RunnerDeps> = {}, vault = fakeVault(new Uint8Array([9, 9]))) {
    const { runner, channels } = setup({ vault, ...over });
    const handle = runner.run(input(spec), hooks());
    const channel = channels[0] as FakeChannel;
    channel.emit(message);
    await tick();
    const reply = channel.sent.find((m) => m.type === "store-reply");
    channel.emit({ type: "exit", code: 0 });
    await handle.done;
    return { reply, vault };
  }
  const write = (n = 3): FromWorker => ({ type: "store-write", id: 5, bytes: new Uint8Array(n) });

  it("reads the saved history for a command that uses it", async () => {
    const { reply } = await ask(COMMANDS["ledger-status"], { type: "store-read", id: 4 });
    expect(reply).toMatchObject({ type: "store-reply", id: 4, ok: true });
    expect([...((reply as { bytes: Uint8Array }).bytes)]).toEqual([9, 9]);
    const none = await ask(COMMANDS["analyze-save"], { type: "store-read", id: 4 }, {}, fakeVault(null));
    expect(none.reply).toMatchObject({ ok: true, bytes: null });
  });

  it("refuses to read it for a command that has no use for it", async () => {
    for (const id of ["help", "inspect", "analyze-preview", "memories-rescue", "memories-preview", "demo-run"] as const) {
      const { reply, vault } = await ask(COMMANDS[id], { type: "store-read", id: 4 });
      expect(reply, id).toMatchObject({ ok: false, code: "EACCES" });
      expect(vault.reads, id).toBe(0);
    }
  });

  it("writes it only for a command that saves history, while the dashboard has it locked or has no saved history", async () => {
    for (const phase of ["locked", "session"] as const) {
      const { reply, vault } = await ask(COMMANDS["analyze-save"], write(), { vaultPhase: () => phase });
      expect(reply, phase).toMatchObject({ ok: true });
      expect([...(vault.bytes as Uint8Array)]).toEqual([0, 0, 0]);
    }
  });

  it("refuses a write while the dashboard has the history unlocked, so the dashboard cannot overwrite it", async () => {
    const { reply, vault } = await ask(COMMANDS["analyze-save"], write(), { vaultPhase: () => "unlocked" });
    expect(reply).toMatchObject({ ok: false, code: "EACCES" });
    expect(vault.writes).toBe(0);
  });

  it("refuses a write from any command that does not save history", async () => {
    for (const id of ["help", "inspect", "analyze-preview", "memories-rescue", "memories-preview", "demo-run", "ledger-status"] as const) {
      const { reply, vault } = await ask(COMMANDS[id], write());
      expect(reply, id).toMatchObject({ ok: false, code: "EACCES" });
      expect(vault.writes, id).toBe(0);
    }
  });

  it("has a ceiling on what it will write that is far above a real saved history", () => {
    expect(MAX_STORE_BYTES).toBeGreaterThan(10 * 1024 * 1024);
    expect(MAX_STORE_BYTES).toBeLessThanOrEqual(256 * 1024 * 1024);
  });

  it("reports a storage error without its detail", async () => {
    const vault = fakeVault(null);
    vault.failWith = new Error("quota exceeded for /secret/detail");
    const read = await ask(COMMANDS["ledger-status"], { type: "store-read", id: 1 }, {}, vault);
    expect(read.reply).toMatchObject({ ok: false, code: "EIO" });
    const wrote = await ask(COMMANDS["analyze-save"], write(), {}, vault);
    expect(wrote.reply).toMatchObject({ ok: false, code: "EIO" });
    expect(JSON.stringify([read.reply, wrote.reply])).not.toContain("secret");
  });
});
