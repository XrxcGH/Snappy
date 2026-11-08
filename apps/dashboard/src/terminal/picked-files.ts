/**
 * The export files the person picked for the command blocks. One list for the whole page, shared by
 * every block, kept in memory only: it is never saved, and it is gone when the page closes. The files
 * stay lazy Blobs, so nothing is read until a command asks for a byte range.
 *
 * The files of an export read on Start are added here too (marked "from Start"), so a command does not ask for the
 * same export again. A newer export read on Start replaces them, so commands never see parts of two exports at once.
 */
import type { RunFile } from "./run-types.ts";

export interface PickedFiles {
  files(): readonly RunFile[];
  count(): number;
  /** How many of the picked files came from Start (the export that was read there). */
  fromStart(): number;
  /**
   * Add the .zip files among `incoming`. Returns how many were added and how many were left out. Files from Start replace
   * the files that came from Start before; files the person chose in a command block are never replaced.
   */
  add(incoming: readonly (Blob & { name?: string; lastModified?: number })[], options?: { from?: "start" }): { added: number; skipped: number };
  clear(): void;
  subscribe(listener: () => void): () => void;
}

const ZIP = /\.zip$/i;

export function createPickedFiles(): PickedFiles {
  let list: RunFile[] = [];
  const stamps = new Map<RunFile, string>();
  const started = new Set<RunFile>();
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of [...listeners]) listener();
  };

  return {
    files: () => list,
    count: () => list.length,
    fromStart: () => started.size,
    add(incoming, options) {
      const fromStart = options?.from === "start";
      let added = 0;
      let skipped = 0;
      // The export read on Start before is replaced by the one read now.
      const dropped = fromStart ? list.filter((entry) => started.has(entry)) : [];
      const next = list.filter((entry) => !dropped.includes(entry));
      for (const entry of dropped) {
        stamps.delete(entry);
        started.delete(entry);
      }
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
        if (fromStart) started.add(entry);
        next.push(entry);
        added++;
      }
      if (added > 0 || dropped.length > 0) {
        list = next;
        notify();
      }
      return { added, skipped };
    },
    clear() {
      if (list.length === 0) return;
      list = [];
      stamps.clear();
      started.clear();
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
