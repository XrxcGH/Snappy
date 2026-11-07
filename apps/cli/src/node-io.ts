/**
 * The command line's Io: real streams, the clock, the home folder and the real file system.
 * With node-ports.ts and main.ts this is the only place that reads process state or the clock.
 */
import { randomUUID } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import type { Io } from "./io.ts";
import { createNodeFs, createNodeLock, createNodePath } from "./node-ports.ts";
import type { FsPort, LockPort, PathPort } from "./ports.ts";
import { promptHidden } from "./prompt.ts";

/** Largest bundled file the command line reads into memory in one piece. */
const NODE_MAX_BUNDLED_BYTES = 512 * 1024 * 1024;

export function createNodePorts(): { fs: FsPort; path: PathPort; lock: LockPort } {
  return { fs: createNodeFs(), path: createNodePath(), lock: createNodeLock() };
}

export function createRealIo(): Io {
  // A closed pipe (`snappy ... | head`) is not an error worth a message.
  for (const stream of [process.stdout, process.stderr]) {
    stream.on("error", (e: { code?: string }) => {
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
    randomId: () => randomUUID(),
    askSecret: (question) => promptHidden(question, process.stdin, process.stderr),
    ...createNodePorts(),
    limits: { maxBundledBytes: NODE_MAX_BUNDLED_BYTES },
    capabilities: { network: true },
  };
}
