/**
 * The command line's side of the ports: the real file system, the real path rules and a lock file.
 * With node-io.ts and main.ts this is the only code that imports node: modules or reads process
 * state. Errors are raised as the system raised them (they carry an errno-style `.code`); callers
 * turn them into calm messages with fsError().
 */
import { randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, open, readFile, readdir, rename, stat, unlink, utimes } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import * as nodePath from "node:path";
import { CliError, fsError } from "./errors.ts";
import type { FsPort, FsReadHandle, LockPort, PathPort } from "./ports.ts";

/** One positional read never asks the OS for more than this (some platforms reject >2 GiB). */
const MAX_READ = 64 * 1024 * 1024;

const codeOf = (e: unknown): string | undefined => (typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : undefined);

/** Windows briefly locks a file that a virus scanner or indexer is looking at. */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (e) {
      const code = codeOf(e);
      if (attempt >= 4 || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) throw e;
      await new Promise((r) => setTimeout(r, 40 * (attempt + 1)));
    }
  }
}

/**
 * A reader over a file handle. It answers exactly the byte ranges core asks for (the end record,
 * the central directory, the few entries being opened), so a multi-GB export zip is never loaded
 * whole and its media bytes are never touched.
 */
async function openRead(path: string): Promise<FsReadHandle> {
  const handle: FileHandle = await open(path, "r");
  let size: number;
  try {
    size = (await handle.stat()).size;
  } catch (e) {
    await handle.close().catch(() => undefined);
    throw e;
  }
  return {
    size,
    async read(start, end) {
      const length = end - start;
      // A plain Uint8Array (never a pooled Buffer) so views over it can never alias other data.
      const out = new Uint8Array(length);
      let got = 0;
      while (got < length) {
        const { bytesRead } = await handle.read(out, got, Math.min(length - got, MAX_READ), start + got);
        if (bytesRead === 0) throw new RangeError("the file ended before the requested range");
        got += bytesRead;
      }
      return out;
    },
    close: () => handle.close().catch(() => undefined),
  };
}

export function createNodeFs(): FsPort {
  return {
    setsFileTimes: true,
    async stat(path) {
      const info = await stat(path);
      return { isFile: info.isFile(), isDirectory: info.isDirectory(), size: info.size, mtimeMs: info.mtimeMs };
    },
    async readDir(path) {
      const entries = await readdir(path, { withFileTypes: true });
      return entries.map((d) => ({ name: d.name, isFile: d.isFile(), isDirectory: d.isDirectory() }));
    },
    openRead,
    async readFile(path) {
      const bytes = await readFile(path);
      return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    },
    async mkdir(path, opts) {
      await mkdir(path, { recursive: opts?.recursive === true });
    },
    /**
     * Write bytes so that readers see either the old file or the whole new one, never a partial
     * file: a temp file in the same folder, then a rename. Owner-only where the OS supports it.
     * `durable: false` skips the fsync, for bulk output (rescued Memories) where per-file
     * durability is not worth the time.
     */
    async writeFileAtomic(path, bytes, opts) {
      const dir = nodePath.dirname(path);
      const temp = nodePath.join(dir, `.${nodePath.basename(path)}.${randomUUID()}.tmp`);
      try {
        await mkdir(dir, { recursive: true, mode: 0o700 });
        const handle = await open(temp, "wx", 0o600);
        try {
          await handle.writeFile(bytes);
          if (opts?.durable !== false) await handle.sync();
        } finally {
          await handle.close();
        }
        await renameWithRetry(temp, path);
        // Best effort: Windows ignores POSIX modes, and the file was created owner-only anyway.
        await chmod(path, 0o600).catch(() => undefined);
      } catch (e) {
        await unlink(temp).catch(() => undefined);
        throw e;
      }
    },
    rename: (from, to) => rename(from, to),
    remove: (path) => unlink(path),
    async setMtime(path, mtimeMs) {
      const when = new Date(mtimeMs);
      return utimes(path, when, when).then(
        () => true,
        () => false,
      );
    },
    makeTempDir: (prefixPath) => mkdtemp(prefixPath),
  };
}

export function createNodePath(): PathPort {
  return {
    sep: nodePath.sep,
    resolve: (...parts) => nodePath.resolve(...parts),
    join: (...parts) => nodePath.join(...parts),
    dirname: (p) => nodePath.dirname(p),
    basename: (p) => nodePath.basename(p),
    relative: (a, b) => nodePath.relative(a, b),
    isAbsolute: (p) => nodePath.isAbsolute(p),
  };
}

function processIsGone(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (e) {
    return codeOf(e) === "ESRCH";
  }
}

/**
 * A lock file next to the ledger, so two Snappy commands cannot both read the sealed file,
 * change it, and write: the second change would silently replace the first. A waiting command
 * retries for a few seconds, then stops with a calm message; a lock left behind by a run that is
 * no longer alive is recognized and taken over. (No clock is read: the wait is a count of retries.)
 */
async function acquire(name: string, waitMs: number): Promise<() => Promise<void>> {
  const lockPath = `${name}.lock`;
  const retries = Math.ceil(waitMs / 100);
  await mkdir(nodePath.dirname(lockPath), { recursive: true, mode: 0o700 }).catch((e: unknown) => {
    throw fsError(e, "create the folder for", name);
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
      const code = codeOf(e);
      const releasing = process.platform === "win32" && (code === "EPERM" || code === "EBUSY");
      if (code !== "EEXIST" && !releasing) throw fsError(e, "lock", name);
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

export function createNodeLock(): LockPort {
  return {
    async withLock(name, opts, work) {
      const release = await acquire(name, opts.waitMs);
      try {
        return await work();
      } finally {
        await release();
      }
    },
  };
}
