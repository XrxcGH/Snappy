/**
 * Fails when the program contains a way to make network connections other than the one update check.
 *
 * Snappy's privacy contract is that nothing about the person leaves the device. The page may not connect at all, and
 * the desktop program's only network use is the update check (src-tauri/src/updater): one request for a small file on
 * github.com and, if a newer version exists, one for its installer. This check keeps the compiled-in code honest in three ways.
 *
 *   1. Crates. It asks Cargo for the dependency tree of every release target and fails when an HTTP client, a TLS
 *      library, a WebSocket library or the async runtime's socket support shows up. The update check uses none of
 *      them: it calls the operating system (WinHTTP, through the windows-sys crate) and verifies with minisign-verify.
 *      The list is a denylist of the best-known ones; approved-crates.txt (checked with the sources) is the allowlist that
 *      stops a crate nobody has heard of yet.
 *   2. Source. The program's own Rust may use WinHTTP only in updater/transport_windows.rs, start a process only in
 *      updater/launch_windows.rs, and use no other way to download (see network-surface.mjs for every rule).
 *   3. The built program (--exe). It must import winhttp.dll and not WinINet, URLMon or BITS, and a release build must hold no test
 *      setting, test identity or test key.
 *
 *   node apps/app/tools/check-no-network-deps.mjs [--target <triple> ...] [--sources-only] [--exe <snappy.exe>]
 *
 * Needs cargo and a network the first time (Cargo downloads crate metadata). Build time only; the app makes no calls.
 *
 * Desktop targets (Windows, macOS, Linux) must be completely clean of the banned crates.
 *
 * Mobile targets (Android, iOS) are a known exception. The `tauri` crate links `reqwest` (and its hyper
 * and tower stack) on those two platforms, but only calls it in development builds, to proxy the dev
 * server to the phone (`#[cfg(all(dev, mobile))]` in tauri/src/protocol/tauri.rs, read in tauri 2.12.5). A release build never
 * calls it. So for mobile the rule is narrower: nothing outside that known set may appear, and `tauri`
 * must be the only crate that depends on `reqwest`. The Android release APK is additionally checked for the
 * INTERNET permission in the release workflow, because that is the check the operating system enforces.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkBinary, checkRepository, lockedNames, peImports } from "./network-surface.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = path.join(here, "..", "src-tauri", "Cargo.toml");
const repoRoot = path.resolve(here, "..", "..", "..");

const DESKTOP = [
  "x86_64-pc-windows-msvc",
  "aarch64-pc-windows-msvc",
  "x86_64-unknown-linux-gnu",
  "aarch64-unknown-linux-gnu",
  "x86_64-apple-darwin",
  "aarch64-apple-darwin",
];
const MOBILE = [
  "aarch64-linux-android",
  "armv7-linux-androideabi",
  "i686-linux-android",
  "x86_64-linux-android",
  "aarch64-apple-ios",
  "aarch64-apple-ios-sim",
  "x86_64-apple-ios",
];

/** Crates that can open a connection or speak a network protocol. */
export const BANNED = new Set([
  "minreq", "socket2", "mio", "async-io", "nyquest", "net2", "polling", "tokio-rustls", "tokio-native-tls",
  "reqwest", "hyper", "hyper-util", "hyper-tls", "hyper-rustls", "h2", "isahc", "ureq", "attohttpc", "surf", "curl", "curl-sys",
  "rustls", "rustls-native-certs", "webpki-roots", "native-tls", "openssl", "openssl-sys", "schannel",
  "tungstenite", "tokio-tungstenite", "async-tungstenite", "quinn", "trust-dns-resolver", "hickory-resolver",
]);

/** What reqwest drags in on mobile (tauri, development proxy only). Nothing else may be banned and present there. */
export const MOBILE_TAURI_DEV_PROXY = new Set(["reqwest", "hyper", "hyper-util", "socket2", "mio"]);

function cargo(args) {
  const r = spawnSync("cargo", ["tree", "--locked", "--manifest-path", manifest, "--prefix", "none", ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new Error(`could not run cargo: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`cargo tree ${args.join(" ")} failed:\n${r.stderr}`);
  return r.stdout;
}

/** "reqwest v0.13.5 (*)" to "reqwest". */
const crateName = (line) => line.trim().split(/\s+/)[0];

export function bannedCrates(treeOutput) {
  return [...new Set(treeOutput.split("\n").map(crateName).filter((n) => BANNED.has(n)))].sort();
}

export function tokioFeatures(featureTreeOutput) {
  return [...new Set([...featureTreeOutput.matchAll(/^tokio feature "([^"]+)"/gm)].map((m) => m[1]))].sort();
}

function checkTarget(target, mobile) {
  const problems = [];
  const found = bannedCrates(cargo(["--target", target, "-e", "normal,build"]));
  if (!mobile) {
    if (found.length) problems.push(`network crates in the tree: ${found.join(", ")}`);
    const features = tokioFeatures(cargo(["--target", target, "-e", "features", "-i", "tokio"]));
    if (features.includes("net")) problems.push('tokio has its "net" feature on');
  } else {
    const unexpected = found.filter((n) => !MOBILE_TAURI_DEV_PROXY.has(n));
    if (unexpected.length) problems.push(`network crates beyond the known tauri dev-proxy set: ${unexpected.join(", ")}`);
    if (found.includes("reqwest")) {
      const dependents = cargo(["--target", target, "-e", "normal,build", "-i", "reqwest", "--depth", "1"])
        .split("\n").map(crateName).filter(Boolean).slice(1);
      if (dependents.length !== 1 || dependents[0] !== "tauri") problems.push(`reqwest is used by ${dependents.join(", ") || "nothing"}, expected only tauri`);
    }
  }
  return { found, problems };
}

/** The TEST public keys the repository knows: they must never be in a release program. */
function knownTestKeys() {
  const keys = new Set();
  const dir = path.join(here, "..", "src-tauri", "src", "updater");
  for (const [file, pick] of [
    ["testdata/signatures.json", (j) => Object.values(j.keys ?? {})],
    ["testdata/real-tauri.json", (j) => [j.publicKey]],
  ]) {
    try {
      for (const k of pick(JSON.parse(readFileSync(path.join(dir, file), "utf8")))) if (typeof k === "string") keys.add(k);
    } catch {
      // A missing fixture file means there is nothing to look for from it.
    }
  }
  const source = readFileSync(path.join(dir, "keys.rs"), "utf8");
  for (const m of source.matchAll(/"(dW50cnVzdGVkIGNvbW1lbnQ6[A-Za-z0-9+/=]+)"/g)) keys.add(m[1]);
  return [...keys];
}

function main() {
  const argv = process.argv.slice(2);
  const picked = [];
  let exe;
  let sourcesOnly = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--target") picked.push(argv[++i]);
    else if (argv[i] === "--exe") exe = argv[++i];
    else if (argv[i] === "--sources-only") sourcesOnly = true;
  }
  if (argv.includes("--list-crates")) {
    // The names in the lock file, for regenerating approved-crates.txt after a deliberate dependency change.
    const lock = readFileSync(path.join(here, "..", "src-tauri", "Cargo.lock"), "utf8");
    console.log(lockedNames(lock).join("\n"));
    return;
  }
  let failed = false;
  const section = (title, problems) => {
    if (problems.length) {
      failed = true;
      console.log(`FAIL ${title}`);
      for (const p of problems) console.log(`     ${p}`);
    } else console.log(`ok   ${title}`);
  };

  section("sources (WinHTTP, processes and other routes are confined to their files)", checkRepository(repoRoot));
  if (exe) {
    const bytes = readFileSync(exe);
    const imports = peImports(bytes);
    section(`built program ${path.basename(exe)} (imports: ${imports.join(", ")})`, checkBinary(imports, bytes, knownTestKeys()));
  }
  if (!sourcesOnly && !exe) {
    const targets = picked.length ? picked : [...DESKTOP, ...MOBILE];
    for (const target of targets) {
      const mobile = MOBILE.includes(target) || (!DESKTOP.includes(target) && /android|ios/.test(target));
      const { found, problems } = checkTarget(target, mobile);
      if (problems.length) {
        failed = true;
        console.log(`FAIL ${target}`);
        for (const p of problems) console.log(`     ${p}`);
      } else {
        console.log(`ok   ${target}${found.length ? `  (known tauri development-proxy crates: ${found.join(", ")}; not called in release builds)` : ""}`);
      }
    }
  }
  if (failed) {
    console.log("\nSomething that can reach the network, other than the one update check, entered the app. Remove it, or if it is truly needed, the privacy contract needs an owner decision first.");
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
