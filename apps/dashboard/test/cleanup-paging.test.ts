/**
 * Paging on the Cleanup queue: "Show more" draws the next page as a list of its own and leaves the pages already drawn
 * alone (a grid that held every row laid all of them out again on each press), and a filter change goes back to the first
 * page, as a search or an order does. Synthetic data only.
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
import { FakeElement, installFakeDom } from "./fake-dom.ts";
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

const queuePages = (root: FakeElement): FakeElement[] => all(root, ".queue-slot ul.candidate-list");
const queueRows = (root: FakeElement): number => queuePages(root).reduce((sum, ul) => sum + ul.childNodes.length, 0);

describe("Show more", () => {
  const draw = (key: string, length: number, pages: boolean): FakeElement => {
    installFakeDom();
    const items = Array.from({ length }, (_, i) => i);
    return pagedList(items, (i) => h("li", {}, String(i)), { key, pageSize: 50, pages }) as unknown as FakeElement;
  };

  it("draws the next rows as a page of their own and leaves the drawn page in place", () => {
    resetPaging();
    const list = draw("paging-a", 140, true);
    const [first] = all(list, "ul");
    const before = [...first!.childNodes];
    expect(all(list, "ul")).toHaveLength(1);
    byLabel(list, common.showMore(50))!.fire("click");
    const pages = all(list, "ul");
    expect(pages).toHaveLength(2);
    expect(pages[0]).toBe(first);
    expect(first!.childNodes).toEqual(before);
    expect(pages[1]!.childNodes).toHaveLength(50);
    expect(pages.every((ul) => ul.classList.contains("page"))).toBe(true);
    byLabel(list, common.showMore(40))!.fire("click");
    expect(all(list, "ul").map((ul) => ul.childNodes.length)).toEqual([50, 50, 40]);
  });

  it("keeps the rows in order, with the end mark and the footer after the last page", () => {
    resetPaging();
    installFakeDom();
    const items = Array.from({ length: 120 }, (_, i) => i);
    const list = pagedList(items, (i) => h("li", {}, String(i)), { key: "paging-b", pageSize: 50, pages: true, skipLink: true }) as unknown as FakeElement;
    byLabel(list, common.showMore(50))!.fire("click");
    const kinds = list.childNodes.filter((n): n is FakeElement => n instanceof FakeElement).map((n) => n.className.split(" ")[0] || n.tagName);
    expect(kinds).toEqual(["list-skip", "rows", "rows", "list-end", "more"]);
    const texts = all(list, "li").map((li) => li.textContent);
    expect(texts[0]).toBe("0");
    expect(texts[99]).toBe("99");
  });

  it("restores the pages after a repaint", () => {
    resetPaging();
    const first = draw("paging-c", 140, true);
    byLabel(first, common.showMore(50))!.fire("click");
    byLabel(first, common.showMore(40))!.fire("click");
    const again = draw("paging-c", 140, true);
    expect(all(again, "ul").map((ul) => ul.childNodes.length)).toEqual([50, 50, 40]);
  });

  it("is one list unless pages are asked for", () => {
    resetPaging();
    const list = draw("paging-d", 140, false);
    byLabel(list, common.showMore(50))!.fire("click");
    expect(all(list, "ul")).toHaveLength(1);
    expect(all(list, "ul")[0]!.childNodes).toHaveLength(100);
  });
});

describe("the Cleanup queue", () => {
  it("goes back to the first page when the category changes", () => {
    resetPaging();
    const { root } = mount(cleanupView, big);
    const first = queueRows(root);
    expect(first).toBe(48);
    const more = byLabel(root, common.showMore(48));
    expect(more, "the queue has more than one page").toBeDefined();
    more!.fire("click");
    const firstPage = queuePages(root)[0]!;
    const drawn = [...firstPage.childNodes];
    more!.fire("click");
    expect(queueRows(root)).toBe(144);
    expect(queuePages(root)).toHaveLength(3);
    expect(queuePages(root)[0]).toBe(firstPage);
    expect(firstPage.childNodes).toEqual(drawn);
    const select = all(root, "select").find((s) => s.getAttribute("id") === "filter-category")!;
    select.value = "ghost";
    select.fire("change");
    expect(queueRows(root)).toBeLessThanOrEqual(48);
    expect(queuePages(root)).toHaveLength(1);
  });
});

describe("the stylesheet for a long queue", () => {
  it("gives each page of the queue its own layout", () => {
    const css = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "styles.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const rule = /\.rows\.page \{([^}]*)\}/.exec(css);
    expect(rule).not.toBeNull();
    expect(rule![1]).toMatch(/contain:\s*layout/);
  });
});
