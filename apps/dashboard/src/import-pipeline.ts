/**
 * Reads the zip parts of an export from Blobs and returns one merged result. Only ranges of each
 * file are ever loaded (Blob.slice is lazy): the zip directory, then the compressed bytes of the
 * few JSON files Snappy uses. Core streams the chat and Snap histories, so memory stays flat and
 * message text is never decoded; media inside the zips is never requested.
 *
 * This module does the same work on the page (as a fallback) and inside the background worker.
 * Progress is the share of those compressed JSON bytes already read, a real percentage.
 */
import { listZipEntries, mergeParsedExports, parseExportFromReader } from "@snappy-export/core";
import type { ParsedExport, RandomAccessReader, ZipEntryInfo } from "@snappy-export/core";
import { blobReader } from "./blob-reader.ts";

export interface ImportProgress {
  /** Parts fully read so far (0-based index of the part being read). */
  step: number;
  steps: number;
  /** Share of the bytes to read that are done, 0..1. Null when there is nothing measurable to read. */
  fraction: number | null;
}

/** The import was stopped by the person. Not a failure: nothing was read into the history. */
export class ImportCanceled extends Error {
  constructor() {
    super("The import was stopped.");
    this.name = "ImportCanceled";
  }
}

export interface ImportHooks {
  onProgress(progress: ImportProgress): void;
  /** Aborted when the person presses Cancel. A reader that sees it stops at the next read and rejects with ImportCanceled. */
  signal?: AbortSignal;
  /** Lets the page paint. Called between reads, at most every 40 ms, so work on the page stays responsive. */
  yieldToUi(): Promise<void>;
  /** Clock in ms, replaceable under test. */
  now?: () => number;
}

/** Reads the parts, given in export order, and returns the merged export. Rejects when a part cannot be read at all. */
export type ImportRunner = (blobs: readonly Blob[], hooks: ImportHooks) => Promise<ParsedExport>;

/** The only files Snappy opens (by lower-case name; the shallowest one of each wins, as in core). */
const DATA_FILES = new Set(["friends.json", "chat_history.json", "snap_history.json", "memories_history.json"]);

/** How long work may run before the page gets a turn. A few frames' worth. */
const YIELD_AFTER_MS = 40;

/** Slack for the local header that sits in front of an entry's compressed bytes. */
const HEADER_SLACK = 512;

interface Range {
  start: number;
  end: number;
}

interface Plan {
  ranges: Range[];
  /** Compressed bytes of the files in `ranges`. */
  bytes: number;
}

const depthOf = (name: string): number => name.split("/").length;
const baseOf = (name: string): string => (name.split("/").pop() ?? "").toLowerCase();

/** Where the compressed bytes of the data files sit in one part, from its directory listing. */
function planOf(entries: readonly ZipEntryInfo[]): Plan {
  const chosen = new Map<string, ZipEntryInfo>();
  for (const e of entries) {
    const base = baseOf(e.name);
    if (!DATA_FILES.has(base) || !Number.isFinite(e.compressedSize) || !Number.isFinite(e.localHeaderOffset)) continue;
    const cur = chosen.get(base);
    if (!cur || depthOf(e.name) < depthOf(cur.name) || (depthOf(e.name) === depthOf(cur.name) && e.name < cur.name)) chosen.set(base, e);
  }
  const picked = [...chosen.values()];
  return {
    ranges: picked.map((e) => ({ start: e.localHeaderOffset, end: e.localHeaderOffset + e.compressedSize + HEADER_SLACK })),
    bytes: picked.reduce((n, e) => n + e.compressedSize, 0),
  };
}

const overlap = (start: number, end: number, r: Range): number => Math.max(0, Math.min(end, r.end) - Math.max(start, r.start));

/** The most the bar shows before the last part is parsed: reading the bytes is not the whole job. */
const MOST_WHILE_READING = 0.99;

export const runImport: ImportRunner = async (blobs, hooks) => {
  const now = hooks.now ?? ((): number => performance.now());
  const readers = blobs.map(blobReader);

  // Measure first, so the bar can show a true percentage of the work. A damaged part lists as empty.
  const plans: Plan[] = [];
  const stopIfAsked = (): void => {
    if (hooks.signal?.aborted === true) throw new ImportCanceled();
  };
  for (const reader of readers) {
    stopIfAsked();
    plans.push(planOf((await listZipEntries(reader)).entries));
  }
  const total = plans.reduce((n, p) => n + p.bytes, 0);

  let done = 0;
  let step = 0;
  let lastPercent = -1;
  let lastYield = now();
  const report = (force: boolean): void => {
    // Every byte can be read while the last part is still being parsed, so 100% is kept for the end.
    const fraction = total > 0 ? Math.min(step < readers.length ? MOST_WHILE_READING : 1, done / total) : null;
    const percent = fraction === null ? -1 : Math.floor(fraction * 100);
    if (!force && percent === lastPercent) return;
    lastPercent = percent;
    hooks.onProgress({ step, steps: readers.length, fraction });
  };

  const tracked = (inner: RandomAccessReader, plan: Plan): RandomAccessReader => ({
    size: inner.size,
    async read(start, end) {
      stopIfAsked();
      if (now() - lastYield >= YIELD_AFTER_MS) {
        await hooks.yieldToUi();
        lastYield = now();
      }
      const bytes = await inner.read(start, end);
      for (const r of plan.ranges) done += overlap(start, end, r);
      report(false);
      return bytes;
    },
  });

  const parts: ParsedExport[] = [];
  for (const [index, reader] of readers.entries()) {
    stopIfAsked();
    step = index;
    report(true);
    parts.push(await parseExportFromReader(tracked(reader, plans[index] as Plan), { part: index + 1 }));
  }
  // The parser turns a read that was cut off into a note about a damaged file, so a stop has to be checked here too.
  stopIfAsked();
  step = readers.length;
  done = total;
  report(true);
  // One part is already whole; merging would only copy it.
  return parts.length === 1 ? (parts[0] as ParsedExport) : mergeParsedExports(parts);
};
