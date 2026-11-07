/**
 * How a tool gets its data: by reference from the workspace the page already holds, as one object that stays the
 * same while nothing it reads changes, with each need answered honestly and the held results forgotten on Lock.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { resetAnalysisCache } from "../../src/analysis.ts";
import { initialState, reduce } from "../../src/reducer.ts";
import type { State } from "../../src/reducer.ts";
import { SAMPLE_NOW } from "../../src/sample.ts";
import { cachedResult, runTool } from "../../src/tools/run.ts";
import { toolData, unmetNeed } from "../../src/tools/data.ts";
import { emptyState, sampleState, sampleWorkspace, stateWith } from "./harness.ts";

let sample: State;
beforeAll(async () => {
  sample = await sampleState();
}, 120_000);

describe("toolData", () => {
  it("reads the sample by reference: the same parsed export, the fixed sample clock, no part count", () => {
    const data = toolData(sample);
    expect(data.parsed).toBe(sample.sample?.latest);
    expect(data).toMatchObject({ source: "export", sample: true, now: SAMPLE_NOW, parts: null, importFailed: false });
    expect(data.issues).toBe(sample.sample?.issues);
  });

  it("gives the very same object back until something a tool reads changes", () => {
    const first = toolData(sample);
    expect(toolData({ ...sample })).toBe(first);
    // Keeping a friend edits the keep list, which no tool reads.
    expect(toolData(reduce(sample, { type: "keep", username: "someone" }))).toBe(first);
    // A new storage cap, or a refused import, is something a tool reads.
    expect(toolData(reduce(sample, { type: "cap", gib: 7 }))).not.toBe(first);
    expect(toolData(reduce(sample, { type: "import-failed", message: "x" })).importFailed).toBe(true);
  });

  it("knows how many ZIP parts a real export had, and drops that count with the export it described", () => {
    const parsed = sample.sample?.latest;
    if (!parsed) throw new Error("no sample export");
    const start = reduce(initialState(), { type: "import-started", steps: 3, sample: false });
    const done = reduce(start, { type: "import-finished", latest: parsed, issues: [], snapshot: null, now: 5, parts: 3 });
    expect(toolData(done)).toMatchObject({ source: "export", sample: false, parts: 3, now: 5 });
    // An older export does not replace the newer one, so it does not replace its part count either.
    const older = { ...parsed, exportedAt: (parsed.exportedAt ?? 10) - 1000 };
    expect(toolData(reduce(done, { type: "import-finished", latest: older, issues: [], snapshot: null, now: 6, parts: 1 })).parts).toBe(3);
  });

  it("rebuilds friends from the newest saved snapshot when no export was added this session", async () => {
    const ws = await sampleWorkspace();
    const data = toolData(stateWith({ ledger: ws.ledger }));
    expect(data.source).toBe("ledger");
    expect(data.parsed?.friends.friends.length).toBeGreaterThan(0);
    expect(data.parsed?.chats).toEqual([]);
    expect(data.parsed?.memories).toEqual([]);
  });

  it("is empty when nothing is loaded", () => {
    expect(toolData(emptyState())).toMatchObject({ parsed: null, source: "none", sample: false, parts: null });
  });
});

describe("unmetNeed", () => {
  it("is met when a tool needs nothing, with or without data", () => {
    expect(unmetNeed(toolData(emptyState()), [])).toBeNull();
    expect(unmetNeed(toolData(sample), [])).toBeNull();
  });

  it("asks for an export first when nothing is loaded, whatever else the tool needs", () => {
    for (const needs of [["export"], ["friends"], ["chats"], ["memories"], ["chats", "memories"]] as const) {
      expect(unmetNeed(toolData(emptyState()), needs)).toBe("export");
    }
  });

  it("is met by the sample, which has friends, chats and Memories", () => {
    expect(unmetNeed(toolData(sample), ["export", "friends", "chats", "memories"])).toBeNull();
  });

  it("does not take saved history for an export, nor for chats or Memories, which it never stores", async () => {
    const data = toolData(stateWith({ ledger: (await sampleWorkspace()).ledger }));
    expect(unmetNeed(data, ["export"])).toBe("export");
    expect(unmetNeed(data, ["friends"])).toBeNull();
    expect(unmetNeed(data, ["chats"])).toBe("chats");
    expect(unmetNeed(data, ["memories"])).toBe("memories");
  });

  it("names the first thing missing, in a fixed order", () => {
    const parsed = sample.sample?.latest;
    if (!parsed) throw new Error("no sample export");
    const bare = toolData(stateWith({ latest: { ...parsed, chats: [], memories: [] } }));
    expect(unmetNeed(bare, ["memories", "chats"])).toBe("chats");
    expect(unmetNeed(bare, ["memories"])).toBe("memories");
    const noFriends = toolData(stateWith({ latest: { ...parsed, friends: { ...parsed.friends, friends: [] } } }));
    expect(unmetNeed(noFriends, ["chats", "friends"])).toBe("friends");
  });
});

describe("held results", () => {
  it("remember a result for the same data and parameters, and only then", async () => {
    const data = toolData(sample);
    let calls = 0;
    const work = (): number => ++calls;
    expect(cachedResult("t", data, "{}")).toBeUndefined();
    expect(await runTool("t", data, "{}", work)).toBe(1);
    expect(cachedResult<number>("t", data, "{}")).toEqual({ result: 1 });
    expect(cachedResult("t", data, '{"a":1}')).toBeUndefined();
    expect(cachedResult("t", toolData(reduce(sample, { type: "cap", gib: 9 })), "{}")).toBeUndefined();
    expect(calls).toBe(1);
  });

  it("run after the caller returns, so the page can paint first", async () => {
    const order: string[] = [];
    const pending = runTool("later", toolData(sample), "{}", () => void order.push("work"));
    order.push("returned");
    await pending;
    expect(order).toEqual(["returned", "work"]);
  });

  it("reject when the work throws, and remember nothing", async () => {
    const data = toolData(sample);
    await expect(
      runTool("boom", data, "{}", () => {
        throw new Error("canary");
      }),
    ).rejects.toThrow("canary");
    expect(cachedResult("boom", data, "{}")).toBeUndefined();
  });

  it("are forgotten with the analysis cache, which Lock and Delete data clear", async () => {
    const data = toolData(sample);
    await runTool("forget", data, "{}", () => "kept");
    expect(cachedResult("forget", data, "{}")).toEqual({ result: "kept" });
    resetAnalysisCache();
    expect(cachedResult("forget", data, "{}")).toBeUndefined();
    // The data is rebuilt too, so no export stays reachable from here.
    expect(toolData(sample)).not.toBe(data);
  });
});
