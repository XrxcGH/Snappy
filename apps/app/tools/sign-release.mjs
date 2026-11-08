/**
 * Signs a release's Windows installer for the app's updater. Runs on the MAINTAINER'S OWN COMPUTER, never in GitHub.
 *
 *   node apps/app/tools/sign-release.mjs --tag v0.2.0 --key <path to the signing key>
 *   node apps/app/tools/sign-release.mjs --tag v0.2.0 --key <path> --installer <file> --sums <SHA256SUMS> --no-upload
 *
 * Why offline: the update signing key is never in GitHub. A takeover of the account, a poisoned dependency or a malicious
 * collaborator can then swap a file in a draft, but no installed copy accepts a file this key did not sign. It also means you
 * sign the exact bytes you installed and ran yourself (in Windows Sandbox or a virtual machine) first. docs/UPDATES.md has the
 * runbook, including key rotation and a bad release.
 *
 * What it does, in order (it stops at the first problem):
 *   1. Downloads the draft's installer and SHA256SUMS into a fresh empty folder with `gh release download`
 *      (or uses --installer and --sums, for files you downloaded by hand).
 *   2. Checks the installer's SHA-256 against SHA256SUMS, and its build provenance with `gh attestation verify`.
 *   3. Prints the version, file name, size, SHA-256 and the installer's own product version, and makes you TYPE the version.
 *   4. Asks for the key's passphrase with a hidden prompt, hands it to the signing tool through the environment of that one
 *      child process only, and runs the signing tool pinned by the lock file (`tauri signer sign --app-version <version>`).
 *      The key and the passphrase are never printed, written to a file, or put on a command line.
 *   5. Writes latest.json (version, date, the one platform entry with the signature and the constructed address, no notes).
 *   6. Checks installer, signature and latest.json offline with the app's own verifier (examples/verify_manifest.rs, built
 *      from this checkout with --locked), against the public keys compiled into this checkout.
 *   7. Uploads the .sig and latest.json to the DRAFT with `gh release upload`. Publishing, and marking the release Latest, are
 *      separate steps that stay yours.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

export const REPO = "XrxcGH/Snappy";
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const PART = "(0|[1-9][0-9]{0,4})";
const TAG = new RegExp(`^v(${PART}\\.${PART}\\.${PART})$`);
/** An argument for a command run through the shell (Windows .cmd files): empty and spaced values need quotes. */
const q = (a) => (a === "" ? '""' : /\s/.test(a) ? `"${a}"` : a);

/** The installer's file name for a version: what the signature's signed comment must carry. */
export const installerName = (version) => `Snappy_${version}_x64-setup.exe`;

export function parseArgs(argv) {
  const out = { repo: REPO, upload: true, attestation: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--tag") out.tag = argv[++i];
    else if (a === "--key") out.key = argv[++i];
    else if (a === "--repo") out.repo = argv[++i];
    else if (a === "--installer") out.installer = argv[++i];
    else if (a === "--sums") out.sums = argv[++i];
    else if (a === "--test-pubkey") out.testPubkey = argv[++i];
    else if (a === "--no-upload") out.upload = false;
    else if (a === "--no-attestation") out.attestation = false;
    else throw new Error(`unknown option ${a}`);
  }
  const m = TAG.exec(out.tag ?? "");
  if (!m) throw new Error("--tag must be a plain version tag such as v0.2.0");
  if (!out.key) throw new Error("--key must name the signing key file");
  if (Boolean(out.installer) !== Boolean(out.sums)) throw new Error("--installer and --sums go together");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(out.repo)) throw new Error("--repo must be OWNER/NAME");
  return { ...out, version: m[1] };
}

/** Finds the checksum a SHA256SUMS text lists for `name` (lowercase hex), or null. Format: "<hex>  <name>" per line. */
export function checksumFor(sums, name) {
  for (const line of sums.split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64}) [ *](.+)$/.exec(line.trim());
    if (m && m[2] === name) return m[1].toLowerCase();
  }
  return null;
}

export const sha256File = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

/** latest.json: Tauri's static format with one platform entry, the exact address, and no notes. */
export function buildLatestJson({ repo, version, signature, now = new Date() }) {
  const url = `https://github.com/${repo}/releases/download/v${version}/${installerName(version)}`;
  return `${JSON.stringify({ version, pub_date: now.toISOString().replace(/\.\d+Z$/, "Z"), platforms: { "windows-x86_64": { signature, url } } }, null, 2)}\n`;
}

/** Reads a line from the terminal without showing it. Nothing typed is kept anywhere but the returned string. */
export function askHidden(prompt) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) return reject(new Error("a hidden prompt needs a terminal"));
    process.stdout.write(prompt);
    const rl = readline.createInterface({ input: process.stdin, terminal: true });
    rl._writeToOutput = () => undefined; // show nothing while typing
    rl.question("", (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

const ask = (question) =>
  new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (a) => (rl.close(), resolve(a)));
  });

const run = (cmd, args, options = {}) => execFileSync(cmd, args, { stdio: ["ignore", "pipe", "inherit"], encoding: "utf8", shell: process.platform === "win32" && /\.cmd$/.test(cmd), ...options });

function productVersion(file) {
  if (process.platform !== "win32") return "(not shown: not Windows)";
  return execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", `(Get-Item -LiteralPath '${file.replaceAll("'", "''")}').VersionInfo.ProductVersion`], { encoding: "utf8" }).trim();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { version, tag, repo } = args;
  const name = installerName(version);
  const work = mkdtempSync(path.join(os.tmpdir(), "snappy-sign-"));
  console.log(`Working in a fresh folder: ${work}`);

  let installer;
  let sums;
  if (args.installer) {
    installer = path.join(work, name);
    copyFileSync(args.installer, installer);
    sums = readFileSync(args.sums, "utf8");
  } else {
    run("gh", ["release", "download", tag, "--repo", repo, "--pattern", name, "--pattern", "SHA256SUMS", "--dir", work]);
    installer = path.join(work, name);
    sums = readFileSync(path.join(work, "SHA256SUMS"), "utf8");
  }

  const expected = checksumFor(sums, name);
  const actual = sha256File(installer);
  if (!expected) throw new Error(`SHA256SUMS has no line for ${name}`);
  if (expected !== actual) throw new Error(`The installer's SHA-256 (${actual}) does not match SHA256SUMS (${expected}). Do not sign it.`);
  console.log("SHA-256 matches SHA256SUMS.");

  if (args.attestation) {
    run("gh", ["attestation", "verify", installer, "--repo", repo]);
    console.log("Build provenance verified (this file was made by the release workflow in this repository).");
  } else console.log("WARNING: build provenance was not checked (--no-attestation).");

  console.log(`\n  version         ${version}\n  file            ${name}\n  size            ${statSync(installer).size} bytes\n  SHA-256         ${actual}\n  product version ${productVersion(installer)}\n`);
  console.log("Install and run THIS file (Windows Sandbox or a virtual machine) before you sign it.");
  if ((await ask(`Type the version (${version}) to sign it: `)).trim() !== version) throw new Error("The version was not typed correctly. Nothing was signed.");

  const passphrase = await askHidden("Passphrase of the signing key (hidden): ");
  // The passphrase travels in the environment of this one child process. It is not an argument and is never written.
  const childEnv = { ...process.env, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: passphrase };
  const signed = spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", ["--no-install", "tauri", "signer", "sign", "-f", q(args.key), "--app-version", version, q(installer)], { cwd: repoRoot, env: childEnv, encoding: "utf8", shell: process.platform === "win32" });
  if (signed.status !== 0) throw new Error("The signing tool failed (wrong passphrase or key?). Nothing was uploaded.");
  const signature = readFileSync(`${installer}.sig`, "utf8").trim();

  const latest = path.join(work, "latest.json");
  writeFileSync(latest, buildLatestJson({ repo, version, signature }));

  const verifierArgs = ["run", "--locked", "--release", "--example", "verify_manifest", "--manifest-path", path.join(repoRoot, "apps", "app", "src-tauri", "Cargo.toml"), "--", latest, installer];
  if (args.testPubkey) verifierArgs.push("--pubkey", args.testPubkey);
  console.log("Verifying offline with the app's own verifier (the first build takes a few minutes) ...");
  console.log(run("cargo", verifierArgs).trim());

  if (!args.upload) {
    console.log(`\n--no-upload: nothing was uploaded. The files are in ${work}.`);
    return;
  }
  run("gh", ["release", "upload", tag, `${installer}.sig`, latest, "--repo", repo]);
  console.log(`\nUploaded ${name}.sig and latest.json to the draft ${tag}.`);
  console.log("Next, on GitHub: check the draft, publish it, and set it as the Latest release. Then watch for the 'Verify published release' workflow.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`\nStopped: ${e.message}`);
    process.exit(1);
  });
}
