/**
 * End to end over the three-zip synthetic export: parseExportFromReader once per zip, then
 * mergeParsedExports. Proves that Memories are paired with the files in the other zips, that Snaps
 * count as activity, that nothing personal or path-like reaches an output, and that merging is
 * idempotent and order-independent. Synthetic data only.
 */
import { strFromU8, unzipSync, zipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CANARIES,
  addSnapshot,
  buildCleanupQueue,
  bytesReader,
  describeStructureFromReader,
  emptyLedger,
  findDormant,
  formatStructureReport,
  inspectExport,
  listZipEntries,
  mergeParsedExports,
  normUser,
  parseExportFromReader,
  serializeLedger,
  snapshotFromExport,
  syntheticExportParts,
  validateExport,
} from "../../src/index.ts";
import type { Candidate, ParsedExport, RandomAccessReader } from "../../src/index.ts";

const NOW = Date.UTC(2026, 10, 6, 12, 0, 0);
const OPTS = { now: NOW, memoryCount: 400 } as const;
const DATA_FILES = new Set(["json/friends.json", "json/chat_history.json", "json/snap_history.json", "json/memories_history.json"]);

type Range = [start: number, end: number];

afterEach(() => vi.restoreAllMocks());

// ------------------------------------------------------------------ helpers ---

/** Entry data ranges read straight from the zip bytes, independently of the code under test (no zip64, no comment). */
function dataRanges(zip: Uint8Array): { name: string; range: Range }[] {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const eocd = zip.length - 22;
  expect(v.getUint32(eocd, true)).toBe(0x06054b50);
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out: { name: string; range: Range }[] = [];
  for (let i = 0; i < count; i++) {
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const compressed = v.getUint32(p + 20, true);
    const local = v.getUint32(p + 42, true);
    const name = strFromU8(zip.subarray(p + 46, p + 46 + nameLen));
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    out.push({ name, range: [start, start + compressed] });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function listNames(zip: Uint8Array): string[] {
  const out: string[] = [];
  unzipSync(zip, { filter: (f) => (out.push(f.name), false) });
  return out;
}

/** A reader that logs every read and refuses (throws on) any read that touches a forbidden range. */
function guardedReader(zip: Uint8Array, forbidden: Range[]): { reader: RandomAccessReader; reads: Range[] } {
  const inner = bytesReader(zip);
  const reads: Range[] = [];
  return {
    reads,
    reader: {
      size: inner.size,
      read(start, end) {
        reads.push([start, end]);
        if (forbidden.some(([a, b]) => start < b && end > a)) throw new Error("a forbidden range was read");
        return inner.read(start, end);
      },
    },
  };
}

const parts = syntheticExportParts(OPTS);
const parseParts = async (order: number[] = [0, 1, 2]): Promise<ParsedExport[]> =>
  Promise.all(order.map((i) => parseExportFromReader(bytesReader((parts[i] as { bytes: Uint8Array }).bytes), { part: i + 1 })));

const parsed = await parseParts();
const merged = mergeParsedExports(parsed);

const rawJson = (n: number, name: string): any => {
  const bytes = unzipSync((parts[n] as { bytes: Uint8Array }).bytes, { filter: (f) => f.name === name })[name] as Uint8Array;
  return JSON.parse(strFromU8(bytes));
};
const MAIN = /-main\.(jpg|mp4)$/;
const OVERLAY = /-overlay\.png$/;
const allNames = parts.flatMap((p) => listNames(p.bytes));
const memoryEntries = rawJson(0, "json/memories_history.json")["Saved Media"] as Record<string, string>[];
const plantedMains = allNames.filter((n) => n.startsWith("memories/") && MAIN.test(n)).length;
const plantedOverlays = allNames.filter((n) => n.startsWith("memories/") && OVERLAY.test(n)).length;

// ------------------------------------------------------------------ pairing ---

describe("Memories across the three zips", () => {
  it("plants a believable export", () => {
    expect(memoryEntries).toHaveLength(400);
    expect(plantedMains).toBeGreaterThan(200);
    expect(plantedOverlays).toBeGreaterThan(0);
    expect(memoryEntries.every((m) => m["Download Link"] === "" && m["Media Download URL"] === "")).toBe(true);
  });

  it("pairs every list entry that has a file, and says exactly how many have none", () => {
    expect(merged.memories).toHaveLength(memoryEntries.length);
    expect(merged.memoriesPairing).toEqual({
      items: memoryEntries.length,
      mainFiles: plantedMains,
      paired: plantedMains,
      unmatchedItems: memoryEntries.length - plantedMains,
      unmatchedFiles: 0,
      overlays: plantedOverlays,
      ambiguous: 0,
      method: "utc-time",
      offsetHours: 0,
    });
    expect(merged.memories.filter((m) => m.zipPath !== undefined)).toHaveLength(plantedMains);
    expect(merged.bundledMedia).toHaveLength(plantedMains + plantedOverlays);
  });

  it("records the right file, part, size and overlay for every pair, each time-matched to the second", async () => {
    const listings = await Promise.all(parts.map(async (p) => new Map((await listZipEntries(bytesReader(p.bytes))).entries.map((e) => [e.name, e] as const))));
    let overlays = 0;
    for (const m of merged.memories) {
      if (m.zipPath === undefined) {
        expect(m.partIndex).toBeUndefined();
        continue;
      }
      expect([2, 3]).toContain(m.partIndex);
      const entry = listings[(m.partIndex as number) - 1]?.get(m.zipPath);
      expect(entry, "the path is in the part it names").toBeDefined();
      expect(entry?.mtimeUtcMs).toBe(m.date);
      expect(m.sizeBytes).toBe(entry?.size);
      expect(m.mediaType).toBe(MAIN.exec(m.zipPath)?.[1] === "mp4" ? "video" : "image");
      for (const o of m.overlayPaths ?? []) {
        overlays++;
        expect(listings[(m.partIndex as number) - 1]?.has(o)).toBe(true);
        expect(o.replace(/-overlay\.png$/, "")).toBe(m.zipPath.replace(/-main\.(jpg|mp4)$/, ""));
      }
    }
    expect(overlays).toBe(plantedOverlays);
  });

  it("says what a person needs to know, in counts, and nothing it should not", () => {
    const codes = merged.issues.map((i) => i.code);
    expect(codes).toContain("memories-links-empty");
    expect(codes).toContain("memories-unmatched-items");
    for (const gone of ["memories-no-media-source", "memories-pairing-fallback", "memories-time-offset"]) expect(codes).not.toContain(gone);
    expect(merged.issues.find((i) => i.code === "memories-unmatched-items")).toEqual({
      severity: "warning",
      code: "memories-unmatched-items",
      message: `${memoryEntries.length - plantedMains} of ${memoryEntries.length} saved Memories ${memoryEntries.length - plantedMains === 1 ? "has" : "have"} no file in the zips Snappy was given. If part of your export is missing, add it and run again. Your Memories stay in your Snapchat account either way, and Snapchat may not have included every one in the export.`,
    });
    expect(merged.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(validateExport(merged).filter((i) => i.severity !== "info")).toEqual([]);
  });

  it("is provisional per part: only the merge knows the list and the files together", () => {
    const [first, second, third] = parsed as [ParsedExport, ParsedExport, ParsedExport];
    expect(first.memories).toHaveLength(memoryEntries.length);
    expect(first.bundledMedia).toBeUndefined();
    expect(first.memoriesPairing).toBeUndefined();
    expect(first.issues.map((i) => i.code)).toContain("memories-no-media-source");
    for (const [p, n] of [[second, 2], [third, 3]] as const) {
      expect(p.memories).toEqual([]);
      expect(p.bundledMedia?.length).toBeGreaterThan(0);
      expect(new Set(p.bundledMedia?.map((f) => f.part))).toEqual(new Set([n]));
    }
    expect(second.bundledMedia?.length).toBeGreaterThan(third.bundledMedia?.length ?? 0);
  });
});

// -------------------------------------------------------------------- Snaps ---

describe("Snaps count as activity", () => {
  const isSnap = (kind: string): boolean => kind === "IMAGE" || kind === "VIDEO";
  const chatCount = Object.values(rawJson(0, "json/chat_history.json") as Record<string, unknown[]>).reduce((n, l) => n + l.length, 0);
  const snapCount = Object.values(rawJson(0, "json/snap_history.json") as Record<string, unknown[]>).reduce((n, l) => n + l.length, 0);
  const chatsOnly: ParsedExport = { ...merged, chats: merged.chats.filter((c) => !isSnap(c.kind)) };
  const snappers = merged.friends.friends.map((f) => normUser(f.username)).filter((u) => u.startsWith("snapper_"));

  it("reads every saved chat and every Snap", () => {
    expect(snapCount).toBeGreaterThan(chatCount * 2);
    expect(merged.chats).toHaveLength(chatCount + snapCount);
    expect(merged.chats.filter((c) => isSnap(c.kind))).toHaveLength(snapCount);
    expect(merged.issues.filter((i) => /^(chat|snap)-/.test(i.code) && i.severity !== "info")).toEqual([]);
  });

  it("does not call a friend quiet who only exchanges Snaps, though a chat-only reading would", () => {
    expect(snappers.length).toBeGreaterThanOrEqual(1);
    const withSnaps = new Set(findDormant(merged, { now: NOW }).map((c) => c.key));
    const withoutSnaps = new Set(findDormant(chatsOnly, { now: NOW }).map((c) => c.key));
    for (const name of snappers) {
      expect(chatsOnly.chats.some((c) => normUser(c.conversation) === name), "a Snap-only friend has no chat event").toBe(false);
      expect(withoutSnaps.has(name), "chat-only reading flags the Snap-only friend").toBe(true);
      expect(withSnaps.has(name), "Snaps protect the Snap-only friend from being called quiet").toBe(false);
    }
    // The friends who really are quiet stay flagged.
    const quiet = [...withSnaps].filter((k) => k.startsWith("dormant_"));
    expect(quiet.length).toBeGreaterThan(5);
  });

  it("protects a Snap-only friend as recently active", () => {
    const candidates: Candidate[] = snappers.map((key) => ({ key, category: "ghost", confidence: "high", score: 0.9, evidence: [], protectedBy: [] }));
    const exportedAt = merged.exportedAt as number;
    const queue = buildCleanupQueue(candidates, merged.chats, { now: exportedAt });
    expect(queue.items).toEqual([]);
    expect(queue.protectedItems.map((c) => c.key).sort()).toEqual([...snappers].sort());
    expect(queue.protectedItems.every((c) => c.protectedBy.includes("recent-message"))).toBe(true);
    // With chats alone the same friends would have been offered for removal.
    expect(buildCleanupQueue(candidates, chatsOnly.chats, { now: exportedAt }).items).toHaveLength(snappers.length);
  });

  it("says Snaps in the evidence text", () => {
    const text = findDormant(merged, { now: NOW }).flatMap((c) => c.evidence.map((e) => e.detail)).join("\n");
    expect(text).toContain("chat or Snap activity");
    expect(text).not.toMatch(/\(unsaved chats, Snaps, calls\)/);
  });

  it("notes a missing Snap history as information only", async () => {
    const kept = unzipSync((parts[0] as { bytes: Uint8Array }).bytes, { filter: (f) => f.name !== "json/snap_history.json" });
    const without = await parseExportFromReader(bytesReader(zipSync(kept)));
    expect(without.chats.every((c) => !isSnap(c.kind))).toBe(true);
    const note = validateExport(mergeParsedExports([without])).find((i) => i.code === "snap-history-missing");
    expect(note?.severity).toBe("info");
    expect(validateExport(merged).map((i) => i.code)).not.toContain("snap-history-missing");
  });
});

// ------------------------------------------------------------ content-blindness ---

const ALL_CANARIES = [...Object.values(CANARIES).flat(), "13.371337", "42.424242", "117.171717", "66.60666", "ZQCANARY"];
const leaks = (text: string): string[] => ALL_CANARIES.filter((c) => text.toLowerCase().includes(c.toLowerCase()));

describe("what is read and what is never read", () => {
  it("opens only the four data files: no media, no html, no other json, however it is read", async () => {
    for (const [i, p] of parts.entries()) {
      const forbidden = dataRanges(p.bytes).filter((e) => !DATA_FILES.has(e.name) && e.range[1] > e.range[0]).map((e) => e.range);
      expect(forbidden.length).toBeGreaterThan(0);
      const { reader, reads } = guardedReader(p.bytes, forbidden);
      const result = await parseExportFromReader(reader, { part: i + 1 });
      expect(result.issues.filter((x) => x.severity === "error")).toEqual([]);
      expect(reads.length).toBeGreaterThan(1);
    }
    // Part 1 really does hold personal json that is never opened.
    expect(dataRanges((parts[0] as { bytes: Uint8Array }).bytes).map((e) => e.name)).toEqual(expect.arrayContaining(["json/location_history.json", "json/account.json", "json/search_history.json"]));
  });

  it("never decodes message text while reading the histories (the text is in the file)", async () => {
    const raw = strFromU8(unzipSync((parts[0] as { bytes: Uint8Array }).bytes, { filter: (f) => f.name === "json/chat_history.json" })["json/chat_history.json"] as Uint8Array);
    for (const c of CANARIES.messageText) expect(raw).toContain(c.replace(/ .*/, ""));

    const decoded: string[] = [];
    const real = TextDecoder.prototype.decode;
    vi.spyOn(TextDecoder.prototype, "decode").mockImplementation(function (this: TextDecoder, ...args: Parameters<typeof real>) {
      const out = real.apply(this, args);
      decoded.push(out);
      return out;
    });
    const result = mergeParsedExports(await parseParts());
    expect(result.chats.length).toBeGreaterThan(1000);
    expect(decoded.length).toBeGreaterThan(100);
    expect(decoded.filter((s) => s.includes("ZQCANARY-MSG"))).toEqual([]);
  });

  it("reads a history far bigger than the old in-memory limit's comfort zone, entry by entry", async () => {
    const big = syntheticExportParts({ now: NOW, friendCount: 500, chatMessageCount: 40_000, memoryCount: 50 });
    const first = (big[0] as { bytes: Uint8Array }).bytes;
    const snapRaw = unzipSync(first, { filter: (f) => f.name === "json/snap_history.json" })["json/snap_history.json"] as Uint8Array;
    const count = (name: string): number => {
      const bytes = unzipSync(first, { filter: (f) => f.name === name })[name] as Uint8Array;
      return Object.values(JSON.parse(strFromU8(bytes)) as Record<string, unknown[]>).reduce((n, l) => n + l.length, 0);
    };
    expect(snapRaw.length).toBeGreaterThan(16 * 1024 * 1024);
    const result = await parseExportFromReader(bytesReader(first));
    expect(result.chats).toHaveLength(count("json/chat_history.json") + count("json/snap_history.json"));
    expect(result.issues.filter((i) => /^(chat|snap)-|^json-|^zip-/.test(i.code))).toEqual([]);
  });
});

describe("privacy gate: no canary, path, name or link in any output", () => {
  const readers = parts.map((p) => bytesReader(p.bytes));
  // Names that carry a person, a group or a memory: media files and the conversation pages.
  const personalPaths = allNames.filter((n) => /^(memories|chat_media|shared_story)\//.test(n) ? !n.endsWith(".html") : n.startsWith("html/chat_history/"));
  const baseOf = (n: string): string => n.slice(n.lastIndexOf("/") + 1);
  const personalNames = personalPaths.map(baseOf);
  const fileDays = [...new Set(personalNames.map((n) => /^\d{4}-\d{2}-\d{2}/.exec(n)?.[0]).filter((d): d is string => d !== undefined))];
  const ids = [...new Set(merged.bundledMedia?.map((f) => f.idInName as string))];
  const USERNAME = /\b(?:active|dormant|snapper|ghost|removed|newfriend|oneway|exfriend|blocked|ignored|pending|suggest|contact)_\d+\b/i;

  async function outputs(): Promise<Record<string, string>> {
    const snapshot = snapshotFromExport(merged);
    const inspected = await inspectExport(readers, { showKeys: true, layout: true, memoryLinks: true, mtimeCheck: true });
    const structure = await describeStructureFromReader(readers, { showKeys: true });
    return {
      issues: JSON.stringify(merged.issues),
      pairing: JSON.stringify(merged.memoriesPairing),
      fileList: JSON.stringify(merged.fileList),
      validation: JSON.stringify(validateExport(merged)),
      inspect: inspected.text,
      structureJson: JSON.stringify(structure),
      structureText: formatStructureReport(structure),
      ledger: serializeLedger(addSnapshot(emptyLedger(), snapshot)),
      snapshot: JSON.stringify(snapshot),
      partIssues: JSON.stringify(parsed.map((p) => [p.issues, p.memoriesPairing])),
    };
  }

  it("the personal names and paths are really in the zips", () => {
    expect(personalNames.length).toBeGreaterThan(200);
    expect(personalNames.some((n) => /^subpage_/.test(n))).toBe(true);
    expect(ids.length).toBeGreaterThan(200);
  });

  it("keeps canaries, bundled paths and ids, page names, usernames and links out of every printed or serialized output", async () => {
    const out = await outputs();
    expect(Object.keys(out).length).toBeGreaterThan(8);
    for (const label of ["issues", "pairing", "inspect", "structureJson", "structureText", "snapshot"]) expect((out[label] as string).length, `${label} is empty`).toBeGreaterThan(100);
    for (const [label, text] of Object.entries(out)) {
      expect(text, `${label} is not text`).toBeTypeOf("string");
      expect(leaks(text), `canary in ${label}`).toEqual([]);
      expect(text, `link in ${label}`).not.toMatch(/https?:\/\/|snappy\.invalid/i);
      // Shapes are fine ("9999-99-99_aaaaa~9a99.jpg"); the real day a file name starts with is not.
      if (label === "inspect" || label === "structureText" || label === "structureJson") for (const day of fileDays) expect(text.includes(day), `a file date appeared in ${label}`).toBe(false);
      for (const id of ids) expect(text.includes(id), `a memory id appeared in ${label}`).toBe(false);
      for (const base of personalNames) expect(text.includes(base), `a file name appeared in ${label}`).toBe(false);
      if (label !== "ledger" && label !== "snapshot") expect(text, `a username in ${label}`).not.toMatch(USERNAME);
    }
  });

  it("keeps the same things out of the notes of every single part and of a merge of the notes", () => {
    const text = JSON.stringify([parsed.map((p) => p.issues), merged.issues, merged.memoriesPairing]);
    for (const id of ids) expect(text.includes(id)).toBe(false);
    expect(leaks(text)).toEqual([]);
  });

  it("keeps the inspect report to counts and shapes, so a page named after a group cannot show up", async () => {
    const { text } = await inspectExport(readers, { showKeys: true, layout: true, memoryLinks: true, mtimeCheck: true });
    expect(text).not.toMatch(/subpage|ZQCANARY|GRP/i);
    expect(text.length).toBeGreaterThan(200);
  });
});

// ------------------------------------------------------------------ merging ---

describe("merging the parts", () => {
  const permutations = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];

  it("gives the same result whatever the order the parts are given in", async () => {
    for (const order of permutations) {
      const result = mergeParsedExports(order.map((i) => parsed[i] as ParsedExport));
      expect(result).toEqual(merged);
    }
  });

  it("is idempotent: a merge of one part, of a part twice, or of a merge with its parts adds nothing", () => {
    const [a, b, c] = parsed as [ParsedExport, ParsedExport, ParsedExport];
    expect(mergeParsedExports([merged])).toEqual(merged);
    expect(mergeParsedExports([merged, merged])).toEqual(merged);
    expect(mergeParsedExports([a, b, c, a, b, c])).toEqual(merged);
    expect(mergeParsedExports([a, b, c, a])).toEqual(merged);
    expect(mergeParsedExports([merged, b])).toEqual(merged);
  });

  it("adds nothing when the merge is given again between its parts, apart from where the lists interleave", () => {
    const c = parsed[2] as ParsedExport;
    const again = mergeParsedExports([merged, c, merged]);
    const sorted = (xs: unknown[]): string[] => xs.map((x) => JSON.stringify(x)).sort();
    expect(sorted(again.issues)).toEqual(sorted(merged.issues));
    expect(again.fileList.slice().sort()).toEqual(merged.fileList.slice().sort());
    expect({ ...again, issues: [], fileList: [] }).toEqual({ ...merged, issues: [], fileList: [] });
  });

  it("gives, for a merge of merges, the same pairing and bundled media", () => {
    const [a, b, c] = parsed as [ParsedExport, ParsedExport, ParsedExport];
    const left = mergeParsedExports([mergeParsedExports([a, b]), c]);
    const right = mergeParsedExports([a, mergeParsedExports([b, c])]);
    for (const x of [left, right]) {
      expect(x.bundledMedia).toEqual(merged.bundledMedia);
      expect(x.memoriesPairing).toEqual(merged.memoriesPairing);
      expect(x.memories).toEqual(merged.memories);
      expect(x.chats).toEqual(merged.chats);
      expect(x.issues.map((i) => i.code).sort()).toEqual(merged.issues.map((i) => i.code).sort());
    }
  });

  it("pairs the list with the files of all parts, not of the part that holds the list", () => {
    const [a] = parsed as [ParsedExport];
    expect(mergeParsedExports([a]).memories.some((m) => m.zipPath !== undefined)).toBe(false);
    expect(merged.memories.some((m) => m.zipPath !== undefined)).toBe(true);
    const second = mergeParsedExports([a, parsed[1] as ParsedExport]);
    const onlyPart2 = second.memories.filter((m) => m.zipPath !== undefined);
    expect(onlyPart2.length).toBeGreaterThan(0);
    expect(onlyPart2.length).toBeLessThan(merged.memories.filter((m) => m.zipPath !== undefined).length);
    expect(new Set(onlyPart2.map((m) => m.partIndex))).toEqual(new Set([2]));
  });

  it("does not modify its inputs", () => {
    const before = structuredClone(parsed);
    mergeParsedExports(parsed);
    expect(parsed).toEqual(before);
  });

  it("keeps what a hand-made part says about files when no part lists any media", () => {
    const handMade: ParsedExport = { ...merged, bundledMedia: undefined, memoriesPairing: undefined };
    delete handMade.bundledMedia;
    delete handMade.memoriesPairing;
    const kept = mergeParsedExports([handMade]);
    expect(kept.memories).toEqual(handMade.memories);
    expect(kept.memories.filter((m) => m.zipPath !== undefined)).toHaveLength(plantedMains);
    expect(kept.memoriesPairing).toBeUndefined();
  });

  it("reads the same three zips the same way twice", async () => {
    expect(mergeParsedExports(await parseParts())).toEqual(merged);
  });
});
