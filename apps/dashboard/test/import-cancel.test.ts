/**
 * Stopping an import: Cancel ends the read at once, adds nothing to the history, leaves the page ready for the next
 * import, and a second import cannot start on top of a running one. Synthetic data only.
 */
import { describe, expect, it } from "vitest";
import { startFlow } from "../src/copy-start.ts";
import { ImportCanceled, runImport } from "../src/import-pipeline.ts";
import type { ImportHooks, ImportRunner } from "../src/import-pipeline.ts";
import { ImportWorkerError, workerRunner } from "../src/worker-runner.ts";
import type { WorkerHandle } from "../src/worker-runner.ts";
import type { WorkerReply } from "../src/import-transfer.ts";
import { partFiles, setup } from "./export-fixtures.ts";

const NO_YIELD = async (): Promise<void> => {};
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** A reader that holds its result until the test lets it go, and says whether it saw the stop request. */
function heldRunner(): { runner: ImportRunner; calls: () => number; sawStop: () => boolean; release: () => Promise<void> } {
  let calls = 0;
  let saw = false;
  let release: () => Promise<void> = async () => {};
  const runner: ImportRunner = (blobs, hooks) => {
    calls++;
    hooks.signal?.addEventListener("abort", () => (saw = true));
    hooks.onProgress({ step: 0, steps: blobs.length, fraction: 0.3 });
    return new Promise((resolve, reject) => {
      release = async () => {
        try {
          resolve(await runImport(blobs, { onProgress: hooks.onProgress, yieldToUi: NO_YIELD }));
        } catch (e) {
          reject(e);
        }
      };
    });
  };
  return { runner, calls: () => calls, sawStop: () => saw, release: () => release() };
}

describe("canceling an import in the actions", () => {
  it("stops the read, adds nothing, and says so", async () => {
    const held = heldRunner();
    const { store, actions } = setup({ runImport: held.runner });
    const result = actions.importZips(partFiles(2));
    await tick();
    expect(store.get().import.phase).toBe("reading");
    actions.cancelImport();
    expect(await result).toBe("canceled");
    expect(held.sawStop()).toBe(true);
    expect(store.get().import).toMatchObject({ phase: "idle", message: startFlow.stopped });
    expect(store.get().import.issues).toBeUndefined();
    expect(store.get().real.latest).toBeNull();
    expect(store.get().real.ledger.snapshots).toHaveLength(0);
  });

  it("drops the result of a reader that did not look at the stop request", async () => {
    const held = heldRunner();
    const { store, actions } = setup({ runImport: held.runner });
    const result = actions.importZips(partFiles(2));
    await tick();
    actions.cancelImport();
    expect(await result).toBe("canceled");
    // It finishes later with a whole export, and its progress reports keep coming: none of it reaches the page.
    const before = store.get();
    await held.release();
    await tick();
    expect(store.get()).toBe(before);
    expect(store.get().real.ledger.snapshots).toHaveLength(0);
  });

  it("is ready for the next import afterwards", async () => {
    const held = heldRunner();
    const { store, actions } = setup({ runImport: held.runner });
    const first = actions.importZips(partFiles(2));
    await tick();
    actions.cancelImport();
    await first;
    const second = actions.importZips(partFiles(2));
    await tick();
    await held.release();
    expect(await second).toBe("done");
    expect(store.get().real.ledger.snapshots).toHaveLength(1);
  });

  it("does nothing when no import is running, and does not stop a sample", async () => {
    const { store, actions } = setup();
    actions.cancelImport();
    expect(store.get().import.phase).toBe("idle");
    const sample = actions.loadSample();
    actions.cancelImport();
    expect(await sample).toBe("done");
    expect(store.get().sample).not.toBeNull();
  });
});

describe("a second import while one is running", () => {
  it("is refused as busy and starts no second read", async () => {
    const held = heldRunner();
    const { store, actions } = setup({ runImport: held.runner });
    const first = actions.importZips(partFiles(2));
    await tick();
    expect(await actions.importZips(partFiles(2))).toBe("busy");
    expect(held.calls()).toBe(1);
    expect(store.get().import.phase).toBe("reading");
    await held.release();
    expect(await first).toBe("done");
    expect(store.get().real.ledger.snapshots).toHaveLength(1);
  });

  it("refuses the sample too, and an import while the sample is being built", async () => {
    const held = heldRunner();
    const { actions } = setup({ runImport: held.runner });
    const first = actions.importZips(partFiles(2));
    await tick();
    expect(await actions.loadSample()).toBe("busy");
    actions.cancelImport();
    await first;
    const sample = actions.loadSample();
    expect(await actions.importZips(partFiles(2))).toBe("busy");
    await sample;
  });
});

describe("the page reader and the worker runner stop on request", () => {
  it("runImport rejects with ImportCanceled when the signal is already aborted, and when it fires mid-read", async () => {
    const aborted = new AbortController();
    aborted.abort();
    await expect(runImport(partFiles(2), { onProgress: () => undefined, yieldToUi: NO_YIELD, signal: aborted.signal })).rejects.toBeInstanceOf(ImportCanceled);

    const mid = new AbortController();
    let reports = 0;
    const hooks: ImportHooks = {
      onProgress: () => {
        if (++reports === 3) mid.abort();
      },
      yieldToUi: NO_YIELD,
      signal: mid.signal,
    };
    await expect(runImport(partFiles(2), hooks)).rejects.toBeInstanceOf(ImportCanceled);
    expect(reports).toBeLessThan(10);
  });

  function quietWorker(): { handle: WorkerHandle; stops: () => number; started: () => number; reply: (r: WorkerReply) => void } {
    let stops = 0;
    let started = 0;
    let onReply: (r: WorkerReply) => void = () => undefined;
    return {
      handle: { start: () => void started++, stop: () => void stops++, onReply: (h) => void (onReply = h), onFailure: () => undefined },
      stops: () => stops,
      started: () => started,
      reply: (r) => onReply(r),
    };
  }

  it("stops the worker and rejects with ImportCanceled, without falling back to the page", async () => {
    const worker = quietWorker();
    let fallbacks = 0;
    const run = workerRunner(
      () => worker.handle,
      async () => {
        fallbacks++;
        throw new Error("must not be called");
      },
    );
    const stop = new AbortController();
    const result = run(partFiles(2), { onProgress: () => undefined, yieldToUi: NO_YIELD, signal: stop.signal });
    worker.reply({ type: "progress", progress: { step: 0, steps: 3, fraction: 0.1 } });
    stop.abort();
    await expect(result).rejects.toBeInstanceOf(ImportCanceled);
    expect(worker.stops()).toBe(1);
    expect(fallbacks).toBe(0);
    // A reply that arrives after the stop is ignored, and the rejection is not an ImportWorkerError.
    worker.reply({ type: "error" } as unknown as WorkerReply);
    await expect(result).rejects.not.toBeInstanceOf(ImportWorkerError);
  });

  it("does not start work for a signal that is already aborted", async () => {
    const worker = quietWorker();
    const run = workerRunner(() => worker.handle, runImport);
    const stop = new AbortController();
    stop.abort();
    await expect(run(partFiles(2), { onProgress: () => undefined, yieldToUi: NO_YIELD, signal: stop.signal })).rejects.toBeInstanceOf(ImportCanceled);
    expect(worker.started()).toBe(0);
    expect(worker.stops()).toBe(1);
  });
});
