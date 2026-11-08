/** Small shared helpers. Pure, dependency-free. */
import type { Confidence } from "./types.ts";

/** Canonical key for a username: trimmed + lower-cased. Snapchat usernames are case-insensitive. */
export function normUser(name: string): string {
  return String(name ?? "").trim().toLowerCase();
}

/** Control characters (C0, DEL, C1), which become spaces in a spreadsheet cell. */
const CELL_CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
/** Characters that reorder or hide text (soft hyphen, zero-width, bidi marks and overrides, BOM). They become "?". */
const CELL_INVISIBLE = /[\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g;

/**
 * Text made safe as one spreadsheet or CSV cell, for names that came from an export (a friend picks their own).
 * Control characters (ESC, BEL, a bare line feed, the C1 range) become spaces and the text is trimmed, so the
 * formula test sees the first real character. Characters that reorder or hide text become "?", so the file shows
 * the same name as the screen. A cell that would start with = + - @ then gets a leading apostrophe (OWASP).
 */
export function neutralizeCell(value: string): string {
  const flat = String(value ?? "")
    .replace(CELL_CONTROL, " ")
    .replace(CELL_INVISIBLE, "?")
    .trim();
  return /^[=+\-@]/.test(flat) ? `'${flat}` : flat;
}

/**
 * Longest username Snappy accepts. Snapchat's own limit is far lower; the cap keeps a crafted
 * export from putting a megabyte-long "name" into the ledger, the page and every spreadsheet.
 */
export const MAX_USERNAME_LENGTH = 100;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** UTC calendar day in the brand's date format ("Nov 6, 2026") for evidence text; tolerant of bad timestamps. */
export function formatDay(ms: number): string {
  if (!Number.isFinite(ms)) return "an unknown date";
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? "an unknown date" : `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/** A whole number with thousands separators ("1,191"), as the brand guide shows numbers. */
export function groupDigits(n: number): string {
  return Math.floor(n).toLocaleString("en-US");
}

export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Best-effort conversion of the many timestamp shapes found in exports to epoch ms.
 * Accepts: epoch seconds / ms / microseconds (number or numeric string), ISO-ish strings,
 * and "YYYY-MM-DD HH:MM:SS UTC". Strings without a zone are read as UTC, never as machine-local
 * time, so results do not depend on where the code runs. Returns undefined when it cannot be understood.
 * Values outside 1990-01-01 .. 2100-01-01 are rejected as implausible.
 * toMsCounting is the same conversion that calls `onLoose` when the value was read by the engine's own date parser, after none of the known
 * shapes fitted: such a date is a guess (a day-first locale date reads month-first, say), so callers count them.
 */
export function toMsCounting(value: unknown, onLoose?: () => void): number | undefined {
  const LOW = Date.UTC(1990, 0, 1);
  const HIGH = Date.UTC(2100, 0, 1);
  const ok = (n: number) => (Number.isFinite(n) && n >= LOW && n <= HIGH ? n : undefined);

  if (value === null || value === undefined || value === "") return undefined;

  if (typeof value === "number" || (typeof value === "string" && /^\d+(\.\d+)?$/.test(value.trim()))) {
    const n = typeof value === "number" ? value : Number(value.trim());
    if (!Number.isFinite(n) || n <= 0) return undefined;
    // Pick the unit that lands in the plausible window.
    for (const factor of [1, 1000, 0.001]) {
      const r = ok(n * factor);
      if (r !== undefined) return Math.round(r);
    }
    return undefined;
  }

  if (typeof value === "string") {
    const s = value.trim();
    // "2023-04-01 12:30:00 UTC", "2023/04/01 12:30", "2023-04-01T12:30:00.250Z", "2023-04-01":
    // read field by field as UTC, never as machine-local time. A missing zone means UTC here.
    const m = /^(\d{4})[-/](\d{2})[-/](\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?)?\s*(?:UTC|GMT|Z)?$/i.exec(s);
    if (m) {
      const [y, mo, d, h, mi, sec] = [m[1], m[2], m[3], m[4] ?? "0", m[5] ?? "0", m[6] ?? "0"].map(Number) as [number, number, number, number, number, number];
      const ms = m[7] ? Math.floor(Number(`0.${m[7]}`) * 1000) : 0;
      const t = Date.UTC(y, mo - 1, d, h, mi, sec, ms);
      const back = new Date(t);
      // Reject impossible fields (month 13, Feb 31, hour 25): Date.UTC would silently roll them over.
      if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return undefined;
      if (h > 23 || mi > 59 || sec > 59) return undefined;
      return ok(t);
    }
    // Any other shape goes through Date.parse, which reads a zone-less string as machine-local time
    // and would shift results by the viewer's UTC offset: pin those to UTC explicitly.
    const hasTime = /\d{1,2}:\d{2}/.test(s);
    const zoned =
      /(?:[\d\s])(?:Z|UTC|GMT|[ECMP][SD]T)\s*$/i.test(s) || /GMT[+-]\d{4}/i.test(s) || (hasTime && /\d\s*[+-]\d{2}(?::?\d{2})?\s*$/.test(s));
    const t = Date.parse(zoned ? s : `${s} UTC`);
    const loose = Number.isNaN(t) ? undefined : ok(t);
    // An ISO date with an explicit offset is exact, whatever parser read it: only real guesses are counted.
    if (loose !== undefined && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i.test(s)) onLoose?.();
    return loose;
  }
  return undefined;
}

/** Best-effort conversion of an export timestamp to epoch ms (see toMsCounting); undefined when it cannot be understood. */
export function toMs(value: unknown): number | undefined {
  return toMsCounting(value);
}

/** FNV-1a 32-bit hash, hex string. Stable ids only; NOT cryptographic. */
export function hashString(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * Single source of truth for mapping a 0..1 score to a confidence band.
 * Detectors and the cleanup queue MUST both use this.
 */
export function confidenceFromScore(score: number): Confidence {
  return score >= 0.75 ? "high" : score >= 0.45 ? "medium" : "low";
}

/** Combine independent evidence weights: 1 - prod(1 - w). Result in [0, 1]. */
export function combineWeights(weights: number[]): number {
  let miss = 1;
  for (const w of weights) miss *= 1 - clamp01(w);
  return clamp01(1 - miss);
}

/** Clamp to [0, 1]. */
export function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** Deterministic seeded PRNG (mulberry32) for fixtures/tests. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
