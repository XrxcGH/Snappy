/**
 * The end-to-end update drill for Windows. Run it BY HAND, ideally in Windows Sandbox or a throwaway virtual machine.
 *
 *   node apps/app/test/e2e-update/run-e2e.mjs [--list] [--only <name>[,<name>]] [--keep]
 *
 * NOT RUN by the session that wrote it: it builds three test installers, installs one, starts the app (a window opens),
 * lets it update itself from a loopback server and checks the result. See README.md in this folder for what it needs, what
 * it proves and the checks that stay manual.
 *
 * Safety: the test build has its own identity (productName "Snappy E2E", identifier com.snappy.e2e, see
 * tauri.e2e.conf.json), so its install folder (%LOCALAPPDATA%\Snappy E2E), its registry key and its data
 * (%LOCALAPPDATA%\com.snappy.e2e) are separate from a real Snappy. It trusts only TEST keys made fresh in a temporary folder
 * (the private keys are never kept and never printed), and it talks only to a server bound to 127.0.0.1. Do not run it with a
 * real Snappy open: the updater refuses to run while another snappy.exe exists, and the drill would report that.
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startFakeGithub } from "./fake-github.mjs";
import { overlayFor } from "./overlay.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, "..", "..");
const args = process.argv.slice(2);
const only = args.includes("--only") ? new Set(args[args.indexOf("--only") + 1].split(",")) : null;
const keep = args.includes("--keep");

if (process.platform !== "win32") {
  console.error("The update drill is for Windows.");
  process.exit(2);
}

const V = { base: "0.9.1", next: "0.9.2", rotated: "0.9.3" };
const LOCAL = process.env.LOCALAPPDATA;
const INSTALL_DIR = path.join(LOCAL, "Snappy E2E");
const DATA_DIR = path.join(LOCAL, "com.snappy.e2e");
const UPDATES = path.join(DATA_DIR, "updates");
const EXE = path.join(INSTALL_DIR, "snappy.exe");
const results = [];
const log = (m) => console.log(m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ps = (script) => execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8" }).trim();

const work = mkdtempSync(path.join(os.tmpdir(), "snappy-e2e-"));
// Arguments go through the shell (npx.cmd), where an empty value would vanish and a spaced one would split: quote them.
const quote = (a) => (a === "" ? '""' : /\s/.test(a) ? `"${a}"` : a);
const tauri = (...a) => spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", ["tauri", ...a.map(quote)], { cwd: appDir, encoding: "utf8", shell: true });

// ------------------------------------------------------------------------------------------------ keys (TEST only, never kept)
function makeKey(name) {
  const file = path.join(work, `${name}.key`);
  const r = tauri("signer", "generate", "-w", file, "-p", "", "--ci", "-f");
  if (r.status !== 0) throw new Error(`could not make the test key ${name}`);
  return { file, pub: readFileSync(`${file}.pub`, "utf8").trim() };
}
const sign = (key, file, version) => {
  const r = tauri("signer", "sign", "-f", key.file, "-p", "", "--app-version", version, file);
  if (r.status !== 0) throw new Error(`signing failed: ${r.stderr}`);
  return readFileSync(`${file}.sig`, "utf8").trim();
};

// ------------------------------------------------------------------------------------------------ builds
/** Builds the test installer for `version`, trusting `pubs`, and returns it renamed the way the real release names it. */
function build(version, pubs) {
  log(`building ${version} (trusting ${pubs.length} test key${pubs.length === 1 ? "" : "s"}) ...`);
  const overlay = path.join(work, `conf-${version}.json`);
  writeFileSync(overlay, JSON.stringify(overlayFor(readFileSync(path.join(here, "tauri.e2e.conf.json"), "utf8"), version)));
  const env = { ...process.env, SNAPPY_E2E_VERSION: version, SNAPPY_E2E_PUBKEYS: pubs.join(","), CARGO_TARGET_DIR: path.join(work, "target"), SNAPPY_RELEASE: "" };
  const r = spawnSync("npx.cmd", ["tauri", "build", "--bundles", "nsis", "--config", `"${overlay}"`, "--", "--features", "dev-update-endpoint", "--locked"], { cwd: appDir, env, stdio: "inherit", shell: true });
  if (r.status !== 0) throw new Error(`the build of ${version} failed`);
  const built = path.join(work, "target", "release", "bundle", "nsis", `Snappy E2E_${version}_x64-setup.exe`);
  const named = path.join(work, `Snappy_${version}_x64-setup.exe`);
  copyFileSync(built, named);
  return named;
}

// ------------------------------------------------------------------------------------------------ the machine
const installedVersion = () => (existsSync(EXE) ? ps(`(Get-Item '${EXE}').VersionInfo.ProductVersion`) : "");
const stop = () => spawnSync("taskkill", ["/IM", "snappy.exe", "/F", "/T"], { stdio: "ignore" });
const state = () => (existsSync(path.join(UPDATES, "updater.json")) ? JSON.parse(readFileSync(path.join(UPDATES, "updater.json"), "utf8")) : {});
const seed = (patch) => {
  mkdirSync(UPDATES, { recursive: true });
  writeFileSync(path.join(UPDATES, "updater.json"), JSON.stringify({ notice_seen: true, auto: true, ...patch }));
};
const install = (installer) => {
  stop();
  execFileSync(installer, ["/S"], { stdio: "ignore" });
  if (!existsSync(EXE)) throw new Error("the silent install did not make the program");
};
function launch(endpoint) {
  const child = spawn(EXE, [], { env: { ...process.env, SNAPPY_UPDATE_ENDPOINT: endpoint }, detached: true, stdio: "ignore" });
  child.unref();
}
async function waitFor(condition, ms, step = 500) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (condition()) return true;
    await sleep(step);
  }
  return condition();
}

// ------------------------------------------------------------------------------------------------ scenarios
function record(name, ok, detail = "") {
  results.push({ name, ok });
  log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  ${detail}`}`);
}
const wanted = (name) => !only || only.has(name);

async function main() {
  if (args.includes("--list")) {
    console.log("update, tampered, wrong-key, downgrade, same-version, stripped-signature, wrong-name, wrong-url, redirect-foreign, oversize, no-length, content-encoding, offline, toggle-off, first-launch, rotation");
    return;
  }
  const A = makeKey("signing");
  const B = makeKey("recovery");
  const C = makeKey("new-recovery");
  const base = build(V.base, [A.pub, B.pub]);
  const next = build(V.next, [A.pub, B.pub]);
  const rotated = build(V.rotated, [B.pub, C.pub]); // after a rotation: the recovery key is now the signing key
  const bytes = (f) => readFileSync(f);
  const sig = { next: sign(A, next, V.next), rotated: sign(B, rotated, V.rotated) };

  let published = { version: V.next, installer: bytes(next), signature: sig.next };
  const server = await startFakeGithub(() => published);
  const freshBaseline = async (patch = {}) => {
    install(base);
    rmSync(UPDATES, { recursive: true, force: true });
    seed(patch);
    server.requests.length = 0;
  };
  const sentinel = path.join(DATA_DIR, "sentinel.txt");

  // --- the whole path: found, verified, staged, applied at the next launch, data kept
  if (wanted("update")) {
    await freshBaseline();
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(sentinel, "keep me");
    launch(server.base);
    const staged = await waitFor(() => state().staged?.version === V.next, 60_000);
    record("update: found, downloaded, verified and staged", staged, JSON.stringify(state()));
    record("update: exactly one manifest request and one installer request", server.requests.filter((r) => r.path.includes("latest.json")).length === 1 && server.requests.filter((r) => r.path.endsWith("setup.exe")).length === 1);
    record("update: User-Agent is Snappy-Updater and nothing else identifying was sent", server.requests.every((r) => r.headers["user-agent"] === "Snappy-Updater" && !r.headers.cookie && !r.headers.referer && !r.headers.authorization));
    const stagedFile = path.join(UPDATES, "ready", `Snappy_${V.next}_x64-setup.exe`);
    record("update: the staged installer carries no Mark-of-the-Web (no Zone.Identifier stream)", !ps(`Get-Item -LiteralPath '${stagedFile}' -Stream * | Select-Object -ExpandProperty Stream`).includes("Zone.Identifier"));
    stop();
    launch(server.base); // the next launch applies the staged update before the window opens
    const updated = await waitFor(() => installedVersion() === V.next, 180_000, 2000);
    record("update: relaunch installs the new version with no administrator prompt (per-user)", updated, installedVersion());
    record("update: the app's own data survived (sentinel file)", existsSync(sentinel) && readFileSync(sentinel, "utf8") === "keep me");
    record("update: the staged installer is gone after a successful update", await waitFor(() => !existsSync(stagedFile), 60_000));
    stop();
  }

  // --- releases broken in one particular way: nothing is installed, and the error is the expected one
  const faults = [
    ["tampered", () => ({ installer: Buffer.concat([bytes(next).subarray(0, 100), Buffer.from([1]), bytes(next).subarray(101)]) }), "signature"],
    ["wrong-key", () => ({ signature: sign(C, next, V.next) }), "signature"],
    ["wrong-name", () => ({ signature: sign(A, copyAs(next, `Snappy_${V.next}_x64_en-US.msi`), V.next) }), "signature"],
    ["stripped-signature", () => ({ stripSignature: true }), "manifest"],
    ["wrong-url", () => ({ wrongUrl: true }), "manifest"],
    ["redirect-foreign", () => ({ manifestRedirect: "http://localhost:1/x" }), "policy"],
    ["oversize", () => ({ declaredLength: 64 * 1024 * 1024 + 1 }), "size"],
    ["no-length", () => ({ noLength: true }), "size"],
    ["content-encoding", () => ({ contentEncoding: "gzip" }), "size"],
    ["downgrade", () => ({ version: "0.9.0", signature: "" }), null],
    ["same-version", () => ({ version: V.base, signature: "" }), null],
  ];
  const copyAs = (file, name) => {
    const to = path.join(work, name);
    copyFileSync(file, to);
    return to;
  };
  for (const [name, make, errorCode] of faults) {
    if (!wanted(name)) continue;
    await freshBaseline();
    published = { version: V.next, installer: bytes(next), signature: sig.next, ...make() };
    launch(server.base);
    await sleep(20_000);
    const s = state();
    record(`${name}: nothing is staged or installed`, !s.staged && installedVersion() === V.base, JSON.stringify(s));
    record(`${name}: the error is ${errorCode ?? "none (nothing newer)"}`, (s.last_error ?? null) === errorCode, JSON.stringify(s));
    stop();
  }
  published = { version: V.next, installer: bytes(next), signature: sig.next };

  // --- no request at all
  if (wanted("offline")) {
    await freshBaseline();
    const dead = server.base.replace(/:\d+/, ":9");
    launch(dead);
    await sleep(15_000);
    record("offline: the app starts and stays silent (nothing staged, no failure shown)", !state().staged);
    stop();
  }
  if (wanted("toggle-off")) {
    await freshBaseline({ auto: false });
    launch(server.base);
    await sleep(15_000);
    record("toggle-off: the server saw zero requests", server.requests.length === 0, `${server.requests.length}`);
    stop();
  }
  if (wanted("first-launch")) {
    await freshBaseline();
    rmSync(path.join(UPDATES, "updater.json"), { force: true }); // as on the very first launch: the notice has not been shown
    launch(server.base);
    await sleep(15_000);
    record("first-launch: the server saw zero requests before the first-run notice", server.requests.length === 0, `${server.requests.length}`);
    stop();
  }

  // --- rotation: a release signed by the recovery key is accepted, and the old signing key is then refused
  if (wanted("rotation")) {
    install(next);
    rmSync(UPDATES, { recursive: true, force: true });
    seed();
    published = { version: V.rotated, installer: bytes(rotated), signature: sig.rotated };
    server.requests.length = 0;
    launch(server.base);
    const staged = await waitFor(() => state().staged?.version === V.rotated, 60_000);
    record("rotation: a release signed by the recovery key is accepted by the old list", staged, JSON.stringify(state()));
    stop();
    launch(server.base);
    await waitFor(() => installedVersion() === V.rotated, 180_000, 2000);
    stop();
    const oldKeyRelease = copyAs(rotated, `Snappy_0.9.4_x64-setup.exe`);
    published = { version: "0.9.4", installer: bytes(oldKeyRelease), signature: sign(A, oldKeyRelease, "0.9.4") };
    rmSync(path.join(UPDATES, "updater.json"), { force: true });
    seed();
    launch(server.base);
    await sleep(20_000);
    record("rotation: after it, a release signed by the OLD signing key is refused", !state().staged && installedVersion() === V.rotated, JSON.stringify(state()));
    stop();
  }

  await server.close();
}

try {
  await main();
} finally {
  stop();
  if (!keep) rmSync(work, { recursive: true, force: true });
  const failed = results.filter((r) => !r.ok);
  log(`\n${results.length - failed.length} passed, ${failed.length} failed. The checks that stay manual are listed in README.md.`);
  log("To remove the test app: run its uninstaller from Apps and features (Snappy E2E) and delete %LOCALAPPDATA%\\com.snappy.e2e.");
  process.exitCode = failed.length ? 1 : 0;
}
