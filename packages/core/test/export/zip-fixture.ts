/**
 * A tiny zip writer for tests that need control fflate does not give: the extended-timestamp
 * extra field (a UTC mtime) or a chosen DOS time, per entry. Entries are stored, never compressed.
 * Everything built here is synthetic.
 */
import { crc32 } from "../../src/export/crc32.ts";

export interface FixtureEntry {
  name: string;
  data?: Uint8Array;
  /** UTC mtime in epoch ms, written as an extended-timestamp field (0x5455) in the local and central headers. */
  utcMs?: number;
  /** DOS wall-clock time (as epoch ms read as UTC). Defaults to 2020-01-01 00:00:00. */
  dosMs?: number;
  /** With utcMs: write the extended-timestamp field in the local header only (some zippers do), not in the central directory. */
  utcInLocalOnly?: boolean;
  /** UTC mtime in epoch ms, written as an NTFS extra field (0x000a, what 7-Zip stores) in both headers. */
  ntfsMs?: number;
}

class Bytes {
  private out: number[] = [];
  get length(): number {
    return this.out.length;
  }
  u16(v: number): this {
    this.out.push(v & 0xff, (v >> 8) & 0xff);
    return this;
  }
  u32(v: number): this {
    this.out.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
    return this;
  }
  raw(b: Uint8Array): this {
    for (const x of b) this.out.push(x);
    return this;
  }
  take(): Uint8Array {
    return Uint8Array.from(this.out);
  }
}

const utf8 = new TextEncoder();

function dosFields(ms: number): { time: number; date: number } {
  const d = new Date(ms);
  return {
    time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1),
    date: ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
  };
}

export function buildFixtureZip(entries: FixtureEntry[]): Uint8Array {
  const body = new Bytes();
  const central = new Bytes();
  for (const e of entries) {
    const name = utf8.encode(e.name);
    const data = e.data ?? new Uint8Array(0);
    const { time, date } = dosFields(e.dosMs ?? Date.UTC(2020, 0, 1));
    const extra = new Bytes();
    if (e.utcMs !== undefined) extra.u16(0x5455).u16(5).raw(Uint8Array.of(1)).u32(Math.floor(e.utcMs / 1000));
    if (e.ntfsMs !== undefined) {
      // Reserved word, then one attribute (tag 1, 24 bytes): modified, accessed, created as FILETIMEs (100 ns since 1601).
      const filetime = (BigInt(e.ntfsMs) + 11_644_473_600_000n) * 10_000n;
      const low = Number(filetime & 0xffffffffn);
      const high = Number(filetime >> 32n);
      extra.u16(0x000a).u16(32).u32(0).u16(1).u16(24);
      for (let k = 0; k < 3; k++) extra.u32(low).u32(high);
    }
    const extraBytes = extra.take();
    const centralExtraBytes = e.utcInLocalOnly === true ? new Uint8Array(0) : extraBytes;
    const crc = crc32(data);
    const offset = body.length;
    body.u32(0x04034b50).u16(20).u16(0x800).u16(0).u16(time).u16(date).u32(crc).u32(data.length).u32(data.length).u16(name.length).u16(extraBytes.length).raw(name).raw(extraBytes).raw(data);
    central
      .u32(0x02014b50).u16(20).u16(20).u16(0x800).u16(0).u16(time).u16(date).u32(crc).u32(data.length).u32(data.length)
      .u16(name.length).u16(centralExtraBytes.length).u16(0).u16(0).u16(0).u32(0).u32(offset)
      .raw(name).raw(centralExtraBytes);
  }
  const directory = central.take();
  const end = new Bytes().u32(0x06054b50).u16(0).u16(0).u16(entries.length).u16(entries.length).u32(directory.length).u32(body.length).u16(0);
  return new Bytes().raw(body.take()).raw(directory).raw(end.take()).take();
}
