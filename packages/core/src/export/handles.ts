import type { MemoryItem, ParsedExport } from "../types.ts";

/** ".png" for a stored name that ends in a plain extension, else nothing. Nothing else of the name is read. */
const plainExtension = (path: unknown): string => {
  const ext = /\.([a-z0-9]{1,5})$/i.exec(typeof path === "string" ? path : "")?.[1];
  return ext === undefined ? "" : `.${ext.toLowerCase()}`;
};

/**
 * Drop what only extraction needs, once pairing is done, for a front end that counts and shows
 * Memories but never opens a file or downloads anything (the dashboard).
 *
 * The location of each bundled file (its path carries the capture day and the file's id), the
 * list of every media file with its stored time, the overlay paths and the download links (which
 * can be signed and personal) would otherwise sit in memory for as long as the page is open, where
 * nothing reads them. What the Memories plan does use is only whether two items name the same
 * file or link, so each path and link is replaced by a short token: equal values keep equal
 * tokens and nothing else survives. Pairing counts, part numbers and sizes are kept.
 *
 * An overlay keeps its count and its plain extension (up to five letters or digits), because a
 * rescue manifest names the overlay files it expects and must match the one the command writes.
 * The rest of its path is replaced by a token like any other. The zip part of each overlay is
 * dropped. Applying it twice changes nothing more. The input is not modified.
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
    const { zipPath, downloadUrl, overlayPaths, overlayParts: _parts, ...rest } = m;
    return {
      ...rest,
      ...(overlayPaths !== undefined && overlayPaths.length > 0 && { overlayPaths: overlayPaths.map((p) => `${token("file", p)}${plainExtension(p)}`) }),
      ...(zipPath !== undefined && { zipPath: token("file", zipPath) }),
      ...(downloadUrl !== undefined && { downloadUrl: token("link", downloadUrl) }),
    };
  };
  const { bundledMedia: _media, ...kept } = parsed;
  return { ...kept, memories: parsed.memories.map(forget) };
}
