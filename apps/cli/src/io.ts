/**
 * Everything a command touches in the outside world, injected so tests can drive commands as
 * plain functions and the dashboard can run them in a worker. Types only: node-io.ts builds the
 * real one for the command line, and the dashboard's terminal builds its own.
 */
import type { Transport } from "./memories-download.ts";
import type { FsPort, Limits, LockPort, PathPort } from "./ports.ts";

export type { FsPort, Limits, LockPort, PathPort } from "./ports.ts";

export interface Sink {
  write(text: string): void;
}

export interface Io {
  out: Sink;
  err: Sink;
  env: Readonly<Record<string, string | undefined>>;
  /** Whether stdout is an interactive terminal (colors, progress bars). */
  interactive: boolean;
  columns: number;
  /** Epoch ms "now". The only clock the CLI uses. */
  now(): number;
  homedir(): string;
  tmpdir(): string;
  /** A fresh random identifier (a snapshot id, a temp file name). */
  randomId(): string;
  /** Ask for a secret without echoing it. Rejects when there is no terminal to ask on. */
  askSecret(question: string): Promise<string>;
  fs: FsPort;
  path: PathPort;
  lock: LockPort;
  limits: Limits;
  capabilities: {
    /** False inside the dashboard: nothing there may reach the network. */
    network: boolean;
  };
  /** Cooperative cancel. Set only by the dashboard's terminal. */
  signal?: AbortSignal;
  /** Memories downloader only: replaces the network in tests. */
  transport?: Transport;
  /** Memories downloader only: replaces the retry delay in tests. */
  sleep?: (ms: number) => Promise<void>;
}
