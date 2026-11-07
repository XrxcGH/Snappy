import { describe, expect, it } from "vitest";
import { embedJpegDate, patchMp4Dates, sniffMediaType } from "../../src/memories/metadata.ts";

// ------------------------------------------------------------ fixtures ----

const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));
const be16 = (v: number): number[] => [(v >> 8) & 0xff, v & 0xff];
const be32 = (v: number): number[] => [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];

function jpegSeg(marker: number, payload: number[]): number[] {
  return [0xff, marker, ...be16(payload.length + 2), ...payload];
}

const JFIF = jpegSeg(0xe0, [...ascii("JFIF"), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
const DQT = jpegSeg(0xdb, [0, ...new Array(64).fill(8)]);
const SOF0 = jpegSeg(0xc0, [8, 0, 1, 0, 1, 1, 1, 0x11, 0]);
const SOF2 = jpegSeg(0xc2, [8, 0, 1, 0, 1, 1, 1, 0x11, 0]); // progressive
const SOS = jpegSeg(0xda, [1, 1, 0, 0, 0x3f, 0]);
// Entropy data containing stuffed FF00 and a fake marker-looking pair.
const SCAN = [0x12, 0x34, 0xff, 0x00, 0xff, 0xd0, 0x56];
const EOI = [0xff, 0xd9];

/** TIFF with IFD0 {Make, Orientation, DateTime} in either byte order (test-side, independent of src). */
function oldExifTiff(little: boolean, orientation: number): number[] {
  const w16 = (v: number) => (little ? [v & 0xff, v >> 8] : be16(v));
  const w32 = (v: number) => (little ? [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, v >>> 24] : be32(v));
  const entry = (tag: number, type: number, count: number, val: number[]) => [
    ...w16(tag),
    ...w16(type),
    ...w32(count),
    ...val,
  ];
  const makeData = [...ascii("Acme"), 0, 0]; // 5 bytes + pad
  const dateData = [...ascii("1999:01:01 00:00:00"), 0];
  const ifdAt = 8;
  const dataAt = ifdAt + 2 + 3 * 12 + 4;
  return [
    ...(little ? ascii("II") : ascii("MM")),
    ...w16(42),
    ...w32(ifdAt),
    ...w16(3),
    ...entry(0x010f, 2, 5, w32(dataAt)),
    ...entry(0x0112, 3, 1, [...w16(orientation), 0, 0]),
    ...entry(0x0132, 2, 20, w32(dataAt + makeData.length)),
    ...w32(0),
    ...makeData,
    ...dateData,
  ];
}

function exifSeg(tiff: number[]): number[] {
  return jpegSeg(0xe1, [...ascii("Exif"), 0, 0, ...tiff]);
}

function buildJpeg(parts: number[][]): Uint8Array {
  return Uint8Array.from([0xff, 0xd8, ...parts.flat(), ...SCAN, ...EOI]);
}

function box(type: string, payload: number[]): number[] {
  return [...be32(payload.length + 8), ...ascii(type), ...payload];
}
const fullBox = (type: string, version: number, body: number[]) => box(type, [version, 0, 0, 0, ...body]);

const MAC_EPOCH = 2082844800;
const fillerV0 = (rest: number) => [...be32(1), ...be32(2), ...new Array(rest).fill(0xee)];
const filler64 = (rest: number) => [...be32(0), ...be32(1), ...be32(0), ...be32(2), ...new Array(rest).fill(0xee)];

interface Mp4Opts {
  mdat?: "normal" | "largesize" | "toEnd";
}

/** ftyp, moov{mvhd v0, trak{tkhd v0, mdia{mdhd v1}}, trak{tkhd v1, mdia{mdhd v0}}}, mdat. */
function buildMp4({ mdat = "normal" }: Mp4Opts = {}): Uint8Array {
  const trak1 = box("trak", [
    ...fullBox("tkhd", 0, fillerV0(60)),
    ...box("mdia", [...fullBox("mdhd", 1, filler64(8)), ...box("hdlr", [0, 0, 0, 0, 1, 2, 3])]),
  ]);
  const trak2 = box("trak", [
    ...fullBox("tkhd", 1, filler64(60)),
    ...box("mdia", fullBox("mdhd", 0, fillerV0(8))),
  ]);
  const moov = box("moov", [...fullBox("mvhd", 0, fillerV0(80)), ...trak1, ...trak2]);
  const data = [9, 9, 9, 9];
  const mdatBox =
    mdat === "normal"
      ? box("mdat", data)
      : mdat === "largesize"
        ? [...be32(1), ...ascii("mdat"), ...be32(0), ...be32(16 + data.length), ...data]
        : [...be32(0), ...ascii("mdat"), ...data];
  return Uint8Array.from([...box("ftyp", [...ascii("isom"), 0, 0, 2, 0, ...ascii("isom")]), ...moov, ...mdatBox]);
}

// --------------------------------------------- independent mini-parsers ----

type Val = { type: number; count: number; raw: Uint8Array; little: boolean; off: number };

interface ParsedExif {
  little: boolean;
  ifd0: Map<number, Val>;
  exif: Map<number, Val>;
  gps: Map<number, Val>;
  app1Count: number;
  order: number[]; // marker order before SOS
}

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1 };

function readIfd(t: DataView, tiff: Uint8Array, little: boolean, at: number): Map<number, Val> {
  const out = new Map<number, Val>();
  const n = t.getUint16(at, little);
  for (let i = 0; i < n; i++) {
    const e = at + 2 + i * 12;
    const type = t.getUint16(e + 2, little);
    const count = t.getUint32(e + 4, little);
    const size = (TYPE_SIZE[type] ?? 1) * count;
    const off = size <= 4 ? e + 8 : t.getUint32(e + 8, little);
    if (size > 4) expect(off % 2).toBe(0); // TIFF word alignment
    expect(off + size).toBeLessThanOrEqual(tiff.length);
    out.set(t.getUint16(e, little), { type, count, raw: tiff.subarray(off, off + size), little, off });
  }
  return out;
}

function parseJpegExif(b: Uint8Array): ParsedExif | null {
  const order: number[] = [];
  let found: ParsedExif | null = null;
  let app1Count = 0;
  let pos = 2;
  while (pos + 4 <= b.length && b[pos] === 0xff && b[pos + 1] !== 0xda) {
    const marker = b[pos + 1] as number;
    const len = ((b[pos + 2] as number) << 8) | (b[pos + 3] as number);
    order.push(marker);
    const payload = b.subarray(pos + 4, pos + 2 + len);
    if (marker === 0xe1 && String.fromCharCode(...payload.subarray(0, 4)) === "Exif") {
      app1Count++;
      const tiff = payload.subarray(6);
      const t = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
      const little = tiff[0] === 0x49;
      expect(t.getUint16(2, little)).toBe(42);
      const ifd0 = readIfd(t, tiff, little, t.getUint32(4, little));
      const sub = (tag: number) => {
        const v = ifd0.get(tag);
        return v ? readIfd(t, tiff, little, t.getUint32(v.off, little)) : new Map<number, Val>();
      };
      found ??= { little, ifd0, exif: sub(0x8769), gps: sub(0x8825), app1Count: 0, order };
    }
    pos += 2 + len;
  }
  if (found) found.app1Count = app1Count;
  return found;
}

const view = (v: Val) => new DataView(v.raw.buffer, v.raw.byteOffset, v.raw.byteLength);
const str = (v: Val | undefined) => {
  if (!v) return undefined;
  const bytes = [...v.raw];
  expect(bytes[bytes.length - 1]).toBe(0); // NUL-terminated
  return String.fromCharCode(...bytes.slice(0, -1));
};
const short = (v: Val | undefined) => (v ? view(v).getUint16(0, v.little) : undefined);

/** Test-side bytes of a 32-bit value in the given TIFF byte order. */
function bytes32(v: number, little: boolean): number[] {
  const b = be32(v);
  return little ? b.reverse() : b;
}

/**
 * Exif TIFF whose IFD0 has {Orientation=6, GPS IFD pointer}; the GPS IFD holds a
 * latitude rational built from the canary numerators (test-side, independent of src).
 */
function exifWithGps(little: boolean, canary: number[]): number[] {
  const w16 = (v: number) => (little ? [v & 0xff, v >> 8] : be16(v));
  const w32 = (v: number) => bytes32(v, little);
  const entry = (tag: number, type: number, count: number, val: number[]) => [...w16(tag), ...w16(type), ...w32(count), ...val];
  const gpsAt = 8 + 2 + 2 * 12 + 4;
  const ratAt = gpsAt + 2 + 2 * 12 + 4;
  return [
    ...(little ? ascii("II") : ascii("MM")),
    ...w16(42),
    ...w32(8),
    ...w16(2),
    ...entry(0x0112, 3, 1, [...w16(6), 0, 0]),
    ...entry(0x8825, 4, 1, w32(gpsAt)),
    ...w32(0),
    ...w16(2),
    ...entry(0x0001, 2, 2, [...ascii("N"), 0, 0, 0]),
    ...entry(0x0002, 5, 3, w32(ratAt)),
    ...w32(0),
    ...w32(canary[0]!), ...w32(1000),
    ...w32(canary[1]!), ...w32(1000),
    ...w32(canary[0]!), ...w32(1000),
  ];
}

function indexOfSub(hay: Uint8Array, needle: number[], from = 0): number {
  outer: for (let i = from; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

interface Hdr {
  type: string;
  version: number;
  creation: number;
  modification: number;
}

/** Independent walker: reads mvhd/tkhd/mdhd in document order. */
function readMp4Dates(b: Uint8Array): Hdr[] {
  const d = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out: Hdr[] = [];
  const walk = (start: number, end: number): void => {
    let p = start;
    while (p + 8 <= end) {
      let size = d.getUint32(p);
      let hdr = 8;
      if (size === 1) {
        size = d.getUint32(p + 8) * 2 ** 32 + d.getUint32(p + 12);
        hdr = 16;
      } else if (size === 0) size = end - p;
      const type = String.fromCharCode(b[p + 4]!, b[p + 5]!, b[p + 6]!, b[p + 7]!);
      if (["moov", "trak", "mdia"].includes(type)) walk(p + hdr, p + size);
      if (["mvhd", "tkhd", "mdhd"].includes(type)) {
        const body = p + hdr;
        const version = b[body]!;
        const rd = (o: number) => (version === 1 ? d.getUint32(o) * 2 ** 32 + d.getUint32(o + 4) : d.getUint32(o));
        out.push({ type, version, creation: rd(body + 4), modification: rd(body + (version === 1 ? 12 : 8)) });
      }
      p += size;
    }
  };
  walk(0, b.length);
  return out;
}

// -------------------------------------------------------------- sniffing ---

describe("sniffMediaType", () => {
  const ftyp = (brand: string) => Uint8Array.from([...be32(24), ...ascii("ftyp"), ...ascii(brand), 0, 0, 0, 0, ...ascii("isom"), ...ascii("mp42")]);

  it("recognises common formats by magic bytes", () => {
    expect(sniffMediaType(buildJpeg([JFIF, DQT, SOF0, SOS]))).toBe("jpeg");
    expect(sniffMediaType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]))).toBe("png");
    expect(sniffMediaType(Uint8Array.from([...ascii("RIFF"), 1, 0, 0, 0, ...ascii("WEBPVP8 ")]))).toBe("webp");
    expect(sniffMediaType(ftyp("isom"))).toBe("mp4");
    expect(sniffMediaType(ftyp("mp42"))).toBe("mp4");
    expect(sniffMediaType(ftyp("qt  "))).toBe("mp4");
    expect(sniffMediaType(ftyp("heic"))).toBe("heic");
    expect(sniffMediaType(ftyp("mif1"))).toBe("heic");
    expect(sniffMediaType(buildMp4())).toBe("mp4");
  });

  it("returns unknown for AVIF, RIFF non-WebP, garbage, short and empty input", () => {
    expect(sniffMediaType(ftyp("avif"))).toBe("unknown");
    expect(sniffMediaType(Uint8Array.from([...ascii("RIFF"), 1, 0, 0, 0, ...ascii("WAVEfmt ")]))).toBe("unknown");
    expect(sniffMediaType(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))).toBe("unknown");
    expect(sniffMediaType(Uint8Array.from([0xff, 0xd8]))).toBe("unknown");
    expect(sniffMediaType(new Uint8Array(0))).toBe("unknown");
  });
});

// ------------------------------------------------------------------ JPEG ---

describe("embedJpegDate", () => {
  const date = Date.UTC(2023, 3, 1, 12, 30, 45, 999);
  const EXIF_TAGS = [0x9000, 0x9003, 0x9004, 0x9011];
  const sorted = (m: Map<number, Val>) => [...m.keys()].sort((a, b) => a - b);

  it("writes only the capture date, which an independent parser reads back", () => {
    const input = buildJpeg([JFIF, DQT, SOF0, SOS]);
    const x = parseJpegExif(embedJpegDate(input, date))!;
    expect(x).not.toBeNull();
    expect(str(x.exif.get(0x9003))).toBe("2023:04:01 12:30:45"); // sub-second truncated, not rounded up
    expect(str(x.exif.get(0x9004))).toBe("2023:04:01 12:30:45");
    expect(str(x.exif.get(0x9011))).toBe("+00:00");
    expect(sorted(x.exif)).toEqual(EXIF_TAGS);
    expect(sorted(x.ifd0)).toEqual([0x8769]); // no orientation to carry, nothing else
    expect(x.gps.size).toBe(0);
  });

  it("formats edge dates in UTC", () => {
    const cases: [number, string][] = [
      [Date.UTC(1970, 0, 1), "1970:01:01 00:00:00"],
      [Date.UTC(2024, 1, 29, 23, 59, 59, 999), "2024:02:29 23:59:59"],
      [Date.UTC(1000, 0, 1), "1000:01:01 00:00:00"],
      [Date.UTC(9999, 11, 31, 23, 59, 59), "9999:12:31 23:59:59"],
    ];
    for (const [ms, expected] of cases) {
      const x = parseJpegExif(embedJpegDate(buildJpeg([DQT, SOF0, SOS]), ms))!;
      expect(str(x.exif.get(0x9003))).toBe(expected);
    }
  });

  it("returns an unchanged copy when the date is unusable", () => {
    const input = buildJpeg([JFIF, SOF0, SOS]);
    for (const bad of [NaN, Infinity, -Infinity, Date.UTC(10000, 0, 1), -62198755200000, 8.64e15 + 1]) {
      const out = embedJpegDate(input, bad);
      expect(out).not.toBe(input);
      expect(out).toEqual(input);
    }
  });

  it.each([
    ["little-endian", true, 6],
    ["big-endian", false, 8],
  ])("carries over only Orientation from existing %s Exif", (_name, little, orientation) => {
    const input = buildJpeg([JFIF, exifSeg(oldExifTiff(little, orientation)), DQT, SOF0, SOS]);
    const out = embedJpegDate(input, date);
    const x = parseJpegExif(out)!;
    expect(x.app1Count).toBe(1); // old Exif replaced, not duplicated
    expect(short(x.ifd0.get(0x0112))).toBe(orientation);
    expect(sorted(x.ifd0)).toEqual([0x0112, 0x8769]);
    expect(indexOfSub(out, ascii("Acme"))).toBe(-1); // Make intentionally dropped
    expect(indexOfSub(out, ascii("1999:01:01"))).toBe(-1); // stale DateTime dropped
    expect(str(x.exif.get(0x9003))).toBe("2023:04:01 12:30:45");
  });

  it("ignores out-of-range or unparseable existing orientation", () => {
    const bad = embedJpegDate(buildJpeg([exifSeg(oldExifTiff(true, 42)), SOF0, SOS]), date);
    expect(parseJpegExif(bad)!.ifd0.has(0x0112)).toBe(false);
    const junk = embedJpegDate(buildJpeg([exifSeg([1, 2, 3]), SOF0, SOS]), date);
    const x = parseJpegExif(junk)!;
    expect(x.app1Count).toBe(1);
    expect(x.ifd0.has(0x0112)).toBe(false);
  });

  it("drops a GPS IFD and its canary coordinate bytes entirely", () => {
    // Canary numerators are distinctive 32-bit values, searched for in both byte orders.
    const canaries = [0x5a17c3e1, 0x2b9d4f07];
    for (const little of [true, false]) {
      const input = buildJpeg([JFIF, exifSeg(exifWithGps(little, canaries)), DQT, SOF0, SOS]);
      expect(indexOfSub(input, bytes32(canaries[0]!, little))).toBeGreaterThan(-1); // sanity: canary is in the input
      const out = embedJpegDate(input, date);
      for (const c of canaries) {
        expect(indexOfSub(out, bytes32(c, true))).toBe(-1);
        expect(indexOfSub(out, bytes32(c, false))).toBe(-1);
      }
      const x = parseJpegExif(out)!;
      expect(x.ifd0.has(0x8825)).toBe(false); // no GPS IFD pointer
      expect(x.gps.size).toBe(0);
      expect(short(x.ifd0.get(0x0112))).toBe(6); // orientation still carried
      expect(str(x.exif.get(0x9003))).toBe("2023:04:01 12:30:45");
    }
  });

  it("drops GPS even when it sits in a second Exif segment", () => {
    const gpsTiff = exifWithGps(true, [0x5a17c3e1, 0x2b9d4f07]);
    const out = embedJpegDate(buildJpeg([exifSeg(oldExifTiff(true, 3)), exifSeg(gpsTiff), SOF0, SOS]), date);
    expect(indexOfSub(out, bytes32(0x5a17c3e1, true))).toBe(-1);
    expect(parseJpegExif(out)!.app1Count).toBe(1);
  });

  it("places Exif after JFIF, or directly after SOI without JFIF, keeping other segments", () => {
    const withJfif = embedJpegDate(buildJpeg([JFIF, DQT, SOF0, SOS]), date);
    expect(parseJpegExif(withJfif)!.order).toEqual([0xe0, 0xe1, 0xdb, 0xc0]);
    const noJfif = embedJpegDate(buildJpeg([DQT, SOF0, SOS]), date);
    expect(parseJpegExif(noJfif)!.order).toEqual([0xe1, 0xdb, 0xc0]);
    const exifFirst = embedJpegDate(buildJpeg([exifSeg(oldExifTiff(true, 3)), JFIF, SOF0, SOS]), date);
    expect(parseJpegExif(exifFirst)!.order).toEqual([0xe0, 0xe1, 0xc0]);
  });

  it("preserves the entropy-coded scan byte-for-byte, including progressive files", () => {
    for (const sof of [SOF0, SOF2]) {
      const input = buildJpeg([JFIF, DQT, sof, SOS]);
      const out = embedJpegDate(input, date);
      const tailLen = SOS.length + SCAN.length + EOI.length;
      expect(out.subarray(out.length - tailLen)).toEqual(input.subarray(input.length - tailLen));
      expect(out[0]).toBe(0xff);
      expect(out[1]).toBe(0xd8);
      expect(parseJpegExif(out)!.order).toContain(sof[1]);
    }
  });

  it("never mutates the input and always returns a new array", () => {
    const input = buildJpeg([JFIF, exifSeg(oldExifTiff(true, 6)), SOF0, SOS]);
    const snapshot = input.slice();
    const out = embedJpegDate(input, date);
    expect(input).toEqual(snapshot);
    expect(out.buffer).not.toBe(input.buffer);
  });

  it("works on a subarray view with a non-zero byteOffset", () => {
    const jpeg = buildJpeg([JFIF, exifSeg(oldExifTiff(false, 5)), SOF0, SOS]);
    const padded = new Uint8Array(jpeg.length + 7);
    padded.set(jpeg, 3);
    const x = parseJpegExif(embedJpegDate(padded.subarray(3, 3 + jpeg.length), date))!;
    expect(short(x.ifd0.get(0x0112))).toBe(5);
  });

  it("returns an unchanged copy for non-JPEG, garbage, truncated or malformed input", () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5]);
    const full = buildJpeg([JFIF, DQT, SOF0, SOS]);
    const cases: Uint8Array[] = [
      png,
      Uint8Array.from([1, 2, 3, 4, 5, 6]),
      new Uint8Array(0),
      Uint8Array.from([0xff, 0xd8]),
      Uint8Array.from([0xff, 0xd8, 0xff]),
      full.subarray(0, 10), // cut inside APP0
      full.subarray(0, JFIF.length + 2 + 5), // cut inside DQT
      full.subarray(0, 2 + JFIF.length + DQT.length + SOF0.length), // header ends before SOS
      Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01, 0, 0]), // length < 2
      Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 1, 2, 3, 4]), // segment length runs past the end
      Uint8Array.from([0xff, 0xd8, 0x12, 0x34, 0x56, 0x78]), // not at a marker
      Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]), // EOI before any scan
    ];
    for (const c of cases) {
      const out = embedJpegDate(c, date);
      expect(out).toEqual(c);
      expect(out).not.toBe(c);
    }
  });

  it("handles a large header (near the 64K segment limit) and many segments", () => {
    const bigProfile = jpegSeg(0xe2, [...ascii("ICC_PROFILE"), 0, ...new Array(64900).fill(0x41)]);
    const out = embedJpegDate(buildJpeg([JFIF, bigProfile, DQT, SOF0, SOS]), date);
    expect(parseJpegExif(out)!.order).toEqual([0xe0, 0xe1, 0xe2, 0xdb, 0xc0]);
    const many = Array.from({ length: 500 }, () => jpegSeg(0xe2, [...ascii("ICC_PROFILE"), 0, 1, 2, 3]));
    expect(parseJpegExif(embedJpegDate(buildJpeg([...many, SOF0, SOS]), date))!.app1Count).toBe(1);
  });

  it("tolerates fill bytes before markers", () => {
    const input = Uint8Array.from([0xff, 0xd8, 0xff, 0xff, ...DQT.slice(1), ...SOF0, ...SOS, ...SCAN, ...EOI]);
    const x = parseJpegExif(embedJpegDate(input, date))!;
    expect(x.order).toEqual([0xe1, 0xdb, 0xc0]);
  });
});

// ------------------------------------------------------------------- MP4 ---

describe("patchMp4Dates", () => {
  const ms = Date.UTC(2023, 3, 1, 12, 30, 0);
  const secs = ms / 1000 + MAC_EPOCH;

  it("patches mvhd, tkhd and mdhd in both v0 and v1 layouts", () => {
    const input = buildMp4();
    const before = readMp4Dates(input);
    expect(before.map((h) => h.type)).toEqual(["mvhd", "tkhd", "mdhd", "tkhd", "mdhd"]);
    expect(before.map((h) => h.version)).toEqual([0, 0, 1, 1, 0]);

    const out = patchMp4Dates(input, ms);
    const after = readMp4Dates(out);
    expect(after).toHaveLength(5);
    for (const h of after) {
      expect(h.creation).toBe(secs);
      expect(h.modification).toBe(secs);
    }
    expect(out.length).toBe(input.length); // no size changes, so offsets stay valid
  });

  it("changes nothing but the date fields", () => {
    const input = buildMp4();
    const out = patchMp4Dates(input, ms);
    let changed = 0;
    for (let i = 0; i < input.length; i++) if (input[i] !== out[i]) changed++;
    // v0: 2x4 bytes; v1: 2x8 bytes. Boxes: 3 v0 (mvhd, tkhd, mdhd) and 2 v1.
    expect(changed).toBeLessThanOrEqual(3 * 8 + 2 * 16);
    expect(out.subarray(out.length - 4)).toEqual(input.subarray(input.length - 4)); // mdat payload intact
  });

  it("walks 64-bit largesize and size==0 (to end) boxes", () => {
    for (const mdat of ["largesize", "toEnd"] as const) {
      const out = patchMp4Dates(buildMp4({ mdat }), ms);
      expect(readMp4Dates(out).every((h) => h.creation === secs)).toBe(true);
    }
  });

  it("handles a moov that uses a 64-bit largesize header", () => {
    const base = buildMp4();
    const moovStart = 20; // ftyp is 8 + 12
    const moovSize = new DataView(base.buffer).getUint32(moovStart);
    const moovBody = base.subarray(moovStart + 8, moovStart + moovSize);
    const rebuilt = Uint8Array.from([
      ...base.subarray(0, moovStart),
      ...be32(1),
      ...ascii("moov"),
      ...be32(0),
      ...be32(moovSize + 8),
      ...moovBody,
      ...base.subarray(moovStart + moovSize),
    ]);
    const out = patchMp4Dates(rebuilt, ms);
    expect(readMp4Dates(out).every((h) => h.creation === secs)).toBe(true);
  });

  it("skips v0 boxes (only) when the date does not fit 32-bit seconds", () => {
    const input = buildMp4();
    const late = Date.UTC(2050, 0, 1); // beyond 2040, the v0 limit
    const out = patchMp4Dates(input, late);
    const lateSecs = late / 1000 + MAC_EPOCH;
    const before = readMp4Dates(input);
    readMp4Dates(out).forEach((h, i) => {
      if (h.version === 1) expect(h.creation).toBe(lateSecs);
      else {
        expect(h.creation).toBe(before[i]!.creation); // untouched, not wrapped
        expect(h.modification).toBe(before[i]!.modification);
      }
    });
  });

  it("returns an unchanged copy for dates before 1904 or non-finite dates", () => {
    const input = buildMp4();
    for (const bad of [Date.UTC(1903, 11, 31), -1e15, NaN, Infinity]) {
      const out = patchMp4Dates(input, bad);
      expect(out).toEqual(input);
      expect(out).not.toBe(input);
    }
  });

  it("accepts exactly 1904-01-01 and the Unix epoch", () => {
    const out = patchMp4Dates(buildMp4(), Date.UTC(1904, 0, 1));
    expect(readMp4Dates(out).every((h) => h.creation === 0)).toBe(true);
    const unix = patchMp4Dates(buildMp4(), 0);
    expect(readMp4Dates(unix).every((h) => h.creation === MAC_EPOCH)).toBe(true);
  });

  it("returns a new array and never mutates the input", () => {
    const input = buildMp4();
    const snapshot = input.slice();
    const out = patchMp4Dates(input, ms);
    expect(input).toEqual(snapshot);
    expect(out).not.toBe(input);
    expect(out.buffer).not.toBe(input.buffer);
  });

  it("returns an unchanged copy when the structure is truncated or invalid", () => {
    const input = buildMp4();
    const moovStart = 20;
    const cases: Uint8Array[] = [
      input.subarray(0, input.length - 2), // mdat cut short
      input.subarray(0, moovStart + 40), // moov cut short
      input.subarray(0, 5),
      Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
      new Uint8Array(0),
      Uint8Array.from([...input, 0, 0, 0]), // trailing partial box header
      // box smaller than its own header
      Uint8Array.from([...be32(4), ...ascii("free")]),
    ];
    // moov child whose size overflows its parent
    const corrupt = input.slice();
    new DataView(corrupt.buffer).setUint32(moovStart + 8, 0x7fffffff); // mvhd size
    cases.push(corrupt);
    // mvhd too small to hold its dates
    const tiny = Uint8Array.from([...box("moov", fullBox("mvhd", 0, [0, 0, 0, 1]))]);
    cases.push(tiny);
    for (const c of cases) {
      const out = patchMp4Dates(c, ms);
      expect(out).toEqual(c);
      expect(out).not.toBe(c);
    }
  });

  it("does not leave a half-patched file when a later box is invalid", () => {
    const input = buildMp4();
    const broken = Uint8Array.from([...input.subarray(0, input.length - 4), 0, 0]); // truncated mdat after valid moov
    const out = patchMp4Dates(broken, ms);
    expect(readMp4Dates(out.subarray(0, broken.length - 10)).length).toBeGreaterThan(0);
    expect(out).toEqual(broken);
  });

  it("ignores date boxes outside the moov/trak/mdia path and unknown versions", () => {
    const stray = Uint8Array.from([...box("free", fullBox("mvhd", 0, fillerV0(8))), ...box("moov", fullBox("mvhd", 7, fillerV0(8)))]);
    expect(patchMp4Dates(stray, ms)).toEqual(stray);
  });

  it("works on a subarray view with a non-zero byteOffset", () => {
    const mp4 = buildMp4();
    const padded = new Uint8Array(mp4.length + 9);
    padded.set(mp4, 5);
    const out = patchMp4Dates(padded.subarray(5, 5 + mp4.length), ms);
    expect(out.length).toBe(mp4.length);
    expect(readMp4Dates(out).every((h) => h.creation === secs)).toBe(true);
  });
});
