/**
 * A ZIP archive that exists only as a reader: the headers and the small JSON files are real bytes,
 * the photos and videos are a stretch of zeros that is never stored. It lets the import checks
 * build a multi-gigabyte, tens-of-thousands-of-entries export in memory-light, run-time-only form.
 * Entries are stored (method 0). Nothing here touches the disk, the network or the clock.
 */
import { crc32 } from "../../packages/core/src/index.ts";
import type { RandomAccessReader } from "../../packages/core/src/index.ts";

export interface SparseEntry {
  name: string;
  /** Real content (a JSON file). Without it the entry is `size` bytes of zeros that are never held. */
  bytes?: Uint8Array;
  /** Size of a virtual entry. */
  size?: number;
  /** UTC modification time in epoch ms, written as an extended-timestamp field. */
  utcMs?: number;
  /** Where the time is written: both headers (the usual), the central directory only, or the local header only. Default "both". */
  utcIn?: "both" | "central" | "local";
}

type Segment = { start: number; end: number; bytes?: Uint8Array };

const text = new TextEncoder();

function u16(v: number): number[] {
  return [v & 0xff, (v >> 8) & 0xff];
}
function u32(v: number): number[] {
  return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
}

const DOS_DATE = ((2024 - 1980) << 9) | (1 << 5) | 1;

/** Build the reader. Throws when the archive would need zip64 (more than 4 GiB, or 65,535 entries). */
export function sparseZip(entries: SparseEntry[]): RandomAccessReader {
  if (entries.length > 0xfffe) throw new RangeError("a sparse part holds at most 65534 entries");
  const segments: Segment[] = [];
  const central: number[][] = [];
  let at = 0;
  const push = (bytes: Uint8Array | number[]): void => {
    const b = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
    segments.push({ start: at, end: at + b.length, bytes: b });
    at += b.length;
  };

  for (const e of entries) {
    const name = text.encode(e.name);
    const size = e.bytes?.length ?? e.size ?? 0;
    const crc = e.bytes === undefined ? 0 : crc32(e.bytes);
    const extra = e.utcMs === undefined ? [] : [...u16(0x5455), ...u16(5), 1, ...u32(Math.floor(e.utcMs / 1000))];
    const where = e.utcIn ?? "both";
    const localExtra = where === "central" ? [] : extra;
    const centralExtra = where === "local" ? [] : extra;
    const offset = at;
    push([...u32(0x04034b50), ...u16(20), ...u16(0x800), ...u16(0), ...u16(0), ...u16(DOS_DATE), ...u32(crc), ...u32(size), ...u32(size), ...u16(name.length), ...u16(localExtra.length), ...name, ...localExtra]);
    if (e.bytes !== undefined) push(e.bytes);
    else if (size > 0) segments.push({ start: at, end: at + size });
    at += e.bytes === undefined ? size : 0;
    if (at > 0xfffffffe) throw new RangeError("a sparse part holds at most 4 GiB");
    central.push([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x800), ...u16(0), ...u16(0), ...u16(DOS_DATE), ...u32(crc), ...u32(size), ...u32(size), ...u16(name.length), ...u16(centralExtra.length), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...name, ...centralExtra]);
  }
  const directoryStart = at;
  for (const record of central) push(record);
  const directorySize = at - directoryStart;
  push([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(entries.length), ...u16(entries.length), ...u32(directorySize), ...u32(directoryStart), ...u16(0)]);

  const total = at;
  return {
    size: total,
    read(start: number, end: number): Promise<Uint8Array> {
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > total) {
        return Promise.reject(new RangeError("read range is outside the archive"));
      }
      const out = new Uint8Array(end - start);
      // First segment that ends after `start` (segments are in order and do not overlap).
      let lo = 0;
      let hi = segments.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if ((segments[mid] as Segment).end <= start) lo = mid + 1;
        else hi = mid;
      }
      for (let i = lo; i < segments.length; i++) {
        const s = segments[i] as Segment;
        if (s.start >= end) break;
        if (s.bytes !== undefined) {
          const from = Math.max(start, s.start);
          const to = Math.min(end, s.end);
          out.set(s.bytes.subarray(from - s.start, to - s.start), from - start);
        }
      }
      return Promise.resolve(out);
    },
  };
}
