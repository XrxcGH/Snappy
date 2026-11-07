/**
 * Passphrase guidance. There are deliberately no composition rules (no "needs a symbol"):
 * length is what matters. The only hard rule is the minimum length the interface asks for.
 */
export const MIN_PASSPHRASE_LENGTH = 12;

export type StrengthLevel = "short" | "weak" | "fair" | "good" | "strong";

export interface Strength {
  level: StrengthLevel;
  /** 0..1, for the meter bar. */
  fraction: number;
  /** Rough entropy estimate in bits (guidance only). */
  bits: number;
  /** Accepted by the form: long enough. */
  acceptable: boolean;
}

/**
 * Cheap estimate: characters count only as far as they are different from each other, so
 * "aaaaaaaaaaaa" and "abababababab" score low while a few random words score well. It cannot
 * know a famous quote or a birthday, which is why the wording says "estimate".
 */
export function estimateStrength(passphrase: string): Strength {
  const chars = [...passphrase];
  const length = chars.length;
  if (length === 0) return { level: "short", fraction: 0, bits: 0, acceptable: false };

  const unique = new Set(chars).size;
  let pool = 0;
  if (/[a-z]/.test(passphrase)) pool += 26;
  if (/[A-Z]/.test(passphrase)) pool += 26;
  if (/[0-9]/.test(passphrase)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(passphrase)) pool += 20;
  // Repeats add little: count at most twice as many characters as there are distinct ones.
  const effective = Math.min(length, unique * 2);
  // Typed phrases are far more predictable than random characters, so only half the raw figure is credited.
  const bits = effective * Math.log2(Math.max(pool, 2)) * 0.5;

  const acceptable = length >= MIN_PASSPHRASE_LENGTH;
  const level: StrengthLevel = !acceptable ? "short" : bits < 35 ? "weak" : bits < 50 ? "fair" : bits < 70 ? "good" : "strong";
  return { level, fraction: Math.min(1, bits / 80), bits, acceptable };
}
