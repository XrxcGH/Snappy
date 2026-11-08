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
 *   0. Before anything is downloaded: refuses a tag that is not strictly higher than every published release, and a tag whose
 *      release is not a DRAFT (`gh release list`). Builds the page the verifier needs, if it is not built yet.
 *   2. Checks the installer's SHA-256 against SHA256SUMS, and its build provenance with `gh attestation verify`, which must
 *      name the release workflow of this repository and this tag. SHA256SUMS comes from the same draft, so it only catches a
 *      damaged download: the attestation and the installer's own product version (which must equal the tag) are the checks
 *      against someone who can write to the draft.
 *   3. Prints the version, file name, size, SHA-256, the installer's own product version and the signing tool's resolved
 *      version and integrity, and makes you TYPE the version.
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
import { copyFileSync, existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
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

const NUMBER_TAG = new RegExp(`^v${PART}\\.${PART}\\.${PART}$`);
const triple = (tag) => tag.slice(1).split(".").map(Number);
const compare = (a, b) => a.reduce((r, n, i) => r || n - b[i], 0);

/**
 * Refuses a tag that is not strictly higher than every published release. `releases` is `gh release list --json
 * tagName,isDraft,isPrerelease`. Drafts and pre-releases do not count (a beta is not a version an update can come from), but a
 * published release with the same tag, or any higher one, does.
 */
export function assertHigherThanPublished(tag, releases) {
  for (const r of releases) {
    if (r.isDraft || r.isPrerelease || !NUMBER_TAG.test(r.tagName ?? "")) continue;
    if (compare(triple(tag), triple(r.tagName)) <= 0) throw new Error(`${tag} is not higher than the published release ${r.tagName}. A signed update must always be a higher version. Nothing was downloaded or signed.`);
  }
}

/** Refuses a tag whose release is missing or already published: files are added to a DRAFT only, never to a live release. */
export function assertIsDraft(tag, releases) {
  const found = releases.find((r) => r.tagName === tag);
  if (!found) throw new Error(`There is no release for ${tag}. The release workflow makes a draft: wait for it to finish.`);
  if (!found.isDraft) throw new Error(`The release ${tag} is already published. Files are only added to a draft. Nothing was downloaded or signed.`);
}

/** The arguments that make `gh attestation verify` check WHO built the file: this repository's release workflow, at this tag. */
export const attestationArgs = (repo, tag) => ["--repo", repo, "--signer-workflow", `${repo}/.github/workflows/release.yml`, "--source-ref", `refs/tags/${tag}`];

/** The installer's own product version must be the tag's version, and must be readable. */
export function assertProductVersion(found, version) {
  if (!found || !/^[0-9A-Za-z.+-]+$/.test(found)) throw new Error("The installer's own product version could not be read, so it cannot be compared with the tag. Nothing was signed.");
  if (found !== version) throw new Error(`The installer says it is version ${found} but the tag is ${version}. This is not the file for this release. Nothing was signed.`);
}

/** The signing tool as pinned by the lock file and as installed: it runs on this computer with the passphrase in its environment. */
export function signerCli(root) {
  const lock = JSON.parse(readFileSync(path.join(root, "package-lock.json"), "utf8"));
  const entry = lock.packages?.["node_modules/@tauri-apps/cli"];
  if (!entry?.version || !entry.integrity) throw new Error("package-lock.json does not pin @tauri-apps/cli with an integrity value.");
  const installedFile = path.join(root, "node_modules", "@tauri-apps", "cli", "package.json");
  if (!existsSync(installedFile)) throw new Error("@tauri-apps/cli is not installed here. Run: npm ci --ignore-scripts");
  const installed = JSON.parse(readFileSync(installedFile, "utf8")).version;
  if (installed !== entry.version) throw new Error(`The installed @tauri-apps/cli is ${installed} but the lock file pins ${entry.version}. Run: npm ci --ignore-scripts`);
  return { version: entry.version, integrity: entry.integrity };
}

/** The verifier is a program of the desktop shell, which embeds the built page: build it when this checkout has none yet. */
export function ensureFrontend(root, build) {
  if (existsSync(path.join(root, "apps", "app", "frontend", "index.html"))) return false;
  console.log("Building the page the verifier embeds (once) ...");
  try {
    build();
  } catch {
    throw new Error("The page the verifier needs could not be built. Run `npm ci --ignore-scripts` in the repository, then try again.");
  }
  return true;
}

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
  if (process.platform !== "win32") return "";
  return execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", `(Get-Item -LiteralPath '${file.replaceAll("'", "''")}').VersionInfo.ProductVersion`], { encoding: "utf8" }).trim();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { version, tag, repo } = args;
  const name = installerName(version);
  const offline = Boolean(args.installer) && !args.upload; // files by hand and nothing will be uploaded: no release to check
  if (!offline) {
    const releases = JSON.parse(run("gh", ["release", "list", "--repo", repo, "--limit", "200", "--json", "tagName,isDraft,isPrerelease"]));
    assertHigherThanPublished(tag, releases);
    if (args.upload) assertIsDraft(tag, releases);
    console.log(`${tag} is higher than every published release${args.upload ? " and is a draft" : ""}.`);
  }
  const cli = signerCli(repoRoot);
  ensureFrontend(repoRoot, () => execFileSync(process.execPath, [path.join(repoRoot, "apps", "app", "scripts", "build-frontend.mjs")], { cwd: repoRoot, stdio: "inherit" }));
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
    run("gh", ["attestation", "verify", installer, ...attestationArgs(repo, tag)]);
    console.log(`Build provenance verified (this file was built by ${repo}'s release workflow at ${tag}).`);
  } else console.log("WARNING: build provenance was not checked (--no-attestation).");

  const product = productVersion(installer);
  if (args.testPubkey) console.log("WARNING: the installer's product version was not compared (--test-pubkey is a test run).");
  else assertProductVersion(product, version);
  console.log(`\n  version         ${version}\n  file            ${name}\n  size            ${statSync(installer).size} bytes\n  SHA-256         ${actual}\n  product version ${product}\n  signing tool    @tauri-apps/cli ${cli.version}\n  lock integrity  ${cli.integrity}\n`);
  console.log("The signing tool runs next, with the key's unlock secret in its environment. If the version or integrity above is not what the lock file in main says, stop.");
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
