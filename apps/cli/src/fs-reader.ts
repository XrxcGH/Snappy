/**
 * A RandomAccessReader over a file, opened through the file system port. It answers exactly the
 * byte ranges core asks for (the end record, the central directory, the few entries being opened),
 * so a multi-GB export zip is never loaded whole and its media bytes are never touched.
 */
import { fsError } from "./errors.ts";
import type { Io } from "./io.ts";
import type { FsReadHandle } from "./ports.ts";

export type FileReader = FsReadHandle;

export async function openFileReader(io: Pick<Io, "fs">, path: string): Promise<FileReader> {
  try {
    return await io.fs.openRead(path);
  } catch (e) {
    throw fsError(e, "open", path);
  }
}
