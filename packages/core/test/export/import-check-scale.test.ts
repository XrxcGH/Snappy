import { describe, expect, it } from "vitest";
import * as core from "../../src/index.ts";
import { REAL6, buildScale, runScale } from "../../../../tools/import-check/scale.ts";
import { sparseZip } from "../../../../tools/import-check/sparse-zip.ts";

/** The shape of real6 at a size a unit test can afford. */
const SMALL = { ...REAL6, parts: 4, friends: 60, conversations: 40, messagesPerConversation: 6, snapsPerConversation: 4, memories: 900 };

describe("the sparse ZIP the import checks are built on", () => {
  it("is a real archive for the reader: listing, JSON and sizes", async () => {
    const reader = sparseZip([
      { name: "json/friends.json", bytes: new TextEncoder().encode('{"Friends":[{"Username":"amy_1"}]}') },
      { name: "memories/a-main.jpg", size: 3_000_000_000, utcMs: Date.UTC(2024, 0, 1) },
      { name: "memories/b-main.jpg", size: 1_000_000_000, utcMs: Date.UTC(2024, 0, 2), utcIn: "local" },
    ]);
    expect(reader.size).toBeGreaterThan(4_000_000_000);
    const listing = await core.listZipEntries(reader);
    expect(listing.issues).toEqual([]);
    expect(listing.entries.map((e) => [e.name, e.size])).toEqual([["json/friends.json", 34], ["memories/a-main.jpg", 3_000_000_000], ["memories/b-main.jpg", 1_000_000_000]]);
    expect(listing.entries.map((e) => e.mtimeUtcMs)).toEqual([undefined, Date.UTC(2024, 0, 1), undefined]); // the third keeps its time in the local header only
    const parsed = await core.parseExportFromReader(reader);
    expect(parsed.friends.friends.map((f) => f.username)).toEqual(["amy_1"]);
  });

  it("answers any range, zeros for the virtual data, and refuses a range outside it", async () => {
    const reader = sparseZip([{ name: "x.bin", size: 100 }]);
    const all = await reader.read(0, reader.size);
    expect(all.length).toBe(reader.size);
    await expect(reader.read(0, reader.size + 1)).rejects.toThrow(RangeError);
    await expect(reader.read(-1, 3)).rejects.toThrow(RangeError);
  });

  it("refuses what would need zip64", () => {
    expect(() => sparseZip([{ name: "big.bin", size: 5_000_000_000 }])).toThrow(RangeError);
  });
});

describe("a scaled export is found whole", () => {
  for (const localOnlyTimes of [false, true]) {
    it(`${localOnlyTimes ? "times only in the local headers" : "times in the directory"}`, async () => {
      const { parts, expect: want } = buildScale({ ...SMALL, localOnlyTimes });
      expect(parts).toHaveLength(4);
      const r = await runScale(parts);
      expect(r.errors).toEqual([]);
      expect(r.merged.friends.friends).toHaveLength(want.friends);
      expect(r.merged.chats).toHaveLength(want.chatEvents);
      expect(r.merged.memories).toHaveLength(want.memories);
      expect(r.merged.memoriesPairing?.paired).toBe(want.paired);
      // the local-header pass reads each Memories file's header (and its extra field) once: two reads each, no more
      if (localOnlyTimes) {
        expect(r.reads).toBeGreaterThanOrEqual(2 * SMALL.memories);
        expect(r.reads).toBeLessThan(2 * SMALL.memories + 200);
        expect(r.phases.map((p) => p.phase)).toEqual(Array(3).fill(core.LOCAL_TIME_PHASE));
      } else {
        expect(r.reads).toBeLessThan(200);
        expect(r.phases).toEqual([]);
      }
    });
  }
});

describe("what the checks need from the core's public entry", () => {
  it("exports the new import helpers", () => {
    expect(typeof core.failureClass).toBe("function");
    expect(typeof core.visibleIssues).toBe("function");
    expect(core.LOCAL_TIME_PHASE).toBe("Matching Memories to files");
  });
});
