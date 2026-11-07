/**
 * Random-access zip reader: listing, opening single entries, parsing and describing archives
 * through a reader, and merging multi-part exports. Synthetic data only.
 *
 * The key property is proved with instrumented readers: every read is logged, and readers can be
 * told that a media entry's data range is off limits (they throw if it is requested).
 */
import { deflateSync, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  ZipEntryError,
  addLocalHeaderTimes,
  buildSyntheticExport,
  bytesReader,
  describeStructureFromReader,
  formatStructureReport,
  listZipEntries,
  mergeParsedExports,
  parseExportFromReader,
  readZipEntry,
  syntheticExportZip,
} from "../../src/index.ts";
import type { ParsedExport, RandomAccessReader, ZipEntryInfo } from "../../src/index.ts";
import { describeStructure, describeZipStructure } from "../../src/export/inspect.ts";
import { parseExportFiles, parseExportZip } from "../../src/export/parse.ts";
import { readZipDirectory } from "../../src/export/zip.ts";
import { crc32 } from "../../src/export/crc32.ts";
import { enc } from "./helpers.ts";

const NOW = Date.UTC(2025, 5, 1);
const FRIENDS = { Friends: [{ Username: "Alice" }, { Username: "bob" }], "Deleted Friends": [{ Username: "carl", Date: "2022-01-01 00:00:00 UTC" }] };
const CHATS = { alice: [{ From: "alice", "Media Type": "TEXT", Created: "2023-04-01 12:30:00 UTC", IsSender: false }] };
const MEMORIES = { "Saved Media": [{ Date: "2023-04-01 12:30:00 UTC", "Media Type": "Image", "Media Download Url": "https://example.invalid/x" }] };
const CANARY = "ZQCANARY-zipreader-7c1e";

// ------------------------------------------------------------------ helpers ---

type Range = [start: number, end: number];

/** Deterministic pseudo-random bytes (xorshift32): incompressible, so "media" stays big when deflated. */
function noise(seed: number, n: number): Uint8Array {
  const out = new Uint8Array(n);
  let x = seed | 0 || 1;
  for (let i = 0; i < n; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    out[i] = x & 0xff;
  }
  return out;
}

const concat = (parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

/** Logs every read; throws when a read touches a forbidden range (the data of a media entry). */
function trackingReader(bytes: Uint8Array, forbidden: Range[] = []): { reader: RandomAccessReader; reads: Range[] } {
  const inner = bytesReader(bytes);
  const reads: Range[] = [];
  return {
    reads,
    reader: {
      size: inner.size,
      read(start, end) {
        reads.push([start, end]);
        if (forbidden.some(([a, b]) => start < b && end > a)) throw new Error(`forbidden range read ${CANARY}`);
        return inner.read(start, end);
      },
    },
  };
}

const touching = (reads: Range[], ranges: Range[]): Range[] => reads.filter(([s, e]) => ranges.some(([a, b]) => s < b && e > a));

interface Scanned {
  name: string;
  method: number;
  /** Data range of the entry inside the zip, found independently of the code under test. */
  data: Range;
}

/** Walk a (non-zip64) zip's central directory and local headers by hand. */
function scan(zip: Uint8Array): Scanned[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const out: Scanned[] = [];
  for (let i = 0; i + 46 < zip.length; i++) {
    if (view.getUint32(i, true) !== 0x02014b50) continue;
    const nameLen = view.getUint16(i + 28, true);
    const local = view.getUint32(i + 42, true);
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    out.push({
      name: new TextDecoder().decode(zip.subarray(i + 46, i + 46 + nameLen)),
      method: view.getUint16(i + 10, true),
      data: [start, start + view.getUint32(i + 20, true)],
    });
  }
  return out;
}

/** Offset of the first central-directory record. */
function firstCentralRecord(zip: Uint8Array): number {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  for (let i = 0; i + 4 <= zip.length; i++) if (view.getUint32(i, true) === 0x02014b50) return i;
  throw new Error("no central directory record");
}

const isMediaName = (n: string): boolean => /\.(jpe?g|png|mp4|mov)$/i.test(n);
const mediaRanges = (zip: Uint8Array): Range[] => scan(zip).filter((e) => isMediaName(e.name) && e.data[1] > e.data[0]).map((e) => e.data);

type Files = Record<string, Uint8Array | [Uint8Array, { level?: 0 | 6; mtime?: Date }]>;
const zipFiles = (files: Files): Uint8Array => zipSync(files as Parameters<typeof zipSync>[0]);

/** An export-shaped zip whose media entries are big (stored and deflated) and carry a canary in their names. */
function mediaHeavyZip(): Uint8Array {
  return zipFiles({
    "json/friends.json": enc(FRIENDS),
    "json/chat_history.json": enc(CHATS),
    "json/memories_history.json": enc(MEMORIES),
    "json/account.json": enc({ "Basic Information": { Username: "demo_user" } }),
    "html/index.html": enc("<html><body><p>hello</p></body></html>"),
    "memories/2023-04-01_aaaaaaaa-0000-0000-0000-000000000001.jpg": [noise(1, 300_000), { level: 0 }],
    "memories/2023-04-02_aaaaaaaa-0000-0000-0000-000000000002.mp4": [noise(2, 300_000), { level: 6 }],
    [`chat_media/${CANARY}-photo.png`]: [new Uint8Array(400_000), { level: 6 }],
    "chat_media/clip.mov": [noise(3, 200_000), { level: 0 }],
  });
}

// ------------------------------------------------- hand-made (zip64) archives ---

/** Growable little-endian byte writer (hundreds of thousands of records must stay cheap to build). */
class Writer {
  private buf = new Uint8Array(1024);
  private view = new DataView(this.buf.buffer);
  length = 0;
  private room(n: number): void {
    if (this.length + n <= this.buf.length) return;
    const grown = new Uint8Array(Math.max(this.buf.length * 2, this.length + n));
    grown.set(this.buf.subarray(0, this.length));
    this.buf = grown;
    this.view = new DataView(grown.buffer);
  }
  u16(v: number): this { this.room(2); this.view.setUint16(this.length, v, true); this.length += 2; return this; }
  u32(v: number): this { this.room(4); this.view.setUint32(this.length, v, true); this.length += 4; return this; }
  u64(v: number): this { this.room(8); this.view.setBigUint64(this.length, BigInt(v), true); this.length += 8; return this; }
  bytes(b: Uint8Array): this { this.room(b.length); this.buf.set(b, this.length); this.length += b.length; return this; }
  take(): Uint8Array { return this.buf.slice(0, this.length); }
}
const u16 = (v: number): Uint8Array => new Writer().u16(v).take();
const u32 = (v: number): Uint8Array => new Writer().u32(v).take();

interface Spec {
  name: string;
  /** Real stored bytes (default empty). */
  data?: Uint8Array;
  /** Pretend this many data bytes follow the header, without materialising them. */
  virtualBytes?: number;
  /** Declared uncompressed size when it should differ from the data length. */
  size?: number;
  /** Declared CRC-32 when it should differ from the checksum of the data. */
  crc?: number;
  /** Raw DOS date and time fields (defaults: 1980-01-01 00:00:00). */
  dosDate?: number;
  dosTime?: number;
  /** Extra-field bytes appended to the central record / the local header. */
  centralExtra?: Uint8Array;
  localExtra?: Uint8Array;
}

interface Piece {
  pos: number;
  bytes: Uint8Array;
}

/**
 * Build a stored-entries zip from pieces at explicit offsets, optionally with zip64 structures.
 * Offsets may exceed 4 GiB when virtual bytes are used; such archives are served by pieceReader.
 * zip64: true writes zip64 extra fields on every entry and the zip64 end structures; "end-only" just the
 * end structures. The last pieces are, in order: directory, [zip64 record, locator,] end record.
 */
function buildZip(specs: Spec[], opts: { zip64?: boolean | "end-only"; comment?: Uint8Array } = {}): { pieces: Piece[]; size: number } {
  const SAT = 0xffffffff;
  const pieces: Piece[] = [];
  const central = new Writer();
  let body = new Writer();
  let bodyPos = 0; // offset of body's first byte
  const position = () => bodyPos + body.length;

  for (const s of specs) {
    const name = enc(s.name);
    const data = s.data ?? new Uint8Array(0);
    const stored = s.virtualBytes ?? data.length;
    const size = s.size ?? stored;
    const crc = s.crc ?? crc32(data);
    const offset = position();
    const localExtra = s.localExtra ?? new Uint8Array(0);
    body.u32(0x04034b50).u16(45).u16(0x800).u16(0).u16(s.dosTime ?? 0).u16(s.dosDate ?? 0x21).u32(crc).u32(Math.min(stored, SAT)).u32(Math.min(size, SAT)).u16(name.length).u16(localExtra.length).bytes(name).bytes(localExtra);
    if (s.virtualBytes !== undefined) {
      pieces.push({ pos: bodyPos, bytes: body.take() });
      bodyPos = position() + s.virtualBytes;
      body = new Writer();
    } else {
      body.bytes(data);
    }

    const wide = opts.zip64 === true || stored >= SAT || size >= SAT || offset >= SAT;
    const f = (v: number) => (wide ? SAT : v);
    const centralExtra = s.centralExtra ?? new Uint8Array(0);
    central.u32(0x02014b50).u16(45).u16(45).u16(0x800).u16(0).u16(s.dosTime ?? 0).u16(s.dosDate ?? 0x21).u32(crc).u32(f(stored)).u32(f(size));
    central.u16(name.length).u16((wide ? 28 : 0) + centralExtra.length).u16(0).u16(0).u16(0).u32(0).u32(f(offset)).bytes(name);
    if (wide) central.u16(1).u16(24).u64(size).u64(stored).u64(offset);
    central.bytes(centralExtra);
  }
  pieces.push({ pos: bodyPos, bytes: body.take() });
  let pos = position();
  const cdPos = pos;
  const cd = central.take();
  pieces.push({ pos, bytes: cd });
  pos += cd.length;

  const zip64 = opts.zip64 === true || opts.zip64 === "end-only" || cdPos >= SAT || specs.length >= 0xffff;
  if (zip64) {
    pieces.push({ pos, bytes: new Writer().u32(0x06064b50).u64(44).u16(45).u16(45).u32(0).u32(0).u64(specs.length).u64(specs.length).u64(cd.length).u64(cdPos).take() });
    pieces.push({ pos: pos + 56, bytes: new Writer().u32(0x07064b50).u32(0).u64(pos).u32(1).take() });
    pos += 56 + 20;
  }
  const comment = opts.comment ?? new Uint8Array(0);
  const end = new Writer().u32(0x06054b50).u16(0).u16(0).u16(zip64 ? 0xffff : specs.length).u16(zip64 ? 0xffff : specs.length);
  end.u32(zip64 ? SAT : cd.length).u32(zip64 ? SAT : cdPos).u16(comment.length).bytes(comment);
  pieces.push({ pos, bytes: end.take() });
  return { pieces, size: pos + 22 + comment.length };
}

/** Flatten a small archive. */
function flatten(a: { pieces: Piece[]; size: number }): Uint8Array {
  const out = new Uint8Array(a.size);
  for (const p of a.pieces) out.set(p.bytes, p.pos);
  return out;
}

/** Serve an archive from its pieces only: a read that is not inside one piece throws (virtual bytes are not there). */
function pieceReader(a: { pieces: Piece[]; size: number }, log?: Range[]): RandomAccessReader {
  return {
    size: a.size,
    read(start, end) {
      log?.push([start, end]);
      const p = a.pieces.find((x) => start >= x.pos && end <= x.pos + x.bytes.length);
      if (!p) return Promise.reject(new Error(`read of bytes that do not exist ${CANARY}`));
      return Promise.resolve(p.bytes.subarray(start - p.pos, end - p.pos));
    },
  };
}

// ------------------------------------------------------------------ bytesReader ---

describe("bytesReader", () => {
  it("serves half-open ranges and rejects anything outside the bytes", async () => {
    const r = bytesReader(Uint8Array.from([10, 11, 12, 13]));
    expect(r.size).toBe(4);
    expect([...(await r.read(1, 3))]).toEqual([11, 12]);
    expect((await r.read(2, 2)).length).toBe(0);
    await expect(r.read(0, 5)).rejects.toThrow(RangeError);
    await expect(r.read(3, 1)).rejects.toThrow(RangeError);
    await expect(r.read(-1, 2)).rejects.toThrow(RangeError);
  });
});

// ------------------------------------------------------------- listZipEntries ---

describe("listZipEntries", () => {
  it("lists names, methods and sizes like the zip says, reading only the tail and the directory", async () => {
    const zip = mediaHeavyZip();
    const { reader, reads } = trackingReader(zip);
    const { entries, issues } = await listZipEntries(reader);

    expect(issues).toEqual([]);
    const truth = scan(zip);
    expect(entries.map((e) => e.name)).toEqual(truth.map((e) => e.name));
    expect(entries.map((e) => e.method)).toEqual(truth.map((e) => e.method));
    expect(entries.find((e) => e.name === "chat_media/clip.mov")?.size).toBe(200_000);
    expect(entries.find((e) => e.name.endsWith("-photo.png"))?.compressedSize).toBeLessThan(5_000);

    // Exact reads only: the 22-byte end record first, then the directory. No read touches entry data.
    expect(reads[0]).toEqual([zip.length - 22, zip.length]);
    expect(reads.length).toBeLessThanOrEqual(4);
    expect(touching(reads, truth.map((e) => e.data))).toEqual([]);
    expect(Math.min(...reads.map(([s]) => s))).toBeGreaterThanOrEqual(Math.max(...truth.map((e) => e.data[1])));
  });

  it("reports the newest entry mtime exactly as the in-memory directory reader does", async () => {
    const zip = zipFiles({
      "a.json": [enc({}), { mtime: new Date(Date.UTC(2024, 2, 5, 10, 0, 0)) }],
      "b.json": [enc({}), { mtime: new Date(Date.UTC(2024, 8, 9, 11, 0, 0)) }],
    });
    const listing = await listZipEntries(bytesReader(zip));
    expect(listing.newestMtime).toBe(readZipDirectory(zip, 1000)?.newestMtime);
    expect(listing.newestMtime).toBeGreaterThan(Date.UTC(2024, 8, 8));
    expect((await listZipEntries(bytesReader(flatten(buildZip([{ name: "x.json" }]))))).newestMtime).toBeUndefined();
  });

  it("finds the directory behind a maximum-length archive comment", async () => {
    const zip = zipFiles({ "friends.json": enc(FRIENDS) });
    const comment = noise(9, 65_535);
    const withComment = concat([zip, comment]);
    new DataView(withComment.buffer).setUint16(zip.length - 2, comment.length, true);
    const { entries, issues } = await listZipEntries(bytesReader(withComment));
    expect(issues).toEqual([]);
    expect(entries.map((e) => e.name)).toEqual(["friends.json"]);
  });

  it("reads zip64 structures, including sizes and offsets beyond 4 GiB that are never fetched", async () => {
    const GIB = 1024 ** 3;
    const files = [
      { name: "json/friends.json", data: enc(FRIENDS) },
      { name: "chat_media/huge.mp4", virtualBytes: 6 * GIB },
      { name: "memories/after-huge.jpg", virtualBytes: 5 * GIB },
    ];
    const archive = buildZip(files, { zip64: true });
    expect(archive.size).toBeGreaterThan(11 * GIB);

    const reads: Range[] = [];
    const { entries, issues } = await listZipEntries(pieceReader(archive, reads));
    expect(issues).toEqual([]);
    expect(entries.map((e) => [e.name, e.size])).toEqual([
      ["json/friends.json", enc(FRIENDS).length],
      ["chat_media/huge.mp4", 6 * GIB],
      ["memories/after-huge.jpg", 5 * GIB],
    ]);
    expect(entries[2]?.localHeaderOffset).toBeGreaterThan(6 * GIB);
    // Directory and tail only: all reads sit after the last (virtual) entry.
    expect(Math.min(...reads.map(([s]) => s))).toBeGreaterThan(11 * GIB);
  });

  it("opens a small entry of a zip64 archive and refuses a huge one", async () => {
    const archive = buildZip([{ name: "friends.json", data: enc(FRIENDS) }, { name: "huge.bin", virtualBytes: 6 * 1024 ** 3 }], { zip64: true });
    const reader = pieceReader(archive);
    const { entries } = await listZipEntries(reader);
    expect(JSON.parse(new TextDecoder().decode(await readZipEntry(reader, entries[0] as ZipEntryInfo)))).toEqual(FRIENDS);
    await expect(readZipEntry(reader, entries[1] as ZipEntryInfo)).rejects.toMatchObject({ code: "too-large" });
  });

  it("reads the directory in bounded chunks and parses every record, wherever a chunk ends", async () => {
    const names = Array.from({ length: 30_000 }, (_, i) => `chat_media/${String(i).padStart(6, "0")}-${"x".repeat(i % 97)}.jpg`);
    const zip = flatten(buildZip(names.map((name) => ({ name }))));
    const { reader, reads } = trackingReader(zip);
    const { entries, issues } = await listZipEntries(reader);
    expect(issues).toEqual([]);
    expect(entries.map((e) => e.name)).toEqual(names);
    expect(Math.max(...reads.map(([s, e]) => e - s))).toBeLessThanOrEqual(1024 * 1024);
    expect(reads.length).toBeGreaterThanOrEqual(4); // a ~3 MB directory needs several reads
  });

  it("decodes UTF-8 names (flag set) and falls back to single-byte names otherwise", async () => {
    const utf8Zip = flatten(buildZip([{ name: "json/ünï-日本.json" }]));
    expect((await listZipEntries(bytesReader(utf8Zip))).entries[0]?.name).toBe("json/ünï-日本.json");
    const legacy = utf8Zip.slice();
    new DataView(legacy.buffer).setUint16(firstCentralRecord(legacy) + 8, 0, true); // clear the UTF-8 flag
    expect((await listZipEntries(bytesReader(legacy))).entries[0]?.name).toBe("json/Ã¼nÃ¯-æ\u0097¥æ\u009c¬.json");
  });

  it("finds the end record behind a short comment, a comment holding a fake end record, and no comment", async () => {
    const base = zipFiles({ "friends.json": enc(FRIENDS) });
    const fake = concat([u32(0x06054b50), new Uint8Array(18)]); // looks like an end record, claims no comment
    for (const comment of [enc("hello"), concat([enc("x"), fake, enc("y")]), noise(3, 3_000)]) {
      const zip = concat([base, comment]);
      new DataView(zip.buffer).setUint16(base.length - 2, comment.length, true);
      const { entries, issues } = await listZipEntries(bytesReader(zip));
      expect(issues).toEqual([]);
      expect(entries.map((e) => e.name)).toEqual(["friends.json"]);
    }
  });

  it("lists an empty archive without issues", async () => {
    const r = await listZipEntries(bytesReader(flatten(buildZip([]))));
    expect(r).toEqual({ entries: [], issues: [] });
  });

  describe("bad input (issues, never a throw, never user data)", () => {
    const good = zipFiles({ "json/friends.json": enc(FRIENDS), [`chat_media/${CANARY}.jpg`]: noise(5, 5_000) });

    const cases: [string, Uint8Array][] = [
      ["empty", new Uint8Array(0)],
      ["too short", new Uint8Array(21)],
      ["noise", noise(7, 70_000)],
      ["zeros", new Uint8Array(100_000)],
      ["truncated before the directory", good.subarray(0, 100)],
      ["truncated mid-directory", good.subarray(0, good.length - 40)],
      ["only the end record", good.subarray(good.length - 22)],
    ];
    for (const [label, bytes] of cases) {
      it(label, async () => {
        const r = await listZipEntries(bytesReader(bytes));
        expect(r.entries).toEqual([]);
        expect(r.issues).toEqual([{ severity: "error", code: "zip-unreadable", message: "The file could not be read as a zip archive." }]);
      });
    }

    it("a directory record with a bad signature", async () => {
      const bad = good.slice();
      bad[firstCentralRecord(bad)] = 0;
      expect((await listZipEntries(bytesReader(bad))).issues.map((i) => i.code)).toEqual(["zip-unreadable"]);
    });

    it("a directory that claims to run past the end of the file", async () => {
      const bad = good.slice();
      new DataView(bad.buffer).setUint32(bad.length - 6, 0x7fffffff, true); // directory size
      expect((await listZipEntries(bytesReader(bad))).issues.map((i) => i.code)).toEqual(["zip-unreadable"]);
    });

    it("a reader that fails or lies about its size", async () => {
      const failing: RandomAccessReader = { size: good.length, read: () => Promise.reject(new Error(`disk error ${CANARY}`)) };
      const liar: RandomAccessReader = { size: good.length, read: async (s, e) => new Uint8Array(Math.max(0, e - s - 1)) };
      for (const reader of [failing, liar]) {
        const r = await listZipEntries(reader);
        expect(r.entries).toEqual([]);
        expect(r.issues.map((i) => i.code)).toEqual(["zip-unreadable"]);
        expect(JSON.stringify(r.issues)).not.toContain(CANARY);
      }
    });

    it("never throws on randomly damaged copies of a valid archive, and never echoes a name", async () => {
      let x = 12345;
      const next = () => ((x = (x * 1103515245 + 12345) & 0x7fffffff), x);
      for (let round = 0; round < 150; round++) {
        const bad = good.slice(0, round % 3 === 0 ? 1 + (next() % good.length) : good.length);
        for (let k = 0; k < 1 + (round % 4); k++) bad[next() % bad.length] = next() & 0xff;
        const r = await listZipEntries(bytesReader(bad));
        const p = await parseExportFromReader(bytesReader(bad));
        expect(JSON.stringify([r.issues, p.issues, p.fileList])).not.toContain(CANARY);
      }
    });
  });

  describe("entry-count cap", () => {
    it("rejects a declared count above 500k without reading the directory", async () => {
      const archive = buildZip([{ name: "a.json" }], { zip64: true });
      // Rewrite the zip64 record's entry count.
      const flat = flatten(archive);
      const rec = archive.pieces[archive.pieces.length - 3] as Piece;
      new DataView(flat.buffer).setBigUint64(rec.pos + 32, 500_001n, true);
      const { reader, reads } = trackingReader(flat);
      const r = await listZipEntries(reader);
      expect(r.entries).toEqual([]);
      expect(r.issues).toEqual([{ severity: "error", code: "zip-too-many-entries", message: "The archive declares 500001 entries, which is more than the 500000 Snappy will open." }]);
      expect(reads.reduce((n, [s, e]) => n + e - s, 0)).toBeLessThan(200); // the end records only
    });
  });
});

// ---------------------------------------------------------------- stored times ---

const dosFields = (y: number, mo: number, d: number, h: number, mi: number, s: number) => ({
  dosDate: ((y - 1980) << 9) | (mo << 5) | d,
  dosTime: (h << 11) | (mi << 5) | (s >> 1),
});
/** An extended-timestamp field (0x5455): flags, then the mtime in unix seconds. */
const extTime = (unixSeconds: number, flags = 1): Uint8Array => new Writer().u16(0x5455).u16(5).bytes(Uint8Array.of(flags)).u32(unixSeconds).take();
const unknownField = (id: number, len: number): Uint8Array => new Writer().u16(id).u16(len).bytes(new Uint8Array(len)).take();
const listOf = async (specs: Spec[], opts: { zip64?: boolean } = {}): Promise<ZipEntryInfo[]> => (await listZipEntries(bytesReader(flatten(buildZip(specs, opts))))).entries;
const UTC_SECONDS = Date.UTC(2024, 2, 5, 10, 20, 30) / 1000;

describe("listZipEntries stored times", () => {
  it("reads the UTC time from the central extra field and the DOS fields as UTC wall-clock numbers", async () => {
    // A zipper 8 hours behind UTC: its wall clock reads 02:20:30 for the instant 10:20:30 UTC.
    const [e] = await listOf([{ name: "a", centralExtra: extTime(UTC_SECONDS), ...dosFields(2024, 3, 5, 2, 20, 30) }]);
    expect(e?.mtimeUtcMs).toBe(Date.UTC(2024, 2, 5, 10, 20, 30));
    expect(e?.mtimeDosMs).toBe(Date.UTC(2024, 2, 5, 2, 20, 30));
  });

  it("finds the field behind other extra fields, with and without zip64 fields", async () => {
    const extra = (() => {
      const parts = [unknownField(0x7875, 11), extTime(UTC_SECONDS)];
      return new Writer().bytes(parts[0] as Uint8Array).bytes(parts[1] as Uint8Array).take();
    })();
    for (const zip64 of [false, true]) {
      const [e] = await listOf([{ name: "a", centralExtra: extra }], { zip64 });
      expect(e?.mtimeUtcMs).toBe(UTC_SECONDS * 1000);
    }
  });

  it("leaves the UTC time unset without the field, with the mtime flag clear, or with an implausible value", async () => {
    const entries = await listOf([
      { name: "none", ...dosFields(2024, 3, 5, 2, 20, 30) },
      { name: "noflag", centralExtra: extTime(UTC_SECONDS, 0b110) },
      { name: "zero", centralExtra: extTime(0) },
      { name: "far", centralExtra: extTime(0xffffffff) },
      { name: "other", centralExtra: unknownField(0x7875, 11) },
    ]);
    expect(entries.map((e) => e.mtimeUtcMs)).toEqual([undefined, undefined, undefined, undefined, undefined]);
    expect(entries[0]?.mtimeDosMs).toBe(Date.UTC(2024, 2, 5, 2, 20, 30));
    expect("mtimeUtcMs" in (entries[0] as ZipEntryInfo)).toBe(false);
  });

  it("never reads past the extra data when a field lies about its size", async () => {
    const lyingLong = new Writer().u16(0x5455).u16(0xffff).bytes(Uint8Array.of(1)).u32(UTC_SECONDS).take(); // claims 64 KiB
    const cutShort = new Writer().u16(0x5455).u16(5).bytes(Uint8Array.of(1)).bytes(Uint8Array.of(1, 2)).take(); // claims 5, has 3
    const lyingBefore = new Writer().bytes(unknownField(0x7875, 3)).u16(0x7000).u16(60000).bytes(extTime(UTC_SECONDS)).take();
    const tail = Uint8Array.of(0x55, 0x54, 5); // a field header cut off mid-way
    const entries = await listOf([
      { name: "long", centralExtra: lyingLong },
      { name: "short", centralExtra: cutShort },
      { name: "before", centralExtra: lyingBefore },
      { name: "tail", centralExtra: tail },
      { name: "ok", centralExtra: extTime(UTC_SECONDS) },
    ]);
    expect(entries.map((e) => e.name)).toEqual(["long", "short", "before", "tail", "ok"]);
    expect(entries.map((e) => e.mtimeUtcMs)).toEqual([undefined, undefined, undefined, undefined, UTC_SECONDS * 1000]);
  });

  it("leaves the DOS time unset for fields that are not a real date or time", async () => {
    const entries = await listOf([
      { name: "month0", dosDate: 0, dosTime: 0 },
      { name: "feb31", ...dosFields(2024, 2, 31, 1, 2, 4) },
      { name: "hour25", dosDate: dosFields(2024, 3, 5, 0, 0, 0).dosDate, dosTime: 25 << 11 },
      { name: "minute60", dosDate: dosFields(2024, 3, 5, 0, 0, 0).dosDate, dosTime: 60 << 5 },
      { name: "leap", ...dosFields(2024, 2, 29, 23, 59, 58) },
    ]);
    expect(entries.map((e) => e.mtimeDosMs)).toEqual([undefined, undefined, undefined, undefined, Date.UTC(2024, 1, 29, 23, 59, 58)]);
  });
});

describe("addLocalHeaderTimes", () => {
  const dataRanges = (zip: Uint8Array): Range[] => scan(zip).map((e) => e.data);

  it("fills missing UTC times from local headers only, never reading entry data and never twice", async () => {
    const zip = flatten(
      buildZip([
        { name: "local-only", data: noise(1, 5_000), localExtra: new Writer().bytes(unknownField(0x7875, 4)).bytes(extTime(UTC_SECONDS)).take() },
        { name: "central-too", data: noise(2, 5_000), centralExtra: extTime(UTC_SECONDS), localExtra: extTime(UTC_SECONDS + 99) },
        { name: "neither", data: noise(3, 5_000) },
        { name: "skipped", data: noise(4, 5_000), localExtra: extTime(UTC_SECONDS) },
      ]),
    );
    const { entries } = await listZipEntries(bytesReader(zip));
    expect(entries.map((e) => e.mtimeUtcMs)).toEqual([undefined, UTC_SECONDS * 1000, undefined, undefined]);

    const { reader, reads } = trackingReader(zip, dataRanges(zip));
    const filled = await addLocalHeaderTimes(reader, entries, (e) => e.name !== "skipped");
    expect(filled.map((e) => e.mtimeUtcMs)).toEqual([UTC_SECONDS * 1000, UTC_SECONDS * 1000, undefined, undefined]);
    expect(entries[0]?.mtimeUtcMs).toBeUndefined(); // the input is not modified
    expect(touching(reads, dataRanges(zip))).toEqual([]);
    expect(reads.length).toBe(3); // header + extra for "local-only", header only for "neither" (no extra); none for the others
  });

  it("returns an entry unchanged when its header cannot be read", async () => {
    const zip = flatten(buildZip([{ name: "a", localExtra: extTime(UTC_SECONDS) }]));
    const { entries } = await listZipEntries(bytesReader(zip));
    const moved = [{ ...(entries[0] as ZipEntryInfo), localHeaderOffset: 3 }, { ...(entries[0] as ZipEntryInfo), localHeaderOffset: zip.length + 10 }, { ...(entries[0] as ZipEntryInfo), localHeaderOffset: Infinity }];
    const out = await addLocalHeaderTimes(bytesReader(zip), moved);
    expect(out.map((e) => e.mtimeUtcMs)).toEqual([undefined, undefined, undefined]);
    const failing: RandomAccessReader = { size: zip.length, read: () => Promise.reject(new Error(CANARY)) };
    expect(await addLocalHeaderTimes(failing, entries)).toEqual(entries);
  });
});

// ---------------------------------------------------------------- readZipEntry ---

describe("readZipEntry", () => {
  const text = (b: Uint8Array) => new TextDecoder().decode(b);

  it("reads stored and deflated entries exactly, requesting only that entry's range", async () => {
    const big = enc(JSON.stringify({ Friends: Array.from({ length: 5_000 }, (_, i) => ({ Username: `user${i}` })) }));
    const zip = zipFiles({
      "stored.json": [enc(FRIENDS), { level: 0 }],
      "deflated.json": [big, { level: 6 }],
      "other.jpg": noise(4, 100_000),
    });
    const truth = scan(zip);
    expect(truth.map((t) => t.method)).toEqual([0, 8, 8]);
    const { reader, reads } = trackingReader(zip, [truth[2]?.data as Range]);
    const { entries } = await listZipEntries(reader);
    reads.length = 0;

    expect(JSON.parse(text(await readZipEntry(reader, entries[0] as ZipEntryInfo)))).toEqual(FRIENDS);
    expect(text(await readZipEntry(reader, entries[1] as ZipEntryInfo))).toBe(text(big));
    const own = truth.slice(0, 2).map((t) => t.data);
    expect(reads.every(([s, e]) => s >= 0 && e <= zip.length)).toBe(true);
    expect(touching(reads, [truth[2]?.data as Range])).toEqual([]);
    expect(reads.some(([s, e]) => own.some(([a, b]) => s >= a && e <= b))).toBe(true);
  });

  it("inflates entries bigger than one input chunk and an empty entry", async () => {
    const big = noise(8, 200_000);
    const zip = zipFiles({ "noise.json": [big, { level: 6 }], "empty.json": [new Uint8Array(0), { level: 6 }] });
    const { entries } = await listZipEntries(bytesReader(zip));
    expect(await readZipEntry(bytesReader(zip), entries[0] as ZipEntryInfo)).toEqual(big);
    expect((await readZipEntry(bytesReader(zip), entries[1] as ZipEntryInfo)).length).toBe(0);
  });

  const failure = async (reader: RandomAccessReader, info: ZipEntryInfo, opts?: { maxBytes?: number }): Promise<ZipEntryError> => {
    try {
      await readZipEntry(reader, info, opts);
    } catch (e) {
      expect(e).toBeInstanceOf(ZipEntryError);
      return e as ZipEntryError;
    }
    throw new Error("expected readZipEntry to throw");
  };

  const sample = zipFiles({ [`json/${CANARY}.json`]: [enc(FRIENDS), { level: 6 }] });
  const info = async (zip = sample): Promise<ZipEntryInfo> => (await listZipEntries(bytesReader(zip))).entries[0] as ZipEntryInfo;

  it("throws ZipEntryError with fixed text for every failure, never naming the entry or echoing the reader", async () => {
    const i = await info();
    const errors = [
      await failure(bytesReader(sample), { ...i, method: 12 }),
      await failure(bytesReader(sample), i, { maxBytes: 10 }),
      await failure(bytesReader(sample), { ...i, size: i.size + 1 }),
      await failure(bytesReader(sample), { ...i, size: i.size - 1 }),
      await failure(bytesReader(sample), { ...i, localHeaderOffset: 3 }),
      await failure(bytesReader(sample), { ...i, compressedSize: i.compressedSize + 1_000_000 }, { maxBytes: 1 << 30 }),
      await failure({ size: sample.length, read: () => Promise.reject(new Error(`io ${CANARY}`)) }, i),
      await failure(bytesReader(sample.subarray(0, sample.length - 120)), i),
    ];
    expect(errors.map((e) => e.code)).toEqual(["unsupported-method", "too-large", "corrupt", "corrupt", "corrupt", "corrupt", "corrupt", "corrupt"]);
    for (const e of errors) {
      expect(e.name).toBe("ZipEntryError");
      expect(e.message).not.toContain(CANARY);
      expect(e.message).not.toContain("friends");
      expect(e.message.length).toBeLessThan(80);
    }
  });

  it("rejects stored entries whose sizes disagree and encrypted entries", async () => {
    const zip = zipFiles({ "a.json": [enc(FRIENDS), { level: 0 }] });
    const i = await info(zip);
    expect((await failure(bytesReader(zip), { ...i, size: i.size - 1 })).code).toBe("corrupt");
    const encrypted = zip.slice();
    new DataView(encrypted.buffer).setUint16(6, 1, true); // local header flags: bit 0
    expect((await failure(bytesReader(encrypted), i)).code).toBe("encrypted");
  });

  it("rejects a corrupt deflate stream and a truncated one", async () => {
    const zip = zipFiles({ "a.json": [enc(JSON.stringify(FRIENDS).repeat(50)), { level: 6 }] });
    const i = await info(zip);
    const data = scan(zip)[0]?.data as Range;
    const corrupt = zip.slice();
    corrupt.fill(0xff, data[0], data[0] + 8);
    expect((await failure(bytesReader(corrupt), i)).code).toBe("corrupt");
    expect((await failure(bytesReader(zip), { ...i, compressedSize: i.compressedSize - 4 })).code).toBe("corrupt");
  });

  it("stops a decompression bomb at the declared size instead of expanding it", async () => {
    const bomb = deflateSync(new Uint8Array(16 * 1024 * 1024));
    expect(bomb.length).toBeLessThan(50_000);
    // A stored-looking archive around the raw deflate stream: header + data, declared size far too small.
    const archive = buildZip([{ name: "a.json", data: bomb, size: 1_000 }]);
    const flat = flatten(archive);
    new DataView(flat.buffer).setUint16(8, 8, true); // local method: deflate (the directory is patched below)
    new DataView(flat.buffer).setUint16(firstCentralRecord(flat) + 10, 8, true);
    const [entry] = (await listZipEntries(bytesReader(flat))).entries;
    expect(entry).toMatchObject({ method: 8, size: 1_000 });
    const t0 = performance.now();
    expect((await failure(bytesReader(flat), entry as ZipEntryInfo)).code).toBe("corrupt");
    expect(performance.now() - t0).toBeLessThan(2_000);
  });
});

// ---------------------------------------------------------- parseExportFromReader ---

describe("parseExportFromReader", () => {
  /**
   * The reader front end sees the stored file times (they travel with bundledMedia), the in-memory
   * one never does. Everything else, pairing included, has to be identical.
   */
  const withoutStoredTimes = (p: ParsedExport): ParsedExport =>
    p.bundledMedia === undefined ? p : { ...p, bundledMedia: p.bundledMedia.map(({ timeMs: _t, timeKind: _k, ...rest }) => ({ ...rest, timeKind: "none" as const })) };

  it("gives exactly parseExportZip's result for synthetic exports", async () => {
    const mtime = new Date(Date.UTC(2025, 4, 20, 8, 30, 0));
    const zips = [
      syntheticExportZip({ now: NOW, friendCount: 60, memoryCount: 40, chatMessageCount: 800, bundleMedia: true }),
      syntheticExportZip({ now: NOW, phase: 1, friendCount: 30, memoryCount: 20, bundleMedia: false }),
      zipFiles({
        "mydata_123/json/friends.json": [enc(FRIENDS), { mtime }],
        "mydata_123/json/chat_history.json": enc(CHATS),
        "backup/friends.json": enc({ Friends: [{ Username: "stale" }] }),
        "mydata_123/memories/2023-04-01_x.jpg": noise(1, 1000),
        "__MACOSX/mydata_123/._friends.json": enc("junk"),
        "mydata_123/html/chat_history/ZQ-conversation-name.html": enc("<p>x</p>"),
      }),
      zipFiles({ "json/friends.json": enc("{ not json"), "json/chat_history.json": enc(CHATS) }),
      zipFiles({ "readme.txt": enc("nothing here") }),
    ];
    for (const zip of zips) {
      expect(withoutStoredTimes(await parseExportFromReader(bytesReader(zip)))).toEqual(withoutStoredTimes(parseExportZip(zip)));
    }
  });

  it("matches parseExportZip on damaged archives and entries", async () => {
    const good = zipFiles({ "json/friends.json": enc(FRIENDS), "json/chat_history.json": [enc(JSON.stringify(CHATS).repeat(1)), { level: 6 }], "json/memories_history.json": enc(MEMORIES) });
    const chats = scan(good).find((e) => e.name.endsWith("chat_history.json")) as Scanned;
    const corrupt = good.slice();
    corrupt.fill(0xff, chats.data[0], chats.data[0] + 8);
    const view = (z: Uint8Array) => new DataView(z.buffer);
    const oversized = good.slice();
    for (let i = 0; i + 46 < oversized.length; i++) {
      if (view(oversized).getUint32(i, true) === 0x02014b50) view(oversized).setUint32(i + 24, 300 * 1024 * 1024, true);
    }
    for (const zip of [new Uint8Array(0), noise(3, 4000), good.subarray(0, good.length - 30), corrupt]) {
      expect(withoutStoredTimes(await parseExportFromReader(bytesReader(zip)))).toEqual(withoutStoredTimes(parseExportZip(zip)));
    }

    // Declared sizes of 300 MiB: the in-memory parse refuses all three files. The reader streams all
    // of them, so it has no such limit; the declared sizes are wrong here, so each entry is reported
    // as unreadable instead.
    expect(parseExportZip(oversized).issues.map((i) => i.code)).toEqual(["zip-json-too-large", "zip-json-too-large", "zip-json-too-large"]);
    const oversizedResult = await parseExportFromReader(bytesReader(oversized));
    expect(oversizedResult.issues.map((i) => [i.code, i.message])).toEqual([
      ["zip-entry-unreadable", "friends.json inside the archive could not be decompressed."],
      ["zip-entry-unreadable", "chat_history.json inside the archive could not be decompressed."],
      ["zip-entry-unreadable", "memories_history.json inside the archive could not be decompressed."],
    ]);
  });

  it("never requests a media entry's data (stored or deflated), however big", async () => {
    const zip = mediaHeavyZip();
    const media = mediaRanges(zip);
    expect(media.length).toBe(4);
    const { reader, reads } = trackingReader(zip, media);
    const parsed = await parseExportFromReader(reader);

    expect(touching(reads, media)).toEqual([]);
    // The files carry no usable time, so the pairing falls back to the date in the name and says so.
    expect(parsed.issues.filter((i) => i.severity !== "info").map((i) => i.code)).toEqual(["memories-pairing-fallback"]);
    expect(parsed.issues.map((i) => i.code)).toContain("media-not-opened");
    expect(parsed.friends.friends.map((f) => f.username)).toEqual(["alice", "bob"]);
    expect(parsed.memories).toHaveLength(1);
    // The date in the file name links the memory to its bundled file; the size comes from the directory.
    expect(parsed.memories[0]).toMatchObject({ zipPath: "memories/2023-04-01_aaaaaaaa-0000-0000-0000-000000000001.jpg", sizeBytes: 300_000 });
    // Only the three data files were opened: their data ranges are the only entry data read.
    const opened = scan(zip).filter((e) => /(friends|chat_history|memories_history)\.json$/.test(e.name)).map((e) => e.data);
    const dataReads = reads.filter(([s, e]) => scan(zip).some((t) => s < t.data[1] && e > t.data[0]));
    expect(dataReads.every(([s, e]) => opened.some(([a, b]) => s >= a && e <= b))).toBe(true);
  });

  it("analyses an archive far bigger than memory: 12 GiB of media that does not exist", async () => {
    const GIB = 1024 ** 3;
    const specs: Spec[] = [
      { name: "json/friends.json", data: enc(FRIENDS) },
      { name: "json/chat_history.json", data: enc(CHATS) },
      { name: "json/memories_history.json", data: enc(MEMORIES) },
    ];
    for (let i = 0; i < 6; i++) specs.push({ name: `memories/${i}.mp4`, virtualBytes: 2 * GIB });
    const archive = buildZip(specs);
    expect(archive.size).toBeGreaterThan(12 * GIB);
    const reads: Range[] = [];
    const parsed = await parseExportFromReader(pieceReader(archive, reads)); // any read of virtual bytes would reject
    expect(parsed.issues.filter((i) => i.severity !== "info")).toEqual([]);
    expect(parsed.friends.friends.map((f) => f.username)).toEqual(["alice", "bob"]);
    expect(parsed.chats).toHaveLength(1);
    expect(parsed.memories).toHaveLength(1);
    expect(parsed.memories.every((m) => m.sizeBytes === undefined || m.sizeBytes === 2 * GIB)).toBe(true);
    expect(parsed.issues.find((i) => i.code === "media-not-opened")?.message).toContain("6 media files");
    expect(Math.max(...reads.map(([s, e]) => e - s))).toBeLessThan(1024 * 1024);
  });

  it("reports an unopenable data file by its fixed name and carries on", async () => {
    const zip = zipFiles({ "json/friends.json": enc(FRIENDS), "json/chat_history.json": [enc(JSON.stringify(CHATS)), { level: 6 }] });
    const chats = scan(zip).find((e) => e.name.endsWith("chat_history.json")) as Scanned;
    const bad = zip.slice();
    bad.fill(0xff, chats.data[0], chats.data[0] + 6);
    const parsed = await parseExportFromReader(bytesReader(bad));
    expect(parsed.friends.friends).toHaveLength(2);
    expect(parsed.issues).toContainEqual({ severity: "error", code: "zip-entry-unreadable", message: "chat_history.json inside the archive could not be decompressed." });
  });

  it("matches the in-memory parse for the same files (zip64 archive)", async () => {
    const archive = buildZip([
      { name: "json/friends.json", data: enc(FRIENDS) },
      { name: "json/chat_history.json", data: enc(CHATS) },
      { name: "chat_media/a.jpg", data: noise(1, 100) },
    ], { zip64: true });
    const parsed = await parseExportFromReader(bytesReader(flatten(archive)));
    const files = { "json/friends.json": enc(FRIENDS), "json/chat_history.json": enc(CHATS), "chat_media/a.jpg": noise(1, 100) };
    expect(parsed).toEqual(parseExportFiles(files));
  });

  it("keeps every name, username and url out of the result and its messages", async () => {
    const zip = zipFiles({
      "json/friends.json": enc(FRIENDS),
      [`html/${CANARY}-conversation.html`]: enc("<p>x</p>"),
      [`chat_media/${CANARY}.jpg`]: noise(2, 500),
      [`json/${CANARY}.json`]: enc({}),
    });
    const parsed = await parseExportFromReader(bytesReader(zip));
    expect(JSON.stringify(parsed.issues) + JSON.stringify(parsed.fileList)).not.toContain(CANARY);
    expect(parsed.fileList).toContain("html/<file-1>.html");
  });
});

// ------------------------------------------------------------- mergeParsedExports ---

describe("mergeParsedExports", () => {
  const rec = (username: string, createdAt?: number, modifiedAt?: number) => ({ username, ...(createdAt !== undefined ? { createdAt } : {}), ...(modifiedAt !== undefined ? { modifiedAt } : {}) });
  const emptyFriends = () => ({ friends: [], sentRequests: [], pendingRequests: [], deletedFriends: [], blocked: [], ignored: [], hiddenSuggestions: [] });
  const part = (over: Partial<ParsedExport> = {}): ParsedExport => ({ friends: emptyFriends(), chats: [], memories: [], fileList: [], issues: [], ...over });
  const chat = (conversation: string, at: number, kind = "TEXT", direction: "sent" | "received" = "sent") => ({ conversation, isGroup: false, direction, kind, at });

  it("merging nothing gives an empty export", () => {
    expect(mergeParsedExports([])).toEqual(part());
  });

  it("is idempotent and order-independent for real parses of two overlapping exports", async () => {
    const a = await parseExportFromReader(bytesReader(syntheticExportZip({ now: NOW, phase: 1, friendCount: 50, memoryCount: 60, chatMessageCount: 700, bundleMedia: true })));
    const b = await parseExportFromReader(bytesReader(syntheticExportZip({ now: NOW, phase: 2, friendCount: 50, memoryCount: 60, chatMessageCount: 700, bundleMedia: true })));
    expect(a.chats.length).toBeGreaterThan(100);

    expect(mergeParsedExports([a])).toEqual(a);
    expect(mergeParsedExports([a, a])).toEqual(a);
    expect(mergeParsedExports([a, a, a])).toEqual(a);
    expect(mergeParsedExports([a, b])).toEqual(mergeParsedExports([b, a]));
    expect(mergeParsedExports([a, b, a])).toEqual(mergeParsedExports([a, b]));

    // Merging a merge with one of its inputs adds nothing (the content is the same; only the
    // interleaving of the lists can differ, because positions inside the merge are new).
    const ab = mergeParsedExports([a, b]);
    const canon = (p: ParsedExport) => JSON.stringify([p.chats.map((c) => JSON.stringify(c)).sort(), p.memories.map((m) => JSON.stringify(m)).sort(), p.friends.friends.map((f) => JSON.stringify(f)).sort(), p.issues, p.fileList.slice().sort()]);
    expect(canon(mergeParsedExports([ab, a]))).toBe(canon(ab));
    expect(canon(mergeParsedExports([ab, b]))).toBe(canon(ab));
    // Phase 1 history is a prefix of phase 2: the union has no more chats than the later export.
    expect(ab.chats.length).toBeLessThanOrEqual(a.chats.length + b.chats.length);
    expect(ab.chats.length).toBeGreaterThanOrEqual(b.chats.length);
    expect(ab.exportedAt).toBe(Math.max(a.exportedAt ?? 0, b.exportedAt ?? 0));
  });

  it("combines friends by username: earliest createdAt, latest modification, no duplicates", () => {
    const m = mergeParsedExports([
      part({ friends: { ...emptyFriends(), friends: [rec("alice", 500, 900), rec("bob", 700)], sentRequests: [rec("dora", 5)] } }),
      part({ friends: { ...emptyFriends(), friends: [rec("alice", 300, 800), rec("cleo")], sentRequests: [rec("dora", 9)], deletedFriends: [{ username: "eve", deletedAt: 40 }] } }),
      part({ friends: { ...emptyFriends(), deletedFriends: [{ username: "eve", createdAt: 1, deletedAt: 60 }] } }),
    ]);
    expect(m.friends.friends).toEqual([rec("alice", 300, 900), rec("bob", 700), rec("cleo")]);
    expect(m.friends.sentRequests).toEqual([rec("dora", 5)]);
    expect(m.friends.deletedFriends).toEqual([{ username: "eve", createdAt: 1, deletedAt: 60 }]);
    expect("modifiedAt" in (m.friends.friends[1] ?? {})).toBe(false); // absent stays absent
  });

  it("de-duplicates chats across parts but keeps same-second repeats inside one part", () => {
    const x = chat("alice", 1000);
    const m = mergeParsedExports([
      part({ chats: [x, chat("alice", 1000), chat("alice", 2000), chat("alice", 1000, "MEDIA")] }),
      part({ chats: [chat("alice", 1000), chat("alice", 3000), chat("alice", 1000, "TEXT", "received")] }),
    ]);
    expect(m.chats).toHaveLength(6);
    expect(m.chats.filter((c) => c.at === 1000 && c.kind === "TEXT" && c.direction === "sent")).toHaveLength(2);
    expect(m.chats[0]).toBe(x); // chat events are shared, not cloned
  });

  it("combines memories by id and keeps what either part knows", () => {
    const m = mergeParsedExports([
      part({ memories: [{ id: "m1", date: null, mediaType: "unknown", downloadUrl: "https://example.invalid/a" }, { id: "m2", date: 50, mediaType: "image" }] }),
      part({ memories: [{ id: "m1", date: 200, mediaType: "video", zipPath: "memories/a.mp4", sizeBytes: 7 }] }),
      part({ memories: [{ id: "m1", date: 100, mediaType: "unknown", sizeBytes: 9 }] }),
    ]);
    expect(m.memories).toEqual([
      { id: "m1", date: 100, mediaType: "video", downloadUrl: "https://example.invalid/a", zipPath: "memories/a.mp4", sizeBytes: 9 },
      { id: "m2", date: 50, mediaType: "image" },
    ]);
  });

  it("takes the newest exportedAt, leaves it out when no part has one, and de-duplicates issues by code and message", () => {
    const warn = { severity: "warning", code: "c", message: "same" } as const;
    const m = mergeParsedExports([
      part({ exportedAt: 10, issues: [warn, { severity: "info", code: "c", message: "other" }] }),
      part({ exportedAt: 30, issues: [{ ...warn, severity: "error" }] }),
      part({ exportedAt: 20 }),
    ]);
    expect(m.exportedAt).toBe(30);
    expect(m.issues).toEqual([{ severity: "error", code: "c", message: "same" }, { severity: "info", code: "c", message: "other" }]);
    expect("exportedAt" in mergeParsedExports([part(), part()])).toBe(false);
  });

  it("unions file lists and keeps the cap of 500 with a note, keeping data files first", () => {
    const html = (n: number) => Array.from({ length: n }, (_, i) => `html/<file-${i + 1}>.html`);
    const m = mergeParsedExports([part({ fileList: [...html(400), "json/friends.json"] }), part({ fileList: [...html(400).map((f) => f.replace("html/<file-", "html/<file-b")), "json/chat_history.json"] })]);
    expect(m.fileList).toHaveLength(500);
    expect(m.fileList.slice(0, 2).sort()).toEqual(["json/chat_history.json", "json/friends.json"]);
    expect(m.issues.map((i) => i.code)).toEqual(["file-list-truncated"]);
    const once = mergeParsedExports([part({ fileList: ["json/friends.json", "json/friends.json"] }), part({ fileList: ["json/friends.json"] })]);
    expect(once.fileList).toEqual(["json/friends.json"]);
  });

  it("does not modify its inputs, and its records are copies", () => {
    const a = part({ friends: { ...emptyFriends(), friends: [rec("alice", 5)] }, memories: [{ id: "m", date: 1, mediaType: "image" }], issues: [{ severity: "info", code: "c", message: "m" }] });
    const b = part({ friends: { ...emptyFriends(), friends: [rec("alice", 3), rec("bob", 1)] }, memories: [{ id: "m", date: 0, mediaType: "image" }] });
    const before = structuredClone([a, b]);
    const m = mergeParsedExports([a, b]);
    expect([a, b]).toEqual(before);
    (m.friends.friends[0] as { createdAt?: number }).createdAt = 999;
    (m.memories[0] as { date: number | null }).date = 999;
    (m.issues[0] as { code: string }).code = "changed";
    expect([a, b]).toEqual(before);
  });

  it("merges the parts of one export into what a single zip would give", async () => {
    const files = buildSyntheticExport({ now: NOW, friendCount: 40, memoryCount: 30, chatMessageCount: 300 });
    const whole = parseExportFiles(files);
    const split = [
      parseExportFiles({ "json/friends.json": files["json/friends.json"] as Uint8Array }),
      parseExportFiles({ "json/chat_history.json": files["json/chat_history.json"] as Uint8Array, "json/memories_history.json": files["json/memories_history.json"] as Uint8Array }),
    ];
    const merged = mergeParsedExports(split);
    expect(merged.friends.friends.map((f) => f.username).sort()).toEqual(whole.friends.friends.map((f) => f.username).sort());
    expect(merged.chats).toHaveLength(whole.chats.length);
    expect(merged.memories).toHaveLength(whole.memories.length);
  });
});

// ------------------------------------------------------ describeStructureFromReader ---

describe("describeStructureFromReader", () => {
  const NONE = { html: 0, media: 0, other: 0 };
  /** The JSON files of a zip, extracted: what the reader-based report is expected to describe. */
  const jsonOf = (zip: Uint8Array): Record<string, Uint8Array> => unzipSync(zip, { filter: (f) => f.name.endsWith(".json") });

  it("describes exactly the JSON files like describeStructure does, and counts everything else, with or without showKeys", async () => {
    const zips = [
      syntheticExportZip({ now: NOW, friendCount: 40, memoryCount: 20, chatMessageCount: 200, bundleMedia: true }),
      mediaHeavyZip(),
      zipFiles({ "json/friends.json": enc("{ bad"), "html/index.html": enc("<div><x-y>hi</x-y></div>"), "other.bin": noise(1, 50) }),
    ];
    for (const zip of zips) {
      for (const showKeys of [false, true]) {
        const report = await describeStructureFromReader([bytesReader(zip)], { showKeys });
        const { leftOut, ...described } = report;
        expect(described).toEqual(describeStructure(jsonOf(zip), { showKeys }));
        const names = scan(zip).map((e) => e.name);
        const nonJson = names.filter((n) => !n.endsWith(".json"));
        expect(leftOut).toEqual({
          html: nonJson.filter((n) => n.endsWith(".html")).length,
          media: nonJson.filter((n) => /\.(jpe?g|png|mp4|mov)$/i.test(n)).length,
          other: nonJson.filter((n) => !/\.(html|jpe?g|png|mp4|mov)$/i.test(n)).length,
        });
      }
    }
  });

  it("never requests media or HTML data: only json entries are read", async () => {
    const zip = mediaHeavyZip();
    const forbidden = scan(zip).filter((e) => !e.name.endsWith(".json") && e.data[1] > e.data[0]).map((e) => e.data);
    expect(forbidden.length).toBeGreaterThanOrEqual(5);
    const { reader, reads } = trackingReader(zip, forbidden);
    const report = await describeStructureFromReader([reader]);
    expect(touching(reads, forbidden)).toEqual([]);
    expect(report.files.map((f) => f.kind)).toEqual(["json", "json", "json", "json"]);
    expect(report.leftOut).toEqual({ html: 1, media: 4, other: 0 });
    expect(report.notes).toEqual([]);
    const text = formatStructureReport(report);
    expect(text).not.toContain(CANARY);
  });

  it("describes a multi-part export like the same files in one place, numbering masks across parts", async () => {
    const files = buildSyntheticExport({ now: NOW, friendCount: 30, memoryCount: 12, chatMessageCount: 150, bundleMedia: true });
    const paths = Object.keys(files).sort();
    const partA: Files = {};
    const partB: Files = {};
    paths.forEach((p, i) => ((i % 2 === 0 ? partA : partB)[p] = files[p] as Uint8Array));
    const readers = [bytesReader(zipFiles(partA)), bytesReader(zipFiles(partB))];
    const jsonFiles = Object.fromEntries(Object.entries(files).filter(([name]) => name.endsWith(".json")));
    const expected = { ...describeStructure(jsonFiles), leftOut: { html: 0, media: Object.keys(files).length - Object.keys(jsonFiles).length, other: 0 } };
    expect(expected.leftOut.media).toBeGreaterThan(0);
    expect(await describeStructureFromReader(readers)).toEqual(expected);
    expect(await describeStructureFromReader([readers[1] as RandomAccessReader, readers[0] as RandomAccessReader])).toEqual(expected);
  });

  it("notes an unreadable part and still describes the others", async () => {
    const good = zipFiles({ "json/friends.json": enc(FRIENDS) });
    const garbage = noise(2, 3000);
    const r = await describeStructureFromReader([bytesReader(good), bytesReader(garbage)]);
    expect(r.notes).toEqual(["part 2: zip unreadable"]);
    expect(r.files.map((f) => f.name)).toEqual(["json/friends.json"]);
    expect(r.files[0]?.structure?.kind).toBe("object");

    const single = await describeStructureFromReader([bytesReader(garbage)]);
    expect(single).toEqual({ ...describeZipStructure(garbage), leftOut: NONE });
    expect(single).toEqual({ showKeys: false, files: [], notes: ["zip unreadable"], leftOut: NONE });
    expect(await describeStructureFromReader([])).toEqual({ showKeys: false, files: [], notes: [], leftOut: NONE });
  });

  it("marks a corrupt entry instead of failing the report", async () => {
    const zip = zipFiles({ "json/friends.json": [enc(JSON.stringify(FRIENDS).repeat(40)), { level: 6 }], "json/chat_history.json": enc(CHATS) });
    const friends = scan(zip).find((e) => e.name.endsWith("friends.json")) as Scanned;
    const bad = zip.slice();
    bad.fill(0xff, friends.data[0], friends.data[0] + 8);
    const r = await describeStructureFromReader([bytesReader(bad)]);
    expect(r).toEqual({ ...describeZipStructure(bad), leftOut: NONE });
    expect(r.files.find((f) => f.name === "json/friends.json")?.note).toBe("could not be decompressed");
    expect(r.files.find((f) => f.name === "json/chat_history.json")?.structure).toBeDefined();
  });

  it("keeps names and values out of the report when media, html and json names are personal", async () => {
    const zip = zipFiles({
      [`chat_media/${CANARY}.jpg`]: noise(1, 300),
      [`html/${CANARY}.html`]: enc(`<p>${CANARY}</p>`),
      [`json/${CANARY}.json`]: enc({ [CANARY]: [{ a: CANARY }] }),
    });
    const text = formatStructureReport(await describeStructureFromReader([bytesReader(zip)]));
    expect(text).not.toContain(CANARY);
  });
});

// ----------------------------------------------------------------- scale (500k) ---
// Kept last in the file: these two tests are the heaviest here (about 2 s) and the suite has
// wall-clock-sensitive tests elsewhere.

describe("entry-count cap and scale", () => {
  /** Short names keep the 500k-entry archives small (about 50 MB each). */
  const bigSpecs = (n: number): Spec[] => Array.from({ length: n }, (_, i) => ({ name: `${i % 2 === 0 ? "memories" : "chat_media"}/${i}.jpg` }));

  it("lists 500k entries in linear time (zip64 end record), and parse handles them", async () => {
    const specs: Spec[] = [{ name: "json/friends.json", data: enc(FRIENDS) }, { name: "json/memories_history.json", data: enc(MEMORIES) }, ...bigSpecs(499_998)];
    const zip = flatten(buildZip(specs, { zip64: "end-only" }));

    const t0 = performance.now();
    const { entries, issues } = await listZipEntries(bytesReader(zip));
    const listMs = performance.now() - t0;
    expect(issues).toEqual([]);
    expect(entries).toHaveLength(500_000);
    expect(listMs).toBeLessThan(15_000);

    const t1 = performance.now();
    const parsed = await parseExportFromReader(bytesReader(zip));
    const parseMs = performance.now() - t1;
    expect(parsed.friends.friends.map((f) => f.username)).toEqual(["alice", "bob"]);
    expect(parsed.issues.map((i) => i.code)).toContain("media-not-opened");
    expect(parsed.fileList).toEqual(["json/friends.json", "json/memories_history.json"]);
    expect(parseMs).toBeLessThan(30_000);
  }, 90_000);

  it("stops at the cap when the header under-reports the count (16-bit wrap, no zip64)", async () => {
    const r = await listZipEntries(bytesReader(flatten(buildZip(bigSpecs(500_001)))));
    expect(r.entries).toEqual([]);
    expect(r.issues.map((i) => i.code)).toEqual(["zip-too-many-entries"]);
  }, 90_000);
});
