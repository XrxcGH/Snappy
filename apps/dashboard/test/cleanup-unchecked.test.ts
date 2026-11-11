/**
 * An empty Cleanup queue must not read as "all clear" when a check could not run: Disappeared needs two exports and
 * Quiet needs chat or Snap history. Synthetic data only.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { cleanup } from "../src/copy.ts";
import type { State } from "../src/reducer.ts";
import type { View } from "../src/views/context.ts";
import { mount, sampleStateOf, textOf } from "./lists-harness.ts";

let cleanupView: View;
let sample: State;

beforeAll(async () => {
  ({ cleanupView } = (await import("../src/views/cleanup.ts")) as { cleanupView: View });
  sample = await sampleStateOf();
}, 120_000);

/** One saved snapshot with nobody in it and no export held: nothing to find, no chats, and no second snapshot to compare. */
function oneEmptySnapshot(): State {
  const first = sample.sample!.ledger.snapshots[0]!;
  const snap = { ...first, friends: [], sentRequests: [], deleted: {}, friendSince: {}, sentAt: {}, blocked: [] };
  return { ...sample, sample: { ...sample.sample!, latest: null, ledger: { version: 1, snapshots: [snap] } } };
}

describe("empty Cleanup queue", () => {
  it("names the checks that could not run", () => {
    const text = textOf(mount(cleanupView, oneEmptySnapshot()).root);
    expect(text).toContain(cleanup.nothingFoundSoFar);
    expect(text).toContain("Disappeared needs two exports.");
    expect(text).toContain("Quiet needs chat or Snap history.");
    expect(text).not.toContain(cleanup.nothingFoundBody);
  });

  it("builds the note for each missing check alone", () => {
    expect(cleanup.notAllChecked(true, false)).toContain("two exports");
    expect(cleanup.notAllChecked(true, false)).not.toContain("Quiet");
    expect(cleanup.notAllChecked(false, true)).toContain("Quiet");
    expect(cleanup.notAllChecked(false, true)).not.toContain("Disappeared");
  });
});
