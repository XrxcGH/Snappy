/**
 * What the page and the command helper say to each other. Plain data only: no functions, no
 * classes. The page never trusts a message's shape, so every message from the helper goes through
 * parseFromWorker, and the helper checks the page's through parseToWorker. A message that does not
 * fit is dropped. No message ever carries a path from the person's disk.
 */
import type { OutFile } from "./vfs.ts";

export type { OutFile } from "./vfs.ts";

/** A file the person picked, as the helper receives it: the lazy Blob and the name it will have under /in. */
export interface RunFile {
  name: string;
  blob: Blob;
}

export interface RunRequest {
  type: "run";
  runId: string;
  argv: string[];
  files: RunFile[];
  /** How many characters wide the output panel is. */
  columns: number;
  /** A touch device: smaller memory limits. */
  coarse: boolean;
  /** Most bytes the virtual output folder may hold. */
  outCap: number;
}

export type ToWorker =
  | RunRequest
  /** The answer to a passphrase question; null means the person canceled. */
  | { type: "secret"; id: number; value: string | null }
  | { type: "cancel" }
  /** The page's answer to a saved-history request. `bytes` is set for a read (null when nothing is saved). */
  | { type: "store-reply"; id: number; ok: boolean; bytes?: Uint8Array | null; code?: "EACCES" | "EIO" };

export type FromWorker =
  | { type: "out"; text: string }
  | { type: "ask-secret"; id: number; question: string }
  | { type: "store-read"; id: number }
  | { type: "store-write"; id: number; bytes: Uint8Array }
  | { type: "files"; files: OutFile[] }
  | { type: "exit"; code: number };

/** The most text one output message may carry. */
export const MAX_OUT_TEXT = 1024 * 1024;
const MAX_QUESTION = 400;
const MAX_SECRET = 4096;
const MAX_FILES = 200_000;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const isBytes = (v: unknown): v is Uint8Array => v instanceof Uint8Array;

function parseOutFile(v: unknown): OutFile | null {
  if (!isRecord(v)) return null;
  const { path, bytes, mtimeMs } = v;
  if (typeof path !== "string" || path === "" || path.length > 4096 || path.includes("\0") || path.startsWith("/") || path.split("/").includes("..")) return null;
  if (!isBytes(bytes) || typeof mtimeMs !== "number" || !Number.isFinite(mtimeMs)) return null;
  return { path, bytes, mtimeMs };
}

/** Check one message from the helper. Anything unexpected gives null. */
export function parseFromWorker(message: unknown): FromWorker | null {
  if (!isRecord(message)) return null;
  switch (message.type) {
    case "out":
      return typeof message.text === "string" && message.text.length <= MAX_OUT_TEXT ? { type: "out", text: message.text } : null;
    case "ask-secret":
      return isId(message.id) && typeof message.question === "string" && message.question.length <= MAX_QUESTION ? { type: "ask-secret", id: message.id, question: message.question } : null;
    case "store-read":
      return isId(message.id) ? { type: "store-read", id: message.id } : null;
    case "store-write":
      return isId(message.id) && isBytes(message.bytes) ? { type: "store-write", id: message.id, bytes: message.bytes } : null;
    case "files": {
      if (!Array.isArray(message.files) || message.files.length > MAX_FILES) return null;
      const files: OutFile[] = [];
      for (const raw of message.files) {
        const file = parseOutFile(raw);
        if (file === null) return null;
        files.push(file);
      }
      return { type: "files", files };
    }
    case "exit":
      return typeof message.code === "number" && Number.isInteger(message.code) && message.code >= 0 && message.code <= 255 ? { type: "exit", code: message.code } : null;
    default:
      return null;
  }
}

/** Check one message from the page. Anything unexpected gives null. */
export function parseToWorker(message: unknown): ToWorker | null {
  if (!isRecord(message)) return null;
  switch (message.type) {
    case "run": {
      const { runId, argv, files, columns, coarse, outCap } = message;
      if (typeof runId !== "string" || runId.length > 100) return null;
      if (!Array.isArray(argv) || !argv.every((a) => typeof a === "string")) return null;
      if (!Array.isArray(files)) return null;
      const runFiles: RunFile[] = [];
      for (const f of files) {
        if (!isRecord(f) || typeof f.name !== "string" || !(f.blob instanceof Blob)) return null;
        runFiles.push({ name: f.name, blob: f.blob });
      }
      if (typeof columns !== "number" || !Number.isInteger(columns) || columns < 20 || columns > 400) return null;
      if (typeof coarse !== "boolean") return null;
      if (typeof outCap !== "number" || !Number.isSafeInteger(outCap) || outCap < 0) return null;
      return { type: "run", runId, argv: [...argv] as string[], files: runFiles, columns, coarse, outCap };
    }
    case "secret":
      if (!isId(message.id)) return null;
      if (message.value === null) return { type: "secret", id: message.id, value: null };
      return typeof message.value === "string" && message.value.length <= MAX_SECRET ? { type: "secret", id: message.id, value: message.value } : null;
    case "cancel":
      return { type: "cancel" };
    case "store-reply": {
      if (!isId(message.id) || typeof message.ok !== "boolean") return null;
      const bytes = message.bytes === undefined || message.bytes === null || isBytes(message.bytes) ? message.bytes : "bad";
      if (bytes === "bad") return null;
      const code = message.code === "EACCES" || message.code === "EIO" ? message.code : undefined;
      return { type: "store-reply", id: message.id, ok: message.ok, bytes, code };
    }
    default:
      return null;
  }
}
