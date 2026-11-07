/** Parsing of the two numbers a person can type. Pure, so the rules are testable. */

/** A whole number of friends, or null for "not given". Undefined means the text is not a valid count. */
export function parseFriendCount(text: string): number | null | undefined {
  const t = text.trim();
  if (t === "") return null;
  if (!/^\d{1,6}$/.test(t)) return undefined;
  const n = Number(t);
  return n <= 100_000 ? n : undefined;
}

/** Storage cap in GB from the text field; undefined when it is not a sensible number. */
export function parseCapGiB(text: string): number | undefined {
  const t = text.trim().replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(t)) return undefined;
  const n = Number(t);
  return n >= 0.1 && n <= 10_000 ? n : undefined;
}
