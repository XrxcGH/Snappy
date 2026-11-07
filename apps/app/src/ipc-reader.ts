/**
 * A RandomAccessReader (the interface core's zip reader asks for) backed by the shell's read-only
 * `read_range` command. This is the FALLBACK reader: on desktop the dashboard reads with a plain
 * file input and its background worker, which needs no IPC at all and measured faster and
 * leaner. Use this one only on a platform whose file input cannot random-access a very large file.
 *
 * Nothing is ever read whole: a range is fetched in bounded chunks, so memory stays proportional
 * to the range core asks for, however big the zip is. The page never holds a path, only the opaque
 * id the shell gave it for a file the person chose in the shell's own dialog, and the command
 * has no way to write.
 */
import type { RandomAccessReader } from "@snappy-export/core";

/** Bytes per call. Each call crosses the IPC boundary, so this trades call count for peak memory. Must not exceed the shell's limit (16 MiB). */
export const CHUNK_BYTES = 4 * 1024 * 1024;

/** The shell's `invoke`, narrowed to what the reader uses (and fakeable in tests). */
export type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

export interface PickedFile {
  readonly id: string;
  readonly name: string;
  readonly size: number;
}

export interface IpcReader extends RandomAccessReader {
  /** Lets the shell release the file. Safe to call twice. */
  close(): Promise<void>;
  /** Number of read calls made (for measurements). */
  readonly stats: { calls: number; bytes: number };
}

/** Over the postMessage IPC the bytes come back as a plain array of numbers; over fetch IPC as an ArrayBuffer. */
const toBytes = (value: unknown): Uint8Array => {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (Array.isArray(value)) return Uint8Array.from(value as number[]);
  throw new TypeError("the shell returned something that is not bytes");
};

export function ipcReader(file: PickedFile, invoke: Invoke, chunkBytes = CHUNK_BYTES): IpcReader {
  const { id, size } = file;
  if (!Number.isSafeInteger(size) || size < 0) throw new RangeError("the file size is not usable");
  let closed = false;
  const stats = { calls: 0, bytes: 0 };

  return {
    size,
    stats,
    async read(start, end) {
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > size) {
        throw new RangeError("read range is outside the file");
      }
      if (closed) throw new Error("the file is closed");
      const out = new Uint8Array(end - start);
      let got = 0;
      while (got < out.length) {
        const length = Math.min(chunkBytes, out.length - got);
        const bytes = toBytes(await invoke("read_range", { id, offset: start + got, length }));
        stats.calls++;
        if (bytes.length !== length) throw new RangeError("the file ended before the requested range");
        out.set(bytes, got);
        got += length;
        stats.bytes += length;
      }
      return out;
    },
    async close() {
      if (closed) return;
      closed = true;
      await invoke("close_file", { id });
    },
  };
}
