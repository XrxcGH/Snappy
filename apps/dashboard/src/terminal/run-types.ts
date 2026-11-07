/**
 * The shapes of the page side of a Run: what goes in, what the page hears back, and what a Run
 * returns. Interfaces only; runner.ts implements them, and the controller and the panel use them.
 */
import type { VaultStore } from "../vault.ts";
import type { CommandSpec } from "./commands.ts";
import type { FromWorker, OutFile, RunFile, ToWorker } from "./protocol.ts";

export type { OutFile, RunFile } from "./protocol.ts";

/** One open line to a helper: post messages, hear messages, hear that it failed, stop it. */
export interface Channel {
  post(message: ToWorker, transfer?: Transferable[]): void;
  onMessage(handler: (message: FromWorker | unknown) => void): void;
  /** The helper could not start, or died. */
  onFailure(handler: () => void): void;
  /** Stops the helper and releases what it held. Safe to call twice. */
  stop(): void;
}

export interface RunInput {
  spec: CommandSpec;
  /** The full argument list, built from the spec by the page. */
  argv: string[];
  files: readonly RunFile[];
  columns: number;
}

export interface RunHooks {
  /** Standard output and error, in order, with its styling codes intact. */
  onOut(text: string): void;
  /** Ask for a secret. null means the person canceled. */
  askSecret(question: string): Promise<string | null>;
  /** The files the command saved in the virtual output folder, once, before the result. */
  onFiles(files: OutFile[]): void;
}

/** How a Run ended. */
export type RunEnd = "done" | "canceled" | "terminated" | "blocked" | "failed";

export interface RunResult {
  end: RunEnd;
  /** The command's exit code. null when it never ran or was cut off without one. */
  code: number | null;
  ms: number;
}

export interface RunHandle {
  readonly done: Promise<RunResult>;
  /** Ask the command to stop; the helper is cut off if it does not stop in time. */
  cancel(): void;
}

export interface Runner {
  run(input: RunInput, hooks: RunHooks): RunHandle;
}

export interface RunnerDeps {
  /** A new helper for one Run, or null when this browser cannot start one. */
  spawn(): Channel | null;
  /** The saved history, for the commands allowed to read or write it. */
  vault: VaultStore;
  /** The phase of the dashboard's own saved history: a Run may write it only while it is not unlocked. */
  vaultPhase(): "locked" | "session" | "unlocked";
  now(): number;
  /** Runs `fn` after `ms`; returns a function that cancels it. */
  setTimer(fn: () => void, ms: number): () => void;
  /** Most bytes the virtual output folder may hold. */
  outCap: number;
  coarse: boolean;
}

/** After a stop request, the helper gets this long before it is cut off. */
export const CANCEL_GRACE_MS = 3000;
