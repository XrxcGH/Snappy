/**
 * Paging on the Cleanup queue: "Show more" paints only the next rows (the ones already drawn are left alone, so the cost
 * of a press does not grow with the list), and a filter change goes back to the first page, as a search or an order does.
 * Synthetic data only.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { addSnapshot, bytesReader, emptyLedger, mergeParsedExports, parseExportFromReader, snapshotFromExport, syntheticExportZip } from "@snappy-export/core";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { common } from "../src/copy.ts";
import { h } from "../src/dom.ts";
import { pagedList, resetPaging } from "../src/components/pagedList.ts";
import { initialState } from "../src/reducer.ts";
import type { State } from "../src/reducer.ts";
import type { View } from "../src/views/context.ts";
import type { FakeElement } from "./fake-dom.ts";
import { installFakeDom } from "./fake-dom.ts";
import { all, byLabel, mount } from "./lists-harness.ts";

vi.mock("../src/announce.ts", () => ({ announce: () => undefined }));

const NOW = Date.UTC(2026, 10, 6, 12, 0, 0);
let cleanupView: View;
let big: State;

beforeAll(async () => {
  ({ cleanupView } = (await import("../src/views/cleanup.ts")) as { cleanupView: View });
  installFakeDom();
  const parse = async (phase: 1 | 2) => mergeParsedExports([await parseExportFromReader(bytesReader(syntheticExportZip({ now: NOW, phase, friendCount: 1200 })))]);
  const [earlier, later] = [await parse(1), await parse(2)];
  let ledger = emptyLedger();
  for (const parsed of [earlier, later]) ledger = addSnapshot(ledger, snapshotFromExport(parsed));
  big = { ...initialState(), real: { latest: later, ledger, allowlist: [], checkedOff: [], ticks: [], issues: [], now: NOW } };
}, 120_000);

const queueRows = (root: FakeElement): number => all(root, ".queue-slot ul.candidate-list")[0]!.childNodes.length;

describe("Show more", () => {
  it("adds only the next rows and leaves the drawn ones in place", () => {
    resetPaging();
    installFakeDom();
    const items = Array.from({ length: 140 }, (_, i) => i);
    const list = pagedList(items, (i) => h("li", {}, String(i)), { key: "paging-a", pageSize: 50 }) as unknown as FakeElement;
    const ul = all(list, "ul")[0]!;
    const before = [...ul.childNodes];
    expect(before).toHaveLength(50);
    byLabel(list, common.showMore(50))!.fire("click");
    expect(ul.childNodes).toHaveLength(100);
    expect(ul.childNodes.slice(0, 50)).toEqual(before);
  });
});

describe("the Cleanup queue", () => {
  it("goes back to the first page when the category changes", () => {
    resetPaging();
    const { root } = mount(cleanupView, big);
    const first = queueRows(root);
    expect(first).toBe(50);
    const more = byLabel(root, common.showMore(50));
    expect(more, "the queue has more than one page").toBeDefined();
    more!.fire("click");
    more!.fire("click");
    expect(queueRows(root)).toBeGreaterThan(first);
    const select = all(root, "select").find((s) => s.getAttribute("id") === "filter-category")!;
    select.value = "ghost";
    select.fire("change");
    expect(queueRows(root)).toBeLessThanOrEqual(50);
  });
});

describe("the stylesheet for a long queue", () => {
  it("lets rows that are scrolled out of view skip layout and paint", () => {
    const css = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "styles.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const rule = /\.candidate-list > \.candidate, \.guided-list > \.guided-row \{([^}]*)\}/.exec(css);
    expect(rule).not.toBeNull();
    expect(rule![1]).toMatch(/content-visibility:\s*auto/);
    expect(rule![1]).toMatch(/contain-intrinsic-size:\s*auto /);
  });
});
