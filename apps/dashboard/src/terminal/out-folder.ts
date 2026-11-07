/**
 * What a command saved in the virtual output folder, held in memory by the controller until the person
 * saves it. Two ways to save: a file at a time, or everything as one stored .zip. Nothing is written
 * anywhere else, and nothing is kept once the files are cleared.
 */
import { saveBlob } from "../download.ts";
import type { OutFile } from "./run-types.ts";
import { ZipTooBigError, buildZip } from "./zip-store.ts";

export interface OutSummary {
  files: number;
  bytes: number;
}

export function summarize(files: readonly OutFile[]): OutSummary {
  return { files: files.length, bytes: files.reduce((n, f) => n + f.bytes.length, 0) };
}

/** The last part of a path inside the folder: the name a saved file gets. */
export const fileNameOf = (path: string): string => path.split("/").pop() ?? path;

export type SaveResult = "saved" | "too-big" | "failed";

/** Save one file under its own name. */
export function saveFile(file: OutFile): SaveResult {
  return saveBlob(fileNameOf(file.path), new Blob([file.bytes as BlobPart])) ? "saved" : "failed";
}

/** Save everything as one .zip named for the folder. `now` stands in for a file that has no time. */
export function saveAll(files: readonly OutFile[], folderName: string, now: number): SaveResult {
  try {
    const zip = buildZip(files.map((f) => ({ path: f.path, bytes: f.bytes, mtimeMs: f.mtimeMs })), now);
    return saveBlob(`${folderName}.zip`, zip) ? "saved" : "failed";
  } catch (e) {
    return e instanceof ZipTooBigError ? "too-big" : "failed";
  }
}
