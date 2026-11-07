import { stripVTControlCharacters } from "node:util";
import { describe, expect, it } from "vitest";
import { createTerm, stripAnsi } from "../src/term.ts";

function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const PIECES = [ESC, `${ESC}[`, `${ESC}[0m`, `${ESC}[38;2;155;134;255m`, `${ESC}[2K`, `${ESC}]0;title${BEL}`, `${ESC}]8;;x${ESC}\\`, "\u009b", "\u009c", BEL, "[", "]", ";", "31", "m", "K", "text", " ", "é", "\n", "\r", `${ESC}(B`, `${ESC}#8`, "9", "A"];

describe("stripAnsi", () => {
  it("equals stripVTControlCharacters on random escape-heavy text", () => {
    const rand = prng(20261107);
    for (let i = 0; i < 5000; i++) {
      const text = Array.from({ length: Math.floor(rand() * 12) }, () => PIECES[Math.floor(rand() * PIECES.length)] as string).join("");
      expect(stripAnsi(text), JSON.stringify(text)).toBe(stripVTControlCharacters(text));
    }
  });

  it("equals stripVTControlCharacters on everything the terminal helper paints", () => {
    const term = createTerm({ env: { COLORTERM: "truecolor" }, isTTY: true, columns: 80 });
    const samples = [
      ...term.banner(),
      term.violet("v"),
      term.orange("o"),
      term.bold("b"),
      term.dim("d"),
      term.ok("k"),
      term.warn("w"),
      term.danger("x"),
      term.info("i"),
      term.slate("s"),
      ...term.table([{ header: "A" }, { header: "B" }], [[term.confidence("high"), "x"]]),
    ];
    for (const s of samples) expect(stripAnsi(s)).toBe(stripVTControlCharacters(s));
    expect(stripAnsi(term.violet("v"))).toBe("v");
  });
});
