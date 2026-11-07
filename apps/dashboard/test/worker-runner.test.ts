/**
 * Packing of chat events for the trip from the background reader, the page-side runner with its
 * fallback to reading on the page, and the blob: worker spawner. A real Worker does not exist in
 * the test environment, so a stand-in runs the real task and passes every message through
 * structuredClone (moving buffers like postMessage does), which proves the messages are cloneable.
 * Synthetic data only.
 */
import { forgetMediaHandles } from "@snappy-export/core";
import type { ChatEvent } from "@snappy-export/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runImport } from "../src/import-pipeline.ts";
import type { ImportHooks, ImportRunner } from "../src/import-pipeline.ts";
import { BATCH_EVENTS, packChats, unpackChats } from "../src/import-transfer.ts";
import type { StartRequest, WorkerReply } from "../src/import-transfer.ts";
import { runWorkerTask } from "../src/worker-task.ts";
import { ImportWorkerError, spawnBlobChannel, spawnBlobWorker, workerRunner } from "../src/worker-runner.ts";
import type { WorkerHandle } from "../src/worker-runner.ts";
import { partFiles } from "./export-fixtures.ts";

const NO_YIELD = async (): Promise<void> => {};
const hooks = (progress: unknown[] = []): ImportHooks => ({ onProgress: (p) => progress.push(p), yieldToUi: NO_YIELD });

const event = (n: number): ChatEvent => ({ conversation: n % 3 === 0 ? `group:${n % 7}` : `user_${n % 11}`, isGroup: n % 3 === 0, direction: n % 2 === 0 ? "sent" : "received", kind: ["TEXT", "IMAGE", "VIDEO"][n % 3] as string, at: 1_700_000_000_000 + n * 1000 });

describe("packChats and unpackChats", () => {
  it("round-trips every event, in order", () => {
    const chats = Array.from({ length: 1000 }, (_, i) => event(i));
    const out: ChatEvent[] = [];
    unpackChats(packChats(chats, 0, chats.length), out);
    expect(out).toEqual(chats);
  });

  it("packs a slice, with tables that hold each conversation and kind once", () => {
    const chats = Array.from({ length: 100 }, (_, i) => event(i));
    const batch = packChats(chats, 10, 40);
    expect(batch.at.length).toBe(30);
    expect(batch.conversations.length).toBe(new Set(chats.slice(10, 40).map((c) => c.conversation)).size);
    expect(batch.kinds.slice().sort()).toEqual(["IMAGE", "TEXT", "VIDEO"]);
    const out: ChatEvent[] = [];
    unpackChats(batch, out);
    expect(out).toEqual(chats.slice(10, 40));
  });

  it("keeps exact times, odd characters in names, and an empty batch", () => {
    const odd: ChatEvent[] = [
      { conversation: "café_你好", isGroup: false, direction: "sent", kind: "TEXT", at: 1.5 },
      { conversation: "group:ab12", isGroup: true, direction: "received", kind: "", at: 0 },
      { conversation: "x", isGroup: false, direction: "received", kind: "MEDIA", at: 8_640_000_000_000_000 },
    ];
    const out: ChatEvent[] = [];
    unpackChats(packChats(odd, 0, 3), out);
    expect(out).toEqual(odd);
    const empty: ChatEvent[] = [];
    unpackChats(packChats(odd, 1, 1), empty);
    expect(empty).toEqual([]);
  });

  it("has no field for anything but who, direction, kind and time", () => {
    const batch = packChats([event(1)], 0, 1);
    expect(Object.keys(batch).sort()).toEqual(["at", "conversation", "conversations", "flags", "kind", "kinds"]);
  });
});

/** A worker stand-in that runs the real task and clones each message the way postMessage does. */
function inProcessWorker(log: { stops: number; replies: WorkerReply[] }): WorkerHandle {
  let onReply: (reply: WorkerReply) => void = () => {};
  return {
    start(request: StartRequest) {
      const request2 = structuredClone(request);
      void runWorkerTask(request2.blobs, (reply, transfer) => {
        const cloned = structuredClone(reply, transfer ? { transfer } : undefined);
        log.replies.push(cloned);
        onReply(cloned);
      });
    },
    stop: () => void log.stops++,
    onReply: (handler) => {
      onReply = handler;
    },
    onFailure: () => {},
  };
}

describe("workerRunner with a working worker", () => {
  it("gives the same export as reading on the page, with chats arriving in batches", async () => {
    const files = partFiles(2);
    const log = { stops: 0, replies: [] as WorkerReply[] };
    const progress: unknown[] = [];
    const viaWorker = await workerRunner(() => inProcessWorker(log), runImport)(files, hooks(progress));
    const direct = await runImport(files, hooks());
    // The worker drops file locations and links before they cross to the page; everything else is the same.
    expect(viaWorker).toEqual(forgetMediaHandles(direct));
    expect(direct.bundledMedia?.length).toBeGreaterThan(0);
    expect(viaWorker.bundledMedia).toBeUndefined();
    expect(viaWorker.chats.length).toBeGreaterThan(0);
    expect(log.stops).toBe(1);
    expect(progress.length).toBeGreaterThan(3);
    const types = log.replies.map((r) => r.type);
    expect(types[types.length - 1]).toBe("done");
    expect(types.filter((t) => t === "chats").length).toBe(Math.ceil(direct.chats.length / BATCH_EVENTS));
  });

  it("splits a long history into batches of a bounded size, and the page puts it back together in order", async () => {
    const files = partFiles(2, { friendCount: 200, chatMessageCount: 4000 });
    const replies: WorkerReply[] = [];
    await runWorkerTask(files, (reply, transfer) => void replies.push(structuredClone(reply, transfer ? { transfer } : undefined)), 700);
    const batches = replies.filter((r): r is Extract<WorkerReply, { type: "chats" }> => r.type === "chats");
    const direct = await runImport(files, hooks());
    expect(batches.length).toBe(Math.ceil(direct.chats.length / 700));
    expect(batches.length).toBeGreaterThan(3);
    for (const b of batches) expect(b.batch.at.length).toBeLessThanOrEqual(700);
    const out: ChatEvent[] = [];
    for (const b of batches) unpackChats(b.batch, out);
    expect(out).toEqual(direct.chats);
  });

  it("sends the rest of the export without its chats, which travel packed", async () => {
    const log = { stops: 0, replies: [] as WorkerReply[] };
    await workerRunner(() => inProcessWorker(log), runImport)(partFiles(2), hooks());
    const done = log.replies.find((r) => r.type === "done") as Extract<WorkerReply, { type: "done" }>;
    expect(Object.keys(done.parsed)).not.toContain("chats");
    expect(done.parsed.friends.friends.length).toBeGreaterThan(0);
  });

  it("ignores anything a worker says after it has finished", async () => {
    const files = partFiles(2);
    let reply: (r: WorkerReply) => void = () => {};
    const handle: WorkerHandle = {
      start: () => {
        reply({ type: "done", parsed: { friends: { friends: [], sentRequests: [], pendingRequests: [], deletedFriends: [], blocked: [], ignored: [], hiddenSuggestions: [] }, memories: [], fileList: [], issues: [] } });
        reply({ type: "failed" });
      },
      stop: () => {},
      onReply: (h) => {
        reply = h;
      },
      onFailure: () => {},
    };
    await expect(workerRunner(() => handle, runImport)(files, hooks())).resolves.toMatchObject({ chats: [] });
  });
});

describe("workerRunner when the worker cannot be used", () => {
  const fallback = (): { runner: ImportRunner; calls: number[] } => {
    const calls: number[] = [];
    const runner: ImportRunner = async (blobs) => {
      calls.push(blobs.length);
      return runImport(blobs, hooks());
    };
    return { runner, calls };
  };

  it("reads on the page when the browser makes no worker", async () => {
    const { runner, calls } = fallback();
    const result = await workerRunner(() => null, runner)(partFiles(2), hooks());
    expect(calls).toEqual([3]);
    expect(result.chats.length).toBeGreaterThan(0);
  });

  it("reads on the page when starting a worker throws", async () => {
    const { runner, calls } = fallback();
    await workerRunner(() => {
      throw new Error("blocked");
    }, runner)(partFiles(2), hooks());
    expect(calls).toEqual([3]);
  });

  it("reads on the page when the worker fails before saying anything", async () => {
    const { runner, calls } = fallback();
    let stops = 0;
    let fail: () => void = () => {};
    const handle: WorkerHandle = { start: () => fail(), stop: () => void stops++, onReply: () => {}, onFailure: (h) => void (fail = h) };
    const result = await workerRunner(() => handle, runner)(partFiles(2), hooks());
    expect(calls).toEqual([3]);
    expect(stops).toBe(1);
    expect(result.chats.length).toBeGreaterThan(0);
  });

  it("reads on the page when the files cannot be handed to the worker", async () => {
    const { runner, calls } = fallback();
    const handle: WorkerHandle = {
      start: () => {
        throw new Error("DataCloneError");
      },
      stop: () => {},
      onReply: () => {},
      onFailure: () => {},
    };
    await workerRunner(() => handle, runner)(partFiles(2), hooks());
    expect(calls).toEqual([3]);
  });

  it("reports a failure after the worker started, without trying again", async () => {
    const { runner, calls } = fallback();
    let reply: (r: WorkerReply) => void = () => {};
    let fail: () => void = () => {};
    let stops = 0;
    const handle: WorkerHandle = {
      start: () => {
        reply({ type: "progress", progress: { step: 0, steps: 1, fraction: 0.2 } });
        fail();
      },
      stop: () => void stops++,
      onReply: (h) => void (reply = h),
      onFailure: (h) => void (fail = h),
    };
    await expect(workerRunner(() => handle, runner)(partFiles(2), hooks())).rejects.toBeInstanceOf(ImportWorkerError);
    expect(calls).toEqual([]);
    expect(stops).toBe(1);
  });

  it("reports a worker that says it failed, with fixed text and no detail", async () => {
    const { runner, calls } = fallback();
    let reply: (r: WorkerReply) => void = () => {};
    const handle: WorkerHandle = { start: () => reply({ type: "failed" }), stop: () => {}, onReply: (h) => void (reply = h), onFailure: () => {} };
    const error = await workerRunner(() => handle, runner)(partFiles(2), hooks()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ImportWorkerError);
    expect((error as Error).message).toBe("The background reader stopped.");
    expect(calls).toEqual([]);
  });

  it("passes a rejection from the page fallback on", async () => {
    const failing: ImportRunner = async () => {
      throw new Error("no");
    };
    await expect(workerRunner(() => null, failing)(partFiles(2), hooks())).rejects.toThrow("no");
  });
});

describe("runWorkerTask", () => {
  it("says only that it failed when reading throws, never why", async () => {
    const replies: WorkerReply[] = [];
    const bad = { size: 10, slice: () => ({ arrayBuffer: () => Promise.reject(new Error("secret reason")) }) } as unknown as Blob;
    // The page reader treats unreadable parts as problems in the export, so force a throw further in.
    const throwing = { get size(): number { throw new Error("secret reason"); }, slice: bad.slice } as unknown as Blob;
    await runWorkerTask([throwing], (r) => void replies.push(r));
    expect(replies).toEqual([{ type: "failed" }]);
    expect(JSON.stringify(replies)).not.toContain("secret");
  });
});

describe("spawnBlobWorker", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("gives nothing where there are no workers", () => {
    expect(typeof Worker).toBe("undefined");
    expect(spawnBlobWorker("1+1")).toBeNull();
  });

  interface StubWorker {
    url: string;
    onmessage: ((e: { data: unknown }) => void) | null;
    onerror: ((e: { preventDefault(): void }) => void) | null;
    onmessageerror: (() => void) | null;
    posted: unknown[];
    terminated: number;
  }

  function stubWorkers(construct: (url: string) => void = () => {}): { made: string[]; revoked: string[]; blobs: Blob[]; workers: StubWorker[] } {
    const made: string[] = [];
    const revoked: string[] = [];
    const blobs: Blob[] = [];
    const workers: StubWorker[] = [];
    class FakeWorker {
      onmessage: ((e: { data: unknown }) => void) | null = null;
      onerror: ((e: { preventDefault(): void }) => void) | null = null;
      onmessageerror: (() => void) | null = null;
      posted: unknown[] = [];
      terminated = 0;
      constructor(public url: string) {
        construct(url);
        workers.push(this);
      }
      postMessage(m: unknown): void {
        this.posted.push(m);
      }
      terminate(): void {
        this.terminated++;
      }
    }
    vi.stubGlobal("Worker", FakeWorker);
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      blobs.push(blob as Blob);
      const url = `blob:test/${made.length}`;
      made.push(url);
      return url;
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation((url) => void revoked.push(url));
    return { made, revoked, blobs, workers };
  }

  it("starts a worker from a blob: URL of the given code, and frees the URL when it stops", async () => {
    const seen = stubWorkers();
    const handle = spawnBlobWorker("self.onmessage = null;");
    expect(handle).not.toBeNull();
    expect(seen.made).toEqual(["blob:test/0"]);
    expect(seen.workers[0]?.url).toBe("blob:test/0");
    expect(await (seen.blobs[0] as Blob).text()).toBe("self.onmessage = null;");
    expect((seen.blobs[0] as Blob).type).toBe("text/javascript");

    const worker = seen.workers[0] as StubWorker;
    handle?.start({ type: "start", blobs: [] });
    expect(worker.posted).toEqual([{ type: "start", blobs: [] }]);

    const replies: unknown[] = [];
    handle?.onReply((r) => replies.push(r));
    worker.onmessage?.({ data: { type: "failed" } });
    expect(replies).toEqual([{ type: "failed" }]);

    let failures = 0;
    handle?.onFailure(() => void failures++);
    let prevented = 0;
    worker.onerror?.({ preventDefault: () => void prevented++ });
    worker.onmessageerror?.();
    expect(failures).toBe(2);
    expect(prevented).toBe(1);

    expect(seen.revoked).toEqual([]);
    handle?.stop();
    expect(worker.terminated).toBe(1);
    expect(seen.revoked).toEqual(["blob:test/0"]);
  });

  it("gives nothing, and frees the URL, when the browser refuses to start the worker", () => {
    const seen = stubWorkers(() => {
      throw new Error("SecurityError");
    });
    expect(spawnBlobWorker("x")).toBeNull();
    expect(seen.revoked).toEqual(["blob:test/0"]);
  });

  it("is the generic channel underneath: any message goes out, with a transfer list, and any comes back", async () => {
    const seen = stubWorkers();
    const channel = spawnBlobChannel<{ type: string }, { type: string }>("self.onmessage = null;");
    expect(channel).not.toBeNull();
    expect(await (seen.blobs[0] as Blob).text()).toBe("self.onmessage = null;");
    const worker = seen.workers[0] as StubWorker;
    channel?.post({ type: "cancel" });
    expect(worker.posted).toEqual([{ type: "cancel" }]);
    const heard: unknown[] = [];
    channel?.onMessage((m) => heard.push(m));
    worker.onmessage?.({ data: { type: "out" } });
    expect(heard).toEqual([{ type: "out" }]);
    channel?.stop();
    expect(worker.terminated).toBe(1);
    expect(spawnBlobChannel("x")).not.toBeNull();
  });

  it("gives no channel where there are no workers", () => {
    expect(spawnBlobChannel("1+1")).toBeNull();
  });
});
