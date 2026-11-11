import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSyntheticExport, bytesReader, listZipEntries, sniffMediaType } from "@snappy-export/core";
import { overlayTarget, placeOverlay, targetInside } from "../src/memories-write.ts";
import type { Transport } from "../src/memories-download.ts";
import { LATER, makeIo, run, tempDir, writeSyntheticZip } from "./helpers.ts";

/** A real (tiny, synthetic) JPEG and MP4 from the demo export, to serve as "downloaded" bytes. */
const media = buildSyntheticExport({ now: LATER, friendCount: 5, memoryCount: 6, bundleMedia: true });
const JPEG = media[Object.keys(media).find((k) => k.endsWith(".jpg")) as string] as Uint8Array;
const MP4 = media[Object.keys(media).find((k) => k.endsWith(".mp4")) as string] as Uint8Array;

function listFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => relative(dir, join(e.parentPath, e.name)).replaceAll("\\", "/"))
    .sort();
}

describe("snappy-export memories: dry run", () => {
  it("reports the plan and the storage meter and writes nothing, not even the output folder", async () => {
    const dir = tempDir("mem");
    const zip = writeSyntheticZip(dir, "later.zip", { bundleMedia: true });
    const out = join(dir, "rescued");
    const { code, out: text } = await run(["memories", zip, "--out", out, "--dry-run"]);

    expect(code).toBe(0);
    expect(existsSync(out)).toBe(false);
    expect(text).toContain("Memories rescue");
    expect(text).toMatch(/\d+ Memories: \d+ photos, \d+ videos/);
    expect(text).toMatch(/probable duplicate/);
    expect(text).toMatch(/6 are in your ZIP files, \d+ are only links/);
    expect(text).toContain("Storage meter");
    expect(text).toMatch(/[▰▱]{20} +[\d.]+ \w+ of 5 GB \(\d+%\)/);
    expect(text).toContain("Dry run: nothing was written.");
    expect(text).toContain("Add --download to download the items that are only links.");
  });

  it("works without --out, and honors --cap-gb", async () => {
    const zip = writeSyntheticZip(tempDir("mem"), "later.zip", { bundleMedia: true });
    const { code, out } = await run(["memories", zip, "--dry-run", "--cap-gb", "0.5"]);
    expect(code).toBe(0);
    expect(out).toContain("of 500 MB");
  });

  it("never prints a download link, even though the export is full of them", async () => {
    const zip = writeSyntheticZip(tempDir("mem"), "later.zip", { bundleMedia: true });
    const { out, err } = await run(["memories", zip, "--dry-run", "--download"]);
    expect(out + err).not.toMatch(/https?:|\.invalid|snappy\.invalid|uid=|mid=/);
    expect(out).toMatch(/would|A real run would copy \d+ files from your zip and download \d+ more/);
  });
});

describe("snappy-export memories: bundled media", () => {
  it("extracts bundled files with the capture date, sets the file time, and writes a report", async () => {
    const dir = tempDir("mem");
    const zip = writeSyntheticZip(dir, "later.zip", { bundleMedia: true });
    const out = join(dir, "rescued");
    const { code, out: text } = await run(["memories", zip, "--out", out]);

    expect(code).toBe(0);
    expect(text).toMatch(/6 saved from your ZIP files, 0 already there, 0 failed\./);
    expect(text).toMatch(/\d+ items? (?:are|is) only (?:links|a link)\. Run again with --download/);
    const files = listFiles(out).filter((f) => f !== "memories-report.json");
    expect(files).toHaveLength(6);
    expect(files.every((f) => /^\d{4}\/\d{4}-\d{2}\/\d{4}-\d{2}-\d{2}_\d{6}_(image|video)_\d{4}\.(jpg|mp4)$/.test(f))).toBe(true);

    const report = JSON.parse(readFileSync(join(out, "memories-report.json"), "utf8"));
    expect(report.counts).toMatchObject({ extracted: 6, failed: 0, skippedExisting: 0 });
    expect(report.items.filter((i: { status: string }) => i.status === "extracted")).toHaveLength(6);

    // The date is in the bytes (sniffed, not trusted from the name) and in the file time.
    for (const f of files) {
      const bytes = readFileSync(join(out, f));
      const type = sniffMediaType(bytes);
      expect(["jpeg", "mp4"]).toContain(type);
      const day = /(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})/.exec(f) as RegExpExecArray;
      const stamp = Date.UTC(+day[1]!, +day[2]! - 1, +day[3]!, +day[4]!, +day[5]!, +day[6]!);
      expect(Math.abs(statSync(join(out, f)).mtimeMs - stamp)).toBeLessThan(2000);
      if (type === "jpeg") {
        const exif = new Date(stamp).toISOString().slice(0, 19).replace(/-/g, ":").replace("T", " ");
        expect(Buffer.from(bytes).includes(Buffer.from(exif, "latin1")), f).toBe(true);
      }
    }
  });

  it("skips files that already exist, so a second run resumes", async () => {
    const dir = tempDir("mem");
    const zip = writeSyntheticZip(dir, "later.zip", { bundleMedia: true });
    const out = join(dir, "rescued");
    await run(["memories", zip, "--out", out]);
    const before = listFiles(out);
    const again = await run(["memories", zip, "--out", out]);
    expect(again.code).toBe(0);
    expect(again.out).toMatch(/0 saved from your ZIP files, 6 already there, 0 failed\./);
    expect(listFiles(out)).toEqual(before);
  });

  it("honors --layout", async () => {
    const dir = tempDir("mem");
    const zip = writeSyntheticZip(dir, "later.zip", { bundleMedia: true });
    for (const [layout, pattern] of [["flat", /^[^/]+\.(jpg|mp4)$/], ["year", /^\d{4}\/[^/]+\.(jpg|mp4)$/]] as const) {
      const out = join(dir, layout);
      await run(["memories", zip, "--out", out, "--layout", layout]);
      const files = listFiles(out).filter((f) => f !== "memories-report.json");
      expect(files).toHaveLength(6);
      expect(files.every((f) => pattern.test(f)), layout).toBe(true);
    }
  });

  it("reads the entry list, not the media, of a zip it only plans from", async () => {
    // Sanity for the premise: the synthetic zip really holds bundled media next to the JSON.
    const zip = writeSyntheticZip(tempDir("mem"), "later.zip", { bundleMedia: true });
    const entries = (await listZipEntries(bytesReader(readFileSync(zip)))).entries;
    expect(entries.filter((e) => /\.(jpg|mp4)$/.test(e.name))).toHaveLength(6);
  });
});

describe("snappy-export memories: --download", () => {
  const ok = (bytes: Uint8Array, type: string): Response => new Response(new Uint8Array(bytes), { headers: { "content-type": type } });

  it("downloads links, embeds dates, retries, and reports failures by number without a single link", async () => {
    const dir = tempDir("mem");
    const zip = writeSyntheticZip(dir, "later.zip", { memoryCount: 12 });
    const out = join(dir, "rescued");
    const seen: string[] = [];
    const transport: Transport = async (url) => {
      seen.push(url);
      const n = [...new Set(seen)].indexOf(url);
      if (n % 3 === 0) return new Response("forbidden", { status: 403 });
      return n % 2 === 0 ? ok(MP4, "video/mp4") : ok(JPEG, "image/jpeg");
    };
    const io = makeIo({ transport, sleep: async () => undefined });
    const { code, out: text, err } = await run(["memories", zip, "--out", out, "--download", "--concurrency", "2"], io);

    expect(code).toBe(3); // finished, but some items failed
    expect(seen.length).toBeGreaterThan(0);
    expect(text.match(/This is the only Snappy command that uses the network\./g)).toHaveLength(1);
    expect(text).toMatch(/item \d+ failed \(http-403\)/);

    // Nothing that resembles a link reaches any output or the report.
    const reportText = readFileSync(join(out, "memories-report.json"), "utf8");
    for (const url of seen) for (const piece of [url, new URL(url).host, new URL(url).search].filter(Boolean)) {
      expect(text + err + reportText).not.toContain(piece);
    }
    expect(text + err + reportText).not.toMatch(/https?:/);

    const report = JSON.parse(reportText);
    expect(report.failures.length).toBeGreaterThan(0);
    expect(report.failures.every((f: { item: number; reason: string }) => typeof f.item === "number" && f.reason === "http-403")).toBe(true);
    const c = report.counts;
    expect(c.extracted + c.downloaded + c.failed + c.skippedExisting + c.linkOnly + c.unmatchedItems).toBe(c.planned);

    // Saved files carry the sniffed type's date handling and no leftover part files.
    const files = listFiles(out).filter((f) => f !== "memories-report.json");
    expect(files.some((f) => f.endsWith(".part"))).toBe(false);
    expect(files).toHaveLength(report.counts.downloaded);
    for (const f of files) expect(["jpeg", "mp4"]).toContain(sniffMediaType(readFileSync(join(out, f))));
  });

  it("explains the network use once and refuses nothing silently when links are unreachable", async () => {
    const dir = tempDir("mem");
    const zip = writeSyntheticZip(dir, "later.zip", { memoryCount: 4 });
    const transport: Transport = async () => {
      throw new TypeError("fetch failed: https://demo.snappy.invalid/secret");
    };
    const io = makeIo({ transport, sleep: async () => undefined });
    const { code, out, err } = await run(["memories", zip, "--out", join(dir, "o"), "--download"], io);
    expect(code).toBe(3);
    expect(out).toMatch(/item 1 failed \(network\)/);
    expect(out + err).not.toContain("invalid");
  });

  it("does not use the network without --download", async () => {
    const dir = tempDir("mem");
    const zip = writeSyntheticZip(dir, "later.zip", { memoryCount: 4 });
    let calls = 0;
    const transport: Transport = async () => (calls++, ok(JPEG, "image/jpeg"));
    const { out } = await run(["memories", zip, "--out", join(dir, "o")], makeIo({ transport }));
    expect(calls).toBe(0);
    expect(out).not.toContain("only Snappy command that uses the network");
  });

  it("downloads nothing on a dry run", async () => {
    const dir = tempDir("mem");
    const zip = writeSyntheticZip(dir, "later.zip", { memoryCount: 4 });
    let calls = 0;
    const transport: Transport = async () => (calls++, ok(JPEG, "image/jpeg"));
    const { code, out } = await run(["memories", zip, "--out", join(dir, "o"), "--download", "--dry-run"], makeIo({ transport }));
    expect(code).toBe(0);
    expect(calls).toBe(0);
    expect(existsSync(join(dir, "o"))).toBe(false);
    expect(out).not.toContain("only Snappy command that uses the network");
  });
});

describe("snappy-export memories: guards", () => {
  it("keeps every output path inside the output folder", () => {
    const root = join(tempDir("mem"), "out");
    expect(targetInside(makeIo(), root, "2026/2026-01/a.jpg")).toBe(join(root, "2026", "2026-01", "a.jpg"));
    for (const bad of ["../escape.jpg", "a/../../escape.jpg", "..", "", "C:/Windows/x.jpg", "/etc/passwd", "a\0b.jpg", "a/../.."]) {
      const target = targetInside(makeIo(), root, bad);
      expect(target === undefined || relative(root, target).split(/[\\/]/)[0] !== "..", bad).toBe(true);
      if (target !== undefined) expect(target.startsWith(root)).toBe(true);
    }
    expect(targetInside(makeIo(), root, "../escape.jpg")).toBeUndefined();
    expect(targetInside(makeIo(), root, "a/../../escape.jpg")).toBeUndefined();
    expect(targetInside(makeIo(), root, "")).toBeUndefined();
    expect(targetInside(makeIo(), root, "a\0b.jpg")).toBeUndefined();
  });

  it("names an overlay after its main file, with only a vetted extension", () => {
    expect(overlayTarget(join("o", "2026", "a_0001.jpg"), 1, "memories/x-overlay.png")).toBe(join("o", "2026", "a_0001-overlay.png"));
    expect(overlayTarget(join("o", "a_0001.mp4"), 2, "memories/x-overlay.PNG")).toBe(join("o", "a_0001-overlay-2.png"));
    // An odd or missing extension never reaches the file name.
    expect(overlayTarget(join("o", "a_0001.jpg"), 1, "memories/x-overlay.p ng")).toBe(join("o", "a_0001-overlay.png"));
    expect(overlayTarget(join("o.d", "a_0001"), 1, "x")).toBe(join("o.d", "a_0001-overlay.png"));
  });

  it("writes an overlay as it was stored and sets only its file time", async () => {
    const dir = tempDir("mem");
    const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const target = join(dir, "a", "b-overlay.png");
    const when = Date.UTC(2021, 2, 4, 5, 6, 7);
    await placeOverlay(makeIo(), target, bytes, when);
    expect(new Uint8Array(readFileSync(target))).toEqual(bytes);
    expect(statSync(target).mtimeMs).toBe(when);
    await placeOverlay(makeIo(), join(dir, "c.png"), bytes, null);
    expect(new Uint8Array(readFileSync(join(dir, "c.png")))).toEqual(bytes);
  });

  it("rejects bad options calmly", async () => {
    const zip = writeSyntheticZip(tempDir("mem"), "later.zip");
    for (const bad of [["--concurrency", "0"], ["--concurrency", "9"], ["--concurrency", "x"], ["--layout", "deep"], ["--cap-gb", "-1"], ["--cap-gb", "abc"]]) {
      const result = await run(["memories", zip, "--dry-run", "--verbose", ...bad]);
      expect(result.code, bad.join(" ")).toBe(1);
      expect(result.err).toContain("(code: usage)");
    }
    const noOut = await run(["memories", zip]);
    expect(noOut.code).toBe(1);
    expect(noOut.err).toContain("--out");
  });

  it("says what to do when the export has no Memories", async () => {
    const dir = tempDir("mem");
    const zip = writeSyntheticZip(dir, "later.zip", { memoryCount: 0 });
    const { code, out } = await run(["memories", zip, "--out", join(dir, "o")]);
    expect(code).toBe(0);
    expect(out).toContain("No Memories found in this export.");
  });
});
