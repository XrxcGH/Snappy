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
import { COMMANDS, displayText } from "../src/terminal/commands.ts";

const NO_YIELD = async (): Promise<void> => {};

describe("activity wording", () => {
  it("says chats and Snaps wherever quiet friends and protection are explained", () => {
    expect(copy.categories.dormant.lead).toBe("No recent chats or Snaps");
    expect(copy.quiet.lead).toMatch(/chat or Snap/);
    expect(copy.quiet.inference).toMatch(/Snap history/);
    expect(copy.quiet.inference).not.toMatch(/only holds saved chats/);
    expect(copy.quiet.emptyBody).toMatch(/chat or Snap/);
    expect(copy.quiet.noChatsTitle).toMatch(/chat or Snap history/);
    expect(copy.overview.needsChats).toBe("Needs chat or Snap history");
    expect(copy.protection["recent-message"]).toMatch(/chat or Snap/);
    expect(copy.cleanup.protectedByChats).toMatch(/Snap/);
  });

  it("no longer tells people that Snaps are invisible to Snappy", () => {
    const all = JSON.stringify([copy.quiet, copy.cleanup, copy.protection, copy.start, copy.guide, copy.privacy]);
    expect(all).not.toMatch(/such as Snaps or calls/);
    expect(all).not.toMatch(/you messaged them/i);
  });

  it("lists chat and Snap metadata as read, and text, photos and videos as never read", () => {
    const reads = Object.fromEntries(copy.privacy.readsRows.map(([what, detail]) => [what, detail]));
    expect(reads["Chat and Snap activity"]).toMatch(/who/i);
    expect(reads["Chat and Snap activity"]).toMatch(/when/);
    expect(reads["Chat and Snap activity"]).toMatch(/Never the words, photos, or videos/);
    expect(Object.keys(reads).join(" | ")).toMatch(/File names and times/);
    const never = copy.privacy.neverRows.map(([what]) => what.toLowerCase()).join(" | ");
    for (const word of ["message text", "photos and videos", "locations", "display names"]) expect(never).toContain(word);
  });

  it("tells the export guide that Snap history is optional and used the same way", () => {
    const row = copy.guide.rows.find(([option]) => option.startsWith("Chat and Snap"));
    expect(row?.[0]).toBe("Chat and Snap history");
    expect(row?.[1]).toBe("Optional");
    expect(row?.[2]).toMatch(/never reads message text/);
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

describe("Memories pairing wording", () => {
  it("shows the files found, not included and overlays as three cards; the listed count is said once, in the Memories card", () => {
    expect(copy.memories.pairingHave).toBe("Files found");
    expect(copy.memories.pairingMissing).toBe("Not included");
    expect(copy.memories.total).toBe("Memories");
    expect(copy.memories.pairingOverlayLabel).toBe("Overlays");
    expect(copy.memories.pairingOverlays).toMatch(/captions and stickers/);
  });

  it("explains why some may be missing and what to do, with hedged wording", () => {
    const why = copy.memories.pairingWhy.join(" ");
    expect(why).toMatch(/may leave out/);
    expect(copy.memories.pairingWhy[0]).toMatch(/A part may be missing/);
    expect(copy.memories.pairingTodo).toMatch(/every part/);
    expect(copy.memories.pairingTodo).toMatch(/from the Snapchat app/);
    expect(copy.memories.pairingTodo).toMatch(/request a new export/);
  });

  it("says the links are empty and that the command line tool copies the files and restores the exact capture time", () => {
    expect(copy.memories.pairingLinksEmpty).toMatch(/no download links/);
    expect(copy.memories.rescueBody).toMatch(/command line tool/);
    expect(copy.memories.rescueBody).toMatch(/dates restored/);
    expect(copy.memories.rescueBody).toMatch(/copies your Memories/);
    // The page has to say that the tool is a separate download: the installed app does not hold it.
    expect(copy.memories.rescueBody).toMatch(/separate download/);
  });

  it("shows the exact command with the person's folder as a placeholder, never a real path", () => {
    const command = displayText(COMMANDS["memories-rescue"]);
    expect(command).toBe('npm run snappy-export -- memories "<your export folder>" --out "<folder for rescued Memories>"');
    expect(copy.memories.rescueCommandLabel).toMatch(/angle brackets/);
    expect(copy.memories.rescueCommandLabel).not.toMatch(/Snappy folder|placeholders/);
    expect(copy.memories.rescueCommandLabel).toMatch(/press Run/);
    expect(command).not.toMatch(/[A-Z]:\\|\/home\/|\/Users\//);
  });

  it("explains the background reader and the one policy line it needs", () => {
    // The plain sentence is up front; the policy keywords sit in the collapsed technical details.
    expect(copy.privacy.workerBody).toMatch(/cannot connect anywhere/);
    expect(copy.privacy.workerBody).not.toMatch(/worker-src|connect-src/);
    expect(copy.privacy.policyWorker).toMatch(/worker-src blob:/);
    expect(copy.privacy.policyWorker).toMatch(/reads on the page instead/);
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
