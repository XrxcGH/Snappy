/**
 * Everything the command blocks share on one page: the runner, the controller and what they need from
 * the dashboard. The page makes one session when it starts and hands it to every view. Tests make their
 * own, with a runner that cannot start a helper, so Run says "This browser cannot run commands here."
 * instead of failing.
 */
import { announce as speak } from "../announce.ts";
import { platform } from "../platform.ts";
import type { VaultStore } from "../vault.ts";
import { createTerminalController } from "./controller.ts";
import type { TerminalController } from "./controller.ts";
import type { CommandSpec } from "./commands.ts";
import { createPickedFiles } from "./picked-files.ts";
import type { PickedFiles } from "./picked-files.ts";
import { createRunner } from "./runner.ts";
import { canUseSample, sampleRunFiles } from "./sample-files.ts";
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
  /** Where the width of the output area comes from: the block that is about to run says so. */
  columnsFrom(source: () => number): void;
  /**
   * The sample data is showing (or not). While it is, a command that only reads an export runs on the sample when no export was
   * picked. The blocks keep this in step with the page's state; it is not saved.
   */
  sampleMode(on: boolean): void;
  /** True when Run would use the sample for this command: the sample is showing, nothing was picked, and the command only reads. */
  usesSample(spec: CommandSpec): boolean;
  /**
   * Forget everything the commands showed or were given: stop a Run, clear every transcript and saved file,
   * and drop the picked export files and the generated sample. The dashboard calls this when it locks or deletes its data.
   */
  reset(): void;
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
  /** The sample export's files. Default: the made-up export the dashboard's sample is built from (tests give a small stand-in). */
  sampleFiles?: () => RunFile[];
  columns?: () => number;
  announce?: (message: string, assertive?: boolean) => void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => () => void;
  /** A touch device. Default: ask the browser. */
  coarse?: boolean;
  /** The version label the commands report. Default: the desktop app's own label, if it set one. */
  version?: () => string | undefined;
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
  let source: () => number = options.columns ?? (() => 80);
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
    version: options.version ?? (() => platform().release?.version),
  });
  let sampleOn = false;
  let sample: RunFile[] | null = null;
  const usesSample = (spec: CommandSpec): boolean => options.getFiles === undefined && sampleOn && picked.count() === 0 && canUseSample(spec);
  const controller = createTerminalController({
    runner,
    // The files the person picked win. The sample is generated the first time a Run needs it and kept only until Lock or Delete data.
    getFiles: options.getFiles ?? ((spec) => (usesSample(spec) ? (sample ??= (options.sampleFiles ?? sampleRunFiles)()) : picked.files())),
    announce: options.announce ?? speak,
    columns: () => source(),
    beforeStoreRun: options.beforeStoreRun ?? (async () => undefined),
    afterStoreRun: options.afterStoreRun ?? (async () => undefined),
    workerAvailable: () => !spawnFailed,
  });
  return {
    controller,
    picked,
    outCap,
    columnsFrom(next) {
      source = next;
    },
    sampleMode(on) {
      sampleOn = on;
    },
    usesSample,
    reset() {
      controller.reset();
      picked.clear();
      sample = null;
    },
    get supported() {
      return !spawnFailed;
    },
  };
}
