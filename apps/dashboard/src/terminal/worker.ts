/**
 * Entry point of the command helper. build.mjs bundles it to text, and the page starts it from a
 * blob: URL, one helper for each Run. It inherits the page's security policy (connect-src 'none'),
 * so it cannot reach the network; the downloader is not even in its code.
 *
 * The helper takes one run request, checks the argument list again with the same policy the page
 * used, builds the command's Io from the virtual file system, runs the command, and reports the
 * output, the files that were saved and the exit code. A passphrase arrives once, in one message,
 * and is handed straight to the command: it is never written into the output or kept.
 */
import { CLI_VERSION, CliError, runCli } from "./cli-api.ts";
import { checkArgv } from "./policy.ts";
import { parseToWorker } from "./protocol.ts";
import type { FromWorker, RunRequest } from "./protocol.ts";
import { scrubScope } from "./scrub.ts";
import { createVfs } from "./vfs.ts";
import type { OutFile, StoreBridge } from "./vfs.ts";
import { createWebLock } from "./web-lock.ts";
import type { LockManagerLike } from "./web-lock.ts";
import { createWorkerIo } from "./worker-io.ts";

export interface HelperHost {
  post(message: FromWorker, transfer?: Transferable[]): void;
  /** navigator.locks, when the browser has it. */
  locks?: LockManagerLike;
  /** Test hooks: replace the clock, the id source and the output timer. */
  now?: () => number;
  randomId?: () => string;
  schedule?: (fn: () => void, ms: number) => () => void;
}

/** What the helper does with one message from the page. */
export type HelperHandler = (message: unknown) => void;

/** A copy of any file bytes that are a view into a bigger buffer, so what moves is exactly the file. */
function transferable(files: OutFile[]): { files: OutFile[]; transfer: Transferable[] } {
  const transfer = new Set<ArrayBuffer>();
  const out = files.map((f) => {
    const whole = f.bytes.byteOffset === 0 && f.bytes.byteLength === f.bytes.buffer.byteLength;
    const bytes = whole ? f.bytes : f.bytes.slice();
    if (bytes.buffer instanceof ArrayBuffer) transfer.add(bytes.buffer);
    return { path: f.path, bytes, mtimeMs: f.mtimeMs };
  });
  return { files: out, transfer: [...transfer] };
}

export function createHelper(host: HelperHost): HelperHandler {
  let started = false;
  let exited = false;
  const abort = new AbortController();
  let nextId = 1;
  const secrets = new Map<number, (value: string | null) => void>();
  const stores = new Map<number, { resolve: (bytes: Uint8Array | null | undefined) => void; reject: (code: "EACCES" | "EIO") => void }>();

  const send = (message: FromWorker, transfer?: Transferable[]): void => {
    if (!exited) host.post(message, transfer);
  };

  /** The saved history, through the page. The page decides what may be read and written. */
  const store: StoreBridge = {
    read: () =>
      new Promise<Uint8Array | null>((resolve, reject) => {
        const id = nextId++;
        stores.set(id, { resolve: (bytes) => resolve(bytes ?? null), reject: (code) => reject(Object.assign(new Error(code), { code })) });
        send({ type: "store-read", id });
      }),
    write: (bytes) =>
      new Promise<void>((resolve, reject) => {
        const id = nextId++;
        stores.set(id, { resolve: () => resolve(), reject: (code) => reject(Object.assign(new Error(code), { code })) });
        send({ type: "store-write", id, bytes });
      }),
  };

  const askSecret = (question: string): Promise<string | null> =>
    new Promise((resolve) => {
      const id = nextId++;
      secrets.set(id, resolve);
      send({ type: "ask-secret", id, question });
    });

  async function run(request: RunRequest): Promise<void> {
    const checked = checkArgv(request.argv);
    if (!checked.ok) {
      send({ type: "out", text: "Snappy cannot run that here.\n" });
      send({ type: "exit", code: 1 });
      exited = true;
      return;
    }
    const vfs = createVfs({ files: request.files, outCap: request.outCap, signal: abort.signal, store });
    const { io, flush } = createWorkerIo({
      vfs,
      lock: createWebLock(host.locks),
      columns: request.columns,
      coarse: request.coarse,
      signal: abort.signal,
      sendOut: (text) => send({ type: "out", text }),
      askSecret,
      schedule: host.schedule,
      now: host.now,
      randomId: host.randomId,
    });
    let code = 1;
    try {
      code = await runCli(request.argv, io, { version: request.version ?? CLI_VERSION });
    } catch (e) {
      code = e instanceof CliError ? e.exitCode : 1;
    }
    flush();
    const saved = vfs.collectOut();
    if (saved.length > 0) {
      const { files, transfer } = transferable(saved);
      send({ type: "files", files }, transfer);
    }
    send({ type: "exit", code });
    exited = true;
  }

  return (raw) => {
    const message = parseToWorker(raw);
    if (message === null) return;
    switch (message.type) {
      case "run":
        // One helper is one Run: a second request is ignored.
        if (started) return;
        started = true;
        void run(message);
        return;
      case "secret": {
        const resolve = secrets.get(message.id);
        secrets.delete(message.id);
        resolve?.(message.value);
        return;
      }
      case "store-reply": {
        const pending = stores.get(message.id);
        stores.delete(message.id);
        if (pending === undefined) return;
        if (message.ok) pending.resolve(message.bytes);
        else pending.reject(message.code ?? "EACCES");
        return;
      }
      case "cancel":
        abort.abort();
        // A question nobody will answer is answered for them: canceled.
        for (const [id, resolve] of secrets) {
          secrets.delete(id);
          resolve(null);
        }
        return;
    }
  };
}

interface Scope {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
  navigator?: object & { locks?: LockManagerLike };
}

/** Starts the helper on the worker's own global scope. */
export function installHelper(scope: Scope): void {
  // First of all, before any command code runs.
  scrubScope(scope, scope.navigator);
  const handle = createHelper({
    post: (message, transfer) => scope.postMessage(message, transfer ?? []),
    locks: scope.navigator?.locks,
  });
  scope.onmessage = (event) => handle(event.data);
}

// The worker bundle runs this on load. Under test (and on the page) there is no worker scope.
if (typeof (globalThis as { WorkerGlobalScope?: unknown }).WorkerGlobalScope === "function") installHelper(globalThis as unknown as Scope);
