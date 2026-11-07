import { describe, expect, it } from "vitest";
import { createWebLock } from "../src/terminal/web-lock.ts";
import type { LockManagerLike } from "../src/terminal/web-lock.ts";
import { FLUSH_BYTES, FLUSH_MS, MAX_BUNDLED_DESKTOP, MAX_BUNDLED_TOUCH, createWorkerIo } from "../src/terminal/worker-io.ts";
import type { WorkerIoOptions } from "../src/terminal/worker-io.ts";
import { createVfs } from "../src/terminal/vfs.ts";

/** A hand-driven clock for the output batcher. */
function fakeTimers() {
  const tasks: { fn: () => void; ms: number; live: boolean }[] = [];
  return {
    schedule: (fn: () => void, ms: number) => {
      const task = { fn, ms, live: true };
      tasks.push(task);
      return () => void (task.live = false);
    },
    fire: () => {
      for (const t of tasks.splice(0)) if (t.live) t.fn();
    },
    pending: () => tasks.filter((t) => t.live).length,
    delays: () => tasks.map((t) => t.ms),
  };
}

function setup(extra: Partial<WorkerIoOptions> = {}) {
  const timers = fakeTimers();
  const sent: string[] = [];
  const asked: string[] = [];
  const lock = createWebLock(undefined);
  const made = createWorkerIo({
    vfs: createVfs({ files: [], outCap: 1024 }),
    lock,
    columns: 64,
    coarse: false,
    sendOut: (t) => sent.push(t),
    askSecret: async (q) => {
      asked.push(q);
      return "answer";
    },
    schedule: timers.schedule,
    ...extra,
  });
  return { ...made, timers, sent, asked };
}

describe("the in-app Io", () => {
  it("has a fixed environment, no network, virtual folders and the columns it was given", () => {
    const { io } = setup();
    expect(io.env).toEqual({ SNAPPY_APP: "1", COLORTERM: "truecolor" });
    expect(io.capabilities.network).toBe(false);
    expect(io.homedir()).toBe("/app");
    expect(io.tmpdir()).toBe("/tmp");
    expect(io.columns).toBe(64);
    expect(io.interactive).toBe(true);
    expect(io.path.sep).toBe("/");
    expect(io.limits.maxBundledBytes).toBe(MAX_BUNDLED_DESKTOP);
    expect(setup({ coarse: true }).io.limits.maxBundledBytes).toBe(MAX_BUNDLED_TOUCH);
    expect(MAX_BUNDLED_TOUCH).toBeLessThan(MAX_BUNDLED_DESKTOP);
  });

  it("never carries the page's environment, whatever it holds", () => {
    const saved = { ...process.env };
    process.env.SNAPPY_PASSPHRASE = "must-not-appear";
    process.env.SNAPPY_DEBUG = "1";
    try {
      const { io } = setup();
      expect(Object.keys(io.env).sort()).toEqual(["COLORTERM", "SNAPPY_APP"]);
      expect(JSON.stringify(io.env)).not.toContain("must-not-appear");
    } finally {
      process.env = saved;
    }
  });

  it("makes random ids and reads the clock through the injected functions", () => {
    const { io } = setup({ now: () => 42, randomId: () => "fixed-id" });
    expect(io.now()).toBe(42);
    expect(io.randomId()).toBe("fixed-id");
    expect(setup().io.randomId()).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("output batching", () => {
  it("sends output and error text together, in order, after the delay", () => {
    const { io, sent, timers } = setup();
    io.out.write("one ");
    io.err.write("two ");
    io.out.write("three");
    expect(sent).toEqual([]);
    expect(timers.delays()).toEqual([FLUSH_MS]);
    timers.fire();
    expect(sent).toEqual(["one two three"]);
  });

  it("sends at once when a lot has piled up, and sets no second timer", () => {
    const { io, sent, timers } = setup();
    io.out.write("x".repeat(FLUSH_BYTES));
    expect(sent).toEqual(["x".repeat(FLUSH_BYTES)]);
    expect(timers.pending()).toBe(0);
  });

  it("flush sends what is waiting and cancels the timer", () => {
    const { io, flush, sent, timers } = setup();
    io.out.write("tail");
    flush();
    expect(sent).toEqual(["tail"]);
    expect(timers.pending()).toBe(0);
    flush();
    expect(sent).toEqual(["tail"]);
  });
});

describe("asking for a secret", () => {
  it("sends the question first, then waits for the answer", async () => {
    const order: string[] = [];
    const { io } = setup({
      sendOut: (t) => order.push(`out:${t}`),
      askSecret: async (q) => {
        order.push(`ask:${q}`);
        return "typed";
      },
    });
    io.out.write("Passphrase: ");
    expect(await io.askSecret("Passphrase: ")).toBe("typed");
    expect(order).toEqual(["out:Passphrase: ", "ask:Passphrase: "]);
  });

  it("turns a canceled answer into the calm canceled error", async () => {
    const { io } = setup({ askSecret: async () => null });
    await expect(io.askSecret("Passphrase: ")).rejects.toMatchObject({ code: "canceled", exitCode: 130, message: "Canceled. Nothing was changed." });
  });

  it("does not ask at all once a stop was requested", async () => {
    const controller = new AbortController();
    controller.abort();
    const asked: string[] = [];
    const { io } = setup({ signal: controller.signal, askSecret: async (q) => (asked.push(q), "x") });
    await expect(io.askSecret("Passphrase: ")).rejects.toMatchObject({ code: "canceled" });
    expect(asked).toEqual([]);
  });
});

describe("the web lock", () => {
  /** A Web Locks stand-in: one holder at a time, and a waiting request ends with AbortError when its signal fires. */
  function manager(): LockManagerLike & { held: Set<string> } {
    const held = new Set<string>();
    const queues = new Map<string, (() => void)[]>();
    return {
      held,
      request(name, options, callback) {
        return new Promise((resolve, reject) => {
          const run = async (): Promise<void> => {
            held.add(name);
            try {
              resolve(await callback());
            } catch (e) {
              reject(e);
            } finally {
              held.delete(name);
              queues.get(name)?.shift()?.();
            }
          };
          if (!held.has(name)) return void run();
          const waiter = (): void => void run();
          queues.set(name, [...(queues.get(name) ?? []), waiter]);
          options.signal?.addEventListener("abort", () => {
            queues.set(name, (queues.get(name) ?? []).filter((w) => w !== waiter));
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          });
        });
      },
    };
  }

  it("runs the work under the lock and releases it afterwards, even when the work fails", async () => {
    const m = manager();
    const lock = createWebLock(m);
    expect(await lock.withLock("ledger", { waitMs: 1000 }, async () => (m.held.size === 1 ? "held" : "not held"))).toBe("held");
    expect(m.held.size).toBe(0);
    await expect(lock.withLock("ledger", { waitMs: 1000 }, async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(m.held.size).toBe(0);
  });

  it("stops with the calm busy message when the wait runs out", async () => {
    const m = manager();
    const lock = createWebLock(m);
    let release: () => void = () => undefined;
    const first = lock.withLock("ledger", { waitMs: 1000 }, () => new Promise<void>((r) => (release = r)));
    await expect(lock.withLock("ledger", { waitMs: 20 }, async () => "never")).rejects.toMatchObject({ code: "ledger-busy" });
    release();
    await first;
  });

  it("runs the work directly when the browser has no Web Locks", async () => {
    expect(await createWebLock(undefined).withLock("ledger", { waitMs: 1 }, async () => "ran")).toBe("ran");
  });
});
