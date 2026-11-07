/**
 * The export files the person picked for the command blocks. One list for the whole page, shared by
 * every block, kept in memory only: it is never saved, and it is gone when the page closes. The files
 * stay lazy Blobs, so nothing is read until a command asks for a byte range.
 */
import type { RunFile } from "./run-types.ts";

export interface PickedFiles {
  files(): readonly RunFile[];
  count(): number;
  /** Add the .zip files among `incoming`. Returns how many were added and how many were left out. */
  add(incoming: readonly (Blob & { name?: string; lastModified?: number })[]): { added: number; skipped: number };
  clear(): void;
  subscribe(listener: () => void): () => void;
}

const ZIP = /\.zip$/i;

export function createPickedFiles(): PickedFiles {
  let list: RunFile[] = [];
  const stamps = new Map<RunFile, string>();
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of [...listeners]) listener();
  };

  return {
    files: () => list,
    count: () => list.length,
    add(incoming) {
      let added = 0;
      let skipped = 0;
      const next = [...list];
      for (const file of incoming) {
        const name = typeof file.name === "string" ? file.name : "";
        if (!ZIP.test(name)) {
          skipped++;
          continue;
        }
        // The same file chosen twice is one file.
        const stamp = `${name}\0${file.size}\0${file.lastModified ?? 0}`;
        if ([...stamps.values()].includes(stamp)) {
          skipped++;
          continue;
        }
        const entry: RunFile = { name, blob: file };
        stamps.set(entry, stamp);
        next.push(entry);
        added++;
      }
      if (added > 0) {
        list = next;
        notify();
      }
      return { added, skipped };
    },
    clear() {
      if (list.length === 0) return;
      list = [];
      stamps.clear();
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
