/**
 * Work that several test files need, done once per test run instead of once per file.
 *
 * Test files run in separate workers and share nothing in memory, so a result that five files read (the
 * insight command runs) was being made five times, which pushed the slowest file past its hook limit on a
 * busy machine. global-setup.ts makes one empty folder for the whole run and hands its path to every
 * worker. The first worker to ask for a result takes a lock (a folder made with mkdir, which only one
 * caller can do), makes the result and saves it there as JSON. The others wait for the saved file.
 *
 * If the shared folder is missing (the file run by another runner) or the first worker fails or takes
 * too long, a worker makes the result itself, so a failure here can only cost time.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inject } from "vitest";

/** The most a worker waits for another to finish. A hook that waits has the longer limit below. */
const WAIT_MS = 170_000;
const POLL_MS = 150;

/** Hook limit for a hook that may wait for shared runs on a busy machine. */
export const SHARED_HOOK_TIMEOUT = 240_000;

declare module "vitest" {
  export interface ProvidedContext {
    /** An empty folder for this run only, made by global-setup.ts. */
    sharedRunsDir: string;
  }
}

function sharedDir(): string | undefined {
  try {
    const dir = inject("sharedRunsDir");
    return typeof dir === "string" && existsSync(dir) ? dir : undefined;
  } catch {
    return undefined;
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function readSaved<T>(file: string): T | undefined {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

/** The result for `key`, made by `make` in at most one worker per run. */
export async function sharedRuns<T>(key: string, make: () => Promise<T>): Promise<T> {
  const dir = sharedDir();
  if (dir === undefined) return make();
  const saved = join(dir, `${key}.json`);
  const lock = join(dir, `${key}.lock`);

  const early = readSaved<T>(saved);
  if (early !== undefined) return early;

  let mine = false;
  try {
    mkdirSync(lock);
    mine = true;
  } catch {
    mine = false;
  }

  if (mine) {
    try {
      const result = await make();
      const temp = `${saved}.${process.pid}.tmp`;
      writeFileSync(temp, JSON.stringify(result));
      renameSync(temp, saved);
      return result;
    } catch (e) {
      // Let a waiting worker make it for itself instead of waiting for a result that will not come.
      rmSync(lock, { recursive: true, force: true });
      throw e;
    }
  }

  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    const result = readSaved<T>(saved);
    if (result !== undefined) return result;
    if (!existsSync(lock)) break;
    await sleep(POLL_MS);
  }
  return make();
}
