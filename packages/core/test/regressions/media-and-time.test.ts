/**
 * Regression tests: Buffer aliasing in the byte patchers, personal metadata containers in JPEGs,
 * the memories dedupe key, and timestamp parsing that must not depend on the machine's time zone.
 */
import { describe, expect, it } from "vitest";
import { embedJpegDate, patchMp4Dates, planMemories } from "../../src/index.ts";
import type { MemoryItem } from "../../src/types.ts";
import { toMs } from "../../src/util.ts";

const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));
const u32 = (n: number): number[] => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const box = (type: string, payload: number[]): number[] => [...u32(8 + payload.length), ...ascii(type), ...payload];

/** ftyp + moov(mvhd v0) with creation/modification time 0. */
function mp4(tail: number[] = []): Uint8Array {
  const mvhd = box("mvhd", [0, 0, 0, 0, ...u32(0), ...u32(0), ...new Array(80).fill(0)]);
  return Uint8Array.from([...box("ftyp", ascii("isom\0\0\0\0")), ...box("moov", mvhd), ...tail]);
}

const DATE = Date.UTC(2020, 5, 15, 8, 30, 0);

describe("patchMp4Dates with a Node Buffer", () => {
  it("does not modify the caller's buffer and returns a separate copy", () => {
    const input = Buffer.from(mp4());
    const before = Buffer.from(input);
    const out = patchMp4Dates(input, DATE);
    expect(input.equals(before)).toBe(true);
    expect(Buffer.from(out).equals(before)).toBe(false); // really patched
    out[0] = 0xee;
    expect(input.equals(before)).toBe(true); // no shared memory
  });

  it("a structural failure after a patched box returns an UNCHANGED copy and leaves the input alone", () => {
    const input = Buffer.from(mp4([1, 2, 3])); // a malformed 3-byte tail after moov
    const before = Buffer.from(input);
    const out = patchMp4Dates(input, DATE);
    expect(input.equals(before)).toBe(true);
    expect(Buffer.from(out).equals(before)).toBe(true);
    out[0] = 0xee;
    expect(input.equals(before)).toBe(true);
  });

  it("behaves the same for a plain Uint8Array", () => {
    const input = mp4([1, 2, 3]);
    const before = new Uint8Array(input);
    expect(patchMp4Dates(input, DATE)).toEqual(before);
    expect(input).toEqual(before);
  });
});

describe("embedJpegDate", () => {
  it("returns a real copy of a non-JPEG Buffer", () => {
    const input = Buffer.from([1, 2, 3, 4, 5]);
    const out = embedJpegDate(input, DATE);
    expect(Buffer.from(out).equals(input)).toBe(true);
    out[0] = 99;
    expect(input[0]).toBe(1);
  });

  const seg = (marker: number, payload: number[]): number[] => [0xff, marker, ...[(payload.length + 2) >> 8, (payload.length + 2) & 255], ...payload];
  const text = (b: Uint8Array): string => Buffer.from(b).toString("latin1");

  it("drops XMP, COM and IPTC (APP13) segments, which can hold GPS, captions and a stale date", () => {
    const jpeg = Uint8Array.from([
      0xff, 0xd8,
      ...seg(0xe0, [...ascii("JFIF\0"), 1, 1, 0, 0, 1, 0, 1, 0, 0]),
      ...seg(0xe1, [...ascii("http://ns.adobe.com/xap/1.0/\0"), ...ascii("<x exif:GPSLatitude='13.371337' CreateDate='1999-01-01'/>")]),
      ...seg(0xe1, [...ascii("http://ns.adobe.com/xmp/extension/\0"), ...ascii("EXTENDEDXMPSECRET")]),
      ...seg(0xed, [...ascii("Photoshop 3.0\0"), ...ascii("IPTCCAPTIONSECRET")]),
      ...seg(0xfe, ascii("COMMENTSECRET")),
      ...seg(0xe2, [...ascii("ICC_PROFILE\0"), 1, 1, 9, 9, 9]),
      ...seg(0xdb, [0, ...new Array(64).fill(8)]),
      ...seg(0xc0, [8, 0, 1, 0, 1, 1, 1, 0x11, 0]),
      ...seg(0xda, [1, 1, 0, 0, 0x3f, 0]),
      0x12, 0x34, 0xff, 0xd9,
    ]);
    const out = embedJpegDate(jpeg, DATE);
    const t = text(out);
    for (const secret of ["13.371337", "1999-01-01", "EXTENDEDXMPSECRET", "IPTCCAPTIONSECRET", "COMMENTSECRET", "adobe.com"]) {
      expect(t, secret).not.toContain(secret);
    }
    // The new date and the structural segments are there.
    expect(t).toContain("2020:06:15 08:30:00");
    expect(t).toContain("ICC_PROFILE");
    expect(t).toContain("JFIF");
    // Exactly one APP1 (the new Exif), and the scan data is untouched.
    let app1 = 0;
    for (let i = 0; i + 1 < out.length; i++) if (out[i] === 0xff && out[i + 1] === 0xe1) app1++;
    expect(app1).toBe(1);
    expect([...out.subarray(out.length - 4)]).toEqual([0x12, 0x34, 0xff, 0xd9]);
  });
});

describe("planMemories dedupe key", () => {
  const item = (id: string, zipPath: string, sizeBytes: number): MemoryItem => ({
    id,
    date: Date.UTC(2023, 3, 1, 12, 30, 0),
    mediaType: "image",
    zipPath,
    sizeBytes,
  });

  it("does not merge two different files that are both empty (size 0)", () => {
    const plan = planMemories([item("a", "memories/a.jpg", 0), item("b", "memories/b.jpg", 0)]);
    expect(plan.entries).toHaveLength(2);
    expect(plan.duplicates).toEqual([]);
  });

  it("still merges same date + type + size when the size is a real fingerprint", () => {
    const plan = planMemories([item("a", "memories/a.jpg", 1234), item("b", "memories/b.jpg", 1234)]);
    expect(plan.entries).toHaveLength(1);
    expect(plan.duplicates).toHaveLength(1);
  });
});

describe("toMs does not depend on the machine's time zone", () => {
  const shapes = ["2023-04-01 12:30", "2023/04/01 12:30:00", "04/01/2023 12:30:00", "Apr 1, 2023 12:30:00 PM", "2023-04-01T12:30", "2023-04-01 12:30:00 UTC"];
  const expected = Date.UTC(2023, 3, 1, 12, 30, 0);

  function inZone<T>(tz: string, fn: () => T): T {
    const prev = process.env.TZ;
    process.env.TZ = tz;
    try {
      // Guard against a vacuous run: the zone really must have changed.
      if (tz !== "UTC") expect(new Date(2023, 3, 1).getTimezoneOffset()).not.toBe(0);
      return fn();
    } finally {
      if (prev === undefined) delete process.env.TZ;
      else process.env.TZ = prev;
    }
  }

  it.each(["UTC", "America/Los_Angeles", "Asia/Tokyo"])("zone-less shapes read as UTC in %s", (tz) => {
    inZone(tz, () => {
      for (const s of shapes) expect(toMs(s), s).toBe(expected);
    });
  });

  it("keeps explicit zones and fractional seconds", () => {
    expect(toMs("2023-04-01T12:30:00-07:00")).toBe(Date.UTC(2023, 3, 1, 19, 30, 0));
    expect(toMs("2023-04-01 12:30:00.250")).toBe(expected + 250);
    expect(toMs("Sat, 01 Apr 2023 12:30:00 GMT")).toBe(expected);
  });

  it("still rejects impossible or unreadable values", () => {
    for (const s of ["2023-02-31 10:00:00", "2023-13-01 10:00:00", "2023-04-01 25:00:00", "not a date", ""]) {
      expect(toMs(s), s).toBeUndefined();
    }
  });
});
