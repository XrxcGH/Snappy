// In-place (same-size) creation/modification time patching for ISO-BMFF files.

/** Seconds between the QuickTime epoch (1904-01-01 UTC) and the Unix epoch. */
const MAC_EPOCH_OFFSET_S = 2082844800;
const U32_LIMIT = 2 ** 32;

type Kind = "container" | "dates";

/**
 * Only the boxes that carry dates are visited. Keyed by the path of the parent
 * box ("" = file root) so e.g. a stray mdhd outside moov/trak/mdia is ignored.
 */
const CHILDREN: Record<string, Record<string, Kind>> = {
  "": { moov: "container" },
  moov: { mvhd: "dates", trak: "container" },
  "moov/trak": { tkhd: "dates", mdia: "container" },
  "moov/trak/mdia": { mdhd: "dates" },
};

/**
 * Returns a copy with creation_time/modification_time of mvhd, tkhd and mdhd
 * set to `ms`. Nothing changes size, so no chunk offsets need rewriting.
 *
 * Any structural problem (truncation, bad box sizes) yields an unchanged copy
 * instead of a half-patched file. Version 0 boxes hold unsigned 32-bit
 * seconds (1904..2040); a date outside that range skips just those boxes
 * rather than wrapping around into a wrong year.
 */
export function patchMp4Dates(bytes: Uint8Array, ms: number): Uint8Array {
  // Always a real copy: on a Node Buffer, slice() is a view over the caller's memory, so patching
  // it would modify the input and the "unchanged copy" fallback would alias patched bytes.
  const copy = (): Uint8Array => new Uint8Array(bytes);
  const out = copy();
  const secs = Math.floor(ms / 1000) + MAC_EPOCH_OFFSET_S;
  // Unsigned fields cannot represent pre-1904; NaN/Infinity also fail here.
  if (!Number.isSafeInteger(secs) || secs < 0) return out;

  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  return walkBoxes(view, 0, out.length, "", secs) ? out : copy();
}

/** Returns false if the box structure is invalid; boxes may be partially patched then. */
function walkBoxes(view: DataView, start: number, end: number, path: string, secs: number): boolean {
  const children = CHILDREN[path];
  if (!children) return true;
  let pos = start;
  while (pos < end) {
    if (end - pos < 8) return false;
    let size = view.getUint32(pos);
    let header = 8;
    if (size === 1) {
      // 64-bit largesize follows the type.
      if (end - pos < 16) return false;
      const hi = view.getUint32(pos + 8);
      if (hi > 0x1fffff) return false; // beyond 2^53, cannot be a real size here
      size = hi * U32_LIMIT + view.getUint32(pos + 12);
      header = 16;
    } else if (size === 0) {
      size = end - pos; // box runs to the end of its container
    }
    if (size < header || size > end - pos) return false;

    const type = String.fromCharCode(
      view.getUint8(pos + 4),
      view.getUint8(pos + 5),
      view.getUint8(pos + 6),
      view.getUint8(pos + 7),
    );
    const kind = Object.hasOwn(children, type) ? children[type] : undefined;
    if (kind === "container") {
      if (!walkBoxes(view, pos + header, pos + size, path ? `${path}/${type}` : type, secs)) return false;
    } else if (kind === "dates") {
      if (!patchDates(view, pos + header, pos + size, secs)) return false;
    }
    pos += size;
  }
  return true;
}

/** mvhd, tkhd and mdhd all start with version/flags, then creation, modification time. */
function patchDates(view: DataView, bodyStart: number, bodyEnd: number, secs: number): boolean {
  const room = bodyEnd - bodyStart;
  if (room < 4) return false;
  const version = view.getUint8(bodyStart);
  if (version === 0) {
    if (room < 12) return false;
    if (secs >= U32_LIMIT) return true; // would overflow; leave this box alone
    view.setUint32(bodyStart + 4, secs);
    view.setUint32(bodyStart + 8, secs);
  } else if (version === 1) {
    if (room < 20) return false;
    const hi = Math.floor(secs / U32_LIMIT);
    const lo = secs % U32_LIMIT;
    for (const at of [bodyStart + 4, bodyStart + 12]) {
      view.setUint32(at, hi);
      view.setUint32(at + 4, lo);
    }
  }
  // Unknown versions are skipped: we cannot know their layout.
  return true;
}
