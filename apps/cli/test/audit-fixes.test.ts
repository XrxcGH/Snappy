/**
 * Regression tests for defects found in review: where the downloader may go, terminal escapes
 * in usernames, passphrase files saved by Windows editors, concurrent ledger writers, how the
 * Memories writer reports dates, and a few calm-error cases. Synthetic data only.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { buildSyntheticExport } from "@snappy-export/core";
import { parseFlags } from "../src/args.ts";
import { resolveZipPaths } from "../src/inputs.ts";
import { loadAllowlist, withLedgerLock } from "../src/ledger-store.ts";
import { DownloadError, downloadToFile, isFollowable } from "../src/memories-download.ts";
import type { Transport } from "../src/memories-download.ts";
import { placeMedia } from "../src/memories-write.ts";
import { resolvePassphrase } from "../src/prompt.ts";
import { createTerm, printable } from "../src/term.ts";
import { LATER, NOW, makeIo, run, tempDir, writeSyntheticZip } from "./helpers.ts";

const LINK = "https://demo.snappy.invalid/media/a?sig=abc";
const MEDIA = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const ok = (): Response => new Response(new Uint8Array(MEDIA), { status: 200, headers: { "content-type": "image/jpeg" } });
const redirect = (to: string, status = 302): Response => new Response(null, { status, headers: { location: to } });
const noSleep = async (): Promise<void> => undefined;

async function codeOf(promise: Promise<unknown>): Promise<string> {
  const e = await promise.then(() => undefined, (x: unknown) => x);
  expect(e).toBeInstanceOf(DownloadError);
  return (e as DownloadError).code;
}

describe("downloads stay on secure, public addresses", () => {
  it("never asks the transport to follow redirects itself", async () => {
    let seen = "";
    const transport: Transport = async (_u, init) => ((seen = init.redirect), ok());
    await downloadToFile(LINK, join(tempDir("dl"), "a.part"), { transport, sleep: noSleep });
    expect(seen).toBe("manual");
  });

  it("follows a redirect to another https address, one hop at a time", async () => {
    const asked: string[] = [];
    const transport: Transport = async (url) => (asked.push(url), asked.length === 1 ? redirect("https://cdn.snappy.invalid/blob/1") : ok());
    const part = join(tempDir("dl"), "a.part");
    expect(await downloadToFile(LINK, part, { transport, sleep: noSleep })).toBe(MEDIA.length);
    expect(asked).toEqual([LINK, "https://cdn.snappy.invalid/blob/1"]);
  });

  it.each([
    ["a downgrade to plain http", "http://cdn.snappy.invalid/blob"],
    ["a loopback address", "https://127.0.0.1:8443/admin"],
    ["a private network address", "https://192.168.1.1/"],
    ["an IPv6 address", "https://[::1]/"],
    ["localhost", "https://localhost/x"],
    ["a single-label name", "https://router/x"],
    ["a .local name", "https://printer.local/x"],
    ["an address with a password", "https://user:pw@cdn.snappy.invalid/x"],
    ["another scheme", "file:///etc/passwd"],
  ])("refuses a redirect to %s without contacting it", async (_label, target) => {
    let calls = 0;
    const transport: Transport = async () => (calls++, redirect(target));
    const part = join(tempDir("dl"), "r.part");
    expect(await codeOf(downloadToFile(LINK, part, { transport, sleep: noSleep }))).toBe("bad-link");
    expect(calls).toBe(1);
    expect(existsSync(part)).toBe(false);
  });

  it("refuses a link in the export that points at an IP address or a private name, before any request", async () => {
    let calls = 0;
    const transport: Transport = async () => (calls++, ok());
    for (const bad of ["https://127.0.0.1:9/", "https://10.0.0.5/x", "https://0x7f.1/", "https://localhost/", "https://nas.internal/x"]) {
      expect(await codeOf(downloadToFile(bad, join(tempDir("dl"), "b.part"), { transport, sleep: noSleep })), bad).toBe("bad-link");
    }
    expect(calls).toBe(0);
  });

  it("gives up on a redirect loop", async () => {
    let calls = 0;
    const transport: Transport = async () => (calls++, redirect(LINK));
    expect(await codeOf(downloadToFile(LINK, join(tempDir("dl"), "l.part"), { transport, sleep: noSleep }))).toBe("bad-link");
    expect(calls).toBeLessThanOrEqual(7);
  });

  it("recognizes followable links", () => {
    expect(isFollowable(new URL(LINK))).toBe(true);
    expect(isFollowable(new URL("https://storage.snappy.invalid./x"))).toBe(true);
    expect(isFollowable(new URL("http://storage.snappy.invalid/x"))).toBe(false);
  });
});

describe("downloads honor Retry-After", () => {
  const limited = (seconds: string): Response => new Response("slow down", { status: 429, headers: { "retry-after": seconds } });

  it("waits as long as the server asked, when that is reasonable", async () => {
    const delays: number[] = [];
    let calls = 0;
    const transport: Transport = async () => (calls++ === 0 ? limited("2") : ok());
    await downloadToFile(LINK, join(tempDir("dl"), "a.part"), { transport, sleep: async (ms) => void delays.push(ms), backoffMs: 100 });
    expect(delays).toEqual([2000]);
  });

  it("fails the item at once when the server asks for a very long wait", async () => {
    let calls = 0;
    const transport: Transport = async () => (calls++, limited("3600"));
    expect(await codeOf(downloadToFile(LINK, join(tempDir("dl"), "a.part"), { transport, sleep: noSleep }))).toBe("http-429");
    expect(calls).toBe(1);
  });
});

describe("printable", () => {
  it("replaces escape sequences, control characters and text-reordering characters", () => {
    expect(printable("evil\u001b]0;pwned\u0007\u001b[2Jx")).toBe("evil?]0;pwned??[2Jx");
    expect(printable("bob‮evil​")).toBe("bob?evil?");
    expect(printable("plain_name.1")).toBe("plain_name.1");
  });

  it("keeps every table cell free of raw escapes while the table's own color still works", () => {
    const term = createTerm({ env: {}, isTTY: true, columns: 80, noColorFlag: false });
    const lines = term.table([{ header: "Friend" }, { header: "Confidence" }], [["evil\u001b[2J\u001b]0;x\u0007", term.confidence("high")]]);
    const text = lines.join("\n");
    expect(text).toContain("evil?");
    expect(stripVTControlCharacters(text)).toBe(text.replace(/\u001b\[[0-9;]*m/g, ""));
    expect(text).not.toContain("\u001b[2J");
    expect(text).not.toContain("\u0007");
  });

  it("wraps a long wrapping cell onto more lines instead of cutting it off", () => {
    const term = createTerm({ env: {}, isTTY: false, columns: 60 });
    const why = "The most recent saved one-to-one chat activity with this friend is from Jun 2, 2023 (1,191 days before the export).";
    const lines = term.table([{ header: "Friend" }, { header: "Why", flex: true, wrap: true }], [["sam_01", why], ["al", "short"]]);
    expect(lines.every((l) => Array.from(l).length + 2 <= 60)).toBe(true);
    const joined = lines.slice(2).join(" ").replace(/\s+/g, " ");
    expect(joined).toContain("1,191 days before the export).");
    expect(joined).not.toContain("…");
    expect(lines.some((l) => l.endsWith(" "))).toBe(false);
  });

  it("does not let a hostile username reach the analysis table raw", async () => {
    const evil = "evil\u001b]0;pwned\u0007\u001b[2Jx";
    const friends = {
      Friends: [{ Username: "anchor_one", "Creation Timestamp": "2020-01-01 10:00:00 UTC" }],
      "Friend Requests Sent": [{ Username: evil, "Creation Timestamp": "2023-01-01 10:00:00 UTC" }],
    };
    const zip = join(tempDir("evil"), "export.zip");
    writeFileSync(zip, zipSync({ "json/friends.json": [new TextEncoder().encode(JSON.stringify(friends)), { mtime: new Date(LATER) }] }));
    const { code, out } = await run(["analyze", zip, "--no-save"]);
    expect(code).toBe(0);
    expect(out).toContain("evil?]0;pwned");
    expect(out).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f]/);
  });
});

describe("passphrase files saved by Windows editors", () => {
  const read = async (bytes: Uint8Array): Promise<string> => {
    const file = join(tempDir("pass"), "p.txt");
    writeFileSync(file, bytes);
    return resolvePassphrase(makeIo(), { file, creating: false });
  };

  it("drops a UTF-8 byte order mark", async () => {
    expect(await read(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("correct horse battery\r\n")]))).toBe("correct horse battery");
  });

  it("decodes UTF-16 with a byte order mark, as PowerShell 5.1 writes it", async () => {
    expect(await read(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("correct horse battery\r\n", "utf16le")]))).toBe("correct horse battery");
    const be = Buffer.from("correct horse battery\n", "utf16le").swap16();
    expect(await read(Buffer.concat([Buffer.from([0xfe, 0xff]), be]))).toBe("correct horse battery");
  });

  it("uses only the first line, as the help says", async () => {
    expect(await read(Buffer.from("alpha\nbeta\n"))).toBe("alpha");
    expect(await read(Buffer.from("alpha\r\nbeta"))).toBe("alpha");
  });

  it("opens a ledger sealed with a typed passphrase, from a BOM file", async () => {
    const dir = tempDir("bom");
    const zip = writeSyntheticZip(dir, "export.zip");
    const ledger = join(dir, "ledger.sealed");
    const file = join(dir, "pass.txt");
    writeFileSync(file, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("typed passphrase here\r\n")]));
    expect((await run(["analyze", zip, "--ledger", ledger, "--passphrase-file", file])).code).toBe(0);
    const typed = await run(["ledger", "status", "--ledger", ledger], makeIo({ env: { SNAPPY_PASSPHRASE: "typed passphrase here" } }));
    expect(typed.code).toBe(0);
  });
});

describe("two commands at once cannot lose each other's changes", () => {
  const PASS = "lock-test-passphrase";

  it("keeps both names when two keep commands run together", async () => {
    const dir = tempDir("lock");
    const ledger = join(dir, "ledger.sealed");
    const env = { SNAPPY_PASSPHRASE: PASS };
    await run(["keep", "seed", "--ledger", ledger], makeIo({ env }));
    const results = await Promise.all([run(["keep", "alice", "--ledger", ledger], makeIo({ env })), run(["keep", "bob", "--ledger", ledger], makeIo({ env }))]);
    expect(results.map((r) => r.code)).toEqual([0, 0]);
    expect(await loadAllowlist(makeIo(), ledger, PASS)).toEqual(["alice", "bob", "seed"]);
    expect(existsSync(`${ledger}.lock`)).toBe(false);
  }, 60_000);

  it("takes over a lock left by a process that is gone, and waits on a live one", async () => {
    const dir = tempDir("lock");
    const ledger = join(dir, "ledger.sealed");
    writeFileSync(`${ledger}.lock`, "2147483646");
    expect(await withLedgerLock(makeIo(), ledger, async () => "done")).toBe("done");
    expect(existsSync(`${ledger}.lock`)).toBe(false);

    writeFileSync(`${ledger}.lock`, String(process.pid));
    await expect(withLedgerLock(makeIo(), ledger, async () => "never", { waitMs: 200 })).rejects.toMatchObject({ code: "ledger-busy" });
    expect(readFileSync(`${ledger}.lock`, "utf8")).toBe(String(process.pid)); // not ours to remove
  });

  it("releases the lock when the work fails", async () => {
    const ledger = join(tempDir("lock"), "ledger.sealed");
    await expect(withLedgerLock(makeIo(), ledger, async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(existsSync(`${ledger}.lock`)).toBe(false);
  });
});

describe("the Memories writer", () => {
  const media = buildSyntheticExport({ now: LATER, friendCount: 5, memoryCount: 6, bundleMedia: true });
  const JPEG = media[Object.keys(media).find((k) => k.endsWith(".jpg")) as string] as Uint8Array;
  const DATE = Date.UTC(2021, 2, 4, 5, 6, 7);

  it("says the date was embedded only when the bytes changed", async () => {
    const dir = tempDir("place");
    expect(await placeMedia(makeIo(), join(dir, "good.jpg"), { bytes: JPEG }, DATE)).toBe("embedded");
    // Valid magic bytes, but a header that ends before the scan: core hands back an unchanged copy.
    const truncated = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 1, 2, 3]);
    expect(await placeMedia(makeIo(), join(dir, "bad.jpg"), { bytes: truncated }, DATE)).toBe("file-time-only");
    expect([...readFileSync(join(dir, "bad.jpg"))]).toEqual([...truncated]);
    expect(await placeMedia(makeIo(), join(dir, "none.jpg"), { bytes: JPEG }, null)).toBe("none");
  });

  it("removes a finished download it could not put in place", async () => {
    const dir = tempDir("place");
    const part = join(dir, "x.jpg.part");
    writeFileSync(part, JPEG);
    const target = join(dir, "x.jpg");
    mkdirSync(target); // a directory is in the way, so the move fails
    await expect(placeMedia(makeIo(), target, { partPath: part }, DATE)).rejects.toBeDefined();
    expect(existsSync(part)).toBe(false);
  });
});

describe("calm errors for odd arguments", () => {
  it("memories: an empty --out is refused instead of meaning the current folder", async () => {
    const zip = writeSyntheticZip(tempDir("arg"), "export.zip", { bundleMedia: true });
    for (const args of [["--out", ""], ["--out="]]) {
      const r = await run(["memories", zip, ...args]);
      expect(r.code).toBe(1);
      expect(r.err).toMatch(/--out needs a folder name/);
    }
  });

  it("memories: an --out that is a file gets a plain message, not 'unexpected'", async () => {
    const dir = tempDir("arg");
    const zip = writeSyntheticZip(dir, "export.zip", { bundleMedia: true });
    const file = join(dir, "notes.txt");
    writeFileSync(file, "hello");
    const r = await run(["memories", zip, "--out", file]);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/needs a folder/);
    expect(r.err).not.toMatch(/unexpected/i);
  });

  it("an option value that starts with a dash is explained, not called an unknown option", async () => {
    const r = await run(["analyze", "--limit", "-5", "x.zip"]);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/--limit needs a value/);
    expect(r.err).toMatch(/--limit=value/);
    expect(r.err).not.toMatch(/does not know/);
    expect(() => parseFlags("analyze", ["--limit=-5"], { limit: { type: "string" } })).not.toThrow();
  });

  it("a folder of parts skips macOS ._ sidecars, and an empty path is refused", async () => {
    const dir = tempDir("parts");
    const good = writeSyntheticZip(dir, "Export.zip");
    writeFileSync(join(dir, "._Export.zip"), "AppleDouble junk");
    expect(await resolveZipPaths(makeIo(), [dir])).toEqual([good]);
    await expect(resolveZipPaths(makeIo(), [""])).rejects.toMatchObject({ code: "no-input" });
    const r = await run(["analyze", dir, "--no-save"]);
    expect(r.code).toBe(0);
  });
});

describe("memories notice", () => {
  it("says secure redirects may be followed", async () => {
    const dir = tempDir("notice");
    const zip = writeSyntheticZip(dir, "later.zip", { memoryCount: 4 });
    const transport: Transport = async () => new Response("no", { status: 403 });
    const { out } = await run(["memories", zip, "--out", join(dir, "o"), "--download"], makeIo({ transport, sleep: noSleep, now: () => NOW }));
    expect(out).toContain("forwards to another secure (https) address");
    expect(out).toContain("secure addresses they forwarded to");
  });
});
