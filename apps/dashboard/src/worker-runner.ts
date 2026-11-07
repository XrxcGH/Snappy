/**
 * Runs the import in a background worker, so a history of hundreds of megabytes cannot freeze the
 * page, and falls back to reading on the page when no worker can start.
 *
 * The worker's code is text inside this page (build.mjs embeds it). It is started from a blob:
 * URL, which is why the policy has `worker-src blob:` and nothing broader. A worker made from a
 * blob: URL inherits the page's policy, so `connect-src 'none'` binds it too: it cannot reach the
 * network any more than the page can.
 */
import type { ChatEvent } from "@snappy-export/core";
import type { ImportHooks, ImportRunner } from "./import-pipeline.ts";
import { unpackChats } from "./import-transfer.ts";
import type { StartRequest, WorkerReply } from "./import-transfer.ts";

/** The few things the runner needs from a worker, so tests can stand in for a real one. */
export interface WorkerHandle {
  start(request: StartRequest): void;
  /** Stops the worker and releases its blob: URL. Safe to call twice. */
  stop(): void;
  onReply(handler: (reply: WorkerReply) => void): void;
  /** The worker could not start, or died. */
  onFailure(handler: () => void): void;
}

/** A worker from code held as text, or null when this browser cannot make one. */
export function spawnBlobWorker(source: string): WorkerHandle | null {
  if (typeof Worker === "undefined" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return null;
  const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  let worker: Worker;
  try {
    worker = new Worker(url);
  } catch {
    URL.revokeObjectURL(url);
    return null;
  }
  return {
    start: (request) => worker.postMessage(request),
    stop() {
      worker.terminate();
      URL.revokeObjectURL(url);
    },
    onReply(handler) {
      worker.onmessage = (event: MessageEvent<WorkerReply>) => handler(event.data);
    },
    onFailure(handler) {
      worker.onerror = (event) => {
        event.preventDefault(); // the reason can name a file, and this page reports a fixed message instead
        handler();
      };
      worker.onmessageerror = () => handler();
    },
  };
}

/** Rejection with no detail: the page shows its own fixed message. */
export class ImportWorkerError extends Error {
  constructor() {
    super("The background reader stopped.");
    this.name = "ImportWorkerError";
  }
}

/**
 * Use `spawn` for each import. When it gives no worker, or the worker fails before sending
 * anything (blocked script, no support), read on the page instead. A worker that fails after
 * starting is a real failure: the same files would fail again, so it is reported, not retried.
 */
export function workerRunner(spawn: () => WorkerHandle | null, fallback: ImportRunner): ImportRunner {
  return (blobs, hooks: ImportHooks) =>
    new Promise((resolve, reject) => {
      let worker: WorkerHandle | null = null;
      try {
        worker = spawn();
      } catch {
        worker = null;
      }
      if (worker === null) {
        fallback(blobs, hooks).then(resolve, reject);
        return;
      }

      const chats: ChatEvent[] = [];
      const handle = worker;
      let heard = false;
      let over = false;
      const end = (): void => {
        over = true;
        handle.stop();
      };
      handle.onReply((reply) => {
        if (over) return;
        heard = true;
        if (reply.type === "progress") hooks.onProgress(reply.progress);
        else if (reply.type === "chats") unpackChats(reply.batch, chats);
        else if (reply.type === "done") {
          end();
          resolve({ ...reply.parsed, chats });
        } else {
          end();
          reject(new ImportWorkerError());
        }
      });
      handle.onFailure(() => {
        if (over) return;
        end();
        if (heard) reject(new ImportWorkerError());
        else fallback(blobs, hooks).then(resolve, reject);
      });
      try {
        handle.start({ type: "start", blobs: [...blobs] });
      } catch {
        // A file the browser cannot hand to a worker: read it on the page.
        end();
        fallback(blobs, hooks).then(resolve, reject);
      }
    });
}
