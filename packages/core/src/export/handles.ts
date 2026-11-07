import type { MemoryItem, ParsedExport } from "../types.ts";

/**
 * Drop what only extraction needs, once pairing is done, for a front end that counts and shows
 * Memories but never opens a file or downloads anything (the dashboard).
 *
 * The location of each bundled file (its path carries the capture day and the file's id), the
 * list of every media file with its stored time, the overlay paths and the download links (which
 * can be signed and personal) would otherwise sit in memory for as long as the page is open, where
 * nothing reads them. What the Memories plan does use is only whether two items name the same
 * file or link, so each path and link is replaced by a short token: equal values keep equal
 * tokens and nothing else survives. Pairing counts, part numbers and sizes are kept. Applying it
 * twice changes nothing more. The input is not modified.
 */
export function forgetMediaHandles(parsed: ParsedExport): ParsedExport {
  const tokens = new Map<string, string>();
  const token = (kind: "file" | "link", value: string): string => {
    const key = `${kind}\u0000${value}`;
    let t = tokens.get(key);
    if (t === undefined) tokens.set(key, (t = `#${kind}-${tokens.size}`));
    return t;
  };
  const forget = (m: MemoryItem): MemoryItem => {
    const { zipPath, downloadUrl, overlayPaths: _paths, overlayParts: _parts, ...rest } = m;
    return {
      ...rest,
      ...(zipPath !== undefined && { zipPath: token("file", zipPath) }),
      ...(downloadUrl !== undefined && { downloadUrl: token("link", downloadUrl) }),
    };
  };
  const { bundledMedia: _media, ...kept } = parsed;
  return { ...kept, memories: parsed.memories.map(forget) };
}
