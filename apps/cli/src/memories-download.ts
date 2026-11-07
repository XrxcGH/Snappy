/**
 * The ONLY module in the CLI that uses the network, and only for `snappy-export memories --download`.
 * It contacts nothing except the links the user's own export contains.
 *
 * Privacy rules enforced here:
 *  - a download link is never printed, logged, put in an error, or written to disk. Failures are
 *    reduced to a short fixed code ("network", "http-403", "timeout", ...);
 *  - only https links are followed, and so is every redirect they answer with: redirects are
 *    handled here, one hop at a time, so a plain-http or non-public destination is refused;
 *  - a link may not point at a bare IP address, localhost or a private-network name;
 *  - the response is streamed to a ".part" file and only renamed by the caller once complete;
 *  - the bytes are opaque: nothing here decodes or inspects media.
 */
import { open, unlink } from "node:fs/promises";

/** The network, as the downloader needs it. Tests pass a fake; production uses the global. */
export type Transport = (url: string, init: { signal: AbortSignal; redirect: "manual" }) => Promise<Response>;

/** Printed once, before the first download, in plain language. */
export const DOWNLOAD_NOTICE: readonly string[] = [
  "Heads up: this is the only Snappy command that uses the network.",
  "It contacts only the links inside your own export, to download your Memories to this computer.",
  "If a link forwards to another secure (https) address, Snappy follows it; anything else is refused. Snappy sends nothing else and never prints or saves those links. If a link has expired, you will see a failure for that item.",
];

/**
 * Stable failure codes. A code never contains the link or any response text. "bad-link" covers a
 * link, or a redirect it answered with, that Snappy refuses to follow.
 */
export type DownloadFailure = "network" | "timeout" | "bad-link" | "not-media" | "disk" | `http-${number}`;

export class DownloadError extends Error {
  readonly code: DownloadFailure;
  /** How long the server asked us to wait (Retry-After), when it said. */
  readonly retryAfterMs?: number;

  constructor(code: DownloadFailure, retryAfterMs?: number) {
    super(code); // the code IS the message: nothing else may leak into it
    this.name = "DownloadError";
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

export interface DownloadOptions {
  transport?: Transport;
  /** The request fails when no bytes arrive for this long. Default 30 s. */
  idleTimeoutMs?: number;
  /** Retries after the first attempt. Default 3. */
  retries?: number;
  /** First retry delay; it doubles each time. Default 500 ms. */
  backoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const MAX_BACKOFF_MS = 8_000;
/** A server's Retry-After is honored up to this long; longer asks fail the item so the run can finish. */
const MAX_RETRY_AFTER_MS = 30_000;
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
/** Names that only resolve on a private network. */
const PRIVATE_NAME = /(?:^|\.)(?:localhost|local|internal|lan|home|corp|intranet|home\.arpa)$/;

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Content types that mean an error page or API reply, not a photo or video. */
const NOT_MEDIA_TYPE = /^(?:text\/|application\/(?:json|xml|xhtml|problem))|html|xml/i;

/** Network trouble, timeouts and server-side errors may clear up; a 403 or 404 will not. */
function isRetryable(code: DownloadFailure): boolean {
  if (code === "network" || code === "timeout") return true;
  if (code.startsWith("http-")) {
    const status = Number(code.slice(5));
    return status === 429 || status >= 500;
  }
  return false;
}

/**
 * True for a link Snappy will contact: https, no embedded credentials, and a public-looking host
 * name. Bare IP addresses (the URL parser turns every numeric spelling into dotted decimal or
 * brackets), localhost and private-network names are refused, so a crafted export cannot make
 * Snappy knock on the user's router or other machines.
 */
export function isFollowable(target: URL): boolean {
  if (target.protocol !== "https:" || target.username !== "" || target.password !== "") return false;
  const host = target.hostname.toLowerCase().replace(/\.$/, "");
  if (host === "" || host.startsWith("[") || /^[\d.]+$/.test(host)) return false;
  return host.includes(".") && !PRIVATE_NAME.test(host);
}

/** Retry-After as a whole number of seconds (the form CDNs use), in milliseconds; undefined otherwise. */
function retryAfterMs(response: Response): number | undefined {
  const raw = response.headers.get("retry-after")?.trim();
  if (raw === undefined || !/^\d{1,6}$/.test(raw)) return undefined;
  return Number(raw) * 1000;
}

/**
 * Download `url` into `partPath` (created or replaced). Resolves with the byte count; rejects
 * with a DownloadError. The partial file is removed on failure.
 */
export async function downloadToFile(url: string, partPath: string, opts: DownloadOptions = {}): Promise<number> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    throw new DownloadError("bad-link");
  }
  if (!isFollowable(target)) throw new DownloadError("bad-link");

  const transport: Transport = opts.transport ?? ((u, init) => globalThis.fetch(u, init));
  const retries = opts.retries ?? 3;
  const sleep = opts.sleep ?? realSleep;

  for (let attempt = 0; ; attempt++) {
    try {
      return await attemptOnce(target.href, partPath, transport, opts.idleTimeoutMs ?? 30_000);
    } catch (e) {
      await unlink(partPath).catch(() => undefined);
      const failure = e instanceof DownloadError ? e : new DownloadError("network");
      if (attempt >= retries || !isRetryable(failure.code)) throw failure;
      const backoff = Math.min(MAX_BACKOFF_MS, (opts.backoffMs ?? 500) * 2 ** attempt);
      const asked = failure.retryAfterMs;
      if (asked !== undefined && asked > MAX_RETRY_AFTER_MS) throw failure;
      await sleep(Math.max(backoff, asked ?? 0));
    }
  }
}

async function attemptOnce(url: string, partPath: string, transport: Transport, idleMs: number): Promise<number> {
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // An idle timer, re-armed on every chunk: a slow but moving download is fine, a stalled one is not.
  const arm = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, idleMs);
  };

  arm();
  try {
    // Even a transport that ignores the signal cannot hold the download past its idle timeout.
    const aborted = new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
    aborted.catch(() => undefined);
    let response: Response;
    let reader: ReadableStreamDefaultReader<Uint8Array>;
    try {
      let current = url;
      for (let hop = 0; ; hop++) {
        response = await Promise.race([transport(current, { signal: controller.signal, redirect: "manual" }), aborted]);
        if (!REDIRECT_STATUSES.has(response.status)) break;
        await response.body?.cancel().catch(() => undefined);
        let next: URL | undefined;
        try {
          next = new URL(response.headers.get("location") ?? "", current);
        } catch {
          next = undefined;
        }
        if (next === undefined || hop >= MAX_REDIRECTS || !isFollowable(next)) throw new DownloadError("bad-link");
        current = next.href;
      }
      if (!response.ok) {
        const wait = response.status === 429 || response.status === 503 ? retryAfterMs(response) : undefined;
        await response.body?.cancel().catch(() => undefined);
        throw new DownloadError(`http-${response.status}`, wait);
      }
      // An expired link often answers 200 with a small HTML or JSON page. Media never has these types.
      if (NOT_MEDIA_TYPE.test(response.headers.get("content-type") ?? "")) {
        await response.body?.cancel().catch(() => undefined);
        throw new DownloadError("not-media");
      }
      if (!response.body) throw new DownloadError("network");
      reader = response.body.getReader();
    } catch (e) {
      throw e instanceof DownloadError ? e : new DownloadError(timedOut ? "timeout" : "network");
    }

    let file;
    try {
      file = await open(partPath, "w", 0o600);
    } catch {
      await reader.cancel().catch(() => undefined);
      throw new DownloadError("disk");
    }
    let total = 0;
    try {
      for (;;) {
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
          chunk = await Promise.race([reader.read(), aborted]);
        } catch {
          await reader.cancel().catch(() => undefined);
          throw new DownloadError(timedOut ? "timeout" : "network");
        }
        if (chunk.done) break;
        arm();
        try {
          await file.write(chunk.value);
        } catch {
          await reader.cancel().catch(() => undefined);
          throw new DownloadError("disk");
        }
        total += chunk.value.byteLength;
      }
    } finally {
      await file.close().catch(() => undefined);
    }
    if (total === 0) throw new DownloadError("not-media");
    return total;
  } finally {
    clearTimeout(timer);
  }
}
