/**
 * Everything the command blocks share on one page: the runner, the controller and what they need from
 * the dashboard. The page makes one session when it starts and hands it to every view. Tests make their
 * own, with a runner that cannot start a helper, so Run says "This browser cannot run commands here."
 * instead of failing.
 */
import { announce as speak } from "../announce.ts";
import type { VaultStore } from "../vault.ts";
import { createTerminalController } from "./controller.ts";
import type { TerminalController } from "./controller.ts";
import { createPickedFiles } from "./picked-files.ts";
import type { PickedFiles } from "./picked-files.ts";
import { createRunner } from "./runner.ts";
import type { Channel, RunFile } from "./run-types.ts";

const MIB = 1024 * 1024;
/** Most the virtual output folder may hold: less on a phone or tablet. */
export const OUT_CAP_DESKTOP = 256 * MIB;
export const OUT_CAP_TOUCH = 96 * MIB;

export interface TerminalSession {
  controller: TerminalController;
  /** The export files picked for the command blocks, shared by all of them. */
  picked: PickedFiles;
  /** The virtual folder's size limit for this device, in bytes. */
  outCap: number;
  /** False when this browser cannot start a helper. */
  supported: boolean;
}

export interface SessionOptions {
  /** A new helper for one Run, or null when this browser cannot make one. */
  spawn: () => Channel | null;
  vault: VaultStore;
  /** The phase of the dashboard's saved history. */
  vaultPhase: () => "locked" | "session" | "unlocked";
  /** Lock the dashboard's copy of the history before a command saves it. */
  beforeStoreRun?: () => Promise<void>;
  /** Look at the saved history again after a command saved it. */
  afterStoreRun?: () => Promise<void>;
  /** Replaces the picked files as the source of a Run's files (tests). */
  getFiles?: () => readonly RunFile[];
  columns?: () => number;
  announce?: (message: string, assertive?: boolean) => void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => () => void;
  /** A touch device. Default: ask the browser. */
  coarse?: boolean;
}

const isCoarse = (): boolean => {
  try {
    return typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  } catch {
    return false;
  }
};

export function createTerminalSession(options: SessionOptions): TerminalSession {
  const coarse = options.coarse ?? isCoarse();
  const outCap = coarse ? OUT_CAP_TOUCH : OUT_CAP_DESKTOP;
  const picked = createPickedFiles();
  let spawnFailed = false;
  const runner = createRunner({
    spawn: () => {
      const channel = options.spawn();
      if (channel === null) spawnFailed = true;
      return channel;
    },
    vault: options.vault,
    vaultPhase: options.vaultPhase,
    now: options.now ?? (() => Date.now()),
    setTimer:
      options.setTimer ??
      ((fn, ms) => {
        const id = setTimeout(fn, ms);
        return () => clearTimeout(id);
      }),
    outCap,
    coarse,
  });
  const controller = createTerminalController({
    runner,
    getFiles: options.getFiles ?? (() => picked.files()),
    announce: options.announce ?? speak,
    columns: options.columns ?? (() => 80),
    beforeStoreRun: options.beforeStoreRun ?? (async () => undefined),
    afterStoreRun: options.afterStoreRun ?? (async () => undefined),
    workerAvailable: () => !spawnFailed,
  });
  return {
    controller,
    picked,
    outCap,
    get supported() {
      return !spawnFailed;
    },
  };
}
