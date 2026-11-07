/**
 * Open the built dashboard in a local Android emulator, with nothing leaving this computer.
 *
 * It starts the emulator from an Android Virtual Device you already have (Android Studio >
 * Device Manager), starts the dashboard's loopback-only server, and uses `adb reverse` so the
 * phone's own "localhost:PORT" reaches that server over the debug cable. No port is opened to
 * the network. With --offline the emulator's Wi-Fi and mobile data are switched off first, so
 * you can see the dashboard work with no connection at all.
 *
 *   npm run build:dashboard
 *   node tools/mobile/android.mjs [--avd Pixel_7a] [--port 4317] [--memory 4096] [--offline] [--stop]
 *
 * Needs the Android SDK (ANDROID_HOME, or the default Android Studio location) with the
 * platform-tools and emulator packages. No npm dependencies.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const exe = process.platform === "win32" ? ".exe" : "";

function parseArgs(argv) {
  const out = { avd: undefined, port: 4317, memory: 4096, offline: false, stop: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--avd") out.avd = argv[++i];
    else if (a === "--port") out.port = Number(argv[++i]);
    else if (a === "--memory") out.memory = Number(argv[++i]);
    else if (a === "--offline") out.offline = true;
    else if (a === "--stop") out.stop = true;
    else throw new Error(`Unknown option: ${a}`);
  }
  if (!Number.isInteger(out.port) || out.port < 1024 || out.port > 65535) throw new Error("--port must be 1024 to 65535");
  return out;
}

function findSdk() {
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    process.platform === "win32" && process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Android", "Sdk"),
    path.join(os.homedir(), "Library", "Android", "sdk"),
    path.join(os.homedir(), "Android", "Sdk"),
  ].filter(Boolean);
  const sdk = candidates.find((c) => existsSync(path.join(c, "platform-tools", `adb${exe}`)));
  if (!sdk) throw new Error("Android SDK not found. Install Android Studio, or set ANDROID_HOME.");
  return sdk;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
}

function portOpen(port) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host: "127.0.0.1" });
    s.once("connect", () => { s.destroy(); resolve(true); });
    s.once("error", () => resolve(false));
  });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const sdk = findSdk();
  const adb = path.join(sdk, "platform-tools", `adb${exe}`);
  const emulator = path.join(sdk, "emulator", `emulator${exe}`);
  const adbRun = (...a) => run(adb, a);

  if (opts.stop) {
    adbRun("emu", "kill");
    console.log("Emulator stopped.");
    return;
  }

  const page = path.join(root, "apps", "dashboard", "dist", "index.html");
  if (!existsSync(page)) throw new Error("The dashboard is not built. Run: npm run build:dashboard");

  adbRun("start-server");
  const running = () => /emulator-\d+\s+device/.test(adbRun("devices").out);
  if (!running()) {
    if (!existsSync(emulator)) throw new Error("The emulator package is not installed (Android Studio > SDK Manager > SDK Tools).");
    const avds = run(emulator, ["-list-avds"]).out.split(/\r?\n/).filter(Boolean);
    const avd = opts.avd ?? avds[0];
    if (!avd || !avds.includes(avd)) throw new Error(`No such virtual device. Found: ${avds.join(", ") || "none"}. Create one in Android Studio > Device Manager.`);
    console.log(`Starting ${avd}...`);
    // -no-snapshot-save keeps test runs from writing the phone's state back to disk.
    // 4 GB of phone memory: the 2 GB default of many virtual devices makes Chrome get killed on Play images.
    spawn(emulator, ["-avd", avd, "-memory", String(opts.memory), "-no-snapshot-save", "-no-boot-anim", "-no-audio"], { detached: true, stdio: "ignore" }).unref();
  }

  adbRun("wait-for-device");
  for (let i = 0; i < 180; i++) {
    if (adbRun("shell", "getprop", "sys.boot_completed").out.trim() === "1") break;
    if (i === 179) throw new Error("The emulator did not finish starting in 6 minutes.");
    await sleep(2000);
  }

  if (!(await portOpen(opts.port))) {
    spawn(process.execPath, [path.join(root, "apps", "dashboard", "serve.mjs"), "--port", String(opts.port)], { detached: true, stdio: "ignore" }).unref();
    for (let i = 0; i < 25 && !(await portOpen(opts.port)); i++) await sleep(200);
  }

  const rev = adbRun("reverse", `tcp:${opts.port}`, `tcp:${opts.port}`);
  if (!rev.ok) throw new Error(`adb reverse failed: ${rev.out}`);

  if (opts.offline) {
    adbRun("shell", "svc", "wifi", "disable");
    adbRun("shell", "svc", "data", "disable");
    console.log("Wi-Fi and mobile data are off in the emulator.");
  }

  const url = `http://localhost:${opts.port}/`;
  const open = adbRun("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", url);
  if (!open.ok) throw new Error(`Could not open the browser: ${open.out}`);
  console.log(`Opened ${url} in the emulator. Stop it with: node tools/mobile/android.mjs --stop`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
