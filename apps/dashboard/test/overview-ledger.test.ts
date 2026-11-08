/**
 * The Overview after unlocking a saved history with no export loaded: Memories are not saved with the history, so the
 * Memories card and the counts heading say that, and not "in this export". With an export loaded, nothing changes.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { overview } from "../src/copy.ts";
import { lists } from "../src/copy-lists.ts";
import { initialState } from "../src/reducer.ts";
import type { State } from "../src/reducer.ts";
import type { View } from "../src/views/context.ts";
import { all, mount, textOf } from "./lists-harness.ts";
import { sampleWorkspace } from "./tools/harness.ts";

vi.mock("../src/announce.ts", () => ({ announce: () => undefined }));

let overviewView: View;
let ledgerOnly: State;
let noMemories: State;
let withMemories: State;

beforeAll(async () => {
  ({ overviewView } = (await import("../src/views/overview.ts")) as { overviewView: View });
  const ws = await sampleWorkspace();
  const base = initialState();
  ledgerOnly = { ...base, real: { ...ws, latest: null } };
  noMemories = { ...base, real: { ...ws, latest: { ...ws.latest!, memories: [] } } };
  withMemories = { ...base, real: ws };
}, 120_000);

const memoriesCard = (root: ReturnType<typeof mount>["root"]): string => textOf(all(root, "a.finding").find((a) => a.getAttribute("href") === "#/memories")!);
const headings = (root: ReturnType<typeof mount>["root"]): string[] => all(root, "h2").map((h) => textOf(h));

describe("the Overview from a saved history", () => {
  it("says Memories are not saved with the history, and calls the counts the saved history's", () => {
    const { root } = mount(overviewView, ledgerOnly);
    expect(memoriesCard(root)).toContain(lists.cardMemoriesLedger);
    expect(memoriesCard(root)).not.toContain(overview.cardMemoriesNone);
    expect(headings(root)).toContain(lists.countsHeadingLedger);
    expect(headings(root)).not.toContain(overview.countsHeading);
  });
});

describe("the Overview from an export", () => {
  it("keeps the export's words when the export has no Memories", () => {
    const { root } = mount(overviewView, noMemories);
    expect(memoriesCard(root)).toContain(overview.cardMemoriesNone);
    expect(memoriesCard(root)).not.toContain(lists.cardMemoriesLedger);
    expect(headings(root)).toContain(overview.countsHeading);
    expect(headings(root)).not.toContain(lists.countsHeadingLedger);
  });

  it("keeps the count of Memories when there are some", () => {
    const { root } = mount(overviewView, withMemories);
    expect(memoriesCard(root)).toContain(overview.unitMemories(400));
    expect(headings(root)).toContain(overview.countsHeading);
  });
});
