/**
 * The saved history's lock inside the app, on the browser's Web Locks. The lock is released when the
 * helper ends, even if it is stopped, so no stale lock can be left behind. Runs in a worker.
 */
import { CliError } from "./cli-api.ts";
import type { LockPort } from "./cli-api.ts";

/** The part of navigator.locks the lock needs, so tests can stand in for it. */
export interface LockManagerLike {
  request<T>(name: string, options: { signal?: AbortSignal }, callback: () => Promise<T>): Promise<T>;
}

const BUSY = "Another command is using your saved history, so nothing was changed. Wait and try again.";

/**
 * Take the named lock for the length of `work`, waiting up to `waitMs`. Without Web Locks the work
 * runs directly: the app starts one helper per Run and allows one Run at a time, so nothing else
 * can be using the history.
 */
export function createWebLock(manager: LockManagerLike | undefined): LockPort {
  return {
    async withLock(name, opts, work) {
      if (manager === undefined) return work();
      const waiting = new AbortController();
      const timer = setTimeout(() => waiting.abort(), opts.waitMs);
      try {
        return await manager.request(`snappy-ledger:${name}`, { signal: waiting.signal }, async () => {
          // Held now: the wait is over, so a late timeout must not cancel anything.
          clearTimeout(timer);
          return work();
        });
      } catch (e) {
        if (waiting.signal.aborted && (e as { name?: string }).name === "AbortError") throw new CliError("ledger-busy", BUSY);
        throw e;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
