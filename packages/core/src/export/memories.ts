import { pairMemories } from "../memories/pair.ts";
import type { MemoryMediaFile } from "../memories/pair.ts";
import type { ExportIssue, MemoriesPairing, MemoryItem, MemoryMediaType } from "../types.ts";
import { hashString, toMs } from "../util.ts";
import { asText, compileAllow, entries, isRecord, issue, normKey, readAllowed } from "./json-util.ts";

const SECTION_ALIASES = new Set(["savedmedia", "memories", "savedmemories", "media"]);

const IMAGE_EXT = new Set(["jpg", "jpeg", "png", "heic", "webp", "gif"]);
const VIDEO_EXT = new Set(["mp4", "mov", "m4v", "webm"]);

function extensionType(pathOrUrl: string): MemoryMediaType {
  // Drop query/fragment first: download URLs carry long query strings.
  const clean = pathOrUrl.split(/[?#]/, 1)[0] ?? "";
  const ext = /\.([a-z0-9]{2,5})$/i.exec(clean)?.[1]?.toLowerCase();
  if (ext === undefined) return "unknown";
  return IMAGE_EXT.has(ext) ? "image" : VIDEO_EXT.has(ext) ? "video" : "unknown";
}

function typeFromLabel(label: string | undefined): MemoryMediaType {
  if (label === undefined) return "unknown";
  const l = label.toLowerCase();
  if (/video|movie|clip/.test(l)) return "video";
  if (/image|photo|picture/.test(l)) return "image";
  return "unknown";
}

/**
 * ALLOWLIST of memory fields. "Location" (GPS) and every other key are absent on
 * purpose: they are never read, so they cannot be copied.
 */
const ENTRY_ALLOW = compileAllow({
  date: ["date", "capturedate", "created", "createdat"],
  mediaType: ["mediatype", "type"],
  directUrl: ["mediadownloadurl"],
  linkUrl: ["downloadlink", "downloadurl"],
});

/**
 * Parse json/memories_history.json into items. Linking items to the media files shipped inside
 * the export is a separate step (attachBundledMedia). Never throws.
 */
export function parseMemoriesJson(obj: unknown): { memories: MemoryItem[]; issues: ExportIssue[] } {
  const issues: ExportIssue[] = [];

  let list: unknown[] | undefined;
  if (Array.isArray(obj)) {
    list = obj;
  } else if (isRecord(obj)) {
    const key = Object.keys(obj).find((k) => SECTION_ALIASES.has(normKey(k)) && Array.isArray(obj[k]));
    if (key !== undefined) list = obj[key] as unknown[];
    else issues.push(issue("warning", "memories-no-section", "memories_history.json has no list of saved Memories."));
  } else {
    issues.push(issue("warning", "memories-unexpected-shape", "memories_history.json looks different from what Snappy expects, so no Memories were read."));
  }
  if (list === undefined) return { memories: [], issues };

  const items: MemoryItem[] = [];
  const usedIds = new Map<string, number>();
  let invalid = 0;
  let badDates = 0;

  for (const raw of list) {
    if (!isRecord(raw)) {
      invalid++;
      continue;
    }
    const f = readAllowed(raw, ENTRY_ALLOW);
    const date = toMs(f.date) ?? null;
    if (f.date !== undefined && date === null) badDates++;

    const links = [asText(f.directUrl), asText(f.linkUrl)].filter(
      (u): u is string => u !== undefined && /^https?:\/\//i.test(u),
    );
    // The direct media URL is preferred over the landing-page link: it is what a downloader needs.
    const downloadUrl = links[0];

    const labelled = typeFromLabel(asText(f.mediaType));
    const mediaType = labelled !== "unknown" ? labelled : downloadUrl !== undefined ? extensionType(downloadUrl) : "unknown";

    const item: MemoryItem = { id: "", date, mediaType };
    if (downloadUrl !== undefined) item.downloadUrl = downloadUrl;

    // 32-bit hashes collide at ~50k items, so disambiguate with an occurrence counter.
    const base = hashString([date ?? "", mediaType, downloadUrl ?? ""].join("|"));
    const seen = usedIds.get(base) ?? 0;
    usedIds.set(base, seen + 1);
    item.id = seen === 0 ? base : `${base}-${seen + 1}`;

    items.push(item);
  }

  if (invalid > 0) issues.push(issue("warning", "memories-invalid-entries", `${entries(invalid)} in memories_history.json could not be read and ${invalid === 1 ? "was" : "were"} skipped.`));
  if (badDates > 0) issues.push(issue("info", "memories-bad-date", `${badDates} ${badDates === 1 ? "Memory has" : "Memories have"} a date Snappy could not read.`));
  return { memories: items, issues };
}

/** Issue codes that describe how items and bundled files fit together; recomputed whenever they are paired. */
export const PAIRING_ISSUE_CODES: ReadonlySet<string> = new Set([
  "memories-no-media-source",
  "memories-list-only",
  "memories-links-empty",
  "memories-time-offset",
  "memories-pairing-fallback",
  "memories-unmatched-items",
  "memories-ambiguous-items",
]);

/** The pairing fields of an item, cleared so a re-pairing starts from the list alone. */
function withoutPairing(item: MemoryItem): MemoryItem {
  const { zipPath: _zip, partIndex: _part, overlayPaths: _overlays, overlayParts: _overlayParts, sizeBytes: _size, ...rest } = item;
  return rest;
}

/**
 * Link the Memories list to the media files found in the zip directories (see pairMemories for
 * how). Returns NEW items (the input is left alone) with zipPath, partIndex, sizeBytes and
 * overlayPaths set for every pair, plus the pairing counts and the notes about it. Pure: it
 * depends only on its two inputs, so pairing the same sets again gives the same answer.
 *
 * Notes carry counts only, never a name, path or time. With no files at all there is nothing to
 * pair: items are returned as they are and only the entries that cannot be rescued are counted.
 */
export function attachBundledMedia(
  items: readonly MemoryItem[],
  files: readonly MemoryMediaFile[],
): { memories: MemoryItem[]; pairing?: MemoriesPairing; issues: ExportIssue[] } {
  const issues: ExportIssue[] = [];
  if (files.length === 0) {
    const unreachable = items.filter((m) => m.downloadUrl === undefined && m.zipPath === undefined).length;
    if (unreachable > 0) {
      issues.push(issue("warning", "memories-no-media-source", `${unreachable} ${unreachable === 1 ? "Memory has" : "Memories have"} no file or link in your ZIP files. Part of your export may be missing.`));
    }
    return { memories: items.map((m) => ({ ...m })), issues };
  }

  const result = pairMemories(items.map(withoutPairing), [...files]);
  const byId = new Map(result.pairs.map((p) => [p.itemId, p]));
  const memories = items.map((original) => {
    const item = withoutPairing(original);
    const pair = byId.get(item.id);
    if (pair === undefined) return item;
    item.zipPath = pair.file.path;
    item.partIndex = pair.file.part;
    item.sizeBytes = pair.file.size;
    if (pair.overlays.length > 0) {
      item.overlayPaths = pair.overlays.map((o) => o.path);
      if (pair.overlays.some((o) => o.part !== pair.file.part)) item.overlayParts = pair.overlays.map((o) => o.part);
    }
    if (item.mediaType === "unknown") item.mediaType = extensionType(pair.file.path);
    return item;
  });
  const pairing: MemoriesPairing = { ...result.summary, method: result.method, offsetHours: result.offsetHours };
  if (result.extraOffsetHours.length > 0) pairing.extraOffsetHours = result.extraOffsetHours;
  if (items.length === 0) return { memories, issues };

  if (!items.some((m) => m.downloadUrl !== undefined)) {
    issues.push(issue("info", "memories-links-empty", "No Memory has a download link. Snappy uses the files inside the export instead."));
  }
  if (result.method === "offset-time") {
    const hours = (h: number): string => (h === 0 ? "set to UTC" : `${Math.abs(h)} hour${Math.abs(h) === 1 ? "" : "s"} ${h < 0 ? "behind" : "ahead of"} UTC`);
    issues.push(issue("info", "memories-time-offset", result.extraOffsetHours.length === 0
      ? `The Memories files keep their times on a clock ${hours(result.offsetHours)}. Snappy allowed for that.`
      : `The Memories files keep their times on a clock that was ${[result.offsetHours, ...result.extraOffsetHours].map(hours).join(" or ")}. Snappy allowed for both.`));
  }
  if (result.method === "date-type") {
    issues.push(issue("warning", "memories-pairing-fallback", "The Memories files have no usable time, so Snappy matched them by date and type. Some Memories may be unmatched."));
  }
  const missing = memories.filter((m) => m.zipPath === undefined && m.downloadUrl === undefined).length;
  // Some of these have a file that Snappy could not tell from another's: that is not a missing file, and the advice differs.
  const ambiguous = Math.min(result.summary.ambiguous, missing);
  const notFound = missing - ambiguous;
  if (notFound > 0) {
    issues.push(issue("warning", "memories-unmatched-items",
      `${notFound} of ${items.length} saved ${items.length === 1 ? "Memory" : "Memories"} ${notFound === 1 ? "has" : "have"} no file in your ZIP files.`));
  }
  if (ambiguous > 0) {
    issues.push(issue("warning", "memories-ambiguous-items",
      ambiguous === 1
        ? "1 saved Memory shares a time with others, so Snappy did not guess. Its file is in your ZIP files."
        : `${ambiguous} saved Memories share a time with others, so Snappy did not guess. Their files are in your ZIP files.`));
  }
  return { memories, pairing, issues };
}

/** Canonical order of bundled files (part, then path): the same set always pairs and serialises the same way. */
export function sortBundledMedia(files: readonly MemoryMediaFile[]): MemoryMediaFile[] {
  return [...files].sort((a, b) => a.part - b.part || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
