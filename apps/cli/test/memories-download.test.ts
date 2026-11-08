import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DOWNLOAD_NOTICE, DownloadError, downloadToFile } from "../src/memories-download.ts";
import type { Transport } from "../src/memories-download.ts";
import { tempDir } from "./helpers.ts";

const LINK = "https://demo.snappy.invalid/media/secret-token-zq?sig=abc123";
const MEDIA = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

const ok = (body: Uint8Array = MEDIA, type = "image/jpeg"): Response => new Response(new Uint8Array(body), { status: 200, headers: { "content-type": type } });
const status = (code: number): Response => new Response("nope", { status: code });
const noSleep = async (): Promise<void> => undefined;

/** A transport that answers from a script, one entry per call (the last repeats). */
function scripted(...steps: (Response | Error | (() => Response | Promise<Response>))[]): { transport: Transport; calls: () => number } {
  let calls = 0;
  const transport: Transport = async () => {
    const step = steps[Math.min(calls++, steps.length - 1)] as (typeof steps)[number];
    if (step instanceof Error) throw step;
    return typeof step === "function" ? step() : step;
  };
  return { transport, calls: () => calls };
}

async function failureOf(promise: Promise<unknown>): Promise<DownloadError> {
  const e = await promise.then(() => undefined, (x: unknown) => x);
  expect(e).toBeInstanceOf(DownloadError);
  return e as DownloadError;
}

describe("downloadToFile", () => {
  it("streams the body to the part file and reports the size", async () => {
    const part = join(tempDir("dl"), "a.jpg.part");
    const { transport } = scripted(ok());
    expect(await downloadToFile(LINK, part, { transport, sleep: noSleep })).toBe(MEDIA.length);
    expect([...readFileSync(part)]).toEqual([...MEDIA]);
  });

  it("handles redirects itself, one hop at a time, so each can be checked", async () => {
    let seen: { redirect?: string } = {};
    const transport: Transport = async (_url, init) => ((seen = init), ok());
    await downloadToFile(LINK, join(tempDir("dl"), "a.part"), { transport, sleep: noSleep });
    expect(seen.redirect).toBe("manual");
  });

  it("does not retry a 403 or 404: expired links will not come back", async () => {
    const dir = tempDir("dl");
    for (const code of [403, 404, 410]) {
      const s = scripted(status(code));
      const e = await failureOf(downloadToFile(LINK, join(dir, "x.part"), { transport: s.transport, sleep: noSleep }));
      expect(e.code).toBe(`http-${code}`);
      expect(s.calls()).toBe(1);
    }
  });

  it("retries server errors, rate limits and network failures with backoff, then succeeds", async () => {
    const delays: number[] = [];
    const s = scripted(status(503), status(429), new TypeError(`fetch failed ${LINK}`), ok());
    const part = join(tempDir("dl"), "r.part");
    await downloadToFile(LINK, part, { transport: s.transport, sleep: async (ms) => void delays.push(ms), backoffMs: 100 });
    expect(s.calls()).toBe(4);
    expect(delays).toEqual([100, 200, 400]);
    expect(readFileSync(part).length).toBe(MEDIA.length);
  });

  it("gives up after three retries and removes the partial file", async () => {
    const part = join(tempDir("dl"), "g.part");
    const s = scripted(status(500));
    const e = await failureOf(downloadToFile(LINK, part, { transport: s.transport, sleep: noSleep }));
    expect(e.code).toBe("http-500");
    expect(s.calls()).toBe(4);
    expect(existsSync(part)).toBe(false);
  });

  it("classifies network errors without keeping their text, which can contain the link", async () => {
    const s = scripted(new TypeError(`fetch failed: getaddrinfo ENOTFOUND demo.snappy.invalid ${LINK}`));
    const e = await failureOf(downloadToFile(LINK, join(tempDir("dl"), "n.part"), { transport: s.transport, sleep: noSleep, retries: 1 }));
    expect(e.code).toBe("network");
    expect(e.message).toBe("network");
    expect(JSON.stringify(e)).not.toContain("invalid");
    expect(s.calls()).toBe(2);
  });

  it("times out a stalled download", async () => {
    const stalled: Transport = (_url, init) =>
      new Promise<Response>((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    const e = await failureOf(downloadToFile(LINK, join(tempDir("dl"), "t.part"), { transport: stalled, sleep: noSleep, idleTimeoutMs: 20, retries: 0 }));
    expect(e.code).toBe("timeout");
  });

  it("times out when the body stops mid-stream", async () => {
    const stream = new ReadableStream<Uint8Array>({ start: (c) => c.enqueue(MEDIA) });
    const transport: Transport = async () => new Response(stream, { headers: { "content-type": "video/mp4" } });
    const e = await failureOf(downloadToFile(LINK, join(tempDir("dl"), "m.part"), { transport, sleep: noSleep, idleTimeoutMs: 20, retries: 0 }));
    expect(e.code).toBe("timeout");
  });

  it("rejects HTML or JSON error pages and empty bodies even with status 200", async () => {
    const dir = tempDir("dl");
    for (const type of ["text/html; charset=utf-8", "application/json", "application/xml"]) {
      const e = await failureOf(downloadToFile(LINK, join(dir, "h.part"), { transport: scripted(ok(new TextEncoder().encode("<html>expired</html>"), type)).transport, sleep: noSleep }));
      expect(e.code).toBe("not-media");
    }
    const empty = await failureOf(downloadToFile(LINK, join(dir, "e.part"), { transport: scripted(ok(new Uint8Array(0))).transport, sleep: noSleep }));
    expect(empty.code).toBe("not-media");
    expect(existsSync(join(dir, "h.part"))).toBe(false);
  });

  it("only follows https links", async () => {
    const s = scripted(ok());
    for (const bad of ["http://demo.snappy.invalid/a", "file:///etc/passwd", "ftp://x/y", "not a url", ""]) {
      const e = await failureOf(downloadToFile(bad, join(tempDir("dl"), "b.part"), { transport: s.transport, sleep: noSleep }));
      expect(e.code).toBe("bad-link");
    }
    expect(s.calls()).toBe(0);
  });

  describe("where a public-looking name leads", () => {
    const resolvesTo = (...addresses: string[]) => async (): Promise<readonly string[]> => addresses;
    const attempt = async (resolve: (host: string) => Promise<readonly string[]>, s = scripted(ok())) => {
      const e = await downloadToFile(LINK, join(tempDir("dl"), "p.part"), { transport: s.transport, sleep: noSleep, resolve, retries: 0 }).then(
        () => undefined,
        (x: unknown) => x,
      );
      return { error: e as DownloadError | undefined, calls: s.calls() };
    };

    it("refuses a name that resolves to this computer, without sending anything", async () => {
      const { error, calls } = await attempt(resolvesTo("127.0.0.1"));
      expect(error).toBeInstanceOf(DownloadError);
      expect(error?.code).toBe("bad-link");
      expect(calls).toBe(0);
    });

    it("refuses private, link-local, shared, multicast and documentation addresses", async () => {
      const blocked = ["0.0.0.0", "10.1.2.3", "100.64.0.1", "127.255.255.254", "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.168.1.1", "198.18.0.1", "224.0.0.1", "255.255.255.255"];
      for (const address of blocked) expect((await attempt(resolvesTo(address))).error?.code, address).toBe("bad-link");
    });

    it("refuses IPv6 loopback, unique-local, link-local, unspecified and IPv4 wrapped in IPv6", async () => {
      const blocked = ["::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:192.168.0.10", "0:0:0:0:0:ffff:a00:1", "2002:7f00:1::1", "2001:db8::1"];
      for (const address of blocked) expect((await attempt(resolvesTo(address))).error?.code, address).toBe("bad-link");
    });

    it("refuses when any one of several answers is not public", async () => {
      expect((await attempt(resolvesTo("93.184.216.34", "10.0.0.5"))).error?.code).toBe("bad-link");
    });

    it("follows a name that leads to public addresses, IPv4 and IPv6", async () => {
      for (const answer of [["93.184.216.34"], ["2606:2800:220:1:248:1893:25c8:1946"], ["8.8.8.8", "2001:4860:4860::8888"], ["::ffff:93.184.216.34"]]) {
        const { error, calls } = await attempt(resolvesTo(...answer));
        expect(error, answer.join(",")).toBeUndefined();
        expect(calls).toBe(1);
      }
    });

    it("checks every hop: a redirect to a name that leads inside is refused", async () => {
      const redirect = new Response(null, { status: 302, headers: { location: "https://cdn.snappy.invalid/next" } });
      const s = scripted(redirect, ok());
      const seen: string[] = [];
      const resolve = async (host: string): Promise<readonly string[]> => {
        seen.push(host);
        return host === "cdn.snappy.invalid" ? ["192.168.0.1"] : ["93.184.216.34"];
      };
      const { error, calls } = await attempt(resolve, s);
      expect(error?.code).toBe("bad-link");
      expect(seen).toEqual(["demo.snappy.invalid", "cdn.snappy.invalid"]);
      expect(calls).toBe(1);
    });

    it("treats a resolver that fails or answers nothing as a network failure, with no text kept", async () => {
      const empty = await attempt(resolvesTo());
      expect(empty.error?.code).toBe("network");
      const broken = await attempt(async () => {
        throw new Error(`getaddrinfo ENOTFOUND demo.snappy.invalid ${LINK}`);
      });
      expect(broken.error?.code).toBe("network");
      expect(JSON.stringify(broken.error)).not.toContain("invalid");
      expect(broken.error?.message).toBe("network");
    });

    it("gives up on a resolver that never answers, at the idle timeout", async () => {
      const hang = (): Promise<readonly string[]> => new Promise(() => undefined);
      const e = await downloadToFile(LINK, join(tempDir("dl"), "h.part"), { transport: scripted(ok()).transport, sleep: noSleep, resolve: hang, idleTimeoutMs: 20, retries: 0 }).then(
        () => undefined,
        (x: unknown) => x,
      );
      expect((e as DownloadError).code).toBe("timeout");
    });
  });

  it("explains itself in plain language before downloading", () => {
    const notice = DOWNLOAD_NOTICE.join(" ");
    expect(notice).toMatch(/only Snappy command that uses the network/);
    expect(notice).toMatch(/only the links in your own export/);
    expect(notice).toMatch(/refuses any that point at your own computer or network/);
    expect(notice).not.toContain("!");
  });
});
