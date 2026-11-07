/**
 * Tolerant-JSON helpers shared by the export parsers. The real export schema is
 * unverified, so every accessor here accepts surprises and returns undefined
 * instead of throwing.
 *
 * Privacy: parsers read input objects ONLY through `compileAllow` / `readAllowed`,
 * so a key that is not on a parser's allowlist (message text, display names,
 * locations, titles...) has its value left untouched, never copied.
 */
import type { ExportIssue, ExportIssueSeverity } from "../types.ts";

export function issue(severity: ExportIssueSeverity, code: string, message: string): ExportIssue {
  return { severity, code, message };
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const KEY_CACHE_MAX = 2048;
const keyCache = new Map<string, string>();
/** Normalised forms of every allowlist alias registered through compileAllow. */
const knownAliases = new Set<string>();

/**
 * Canonical form of a JSON key for matching: lower-cased, with everything except
 * letters/digits removed. "Created(microseconds)" -> "createdmicroseconds",
 * "Media Type" / "media_type" / "mediaType" -> "mediatype". Memoised because the
 * same few field names repeat across hundreds of thousands of entries.
 *
 * Privacy: only keys that normalise to a registered allowlist alias are memoised. A chat
 * container key (a username or a raw group title) is never retained in this module-global
 * map, so nothing personal outlives the parse (privacy contract rule 1).
 */
export function normKey(key: string): string {
  const cached = keyCache.get(key);
  if (cached !== undefined) return cached;
  const n = key.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  // Bounded as well, so a hostile file with endless alias spellings cannot grow the cache forever.
  if (knownAliases.has(n) && keyCache.size < KEY_CACHE_MAX) keyCache.set(key, n);
  return n;
}

/** Number of memoised keys. A diagnostic for tests: proves no raw container key is retained. */
export function keyCacheSize(): number {
  return keyCache.size;
}

/** field -> normalised key aliases, most preferred first. */
export type AllowSpec<K extends string> = Record<K, readonly string[]>;

export interface CompiledAllow<K extends string> {
  /** normalised alias -> field and its preference rank. */
  lookup: Map<string, { field: K; rank: number }>;
}

export function compileAllow<K extends string>(spec: AllowSpec<K>): CompiledAllow<K> {
  const lookup = new Map<string, { field: K; rank: number }>();
  for (const field of Object.keys(spec) as K[]) {
    spec[field].forEach((alias, rank) => {
      knownAliases.add(alias);
      if (!lookup.has(alias)) lookup.set(alias, { field, rank });
    });
  }
  return { lookup };
}

/**
 * Read only allowlisted fields from `rec`. Matching ignores case and punctuation;
 * undefined/null/"" values count as absent; when several aliases of one field are
 * present the most preferred wins. Keys outside the allowlist are never read.
 */
export function readAllowed<K extends string>(
  rec: Record<string, unknown>,
  allow: CompiledAllow<K>,
): Partial<Record<K, unknown>> {
  const out: Partial<Record<K, unknown>> = {};
  const ranks = new Map<K, number>();
  for (const key of Object.keys(rec)) {
    const hit = allow.lookup.get(normKey(key));
    if (hit === undefined) continue;
    const best = ranks.get(hit.field);
    if (best !== undefined && best <= hit.rank) continue;
    const v = rec[key];
    if (v === undefined || v === null || v === "") continue;
    out[hit.field] = v;
    ranks.set(hit.field, hit.rank);
  }
  return out;
}

/**
 * Text from a string or finite number (a numeric username is still a username);
 * objects, arrays, booleans, null and blanks yield undefined.
 */
export function asText(v: unknown): string | undefined {
  if (typeof v === "string") {
    const t = v.trim();
    return t === "" ? undefined : t;
  }
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return undefined;
}

export function asBool(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v === 1 ? true : v === 0 ? false : undefined;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true" || s === "1" || s === "yes") return true;
    if (s === "false" || s === "0" || s === "no") return false;
  }
  return undefined;
}

/** Decode file bytes to text, dropping any BOM (UTF-8, UTF-16LE/BE). */
export function decodeText(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  }
  // TextDecoder drops one UTF-8 BOM; the regex also covers a doubled one.
  return new TextDecoder("utf-8").decode(bytes).replace(/^﻿+/, "");
}

/**
 * Most objects and lists one JSON file may open. Size limits count bytes, but a file of nothing
 * but "{},{},..." compresses to almost nothing in a zip and parses into gigabytes of objects, so
 * the number of containers is bounded too. A real export holds a few per entry (1-2 million for
 * the biggest chat histories); this leaves room for that and stops a hostile file well before it
 * can freeze or crash the page.
 */
export const MAX_JSON_CONTAINERS = 6_000_000;

/** Counts "{" and "[" bytes (a rough count: it also sees them inside strings), stopping once past the limit. */
function tooManyContainers(bytes: Uint8Array): boolean {
  let count = 0;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if ((b === 0x7b || b === 0x5b) && ++count > MAX_JSON_CONTAINERS) return true;
  }
  return false;
}

/**
 * Parse JSON bytes without throwing. `label` is a fixed system file name. The
 * engine's own SyntaxError text is deliberately dropped: it quotes a snippet of
 * the input, which would echo user data into an issue.
 */
export function parseJsonBytes(label: string, bytes: Uint8Array): { value?: unknown; issues: ExportIssue[] } {
  let text: string;
  try {
    text = decodeText(bytes);
  } catch (e) {
    // A RangeError here means the text is beyond the engine's maximum string length: say so
    // instead of calling a (possibly valid) file "not valid JSON".
    if (e instanceof RangeError) {
      return { issues: [issue("error", "json-too-large", `${label} is too large to read, so it was not read.`)] };
    }
    return { issues: [issue("error", "json-parse-failed", `${label} is not valid JSON, so it was not read.`)] };
  }
  // Before the parse, which is where a hostile file costs time and memory.
  if (tooManyContainers(bytes)) {
    return { issues: [issue("error", "json-too-complex", `${label} has too many items to read safely, so it was not read.`)] };
  }
  try {
    return { value: JSON.parse(text) as unknown, issues: [] };
  } catch {
    return { issues: [issue("error", "json-parse-failed", `${label} is not valid JSON, so it was not read.`)] };
  }
}

/** "1 entry was" / "3 entries were" style pluralisation for issue messages. */
export function entries(n: number): string {
  return `${n} entr${n === 1 ? "y" : "ies"}`;
}
