import { describe, expect, it } from "vitest";
import { estimateStrength, MIN_PASSPHRASE_LENGTH } from "../src/passphrase.ts";

describe("passphrase guidance", () => {
  it("asks for 12 or more characters and nothing about composition", () => {
    expect(MIN_PASSPHRASE_LENGTH).toBe(12);
    expect(estimateStrength("short one").acceptable).toBe(false);
    expect(estimateStrength("short one").level).toBe("short");
    // All lower-case words, no digits or symbols: acceptable.
    expect(estimateStrength("plain lowercase words").acceptable).toBe(true);
  });

  it("scores repetition low and varied phrases higher", () => {
    expect(estimateStrength("aaaaaaaaaaaaaaaa").level).toBe("weak");
    expect(estimateStrength("abababababababab").level).toBe("weak");
    const phrase = estimateStrength("maple orbit kettle seven river");
    expect(["good", "strong"]).toContain(phrase.level);
    expect(phrase.fraction).toBeGreaterThan(estimateStrength("aaaaaaaaaaaaaaaa").fraction);
  });

  it("handles empty input and counts characters, not UTF-16 units", () => {
    expect(estimateStrength("").fraction).toBe(0);
    expect(estimateStrength("\u{1F512}".repeat(6)).acceptable).toBe(false);
  });
});
