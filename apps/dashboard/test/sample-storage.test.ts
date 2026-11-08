/**
 * What the built-in sample data shows about storage: the Memories meter reads in MB or GB with a share of the cap
 * and a projected month, and the storage planner has sizes to plan with. Synthetic data only.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { analyze } from "../src/analysis.ts";
import { memories } from "../src/copy.ts";
import { formatMonth } from "../src/format.ts";
import { SAMPLE_NOW } from "../src/sample.ts";
import type { State } from "../src/reducer.ts";
import { computeStoragePlanner, DEFAULT_PARAMS } from "../src/tools/storage-planner/model.ts";
import { toolData } from "../src/tools/data.ts";
import { memoriesView } from "../src/views/memories.ts";
import { render, sampleState } from "./tools/harness.ts";

vi.mock("../src/announce.ts", () => ({ announce: () => undefined }));

const MB = 1000 * 1000;
let state: State;
beforeAll(async () => {
  state = await sampleState();
}, 120_000);

describe("the sample's storage meter", () => {
  it("has sizes: hundreds of MB to a few GB, a share of the cap and a projected date", () => {
    const meter = analyze(state).plan?.meter;
    expect(meter?.knownBytes).toBeGreaterThan(300 * MB);
    expect(meter?.knownBytes).toBeLessThan(3000 * MB);
    expect(meter?.fractionOfCap).toBeGreaterThan(0.05);
    expect(meter?.projectedCapAt).not.toBeNull();
    expect(meter?.projectedCapAt as number).toBeGreaterThan(SAMPLE_NOW);
  });

  it("shows on the Memories page as a size, not as '0%' or as missing sizes, and names the month", () => {
    const meter = analyze(state).plan?.meter;
    const text = render(memoriesView, state).root.textContent;
    expect(text).not.toContain(memories.noSizes);
    expect(text).not.toContain(memories.noProjection);
    expect(text).toMatch(/\d(?:\.\d)? (?:MB|GB) of 5 GB \((?:[1-9]|\d\d)%\)/);
    expect(text).toContain(memories.projection(formatMonth(meter?.projectedCapAt as number)));
  });

  it("still shows the real export's empty links, which the sample keeps", () => {
    expect(render(memoriesView, state).root.textContent).toContain(memories.pairingLinksEmpty);
  });
});

describe("the storage planner on the sample", () => {
  it("plans from the sizes, in more than one year", () => {
    const result = computeStoragePlanner(toolData(state), DEFAULT_PARAMS);
    if (result === null) throw new Error("the planner had nothing to plan");
    expect(result.plan.totals.knownBytes).toBeGreaterThan(300 * MB);
    expect(result.plan.byYear.length).toBeGreaterThan(2);
    expect(result.plan.fit.items).toBeGreaterThan(100);
  });
});
