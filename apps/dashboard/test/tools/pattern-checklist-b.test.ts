/**
 * The wording and format rules that every tool page keeps, checked on the nine pages of this group as one list. Each rule
 * reads the words of the tool's copy.ts (all its strings, and every function with sample arguments), so a new string that
 * breaks a rule fails here the moment it is written. The pages' own tests check what each page shows.
 */
import { describe, expect, it } from "vitest";
import { collectCopy } from "../copy-rules.ts";

const IDS = ["export-reminder", "memories-on-this-day", "reach-out-first", "rescue-manifest", "reply-speed", "since-last-export", "storage-planner", "waiting-on-reply", "year-in-review"] as const;

async function words(id: string): Promise<{ id: string; text: string }[]> {
  const { copy } = (await import(`../../src/tools/${id}/copy.ts`)) as { copy: Record<string, unknown> };
  return collectCopy({ copy }).map((e) => ({ id: `${id}: ${e.id}`, text: e.text }));
}

async function all(): Promise<{ id: string; text: string }[]> {
  return (await Promise.all(IDS.map(words))).flat();
}

/** The strings of all nine pages that match, as "where: text", so a failure says which one. */
async function matching(re: RegExp): Promise<string[]> {
  return (await all()).filter((e) => re.test(e.text)).map((e) => `${e.id}: ${e.text}`);
}

describe("the words of the nine pages", () => {
  it("tell people to check in Snapchat, never in the app (the app is Snappy)", async () => {
    expect(await matching(/\bin the app\b/i)).toEqual([]);
  });

  it("say Save for a file: Save CSV, Save JSON, Save calendar file, and never Download for one", async () => {
    expect(await matching(/\bDownload (the |a )?(CSV|JSON|calendar|manifest|file)/i)).toEqual([]);
    const buttons = (await all()).filter((e) => /\.download(Label|Button)$/.test(e.id));
    expect(buttons.map((b) => b.text).sort()).toEqual(["Save CSV", "Save CSV", "Save JSON", "Save calendar file"]);
  });

  it("call the saved store the saved history: no snapshots, no switch to turn saving on", async () => {
    expect(await matching(/\bsnapshots?\b|turned saving on|saved data/i)).toEqual([]);
  });
});
