import { describe, expect, it } from "vitest";
import { csvCell, linesText, neutralizeCell, toCsv } from "../src/csv.ts";

describe("CSV injection", () => {
  it.each(["=1+1", "+1", "-1", "@SUM(A1)", "\t=1", "\r=1", "=cmd|' /C calc'!A0", "  =HYPERLINK(\"x\")"])("neutralises %j", (value) => {
    const cell = neutralizeCell(value);
    expect(cell.startsWith("'")).toBe(true);
    // The first character a spreadsheet sees is the apostrophe, never a formula character.
    expect(csvCell(value).startsWith(`"'`)).toBe(true);
  });

  it("leaves ordinary text alone", () => {
    expect(neutralizeCell("alice_1")).toBe("alice_1");
    expect(neutralizeCell("Not in the friend list (2026-11-06).")).toBe("Not in the friend list (2026-11-06).");
  });

  it("quotes every cell and doubles embedded quotes", () => {
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell("")).toBe('""');
  });

  it("removes control characters, including line breaks, so a cell cannot add rows", () => {
    const cell = csvCell("a\r\nb\u0000c");
    expect(cell).toBe('"a  b c"');
  });

  it("builds rows with a BOM and CRLF line ends", () => {
    const csv = toCsv(["Username", "Why"], [["alice", "x"], ["=evil", "y"]]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv.split("\r\n")).toEqual(['\uFEFF"Username","Why"', '"alice","x"', `"'=evil","y"`, ""]);
  });

  it("builds a plain list, one name per line, neutralised", () => {
    expect(linesText(["alice", "=bad"])).toBe("alice\n'=bad\n");
    expect(linesText([])).toBe("");
  });
});
