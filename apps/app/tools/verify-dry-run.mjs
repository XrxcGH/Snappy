/**
 * A dry run of the offline verifier (apps/app/src-tauri/examples/verify_manifest.rs) that CI runs, so the check that
 * `verify-published.yml` and the signing tool depend on cannot rot unnoticed between releases.
 *
 *   node apps/app/tools/verify-dry-run.mjs
 *
 * It needs no key and no network. It uses the TEST-ONLY signatures committed under the updater's testdata (made by
 * make-updater-fixtures.mjs with throwaway keys), writes a stand-in installer and a latest.json for it, and runs the real
 * verifier through cargo: the good release must pass, and each broken one (a changed installer, another key, another
 * version, an address that is not the pinned one, a stripped signature, a signature naming another file, and the build's
 * own placeholder keys) must fail with status 1.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REPO, buildLatestJson, installerName } from "./sign-release.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const shell = path.join(here, "..", "src-tauri");
const VERSION = "0.2.0"; // the version the committed fixture signatures name

/** Writes the stand-in files into `dir` and returns the cases to run: `args` after `--`, and the exit status expected. */
export function prepareDryRun(dir) {
  const fixtures = JSON.parse(readFileSync(path.join(shell, "src", "updater", "testdata", "signatures.json"), "utf8"));
  const content = Buffer.from(fixtures.contentBase64, "base64");
  const installer = path.join(dir, installerName(VERSION));
  writeFileSync(installer, content);
  const tampered = path.join(dir, "tampered.exe");
  const bytes = Buffer.from(content);
  bytes[10] = (bytes[10] ?? 0) ^ 1;
  writeFileSync(tampered, bytes);

  const base = JSON.parse(buildLatestJson({ repo: REPO, version: VERSION, signature: fixtures.signatures.good }));
  let n = 0;
  const manifest = (over = {}, platform = {}) => {
    const file = path.join(dir, `latest-${n++}.json`);
    const entry = { ...base.platforms["windows-x86_64"], ...platform };
    writeFileSync(file, JSON.stringify({ ...base, ...over, platforms: { "windows-x86_64": entry } }));
    return file;
  };
  const pub = fixtures.keys.x;
  const cases = [
    { name: "a good release", args: [manifest(), installer, "--pubkey", pub], status: 0, output: /OK: version 0\.2\.0/ },
    { name: "a changed installer", args: [manifest(), tampered, "--pubkey", pub], status: 1 },
    { name: "a key that did not sign it", args: [manifest(), installer, "--pubkey", fixtures.keys.y], status: 1 },
    { name: "a manifest that names another version", args: [manifest({ version: "0.2.1" }), installer, "--pubkey", pub], status: 1 },
    { name: "an address that is not the pinned one", args: [manifest({}, { url: "https://evil.test/Snappy_0.2.0_x64-setup.exe" }), installer, "--pubkey", pub], status: 1 },
    { name: "a stripped signature", args: [manifest({}, { signature: "" }), installer, "--pubkey", pub], status: 1 },
    { name: "a signature that names another file", args: [manifest({}, { signature: fixtures.signatures.wrongFile }), installer, "--pubkey", pub], status: 1 },
    { name: "the build's own keys while they are placeholders", args: [manifest(), installer], status: 1 },
  ];
  return cases;
}

function main() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "snappy-verify-dry-"));
  let failed = 0;
  try {
    for (const c of prepareDryRun(dir)) {
      const r = spawnSync("cargo", ["run", "--locked", "--quiet", "--example", "verify_manifest", "--manifest-path", path.join(shell, "Cargo.toml"), "--", ...c.args], { encoding: "utf8", env: { ...process.env, SNAPPY_E2E_UNIT_TESTS: "" } });
      const text = `${r.stdout}${r.stderr}`;
      const ok = r.status === c.status && (!c.output || c.output.test(text)) && (c.status === 0 || /FAILED/.test(r.stderr));
      console.log(`${ok ? "ok  " : "FAIL"} ${c.name} (exit ${r.status}, expected ${c.status})`);
      if (!ok) {
        failed++;
        console.log(text.trim().split("\n").slice(-8).join("\n"));
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  if (failed) {
    console.error(`${failed} dry-run case(s) failed.`);
    process.exit(1);
  }
  console.log("The verifier accepts a good release and refuses every broken one.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
