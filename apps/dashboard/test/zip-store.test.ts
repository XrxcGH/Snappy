/**
 * The stored .zip the page builds from the virtual output folder, checked by parsing it with core's own
 * reader (which shares no code with the builder): names, contents, checksums and modified times.
 */
import { describe, expect, it, vi } from "vitest";
import { bytesReader, crc32, listZipEntries, readZipEntry } from "@snappy-export/core";
import { MAX_ENTRIES, ZipTooBigError, buildZip } from "../src/terminal/zip-store.ts";
import type { ZipEntry } from "../src/terminal/zip-store.ts";

const NOW = Date.UTC(2026, 10, 7, 9, 30, 0);
const bytes = (n: number, seed = 1): Uint8Array => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) % 251);

async function open(blob: Blob) {
  const data = new Uint8Array(await blob.arrayBuffer());
  const reader = bytesReader(data);
  const listing = await listZipEntries(reader);
  return { data, reader, entries: listing.entries };
}

describe("buildZip", () => {
  it("makes an archive core reads back: the same names, the same bytes, valid checksums", async () => {
    const entries: ZipEntry[] = [
      { path: "memories/2021/2021-03/a.jpg", bytes: bytes(300, 1), mtimeMs: Date.UTC(2021, 2, 4, 5, 6, 8) },
      { path: "memories/2021/2021-03/a-overlay.png", bytes: bytes(5, 2), mtimeMs: Date.UTC(2021, 2, 4, 5, 6, 8) },
      { path: "memories/memories-report.json", bytes: new TextEncoder().encode('{"ok":true}\n'), mtimeMs: 0 },
      { path: "memories/empty.bin", bytes: new Uint8Array(0), mtimeMs: NOW },
    ];
    const { reader, entries: listed } = await open(buildZip(entries, NOW));
    expect(listed.map((e) => e.name)).toEqual(entries.map((e) => e.path));
    for (const [i, info] of listed.entries()) {
      const want = entries[i] as ZipEntry;
      expect(info.method, want.path).toBe(0);
      expect(info.size).toBe(want.bytes.length);
      expect(info.compressedSize).toBe(want.bytes.length);
      expect(info.crc32).toBe(crc32(want.bytes));
      // readZipEntry checks the checksum itself.
      expect([...(await readZipEntry(reader, info))], want.path).toEqual([...want.bytes]);
    }
  });

  it("carries each file's time inside the archive, to the second, and the fallback for a file with none", async () => {
    const when = Date.UTC(2020, 5, 6, 7, 8, 10);
    const { entries } = await open(
      buildZip(
        [
          { path: "a.jpg", bytes: bytes(4), mtimeMs: when },
          { path: "b.json", bytes: bytes(4), mtimeMs: 0 },
          { path: "c.jpg", bytes: bytes(4), mtimeMs: Date.UTC(1970, 0, 2) },
        ],
        NOW,
      ),
    );
    expect(entries[0]?.mtimeUtcMs).toBe(when);
    expect(entries[1]?.mtimeUtcMs).toBe(NOW);
    expect(entries[2]?.mtimeUtcMs).toBe(NOW);
  });

  it("writes names as UTF-8 and keeps folders", async () => {
    const { entries } = await open(buildZip([{ path: "folder/é日本.txt", bytes: bytes(2), mtimeMs: NOW }], NOW));
    expect(entries[0]?.name).toBe("folder/é日本.txt");
  });

  it("holds the original byte arrays rather than copies of them", () => {
    // The parts of the Blob are the headers and the caller's own arrays.
    const parts: unknown[] = [];
    const RealBlob = Blob;
    vi.stubGlobal(
      "Blob",
      class extends RealBlob {
        constructor(p?: BlobPart[], o?: BlobPropertyBag) {
          super(p, o);
          parts.push(...(p ?? []));
        }
      },
    );
    const mine = bytes(10);
    buildZip([{ path: "x.bin", bytes: mine, mtimeMs: NOW }], NOW);
    vi.unstubAllGlobals();
    expect(parts.includes(mine)).toBe(true);
  });

  it("makes an empty archive that core reads as empty", async () => {
    const { entries } = await open(buildZip([], NOW));
    expect(entries).toEqual([]);
  });

  it("refuses more entries than the format allows, with a coded error and no archive", () => {
    const many = Array.from({ length: MAX_ENTRIES + 1 }, (_, i) => ({ path: `f${i}`, bytes: new Uint8Array(0), mtimeMs: NOW }));
    expect(() => buildZip(many, NOW)).toThrow(ZipTooBigError);
    try {
      buildZip(many, NOW);
    } catch (e) {
      expect((e as ZipTooBigError).limit).toBe("entries");
    }
    // The limit itself is fine.
    expect(() => buildZip(many.slice(0, MAX_ENTRIES), NOW)).not.toThrow();
  });

  it("refuses a total over 4 GiB without reading any of it", () => {
    const huge = { length: 0x9000_0000 } as unknown as Uint8Array;
    // A checksum would walk every byte, so the size is checked first: these stand-ins are never read.
    const entries = [
      { path: "a", bytes: huge, mtimeMs: NOW },
      { path: "b", bytes: huge, mtimeMs: NOW },
    ];
    expect(() => buildZip(entries, NOW)).toThrow(ZipTooBigError);
    try {
      buildZip(entries, NOW);
    } catch (e) {
      expect((e as ZipTooBigError).limit).toBe("size");
    }
  });
});
