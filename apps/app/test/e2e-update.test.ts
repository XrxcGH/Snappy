/**
 * What can be checked about the update drill (test/e2e-update) without installing anything or opening a window: the stand-in
 * for GitHub behaves as the drill needs, the drill's script is well formed and lists its scenarios, the test identity is the
 * one the build refuses to build without, and nothing in the folder holds a key.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain JavaScript module without types
import { BASE_PATH, manifestFor, startFakeGithub } from "./e2e-update/fake-github.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const drill = path.join(here, "e2e-update");
const releaseOf = (over: Record<string, unknown> = {}) => ({ version: "0.9.2", installer: Buffer.from("INSTALLER BYTES"), signature: "c2ln", ...over });

/** The response headers of a GET, read without decoding the body (fetch would try to decompress a gzip claim). */
const rawHeaders = (url: string): Promise<http.IncomingHttpHeaders> =>
  new Promise((resolve, reject) =>
    http.get(url, (res) => {
      res.resume();
      resolve(res.headers);
    }).on("error", reject),
  );

async function get(url: string): Promise<{ status: number; headers: Headers; body: string }> {
  const r = await fetch(url, { redirect: "manual" });
  return { status: r.status, headers: r.headers, body: await r.text() };
}

describe("the stand-in for GitHub", () => {
  it("serves the manifest and the installer at the paths the releases use, and records each request", async () => {
    let release = releaseOf();
    const gh = await startFakeGithub(() => release);
    try {
      expect(gh.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      const manifest = await get(`${gh.base}/releases/latest/download/latest.json`);
      const parsed = JSON.parse(manifest.body);
      expect(parsed.version).toBe("0.9.2");
      expect(parsed.platforms["windows-x86_64"]).toEqual({ signature: "c2ln", url: `${gh.base}/releases/download/v0.9.2/Snappy_0.9.2_x64-setup.exe` });
      const file = await get(`${gh.base}/releases/download/v0.9.2/Snappy_0.9.2_x64-setup.exe`);
      expect([file.status, file.body, file.headers.get("content-length")]).toEqual([200, "INSTALLER BYTES", "15"]);
      expect((await get(`${gh.base}/releases/download/v0.9.2/other.exe`)).status).toBe(404);
      expect(gh.requests.map((r: { path: string }) => r.path)).toHaveLength(3);
      release = releaseOf({ version: "0.9.3" }); // what is published can change between requests
      expect(JSON.parse((await get(`${gh.base}/releases/latest/download/latest.json`)).body).version).toBe("0.9.3");
    } finally {
      await gh.close();
    }
  });

  it("can break a release in each of the ways the drill needs", async () => {
    let release = releaseOf();
    const gh = await startFakeGithub(() => release);
    const manifestUrl = `${gh.base}/releases/latest/download/latest.json`;
    const fileUrl = `${gh.base}/releases/download/v0.9.2/Snappy_0.9.2_x64-setup.exe`;
    try {
      release = releaseOf({ stripSignature: true });
      expect(JSON.parse((await get(manifestUrl)).body).platforms["windows-x86_64"].signature).toBeUndefined();
      release = releaseOf({ wrongUrl: true });
      expect(JSON.parse((await get(manifestUrl)).body).platforms["windows-x86_64"].url).toMatch(/\/elsewhere\.exe$/);
      release = releaseOf({ manifestRedirect: "http://localhost:1/x" });
      const redirect = await get(manifestUrl);
      expect([redirect.status, redirect.headers.get("location")]).toEqual([302, "http://localhost:1/x"]);
      release = releaseOf({ manifestStatus: 404 });
      expect((await get(manifestUrl)).status).toBe(404);
      release = releaseOf({ contentEncoding: "gzip" });
      expect((await rawHeaders(fileUrl))["content-encoding"]).toBe("gzip");
      release = releaseOf({ declaredLength: 64 * 1024 * 1024 + 1 });
      await expect(get(fileUrl)).rejects.toThrow(); // a body shorter than its declared length is a broken response
      release = releaseOf({ versionInManifest: "0.9.9" });
      expect(JSON.parse((await get(manifestUrl)).body).version).toBe("0.9.9");
    } finally {
      await gh.close();
    }
    expect(BASE_PATH).toBe("/XrxcGH/Snappy");
    expect(JSON.parse(manifestFor("http://127.0.0.1:1", { version: "1.2.3", signature: "x" })).platforms["windows-x86_64"].url).toBe("http://127.0.0.1:1/XrxcGH/Snappy/releases/download/v1.2.3/Snappy_1.2.3_x64-setup.exe");
  });
});

describe("the drill", () => {
  it("is well formed and lists its scenarios (nothing is built, installed or started by listing)", () => {
    execFileSync(process.execPath, ["--check", path.join(drill, "run-e2e.mjs")]);
    execFileSync(process.execPath, ["--check", path.join(drill, "fake-github.mjs")]);
    if (process.platform !== "win32") return;
    const out = execFileSync(process.execPath, [path.join(drill, "run-e2e.mjs"), "--list"], { encoding: "utf8" });
    for (const name of ["update", "tampered", "wrong-key", "downgrade", "same-version", "stripped-signature", "wrong-name", "wrong-url", "redirect-foreign", "oversize", "no-length", "content-encoding", "offline", "toggle-off", "first-launch", "rotation"]) {
      expect(out, name).toContain(name);
    }
  });

  it("builds under the identity that build.rs requires of the test feature, with the installer's downgrade lock", () => {
    const overlay = JSON.parse(readFileSync(path.join(drill, "tauri.e2e.conf.json"), "utf8"));
    const guards = readFileSync(path.join(here, "..", "src-tauri", "build_guards.rs"), "utf8");
    expect(guards).toContain(`pub const E2E_IDENTIFIER: &str = "${overlay.identifier}";`);
    expect(overlay.identifier).toBe("com.snappy.e2e");
    expect(overlay.productName).toBe("Snappy E2E");
    expect(overlay.bundle.windows.allowDowngrades).toBe(false);
    const real = JSON.parse(readFileSync(path.join(here, "..", "src-tauri", "tauri.conf.json"), "utf8"));
    expect(overlay.identifier).not.toBe(real.identifier);
    expect(overlay.productName).not.toBe(real.productName);
  });

  it("holds no key, passphrase or signing secret, and builds the test installers with the test feature only there", () => {
    for (const name of readdirSync(drill)) {
      const text = readFileSync(path.join(drill, name), "utf8");
      expect(text, name).not.toMatch(/untrusted comment|RWR[A-Za-z0-9+/]{20}|BEGIN (RSA |EC )?PRIVATE KEY|TAURI_SIGNING_PRIVATE_KEY(?!\b.{0,3}$)/);
      expect(text, name).not.toMatch(/-p",\s*"[^"]+"/); // a passphrase argument: the only one is the empty string of a throwaway test key
    }
    const run = readFileSync(path.join(drill, "run-e2e.mjs"), "utf8");
    expect(run).toMatch(/--features", "dev-update-endpoint"/);
    expect(run).toMatch(/SNAPPY_RELEASE: ""/); // never a release build
  });
});
