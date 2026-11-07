/**
 * Regression tests for the dashboard: skipped files are said out loud, the Cleanup page says
 * whether protection data exists, Memories notes stay out of the "read these first" count, and
 * Memories is spelled as Snapchat spells it. Synthetic data only.
 */
import { describe, expect, it } from "vitest";
import { analyze } from "../src/analysis.ts";
import { cleanup, memories, overview, start } from "../src/copy.ts";
import { partFiles, setup } from "./export-fixtures.ts";

describe("files that are not zips", () => {
  it("are skipped with a visible warning that says what to do, not silently", async () => {
    const [base, second, third] = partFiles(2);
    const half = new File([new Uint8Array(10)], "mydata~1-3.zip.crdownload");
    const { store, actions } = setup();
    expect(await actions.importZips([base as File, second as File, third as File, half])).toBe("done");
    const issue = store.get().real.issues.find((i) => i.code === "files-skipped-not-zip");
    expect(issue).toMatchObject({ severity: "warning" });
    expect(issue?.message).toBe(start.skippedFiles(1));
    expect(issue?.message).toContain("1 file was skipped because it is not a ZIP file.");
    expect(issue?.message).not.toContain("crdownload");
  });

  it("add no note when every file was a zip", async () => {
    const { store, actions } = setup();
    await actions.importZips(partFiles(2));
    expect(store.get().real.issues.some((i) => i.code === "files-skipped-not-zip")).toBe(false);
  });

  it("word the note for several files", () => {
    expect(start.skippedFiles(3)).toContain("3 files were skipped because they are not ZIP files.");
  });
});

describe("the Cleanup page and its protection", () => {
  it("states the 30-day protection only with chat data, and warns when there is none", () => {
    expect(cleanup.lead).not.toMatch(/30 days/);
    expect(cleanup.protectedByChats).toContain("30 days");
    expect(cleanup.noChatProtection(false)).toMatch(/cannot protect recent chats/);
    expect(cleanup.noChatProtection(false)).toMatch(/no chat history/);
    expect(cleanup.noChatProtection(true)).toMatch(/not saved/);
    expect(cleanup.noChatProtection(true)).toMatch(/Check Snapchat before you remove anyone/);
  });

  it("has chat data after a full import, so the protection data is present", async () => {
    const { store, actions } = setup();
    await actions.importZips(partFiles(2));
    expect(analyze(store.get()).hasChats).toBe(true);
  });
});

describe("Memories is spelled as Snapchat spells it", () => {
  it("is capitalized in the counts and notes", () => {
    expect(overview.unitMemories(400)).toBe("Memories in your export");
    expect(overview.unitMemories(1)).toBe("Memory in your export");
    expect(overview.cardMemoriesNone).toBe("No Memories in this export");
    expect(memories.unknownSizes(139)).toBe("Some Memories have no listed size, so the total may be low.");
    expect(memories.unknownSizes(1)).toBe("One Memory has no listed size, so the total may be low.");
  });

  it("puts a missing part first among the reasons some Memories may not be included", () => {
    expect(memories.pairingWhy[0]).toMatch(/A part may be missing/);
  });

  it("keeps Memories notes out of the 'read these first' count", () => {
    expect(overview.healthMemoriesNote).toMatch(/do not change your friend results/);
  });
});
