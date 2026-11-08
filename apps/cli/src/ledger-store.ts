/**
 * The sealed saved history on disk: one file, the same one the dashboard keeps.
 *
 *   <home>/.snappy/ledger.sealed   friend-list snapshots, the keep list and the guided-removal
 *                                  checkmarks, sealed with the passphrase (core's saved.ts format)
 *
 * The keep list and the checkmarks travel inside the ledger as reserved pseudo-snapshots, so the
 * dashboard and the command line read and write the very same bytes. An older command line kept
 * the keep list in a second file, ledger.allowlist.sealed. That file is still read once, when the
 * ledger does not carry the lists yet, and is never deleted or rewritten; after the first save the
 * ledger carries the lists and the older file is ignored (so unkeep cannot bring a name back).
 *
 * The file is written atomically (the file system port writes a temp file, then renames) with
 * owner-only permissions where the OS supports them. Passphrases are used for sealing and never
 * stored. Everything here reaches the disk through io.fs, io.path and io.lock.
 */
import { LedgerFormatError, SealError, emptyLedger, hasSavedLists, normUser, openLedger, openText, packSaved, sealLedger, sortedUnique, unpackSaved } from "@snappy-export/core";
import type { Ledger, Saved } from "@snappy-export/core";
import type { OptionSpec } from "./args.ts";
import { CliError, fsError } from "./errors.ts";
import type { Io } from "./io.ts";

type FsIo = Pick<Io, "fs">;

export function defaultLedgerPath(io: Pick<Io, "homedir" | "path">): string {
  return io.path.join(io.homedir(), ".snappy", "ledger.sealed");
}

/**
 * The option that names the saved history file. --history is the name people see; --ledger is
 * the older name, still accepted so scripts keep working, and it is left out of every help text.
 */
export const HISTORY_PATH_OPTIONS: OptionSpec = {
  history: { type: "string" },
  ledger: { type: "string" },
};

export interface HistoryPathFlags {
  history?: string;
  ledger?: string;
}

/** The file the person named with --history (or the older --ledger), if they named one. --history wins. */
export function historyPathFlag(flags: HistoryPathFlags): string | undefined {
  return flags.history ?? flags.ledger;
}

/**
 * Where an older command line kept the keep list: ledger.sealed -> ledger.allowlist.sealed; any
 * other name gets ".allowlist" appended. Read only, for the one-time migration.
 */
export function allowlistPathFor(ledgerPath: string): string {
  return ledgerPath.endsWith(".sealed") ? `${ledgerPath.slice(0, -".sealed".length)}.allowlist.sealed` : `${ledgerPath}.allowlist`;
}

const WRONG_PASSPHRASE = new CliError(
  "wrong-passphrase",
  "Snappy could not unlock your saved history and changed nothing. The passphrase may be wrong, or the file damaged.",
);

const codeOf = (e: unknown): string | undefined => (typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : undefined);

/**
 * Write bytes so that readers see either the old file or the whole new one, never a partial file.
 * Pass `sync: false` for bulk output (rescued Memories) where per-file durability is not worth the time.
 */
export async function atomicWrite(io: FsIo, path: string, bytes: Uint8Array, opts: { sync?: boolean } = {}): Promise<void> {
  try {
    await io.fs.writeFileAtomic(path, bytes, { durable: opts.sync !== false });
  } catch (e) {
    throw fsError(e, "write", path);
  }
}

/**
 * Run `work` while holding the ledger lock, so two Snappy commands cannot both read the sealed
 * file, change it, and write: the second change would silently replace the first. Take it after
 * the passphrase is known (never while the person is typing) and hold it from the first read to
 * the last write.
 */
export async function withLedgerLock<T>(io: Pick<Io, "lock">, ledgerPath: string, work: () => Promise<T>, opts: { waitMs?: number } = {}): Promise<T> {
  return io.lock.withLock(ledgerPath, { waitMs: opts.waitMs ?? 10_000 }, work);
}

/** The file's bytes, or undefined when it does not exist. */
export async function readIfExists(io: FsIo, path: string): Promise<Uint8Array | undefined> {
  try {
    return await io.fs.readFile(path);
  } catch (e) {
    if (codeOf(e) === "ENOENT") return undefined;
    throw fsError(e, "read", path);
  }
}

export async function fileExists(io: FsIo, path: string): Promise<boolean> {
  try {
    await io.fs.stat(path);
    return true;
  } catch (e) {
    if (codeOf(e) === "ENOENT") return false;
    throw fsError(e, "read", path);
  }
}

function unsealError(e: unknown): CliError {
  if (e instanceof LedgerFormatError) {
    return new CliError("ledger-version", "This saved history was written by a newer Snappy, so nothing was changed. Update Snappy to open it.");
  }
  if (e instanceof SealError) return WRONG_PASSPHRASE;
  throw e;
}

/** The keep list an older command line saved in its own file, or undefined when there is none. */
async function loadLegacyAllowlist(io: FsIo, ledgerPath: string, passphrase: string): Promise<string[] | undefined> {
  const sealed = await readIfExists(io, allowlistPathFor(ledgerPath));
  if (sealed === undefined) return undefined;
  let text: string;
  try {
    text = await openText(sealed, passphrase);
  } catch (e) {
    throw unsealError(e);
  }
  try {
    const raw: unknown = JSON.parse(text);
    const list = typeof raw === "object" && raw !== null ? (raw as { allowlist?: unknown }).allowlist : undefined;
    if (!Array.isArray(list)) throw new Error("shape");
    return normalizeAllowlist(list.filter((v): v is string => typeof v === "string"));
  } catch {
    throw new CliError("allowlist-unreadable", "Snappy could not read your saved keep list, so nothing was changed. The file may be damaged.");
  }
}

/**
 * Everything saved: the ledger, the keep list and the checkmarks. Nothing saved yet is an empty
 * Saved. The passphrase must unlock what exists.
 */
export async function loadStore(io: FsIo, ledgerPath: string, passphrase: string): Promise<Saved> {
  const sealed = await readIfExists(io, ledgerPath);
  let saved: Saved = { ledger: emptyLedger(), allowlist: [], checkedOff: [] };
  let hasLists = false;
  if (sealed !== undefined) {
    try {
      const packed = await openLedger(sealed, passphrase);
      hasLists = hasSavedLists(packed);
      saved = unpackSaved(packed);
    } catch (e) {
      throw unsealError(e);
    }
  }
  // An older ledger has no lists yet: take the keep list from the older companion file, once.
  if (!hasLists) {
    const legacy = await loadLegacyAllowlist(io, ledgerPath, passphrase);
    if (legacy !== undefined) saved = { ...saved, allowlist: sortedUnique([...saved.allowlist, ...legacy]) };
  }
  return saved;
}

export async function saveStore(io: FsIo, ledgerPath: string, saved: Saved, passphrase: string): Promise<void> {
  // The dashboard's checklist ticks ride along untouched, so a command that saves history never drops them.
  const normalized: Saved = { ledger: saved.ledger, allowlist: normalizeAllowlist(saved.allowlist), checkedOff: sortedUnique(saved.checkedOff), ...(saved.ticks !== undefined && { ticks: sortedUnique(saved.ticks) }) };
  await atomicWrite(io, ledgerPath, await sealLedger(packSaved(normalized), passphrase));
}

/** The saved ledger alone, or undefined when no ledger file has been saved yet. For commands that only read it. */
export async function loadLedger(io: FsIo, ledgerPath: string, passphrase: string): Promise<Ledger | undefined> {
  if (!(await fileExists(io, ledgerPath))) return undefined;
  return (await loadStore(io, ledgerPath, passphrase)).ledger;
}

/** Normalized, de-duplicated and sorted, so the saved file does not depend on typing order. */
export function normalizeAllowlist(names: string[]): string[] {
  return [...new Set(names.map(normUser).filter((n) => n !== ""))].sort();
}

/** True when nothing is saved yet, i.e. the passphrase about to be chosen is a new one. */
export async function isFreshStore(io: FsIo, ledgerPath: string): Promise<boolean> {
  return !(await fileExists(io, ledgerPath)) && !(await fileExists(io, allowlistPathFor(ledgerPath)));
}
