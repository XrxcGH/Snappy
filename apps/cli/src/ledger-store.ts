/**
 * The sealed ledger and its companion allowlist on disk.
 *
 *   <home>/.snappy/ledger.sealed             friend-list snapshots, sealed with the passphrase
 *   <home>/.snappy/ledger.allowlist.sealed   {"allowlist": ["username", ...]}, sealed the same way
 *
 * The allowlist lives in its own sealed file (same passphrase, same format) rather than inside
 * the ledger so core's ledger format stays untouched and "keep" never rewrites snapshot history.
 * Both files are written atomically (the file system port writes a temp file, then renames) with
 * owner-only permissions where the OS supports them. Passphrases are used for sealing and never
 * stored. Everything here reaches the disk through io.fs, io.path and io.lock.
 */
import { LedgerFormatError, SealError, emptyLedger, normUser, openLedger, openText, sealLedger, sealText } from "@snappy-export/core";
import type { Ledger } from "@snappy-export/core";
import { CliError, fsError } from "./errors.ts";
import type { Io } from "./io.ts";

type FsIo = Pick<Io, "fs">;

export function defaultLedgerPath(io: Pick<Io, "homedir" | "path">): string {
  return io.path.join(io.homedir(), ".snappy", "ledger.sealed");
}

/** ledger.sealed -> ledger.allowlist.sealed; any other name gets ".allowlist" appended. */
export function allowlistPathFor(ledgerPath: string): string {
  return ledgerPath.endsWith(".sealed") ? `${ledgerPath.slice(0, -".sealed".length)}.allowlist.sealed` : `${ledgerPath}.allowlist`;
}

const WRONG_PASSPHRASE = new CliError(
  "wrong-passphrase",
  "Snappy could not unlock your ledger and changed nothing. The passphrase may be wrong, or the file damaged.",
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
 * files, change them, and write: the second change would silently replace the first. Take it
 * after the passphrase is known (never while the person is typing) and hold it from the first
 * read to the last write.
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
    return new CliError("ledger-version", "This ledger was written by a newer Snappy, so nothing was changed. Update Snappy to open it.");
  }
  if (e instanceof SealError) return WRONG_PASSPHRASE;
  throw e;
}

/** The sealed ledger, or undefined when none has been saved yet. */
export async function loadLedger(io: FsIo, path: string, passphrase: string): Promise<Ledger | undefined> {
  const sealed = await readIfExists(io, path);
  if (sealed === undefined) return undefined;
  try {
    return await openLedger(sealed, passphrase);
  } catch (e) {
    throw unsealError(e);
  }
}

export async function saveLedger(io: FsIo, path: string, ledger: Ledger, passphrase: string): Promise<void> {
  await atomicWrite(io, path, await sealLedger(ledger, passphrase));
}

/** The saved allowlist (normalized usernames), or undefined when none has been saved yet. */
export async function loadAllowlist(io: FsIo, ledgerPath: string, passphrase: string): Promise<string[] | undefined> {
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

export async function saveAllowlist(io: FsIo, ledgerPath: string, allowlist: string[], passphrase: string): Promise<void> {
  const text = JSON.stringify({ allowlist: normalizeAllowlist(allowlist) });
  await atomicWrite(io, allowlistPathFor(ledgerPath), await sealText(text, passphrase));
}

/** Normalized, de-duplicated and sorted, so the saved file does not depend on typing order. */
export function normalizeAllowlist(names: string[]): string[] {
  return [...new Set(names.map(normUser).filter((n) => n !== ""))].sort();
}

export interface Unlocked {
  ledger: Ledger;
  allowlist: string[];
}

/** Open whatever exists; the passphrase must unlock it. A missing ledger is an empty one. */
export async function unlockStore(io: FsIo, ledgerPath: string, passphrase: string): Promise<Unlocked> {
  const ledger = await loadLedger(io, ledgerPath, passphrase);
  const allowlist = await loadAllowlist(io, ledgerPath, passphrase);
  return { ledger: ledger ?? emptyLedger(), allowlist: allowlist ?? [] };
}

/** True when neither file exists, i.e. the passphrase about to be chosen is a new one. */
export async function isFreshStore(io: FsIo, ledgerPath: string): Promise<boolean> {
  return !(await fileExists(io, ledgerPath)) && !(await fileExists(io, allowlistPathFor(ledgerPath)));
}
