/**
 * The saved history as a file a person can keep: sealed with a passphrase in the same format as the history the page
 * keeps on this device and the one the command line tool keeps (packages/core/src/ledger/seal.ts and saved.ts), so a
 * file made here opens there and the other way round. Nothing is stored and nothing leaves the device: the file is
 * made in memory and handed to the browser's save, and a chosen file is read in memory and forgotten.
 */
import { SealError, openLedger, sealLedger } from "@snappy-export/core";
import { estimateStrength } from "./passphrase.ts";
import { packSaved, unpackSaved } from "./persist-codec.ts";
import type { Saved } from "./persist-codec.ts";

/** The name of the file Save history file makes. The repository's .gitignore skips *.sealed, so one is never committed by accident. */
export const HISTORY_FILE_NAME = "snappy-history.sealed";

/** A sealed history holds friend lists and lists of names, never media, so a larger file is not one of ours. */
export const MAX_HISTORY_FILE_BYTES = 32 * 1024 * 1024;

/** True when there is something worth saving: an export in the history, or a keep list, checkmarks or ticks. */
export const hasHistory = (saved: Saved): boolean => saved.ledger.snapshots.length > 0 || saved.allowlist.length > 0 || saved.checkedOff.length > 0 || (saved.ticks?.length ?? 0) > 0;

/** Seal the history with a passphrase. The same minimum the Settings form asks for applies here. */
export async function buildHistoryFile(saved: Saved, passphrase: string): Promise<Uint8Array> {
  if (!estimateStrength(passphrase).acceptable) throw new Error("passphrase too short");
  return sealLedger(packSaved(saved), passphrase);
}

export type HistoryFileResult = { ok: true; saved: Saved } | { ok: false; problem: "passphrase" | "unreadable" };

/**
 * Open a chosen file. The seal answers a wrong passphrase and a file that is not a sealed history in the same way, on
 * purpose, so both come back as "passphrase". Only a history from a newer version (or a failure of the engine) is "unreadable".
 */
export async function readHistoryFile(file: Blob, passphrase: string): Promise<HistoryFileResult> {
  if (file.size > MAX_HISTORY_FILE_BYTES) return { ok: false, problem: "unreadable" };
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return { ok: true, saved: unpackSaved(await openLedger(bytes, passphrase)) };
  } catch (e) {
    return { ok: false, problem: e instanceof SealError ? "passphrase" : "unreadable" };
  }
}
