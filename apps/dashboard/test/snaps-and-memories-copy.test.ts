/**
 * What the screens say now that Snaps count as activity and Memories files are paired: the
 * wording, and the counts behind the Memories pairing summary. Synthetic data only.
 */
import { describe, expect, it } from "vitest";
import { buildSampleWorkspace } from "../src/sample.ts";
import * as copy from "../src/copy.ts";
import { pairingFacts } from "../src/pairing-facts.ts";
import { runImport } from "../src/import-pipeline.ts";
import { partFiles } from "./export-fixtures.ts";

const NO_YIELD = async (): Promise<void> => {};

describe("activity wording", () => {
  it("says chats and Snaps wherever quiet friends and protection are explained", () => {
    expect(copy.categories.dormant.lead).toBe("No recent chats or Snaps");
    expect(copy.quiet.lead).toMatch(/chat or Snap/);
    expect(copy.quiet.inference).toMatch(/Snap history/);
    expect(copy.quiet.inference).not.toMatch(/only holds saved chats/);
    expect(copy.quiet.emptyBody).toMatch(/chat or Snap/);
    expect(copy.quiet.noChatsTitle).toMatch(/chat or Snap history/);
    expect(copy.overview.cardQuiet(0, false)).toBe("Needs chat or Snap history");
    expect(copy.protection["recent-message"]).toMatch(/Snaps/);
    expect(copy.cleanup.note).toMatch(/Snap/);
    expect(copy.cleanup.protectedBody).toMatch(/Snaps/);
  });

  it("no longer tells people that Snaps are invisible to Snappy", () => {
    const all = JSON.stringify([copy.quiet, copy.cleanup, copy.protection, copy.start, copy.guide, copy.privacy]);
    expect(all).not.toMatch(/such as Snaps or calls/);
    expect(all).not.toMatch(/you messaged them/i);
  });

  it("lists chat and Snap metadata as read, and text, photos and videos as never read", () => {
    const reads = Object.fromEntries(copy.privacy.readsRows.map(([what, detail]) => [what, detail]));
    expect(reads["Chat and Snap metadata"]).toMatch(/who/i);
    expect(reads["Chat and Snap metadata"]).toMatch(/when/);
    expect(reads["Chat and Snap metadata"]).toMatch(/Never what was said/);
    expect(reads["Chat and Snap metadata"]).toMatch(/never the photo or video/);
    expect(Object.keys(reads).join(" | ")).toMatch(/times inside the ZIPs/);
    const never = copy.privacy.neverRows.map(([what]) => what.toLowerCase()).join(" | ");
    for (const word of ["message text", "photos and videos", "locations", "display names"]) expect(never).toContain(word);
  });

  it("tells the export guide that Snap history is optional and used the same way", () => {
    const row = copy.guide.rows.find(([option]) => option.startsWith("Chat history"));
    expect(row?.[0]).toBe("Chat history and Snap history");
    expect(row?.[2]).toMatch(/never read or kept/);
  });
});

describe("progress wording", () => {
  it("names the part being read and the real percentage", () => {
    expect(copy.start.reading(0, 3, 0)).toBe("Part 1 of 3: reading, 0% done");
    expect(copy.start.reading(1, 3, 0.426)).toBe("Part 2 of 3: reading, 43% done");
    expect(copy.start.reading(2, 3, null)).toBe("Part 3 of 3: reading");
    expect(copy.start.reading(2, 3)).toBe("Part 3 of 3: reading");
    expect(copy.start.reading(3, 3, 1)).toBe("Putting the parts together");
    expect(copy.start.reading(0, 1, 0.5)).toBe("Reading your export, 50% done");
    expect(copy.start.reading(0, 1)).toBe("Reading your export");
    expect(copy.start.reading(0, 2, 7)).toBe("Part 1 of 2: reading, 100% done");
    expect(copy.start.reading(0, 2, -1)).toBe("Part 1 of 2: reading, 0% done");
  });

  it("explains that part 1 holds the lists", () => {
    expect(copy.start.laterPartsOnly).toMatch(/part 1/);
    expect(copy.start.laterPartsOnly).toMatch(/no number/);
    expect(copy.start.addBody).toMatch(/any order/);
  });
});

describe("Memories pairing summary", () => {
  it("says N listed, M have a file, K are not included, in plain words", () => {
    expect(copy.memories.pairingSummary(711, 498, 213)).toBe("711 saved Memories listed, 498 have a file in your export, 213 are not included.");
    expect(copy.memories.pairingSummary(1, 1, 0)).toBe("1 saved Memory listed, 1 has a file in your export, 0 are not included.");
    expect(copy.memories.pairingSummary(2, 1, 1)).toBe("2 saved Memories listed, 1 has a file in your export, 1 is not included.");
  });

  it("explains why some may be missing and what to do, with hedged wording", () => {
    const why = copy.memories.pairingWhy.join(" ");
    expect(why).toMatch(/may leave out/);
    expect(why).toMatch(/every part/);
    expect(copy.memories.pairingTodo).toMatch(/inside the Snapchat app/);
    expect(copy.memories.pairingTodo).toMatch(/request a new export/);
  });

  it("says the links are empty and that the command-line tool extracts the files and restores the exact capture time", () => {
    expect(copy.memories.pairingLinksEmpty).toMatch(/links in this export are empty/);
    expect(copy.memories.rescueBody).toMatch(/command-line tool/);
    expect(copy.memories.rescueBody).toMatch(/exact capture time/);
    expect(copy.memories.rescueBody).toMatch(/takes the files out of your ZIPs/);
  });

  it("shows the exact command with the person's folder as a placeholder, never a real path", () => {
    expect(copy.memories.rescueCommand).toBe('npm run snappy-export -- memories "<your export folder>" --out "<folder for rescued Memories>"');
    expect(copy.memories.rescueCommandLabel).toMatch(/placeholders/);
    expect(copy.memories.rescueCommand).not.toMatch(/[A-Z]:\\|\/home\/|\/Users\//);
  });

  it("explains the background reader and the one policy line it needs", () => {
    expect(copy.privacy.workerBody).toMatch(/worker-src blob:/);
    expect(copy.privacy.workerBody).toMatch(/connect-src 'none'/);
    expect(copy.privacy.workerBody).toMatch(/reads on the page instead/);
  });
});

describe("pairingFacts", () => {
  it("counts what the export holds, from the pairing alone", async () => {
    const parsed = await runImport(partFiles(2), { onProgress: () => {}, yieldToUi: NO_YIELD });
    const facts = pairingFacts(parsed, parsed.issues);
    expect(facts).not.toBeNull();
    expect(facts?.listed).toBe(parsed.memoriesPairing?.items);
    expect(facts?.have).toBe(parsed.memoriesPairing?.paired);
    expect((facts?.have ?? 0) + (facts?.missing ?? 0)).toBe(facts?.listed);
    expect(facts?.have).toBeGreaterThan(0);
    expect(facts?.missing).toBeGreaterThan(0);
    expect(facts?.linksEmpty).toBe(true);
  });

  it("is null when there is no pairing, and knows when the links are not empty", async () => {
    expect(pairingFacts(null, [])).toBeNull();
    const [base] = partFiles(2);
    const first = await runImport([base as File], { onProgress: () => {}, yieldToUi: NO_YIELD });
    expect(pairingFacts(first, first.issues)).toBeNull();
    const withFiles = await runImport(partFiles(2), { onProgress: () => {}, yieldToUi: NO_YIELD });
    expect(pairingFacts(withFiles, [])?.linksEmpty).toBe(false);
  });

  it("holds numbers only, so no file name, path or link can reach the screen", async () => {
    const parsed = await runImport(partFiles(2), { onProgress: () => {}, yieldToUi: NO_YIELD });
    const facts = pairingFacts(parsed, parsed.issues);
    for (const value of Object.values(facts ?? {})) expect(["number", "boolean"]).toContain(typeof value);
  });

  it("works for the sample data too, which is built the realistic way", async () => {
    const sample = await buildSampleWorkspace();
    const facts = pairingFacts(sample.latest, sample.issues);
    expect(facts?.listed).toBeGreaterThan(0);
    expect(facts?.have).toBeGreaterThan(0);
    expect(facts?.linksEmpty).toBe(true);
  });
});
