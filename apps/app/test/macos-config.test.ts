/**
 * Guards for the macOS build: what the bundle promises (format, signature, version strings, oldest system), and that
 * the Windows-only parts of the shell stay behind `cfg(windows)` so the macOS build compiles and behaves. The macOS
 * program itself is built and started only on GitHub's runners (desktop-smoke.yml); these tests read the files.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import pkg from "../package.json" with { type: "json" };

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const tauri = path.join(root, "src-tauri");
const read = (...p: string[]): string => readFileSync(path.join(root, ...p), "utf8");

type MacConfig = {
  minimumSystemVersion?: string;
  signingIdentity?: string;
  hardenedRuntime?: boolean;
  bundleVersion?: string;
  entitlements?: string;
  exceptionDomain?: string;
  providerShortName?: string;
  frameworks?: string[];
  files?: Record<string, string>;
  dmg?: { windowSize?: { width: number; height: number } };
};
const conf = JSON.parse(read("src-tauri", "tauri.conf.json")) as {
  identifier: string;
  version: string;
  bundle: { targets: string | string[]; category?: string; icon: string[]; licenseFile?: string; macOS?: MacConfig };
};
/** Tauri merges tauri.macos.conf.json over tauri.conf.json when it builds for macOS, so the macOS settings live apart from the shared ones. */
const macConf = JSON.parse(read("src-tauri", "tauri.macos.conf.json")) as { bundle: { licenseFile?: string | null; macOS?: MacConfig } };
const mac = macConf.bundle.macOS ?? {};
const lib = read("src-tauri", "src", "lib.rs");
const cargo = read("src-tauri", "Cargo.toml");

/** The string value of a top-level key in the plist's dict. Comments are ignored because they hold no <key> element. */
const plistValue = (plist: string, key: string): string | undefined => new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(plist)?.[1];

describe("macOS bundle config", () => {
  it("keeps the identifier the other platforms use, and builds the app and the disk image", () => {
    expect(conf.identifier).toBe("com.snappy.export");
    // "all" is what each system resolves for itself (app and dmg on macOS); CI names them with --bundles dmg,app.
    expect(conf.bundle.targets).toBe("all");
    expect(conf.bundle.category).toBe("Utility"); // Tauri writes public.app-category.utilities on macOS; the smoke test reads it back
    expect(conf.bundle.icon).toContain("icons/icon.icns");
  });

  it("is ad-hoc signed, with the hardened runtime off, no entitlements and no network exception", () => {
    expect(mac.signingIdentity).toBe("-");
    expect(mac.hardenedRuntime).toBe(false);
    expect(mac.entitlements).toBeUndefined();
    expect(mac.exceptionDomain).toBeUndefined();
    expect(mac.providerShortName).toBeUndefined();
    expect(mac.frameworks).toBeUndefined();
    expect(existsSync(path.join(tauri, "entitlements.plist"))).toBe(false);
    expect(existsSync(path.join(tauri, "Entitlements.plist"))).toBe(false);
  });

  it("keeps the macOS settings in tauri.macos.conf.json, so the shared config stays as it is for every other platform", () => {
    expect(conf.bundle.macOS).toBeUndefined();
    expect(Object.keys(macConf.bundle).sort()).toEqual(["licenseFile", "macOS"]);
  });

  it("shows no license agreement when the disk image is opened, and puts the license and notice inside the app instead", () => {
    // The shared config names the license file (the Windows and Linux installers show it). Tauri would also turn it into a
    // click-through agreement on the disk image, which is wrong for an Apache-2.0 program, so this platform drops it.
    expect(conf.bundle.licenseFile).toBe("../../../LICENSE");
    expect(macConf.bundle.licenseFile).toBeNull();
    expect(mac.files).toEqual({ "Resources/LICENSE": "../../../LICENSE", "Resources/NOTICE": "../../../NOTICE" });
    for (const source of Object.values(mac.files ?? {})) expect(existsSync(path.join(tauri, source))).toBe(true);
  });

  it("asks for macOS 12.3 or newer: the first release that ships WebKit 15.4, which the bundled script needs", () => {
    // The page is built for es2022 and uses Object.hasOwn and navigator.locks, both added in Safari 15.4, which macOS 12.3 includes.
    // Nothing below the runner's own macOS is tested, so this is the lowest value that can be argued, not one that was run.
    expect(mac.minimumSystemVersion).toBe("12.3");
    const build = readFileSync(path.join(root, "..", "dashboard", "build.mjs"), "utf8");
    expect(build).toMatch(/target: \["es2022"\]/);
  });

  it("uses dotted numbers for the macOS version strings, and keeps the beta tag in its own key", () => {
    const plist = readFileSync(path.join(tauri, "Info.plist"), "utf8");
    const dotted = pkg.version.replace(/-.*$/, "");
    expect(dotted).toMatch(/^\d+\.\d+\.\d+$/);
    expect(plistValue(plist, "CFBundleShortVersionString")).toBe(dotted);
    expect(mac.bundleVersion).toBe(dotted);
    expect(plistValue(plist, "SnappyReleaseVersion")).toBe(pkg.version);
    expect(conf.version).toBe(pkg.version);
    // Nothing else is merged in: a key here that nobody listed could change what the app is allowed to do.
    const keys = [...plist.matchAll(/<key>([^<]+)<\/key>/g)].map((m) => m[1]);
    expect(keys.sort()).toEqual(["CFBundleShortVersionString", "SnappyReleaseVersion"]);
  });

  it("has a real icns file, made by `tauri icon` from the brand icon", () => {
    const icns = readFileSync(path.join(tauri, "icons", "icon.icns"));
    expect(icns.subarray(0, 4).toString("latin1")).toBe("icns");
    expect(icns.length).toBeGreaterThan(10_000);
    expect(icns.readUInt32BE(4)).toBe(icns.length);
  });
});

describe("the shell on macOS", () => {
  it("keeps every Windows-only line of code behind cfg(windows), with a no-op everywhere else", () => {
    expect(lib).toMatch(/#\[cfg\(windows\)\]\s*fn harden_webview2\(window: &WebviewWindow\)/);
    expect(lib).toMatch(/#\[cfg\(not\(windows\)\)\]\s*fn harden_webview2\(_window: &WebviewWindow\) \{\}/);
    // The browser switches and the WebView2 environment hook are Windows names, and nothing here reads them on another system.
    expect(lib).toMatch(/#\[cfg\(all\(windows, feature = "dev-hooks"\)\)\]/);
    const winOnly = cargo.split("[target.'cfg(windows)'.dependencies]")[1]?.split("[features]")[0] ?? "";
    expect(winOnly).toMatch(/webview2-com/);
    expect(winOnly).toMatch(/windows-core/);
    const rest = cargo.replace(winOnly, "");
    expect(rest).not.toMatch(/webview2|windows-core|windows-sys/);
  });

  it("adds no macOS-only dependency, no menu code of its own and no Objective-C: it uses Tauri's default menu and web view", () => {
    expect(cargo).not.toMatch(/target_os = "macos"|cocoa|objc|core-foundation|tauri-plugin-macos/);
    expect(lib).not.toMatch(/target_os = "macos"|\.menu\(|NSApp|objc/);
  });

  it("applies the navigation lock and the new-window refusal on every system, not only on Windows", () => {
    const setup = lib.slice(lib.indexOf("WebviewWindowBuilder::from_config"), lib.indexOf("harden_webview2(&window)"));
    expect(setup).toMatch(/\.on_navigation\(allow_navigation\)/);
    expect(setup).toMatch(/\.on_new_window\(\|_url, _features\| NewWindowResponse::Deny\)/);
    // Both calls sit outside every cfg block.
    expect(setup.slice(0, setup.indexOf(".on_new_window"))).not.toMatch(/#\[cfg/);
  });

  it("accepts the address macOS serves the page from (tauri://localhost) and reads files with a read-only positional read on unix", () => {
    expect(lib).toMatch(/"tauri" => plain && url\.host_str\(\) == Some\("localhost"\)/);
    const readonly = read("src-tauri", "src", "readonly.rs");
    expect(readonly).toMatch(/#\[cfg\(unix\)\][\s\S]{0,120}FileExt::read_at/);
  });
});
