/**
 * A RandomAccessReader over a file handle. It answers exactly the byte ranges core asks for
 * (the end record, the central directory, the few entries being opened), so a multi-GB export
 * zip is never loaded whole and its media bytes are never touched.
 */
import { open } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import type { RandomAccessReader } from "@snappy-export/core";
import { fsError } from "./errors.ts";

export interface FileReader extends RandomAccessReader {
  close(): Promise<void>;
}

/** One positional read never asks the OS for more than this (some platforms reject >2 GiB). */
const MAX_READ = 64 * 1024 * 1024;

export async function openFileReader(path: string): Promise<FileReader> {
  let handle: FileHandle;
  try {
    handle = await open(path, "r");
  } catch (e) {
    throw fsError(e, "open", path);
  }

  let size: number;
  try {
    size = (await handle.stat()).size;
  } catch (e) {
    await handle.close().catch(() => undefined);
    throw fsError(e, "read", path);
  }

  return {
    size,
    async read(start, end) {
      const length = end - start;
      // A plain Uint8Array (never a pooled Buffer) so views over it can never alias other data.
      const out = new Uint8Array(length);
      let got = 0;
      while (got < length) {
        const { bytesRead } = await handle.read(out, got, Math.min(length - got, MAX_READ), start + got);
        if (bytesRead === 0) throw new RangeError("the file ended before the requested range");
        got += bytesRead;
      }
      return out;
    },
    close: () => handle.close().catch(() => undefined),
  };
}
