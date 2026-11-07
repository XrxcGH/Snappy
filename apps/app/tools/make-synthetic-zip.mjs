/**
 * Writes a large SYNTHETIC export zip to disk for testing the desktop app's big-file path. Never
 * point it at, or compare it with, a real export: every byte here is generated.
 *
 * What it writes: the core test generator's export (friends, chat history, memories ...), plus
 * "media" entries (stored, deterministic noise) until the file reaches the requested size. The
 * JSON files sit on both sides of the media, so some reads happen far into the file. With
 * --zip64 every entry uses zip64 fields (needed past 4 GiB, and a good test below it too).
 *
 *   node --experimental-strip-types tools/make-synthetic-zip.mjs --out <file.zip> [--mb 600] [--zip64]
 *        [--friends 400] [--messages 150000] [--memories 4000]
 *
 * Nothing is read, sent or kept anywhere else. Writing is streamed: memory stays small.
 */
import { closeSync, openSync, writeSync } from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { buildSyntheticExport } from "@snappy-export/core";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const out = arg("out");
if (!out) {
  console.error("usage: make-synthetic-zip.mjs --out <file.zip> [--mb 600] [--zip64]");
  process.exit(2);
}
const targetBytes = Number(arg("mb", "600")) * 1024 * 1024;
const z64 = process.argv.includes("--zip64");
const NOW = Date.UTC(2026, 10, 6, 12);

const files = buildSyntheticExport({
  now: NOW,
  phase: 2,
  realisticMemories: true,
  friendCount: Number(arg("friends", "400")),
  chatMessageCount: Number(arg("messages", "150000")),
  memoryCount: Number(arg("memories", "4000")),
});

const fd = openSync(path.resolve(out), "w");
let pos = 0;
const put = (buf, at = pos) => {
  let done = 0;
  while (done < buf.length) done += writeSync(fd, buf, done, buf.length - done, at + done);
  if (at === pos) pos += buf.length;
};

class Buf {
  parts = [];
  u16(v) { const b = Buffer.alloc(2); b.writeUInt16LE(v); this.parts.push(b); return this; }
  u32(v) { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); this.parts.push(b); return this; }
  u64(v) { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); this.parts.push(b); return this; }
  raw(b) { this.parts.push(Buffer.from(b)); return this; }
  take() { return Buffer.concat(this.parts); }
}

const d = new Date(NOW);
const dosTime = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1);
const dosDate = ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
// Extended timestamp (0x5455): the export date core reads as "generated at".
const tsExtra = new Buf().u16(0x5455).u16(5).raw([1]).u32(Math.floor(NOW / 1000)).take();
const MAX32 = 0xffffffff;
const central = [];

/** Writes one entry. `chunks` yields the bytes to store; `method` 0 stores them, 8 means they are already raw-deflated. */
function entry(name, method, chunks, usize) {
  const nameBytes = Buffer.from(name, "utf8");
  const offset = pos;
  const z64Extra = z64 ? new Buf().u16(0x0001).u16(16).u64(0).u64(0).take() : Buffer.alloc(0);
  const extra = Buffer.concat([tsExtra, z64Extra]);
  const header = new Buf()
    .u32(0x04034b50).u16(z64 ? 45 : 20).u16(0x0800).u16(method).u16(dosTime).u16(dosDate)
    .u32(0).u32(z64 ? MAX32 : 0).u32(z64 ? MAX32 : 0).u16(nameBytes.length).u16(extra.length)
    .raw(nameBytes).raw(extra).take();
  put(header);
  let crc = 0;
  let csize = 0;
  let size = 0;
  for (const chunk of chunks) {
    crc = zlib.crc32(chunk.crcOf ?? chunk.data, crc);
    size += chunk.crcOf ? chunk.crcOf.length : chunk.data.length;
    csize += chunk.data.length;
    put(chunk.data);
  }
  if (usize !== undefined && usize !== size) throw new Error("size mismatch");
  // Patch the local header now that the CRC and sizes are known.
  put(Buffer.from(new Buf().u32(crc).take()), offset + 14);
  if (z64) put(new Buf().u64(size).u64(csize).take(), offset + 30 + nameBytes.length + tsExtra.length + 4);
  else put(new Buf().u32(csize).u32(size).take(), offset + 18);
  const cExtra = z64 ? Buffer.concat([tsExtra, new Buf().u16(0x0001).u16(24).u64(size).u64(csize).u64(offset).take()]) : tsExtra;
  central.push(
    new Buf()
      .u32(0x02014b50).u16(z64 ? 45 : 20).u16(z64 ? 45 : 20).u16(0x0800).u16(method).u16(dosTime).u16(dosDate)
      .u32(crc).u32(z64 ? MAX32 : csize).u32(z64 ? MAX32 : size)
      .u16(nameBytes.length).u16(cExtra.length).u16(0).u16(0).u16(0).u32(0).u32(z64 ? MAX32 : offset)
      .raw(nameBytes).raw(cExtra).take(),
  );
}

const deflatedOf = new Map(Object.entries(files).map(([name, bytes]) => [name, zlib.deflateRawSync(Buffer.from(bytes), { level: 3 })]));
const jsonEntry = (name, bytes) => entry(name, 8, [{ data: deflatedOf.get(name), crcOf: Buffer.from(bytes) }], bytes.length);

// One block of deterministic noise, repeated: incompressible-looking like photos and videos.
const block = Buffer.alloc(1024 * 1024);
let x = 0x2545f491;
for (let i = 0; i < block.length; i += 4) {
  x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
  block.writeUInt32LE(x, i);
}

function* noise(bytes) {
  for (let left = bytes; left > 0; left -= block.length) yield { data: left >= block.length ? block : block.subarray(0, left) };
}

const early = Object.keys(files).filter((n) => /account\.json|friends\.json/.test(n)).sort();
const late = Object.keys(files).filter((n) => !early.includes(n)).sort();
const jsonBytesTotal = Object.values(files).reduce((n, b) => n + b.length, 0);
const lateCompressed = late.reduce((n, name) => n + 200 + name.length * 2 + deflatedOf.get(name).length, 0);

const started = Date.now();
for (const name of early) jsonEntry(name, files[name]);
const padSize = 64 * 1024 * 1024;
const reserve = lateCompressed + 1024 * 1024; // room for the files written after the media, and the directory
for (let i = 0; pos < targetBytes - reserve; i++) {
  const size = Math.max(1024, Math.min(padSize, targetBytes - reserve - pos));
  entry(`memories/2025-01-${String((i % 28) + 1).padStart(2, "0")}_00000000-0000-4000-8000-${String(i).padStart(12, "0")}-main.mp4`, 0, noise(size), size);
}
for (const name of late) jsonEntry(name, files[name]);

const cdStart = pos;
for (const c of central) put(c);
const cdSize = pos - cdStart;
if (z64) {
  const eocd64 = pos;
  put(new Buf().u32(0x06064b50).u64(44).u16(45).u16(45).u32(0).u32(0).u64(central.length).u64(central.length).u64(cdSize).u64(cdStart).take());
  put(new Buf().u32(0x07064b50).u32(0).u64(eocd64).u32(1).take());
  put(new Buf().u32(0x06054b50).u16(0).u16(0).u16(0xffff).u16(0xffff).u32(MAX32).u32(MAX32).u16(0).take());
} else {
  put(new Buf().u32(0x06054b50).u16(0).u16(0).u16(central.length).u16(central.length).u32(cdSize).u32(cdStart).u16(0).take());
}
closeSync(fd);
console.log(
  `wrote ${path.resolve(out)}: ${(pos / 1048576).toFixed(0)} MiB, ${central.length} entries, ${z64 ? "zip64" : "plain zip"}, ` +
    `JSON ${(jsonBytesTotal / 1048576).toFixed(1)} MiB uncompressed, ${((Date.now() - started) / 1000).toFixed(1)} s`,
);
