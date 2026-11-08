/**
 * The Cleanup toolbar is compact: the lists, the search and the mode toggle sit in one control block, the count line and
 * Save and Copy share one line, the help for Save and Copy is a description for screen readers and not a visible
 * paragraph, and the removal warning is one notice above the rows. (The first row being inside 800 px at 1280 is
 * checked in a real browser: see the track's notes.)
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup } from "../src/copy.ts";
import type { State } from "../src/reducer.ts";
import type { View } from "../src/views/context.ts";
import { all, byLabel, mount, sampleStateOf, textOf } from "./lists-harness.ts";

vi.mock("../src/announce.ts", () => ({ announce: () => undefined }));

let cleanupView: View;
let disappearedView: View;
let sample: State;

beforeAll(async () => {
  ({ cleanupView } = (await import("../src/views/cleanup.ts")) as { cleanupView: View });
  ({ disappearedView } = (await import("../src/views/findings.ts")) as { disappearedView: View });
  sample = await sampleStateOf();
}, 120_000);

describe("the Cleanup toolbar", () => {
  it("holds the lists, the search and the mode toggle in one control block", () => {
    const { root } = mount(cleanupView, sample);
    const blocks = all(root, ".controls");
    expect(blocks).toHaveLength(1);
    const block = blocks[0]!;
    expect(block.hasAttribute("class") && block.classList.contains("cleanup-controls")).toBe(true);
    expect(all(block, "select").map((s) => s.getAttribute("id"))).toEqual(["filter-category", "filter-confidence", "filter-sort"]);
    expect(all(block, "input[type=search]")).toHaveLength(1);
    expect(all(block, ".segmented button").map((b) => textOf(b))).toEqual([cleanup.modeReview, cleanup.modeGuided]);
    // The toggle comes last, so it sits at the right.
    const kids = block.childNodes.filter((n) => "classList" in n) as unknown as ReturnType<typeof all>;
    expect(kids[kids.length - 1]?.classList.contains("segmented")).toBe(true);
  });

  it("puts the count line and Save and Copy on one line", () => {
    const { root } = mount(cleanupView, sample);
    const bars = all(root, ".list-bar");
    expect(bars).toHaveLength(1);
    expect(all(bars[0]!, "p.summary")).toHaveLength(1);
    expect(byLabel(bars[0]!, cleanup.saveList)).toBeDefined();
    expect(byLabel(bars[0]!, cleanup.copyList)).toBeDefined();
  });

  it("keeps the help as a description for screen readers, not a visible paragraph", () => {
    const { root } = mount(cleanupView, sample);
    expect(all(root, "p").filter((p) => textOf(p) === cleanup.listHelp)).toHaveLength(0);
    const help = all(root, "span.sr-only").find((s) => textOf(s) === cleanup.listHelp)!;
    expect(help).toBeDefined();
    for (const label of [cleanup.saveList, cleanup.copyList]) expect(byLabel(root, label)?.getAttribute("aria-describedby")).toBe(help.getAttribute("id"));
  });

  it("has one warning, above the rows and after the first line of controls", () => {
    const { root } = mount(cleanupView, sample);
    const warnings = all(root, ".notice-warning");
    expect(warnings).toHaveLength(1);
    expect(textOf(warnings[0]!)).toContain(cleanup.removalWarning);
    const order = root.descendants();
    expect(order.indexOf(warnings[0]!)).toBeGreaterThan(order.indexOf(all(root, ".list-bar")[0]!));
    expect(order.indexOf(warnings[0]!)).toBeLessThan(order.indexOf(all(root, "li.candidate")[0]!));
  });
});

describe("the finding lists use the same one-line bar", () => {
  it("shows the count line with Save and Copy on one line, with no visible help paragraph", () => {
    const { root } = mount(disappearedView, sample);
    const bar = all(root, ".list-bar")[0]!;
    expect(all(bar, "p.summary")).toHaveLength(1);
    expect(byLabel(bar, cleanup.saveList)).toBeDefined();
    expect(all(root, "p").filter((p) => textOf(p) === cleanup.listHelp)).toHaveLength(0);
  });
});
