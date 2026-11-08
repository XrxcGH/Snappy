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
 * real Snappy open: the test program is named snappy-e2e.exe, so a real Snappy (snappy.exe) is neither counted by the test app's
 * updater nor ended by the drill, which stops only processes that run from the test app's own install folder.
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
// The test build has its own program name (mainBinaryName in tauri.e2e.conf.json), so a real Snappy (snappy.exe) is never mistaken
// for it, by this drill or by the updater, which counts other copies by program file name.
const EXE = path.join(INSTALL_DIR, "snappy-e2e.exe");
const results = [];
const log = (m) => console.log(m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ps = (script) => execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8" }).trim();

// --reuse <folder>: the folder a run kept with --keep (its test keys and its three installers). Nothing is made or built again,
// and the folder is left in place, so a scenario can be repeated in a minute instead of after three builds.
const reuse = args.includes("--reuse") ? path.resolve(args[args.indexOf("--reuse") + 1]) : null;
const work = reuse ?? mkdtempSync(path.join(os.tmpdir(), "snappy-e2e-"));
// Arguments go through the shell (npx.cmd), where an empty value would vanish and a spaced one would split: quote them.
const quote = (a) => (a === "" ? '""' : /\s/.test(a) ? `"${a}"` : a);
const tauri = (...a) => spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", ["tauri", ...a.map(quote)], { cwd: appDir, encoding: "utf8", shell: true });

// ------------------------------------------------------------------------------------------------ keys (TEST only, never kept)
function makeKey(name) {
  const file = path.join(work, `${name}.key`);
  if (reuse) return { file, pub: readFileSync(`${file}.pub`, "utf8").trim() };
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
  const kept = path.join(work, `Snappy_${version}_x64-setup.exe`);
  if (reuse) {
    if (!existsSync(kept)) throw new Error(`--reuse: ${kept} is missing`);
    log(`reusing ${kept}`);
    return kept;
  }
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
/**
 * Ends the test app and what it started, and nothing else: the processes whose program file is inside the test app's own
 * install folder, and web engine processes that use the test app's own profile folder (they can outlive the app). Found by
 * path, never by image name, which would also end a real Snappy that is open.
 */
const stop = () => {
  const dir = INSTALL_DIR.replace(/'/g, "''");
  const profile = path.basename(DATA_DIR).replace(/'/g, "''");
  const mine = `($_.ProcessId -ne $PID) -and (($_.ExecutablePath -and $_.ExecutablePath.StartsWith('${dir}\\', [StringComparison]::OrdinalIgnoreCase)) -or ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -and $_.CommandLine.IndexOf('${profile}', [StringComparison]::OrdinalIgnoreCase) -ge 0))`;
  const script = `Get-CimInstance Win32_Process | Where-Object { ${mine} } | ForEach-Object { & taskkill /PID $_.ProcessId /F /T 2>&1 | Out-Null }`;
  spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { stdio: "ignore" });
};
const state = () => (existsSync(path.join(UPDATES, "updater.json")) ? JSON.parse(readFileSync(path.join(UPDATES, "updater.json"), "utf8")) : {});
const seed = (patch) => {
  mkdirSync(UPDATES, { recursive: true });
  writeFileSync(path.join(UPDATES, "updater.json"), JSON.stringify({ notice_seen: true, auto: true, ...patch }));
};
/**
 * Removes the test app's program and its installer record, and keeps its data. The uninstaller is run in place (`_?=`, which
 * must come last) so that it finishes before this returns. Needed before every fresh baseline: the installer refuses a
 * silent downgrade (allowDowngrades is false), so installing 0.9.1 over the 0.9.2 an earlier scenario left would fail.
 */
const uninstall = () => {
  stop();
  const exe = path.join(INSTALL_DIR, "uninstall.exe");
  // Verbatim: the installer wants the folder after `_?=` as the rest of the command line, unquoted, spaces and all.
  if (existsSync(exe)) spawnSync(exe, ["/S", `_?=${INSTALL_DIR}`], { stdio: "ignore", windowsVerbatimArguments: true });
  rmSync(INSTALL_DIR, { recursive: true, force: true });
};
const install = (installer) => {
  uninstall();
  execFileSync(installer, ["/S"], { stdio: "ignore" });
  if (!existsSync(EXE)) throw new Error("the silent install did not make the program");
};
/** Everything the drill put on this computer: the test app, its data, and the installer's registry key. */
const removeEverything = () => {
  uninstall();
  // The web engine's processes take a moment to let go of the profile after the app is stopped: retry for up to 30 seconds.
  const retry = { recursive: true, force: true, maxRetries: 60, retryDelay: 500 };
  rmSync(DATA_DIR, retry);
  rmSync(path.join(process.env.APPDATA, "com.snappy.e2e"), retry);
  // A silent install makes the desktop shortcut, as Tauri's template does. The uninstaller removes it, but a run cut short may not have.
  ps(`Remove-Item -LiteralPath (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Snappy E2E.lnk') -Force -ErrorAction SilentlyContinue; exit 0`);
  ps(`Remove-Item -LiteralPath 'HKCU:\\Software\\Snappy contributors\\Snappy E2E' -Recurse -Force -ErrorAction SilentlyContinue; if (-not (Get-ChildItem 'HKCU:\\Software\\Snappy contributors' -ErrorAction SilentlyContinue)) { Remove-Item -LiteralPath 'HKCU:\\Software\\Snappy contributors' -Force -ErrorAction SilentlyContinue }`);
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
    const staged = await waitFor(() => state().staged?.version === V.next, 120_000);
    record("update: found, downloaded, verified and staged", staged, `${JSON.stringify(state())} requests=${JSON.stringify(server.requests.map((r) => r.path))}`);
    record("update: exactly one manifest request and one installer request", server.requests.filter((r) => r.path.includes("latest.json")).length === 1 && server.requests.filter((r) => r.path.endsWith("setup.exe")).length === 1);
    record("update: User-Agent is Snappy-Updater and nothing else identifying was sent", server.requests.every((r) => r.headers["user-agent"] === "Snappy-Updater" && !r.headers.cookie && !r.headers.referer && !r.headers.authorization));
    const stagedFile = path.join(UPDATES, "ready", `Snappy_${V.next}_x64-setup.exe`);
    record("update: the staged installer carries no Mark-of-the-Web (no Zone.Identifier stream)", !ps(`Get-Item -LiteralPath '${stagedFile}' -Stream * | Select-Object -ExpandProperty Stream`).includes("Zone.Identifier"));
    stop();
    launch(server.base); // the next launch applies the staged update before the window opens
    const updated = await waitFor(() => installedVersion() === V.next, 180_000, 2000);
    record("update: relaunch installs the new version with no administrator prompt (per-user)", updated, installedVersion());
    record("update: the app's own data survived (sentinel file)", existsSync(sentinel) && readFileSync(sentinel, "utf8") === "keep me");
    // The installer relaunches the app without this drill's environment variable, so that copy has no updater in this test build.
    // A launch with the variable is the updated program's own start-up, which is what clears the staged installer.
    stop();
    launch(server.base);
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
    // These two carry a real signature (any non-empty one passes the manifest check), so the manifest is accepted and the
    // version comparison is what decides. With an empty signature it would be refused earlier, as NoSignature, and the
    // test would pass even if the comparison were deleted.
    ["downgrade", () => ({ version: "0.9.0" }), null],
    ["same-version", () => ({ version: V.base }), null],
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
    if (errorCode === "manifest") {
      // A manifest that is refused is answered live ("manifest" in the page's status) and is not written to updater.json,
      // so the saved file shows it as: asked (last_attempt_unix), never accepted (last_checked_unix is still 0), no error saved.
      record(`${name}: the manifest was refused (asked, never counted as a check, no error saved)`, s.last_attempt_unix > 0 && !s.last_checked_unix && !s.last_error, JSON.stringify(s));
    } else {
      record(`${name}: the error is ${errorCode ?? "none (nothing newer)"}`, (s.last_error ?? null) === errorCode, JSON.stringify(s));
    }
    if (errorCode === null) {
      // The version comparison made the decision: the manifest was accepted (counted as a check) and the installer was never asked for.
      const manifests = server.requests.filter((r) => r.path.includes("latest.json")).length;
      const installers = server.requests.filter((r) => r.path.endsWith("setup.exe")).length;
      record(`${name}: the manifest was accepted and counted, and the installer was never requested`, s.last_checked_unix > 0 && manifests >= 1 && installers === 0, `${JSON.stringify(s)} manifests=${manifests} installers=${installers}`);
    }
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
    const staged = await waitFor(() => state().staged?.version === V.rotated, 120_000);
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
  // Leave nothing behind: not the test app, not its data, not its registry key. --keep leaves the test folder (keys and
  // installers) for --reuse, and the app too, so a scenario can be looked at by hand.
  let cleaned = true;
  if (!keep) {
    try {
      removeEverything();
    } catch (e) {
      cleaned = false;
      log(`could not remove everything: ${e.message}`);
    }
  }
  if (!keep && !reuse) rmSync(work, { recursive: true, force: true });
  const failed = results.filter((r) => !r.ok);
  log(`\n${results.length - failed.length} passed, ${failed.length} failed. The checks that stay manual are listed in README.md.`);
  log(keep ? "--keep: the test app (Snappy E2E) and its data stay. Remove it from Apps and features and delete %LOCALAPPDATA%\\com.snappy.e2e." : cleaned ? "The test app, its data and its registry key were removed." : "NOT everything was removed (see above): remove Snappy E2E from Apps and features, delete %LOCALAPPDATA%\\com.snappy.e2e and HKCU\\Software\\Snappy contributors\\Snappy E2E by hand.");
  process.exitCode = failed.length ? 1 : 0;
}
