/**
 * The sealed ledger and its companion allowlist on disk.
 *
 *   <home>/.snappy/ledger.sealed             friend-list snapshots, sealed with the passphrase
 *   <home>/.snappy/ledger.allowlist.sealed   {"allowlist": ["username", ...]}, sealed the same way
 *
 * The allowlist lives in its own sealed file (same passphrase, same format) rather than inside
 * the ledger so core's ledger format stays untouched and "keep" never rewrites snapshot history.
 * Both files are written atomically (temp file in the same folder, then rename) with owner-only
 * permissions where the OS supports them. Passphrases are used for sealing and never stored.
 */
import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { LedgerFormatError, SealError, emptyLedger, normUser, openLedger, openText, sealLedger, sealText } from "@snappy-export/core";
import type { Ledger } from "@snappy-export/core";
import { CliError, fsError } from "./errors.ts";

export function defaultLedgerPath(home: string): string {
  return join(home, ".snappy", "ledger.sealed");
}

/** ledger.sealed -> ledger.allowlist.sealed; any other name gets ".allowlist" appended. */
export function allowlistPathFor(ledgerPath: string): string {
  return ledgerPath.endsWith(".sealed") ? `${ledgerPath.slice(0, -".sealed".length)}.allowlist.sealed` : `${ledgerPath}.allowlist`;
}

const WRONG_PASSPHRASE = new CliError(
  "wrong-passphrase",
  "Snappy could not unlock your ledger and changed nothing. The passphrase may be wrong, or the file damaged.",
);

/**
 * Write bytes so that readers see either the old file or the whole new one, never a partial file.
 * Pass `sync: false` for bulk output (rescued Memories) where per-file durability is not worth the time.
 */
export async function atomicWrite(path: string, bytes: Uint8Array, opts: { sync?: boolean } = {}): Promise<void> {
  const dir = dirname(path);
  const temp = join(dir, `.${basename(path)}.${randomUUID()}.tmp`);
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const handle = await open(temp, "wx", 0o600);
    try {
      await handle.writeFile(bytes);
      if (opts.sync !== false) await handle.sync();
    } finally {
      await handle.close();
    }
    await renameWithRetry(temp, path);
    // Best effort: Windows ignores POSIX modes, and the file was created owner-only anyway.
    await chmod(path, 0o600).catch(() => undefined);
  } catch (e) {
    await unlink(temp).catch(() => undefined);
    throw fsError(e, "write", path);
  }
}

/** Windows briefly locks a file that a virus scanner or indexer is looking at. */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (attempt >= 4 || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) throw e;
      await new Promise((r) => setTimeout(r, 40 * (attempt + 1)));
    }
  }
}

function processIsGone(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "ESRCH";
  }
}

/**
 * Take a lock file next to the ledger, so two Snappy commands cannot both read the sealed files,
 * change them, and write: the second change would silently replace the first. Take it after the
 * passphrase is known (never while the person is typing) and hold it from the first read to the
 * last write. A waiting command retries for a few seconds, then stops with a calm message; a lock
 * left behind by a run that is no longer alive is recognized and taken over. (No clock is read:
 * the wait is a count of retries.) Returns the function that releases it.
 */
export async function acquireLedgerLock(ledgerPath: string, opts: { waitMs?: number } = {}): Promise<() => Promise<void>> {
  const lockPath = `${ledgerPath}.lock`;
  const retries = Math.ceil((opts.waitMs ?? 10_000) / 100);
  await mkdir(dirname(lockPath), { recursive: true, mode: 0o700 }).catch((e: unknown) => {
    throw fsError(e, "create the folder for", ledgerPath);
  });
  for (let attempt = 0; ; attempt++) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      await handle.writeFile(String(process.pid));
      await handle.close();
      break;
    } catch (e) {
      // Windows answers EPERM or EBUSY, not EEXIST, while another command is releasing its lock file (it is
      // "pending delete" for a moment), so those mean "try again" there.
      const code = (e as NodeJS.ErrnoException).code;
      const releasing = process.platform === "win32" && (code === "EPERM" || code === "EBUSY");
      if (code !== "EEXIST" && !releasing) throw fsError(e, "lock", ledgerPath);
    }
    let stale = false;
    try {
      const owner = Number(await readFile(lockPath, "utf8"));
      stale = Number.isInteger(owner) && owner > 0 && processIsGone(owner);
    } catch {
      continue; // the lock was released between the attempt and the look: try again
    }
    if (stale) {
      await unlink(lockPath).catch(() => undefined);
      continue;
    }
    if (attempt >= retries) {
      throw new CliError(
        "ledger-busy",
        `Another command is using this ledger, so nothing was changed. Wait and try again, or delete "${lockPath}" if none is running.`,
      );
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return () => unlink(lockPath).catch(() => undefined);
}

/** Run `work` while holding the ledger lock. */
export async function withLedgerLock<T>(ledgerPath: string, work: () => Promise<T>, opts: { waitMs?: number } = {}): Promise<T> {
  const release = await acquireLedgerLock(ledgerPath, opts);
  try {
    return await work();
  } finally {
    await release();
  }
}

/** The file's bytes, or undefined when it does not exist. */
export async function readIfExists(path: string): Promise<Uint8Array | undefined> {
  try {
    return await readFile(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw fsError(e, "read", path);
  }
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
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
export async function loadLedger(path: string, passphrase: string): Promise<Ledger | undefined> {
  const sealed = await readIfExists(path);
  if (sealed === undefined) return undefined;
  try {
    return await openLedger(sealed, passphrase);
  } catch (e) {
    throw unsealError(e);
  }
}

export async function saveLedger(path: string, ledger: Ledger, passphrase: string): Promise<void> {
  await atomicWrite(path, await sealLedger(ledger, passphrase));
}

/** The saved allowlist (normalized usernames), or undefined when none has been saved yet. */
export async function loadAllowlist(ledgerPath: string, passphrase: string): Promise<string[] | undefined> {
  const sealed = await readIfExists(allowlistPathFor(ledgerPath));
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

export async function saveAllowlist(ledgerPath: string, allowlist: string[], passphrase: string): Promise<void> {
  const text = JSON.stringify({ allowlist: normalizeAllowlist(allowlist) });
  await atomicWrite(allowlistPathFor(ledgerPath), await sealText(text, passphrase));
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
export async function unlockStore(ledgerPath: string, passphrase: string): Promise<Unlocked> {
  const ledger = await loadLedger(ledgerPath, passphrase);
  const allowlist = await loadAllowlist(ledgerPath, passphrase);
  return { ledger: ledger ?? emptyLedger(), allowlist: allowlist ?? [] };
}

/** True when neither file exists, i.e. the passphrase about to be chosen is a new one. */
export async function isFreshStore(ledgerPath: string): Promise<boolean> {
  return !(await fileExists(ledgerPath)) && !(await fileExists(allowlistPathFor(ledgerPath)));
}
