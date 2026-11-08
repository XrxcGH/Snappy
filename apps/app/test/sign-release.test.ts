/**
 * The maintainer's signing tool (tools/sign-release.mjs) and the verifier it and the daily check use
 * (src-tauri/examples/verify_manifest.rs).
 *
 * The pure parts always run. The end-to-end part signs a stand-in file with a throwaway TEST key made for the run (the real
 * Tauri signing tool, no passphrase, the key never leaves the temporary folder), builds latest.json with the tool's own function
 * and checks it with the real verifier, then breaks each part and requires the verifier to refuse. It builds the verifier with
 * cargo (minutes the first time), so it runs only when asked:
 *
 *   SNAPPY_RUN_CARGO_TESTS=1 npx vitest run apps/app/test/sign-release.test.ts
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain JavaScript module without types
import { REPO, buildLatestJson, checksumFor, installerName, parseArgs, sha256File } from "../tools/sign-release.mjs";

const appDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("the signing tool's pure parts", () => {
  it("reads its arguments strictly", () => {
    expect(parseArgs(["--tag", "v0.2.0", "--key", "k.key"])).toMatchObject({ tag: "v0.2.0", version: "0.2.0", key: "k.key", repo: REPO, upload: true, attestation: true });
    expect(parseArgs(["--tag", "v1.20.3", "--key", "k", "--no-upload", "--installer", "a.exe", "--sums", "SHA256SUMS"])).toMatchObject({ upload: false, installer: "a.exe" });
    for (const bad of [[], ["--tag", "v0.2.0"], ["--key", "k"], ["--tag", "0.2.0", "--key", "k"], ["--tag", "v0.2.0-beta.1", "--key", "k"], ["--tag", "v01.2.0", "--key", "k"], ["--tag", "v0.2.0", "--key", "k", "--installer", "a.exe"], ["--tag", "v0.2.0", "--key", "k", "--repo", "x"], ["--tag", "v0.2.0", "--key", "k", "--nope"]]) {
      expect(() => parseArgs(bad as string[]), JSON.stringify(bad)).toThrow();
    }
  });

  it("never takes the passphrase or the key's text from the command line", () => {
    for (const flag of ["--passphrase", "--password", "-p", "--private-key"]) expect(() => parseArgs(["--tag", "v0.2.0", "--key", "k", flag, "x"])).toThrow();
    const source = readFileSync(path.join(appDir, "tools", "sign-release.mjs"), "utf8");
    expect(source).toMatch(/TAURI_SIGNING_PRIVATE_KEY_PASSWORD: passphrase/); // the child's environment only
    expect(source).not.toMatch(/console\.(log|error)\([^)]*passphrase/i);
    expect(source).not.toMatch(/"-p"|'-p'/);
    expect(source).not.toMatch(/writeFileSync\([^)]*(passphrase|key)/i);
  });

  it("finds a checksum in the SHA256SUMS format and refuses a name that only looks alike", () => {
    const hash = "a".repeat(64);
    const sums = `${hash}  Snappy_0.2.0_x64-setup.exe\n${"b".repeat(64)} *other.exe\n`;
    expect(checksumFor(sums, "Snappy_0.2.0_x64-setup.exe")).toBe(hash);
    expect(checksumFor(sums, "other.exe")).toBe("b".repeat(64));
    expect(checksumFor(sums, "Snappy_0.2.0_x64-setup.exe.sig")).toBeNull();
    expect(checksumFor(sums, "nope")).toBeNull();
    expect(checksumFor(`${hash.slice(1)}  x.exe`, "x.exe")).toBeNull();
  });

  it("writes latest.json with the exact address, one platform and no notes", () => {
    const json = JSON.parse(buildLatestJson({ repo: REPO, version: "0.2.0", signature: "c2ln", now: new Date("2026-11-07T10:20:30.456Z") }));
    expect(json).toEqual({ version: "0.2.0", pub_date: "2026-11-07T10:20:30Z", platforms: { "windows-x86_64": { signature: "c2ln", url: "https://github.com/XrxcGH/Snappy/releases/download/v0.2.0/Snappy_0.2.0_x64-setup.exe" } } });
    expect(installerName("1.2.3")).toBe("Snappy_1.2.3_x64-setup.exe");
  });
});

describe.skipIf(!process.env.SNAPPY_RUN_CARGO_TESTS)("signing and verifying end to end, with a TEST key", () => {
  it("accepts a good release and refuses each broken one", { timeout: 900_000 }, () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "snappy-sign-test-"));
    try {
      const quote = (a: string): string => (a === "" ? '""' : /\s/.test(a) ? `"${a}"` : a); // arguments go through the shell
      const tauri = (...a: string[]) => spawnSync("npx", ["--no-install", "tauri", ...a.map(quote)], { cwd: appDir, encoding: "utf8", shell: true });
      const key = path.join(dir, "test.key");
      expect(tauri("signer", "generate", "-w", key, "-p", "", "--ci", "-f").status).toBe(0);
      const pub = readFileSync(`${key}.pub`, "utf8").trim();
      const otherKey = path.join(dir, "other.key");
      expect(tauri("signer", "generate", "-w", otherKey, "-p", "", "--ci", "-f").status).toBe(0);
      const otherPub = readFileSync(`${otherKey}.pub`, "utf8").trim();

      const version = "0.2.0";
      const installer = path.join(dir, installerName(version));
      writeFileSync(installer, Buffer.from("TEST-ONLY stand-in for an installer\n".repeat(1000)));
      expect(tauri("signer", "sign", "-f", key, "-p", "", "--app-version", version, installer).status).toBe(0);
      const signature = readFileSync(`${installer}.sig`, "utf8").trim();
      expect(sha256File(installer)).toMatch(/^[0-9a-f]{64}$/);

      const latest = (over: Record<string, unknown> = {}) => {
        const file = path.join(dir, `latest-${Math.random().toString(36).slice(2)}.json`);
        const base = JSON.parse(buildLatestJson({ repo: REPO, version, signature }));
        writeFileSync(file, JSON.stringify({ ...base, ...over }));
        return file;
      };
      const manifestWith = (platform: Record<string, unknown>) => latest({ platforms: { "windows-x86_64": { ...JSON.parse(buildLatestJson({ repo: REPO, version, signature })).platforms["windows-x86_64"], ...platform } } });
      const verify = (manifest: string, file: string, pubkey: string) =>
        spawnSync("cargo", ["run", "--locked", "--example", "verify_manifest", "--manifest-path", path.join(appDir, "src-tauri", "Cargo.toml"), "--", manifest, file, "--pubkey", pubkey], { encoding: "utf8", env: { ...process.env, SNAPPY_E2E_UNIT_TESTS: "" } });

      const ok = verify(latest(), installer, pub);
      expect(ok.stdout + ok.stderr).toMatch(/OK: version 0\.2\.0/);
      expect(ok.status).toBe(0);

      const tampered = path.join(dir, "tampered.exe");
      const bytes = readFileSync(installer);
      bytes[10] ^= 1;
      writeFileSync(tampered, bytes);
      const cases: [string, ReturnType<typeof verify>][] = [
        ["a changed installer", verify(latest(), tampered, pub)],
        ["a key that did not sign it", verify(latest(), installer, otherPub)],
        ["a manifest that names another version", verify(latest({ version: "0.2.1" }), installer, pub)],
        ["an address that is not the pinned one", verify(manifestWith({ url: "https://evil.test/Snappy_0.2.0_x64-setup.exe" }), installer, pub)],
        ["a stripped signature", verify(manifestWith({ signature: "" }), installer, pub)],
      ];
      for (const [name, result] of cases) {
        expect(result.status, `${name}: ${result.stderr}`).toBe(1);
        expect(result.stderr, name).toMatch(/FAILED/);
      }
      expect(readdirSync(dir).some((f) => f.endsWith(".key"))).toBe(true); // (the keys are in this folder and nowhere else)
      execFileSync(process.execPath, ["--check", path.join(appDir, "tools", "sign-release.mjs")]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
