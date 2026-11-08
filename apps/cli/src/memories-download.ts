/**
 * The ONLY module in the CLI that uses the network, and only for `snappy-export memories --download`.
 * It contacts nothing except the links the user's own export contains.
 *
 * Privacy rules enforced here:
 *  - a download link is never printed, logged, put in an error, or written to disk. Failures are
 *    reduced to a short fixed code ("network", "http-403", "timeout", ...);
 *  - only https links are followed, and so is every redirect they answer with: redirects are
 *    handled here, one hop at a time, so a plain-http or non-public destination is refused;
 *  - a link may not point at a bare IP address, localhost or a private-network name, and a public
 *    looking name is looked up before every request (the first link and each redirect): if any
 *    address it answers with is loopback, link-local, private or otherwise not a public internet
 *    address, the link is refused, so an edited export cannot aim Snappy at the person's router,
 *    other machines or local services through a name that merely looks public;
 *  - the response is streamed to a ".part" file and only renamed by the caller once complete;
 *  - the bytes are opaque: nothing here decodes or inspects media.
 */
import { lookup } from "node:dns/promises";
import { open, unlink } from "node:fs/promises";
import { BlockList, isIP } from "node:net";

/** The network, as the downloader needs it. Tests pass a fake; production uses the global. */
export type Transport = (url: string, init: { signal: AbortSignal; redirect: "manual" }) => Promise<Response>;

/** Printed once, before the first download, in plain language. */
export const DOWNLOAD_NOTICE: readonly string[] = [
  "This is the only Snappy command that uses the network.",
  "It contacts only the links in your own export, to download your Memories here.",
  "Snappy first checks where each link leads and refuses any that point at your own computer or network.",
  "A link that forwards to another secure (https) address is followed. Snappy never prints or saves the links.",
  "An expired link shows as a failed item.",
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
  /**
   * The addresses a host name leads to. Production uses the system resolver. When a `transport`
   * is injected (tests) and no resolver is, the check is skipped: that transport makes no connection.
   */
  resolve?: (host: string) => Promise<readonly string[]>;
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

/** IPv4 ranges that are never a public internet host. */
const NON_PUBLIC_V4: readonly (readonly [string, number])[] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
];
/** IPv6 ranges inside 2000::/3 that still do not lead to a public host (tunnels, documentation, 6to4). */
const NON_PUBLIC_V6: readonly (readonly [string, number])[] = [
  ["2001::", 32],
  ["2001:db8::", 32],
  ["2002::", 16],
];

const blockedV4 = new BlockList();
for (const [net, bits] of NON_PUBLIC_V4) blockedV4.addSubnet(net, bits, "ipv4");
const blockedV6 = new BlockList();
for (const [net, bits] of NON_PUBLIC_V6) blockedV6.addSubnet(net, bits, "ipv6");
const globalUnicastV6 = new BlockList();
globalUnicastV6.addSubnet("2000::", 3, "ipv6");

/** True only for an address on the public internet. Anything unparseable or unusual is not. */
function isPublicAddress(address: string): boolean {
  const kind = isIP(address);
  if (kind === 4) return !blockedV4.check(address, "ipv4");
  if (kind !== 6) return false;
  // An IPv4 address wearing an IPv6 coat (::ffff:127.0.0.1 or ::ffff:7f00:1) is judged as the IPv4 one.
  const mapped = /^(?:::|(?:0{1,4}:){5})ffff:(.+)$/i.exec(address);
  if (mapped !== null) {
    const tail = mapped[1] as string;
    if (isIP(tail) === 4) return isPublicAddress(tail);
    const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(tail);
    if (hex === null) return false;
    const hi = Number.parseInt(hex[1] as string, 16);
    const lo = Number.parseInt(hex[2] as string, 16);
    return isPublicAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  return globalUnicastV6.check(address, "ipv6") && !blockedV6.check(address, "ipv6");
}

/** Every address the system resolver gives for a host name. */
async function systemResolve(host: string): Promise<readonly string[]> {
  return (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);
}

/** Throws "bad-link" unless every address the host leads to is on the public internet. */
async function requirePublicHost(target: string, resolve: (host: string) => Promise<readonly string[]>, aborted: Promise<never>): Promise<void> {
  const host = new URL(target).hostname.replace(/\.$/, "");
  const addresses = await Promise.race([resolve(host), aborted]);
  if (addresses.length === 0) throw new DownloadError("network");
  if (!addresses.every(isPublicAddress)) throw new DownloadError("bad-link");
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
  const resolve = opts.resolve ?? (opts.transport === undefined ? systemResolve : undefined);

  for (let attempt = 0; ; attempt++) {
    try {
      return await attemptOnce(target.href, partPath, transport, opts.idleTimeoutMs ?? 30_000, resolve);
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

async function attemptOnce(
  url: string,
  partPath: string,
  transport: Transport,
  idleMs: number,
  resolve: ((host: string) => Promise<readonly string[]>) | undefined,
): Promise<number> {
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
        if (resolve !== undefined) await requirePublicHost(current, resolve, aborted);
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
