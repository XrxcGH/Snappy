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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain JavaScript module without types
import { REPO, assertHigherThanPublished, assertIsDraft, assertProductVersion, attestationArgs, buildLatestJson, checksumFor, ensureFrontend, installerName, parseArgs, sha256File, signerCli } from "../tools/sign-release.mjs";
// @ts-expect-error plain JavaScript module without types
import { prepareDryRun } from "../tools/verify-dry-run.mjs";

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

describe("the signing tool's checks before it signs", () => {
  const rel = (tagName: string, over: Record<string, boolean> = {}) => ({ tagName, isDraft: false, isPrerelease: false, ...over });

  it("refuses a version that is not strictly higher than every published release", () => {
    const published = [rel("v0.1.0"), rel("v0.3.0"), rel("v0.2.0")];
    for (const tag of ["v0.2.5", "v0.3.0", "v0.1.9", "v0.0.1"]) expect(() => assertHigherThanPublished(tag, published), tag).toThrow(/not higher/);
    expect(() => assertHigherThanPublished("v0.3.1", published)).not.toThrow();
    expect(() => assertHigherThanPublished("v0.10.0", [rel("v0.9.0")]), "compared as numbers, not text").not.toThrow();
    expect(() => assertHigherThanPublished("v0.9.0", [rel("v0.10.0")])).toThrow(/not higher/);
  });

  it("ignores drafts, pre-releases and odd tags when comparing, but not a published release with the same tag", () => {
    const others = [rel("v9.0.0", { isDraft: true }), rel("v9.1.0", { isPrerelease: true }), rel("nightly"), rel("v0.2.0-beta.1")];
    expect(() => assertHigherThanPublished("v0.2.0", others)).not.toThrow();
    expect(() => assertHigherThanPublished("v0.2.0", [...others, rel("v0.2.0")])).toThrow(/not higher/);
  });

  it("only ever adds files to a draft", () => {
    expect(() => assertIsDraft("v0.2.0", [rel("v0.2.0", { isDraft: true })])).not.toThrow();
    expect(() => assertIsDraft("v0.2.0", [rel("v0.2.0")])).toThrow(/already published/);
    expect(() => assertIsDraft("v0.2.0", [rel("v0.1.0", { isDraft: true })])).toThrow(/no release/);
  });

  it("makes the build provenance name this repository's release workflow and this tag", () => {
    expect(attestationArgs(REPO, "v0.2.0")).toEqual(["--repo", REPO, "--signer-workflow", `${REPO}/.github/workflows/release.yml`, "--source-ref", "refs/tags/v0.2.0"]);
    const source = readFileSync(path.join(appDir, "tools", "sign-release.mjs"), "utf8");
    expect(source).toMatch(/\["attestation", "verify", installer, \.\.\.attestationArgs\(repo, tag\)\]/);
  });

  it("requires the installer's own product version to be readable and equal to the tag", () => {
    expect(() => assertProductVersion("0.2.0", "0.2.0")).not.toThrow();
    expect(() => assertProductVersion("0.1.9", "0.2.0")).toThrow(/0\.1\.9/);
    for (const unreadable of ["", null, undefined, "(not shown)"]) expect(() => assertProductVersion(unreadable, "0.2.0")).toThrow(/could not be read/);
  });

  it("shows the signing tool as pinned and refuses one that differs from the lock file", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "snappy-lock-test-"));
    try {
      const lock = (entry: unknown) => writeFileSync(path.join(dir, "package-lock.json"), JSON.stringify({ packages: { "node_modules/@tauri-apps/cli": entry } }));
      const installed = (version: string) => {
        mkdirSync(path.join(dir, "node_modules", "@tauri-apps", "cli"), { recursive: true });
        writeFileSync(path.join(dir, "node_modules", "@tauri-apps", "cli", "package.json"), JSON.stringify({ version }));
      };
      lock({ version: "2.12.0", integrity: "sha512-abc" });
      expect(() => signerCli(dir)).toThrow(/not installed/);
      installed("2.11.0");
      expect(() => signerCli(dir)).toThrow(/pins 2\.12\.0/);
      installed("2.12.0");
      expect(signerCli(dir)).toEqual({ version: "2.12.0", integrity: "sha512-abc" });
      lock({ version: "2.12.0" });
      expect(() => signerCli(dir)).toThrow(/integrity/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("builds the page the verifier embeds when the checkout has none, and says what to do when that fails", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "snappy-frontend-test-"));
    try {
      let built = 0;
      expect(ensureFrontend(dir, () => built++)).toBe(true);
      expect(built).toBe(1);
      mkdirSync(path.join(dir, "apps", "app", "frontend"), { recursive: true });
      writeFileSync(path.join(dir, "apps", "app", "frontend", "index.html"), "<!doctype html>");
      expect(ensureFrontend(dir, () => built++)).toBe(false);
      expect(built).toBe(1);
      rmSync(path.join(dir, "apps", "app", "frontend"), { recursive: true });
      expect(() =>
        ensureFrontend(dir, () => {
          throw new Error("no esbuild");
        }),
      ).toThrow(/npm ci --ignore-scripts/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("checks the releases, the signing tool and the page before it downloads or asks for anything", () => {
    const source = readFileSync(path.join(appDir, "tools", "sign-release.mjs"), "utf8");
    const main = source.slice(source.indexOf("async function main()"));
    const order = ["assertHigherThanPublished(tag", "signerCli(repoRoot)", "ensureFrontend(repoRoot", '"release", "download"', "assertProductVersion(product", 'askHidden("Passphrase'].map((needle) => main.indexOf(needle));
    expect(order.every((i) => i >= 0), JSON.stringify(order)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("has a dry run of the verifier that covers a good release and each way to break one", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "snappy-dry-test-"));
    try {
      const cases = prepareDryRun(dir) as { name: string; args: string[]; status: number }[];
      expect(cases.filter((c) => c.status === 0).map((c) => c.name)).toEqual(["a good release"]);
      expect(cases.length).toBeGreaterThanOrEqual(7);
      for (const c of cases) for (const a of c.args.filter((x) => x.endsWith(".json") || x.endsWith(".exe"))) expect(existsSync(a), `${c.name}: ${a}`).toBe(true);
      expect(JSON.stringify(cases)).not.toMatch(/secret|passphrase/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
      bytes[10] = (bytes[10] ?? 0) ^ 1;
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
