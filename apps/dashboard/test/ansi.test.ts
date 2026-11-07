import { describe, expect, it } from "vitest";
import { ORANGE_RGB, VIOLET_RGB, createTerm } from "../../cli/src/term.ts";
import { ANSI_CLASSES, MAX_LINE, TerminalBuffer, indexToRgb, quantize } from "../src/terminal/ansi.ts";
import type { Line } from "../src/terminal/ansi.ts";

const ESC = "\x1b";
const BEL = "\x07";

function parse(input: string, options?: ConstructorParameters<typeof TerminalBuffer>[0]): TerminalBuffer {
  const b = new TerminalBuffer(options);
  b.write(input);
  return b;
}

/** Lines as [text, class] pairs, which is what matters for what is drawn. */
const shape = (lines: readonly Line[]): [string, string][][] => lines.map((l) => l.runs.map((r) => [r.text, r.cls] as [string, string]));
const textOf = (b: TerminalBuffer): string => b.plainText();

describe("styling codes", () => {
  it("honors reset, bold, dim, normal intensity, the four status colors, default color and slate", () => {
    const cases: [string, string][] = [
      ["1", "ansi-bold"],
      ["2", "ansi-dim"],
      ["31", "ansi-danger"],
      ["32", "ansi-ok"],
      ["33", "ansi-warn"],
      ["34", "ansi-info"],
      ["90", "ansi-slate"],
    ];
    for (const [code, cls] of cases) expect(shape(parse(`${ESC}[${code}mx${ESC}[0my`).lines), code).toEqual([[["x", cls], ["y", ""]]]);
    expect(shape(parse(`${ESC}[1;2mx${ESC}[22my`).lines)).toEqual([[["x", "ansi-bold ansi-dim"], ["y", ""]]]);
    expect(shape(parse(`${ESC}[32mx${ESC}[39my`).lines)).toEqual([[["x", "ansi-ok"], ["y", ""]]]);
    expect(shape(parse(`${ESC}[mx`).lines)).toEqual([[["x", ""]]]);
    expect(shape(parse(`${ESC}[1m${ESC}[32mx`).lines)).toEqual([[["x", "ansi-ok ansi-bold"]]]);
  });

  it("maps 256-color and true-color forms to the nearest Snappy color", () => {
    expect(shape(parse(`${ESC}[38;5;99mv`).lines)).toEqual([[["v", "ansi-violet"]]]);
    expect(shape(parse(`${ESC}[38;5;208mo`).lines)).toEqual([[["o", "ansi-orange"]]]);
    expect(shape(parse(`${ESC}[38;2;155;134;255mv`).lines)).toEqual([[["v", "ansi-violet"]]]);
    expect(shape(parse(`${ESC}[38;2;255;154;99mo`).lines)).toEqual([[["o", "ansi-orange"]]]);
    expect(quantize(0, 255, 0)).toBe("ansi-ok");
    expect(quantize(255, 0, 0)).toBe("ansi-danger"); // a plain red is not taken for the Memories orange
    expect(quantize(255, 135, 0)).toBe("ansi-orange"); // the nearest cube color to it is
    expect(quantize(10, 10, 10)).toBe("ansi-slate");
    expect(indexToRgb(0)).toEqual([0, 0, 0]);
    expect(indexToRgb(231)).toEqual([255, 255, 255]);
    expect(indexToRgb(232)).toEqual([8, 8, 8]);
    expect(indexToRgb(9999)).toEqual([238, 238, 238]);
  });

  it("reads the colors the command line really prints, and nothing else leaks into the classes", () => {
    for (const COLORTERM of ["truecolor", "256"]) {
      const term = createTerm({ env: { COLORTERM, FORCE_COLOR: "1" }, isTTY: true, columns: 80 });
      const check = (paint: (s: string) => string, cls: string): void => expect(shape(parse(paint("word")).lines), `${COLORTERM} ${cls}`).toEqual([[["word", cls]]]);
      check(term.violet, "ansi-violet");
      check(term.orange, "ansi-orange");
      check(term.ok, "ansi-ok");
      check(term.warn, "ansi-warn");
      check(term.danger, "ansi-danger");
      check(term.info, "ansi-info");
      check(term.slate, "ansi-slate");
      check(term.bold, "ansi-bold");
      check(term.dim, "ansi-dim");
      expect(VIOLET_RGB).toEqual([155, 134, 255]);
      expect(ORANGE_RGB).toEqual([255, 154, 99]);
    }
  });

  it("ignores every other styling code, and a code with missing parts", () => {
    for (const code of ["3", "4", "7", "30", "35", "36", "37", "40", "47", "91", "97", "100", "9999", "38", "38;5", "38;2;1;2", "38;9", "1:2:3", "99999999"]) {
      expect(textOf(parse(`${ESC}[${code}mtext`)), code).toBe("text");
    }
    expect(shape(parse(`${ESC}[4;31mx`).lines)).toEqual([[["x", "ansi-danger"]]]);
  });

  it("only ever produces classes from the closed list", () => {
    const b = parse(`${ESC}[1;2;31;32;33;34;90;38;5;99;38;2;1;2;3mx${ESC}[0m`);
    for (const line of b.lines) for (const run of line.runs) for (const c of run.cls.split(" ").filter(Boolean)) expect(ANSI_CLASSES).toContain(c);
  });
});

describe("lines and movement", () => {
  it("starts a new line on a line feed, and treats a carriage return and line feed as one", () => {
    expect(textOf(parse("one\ntwo\r\nthree"))).toBe("one\ntwo\nthree");
    expect(parse("a\r\n\r\nb").lines).toHaveLength(3);
  });

  it("lets a carriage return followed by text replace the line", () => {
    expect(textOf(parse("loading 10%\rloading 90%"))).toBe("loading 90%");
    expect(textOf(parse("long long line\rshort"))).toBe("short");
    expect(textOf(parse("keep\nold\rnew"))).toBe("keep\nnew");
    expect(textOf(parse("abc\r"))).toBe("abc"); // nothing came after it
  });

  it("honors the erase-line codes the progress bar uses", () => {
    expect(textOf(parse(`  bar 50%\r${ESC}[2K  bar 60%`))).toBe("  bar 60%");
    expect(textOf(parse(`text${ESC}[2K`))).toBe("");
    expect(textOf(parse(`text${ESC}[1K`))).toBe("");
    expect(textOf(parse(`text${ESC}[K`))).toBe("text"); // the cursor is at the end: nothing to erase
    expect(textOf(parse(`text\r${ESC}[0K`))).toBe("");
    expect(textOf(parse(`a\nb\r${ESC}[2Kc`))).toBe("a\nc");
  });

  it("turns a tab into four spaces", () => {
    expect(textOf(parse("a\tb"))).toBe("a    b");
  });

  it("breaks a very long line, as a terminal would wrap it", () => {
    const b = parse("x".repeat(MAX_LINE * 2 + 5));
    expect(b.lines).toHaveLength(3);
    expect(b.lines.every((l) => l.runs.reduce((n, r) => n + r.text.length, 0) <= MAX_LINE)).toBe(true);
  });
});

describe("hostile input", () => {
  it("drops a title, an ST-ended string, a clipboard request and a long string", () => {
    expect(textOf(parse(`${ESC}]0;evil title${BEL}text`))).toBe("text");
    expect(textOf(parse(`${ESC}]2;evil title${ESC}\\text`))).toBe("text");
    expect(textOf(parse(`${ESC}]52;c;ZXZpbA==${BEL}text`))).toBe("text");
    expect(textOf(parse(`${ESC}]8;;https://x.example${ESC}\\link${ESC}]8;;${ESC}\\`))).toBe("link");
    expect(textOf(parse(`${ESC}P1$r${ESC}\\${ESC}_apc${ESC}\\${ESC}^pm${BEL}${ESC}Xsos${BEL}x`))).toBe("x");
    const long = parse(`${ESC}]0;${"a".repeat(5000)}${BEL}after`);
    expect(textOf(long)).not.toContain(ESC);
    expect(textOf(long).endsWith("after")).toBe(true);
  });

  it("drops screen clears, cursor moves, device queries and private modes", () => {
    for (const seq of ["[2J", "[H", "[10;5H", "[3A", "[?25l", "[?1049h", "[6n", "[c", "[>0c", "[s", "[u", "[1;1r", "[ q", "[%G", "c", "7", "8", "=", ">", "(B", ")0", "#8", "M"]) {
      expect(textOf(parse(`a${ESC}${seq}b`)), JSON.stringify(seq)).toBe("ab");
    }
  });

  it("shows 8-bit control codes, bidirectional marks and other control characters as a question mark", () => {
    expect(textOf(parse("a\u009b31mb"))).toBe("a?31mb");
    expect(textOf(parse("a‮b⁦c​d­e﻿"))).toBe("a?b?c?d?e?");
    expect(textOf(parse("a\u0007b\u0008c\u007fd\u0000e"))).toBe("a?b?c?d?e");
    expect(textOf(parse("a\u0085b c"))).toBe("a?b?c");
  });

  it("leaves no escape behind for a sequence cut short, or a stray escape", () => {
    expect(textOf(parse(`text${ESC}`))).toBe("text");
    expect(textOf(parse(`text${ESC}[`))).toBe("text");
    expect(textOf(parse(`text${ESC}[3`))).toBe("text");
    expect(textOf(parse(`${ESC}${ESC}${ESC}[31mred`))).toBe("red");
    expect(textOf(parse(`${ESC}\nnext`))).toBe("\nnext");
    expect(textOf(parse(`${ESC}[31\nnext`))).toBe("\nnext");
    expect(textOf(parse(`${ESC}[${"1;".repeat(100)}mtext`))).not.toContain(ESC);
  });

  it("survives a sequence split across chunks at every point", () => {
    const input = `a${ESC}[1;38;2;155;134;255mviolet${ESC}[0m${ESC}]0;title${BEL}b${ESC}]8;;x${ESC}\\c\r${ESC}[2Kd`;
    const whole = shape(parse(input).lines);
    for (let cut = 0; cut <= input.length; cut++) {
      const b = new TerminalBuffer();
      b.write(input.slice(0, cut));
      b.write(input.slice(cut));
      expect(shape(b.lines), `cut at ${cut}`).toEqual(whole);
    }
    expect(textOf(parse(input))).toBe("d");
  });
});

describe("limits", () => {
  it("drops the oldest lines past the line cap, and says so", () => {
    const b = new TerminalBuffer({ maxLines: 5 });
    for (let i = 0; i < 20; i++) b.write(`line ${i}\n`);
    expect(b.lines.length).toBeLessThanOrEqual(5);
    expect(b.trimmed).toBe(true);
    expect(textOf(b).endsWith("line 19\n")).toBe(true);
    expect(textOf(b)).not.toContain("line 0\n");
  });

  it("drops the oldest lines past the size cap, and never the line being written", () => {
    const b = new TerminalBuffer({ maxChars: 100 });
    for (let i = 0; i < 50; i++) b.write(`${"x".repeat(30)}\n`);
    expect(b.size).toBeLessThanOrEqual(100 + 31);
    b.write("current line");
    expect(textOf(b).endsWith("current line")).toBe(true);
  });

  it("reports what changed since the last look, so a view can redraw only that", () => {
    const b = new TerminalBuffer({ maxLines: 3 });
    b.write("a\nb\nc");
    expect(b.takeChanges()).toEqual({ removed: 0, from: 0 });
    b.write("d");
    expect(b.takeChanges()).toEqual({ removed: 0, from: 2 });
    b.write("\ne\nf");
    expect(b.takeChanges()).toEqual({ removed: 2, from: 0 });
    expect(b.takeChanges()).toEqual({ removed: 0, from: b.lines.length - 1 });
  });

  it("clears everything, including a half-read sequence and the styling", () => {
    const b = parse(`${ESC}[31mred${ESC}[`);
    b.clear();
    b.write("31mplain");
    expect(shape(b.lines)).toEqual([[["31mplain", ""]]]);
    expect(b.trimmed).toBe(false);
  });
});

/* ------------------------------------------------------------------------------------------ */
/* Fuzz                                                                                         */
/* ------------------------------------------------------------------------------------------ */

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

const PIECES = [
  ESC, `${ESC}[`, `${ESC}]`, `${ESC}\\`, BEL, `${ESC}[0m`, `${ESC}[1m`, `${ESC}[31m`, `${ESC}[38;5;99m`, `${ESC}[38;2;155;134;255m`, `${ESC}[38;2;300;0;0m`, `${ESC}[2K`, `${ESC}[K`, `${ESC}[2J`, `${ESC}[?25l`,
  `${ESC}]0;title${BEL}`, `${ESC}]52;c;AAAA${BEL}`, `${ESC}P1${ESC}\\`, `${ESC}(B`, `${ESC}c`, "\u009b", "\u009d", "\u0090", "\u0085", "‮", "​", "­", "﻿", " ",
  "\r", "\n", "\r\n", "\t", "\u0000", "\u0008", "\u007f", "\u0018", "\u001a", "text", " ", "é", "😀", "日本", "[", "]", ";", "m", "K", "31", "38", "5", "2", "0", "?", "\\",
];

function randomInput(rand: () => number): string {
  const count = 1 + Math.floor(rand() * 40);
  let out = "";
  for (let i = 0; i < count; i++) {
    const roll = rand();
    out += roll < 0.85 ? (PIECES[Math.floor(rand() * PIECES.length)] as string) : String.fromCodePoint(Math.floor(rand() * 0x300) + (rand() < 0.2 ? 0x2000 : 0));
  }
  return out;
}

function chunked(input: string, rand: () => number): string[] {
  const chars = [...input];
  const out: string[] = [];
  for (let i = 0; i < chars.length; ) {
    const take = 1 + Math.floor(rand() * 6);
    out.push(chars.slice(i, i + take).join(""));
    i += take;
  }
  return out;
}

describe("fuzz", () => {
  const RANGES: [number, number][] = [[0x00, 0x1f], [0x7f, 0x9f], [0xad, 0xad], [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x206f], [0xfeff, 0xfeff]];
  const hasBad = (text: string): boolean => [...text].some((ch) => RANGES.some(([a, b]) => (ch.codePointAt(0) ?? 0) >= a && (ch.codePointAt(0) ?? 0) <= b));

  it("never throws, never leaks a control or escape character, and uses only the closed list of classes", () => {
    const rand = prng(20261107);
    for (let i = 0; i < 4000; i++) {
      const input = randomInput(rand);
      const b = new TerminalBuffer();
      expect(() => b.write(input)).not.toThrow();
      const text = textOf(b).replaceAll("\n", "");
      expect(hasBad(text), JSON.stringify(input)).toBe(false);
      for (const line of b.lines) {
        for (const run of line.runs) {
          expect(run.text).not.toContain("\n");
          for (const c of run.cls.split(" ").filter(Boolean)) expect(ANSI_CLASSES, JSON.stringify(input)).toContain(c);
        }
      }
    }
  });

  it("gives the same lines for the whole input as for any split of it", () => {
    const rand = prng(777);
    for (let i = 0; i < 3000; i++) {
      const input = randomInput(rand);
      const whole = shape(parse(input).lines);
      const b = new TerminalBuffer();
      for (const piece of chunked(input, rand)) b.write(piece);
      expect(shape(b.lines), JSON.stringify(input)).toEqual(whole);
    }
  });

  it("stays under its caps on large random input", () => {
    const rand = prng(4242);
    const b = new TerminalBuffer({ maxLines: 50, maxChars: 4000 });
    for (let i = 0; i < 500; i++) b.write(randomInput(rand));
    expect(b.lines.length).toBeLessThanOrEqual(51);
    expect(b.size).toBeLessThanOrEqual(4000 + MAX_LINE);
  });
});
