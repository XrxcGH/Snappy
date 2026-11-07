/**
 * What the Memories screen says about the files in the export. Counts only: no file name, path or
 * link is read here, so none can reach the screen.
 */
import type { ExportIssue, ParsedExport } from "@snappy-export/core";

export interface PairingFacts {
  /** Saved Memories in the list. */
  listed: number;
  /** Listed Memories that have a file in the export. */
  have: number;
  /** Listed Memories with no file in the export. */
  missing: number;
  /** Caption and sticker overlays found next to the files. */
  overlays: number;
  /** The list has no download links, so the files in the zips are all there is. */
  linksEmpty: boolean;
}

/** Null when the export holds no Memories files, or no list to pair them with. */
export function pairingFacts(parsed: ParsedExport | null, issues: readonly ExportIssue[]): PairingFacts | null {
  const pairing = parsed?.memoriesPairing;
  if (!pairing) return null;
  return {
    listed: pairing.items,
    have: pairing.paired,
    missing: Math.max(0, pairing.items - pairing.paired),
    overlays: pairing.overlays,
    // Core notes this once per export; its code is the signal, so no link is looked at.
    linksEmpty: issues.some((i) => i.code === "memories-links-empty"),
  };
}
