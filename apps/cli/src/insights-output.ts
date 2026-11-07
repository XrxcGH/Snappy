/**
 * Saving an insight's file (a backup, a calendar file, a manifest). Files are written only when the
 * person passed an explicit output flag, and an existing file is never replaced without --force.
 */
import { CliError, fsError } from "./errors.ts";
import type { Io } from "./io.ts";
import { atomicWrite } from "./ledger-store.ts";

export interface SaveOptions {
  /** The flag the path came from, like "--out". Used in messages. */
  option: string;
  /** Required ending including the dot, like ".ics", so the wrong file is not replaced by a typo. */
  extension: string;
  /** True when the person passed --force. */
  force: boolean;
}

async function exists(io: Pick<Io, "fs">, path: string): Promise<boolean> {
  try {
    await io.fs.stat(path);
    return true;
  } catch (e) {
    if (typeof e === "object" && e !== null && "code" in e && (e as { code: unknown }).code === "ENOENT") return false;
    throw fsError(e, "check", path);
  }
}

/** Check the name before any work is done, so a wrong name stops the run early. */
export async function checkOutputPath(io: Pick<Io, "fs">, path: string, opts: SaveOptions): Promise<void> {
  if (!path.toLowerCase().endsWith(opts.extension)) {
    throw new CliError("usage", `${opts.option} needs a file name ending in ${opts.extension}, so no other file is replaced.`);
  }
  if (!opts.force && (await exists(io, path))) {
    throw new CliError("exists", `"${path}" already exists, so Snappy did not replace it. Choose another name, or add --force.`);
  }
}

/** Write the text to the file, creating folders as needed. Run checkOutputPath first. */
export async function saveInsightFile(io: Pick<Io, "fs">, path: string, text: string, opts: SaveOptions): Promise<void> {
  await checkOutputPath(io, path, opts);
  await atomicWrite(io, path, new TextEncoder().encode(text));
}
