/**
 * Import runner of the fallback reader. Real browser files (a file input, a drop) go to the
 * background worker exactly as on the web. Shell-backed zips (see native-zip.ts) are read on the
 * page, in bounded chunks. Files are released whether the import worked or not.
 */
import { browserImport } from "../../dashboard/src/browser-import.ts";
import { runImport } from "../../dashboard/src/import-pipeline.ts";
import type { ImportRunner } from "../../dashboard/src/import-pipeline.ts";
import type { NativeZip } from "./native-zip.ts";

const isNative = (blob: Blob): blob is NativeZip => "reader" in blob;

export const nativeImport: ImportRunner = async (blobs, hooks) => {
  if (!blobs.some(isNative)) return browserImport(blobs, hooks);
  try {
    return await runImport(blobs, hooks);
  } finally {
    await Promise.all(blobs.filter(isNative).map((b) => b.reader.close().catch(() => undefined)));
  }
};
