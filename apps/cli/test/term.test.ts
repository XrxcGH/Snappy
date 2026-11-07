import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { describe, expect, it } from "vitest";
import { formatBytes, formatDate, formatPercent, plural } from "../src/format.ts";
import { VIOLET_RGB, createTerm, useColor } from "../src/term.ts";
import type { TermOptions } from "../src/term.ts";

const base: TermOptions = { env: {}, isTTY: true, columns: 80 };
const color = (extra: Partial<TermOptions> = {}) => createTerm({ ...base, ...extra });

describe("color detection", () => {
  it("is on for a TTY and off otherwise", () => {
    expect(useColor(base)).toBe(true);
    expect(useColor({ ...base, isTTY: false })).toBe(false);
  });

  it("honors NO_COLOR, --no-color and TERM=dumb, and lets NO_COLOR beat FORCE_COLOR", () => {
    expect(useColor({ ...base, env: { NO_COLOR: "1" } })).toBe(false);
    expect(useColor({ ...base, noColorFlag: true })).toBe(false);
    expect(useColor({ ...base, env: { TERM: "dumb" } })).toBe(false);
    expect(useColor({ ...base, env: { NO_COLOR: "1", FORCE_COLOR: "1" } })).toBe(false);
    expect(useColor({ ...base, isTTY: false, env: { FORCE_COLOR: "1" } })).toBe(true);
    expect(useColor({ ...base, env: { NO_COLOR: "" } })).toBe(true); // an empty NO_COLOR is ignored by the convention
  });

  it("emits no escape codes when color is off", () => {
    const term = color({ isTTY: false });
    const everything = [term.violet("x"), term.bold("x"), term.ok("x"), term.warn("x"), term.danger("x"), term.banner().join("\n"), ...term.table([{ header: "A" }], [[term.confidence("high")]])];
    expect(everything.join("")).not.toContain("\x1b");
  });
});

describe("brand colors", () => {
  it("uses the violet from the tokens: ANSI 256 index 99, or the exact RGB for truecolor terminals", () => {
    expect(color().violet("x")).toBe("\x1b[38;5;99mx\x1b[0m");
    expect(color({ env: { COLORTERM: "truecolor" } }).violet("x")).toBe(`\x1b[38;2;${VIOLET_RGB.join(";")}mx\x1b[0m`);
    expect(color({ env: { COLORTERM: "24bit" } }).violet("x")).toContain("38;2;");
  });

  it("keeps VIOLET_RGB equal to --brand-violet-on-dark in the token file", () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "brand", "tokens", "tokens.css"), "utf8");
    const hex = /--brand-violet-on-dark:\s*#([0-9a-f]{6})/i.exec(css)?.[1];
    expect(hex).toBeDefined();
    const rgb = [0, 2, 4].map((i) => parseInt((hex as string).slice(i, i + 2), 16));
    expect([...VIOLET_RGB]).toEqual(rgb);
  });

  it("never uses orange or red-orange codes", () => {
    const term = color({ env: { COLORTERM: "truecolor" } });
    const codes = [term.violet("x"), term.bold("x"), term.dim("x"), term.ok("x"), term.warn("x"), term.danger("x"), term.info("x"), term.slate("x")].join("");
    // ANSI 256 oranges are 202-208 and 214-215; none of the styles may use them.
    expect(codes).not.toMatch(/38;5;(20[2-8]|21[45])m/);
  });
});

describe("confidence", () => {
  it("shows three bars plus the word", () => {
    const term = color({ isTTY: false });
    const text = (level: "high" | "medium" | "low") => {
      const cell = term.confidence(level);
      return typeof cell === "string" ? cell : cell.text;
    };
    expect(text("high")).toBe("▰▰▰ High");
    expect(text("medium")).toBe("▰▰▱ Medium");
    expect(text("low")).toBe("▰▱▱ Low");
  });

  it("falls back to plain characters with SNAPPY_ASCII=1", () => {
    const cell = color({ isTTY: false, env: { SNAPPY_ASCII: "1" } }).confidence("medium");
    expect(typeof cell === "string" ? cell : cell.text).toBe("##- Medium");
  });
});

describe("table", () => {
  it("aligns columns, shortens the flexible one to the terminal width, and trims trailing space", () => {
    const term = color({ isTTY: false, columns: 50 });
    const lines = term.table([{ header: "Friend" }, { header: "Why", flex: true }], [["sam_01", "x".repeat(200)], ["a", "short"]]);
    expect(lines.every((l) => Array.from(l).length + 2 <= 50)).toBe(true);
    expect(lines[2]).toMatch(/…$/);
    expect(lines[3]).toBe("a       short");
    expect(lines.some((l) => l.endsWith(" "))).toBe(false);
  });

  it("ignores color codes when measuring width", () => {
    const term = color({ columns: 60 });
    const lines = term.table([{ header: "Confidence" }, { header: "Why" }], [[term.confidence("high"), "ok"]]);
    const plain = lines.map(stripVTControlCharacters);
    expect(plain[2]).toBe("▰▰▰ High    ok");
  });
});

describe("banner", () => {
  it("draws five bars and puts the only color on the spine", () => {
    const lines = color({ env: { COLORTERM: "truecolor" } }).banner();
    expect(lines).toHaveLength(5);
    const colored = lines.filter((l) => l.includes("\x1b[38;"));
    expect(colored).toHaveLength(1);
    expect(stripVTControlCharacters(colored[0] as string)).toContain("Snappy");
  });
});

describe("format", () => {
  it("formats dates, sizes and counts in American English", () => {
    expect(formatDate(Date.UTC(2026, 10, 6, 23, 59))).toBe("Nov 6, 2026");
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 ** 3)).toBe("5 GB");
    expect(formatBytes(340 * 1024 ** 2)).toBe("340 MB");
    expect(plural(1, "friend")).toBe("1 friend");
    expect(plural(1234, "friend")).toBe("1,234 friends");
    expect(plural(2, "Memory", "Memories")).toBe("2 Memories");
    expect(formatPercent(0.245)).toBe("25%");
  });
});
