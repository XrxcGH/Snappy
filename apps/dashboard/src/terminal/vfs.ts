/**
 * The virtual file system a command sees inside the app. There are four places and nothing else:
 *
 *   /in    the files the person picked, read only. Lazy Blobs: only the byte ranges asked for are read.
 *   /out   a folder in memory, capped. Files written here move to the page when the command ends.
 *   /tmp   a folder in memory (the demo writes its invented exports here).
 *   /app   the saved history: only /app/.snappy/ledger.sealed, through a bridge to the page's own vault.
 *
 * Every path is normalized first (so ".." is gone), then sent to the mount with the longest matching
 * prefix. Anything else is refused. Every call checks the stop signal first. Runs in a worker:
 * no document, no window, no storage.
 */
import { CliError, FsError, posixPath } from "./cli-api.ts";
import type { FsDirEntry, FsPort, FsReadHandle, FsStat } from "./cli-api.ts";

/** One file the person picked. */
export interface PickedInput {
  name: string;
  blob: Blob;
}

/** One file a command wrote to /out, with its path inside /out. */
export interface OutFile {
  path: string;
  bytes: Uint8Array;
  mtimeMs: number;
}

/** The saved history, reached through the page: only this one blob, and nothing else. */
export interface StoreBridge {
  read(): Promise<Uint8Array | null>;
  write(bytes: Uint8Array): Promise<void>;
}

export interface VfsOptions {
  files: readonly PickedInput[];
  /** Most bytes /out may hold. */
  outCap: number;
  /** Most bytes /tmp may hold. Default 64 MiB. */
  tmpCap?: number;
  signal?: AbortSignal;
  store?: StoreBridge;
}

export interface Vfs {
  fs: FsPort;
  /** Everything written to /out so far, with paths relative to /out. */
  collectOut(): OutFile[];
}

export const LEDGER_FILE = "/app/.snappy/ledger.sealed";

const DEFAULT_TMP_CAP = 64 * 1024 * 1024;

/** A mount handles absolute, normalized paths that start at its own root. */
type Mount = Omit<FsPort, "setsFileTimes">;

const dir = (): FsStat => ({ isFile: false, isDirectory: true, size: 0, mtimeMs: 0 });

function deny(): never {
  throw new FsError("EACCES");
}

/** A name that is safe as one file name: no separators or NUL, never empty. */
function safeName(name: string): string {
  const cleaned = name.replace(/[\\/\0]/g, "_").trim();
  return cleaned === "" || cleaned === "." || cleaned === ".." ? "file" : cleaned;
}

/** "a.zip" taken twice becomes "a.zip" and "a (2).zip". */
function uniqueNames(inputs: readonly PickedInput[]): Map<string, Blob> {
  const out = new Map<string, Blob>();
  for (const input of inputs) {
    const base = safeName(input.name);
    let name = base;
    for (let n = 2; out.has(name); n++) {
      const dot = base.lastIndexOf(".");
      name = dot > 0 ? `${base.slice(0, dot)} (${n})${base.slice(dot)}` : `${base} (${n})`;
    }
    out.set(name, input.blob);
  }
  return out;
}

function blobHandle(blob: Blob, checkStop: () => void): FsReadHandle {
  return {
    size: blob.size,
    async read(start, end) {
      checkStop();
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > blob.size) {
        throw new RangeError("the file ended before the requested range");
      }
      return new Uint8Array(await blob.slice(start, end).arrayBuffer());
    },
    close: async () => undefined,
  };
}

function bytesHandle(bytes: Uint8Array, checkStop: () => void): FsReadHandle {
  return {
    size: bytes.length,
    async read(start, end) {
      checkStop();
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > bytes.length) {
        throw new RangeError("the file ended before the requested range");
      }
      return bytes.slice(start, end);
    },
    close: async () => undefined,
  };
}

/** /in: the picked files, flat and read only. */
function blobMount(root: string, files: Map<string, Blob>, checkStop: () => void): Mount {
  const nameOf = (path: string): string | undefined => {
    const rest = path.slice(root.length + 1);
    return rest === "" ? undefined : rest;
  };
  const lookup = (path: string): Blob => {
    const name = nameOf(path);
    if (name === undefined) throw new FsError("EISDIR");
    if (name.includes("/")) throw new FsError(files.has(name.split("/")[0] as string) ? "ENOTDIR" : "ENOENT");
    const blob = files.get(name);
    if (blob === undefined) throw new FsError("ENOENT");
    return blob;
  };
  return {
    async stat(path) {
      if (nameOf(path) === undefined) return dir();
      const blob = lookup(path);
      const modified = (blob as { lastModified?: number }).lastModified;
      return { isFile: true, isDirectory: false, size: blob.size, mtimeMs: typeof modified === "number" ? modified : 0 };
    },
    async readDir(path) {
      if (nameOf(path) !== undefined) {
        lookup(path);
        throw new FsError("ENOTDIR");
      }
      return [...files.keys()].map((name) => ({ name, isFile: true, isDirectory: false }));
    },
    async openRead(path) {
      return blobHandle(lookup(path), checkStop);
    },
    async readFile(path) {
      checkStop();
      return new Uint8Array(await lookup(path).arrayBuffer());
    },
    mkdir: async () => deny(),
    writeFileAtomic: async () => deny(),
    rename: async () => deny(),
    remove: async () => deny(),
    setMtime: async () => deny(),
    makeTempDir: async () => deny(),
  };
}

interface MemFile {
  bytes: Uint8Array;
  mtimeMs: number;
}

interface MemMount extends Mount {
  /** Files with paths relative to the mount root. */
  files(): OutFile[];
}

/** /out and /tmp: folders in memory with a byte cap. */
function memMount(root: string, cap: number, checkStop: () => void): MemMount {
  const files = new Map<string, MemFile>();
  const dirs = new Set<string>([root]);
  let used = 0;
  let tempCounter = 0;

  const parentOf = (path: string): string => posixPath.dirname(path);

  /** Make `path` and its parents folders. A file in the way is "not a folder". */
  const ensureDir = (path: string): void => {
    const missing: string[] = [];
    for (let p = path; !dirs.has(p); p = parentOf(p)) {
      if (files.has(p)) throw new FsError("ENOTDIR");
      missing.push(p);
    }
    for (const p of missing.reverse()) dirs.add(p);
  };

  const requireFile = (path: string): MemFile => {
    const file = files.get(path);
    if (file !== undefined) return file;
    throw new FsError(dirs.has(path) ? "EISDIR" : "ENOENT");
  };

  return {
    async stat(path) {
      checkStop();
      const file = files.get(path);
      if (file !== undefined) return { isFile: true, isDirectory: false, size: file.bytes.length, mtimeMs: file.mtimeMs };
      if (dirs.has(path)) return dir();
      throw new FsError("ENOENT");
    },
    async readDir(path) {
      checkStop();
      if (files.has(path)) throw new FsError("ENOTDIR");
      if (!dirs.has(path)) throw new FsError("ENOENT");
      const out: FsDirEntry[] = [];
      for (const d of dirs) if (d !== path && parentOf(d) === path) out.push({ name: posixPath.basename(d), isFile: false, isDirectory: true });
      for (const f of files.keys()) if (parentOf(f) === path) out.push({ name: posixPath.basename(f), isFile: true, isDirectory: false });
      return out;
    },
    async openRead(path) {
      checkStop();
      return bytesHandle(requireFile(path).bytes, checkStop);
    },
    async readFile(path) {
      checkStop();
      return requireFile(path).bytes;
    },
    async mkdir(path, opts) {
      checkStop();
      if (files.has(path)) throw new FsError("EEXIST");
      if (opts?.recursive === true) return ensureDir(path);
      if (dirs.has(path)) throw new FsError("EEXIST");
      if (!dirs.has(parentOf(path))) throw new FsError("ENOENT");
      dirs.add(path);
    },
    async writeFileAtomic(path, bytes) {
      checkStop();
      if (dirs.has(path)) throw new FsError("EISDIR");
      const old = files.get(path)?.bytes.length ?? 0;
      if (used - old + bytes.length > cap) throw new FsError("ENOSPC");
      ensureDir(parentOf(path));
      used += bytes.length - old;
      files.set(path, { bytes, mtimeMs: files.get(path)?.mtimeMs ?? 0 });
    },
    async rename(from, to) {
      checkStop();
      const file = requireFile(from);
      if (dirs.has(to)) throw new FsError("EISDIR");
      ensureDir(parentOf(to));
      used -= files.get(to)?.bytes.length ?? 0;
      files.delete(from);
      files.set(to, file);
    },
    async remove(path) {
      checkStop();
      const file = requireFile(path);
      used -= file.bytes.length;
      files.delete(path);
    },
    async setMtime(path, mtimeMs) {
      checkStop();
      requireFile(path).mtimeMs = mtimeMs;
      return true;
    },
    async makeTempDir(prefixPath) {
      checkStop();
      for (;;) {
        const path = `${prefixPath}${(++tempCounter).toString(36).padStart(6, "0")}`;
        if (dirs.has(path) || files.has(path)) continue;
        ensureDir(path);
        return path;
      }
    },
    files() {
      return [...files.entries()].map(([path, f]) => ({ path: path.slice(root.length + 1), bytes: f.bytes, mtimeMs: f.mtimeMs }));
    },
  };
}

/** /app: only the one sealed history file, read and written through the page. */
function storeMount(bridge: StoreBridge | undefined, checkStop: () => void): Mount {
  let cache: Uint8Array | null | undefined;
  const load = async (): Promise<Uint8Array | null> => {
    if (bridge === undefined) return null;
    if (cache === undefined) cache = await bridge.read();
    return cache;
  };
  const isDir = (path: string): boolean => path === "/app" || path === "/app/.snappy";
  const needLedger = async (path: string): Promise<Uint8Array> => {
    if (path !== LEDGER_FILE) throw new FsError(isDir(path) ? "EISDIR" : "ENOENT");
    const bytes = await load();
    if (bytes === null) throw new FsError("ENOENT");
    return bytes;
  };
  return {
    async stat(path) {
      checkStop();
      if (isDir(path)) return dir();
      const bytes = await needLedger(path);
      return { isFile: true, isDirectory: false, size: bytes.length, mtimeMs: 0 };
    },
    async readDir(path) {
      checkStop();
      if (path === "/app") return [{ name: ".snappy", isFile: false, isDirectory: true }];
      if (path === "/app/.snappy") return (await load()) === null ? [] : [{ name: "ledger.sealed", isFile: true, isDirectory: false }];
      throw new FsError(path === LEDGER_FILE ? "ENOTDIR" : "ENOENT");
    },
    async openRead(path) {
      checkStop();
      return bytesHandle(await needLedger(path), checkStop);
    },
    async readFile(path) {
      checkStop();
      return needLedger(path);
    },
    async mkdir(path, opts) {
      checkStop();
      if (isDir(path) && opts?.recursive === true) return;
      deny();
    },
    async writeFileAtomic(path, bytes) {
      checkStop();
      if (path !== LEDGER_FILE || bridge === undefined) deny();
      await bridge.write(bytes);
      cache = bytes;
    },
    rename: async () => deny(),
    remove: async () => deny(),
    setMtime: async () => deny(),
    makeTempDir: async () => deny(),
  };
}

export function createVfs(options: VfsOptions): Vfs {
  const checkStop = (): void => {
    if (options.signal?.aborted === true) throw new CliError("canceled", "Stopped. Nothing was changed.", 130);
  };

  const mounts = {
    "/in": blobMount("/in", uniqueNames(options.files), checkStop),
    "/out": memMount("/out", options.outCap, checkStop),
    "/tmp": memMount("/tmp", options.tmpCap ?? DEFAULT_TMP_CAP, checkStop),
    "/app": storeMount(options.store, checkStop),
  } as const;
  const roots = Object.keys(mounts) as (keyof typeof mounts)[];

  /** The normalized path and the mount it belongs to, or EACCES for anywhere else. */
  const route = (path: string): { path: string; mount: Mount; root: string } => {
    if (typeof path !== "string" || path.includes("\0")) throw new FsError("EACCES");
    const clean = posixPath.resolve(path);
    for (const root of roots) {
      if (clean === root || clean.startsWith(`${root}/`)) return { path: clean, mount: mounts[root], root };
    }
    throw new FsError("EACCES");
  };

  const fs: FsPort = {
    setsFileTimes: true,
    async stat(path) {
      checkStop();
      const clean = posixPath.resolve(path);
      if (clean === "/") return dir();
      const { path: p, mount } = route(path);
      return mount.stat(p);
    },
    async readDir(path) {
      checkStop();
      if (posixPath.resolve(path) === "/") return roots.map((r) => ({ name: r.slice(1), isFile: false, isDirectory: true }));
      const { path: p, mount } = route(path);
      return mount.readDir(p);
    },
    async openRead(path) {
      checkStop();
      const { path: p, mount } = route(path);
      return mount.openRead(p);
    },
    async readFile(path) {
      checkStop();
      const { path: p, mount } = route(path);
      return mount.readFile(p);
    },
    async mkdir(path, opts) {
      checkStop();
      const { path: p, mount } = route(path);
      return mount.mkdir(p, opts);
    },
    async writeFileAtomic(path, bytes, opts) {
      checkStop();
      const { path: p, mount } = route(path);
      return mount.writeFileAtomic(p, bytes, opts);
    },
    async rename(from, to) {
      checkStop();
      const a = route(from);
      const b = route(to);
      // A move never crosses from one place to another.
      if (a.root !== b.root) deny();
      return a.mount.rename(a.path, b.path);
    },
    async remove(path) {
      checkStop();
      const { path: p, mount } = route(path);
      return mount.remove(p);
    },
    async setMtime(path, mtimeMs) {
      checkStop();
      const { path: p, mount } = route(path);
      return mount.setMtime(p, mtimeMs);
    },
    async makeTempDir(prefixPath) {
      checkStop();
      const { path: p, mount } = route(prefixPath);
      return mount.makeTempDir(p);
    },
  };

  return { fs, collectOut: () => mounts["/out"].files() };
}
