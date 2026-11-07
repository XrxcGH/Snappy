/**
 * Adapts a shell-backed reader to what the dashboard's import pipeline takes: a "Blob" with a name
 * and a size, of which the pipeline uses only `size`, `name` and `slice(start, end).arrayBuffer()`.
 * That is the whole surface (see apps/dashboard/src/blob-reader.ts). The facade is not a real
 * Blob, so it cannot be posted to the background worker (the shell's IPC is not available there):
 * the runner below reads on the page, in bounded chunks, and the page still gets its turns through
 * the pipeline's yield hook. Only used by the fallback reader (see entry-native-reader.ts); the runner is in native-import.ts.
 */
import type { NamedBlob } from "../../dashboard/src/actions.ts";
import { ipcReader } from "./ipc-reader.ts";
import type { Invoke, IpcReader, PickedFile } from "./ipc-reader.ts";

export interface NativeZip extends NamedBlob {
  readonly reader: IpcReader;
}

export function nativeZip(file: PickedFile, invoke: Invoke): NativeZip {
  const reader = ipcReader(file, invoke);
  const facade = {
    name: file.name,
    size: reader.size,
    type: "application/zip",
    reader,
    slice(start = 0, end = reader.size) {
      return { arrayBuffer: async () => (await reader.read(start, end)).buffer };
    },
  };
  return facade as unknown as NativeZip;
}
