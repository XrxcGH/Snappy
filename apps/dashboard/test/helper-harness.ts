/**
 * Plays the page for the command helper in a test: it sends the run request, answers passphrase
 * questions and saved-history requests, and collects what the helper reports. Every message crosses
 * a structured clone in both directions, as it does between a page and a real worker.
 */
import { createHelper } from "../src/terminal/worker.ts";
import type { LockManagerLike } from "../src/terminal/web-lock.ts";
import type { FromWorker, OutFile, RunFile, ToWorker } from "../src/terminal/protocol.ts";
import { parseFromWorker } from "../src/terminal/protocol.ts";

export interface HarnessOptions {
  files?: RunFile[];
  /** Answers to passphrase questions, in order. null cancels. A function answers each question itself. */
  answers?: (string | null)[] | ((question: string) => string | null);
  /** The saved history on the page's side. Writes replace it unless `refuseWrites` is set. */
  store?: { bytes: Uint8Array | null; refuseWrites?: boolean; refuseReads?: boolean };
  now?: () => number;
  columns?: number;
  outCap?: number;
  coarse?: boolean;
  locks?: LockManagerLike;
  /** Called once with a function that sends a message to the helper, before the run request. */
  beforeRun?: (send: (to: ToWorker) => void) => void;
  /** Called with each message from the helper, before it is answered. */
  onMessage?: (message: FromWorker, send: (to: ToWorker) => void) => void;
}

export interface HarnessResult {
  out: string;
  code: number;
  files: OutFile[];
  messages: FromWorker[];
  questions: string[];
  store: { bytes: Uint8Array | null };
  /** How many exit messages arrived (it must be one). */
  exits: number;
}

export function runInHelper(argv: string[], options: HarnessOptions = {}): Promise<HarnessResult> {
  const store = { bytes: options.store?.bytes ?? null };
  const messages: FromWorker[] = [];
  const questions: string[] = [];
  const answers = Array.isArray(options.answers) ? [...options.answers] : [];
  let out = "";
  let files: OutFile[] = [];
  let exits = 0;
  let nextTick = 0;

  return new Promise<HarnessResult>((resolve, reject) => {
    const helper = createHelper({
      now: options.now,
      randomId: (() => {
        let n = 0;
        return () => `id-${++n}`;
      })(),
      locks: options.locks,
      // The output timer fires on the next turn of the event loop, so nothing waits on a real clock.
      schedule: (fn) => {
        const id = setTimeout(fn, 0);
        nextTick++;
        return () => clearTimeout(id);
      },
      post: (raw) => {
        const message = parseFromWorker(structuredClone(raw));
        if (message === null) return reject(new Error("the helper sent a message the page would drop"));
        messages.push(message);
        const send = (to: ToWorker): void => helper(structuredClone(to));
        options.onMessage?.(message, send);
        switch (message.type) {
          case "out":
            out += message.text;
            break;
          case "files":
            files = message.files;
            break;
          case "ask-secret": {
            questions.push(message.question);
            const answer = typeof options.answers === "function" ? options.answers(message.question) : (answers.shift() ?? null);
            send({ type: "secret", id: message.id, value: answer });
            break;
          }
          case "store-read":
            send(options.store?.refuseReads ? { type: "store-reply", id: message.id, ok: false, code: "EACCES" } : { type: "store-reply", id: message.id, ok: true, bytes: store.bytes });
            break;
          case "store-write":
            if (options.store?.refuseWrites) send({ type: "store-reply", id: message.id, ok: false, code: "EACCES" });
            else {
              store.bytes = message.bytes;
              send({ type: "store-reply", id: message.id, ok: true });
            }
            break;
          case "exit":
            exits++;
            // Anything the helper still sends after this would show up in `messages`.
            setTimeout(() => resolve({ out, code: message.code, files, messages, questions, store, exits }), 5);
            break;
        }
      },
    });
    void nextTick;
    options.beforeRun?.((to) => helper(structuredClone(to)));
    // The run request goes as it is: a Blob is passed by reference between a page and a worker anyway.
    helper({
      type: "run",
      runId: "test-run",
      argv,
      files: options.files ?? [],
      columns: options.columns ?? 80,
      coarse: options.coarse ?? false,
      outCap: options.outCap ?? 256 * 1024 * 1024,
    } satisfies ToWorker);
  });
}
