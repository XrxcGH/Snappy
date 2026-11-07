/**
 * Everything a command touches in the outside world, injected so tests can drive commands as
 * plain functions. This file and main.ts are the only places that read process state, the
 * clock, or the home directory.
 */
import { homedir, tmpdir } from "node:os";
import type { Transport } from "./memories-download.ts";
import { promptHidden } from "./prompt.ts";

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
  /** Ask for a secret without echoing it. Rejects when there is no terminal to ask on. */
  askSecret(question: string): Promise<string>;
  /** Memories downloader only: replaces the network in tests. */
  transport?: Transport;
  /** Memories downloader only: replaces the retry delay in tests. */
  sleep?: (ms: number) => Promise<void>;
}

export function createRealIo(): Io {
  // A closed pipe (`snappy ... | head`) is not an error worth a message.
  for (const stream of [process.stdout, process.stderr]) {
    stream.on("error", (e: NodeJS.ErrnoException) => {
      if (e.code === "EPIPE") process.exit(0);
    });
  }
  return {
    out: { write: (text) => void process.stdout.write(text) },
    err: { write: (text) => void process.stderr.write(text) },
    env: process.env,
    interactive: process.stdout.isTTY === true,
    columns: process.stdout.isTTY === true && (process.stdout.columns ?? 0) > 0 ? process.stdout.columns : 100,
    now: () => Date.now(),
    homedir: () => homedir(),
    tmpdir: () => tmpdir(),
    askSecret: (question) => promptHidden(question, process.stdin, process.stderr),
  };
}
