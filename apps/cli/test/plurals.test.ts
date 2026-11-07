/**
 * A count of one must read as one: "1 request accepted", never "1 requests accepted". Every count
 * in the terminal text goes through the plural helpers, and these tests hold that line for the
 * analysis text and the Memories text with counts of 0, 1 and 2.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { isAre, hasHave, noun, plural, wasWere } from "../src/format.ts";
import type { AnalysisResult } from "../src/analysis.ts";
import { renderAnalysisText } from "../src/render-analysis.ts";
import { describePairing } from "../src/render.ts";
import { createTerm } from "../src/term.ts";
import { makeIo, run, tempDir, writeSyntheticZip } from "./helpers.ts";
import { collectInsightOutputs } from "./insight-outputs.ts";
import { SHARED_HOOK_TIMEOUT } from "./shared-runs.ts";

const term = createTerm({ env: {}, isTTY: false, columns: 100 });

/** A count of one next to a plural noun or a plural verb. */
const WRONG_ONE = /\b1 (friends|requests|exports|Memories|files|items|photos|videos|overlay files|parts|conversations|more failures)\b|\b1 (are|have|do|were) /;

function result(n: number): AnalysisResult {
  const people = Array.from({ length: n }, (_, i) => `person_${i}`);
  return {
    snapshotCount: n,
    latestTakenAt: Date.UTC(2026, 10, 1),
    previousTakenAt: Date.UTC(2026, 9, 1),
    changes: {
      disappeared: people,
      removedByUser: people,
      added: people,
      requestsAccepted: people,
      requestsVanished: people,
    } as unknown as AnalysisResult["changes"],
    canFindDisappeared: true,
    queue: {
      items: [],
      protectedItems: [],
      summary: { total: n, byCategory: { ghost: n, "one-way": n, dormant: n }, byConfidence: { low: 0, medium: 0, high: 0 }, protectedCount: n },
    } as unknown as AnalysisResult["queue"],
    counts: { friends: n, sentRequests: n, removedByYou: n, chatEvents: n, memories: n },
  };
}

describe("plural helpers", () => {
  it("name the singular for one and the plural for everything else", () => {
    expect([0, 1, 2].map((n) => plural(n, "request"))).toEqual(["0 requests", "1 request", "2 requests"]);
    expect([0, 1, 2].map((n) => noun(n, "Memory", "Memories"))).toEqual(["Memories", "Memory", "Memories"]);
    expect([0, 1, 2].map(isAre)).toEqual(["are", "is", "are"]);
    expect([0, 1, 2].map(hasHave)).toEqual(["have", "has", "have"]);
    expect([0, 1, 2].map(wasWere)).toEqual(["were", "was", "were"]);
  });
});

describe("analysis text", () => {
  it.each([0, 1, 2])("reads correctly with %i of each count", (n) => {
    const text = renderAnalysisText(result(n), { term, issues: [], limit: 20, ledger: "skipped" });
    expect(text).toContain(`${plural(n, "request")} accepted`);
    expect(text).toContain(`${plural(n, "friend")} you removed`);
    expect(text).toContain(`${plural(n, "export")} in your history`);
    expect(text).not.toMatch(WRONG_ONE);
  });

  it("says “1 request accepted” for a single accepted request", () => {
    const text = renderAnalysisText(result(1), { term, issues: [], limit: 20, ledger: "skipped" });
    expect(text).toContain("1 request accepted.");
    expect(text).not.toContain("1 requests");
  });
});

describe("Memories pairing text", () => {
  const base = { method: "utc-time", offsetHours: 0, overlays: 0, unmatchedFiles: 0, ambiguous: 0, unmatchedItems: 0 } as const;

  it.each([0, 1, 2])("reads correctly with %i of each count", (n) => {
    const text = describePairing({ ...base, items: n + 1, paired: n, unmatchedItems: n, ambiguous: n, overlays: n, unmatchedFiles: n } as Parameters<typeof describePairing>[0]);
    expect(text).not.toMatch(WRONG_ONE);
    if (n === 1) {
      expect(text).toContain("Memories is matched");
      expect(text).toContain("1 has no matching file");
      expect(text).toContain("so Snappy skipped it");
      expect(text).toContain("1 overlay file goes with it.");
      expect(text).toContain("1 file in the ZIP files matches no Memory.");
    }
  });
});

/**
 * The insight commands print their counts through the same helpers. Over every captured run (default
 * output, options and mistakes) a count of one must not sit next to a plural noun or a plural verb.
 * The nouns here are the ones those commands count, beyond the list WRONG_ONE holds for analysis text.
 */
const WRONG_ONE_INSIGHT = /\b1 (days|entries|dates|usernames|people|years|months|weeks|chats|messages|batches|steps|points|notes|alerts|matches|results|ids|snaps|groups|anniversaries|milestones)\b/;

describe("insight command text", () => {
  // The runs are shared with other test files, so on a busy machine this may wait for another worker.
  beforeAll(async () => {
    await collectInsightOutputs();
  }, SHARED_HOOK_TIMEOUT);

  it("reads correctly wherever a count is one", async () => {
    const outputs = await collectInsightOutputs();
    expect(Object.keys(outputs).length).toBeGreaterThan(50);
    for (const [name, text] of Object.entries(outputs)) {
      expect(text, name).not.toMatch(WRONG_ONE);
      expect(text, name).not.toMatch(WRONG_ONE_INSIGHT);
    }
  });
});

describe("Memories rescue text", () => {
  it.each([1, 2])("reads correctly for an export with %i Memories", async (memoryCount) => {
    const dir = tempDir("plural");
    const zip = writeSyntheticZip(dir, "later.zip", { memoryCount });
    const { out, err } = await run(["memories", zip, "--dry-run"], makeIo());
    expect(out + err).not.toMatch(WRONG_ONE);
  });
});
