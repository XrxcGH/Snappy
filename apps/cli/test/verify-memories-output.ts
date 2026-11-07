/**
 * An independent check of a Memories rescue, written without @snappy-export/core on purpose: it has its
 * own zip directory reader, JPEG/EXIF reader and MP4 box reader, so it cannot share a bug with the
 * code it checks. It compares the output folder with the zips the files came from:
 *
 *  - every output file's name carries a capture time (UTC); the zip entry stored with exactly
 *    that time is its source;
 *  - a JPEG holds that time as Exif DateTimeOriginal and DateTimeDigitized and no GPS data, and
 *    its image data is the source's;
 *  - an MP4 holds it in the mvhd, tkhd and mdhd boxes and is otherwise byte for byte the source;
 *  - an overlay is a byte-for-byte copy of a source overlay;
 *  - every file's modification time is that capture time.
 *
 * Run it by hand on a real rescue folder with: node --experimental-strip-types verify-memories-output.ts <folder> <zip...>
 * (it prints counts and problems, never a name). Synthetic data only in tests.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { inflateRawSync } from "node:zlib";

// ------------------------------------------------------------------- zips ---

interface ZipFile {
  name: string;
  /** Stored UTC mtime in seconds (extended timestamp field), when present. */
  utcSeconds?: number;
  bytes: () => Buffer;
}

/** Entries of one zip, read from its central directory (stored and deflated entries; no zip64). */
function readZip(path: string): ZipFile[] {
  const buf = readFileSync(path);
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error("not a zip");
  const count = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  const files: ZipFile[] = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error("bad central directory");
    const method = buf.readUInt16LE(at + 10);
    const compressed = buf.readUInt32LE(at + 20);
    const nameLength = buf.readUInt16LE(at + 28);
    const extraLength = buf.readUInt16LE(at + 30);
    const commentLength = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.toString("utf8", at + 46, at + 46 + nameLength);

    let utcSeconds: number | undefined;
    for (let e = at + 46 + nameLength; e + 4 <= at + 46 + nameLength + extraLength; ) {
      const id = buf.readUInt16LE(e);
      const size = buf.readUInt16LE(e + 2);
      if (id === 0x5455 && (buf[e + 4] as number) & 1) utcSeconds = buf.readUInt32LE(e + 5);
      e += 4 + size;
    }
    files.push({
      name,
      utcSeconds,
      bytes: () => {
        const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
        const raw = buf.subarray(start, start + compressed);
        return method === 0 ? Buffer.from(raw) : inflateRawSync(raw);
      },
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

interface Source {
  main: ZipFile;
  overlays: ZipFile[];
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Memories files of the zips, by the stored time of the main file (seconds). Overlays join by UUID. */
function sourcesByTime(zipPaths: string[]): Map<number, Source> {
  const files = zipPaths.flatMap(readZip).filter((f) => /(^|\/)memories\//.test(f.name));
  const overlays = new Map<string, ZipFile[]>();
  for (const f of files) {
    const id = UUID.exec(f.name)?.[0]?.toUpperCase();
    if (id !== undefined && f.name.endsWith("-overlay.png")) overlays.set(id, [...(overlays.get(id) ?? []), f]);
  }
  const byTime = new Map<number, Source>();
  for (const f of files) {
    const id = UUID.exec(f.name)?.[0]?.toUpperCase();
    if (id === undefined || !/-main\.\w+$/.test(f.name) || f.utcSeconds === undefined) continue;
    byTime.set(f.utcSeconds, { main: f, overlays: overlays.get(id) ?? [] });
  }
  return byTime;
}

// ------------------------------------------------------------------- JPEG ---

/** Segments of a JPEG up to the scan: marker, payload start and end. Returns where the scan data begins. */
function jpegSegments(b: Buffer): { segments: { marker: number; start: number; end: number }[]; scanAt: number } {
  const segments: { marker: number; start: number; end: number }[] = [];
  let pos = 2;
  while (pos + 4 <= b.length && b[pos] === 0xff) {
    const marker = b[pos + 1] as number;
    const length = b.readUInt16BE(pos + 2);
    segments.push({ marker, start: pos + 4, end: pos + 2 + length });
    pos += 2 + length;
    if (marker === 0xda) break;
  }
  return { segments, scanAt: pos };
}

/** Tags of the IFD at `offset` of a TIFF block, with each ASCII value read where it lives. */
function ifdEntries(tiff: Buffer, offset: number, little: boolean): Map<number, { type: number; count: number; valueAt: number }> {
  const u16 = (at: number): number => (little ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at));
  const u32 = (at: number): number => (little ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at));
  const out = new Map<number, { type: number; count: number; valueAt: number }>();
  const n = u16(offset);
  for (let i = 0; i < n; i++) {
    const at = offset + 2 + i * 12;
    const type = u16(at + 2);
    const count = u32(at + 4);
    const size = (type === 2 || type === 7 || type === 1 ? 1 : type === 3 ? 2 : 4) * count;
    out.set(u16(at), { type, count, valueAt: size <= 4 ? at + 8 : u32(at + 8) });
  }
  return out;
}

interface JpegFacts {
  original?: string;
  digitized?: string;
  hasGps: boolean;
  scan: Buffer;
}

function readJpeg(b: Buffer): JpegFacts {
  const { segments, scanAt } = jpegSegments(b);
  const facts: JpegFacts = { hasGps: false, scan: b.subarray(scanAt) };
  for (const s of segments) {
    if (s.marker !== 0xe1 || b.toString("latin1", s.start, s.start + 4) !== "Exif") continue;
    const tiff = b.subarray(s.start + 6, s.end);
    const little = tiff.toString("latin1", 0, 2) === "II";
    const u32 = (at: number): number => (little ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at));
    const ifd0 = ifdEntries(tiff, u32(4), little);
    if (ifd0.has(0x8825)) facts.hasGps = true;
    const exifPointer = ifd0.get(0x8769);
    if (exifPointer === undefined) continue;
    const exif = ifdEntries(tiff, u32(exifPointer.valueAt), little);
    const text = (tag: number): string | undefined => {
      const e = exif.get(tag);
      return e === undefined ? undefined : tiff.toString("latin1", e.valueAt, e.valueAt + e.count - 1);
    };
    facts.original = text(0x9003);
    facts.digitized = text(0x9004);
  }
  return facts;
}

// -------------------------------------------------------------------- MP4 ---

const MAC_EPOCH = 2082844800;

/** Positions of every creation/modification time in the mvhd, tkhd and mdhd boxes (version 0), and their values. */
function mp4Dates(b: Buffer): { at: number; seconds: number }[] {
  const found: { at: number; seconds: number }[] = [];
  const walk = (start: number, end: number, path: string): void => {
    for (let pos = start; pos + 8 <= end; ) {
      const size = b.readUInt32BE(pos);
      const type = b.toString("latin1", pos + 4, pos + 8);
      if (size < 8 || pos + size > end) return;
      const here = path === "" ? type : `${path}/${type}`;
      if (["moov", "moov/trak", "moov/trak/mdia"].includes(here)) walk(pos + 8, pos + size, here);
      else if (["moov/mvhd", "moov/trak/tkhd", "moov/trak/mdia/mdhd"].includes(here) && b[pos + 8] === 0) {
        for (const at of [pos + 12, pos + 16]) found.push({ at, seconds: b.readUInt32BE(at) - MAC_EPOCH });
      }
      pos += size;
    }
  };
  walk(0, b.length, "");
  return found;
}

/** What the zips hold, for a test's premise: main files per zip, overlay files, and every entry name. */
export function describeZips(zipPaths: string[]): { mainsPerZip: number[]; overlays: number; names: string[] } {
  const zips = zipPaths.map(readZip);
  const memories = zips.map((files) => files.filter((f) => /(^|\/)memories\//.test(f.name)));
  return {
    mainsPerZip: memories.map((files) => files.filter((f) => /-main\.\w+$/.test(f.name)).length),
    overlays: memories.flat().filter((f) => f.name.endsWith("-overlay.png")).length,
    names: zips.flat().map((f) => f.name),
  };
}

// ------------------------------------------------------------------ verify ---

export interface Verification {
  problems: string[];
  /** Counts of what was checked. */
  checked: { jpeg: number; mp4: number; overlays: number; other: number };
}

const NAME = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})_(image|video)_\d{4}(-overlay(?:-\d+)?)?\.([a-z0-9]+)$/;

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? listFiles(join(dir, e.name)) : [join(dir, e.name)]));
}

/**
 * Check every file of a rescue folder against the zips it came from. `forbidden` are strings that
 * must not appear in any output file (locations, names). Problems are described by number only.
 */
export function verifyRescue(outDir: string, zipPaths: string[], forbidden: string[] = []): Verification {
  const sources = sourcesByTime(zipPaths);
  const problems: string[] = [];
  const checked = { jpeg: 0, mp4: 0, overlays: 0, other: 0 };
  const outputMains = new Set<number>();
  const outputOverlays = new Map<number, number>();

  let n = 0;
  for (const path of listFiles(outDir)) {
    const base = path.slice(path.lastIndexOf("\\") > path.lastIndexOf("/") ? path.lastIndexOf("\\") + 1 : path.lastIndexOf("/") + 1);
    if (base === "memories-report.json") continue;
    n++;
    const bad = (what: string): void => void problems.push(`file ${n}: ${what}`);
    const m = NAME.exec(base);
    if (m === null) {
      bad("name is not YYYY-MM-DD_HHMMSS_type_ordinal");
      continue;
    }
    const seconds = Date.UTC(+(m[1] as string), +(m[2] as string) - 1, +(m[3] as string), +(m[4] as string), +(m[5] as string), +(m[6] as string)) / 1000;
    const iso = new Date(seconds * 1000).toISOString();
    const source = sources.get(seconds);
    if (source === undefined) {
      bad("no zip entry is stored with the time in its name");
      continue;
    }
    if (Math.abs(statSync(path).mtimeMs - seconds * 1000) >= 1) bad("modification time differs from the capture time");

    const bytes = readFileSync(path);
    for (const text of forbidden) if (bytes.includes(Buffer.from(text, "utf8"))) bad("contains a forbidden string");
    if (bytes.includes(Buffer.from("GPS", "latin1"))) bad("contains the text GPS");

    if (m[8] !== undefined) {
      checked.overlays++;
      outputOverlays.set(seconds, (outputOverlays.get(seconds) ?? 0) + 1);
      if (!source.overlays.some((o) => o.bytes().equals(bytes))) bad("overlay is not a byte-for-byte copy of a source overlay");
      continue;
    }

    outputMains.add(seconds);
    const original = source.main.bytes();
    if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      checked.jpeg++;
      const facts = readJpeg(bytes);
      const want = `${iso.slice(0, 4)}:${iso.slice(5, 7)}:${iso.slice(8, 10)} ${iso.slice(11, 19)}`;
      if (facts.original !== want) bad("Exif DateTimeOriginal is not the capture time");
      if (facts.digitized !== want) bad("Exif DateTimeDigitized is not the capture time");
      if (facts.hasGps) bad("has a GPS block");
      if (!facts.scan.equals(readJpeg(original).scan)) bad("image data differs from the source");
    } else if (bytes.toString("latin1", 4, 8) === "ftyp") {
      checked.mp4++;
      const dates = mp4Dates(bytes);
      if (dates.length === 0) bad("no dates found in the MP4 boxes");
      for (const d of dates) if (d.seconds !== seconds) bad("an MP4 box date is not the capture time");
      const skip = new Set(dates.flatMap((d) => [d.at, d.at + 1, d.at + 2, d.at + 3]));
      if (bytes.length !== original.length || bytes.some((v, i) => !skip.has(i) && v !== original[i])) bad("MP4 differs from the source outside its date fields");
    } else {
      checked.other++;
      bad("is neither a JPEG nor an MP4");
    }
  }

  for (const [seconds, source] of sources) {
    if (outputMains.has(seconds) && (outputOverlays.get(seconds) ?? 0) !== source.overlays.length) problems.push("an overlay is missing or extra");
  }
  return { problems, checked };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [folder, ...zips] = process.argv.slice(2);
  if (folder === undefined || zips.length === 0) {
    process.stderr.write("Usage: verify-memories-output.ts <rescue folder> <zip...>\n");
    process.exitCode = 2;
  } else {
    const { problems, checked } = verifyRescue(folder, zips);
    process.stdout.write(`${JSON.stringify(checked)}\n${problems.length === 0 ? "No problems found.\n" : `${problems.join("\n")}\n`}`);
    process.exitCode = problems.length === 0 ? 0 : 1;
  }
}
