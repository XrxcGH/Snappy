/**
 * The ports a command reaches the outside world through: a file system, path rules and a lock.
 * Commands never import node:fs or node:path. The terminal in the dashboard supplies a virtual
 * file system and a POSIX path port; the command line supplies the real ones (node-ports.ts).
 *
 * This file holds types and one error class. It imports nothing from node: and no DOM types, so
 * the same commands run in Node and in a browser worker.
 */
import type { RandomAccessReader } from "@snappy-export/core";

export type FsErrorCode = "ENOENT" | "EACCES" | "EPERM" | "EEXIST" | "ENOTDIR" | "EISDIR" | "ENOSPC" | "EBUSY" | "EIO";

/**
 * An errno-style failure. `.code` lets the existing fsError() map it to a calm message; the
 * message is the fixed code, never a path.
 */
export class FsError extends Error {
  readonly code: FsErrorCode;

  constructor(code: FsErrorCode) {
    super(code);
    this.name = "FsError";
    this.code = code;
  }
}

export interface FsStat {
  isFile: boolean;
  isDirectory: boolean;
  size: number;
  mtimeMs: number;
}

export interface FsDirEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
}

/** A random-access reader over one open file: `size` and `read(start, end)`, plus `close`. */
export interface FsReadHandle extends RandomAccessReader {
  close(): Promise<void>;
}

export interface FsPort {
  /** True when setMtime really sets a file time (Node: yes; the in-app output folder records it for the .zip). */
  readonly setsFileTimes: boolean;
  stat(path: string): Promise<FsStat>;
  readDir(path: string): Promise<FsDirEntry[]>;
  openRead(path: string): Promise<FsReadHandle>;
  readFile(path: string): Promise<Uint8Array>;
  mkdir(path: string, opts?: { recursive?: boolean }): Promise<void>;
  /** All or nothing: readers see the old file or the whole new one. Creates parent folders. `durable` defaults to true (fsync). */
  writeFileAtomic(path: string, bytes: Uint8Array, opts?: { durable?: boolean }): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  /** Files only, never a folder. */
  remove(path: string): Promise<void>;
  /** Set a file's modification time. False when this file system cannot. */
  setMtime(path: string, mtimeMs: number): Promise<boolean>;
  /** Create a new, empty folder named from `prefixPath` plus a unique suffix, and return its path. */
  makeTempDir(prefixPath: string): Promise<string>;
}

export interface PathPort {
  readonly sep: string;
  resolve(...parts: string[]): string;
  join(...parts: string[]): string;
  dirname(path: string): string;
  basename(path: string): string;
  relative(from: string, to: string): string;
  isAbsolute(path: string): boolean;
}

export interface LockPort {
  /**
   * Run `work` while holding the named lock. The adapter raises CliError("ledger-busy") when the
   * lock cannot be taken within `waitMs`.
   */
  withLock<T>(name: string, opts: { waitMs: number }, work: () => Promise<T>): Promise<T>;
}

export interface Limits {
  /** Largest bundled file a command reads into memory in one piece. */
  maxBundledBytes: number;
}
