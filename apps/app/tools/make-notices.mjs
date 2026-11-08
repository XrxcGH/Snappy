/**
 * Writes the third-party notices that ship with the desktop app: every Rust crate compiled into it and the one npm library
 * its page bundles that the web build does not (@tauri-apps/api), each with the license text the crate's authors published.
 *
 *   node apps/app/tools/make-notices.mjs            writes apps/app/src-tauri/notices/THIRD-PARTY-DESKTOP.txt
 *   node apps/app/tools/make-notices.mjs --check    fails (exit 1) when the committed file is not what the lock files give
 *
 * Why: MIT, BSD and Apache licenses require the notice to travel with the binary, and MPL-2.0 requires saying where the
 * source of its files is. The installer ships this file and NOTICE (`bundle.resources` in tauri.conf.json).
 *
 * How: `cargo metadata --locked --offline` for every desktop target (the same list as deny.toml), the crates reachable
 * through normal dependencies (build scripts and test code are not in the program), the license files found in each crate's
 * folder in the Cargo registry, and the npm lock for @tauri-apps/api. The output does not depend on the machine: no paths,
 * no dates, sorted. It records a hash of Cargo.lock, so a test fails when the lock changes and this file does not.
 *
 * Needs cargo and the crates in its registry cache (`cargo fetch --locked` once). No network is used here and no
 * dependency beyond Node itself. The fonts and fflate of the dashboard are not repeated: the Settings page shows their texts.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.join(here, "..");
const repoRoot = path.resolve(appDir, "..", "..");
export const manifestPath = path.join(appDir, "src-tauri", "Cargo.toml");
export const lockPath = path.join(appDir, "src-tauri", "Cargo.lock");
export const outPath = path.join(appDir, "src-tauri", "notices", "THIRD-PARTY-DESKTOP.txt");

/** The desktop targets Snappy ships on or builds for; the same list as `[graph] targets` in deny.toml (a test compares them). */
export const TARGETS = [
  "x86_64-pc-windows-msvc",
  "aarch64-pc-windows-msvc",
  "x86_64-unknown-linux-gnu",
  "aarch64-unknown-linux-gnu",
  "x86_64-apple-darwin",
  "aarch64-apple-darwin",
];

const LICENSE_FILE = /^(licen[cs]e|copying|unlicen[cs]e|notice|copyright)([-_. ].*)?$/i;
const MAX_TEXT_BYTES = 200_000;

const sha = (text) => createHash("sha256").update(text).digest("hex");
const clean = (text) => text.replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").replace(/^﻿/, "").replace(/\n+$/, "") + "\n";
export const lockHash = (lockText) => sha(lockText.replace(/\r\n?/g, "\n"));

/** The crates compiled into the program for one target: reachable from the root through normal dependencies. */
function cratesFor(target) {
  const raw = execFileSync("cargo", ["metadata", "--format-version", "1", "--locked", "--offline", "--filter-platform", target, "--manifest-path", manifestPath], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  const meta = JSON.parse(raw);
  const packages = new Map(meta.packages.map((p) => [p.id, p]));
  const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
  const seen = new Set();
  const stack = [meta.resolve.root];
  while (stack.length > 0) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const dep of nodes.get(id).deps) if (dep.dep_kinds.some((k) => k.kind === null)) stack.push(dep.pkg);
  }
  return { root: meta.resolve.root, crates: [...seen].map((id) => packages.get(id)) };
}

/** The license files a package carries: [{ file, text }] in name order. */
function licenseFilesOf(dir, licenseFile) {
  const names = new Set(readdirSync(dir).filter((n) => LICENSE_FILE.test(n) && statSync(path.join(dir, n)).isFile()));
  if (licenseFile && existsSync(path.join(dir, licenseFile))) names.add(licenseFile);
  const out = [];
  for (const file of [...names].sort()) {
    const p = path.join(dir, file);
    if (statSync(p).size > MAX_TEXT_BYTES) continue;
    out.push({ file: path.basename(file), text: clean(readFileSync(p, "utf8")) });
  }
  return out;
}

/** The npm packages the desktop page bundles on top of the web build, with their license files. */
function npmComponents() {
  const lock = JSON.parse(readFileSync(path.join(repoRoot, "package-lock.json"), "utf8"));
  const out = [];
  for (const name of ["@tauri-apps/api"]) {
    const entry = lock.packages[`node_modules/${name}`];
    if (!entry) throw new Error(`${name} is not in package-lock.json`);
    const dir = path.dirname(createRequire(path.join(repoRoot, "package.json")).resolve(`${name}/package.json`));
    out.push({ name, version: entry.version, license: entry.license ?? "unknown", repository: "https://github.com/tauri-apps/tauri", source: "npm", dir, files: licenseFilesOf(dir, null) });
  }
  return out;
}

export function build() {
  const byKey = new Map();
  for (const target of TARGETS) {
    for (const p of cratesFor(target).crates) {
      if (p.name === "snappy") continue; // the program itself: Apache-2.0, LICENSE and NOTICE ship beside this file
      const key = `${p.name}@${p.version}`;
      if (!byKey.has(key)) byKey.set(key, { name: p.name, version: p.version, license: p.license ?? "", repository: p.repository ?? p.homepage ?? "", authors: p.authors ?? [], source: "crates.io", dir: path.dirname(p.manifest_path), licenseFile: p.license_file, files: null });
    }
  }
  const components = [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version, "en", { numeric: true }));
  for (const c of components) c.files = licenseFilesOf(c.dir, c.licenseFile);
  const npm = npmComponents();
  const all = [...components, ...npm];

  const unfiled = all.filter((c) => c.files.length === 0);
  const missing = unfiled.map((c) => `${c.name} ${c.version}`);
  const noLicense = all.filter((c) => c.license === "").map((c) => `${c.name} ${c.version}`);
  if (noLicense.length > 0) throw new Error(`no license field: ${noLicense.join(", ")}`);

  // One text per distinct content, with the crates that use it.
  const texts = new Map();
  for (const c of all) {
    for (const f of c.files) {
      const id = sha(f.text);
      if (!texts.has(id)) texts.set(id, { text: f.text, users: [] });
      texts.get(id).users.push(`${c.name} ${c.version}`);
    }
  }
  const textList = [...texts.values()].sort((a, b) => a.users[0].localeCompare(b.users[0]) || a.text.localeCompare(b.text));

  const mpl = components.filter((c) => /\bMPL-2\.0\b/.test(c.license));
  const counts = new Map();
  for (const c of all) counts.set(c.license, (counts.get(c.license) ?? 0) + 1);
  const lines = [];
  const push = (...l) => lines.push(...l);
  push(
    "Snappy desktop app: third-party notices",
    "=======================================",
    "",
    "Snappy is licensed under the Apache License 2.0 (the LICENSE file). It is built from the open-source libraries listed here.",
    "Each is used under its own license, listed with it, and the license texts follow. The dashboard's own fonts and its zip",
    "library are listed with their licenses on the Settings page.",
    "",
    `Generated by apps/app/tools/make-notices.mjs from Cargo.lock (sha256 ${lockHash(readFileSync(lockPath, "utf8"))}) and package-lock.json.`,
    `Rust crates: ${components.length}. npm packages bundled into the desktop page: ${npm.length}.`,
    "",
    "Licenses at a glance",
    "--------------------",
    ...[...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([license, n]) => `${String(n).padStart(4)}  ${license}`),
    "",
    "Files covered by MPL-2.0",
    "------------------------",
    "These crates are used as published, with no change to their files. Their source is on crates.io at the version in",
    "apps/app/src-tauri/Cargo.lock; the archive of each is at the address shown. The MPL-2.0 text is below.",
    "",
    ...mpl.map((c) => `- ${c.name} ${c.version} (${c.license})\n    https://crates.io/crates/${c.name}/${c.version}\n    https://static.crates.io/crates/${c.name}/${c.name}-${c.version}.crate`),
    "",
    "Components",
    "----------",
    ...all.map((c) => `- ${c.name} ${c.version}${c.source === "npm" ? " (npm)" : ""}: ${c.license}${c.repository ? `, ${c.repository}` : ""}`),
  );
  if (missing.length > 0) {
    push(
      "",
      "Published without a license file",
      "--------------------------------",
      "These packages name their license in their manifest but publish no license file. They are used under the license named",
      "here, whose standard text is among the license texts below, and the copyright is held by the authors their manifest names.",
      "",
      ...unfiled.map((c) => `- ${c.name} ${c.version}: ${c.license}${c.authors.length ? `; authors: ${c.authors.map((a) => a.replace(/\s*<[^>]*>/, "")).join(", ")}` : ""}`),
    );
  }
  push("", "License texts", "-------------", "Each text is shown once, followed by the packages whose license file it is.", "");
  for (const t of textList) {
    push("*".repeat(78), `Used by: ${t.users.join(", ")}`, "*".repeat(78), "", t.text.trimEnd(), "");
  }
  return { text: lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n", missing, count: components.length, texts: textList.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { text, missing, count, texts } = build();
  if (process.argv.includes("--check")) {
    const current = existsSync(outPath) ? readFileSync(outPath, "utf8").replace(/\r\n?/g, "\n") : "";
    if (current !== text) {
      console.error("apps/app/src-tauri/notices/THIRD-PARTY-DESKTOP.txt is out of date. Run: node apps/app/tools/make-notices.mjs");
      process.exit(1);
    }
    console.log(`The desktop notices are current (${count} crates, ${texts} license texts).`);
  } else {
    mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileSync(outPath, text);
    console.log(`Wrote ${path.relative(repoRoot, outPath)}: ${count} crates, ${texts} license texts${missing.length ? `, ${missing.length} without a license file` : ""}.`);
  }
}
