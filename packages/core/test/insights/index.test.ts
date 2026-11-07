import { describe, expect, it } from "vitest";
import { insights } from "../../src/index.ts";

describe("insights namespace", () => {
  it("offers all twenty-one features, each with at least one function", () => {
    const names = Object.keys(insights).sort();
    expect(names).toEqual([
      "activityCalendar", "anniversaries", "blockedReview", "closestFading", "exportCheck", "exportReminder",
      "friendCountHistory", "friendsBackup", "friendsTable", "habits", "lookalikeUsernames", "memoriesOnThisDay",
      "privacyTuneup", "reachOutFirst", "replySpeed", "rescueManifest", "safetyChecklist", "sinceLastExport",
      "storagePlanner", "waitingOnReply", "yearInReview",
    ]);
    for (const name of names) {
      const mod = (insights as Record<string, Record<string, unknown>>)[name] as Record<string, unknown>;
      expect(Object.values(mod).some((v) => typeof v === "function"), name).toBe(true);
    }
  });
});
