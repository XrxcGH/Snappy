// Media metadata helpers for the memories exporter: sniffing, JPEG capture date, MP4 dates.
// Blind to personal data: pure byte manipulation of file structure only (never pixels, audio,
// frames or location). Functions never mutate their input.

export { embedJpegDate } from "./jpeg-exif.ts";
export { patchMp4Dates } from "./mp4-dates.ts";

export type SniffedMediaType = "jpeg" | "png" | "webp" | "heic" | "mp4" | "unknown";

// HEIF still-image brands. "mif1"/"msf1" are generic HEIF; treated as HEIC.
const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]);
// AVIF shares the ftyp container but is not video and not HEIC.
const AVIF_BRANDS = new Set(["avif", "avis"]);

function asciiAt(bytes: Uint8Array, at: number, length: number): string {
  let s = "";
  for (let i = 0; i < length; i++) s += String.fromCharCode(bytes[at + i] ?? 0);
  return s;
}

/** Identifies media by magic bytes; file extensions from exports are not trusted. */
export function sniffMediaType(bytes: Uint8Array): SniffedMediaType {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 8 && asciiAt(bytes, 1, 3) === "PNG" && bytes[0] === 0x89 && bytes[4] === 0x0d) return "png";
  if (bytes.length >= 12 && asciiAt(bytes, 0, 4) === "RIFF" && asciiAt(bytes, 8, 4) === "WEBP") return "webp";
  if (bytes.length >= 12 && asciiAt(bytes, 4, 4) === "ftyp") {
    const brand = asciiAt(bytes, 8, 4);
    if (HEIC_BRANDS.has(brand)) return "heic";
    if (AVIF_BRANDS.has(brand)) return "unknown";
    // isom, mp41/2, qt, M4V, 3gp*, dash ... all handled as ISO-BMFF video.
    return "mp4";
  }
  return "unknown";
}
