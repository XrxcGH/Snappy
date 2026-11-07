import type { RandomAccessReader } from "@snappy-export/core";

/**
 * Random-access reader over a File or Blob. Only the requested byte range is ever loaded
 * (Blob.slice is lazy), so a multi-gigabyte export part is never read into memory whole,
 * and the media inside it is never touched.
 */
export function blobReader(blob: Blob): RandomAccessReader {
  return {
    size: blob.size,
    async read(start, end) {
      return new Uint8Array(await blob.slice(start, end).arrayBuffer());
    },
  };
}
