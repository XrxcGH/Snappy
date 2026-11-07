/**
 * Fails when the Rust dependency tree of the app shell contains a way to make network connections.
 *
 * Snappy's privacy contract is that the app makes no network connections. This check keeps the
 * compiled-in code honest: it asks Cargo for the dependency tree of every release target and fails
 * when an HTTP client, a TLS library, a WebSocket library or the async runtime's socket support shows up.
 *
 *   node apps/app/tools/check-no-network-deps.mjs [--target <triple> ...]
 *
 * Needs cargo and a network the first time (Cargo downloads crate metadata). Build time only; the app makes no calls.
 *
 * Desktop targets (Windows, macOS, Linux) must be completely clean.
 *
 * Mobile targets (Android, iOS) are a known exception. The `tauri` crate links `reqwest` (and its hyper
 * and tower stack) on those two platforms, but only calls it in development builds, to proxy the dev
 * server to the phone (`#[cfg(all(dev, mobile))]` in tauri/src/protocol/tauri.rs, read in tauri 2.12.5). A release build never
 * calls it. So for mobile the rule is narrower: nothing outside that known set may appear, and `tauri`
 * must be the only crate that depends on `reqwest`. The Android release APK is additionally checked for the
 * INTERNET permission in the release workflow, because that is the check the operating system enforces.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = path.join(here, "..", "src-tauri", "Cargo.toml");

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
  "reqwest", "hyper", "hyper-util", "hyper-tls", "hyper-rustls", "h2", "isahc", "ureq", "attohttpc", "surf", "curl", "curl-sys",
  "rustls", "rustls-native-certs", "webpki-roots", "native-tls", "openssl", "openssl-sys", "schannel",
  "tungstenite", "tokio-tungstenite", "async-tungstenite", "quinn", "trust-dns-resolver", "hickory-resolver",
]);

/** What reqwest drags in on mobile (tauri, development proxy only). Nothing else may be banned and present there. */
export const MOBILE_TAURI_DEV_PROXY = new Set(["reqwest", "hyper", "hyper-util"]);

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

function main() {
  const argv = process.argv.slice(2);
  const picked = [];
  for (let i = 0; i < argv.length; i++) if (argv[i] === "--target") picked.push(argv[++i]);
  const targets = picked.length ? picked : [...DESKTOP, ...MOBILE];
  let failed = false;
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
  if (failed) {
    console.log("\nA dependency that can reach the network entered the app. Remove it, or if it is truly needed, the privacy contract needs an owner decision first.");
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
