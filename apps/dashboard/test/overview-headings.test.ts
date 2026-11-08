/**
 * The Overview's heading outline has no gap: the five finding tiles are h3s, so an h2 ("Findings", for screen readers
 * only because the sidebar already groups the areas under it) comes before them.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { shell } from "../src/copy.ts";
import { initialState } from "../src/reducer.ts";
import type { State } from "../src/reducer.ts";
import type { View } from "../src/views/context.ts";
import { all, mount, sampleStateOf, textOf } from "./lists-harness.ts";

vi.mock("../src/announce.ts", () => ({ announce: () => undefined }));

let overviewView: View;
let sample: State;

beforeAll(async () => {
  ({ overviewView } = (await import("../src/views/overview.ts")) as { overviewView: View });
  sample = await sampleStateOf();
}, 120_000);

const outline = (root: ReturnType<typeof mount>["root"]): { level: number; text: string }[] =>
  root.descendants().filter((e) => /^h[1-6]$/.test(e.tagName)).map((e) => ({ level: Number(e.tagName.slice(1)), text: textOf(e) }));

describe("the Overview's headings", () => {
  it("never skip a level", () => {
    for (const state of [sample, initialState()]) {
      const levels = outline(mount(overviewView, state).root).map((h) => h.level);
      expect(levels[0]).toBe(1);
      levels.forEach((level, i) => {
        if (i > 0) expect(level, `heading ${i} follows level ${levels[i - 1]}`).toBeLessThanOrEqual((levels[i - 1] as number) + 1);
      });
    }
  });

  it("puts a hidden Findings h2 before the five tiles", () => {
    const { root } = mount(overviewView, sample);
    const heading = all(root, "h2").find((h) => textOf(h) === shell.navFindings)!;
    expect(heading).toBeDefined();
    expect(heading.classList.contains("sr-only")).toBe(true);
    const order = root.descendants();
    const tiles = all(root, "a.finding h3");
    expect(tiles).toHaveLength(5);
    for (const tile of tiles) expect(order.indexOf(heading)).toBeLessThan(order.indexOf(tile));
  });
});
