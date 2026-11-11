/** Parsing of the two numbers a person can type. Pure, so the rules are testable. */

/** A whole number of friends, or null for "not given". Undefined means the text is not a valid count. */
export function parseFriendCount(text: string): number | null | undefined {
  const t = text.trim();
  if (t === "") return null;
  if (!/^\d{1,6}$/.test(t)) return undefined;
  const n = Number(t);
  return n <= 100_000 ? n : undefined;
}

/** Storage cap in decimal GB (1 GB is 1,000 MB) from the text field; undefined when it is not a sensible number. */
export function parseCapGiB(text: string): number | undefined {
  const raw = text.trim();
  // Commas are accepted only as thousands groups, so "1,5" is rejected instead of read as 15.
  if (raw.includes(",") && !/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(raw)) return undefined;
  const t = raw.replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(t)) return undefined;
  const n = Number(t);
  return n >= 0.1 && n <= 10_000 ? n : undefined;
}
