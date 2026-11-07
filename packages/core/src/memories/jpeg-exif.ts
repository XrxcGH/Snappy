// Exif APP1 date writer for JPEG bytes. Pure byte manipulation: it only walks
// marker-segment headers and never decodes (or inspects) image data.

// TIFF field types used below.
const T_ASCII = 2;
const T_SHORT = 3;
const T_LONG = 4;
const T_UNDEFINED = 7;

const SOI = 0xd8;
const SOS = 0xda;
const APP0 = 0xe0;
const APP1 = 0xe1;
const APP2 = 0xe2;
const APP14 = 0xee;
const APP15 = 0xef;
const COM = 0xfe;

interface Segment {
  marker: number;
  /** Offset of the 0xFF marker byte. */
  start: number;
  /** Offset just past the segment's payload. */
  end: number;
}

interface IfdEntry {
  tag: number;
  type: number;
  count: number;
  data: Uint8Array;
}

/**
 * Returns a copy of `bytes` whose Exif APP1 segment holds only a capture date
 * (DateTimeOriginal/DateTimeDigitized, UTC) and, if present, the old Orientation.
 *
 * Privacy decision (intentional): Orientation is the ONLY pre-existing Exif value
 * ever read, because it is a rendering flag. Every other existing Exif tag
 * (GPS, Make/Model, thumbnail, maker notes, stale dates) is dropped without being
 * inspected, so nothing personal is carried into the output. No GPS is ever written.
 *
 * The same goes for every other container that can hold free-form personal metadata. Only a short
 * list of structural and rendering segments is kept, by name: JFIF (APP0), the ICC color profile
 * (APP2 "ICC_PROFILE") and Adobe's color transform flag (APP14), plus the tables, frame and scan
 * headers. Every other application segment (APP1 Exif, XMP and extended XMP, APP3 "Meta" blocks,
 * APP11 JUMBF/C2PA identity claims, APP12 "Ducky" captions, APP13 Photoshop/IPTC, vendor blocks)
 * and every COM comment is dropped without being read. A list of what to keep, not of what to
 * drop, so a container nobody has heard of yet is dropped too.
 *
 * Non-JPEG, truncated or malformed input, or an unusable date, yields an
 * unchanged copy; this function never throws on bad data and never mutates input.
 */
export function embedJpegDate(bytes: Uint8Array, dateMs: number): Uint8Array {
  // A real copy: on a Node Buffer, slice() is a view over the caller's memory.
  const unchanged = () => new Uint8Array(bytes);

  const walk = walkJpegHeader(bytes);
  if (!walk) return unchanged();

  const date = formatExifDate(dateMs);
  if (!date) return unchanged();

  let orientation: number | undefined;
  for (const seg of walk.segments) {
    if (seg.marker === APP1 && isExifSegment(bytes, seg)) {
      orientation = readOrientation(bytes, seg);
      if (orientation !== undefined) break;
    }
  }

  const tiff = buildTiff(orientation, date);
  const payloadLen = 2 + 6 + tiff.length; // length field counts itself
  const app1 = new Uint8Array(2 + payloadLen);
  app1[0] = 0xff;
  app1[1] = APP1;
  app1[2] = payloadLen >> 8;
  app1[3] = payloadLen & 0xff;
  app1.set([0x45, 0x78, 0x69, 0x66, 0, 0], 4); // "Exif\0\0"
  app1.set(tiff, 10);

  // Exif may follow JFIF APP0 but must not precede it, so keep JFIF first.
  const kept = walk.segments.filter((s) => isKeptSegment(bytes, s));
  const first = kept[0];
  const insertAt = first && isJfifSegment(bytes, first) ? 1 : 0;

  let total = 2 + app1.length + (bytes.length - walk.scanStart);
  for (const s of kept) total += s.end - s.start;
  const out = new Uint8Array(total);
  out[0] = 0xff;
  out[1] = SOI;
  let pos = 2;
  const put = (chunk: Uint8Array) => {
    out.set(chunk, pos);
    pos += chunk.length;
  };
  kept.forEach((s, i) => {
    if (i === insertAt) put(app1);
    put(bytes.subarray(s.start, s.end));
  });
  if (insertAt >= kept.length) put(app1);
  put(bytes.subarray(walk.scanStart));
  return out;
}

/**
 * Walks marker segments from SOI up to SOS. Entropy-coded data is never
 * scanned, so baseline and progressive files take the same path. Returns null
 * for anything that is not a complete, well-formed header (including files
 * truncated before SOS).
 */
function walkJpegHeader(bytes: Uint8Array): { segments: Segment[]; scanStart: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== SOI) return null;
  const segments: Segment[] = [];
  let pos = 2;
  for (;;) {
    if (pos + 1 >= bytes.length) return null;
    if (bytes[pos] !== 0xff) return null;
    const marker = bytes[pos + 1] as number;
    if (marker === 0xff) {
      pos++; // fill byte before a marker
      continue;
    }
    if (marker === SOS) return { segments, scanStart: pos };
    // EOI/SOI/RSTn/TEM/stuffed zero have no length and cannot appear before SOS.
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) return null;
    if (pos + 4 > bytes.length) return null;
    const len = ((bytes[pos + 2] as number) << 8) | (bytes[pos + 3] as number);
    const end = pos + 2 + len;
    if (len < 2 || end > bytes.length) return null;
    segments.push({ marker, start: pos, end });
    pos = end;
  }
}

function hasAscii(bytes: Uint8Array, at: number, text: string): boolean {
  if (at + text.length > bytes.length) return false;
  for (let i = 0; i < text.length; i++) if (bytes[at + i] !== text.charCodeAt(i)) return false;
  return true;
}

function isExifSegment(bytes: Uint8Array, seg: Segment): boolean {
  return hasAscii(bytes, seg.start + 4, "Exif\0\0") && seg.start + 10 <= seg.end;
}

/**
 * What passes through: everything that is not an application segment or a comment (tables, frame
 * headers and the like), plus JFIF, the ICC profile and the Adobe flag. All else is dropped.
 */
function isKeptSegment(bytes: Uint8Array, seg: Segment): boolean {
  if (seg.marker === COM) return false;
  if (seg.marker < APP0 || seg.marker > APP15) return true;
  if (seg.marker === APP0) return isJfifSegment(bytes, seg);
  if (seg.marker === APP2) return hasAscii(bytes, seg.start + 4, "ICC_PROFILE\0");
  if (seg.marker === APP14) return hasAscii(bytes, seg.start + 4, "Adobe");
  return false;
}

function isJfifSegment(bytes: Uint8Array, seg: Segment): boolean {
  return seg.marker === APP0 && hasAscii(bytes, seg.start + 4, "JFIF\0");
}

/**
 * Reads IFD0 Orientation (0x0112) from an existing Exif segment: the only value
 * this module ever takes from pre-existing metadata. Malformed Exif is common in
 * the wild, so any out-of-bounds read simply means "no orientation".
 */
function readOrientation(bytes: Uint8Array, seg: Segment): number | undefined {
  const tiffStart = seg.start + 10;
  const view = new DataView(bytes.buffer, bytes.byteOffset + tiffStart, seg.end - tiffStart);
  try {
    const order = view.getUint16(0);
    if (order !== 0x4949 && order !== 0x4d4d) return undefined;
    const little = order === 0x4949;
    if (view.getUint16(2, little) !== 42) return undefined;
    const ifd = view.getUint32(4, little);
    const count = view.getUint16(ifd, little);
    for (let i = 0; i < count; i++) {
      const e = ifd + 2 + i * 12;
      if (view.getUint16(e, little) !== 0x0112) continue;
      if (view.getUint16(e + 2, little) !== T_SHORT || view.getUint32(e + 4, little) !== 1) return undefined;
      const value = view.getUint16(e + 8, little);
      return value >= 1 && value <= 8 ? value : undefined;
    }
  } catch (err) {
    if (!(err instanceof RangeError)) throw err;
  }
  return undefined;
}

// ------------------------------------------------------------ validation ---

/** "YYYY:MM:DD HH:MM:SS" in UTC; sub-second part is truncated, never rounded up. */
function formatExifDate(ms: number): string | undefined {
  if (!Number.isFinite(ms)) return undefined;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return undefined;
  const year = d.getUTCFullYear();
  // Exif dates are fixed-width; reject years that would not fit 4 digits.
  if (year < 1000 || year > 9999) return undefined;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${year}:${p(d.getUTCMonth() + 1)}:${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

// ------------------------------------------------------------ TIFF build ---

/** Little-endian TIFF with IFD0 {Orientation?, ExifIFD pointer} and an Exif IFD of dates. */
function buildTiff(orientation: number | undefined, dateTime: string): Uint8Array {
  const exifEntries: IfdEntry[] = [
    entry(0x9000, T_UNDEFINED, 4, ascii4("0231")), // ExifVersion
    asciiEntry(0x9003, dateTime), // DateTimeOriginal
    asciiEntry(0x9004, dateTime), // DateTimeDigitized
    asciiEntry(0x9011, "+00:00"), // OffsetTimeOriginal: we only know UTC
  ];

  // Entry sizes do not depend on the pointer value, so measure with a dummy first.
  const ifd0 = (exifOffset: number): IfdEntry[] => [
    ...(orientation !== undefined ? [entry(0x0112, T_SHORT, 1, u16(orientation))] : []),
    entry(0x8769, T_LONG, 1, u32(exifOffset)),
  ];

  const exifOffset = 8 + ifdSize(ifd0(0));
  const out = new Uint8Array(exifOffset + ifdSize(exifEntries));
  const view = new DataView(out.buffer);
  out.set([0x49, 0x49, 0x2a, 0x00], 0); // "II", 42
  view.setUint32(4, 8, true);
  writeIfd(out, view, 8, ifd0(exifOffset));
  writeIfd(out, view, exifOffset, exifEntries);
  return out;
}

function entry(tag: number, type: number, count: number, data: Uint8Array): IfdEntry {
  return { tag, type, count, data };
}

function asciiEntry(tag: number, text: string): IfdEntry {
  const data = new Uint8Array(text.length + 1); // NUL-terminated, counted
  for (let i = 0; i < text.length; i++) data[i] = text.charCodeAt(i) & 0x7f;
  return entry(tag, T_ASCII, data.length, data);
}

function ascii4(text: string): Uint8Array {
  return Uint8Array.of(text.charCodeAt(0), text.charCodeAt(1), text.charCodeAt(2), text.charCodeAt(3));
}

function u16(v: number): Uint8Array {
  return Uint8Array.of(v & 0xff, (v >> 8) & 0xff);
}

function u32(v: number): Uint8Array {
  return Uint8Array.of(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
}

/** Values over 4 bytes live after the entry table, word-aligned per TIFF. */
function paddedLen(data: Uint8Array): number {
  return data.length + (data.length & 1);
}

function ifdSize(entries: IfdEntry[]): number {
  let size = 2 + entries.length * 12 + 4;
  for (const e of entries) if (e.data.length > 4) size += paddedLen(e.data);
  return size;
}

/** Entries must already be sorted by tag. Next-IFD pointer stays 0 (zero-filled buffer). */
function writeIfd(out: Uint8Array, view: DataView, offset: number, entries: IfdEntry[]): void {
  view.setUint16(offset, entries.length, true);
  let dataPos = offset + 2 + entries.length * 12 + 4;
  entries.forEach((e, i) => {
    const at = offset + 2 + i * 12;
    view.setUint16(at, e.tag, true);
    view.setUint16(at + 2, e.type, true);
    view.setUint32(at + 4, e.count, true);
    if (e.data.length <= 4) {
      out.set(e.data, at + 8);
    } else {
      view.setUint32(at + 8, dataPos, true);
      out.set(e.data, dataPos);
      dataPos += paddedLen(e.data);
    }
  });
}
