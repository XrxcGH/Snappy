import { describe, expect, it } from "vitest";
import { parseExportFiles } from "../../src/export/parse.ts";
import {
  DEFAULT_LIST_LIMIT,
  RESCUE_MANIFEST_VERSION,
  buildRescueManifest,
  parseRescueManifest,
  recordsFromPlan,
  serializeRescueManifest,
  verifyRescue,
} from "../../src/insights/rescue-manifest.ts";
import type { DiskEntry, RescueManifest, RescueRecord } from "../../src/insights/rescue-manifest.ts";
import { planMemories } from "../../src/memories/plan.ts";
import { buildSyntheticExport } from "../../src/testing/synthetic-export.ts";
import type { MemoryItem } from "../../src/types.ts";

const NOW = Date.UTC(2024, 5, 1, 0, 0, 0);
const T1 = Date.UTC(2023, 3, 1, 9, 30, 0);
const T2 = Date.UTC(2023, 3, 2, 10, 0, 0);

const idOf = (path: string): string => `id-${path.replace(/[^A-Za-z0-9]/g, "_")}`;

function rec(path: string, over: Partial<RescueRecord> = {}): RescueRecord {
  return { id: idOf(path), relativePath: path, sizeBytes: 100, date: T1, mediaType: "image", ...over };
}

/** A disk listing that matches a manifest exactly. */
function diskOf(m: RescueManifest): DiskEntry[] {
  const out: DiskEntry[] = [];
  for (const it of m.items) {
    out.push({ path: it.path, size: it.size ?? 1, mtimeMs: it.capturedAt ?? 0 });
    for (const o of it.overlayFiles) out.push({ path: o, size: 5, mtimeMs: it.capturedAt ?? 0 });
  }
  return out;
}

const build = (records: RescueRecord[], now = NOW) => buildRescueManifest(records, { now });
const codes = (notes: { code: string }[]) => notes.map((n) => n.code);

describe("buildRescueManifest", () => {
  it("handles empty input", () => {
    const { manifest, notes } = build([]);
    expect(manifest).toEqual({
      version: RESCUE_MANIFEST_VERSION,
      createdAt: NOW,
      counts: { items: 0, images: 0, videos: 0, unknown: 0, overlayFiles: 0, undated: 0, withSize: 0 },
      items: [],
    });
    expect(notes).toEqual([]);
    expect(serializeRescueManifest(manifest)).toContain('"items": []');
  });

  it("describes one item with its overlay", () => {
    const { manifest } = build([rec("2023/2023-04/a_image_0001.jpg", { overlays: ["2023/2023-04/a_image_0001-overlay.png"] })]);
    expect(manifest.items).toEqual([
      {
        id: idOf("2023/2023-04/a_image_0001.jpg"),
        path: "2023/2023-04/a_image_0001.jpg",
        size: 100,
        capturedAt: T1,
        mediaType: "image",
        overlay: true,
        overlayFiles: ["2023/2023-04/a_image_0001-overlay.png"],
      },
    ]);
    expect(manifest.counts).toMatchObject({ items: 1, images: 1, overlayFiles: 1, withSize: 1, undated: 0 });
  });

  it("keeps undated items and counts them", () => {
    const { manifest, notes } = build([rec("undated_image_0001.jpg", { date: null }), rec("undated_image_0002.jpg", { date: undefined })]);
    expect(manifest.items.map((i) => i.capturedAt)).toEqual([null, null]);
    expect(manifest.counts.undated).toBe(2);
    expect(notes).toEqual([]);
  });

  it("clears times in the future and implausible times, with notes", () => {
    const { manifest, notes } = build([
      rec("a.jpg", { date: NOW + 1 }),
      rec("b.jpg", { date: 5 }),
      rec("c.jpg", { date: Number.NaN }),
      rec("d.jpg", { date: NOW }),
    ]);
    expect(manifest.items.map((i) => i.capturedAt)).toEqual([null, null, null, NOW]);
    expect(notes).toContainEqual({ code: "time-in-future", params: { count: 1 } });
    expect(notes).toContainEqual({ code: "time-invalid", params: { count: 2 } });
  });

  it("records a missing or bad size as null and notes it", () => {
    const { manifest, notes } = build([rec("a.jpg", { sizeBytes: undefined }), rec("b.jpg", { sizeBytes: -1 }), rec("c.jpg", { sizeBytes: 1.5 }), rec("d.jpg", { sizeBytes: 0 })]);
    expect(manifest.items.map((i) => i.size)).toEqual([null, null, null, 0]);
    expect(notes).toEqual([{ code: "size-missing", params: { count: 3 } }]);
  });

  it("treats names that differ only by case as duplicates and keeps one", () => {
    const { manifest, notes } = build([rec("2023/A.jpg", { id: "one" }), rec("2023/a.jpg", { id: "two" })]);
    expect(manifest.items).toHaveLength(1);
    expect(notes).toEqual([{ code: "path-duplicate", params: { count: 1 } }]);
  });

  it("does not let an overlay name push out a main file", () => {
    const { manifest, notes } = build([rec("a-overlay.png", { id: "m2" }), rec("a.jpg", { id: "m1", overlays: ["A-OVERLAY.png", "a-overlay-2.png"] })]);
    expect(manifest.items.map((i) => i.path)).toEqual(["a-overlay.png", "a.jpg"]);
    expect(manifest.items[1]?.overlayFiles).toEqual(["a-overlay-2.png"]);
    expect(codes(notes)).toEqual(["path-duplicate"]);
  });

  it("skips unsafe names and overlay names", () => {
    const bad = ["", "/abs.jpg", "../x.jpg", "a/../x.jpg", "a\\b.jpg", "C:/x.jpg", "a//b.jpg", "a/b.", ".hidden", "a b.jpg", "x".repeat(300), "a\0b.jpg"];
    const { manifest, notes } = build([...bad.map((p) => rec(p)), rec("ok.jpg", { overlays: ["../o.png", "ok-overlay.png"] })]);
    expect(manifest.items.map((i) => i.path)).toEqual(["ok.jpg"]);
    expect(manifest.items[0]?.overlayFiles).toEqual(["ok-overlay.png"]);
    expect(notes).toContainEqual({ code: "path-skipped", params: { count: bad.length } });
    expect(notes).toContainEqual({ code: "overlay-skipped", params: { count: 1 } });
  });

  it("replaces empty, odd and repeated ids with neutral ones", () => {
    const { manifest, notes } = build([rec("a.jpg", { id: "same" }), rec("b.jpg", { id: "same" }), rec("c.jpg", { id: "" }), rec("d.jpg", { id: "has space/../" }), rec("e.jpg", { id: "ok_1" })]);
    expect(manifest.items.map((i) => i.id)).toEqual(["same", "item-2", "item-3", "item-4", "ok_1"]);
    expect(notes).toEqual([{ code: "id-replaced", params: { count: 3 } }]);
  });

  it("gives the same manifest for any input order, sorted by name", () => {
    const records = [rec("2023/b.jpg"), rec("2022/z.mp4", { mediaType: "video" }), rec("2023/a.jpg"), rec("undated_image_0001.jpg", { date: null })];
    const forward = serializeRescueManifest(build(records).manifest);
    const reversed = serializeRescueManifest(build([...records].reverse()).manifest);
    // Ids fall back by input position only when they are bad; these are all valid, so the text is equal.
    expect(reversed).toBe(forward);
    expect(build(records).manifest.items.map((i) => i.path)).toEqual(["2022/z.mp4", "2023/a.jpg", "2023/b.jpg", "undated_image_0001.jpg"]);
  });

  it("breaks ties between identical names by input position", () => {
    const { manifest } = build([rec("a.jpg", { id: "first", sizeBytes: 1 }), rec("a.jpg", { id: "second", sizeBytes: 2 })]);
    expect(manifest.items).toHaveLength(1);
    expect(manifest.items[0]?.id).toBe("first");
  });

  it("drops fields that are not on the allowlist", () => {
    const dirty = { ...rec("a.jpg"), zipPath: "memories/ZQ-secret.jpg", downloadUrl: "https://x.invalid/q", username: "zq_canary_user", location: "1,2" } as unknown as RescueRecord;
    const text = serializeRescueManifest(build([dirty]).manifest);
    for (const leak of ["ZQ-secret", "x.invalid", "zq_canary_user", "location", "zipPath", "downloadUrl"]) expect(text).not.toContain(leak);
  });

  it("survives junk input without throwing", () => {
    const junk = [null, undefined, 5, "x", {}, { relativePath: 5 }] as unknown as RescueRecord[];
    expect(() => build(junk)).not.toThrow();
    expect(build(junk).manifest.items).toEqual([]);
    expect(() => buildRescueManifest(undefined as unknown as RescueRecord[], { now: Number.NaN })).not.toThrow();
    expect(buildRescueManifest([rec("a.jpg", { date: NOW + 5 })], { now: Number.NaN }).manifest.createdAt).toBeNull();
  });

  it("handles 20,000 items quickly", () => {
    const records: RescueRecord[] = [];
    for (let i = 0; i < 20_000; i++) records.push(rec(`2023/2023-04/f_${String(i).padStart(6, "0")}.jpg`, { id: `n${i}`, overlays: i % 10 === 0 ? [`2023/2023-04/f_${String(i).padStart(6, "0")}-overlay.png`] : [] }));
    const t0 = performance.now();
    const { manifest } = build(records);
    const text = serializeRescueManifest(manifest);
    const parsed = parseRescueManifest(text);
    const disk = diskOf(manifest);
    const result = verifyRescue(manifest, disk);
    const ms = performance.now() - t0;
    expect(manifest.items).toHaveLength(20_000);
    expect(parsed.ok && parsed.manifest.items.length).toBe(20_000);
    expect(result.ok).toBe(true);
    expect(result.expectedFiles).toBe(22_000);
    expect(ms).toBeLessThan(5000);
  });
});

describe("serialize and parse", () => {
  const sample = () =>
    build([rec("2023/a.jpg", { overlays: ["2023/a-overlay.png"] }), rec("2023/b.mp4", { mediaType: "video", date: null, sizeBytes: null }), rec("2022/c.jpg", { mediaType: "unknown" })]).manifest;

  it("round-trips", () => {
    const m = sample();
    const parsed = parseRescueManifest(serializeRescueManifest(m));
    expect(parsed).toEqual({ ok: true, manifest: m, notes: [{ code: "size-missing", params: { count: 1 } }] });
  });

  it("is deterministic, ends with a newline and has a fixed key order", () => {
    const text = serializeRescueManifest(sample());
    expect(serializeRescueManifest(sample())).toBe(text);
    expect(text.endsWith("}\n")).toBe(true);
    expect(text.indexOf('"version"')).toBeLessThan(text.indexOf('"createdAt"'));
    expect(text.indexOf('"createdAt"')).toBeLessThan(text.indexOf('"counts"'));
    expect(text.indexOf('"counts"')).toBeLessThan(text.indexOf('"items"'));
    expect(text.split("\n").filter((l) => l.startsWith('    {'))).toHaveLength(3);
    expect(() => JSON.parse(text)).not.toThrow();
  });

  it("reports parse failures by code only", () => {
    expect(parseRescueManifest("not json zq_canary")).toEqual({ ok: false, code: "not-json" });
    expect(parseRescueManifest("[]")).toEqual({ ok: false, code: "bad-shape" });
    expect(parseRescueManifest("null")).toEqual({ ok: false, code: "bad-shape" });
    expect(parseRescueManifest('{"version":1}')).toEqual({ ok: false, code: "bad-shape" });
    expect(parseRescueManifest('{"items":[]}')).toEqual({ ok: false, code: "bad-shape" });
    expect(parseRescueManifest('{"version":2,"items":[]}')).toEqual({ ok: false, code: "version-unsupported" });
  });

  it("re-checks items it reads: unsafe names skipped, counts recomputed, extras dropped", () => {
    const text = JSON.stringify({
      version: 1,
      createdAt: NOW,
      counts: { items: 999 },
      items: [
        { id: "a", path: "ok.jpg", size: 3, capturedAt: T1, mediaType: "image", overlayFiles: [], username: "zq_canary_user" },
        { id: "b", path: "../evil.jpg", size: 3, capturedAt: T1, mediaType: "image" },
        { id: "c", path: "OK.jpg", size: 3, capturedAt: T1, mediaType: "image" },
        null,
      ],
    });
    const r = parseRescueManifest(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.manifest.counts.items).toBe(1);
    expect(r.manifest.items[0]?.overlay).toBe(false);
    expect(JSON.stringify(r)).not.toContain("zq_canary_user");
    expect(r.notes).toEqual([
      { code: "path-skipped", params: { count: 2 } },
      { code: "path-duplicate", params: { count: 1 } },
    ]);
  });

  it("keeps a stored time even if it is later than the reader's clock", () => {
    const r = parseRescueManifest(serializeRescueManifest(build([rec("a.jpg")]).manifest));
    expect(r.ok && r.manifest.items[0]?.capturedAt).toBe(T1);
  });
});

describe("verifyRescue", () => {
  const manifest = () =>
    build([
      rec("2023/a.jpg", { sizeBytes: 100, date: T1, overlays: ["2023/a-overlay.png"] }),
      rec("2023/b.mp4", { sizeBytes: 200, date: T2, mediaType: "video" }),
      rec("undated_image_0001.jpg", { sizeBytes: null, date: null }),
    ]).manifest;

  it("passes for an empty manifest and an empty disk", () => {
    const r = verifyRescue(build([]).manifest, []);
    expect(r.ok).toBe(true);
    expect(r.counts).toEqual({ matched: 0, missing: 0, extra: 0, sizeMismatch: 0, timeMismatch: 0 });
  });

  it("passes when disk matches, and notes what it could not check", () => {
    const m = manifest();
    const r = verifyRescue(m, diskOf(m));
    expect(r.ok).toBe(true);
    expect(r.expectedFiles).toBe(4);
    expect(r.counts.matched).toBe(4);
    expect(r.notes).toEqual([
      { code: "size-not-checked", params: { count: 1 } },
      { code: "time-not-checked", params: { count: 1 } },
    ]);
  });

  it("reports one missing file", () => {
    const m = manifest();
    const r = verifyRescue(m, diskOf(m).filter((d) => d.path !== "2023/b.mp4"));
    expect(r.ok).toBe(false);
    expect(r.counts.missing).toBe(1);
    expect(r.missing).toEqual([{ id: idOf("2023/b.mp4"), path: "2023/b.mp4", kind: "main" }]);
  });

  it("reports a missing overlay as an overlay", () => {
    const m = manifest();
    const r = verifyRescue(m, diskOf(m).filter((d) => !d.path.includes("overlay")));
    expect(r.missing).toEqual([{ id: idOf("2023/a.jpg"), path: "2023/a-overlay.png", kind: "overlay" }]);
  });

  it("reports extra files", () => {
    const m = manifest();
    const r = verifyRescue(m, [...diskOf(m), { path: "2023/stray.txt", size: 1, mtimeMs: 0 }, { path: "other/x.jpg", size: 1, mtimeMs: 0 }]);
    expect(r.counts.extra).toBe(2);
    expect(r.extra.map((e) => e.path)).toEqual(["2023/stray.txt", "other/x.jpg"]);
  });

  it("can ignore the manifest file itself", () => {
    const m = manifest();
    const disk = [...diskOf(m), { path: "Rescue-Manifest.json", size: 9, mtimeMs: 0 }];
    expect(verifyRescue(m, disk).counts.extra).toBe(1);
    expect(verifyRescue(m, disk, { ignore: ["rescue-manifest.json"] }).ok).toBe(true);
  });

  it("reports size mismatches, and skips files with no recorded size", () => {
    const m = manifest();
    const disk = diskOf(m).map((d) => (d.path === "2023/a.jpg" ? { ...d, size: 101 } : d.path === "undated_image_0001.jpg" ? { ...d, size: 99999 } : d));
    const r = verifyRescue(m, disk);
    expect(r.counts.sizeMismatch).toBe(1);
    expect(r.sizeMismatch).toEqual([{ id: idOf("2023/a.jpg"), path: "2023/a.jpg", expected: 100, actual: 101 }]);
  });

  it("reports time mismatches beyond the tolerance, for main and overlay files", () => {
    const m = manifest();
    const disk = diskOf(m).map((d) => (d.path === "2023/b.mp4" ? { ...d, mtimeMs: T2 + 2001 } : d.path === "2023/a-overlay.png" ? { ...d, mtimeMs: T1 - 60_000 } : d));
    const r = verifyRescue(m, disk);
    expect(r.counts.timeMismatch).toBe(2);
    expect(r.timeMismatch.map((t) => [t.path, t.kind])).toEqual([
      ["2023/a-overlay.png", "overlay"],
      ["2023/b.mp4", "main"],
    ]);
  });

  it("accepts a time within the tolerance and honors a custom one", () => {
    const m = manifest();
    const near = diskOf(m).map((d) => (d.path === "2023/b.mp4" ? { ...d, mtimeMs: T2 + 2000 } : d));
    expect(verifyRescue(m, near).ok).toBe(true);
    expect(verifyRescue(m, near, { timeToleranceMs: 1000 }).counts.timeMismatch).toBe(1);
  });

  it("treats a missing mtime as a mismatch without a made-up value", () => {
    const m = manifest();
    const disk = diskOf(m).map((d) => (d.path === "2023/a.jpg" ? { ...d, mtimeMs: Number.NaN } : d));
    const r = verifyRescue(m, disk);
    expect(r.timeMismatch).toEqual([{ id: idOf("2023/a.jpg"), path: "2023/a.jpg", kind: "main", expected: T1, actual: null }]);
  });

  it("matches names regardless of letter case and notes it", () => {
    const m = manifest();
    const disk = diskOf(m).map((d) => (d.path === "2023/a.jpg" ? { ...d, path: "2023/A.JPG" } : d));
    const r = verifyRescue(m, disk);
    expect(r.ok).toBe(true);
    expect(r.notes).toContainEqual({ code: "case-differs", params: { count: 1 } });
  });

  it("prefers the exact-case file and reports the other as extra", () => {
    const m = manifest();
    const disk = [...diskOf(m), { path: "2023/A.jpg", size: 100, mtimeMs: T1 }];
    const r = verifyRescue(m, disk);
    expect(r.counts.extra).toBe(1);
    expect(r.extra).toEqual([{ path: "2023/A.jpg" }]);
    expect(r.notes.map((n) => n.code)).not.toContain("case-differs");
  });

  it("accepts backslash and ./ disk paths", () => {
    const m = manifest();
    const disk = diskOf(m).map((d) => ({ ...d, path: "./" + d.path.replace(/\//g, "\\") }));
    expect(verifyRescue(m, disk).ok).toBe(true);
  });

  it("counts a path listed twice on disk once and notes the repeat", () => {
    const m = manifest();
    const disk = [...diskOf(m), { path: "2023/a.jpg", size: 100, mtimeMs: T1 }];
    const r = verifyRescue(m, disk);
    expect(r.ok).toBe(true);
    expect(r.diskFiles).toBe(4);
    expect(r.notes).toContainEqual({ code: "duplicate-disk-entry", params: { count: 1 } });
  });

  it("gives the same result for any disk order", () => {
    const m = manifest();
    const disk = [...diskOf(m), { path: "z.txt", size: 1, mtimeMs: 0 }, { path: "a.txt", size: 1, mtimeMs: 0 }];
    expect(verifyRescue(m, [...disk].reverse())).toEqual(verifyRescue(m, disk));
    expect(verifyRescue(m, disk).extra.map((e) => e.path)).toEqual(["a.txt", "z.txt"]);
  });

  it("caps the lists but never the counts", () => {
    const records = Array.from({ length: 30 }, (_, i) => rec(`f_${String(i).padStart(3, "0")}.jpg`));
    const m = build(records).manifest;
    const r = verifyRescue(m, [], { listLimit: 10 });
    expect(r.counts.missing).toBe(30);
    expect(r.missing).toHaveLength(10);
    expect(r.truncated).toBe(true);
    expect(DEFAULT_LIST_LIMIT).toBe(500);
    expect(verifyRescue(m, [], { listLimit: 0 }).missing).toEqual([]);
    expect(verifyRescue(m, []).truncated).toBe(false);
  });

  it("verifies a large rescue with a few problems fast", () => {
    const records = Array.from({ length: 15_000 }, (_, i) => rec(`2023/f_${String(i).padStart(6, "0")}.jpg`, { id: `n${i}`, sizeBytes: i + 1, date: T1 + i * 1000 }));
    const m = build(records).manifest;
    const disk = diskOf(m);
    disk.splice(7, 1);
    (disk[100] as DiskEntry).size += 1;
    (disk[200] as DiskEntry).mtimeMs += 10_000;
    disk.push({ path: "2023/extra.bin", size: 1, mtimeMs: 0 });
    const t0 = performance.now();
    const r = verifyRescue(m, disk);
    expect(performance.now() - t0).toBeLessThan(3000);
    expect(r.counts).toEqual({ matched: 14_999, missing: 1, extra: 1, sizeMismatch: 1, timeMismatch: 1 });
  });

  it("copes with junk disk entries and a hand-made manifest", () => {
    const m = manifest();
    const junk = [null, undefined, { size: 1 }, { path: 5 }] as unknown as DiskEntry[];
    expect(() => verifyRescue(m, [...diskOf(m), ...junk])).not.toThrow();
    expect(verifyRescue(m, [...diskOf(m), ...junk]).ok).toBe(true);
    expect(() => verifyRescue(m, undefined as unknown as DiskEntry[])).not.toThrow();
  });
});

describe("recordsFromPlan with synthetic data", () => {
  it("builds a manifest for a planned rescue and verifies a faithful disk listing", () => {
    const parsed = parseExportFiles(buildSyntheticExport({ now: NOW, memoryCount: 60 }));
    const plan = planMemories(parsed.memories);
    expect(plan.entries.length).toBeGreaterThan(10);
    const sizes = new Map(plan.entries.map((e, i) => [e.relativePath, 1000 + i] as const));
    const { manifest, notes } = build(recordsFromPlan(plan.entries, sizes));
    expect(manifest.items).toHaveLength(plan.entries.length);
    expect(notes).toEqual([]);
    for (const it of manifest.items) {
      expect(it.path).toMatch(/^(\d{4}\/\d{4}-\d{2}\/|undated\/)[\w.-]+$/);
      expect(it.size).not.toBeNull();
    }
    const disk = manifest.items.map((it) => ({ path: it.path, size: it.size as number, mtimeMs: it.capturedAt ?? 0 }));
    expect(verifyRescue(manifest, disk).ok).toBe(true);
    // The saved size is not the zip's size, so without sizes none is recorded.
    expect(build(recordsFromPlan(plan.entries)).manifest.counts.withSize).toBe(0);
  });

  it("names overlay files like the CLI and takes only a vetted extension from the stored name", () => {
    const item: MemoryItem = { id: "m1", date: T1, mediaType: "image", overlayPaths: ["memories/ZQ-secret-overlay.PNG", "memories/odd.name.toolongext", "memories/third.webp"] };
    const plan = planMemories([item]);
    const [r] = recordsFromPlan(plan.entries);
    expect(r?.relativePath).toBe("2023/2023-04/2023-04-01_093000_image_0001.jpg");
    expect(r?.overlays).toEqual([
      "2023/2023-04/2023-04-01_093000_image_0001-overlay.png",
      "2023/2023-04/2023-04-01_093000_image_0001-overlay-2.png",
      "2023/2023-04/2023-04-01_093000_image_0001-overlay-3.webp",
    ]);
    expect(JSON.stringify(r)).not.toContain("ZQ-secret");
  });
});

describe("privacy", () => {
  const CANARY = "zqcanary_rescue_user";

  it("shows a canary only in the disk rows meant to list files, never in notes, codes or the manifest", () => {
    const m = build([rec("2023/a.jpg", { overlays: ["2023/a-overlay.png"] }), rec("undated_image_0001.jpg", { date: null, sizeBytes: null })]).manifest;
    const text = serializeRescueManifest(m);
    const disk: DiskEntry[] = [...diskOf(m).filter((d) => d.path !== "2023/a.jpg"), { path: `${CANARY}.jpg`, size: 1, mtimeMs: 1 }, { path: `2023/${CANARY.toUpperCase()}.png`, size: 1, mtimeMs: 1 }];
    const r = verifyRescue(m, disk);
    expect(r.extra.map((e) => e.path)).toEqual([`2023/${CANARY.toUpperCase()}.png`, `${CANARY}.jpg`]);

    expect(text.toLowerCase()).not.toContain(CANARY);
    expect(JSON.stringify(r.notes).toLowerCase()).not.toContain(CANARY);
    expect(JSON.stringify(r.counts).toLowerCase()).not.toContain(CANARY);
    const { extra: _extra, ...rest } = r;
    expect(JSON.stringify(rest).toLowerCase()).not.toContain(CANARY);
  });

  it("keeps a canary out of every note when it is fed in as an id, a name or a stray field", () => {
    const records = [
      rec("../" + CANARY + ".jpg"),
      rec("a.jpg", { id: CANARY + " bad id", overlays: ["../" + CANARY + ".png"] }),
      { ...rec("b.jpg"), username: CANARY } as unknown as RescueRecord,
      rec("c.jpg", { date: NOW + 1 }),
    ];
    const { manifest, notes } = build(records);
    expect(JSON.stringify(notes).toLowerCase()).not.toContain(CANARY);
    expect(serializeRescueManifest(manifest).toLowerCase()).not.toContain(CANARY);
    const parsedBad = parseRescueManifest(`{"version":1,"items":[{"path":"../${CANARY}.jpg"}],"x":"${CANARY}"`);
    expect(JSON.stringify(parsedBad).toLowerCase()).not.toContain(CANARY);
    const parsedOk = parseRescueManifest(`{"version":1,"items":[{"path":"../${CANARY}.jpg"}],"x":"${CANARY}"}`);
    expect(JSON.stringify(parsedOk).toLowerCase()).not.toContain(CANARY);
  });

  it("uses only short codes and counts in notes", () => {
    const { notes } = build([rec("../x.jpg"), rec("a.jpg", { date: NOW + 1, sizeBytes: null })]);
    for (const n of notes) {
      expect(n.code).toMatch(/^[a-z]+(-[a-z]+)*$/);
      expect(Object.keys(n.params)).toEqual(["count"]);
      expect(Number.isInteger(n.params.count)).toBe(true);
    }
  });
});
