/**
 * At phone width the shared data table stacks each row into a card and does not repeat the column names, so a cell
 * must say what it is on its own: "From May 4, 2021", never "May 4, 2021" by itself. This reads every table on every
 * tool page, with the sample and the crafted exports the tools' own tests use, and fails on a bare value.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { FakeElement } from "../fake-dom.ts";
import { renderToolPages, sampleWorkspace } from "./harness.ts";

beforeAll(async () => {
  await sampleWorkspace();
}, 120_000);

const textOf = (el: FakeElement): string => el.textContent.replace(/\s+/g, " ").trim();

describe("table cells on the tool pages", () => {
  it("each say what they hold: a unit or a label beside the number or date, or a plain dash", async () => {
    const pages = await renderToolPages();
    const bare: string[] = [];
    let cells = 0;
    for (const page of pages) {
      for (const table of page.root.querySelectorAll("table")) {
        for (const row of table.querySelectorAll("tbody tr")) {
          for (const cell of row.querySelectorAll("td")) {
            const text = textOf(cell);
            cells++;
            // A word of three letters or more, or a size with its unit, says what the cell is.
            if (text !== "-" && text !== "–" && !/[A-Za-z]{3,}|\d (KB|MB|GB|TB)\b/.test(text)) bare.push(`${page.id}: "${text}"`);
          }
        }
      }
    }
    expect(cells).toBeGreaterThan(40);
    expect(bare).toEqual([]);
  });
});
