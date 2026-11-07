/**
 * The Io a command gets inside the app: the virtual file system and the web lock from this folder,
 * a fixed environment, no network, and output that is sent to the page in small batches. Runs in a
 * worker, so it touches no document, window or storage.
 */
import { CliError, posixPath } from "./cli-api.ts";
import type { Io, LockPort } from "./cli-api.ts";
import type { Vfs } from "./vfs.ts";

/** Output is sent every 50 ms, or at once when this much has piled up. */
export const FLUSH_MS = 50;
export const FLUSH_BYTES = 16 * 1024;

const MIB = 1024 * 1024;
/** Largest bundled file read whole, in the app (phones and tablets get less). */
export const MAX_BUNDLED_DESKTOP = 128 * MIB;
export const MAX_BUNDLED_TOUCH = 64 * MIB;

export interface WorkerIoOptions {
  vfs: Vfs;
  lock: LockPort;
  columns: number;
  /** A touch device: smaller memory limits. */
  coarse: boolean;
  signal?: AbortSignal;
  /** Sends a batch of output text to the page. */
  sendOut(text: string): void;
  /** Asks the person for a secret; null means they canceled. */
  askSecret(question: string): Promise<string | null>;
  now?: () => number;
  randomId?: () => string;
  /** Runs `fn` after `ms`; returns a function that cancels it. */
  schedule?: (fn: () => void, ms: number) => () => void;
}

export interface WorkerIo {
  io: Io;
  /** Send whatever output is waiting. Call before the helper reports that it ended. */
  flush(): void;
}

const defaultSchedule = (fn: () => void, ms: number): (() => void) => {
  const id = setTimeout(fn, ms);
  return () => clearTimeout(id);
};

export function createWorkerIo(options: WorkerIoOptions): WorkerIo {
  const schedule = options.schedule ?? defaultSchedule;
  let pending = "";
  let cancelTimer: (() => void) | undefined;

  const flush = (): void => {
    cancelTimer?.();
    cancelTimer = undefined;
    if (pending === "") return;
    const text = pending;
    pending = "";
    options.sendOut(text);
  };
  // Output and error text share one stream, so their order is what the command wrote.
  const write = (text: string): void => {
    pending += text;
    if (pending.length >= FLUSH_BYTES) flush();
    else if (cancelTimer === undefined) cancelTimer = schedule(flush, FLUSH_MS);
  };

  const io: Io = {
    out: { write },
    err: { write },
    // A fixed list. The helper never sees the page's environment, so a passphrase cannot be slipped
    // in through it and no debug switch can be turned on.
    env: { SNAPPY_APP: "1", COLORTERM: "truecolor" },
    interactive: true,
    columns: options.columns,
    now: options.now ?? (() => Date.now()),
    homedir: () => "/app",
    tmpdir: () => "/tmp",
    randomId: options.randomId ?? (() => globalThis.crypto.randomUUID()),
    async askSecret(question) {
      // The question must be on screen before the field asks for the answer.
      flush();
      if (options.signal?.aborted === true) throw new CliError("canceled", "Canceled. Nothing was changed.", 130);
      const answer = await options.askSecret(question);
      if (answer === null) throw new CliError("canceled", "Canceled. Nothing was changed.", 130);
      return answer;
    },
    fs: options.vfs.fs,
    path: posixPath,
    lock: options.lock,
    limits: { maxBundledBytes: options.coarse ? MAX_BUNDLED_TOUCH : MAX_BUNDLED_DESKTOP },
    capabilities: { network: false },
    signal: options.signal,
  };
  return { io, flush };
}
