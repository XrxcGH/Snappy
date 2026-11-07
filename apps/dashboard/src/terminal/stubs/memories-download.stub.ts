/**
 * Stands in for the command line's downloader inside the app's helper. The real one is the only
 * module that uses the network, and the app makes no connection at all, so the helper is built
 * without it: this module has the same names and can only refuse. The build swaps it in; the
 * `satisfies` line below makes the compiler catch any drift from the real module.
 */

type Real = typeof import("../../../../cli/src/memories-download.ts");

export type Transport = import("../../../../cli/src/memories-download.ts").Transport;
export type DownloadFailure = import("../../../../cli/src/memories-download.ts").DownloadFailure;
export type DownloadOptions = import("../../../../cli/src/memories-download.ts").DownloadOptions;

export const DOWNLOAD_NOTICE: readonly string[] = [];

export class DownloadError extends Error {
  readonly code: DownloadFailure;
  readonly retryAfterMs?: number;

  constructor(code: DownloadFailure, retryAfterMs?: number) {
    super(code);
    this.name = "DownloadError";
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

export const isFollowable = (): boolean => false;

export async function downloadToFile(): Promise<number> {
  throw new DownloadError("bad-link");
}

void ({ DOWNLOAD_NOTICE, DownloadError, isFollowable, downloadToFile } satisfies Real);
