/**
 * Take real screenshots of the dashboard running in Chrome on the Android emulator.
 *
 * It starts the emulator the same way tools/mobile/android.mjs does (loopback-only server, `adb reverse`),
 * loads the built-in SYNTHETIC sample data (invented usernames, nothing from any account), visits each
 * screen, and saves the whole phone screen (status bar and browser chrome included) in light and dark.
 * Chrome is driven over the debugging port that adb forwards to this computer only.
 *
 *   npm run build:dashboard
 *   PLAYWRIGHT_DIR=<folder with playwright installed> node tools/mobile/android-capture.mjs [--out docs/images/android] [--port 4317]
 *
 * Needs the Android SDK and a virtual device (see android.mjs) and Playwright (see ios-webkit.mjs).
 */
import { spawnSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { showTheme } from "../screenshots/theme.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const exe = process.platform === "win32" ? ".exe" : "";
const SCREENS = ["overview", "disappeared", "requests", "quiet", "cleanup", "memories", "privacy", "guide", "settings"];

function parseArgs(argv) {
  const out = { out: path.join(root, "docs", "images", "android"), port: 4317 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") out.out = path.resolve(argv[++i]);
    else if (argv[i] === "--port") out.port = Number(argv[++i]);
    else throw new Error(`Unknown option: ${argv[i]}`);
  }
  return out;
}

function findAdb() {
  const candidates = [
    process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT,
    process.platform === "win32" && process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Android", "Sdk"),
    path.join(os.homedir(), "Library", "Android", "sdk"), path.join(os.homedir(), "Android", "Sdk"),
  ].filter(Boolean);
  const sdk = candidates.find((c) => existsSync(path.join(c, "platform-tools", `adb${exe}`)));
  if (!sdk) throw new Error("Android SDK not found. Install Android Studio, or set ANDROID_HOME.");
  return path.join(sdk, "platform-tools", `adb${exe}`);
}

function loadPlaywright() {
  for (const dir of [process.env.PLAYWRIGHT_DIR, root].filter(Boolean)) {
    try { return createRequire(path.join(path.resolve(dir), "noop.js"))("playwright"); } catch { /* next */ }
  }
  throw new Error("Playwright was not found. See the install steps in tools/mobile/ios-webkit.mjs.");
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const adb = findAdb();
  const sh = (...a) => spawnSync(adb, a, { encoding: "utf8" });
  const start = spawnSync(process.execPath, [path.join(root, "tools", "mobile", "android.mjs"), "--port", String(opts.port)], { stdio: "inherit" });
  if (start.status) throw new Error("Could not start the emulator.");
  mkdirSync(opts.out, { recursive: true });

  // Chrome's debugging socket is forwarded to 127.0.0.1 only.
  const fw = sh("forward", "tcp:9333", "localabstract:chrome_devtools_remote");
  if (fw.status) throw new Error(`adb forward failed: ${fw.stderr}`);
  const { chromium } = loadPlaywright();
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9333");
  try {
    const page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith(`http://localhost:${opts.port}`));
    if (!page) throw new Error("The dashboard tab was not found in Chrome on the emulator.");
    for (const scheme of ["light", "dark"]) {
      sh("shell", "cmd", "uimode", "night", scheme === "dark" ? "yes" : "no");
      await page.waitForTimeout(1200);
      // The theme choice is remembered in this browser, so forget the last pass's choice first: every pass starts from the default.
      await page.evaluate(() => { try { localStorage.removeItem("snappy-theme"); } catch { /* blocked */ } });
      await page.reload({ waitUntil: "load" });
      await page.getByRole("button", { name: "Use sample data" }).click();
      await page.waitForTimeout(2500);
      // Dark is the dashboard's default whatever the device says, so each pass sets its theme with the header toggle and the
      // helper verifies the page really rendered in it.
      await showTheme(page, scheme);
      for (const id of SCREENS) {
        await page.evaluate((h) => { location.hash = h; window.scrollTo(0, 0); }, `#/${id}`);
        await page.waitForTimeout(600);
        const shot = spawnSync(adb, ["exec-out", "screencap", "-p"], { maxBuffer: 1e8 });
        if (shot.status) throw new Error("screencap failed");
        const file = path.join(opts.out, `${id}-${scheme}.png`);
        await new Promise((res, rej) => { const w = createWriteStream(file); w.on("finish", res); w.on("error", rej); w.end(shot.stdout); });
        console.log("wrote", path.relative(root, file));
      }
    }
  } finally {
    await browser.close();
    sh("forward", "--remove", "tcp:9333");
    sh("shell", "cmd", "uimode", "night", "no");
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
