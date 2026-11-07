/**
 * Guards for the desktop shell's privacy posture. What the config allows is read from the files
 * themselves, so a plugin, a permission or a window setting that could reach the network, open
 * another page, or write to the person's files cannot be added by accident.
 *
 * What these tests do and do not prove: they read the source files and build the frontend. The
 * behaviour of the finished program (a refused link, an unchanged picked file) is proven by the
 * Rust unit tests (`cargo test --lib` in src-tauri) and by running the built program: see "Checks that
 * need the built program" in the README.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]): string => readFileSync(path.join(root, ...p), "utf8");
const conf = JSON.parse(read("src-tauri", "tauri.conf.json")) as {
  productName: string;
  identifier: string;
  app: {
    windows: { label: string; title: string; create?: boolean; dragDropEnabled?: boolean; additionalBrowserArgs?: string; url?: string }[];
    security: { csp: string; dangerousDisableAssetCspModification?: unknown; assetProtocol?: unknown; dangerousRemoteDomainIpcAccess?: unknown };
    withGlobalTauri?: boolean;
  };
  bundle: { license: string; shortDescription?: string; longDescription?: string; createUpdaterArtifacts?: unknown };
  plugins?: Record<string, unknown>;
};
const capability = JSON.parse(read("src-tauri", "capabilities", "main.json")) as { windows: string[]; permissions: string[]; remote?: unknown };
const cargo = read("src-tauri", "Cargo.toml");
const lib = read("src-tauri", "src", "lib.rs");
const readonlyRs = read("src-tauri", "src", "readonly.rs");
const buildRs = read("src-tauri", "build.rs");

/** Rust source with comments removed, so a rule that forbids a word is not tripped by prose. */
const code = (rs: string): string => rs.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/ .*$/gm, "");
/** Everything before the unit tests, which legitimately create and delete scratch files. */
const production = (rs: string): string => code(rs.split("#[cfg(test)]")[0] ?? rs);

describe("desktop shell config", () => {
  it("is Snappy, with a fixed identifier and Apache-2.0 metadata", () => {
    expect(conf.productName).toBe("Snappy");
    expect(conf.identifier).toBe("com.snappy.export");
    expect(conf.app.windows.map((w) => w.title)).toEqual(["Snappy"]);
    expect(conf.bundle.license).toBe("Apache-2.0");
    expect(cargo).toMatch(/license = "Apache-2\.0"/);
  });

  it("makes no unqualified privacy claim in the installer descriptions", () => {
    // These texts ship in the MSI, deb and rpm. The web engine is Microsoft's or the system's, and it can connect
    // on its own, so only Snappy's own code may be said to make no connections, and the text points at the details.
    const text = `${conf.bundle.shortDescription ?? ""} ${conf.bundle.longDescription ?? ""}`;
    expect(text).not.toMatch(/(?<!Snappy itself )\b(makes?|has|uses?) no (network|internet) (connections?|access|traffic|requests?)/i);
    expect(conf.bundle.longDescription).toMatch(/Snappy itself makes no network connections/);
    expect(conf.bundle.longDescription).toMatch(/Network use/);
    expect(text).not.toMatch(/\b(never|nothing) (leaves|sent|sends)\b|100%|guarantee/i);
  });

  it("holds the dashboard's policy: nothing may connect, no remote anything", () => {
    const csp = conf.app.security.csp;
    expect(csp).toMatch(/(^|; )default-src 'none'/);
    expect(csp).toMatch(/(^|; )connect-src 'none'(;|$)/);
    expect(csp).toMatch(/(^|; )worker-src blob:(;|$)/);
    expect(csp).toMatch(/(^|; )form-action 'none'(;|$)/);
    expect(csp).toMatch(/(^|; )frame-src 'none'(;|$)/);
    expect(csp).not.toMatch(/https?:|\*|unsafe-/);
    expect(conf.app.security.dangerousDisableAssetCspModification).toBeUndefined();
    expect(conf.app.security.assetProtocol).toBeUndefined();
    expect(conf.app.security.dangerousRemoteDomainIpcAccess).toBeUndefined();
  });

  it("has no updater and no remote URL anywhere in the config", () => {
    expect(conf.bundle.createUpdaterArtifacts).toBeUndefined();
    expect(conf.plugins?.updater).toBeUndefined();
    expect(JSON.stringify(conf)).not.toMatch(/"url"\s*:\s*"https?:/);
    expect(conf.app.windows.every((w) => w.url === undefined)).toBe(true); // the window shows the bundled page
    expect(capability.remote).toBeUndefined();
    expect(capability.windows).toEqual(["main"]);
  });
});

describe("navigation lock", () => {
  it("creates the window in code, so it carries the handlers, and the config does not create a second unguarded one", () => {
    expect(conf.app.windows).toHaveLength(1);
    expect(conf.app.windows[0]?.label).toBe("main");
    expect(conf.app.windows[0]?.create).toBe(false);
    expect(lib).toMatch(/WebviewWindowBuilder::from_config\(/);
  });

  it("refuses every address except the app's own, and every new window", () => {
    const c = production(lib);
    expect(c).toMatch(/\.on_navigation\(allow_navigation\)/);
    expect(c).toMatch(/\.on_new_window\(\|_url, _features\| NewWindowResponse::Deny\)/);
    expect(c).not.toMatch(/NewWindowResponse::Create/);
    // the allow-list itself: two schemes for the bundled page, and blob: only when it wraps the same
    const fn = /pub fn allow_navigation[\s\S]*?\n}\n/.exec(c)?.[0] ?? "";
    expect(fn).toMatch(/"tauri" => .*"localhost"/);
    expect(fn).toMatch(/"http" \| "https" => .*"tauri\.localhost"/);
    expect(fn).toMatch(/_ => false/);
    expect(fn).not.toMatch(/about|data|file|127\.0\.0\.1|example/);
  });

  it("registers no plugin that can open an address, and does not let the OS drop files into the page", () => {
    expect(lib).not.toMatch(/tauri_plugin_(http|shell|opener|updater|process|os|log|store|fs|deep_link|websocket)/);
    expect(conf.app.windows[0]?.dragDropEnabled).toBe(false); // the dashboard's own drop zone gets real Files, and no path leaks
  });
});

describe("read-only guarantee", () => {
  it("grants the page only three read-only commands of our own, and no fs, dialog or core permission", () => {
    expect([...capability.permissions].sort()).toEqual(["allow-close-file", "allow-pick-zips", "allow-read-range"]);
    for (const p of capability.permissions) expect(p).not.toMatch(/^(fs|dialog|shell|http|opener|updater|process|os|core):/);
    expect(JSON.stringify(capability)).not.toMatch(/"allow"\s*:|"path"\s*:/); // no static path scope
  });

  it("puts exactly those commands under the permission system, so a page the window might show cannot call them", () => {
    expect(buildRs).toMatch(/AppManifest::new\(\)\.commands\(&\["pick_zips", "read_range", "close_file"\]\)/);
    expect(production(lib)).toMatch(/generate_handler!\[pick_zips, read_range, close_file\]/);
  });

  it("has no file-system plugin, no command that takes a path, and no grant_* command", () => {
    const c = production(lib);
    expect(c).not.toMatch(/tauri_plugin_fs/);
    expect(c).not.toMatch(/fn grant_/);
    const commands = [...c.matchAll(/#\[tauri::command\][\s\S]*?\bfn (\w+)\(([^)]*)\)/g)];
    expect(commands.map((m) => m[1])).toEqual(["pick_zips", "read_range", "close_file"]);
    for (const m of commands) expect(m[2]).not.toMatch(/\b(path|file_path|dir|folder)\b|PathBuf|&Path/i);
  });

  it("opens the picked file with File::open only and has no code that writes, truncates, creates, renames or deletes", () => {
    const c = production(readonlyRs);
    expect(c).toMatch(/File::open\(path\)/);
    expect(c).not.toMatch(/OpenOptions|\.write\(|write_all|set_len|truncate|create(_new)?\b|remove_file|remove_dir|rename|fs::copy|fs::write|seek_write|write_at|set_permissions|set_modified|symlink/);
    expect(c).toMatch(/seek_read/);
    expect(c).toMatch(/MAX_READ_BYTES/);
    // and the shell's other code does not touch the file system at all
    expect(production(lib)).not.toMatch(/std::fs|File::|OpenOptions/);
  });

  it("depends on tauri, the dialog plugin and serde, plus two Windows-only WebView2 crates, and nothing that can connect", () => {
    const deps = cargo.split("[dependencies]")[1]?.split("[target")[0] ?? "";
    expect([...deps.matchAll(/^([a-z0-9_-]+)\s*=/gm)].map((m) => m[1]).sort()).toEqual(["serde", "tauri", "tauri-plugin-dialog"]);
    const win = cargo.split("[target.'cfg(windows)'.dependencies]")[1]?.split("[features]")[0] ?? "";
    expect([...win.matchAll(/^([a-z0-9_-]+)\s*=/gm)].map((m) => m[1]).sort()).toEqual(["webview2-com", "windows-core"]);
    expect(cargo).not.toMatch(/reqwest|hyper|ureq|curl|isahc|surf|tokio-tungstenite|tauri-plugin-(http|fs|shell|opener|updater|process|os|log|store)/);
  });
});

describe("the desktop frontend", () => {
  const frontendBuild = (reader: string | undefined): string => {
    const out = mkdtempSync(path.join(os.tmpdir(), "snappy-frontend-"));
    try {
      const env = { ...process.env } as Record<string, string | undefined>;
      delete env.CI;
      if (reader === undefined) delete env.SNAPPY_READER;
      else env.SNAPPY_READER = reader;
      execFileSync(process.execPath, [path.join(root, "scripts", "build-frontend.mjs"), "--out", out], { env: env as NodeJS.ProcessEnv, stdio: "pipe" });
      return readFileSync(path.join(out, "index.html"), "utf8");
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  };
  const metaCsp = (html: string): string => /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)?.[1] ?? "";
  // Tauri turns 'self' into the hashes of the inline script and style by itself; the page's own meta tag carries them from the start.
  // The page has two inline scripts (a small theme script and the app), so its policy lists two hashes where the header lists one 'self'.
  const withoutHashes = (csp: string): string => csp.replace(/&#39;/g, "'").replace(/'(sha256-[^']+|self)'/g, "'hash'").replace(/('hash' )+'hash'/g, "'hash'");

  it("is the plain file input with the background worker: the default build contains no shell command and no Tauri API", () => {
    const html = frontendBuild(undefined);
    expect(html).not.toMatch(/pick_zips|read_range|close_file|__TAURI|ipc\.localhost|plugin:fs|plugin:dialog/);
    expect(html).toContain("Choose ZIP files");
  });

  it("stays under the dashboard's own page size limit (apps/dashboard/test/build.test.ts), which this build does not raise", () => {
    expect(Buffer.byteLength(frontendBuild(undefined))).toBeLessThan(1_100_000);
  });

  it("tells the dashboard it runs in the desktop app before the dashboard starts, and hides the profile links", () => {
    const entry = read("src", "entry.ts");
    const imports = entry.split(/\r?\n/).filter((l) => l.trim().startsWith("import"));
    expect(imports[0]).toMatch(/desktop-platform\.ts/);
    expect(imports[1]).toMatch(/dashboard\/src\/main\.ts/);
    expect(read("src", "desktop-platform.ts")).toMatch(/profileLinks: false/);
    // and the wording the dashboard shows there is in the built page, for the Privacy screen
    const html = frontendBuild(undefined);
    expect(html).toContain("a separate program that Snappy does not control");
  });

  it("keeps the fallback reader behind SNAPPY_READER=native, and refuses it in CI unless asked for on purpose", () => {
    const html = frontendBuild("native");
    expect(html).toMatch(/pick_zips/);
    expect(html).toMatch(/read_range/);
    expect(() => frontendBuild("fast")).toThrow();
    expect(() => {
      const env = { ...process.env, CI: "true", SNAPPY_READER: "native" } as Record<string, string | undefined>;
      delete env.SNAPPY_ALLOW_NATIVE_READER;
      execFileSync(process.execPath, [path.join(root, "scripts", "build-frontend.mjs"), "--out", path.join(os.tmpdir(), "snappy-ci-native")], { env: env as NodeJS.ProcessEnv, stdio: "pipe" });
    }).toThrow();
    const imports = read("src", "entry.ts").split(/\r?\n/).filter((l) => l.trim().startsWith("import")).join(" ");
    expect(imports).not.toMatch(/native-reader|native-zip|ipc-reader|@tauri-apps/);
  });

  it("builds the same content policy in both modes, equal to the one the shell sends as a header, and has no way to connect", () => {
    for (const reader of [undefined, "native"]) {
      const html = frontendBuild(reader);
      expect(withoutHashes(metaCsp(html))).toBe(withoutHashes(conf.app.security.csp));
    }
    const html = frontendBuild(undefined);
    // The command helper removes these features from itself and names them only as quoted strings in its lists (src/terminal/scrub.ts);
    // so a name inside quotes is allowed, and any other use of one is not.
    const unquoted = html.replace(/\\?"(fetch|XMLHttpRequest|WebSocket|EventSource|importScripts|sendBeacon)\\?"/g, '""');
    expect(html).toMatch(/\\?"XMLHttpRequest\\?"/); // the lists are there, so this check is looking at the right thing
    expect(unquoted).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts\s*\(/);
    const urls = new Set([...html.matchAll(/https?:\/\/[^\s"'`<>)\\]+/g)].map((m) => m[0].replace(/[.,;]+$/, "")));
    // The SVG namespace (never fetched) and the fixed prefix of the "open in Snapchat" link (the shared page still holds it; the desktop app turns those buttons off).
    for (const u of urls) expect(u).toMatch(/^http:\/\/www\.w3\.org\/(2000\/svg|1999\/xlink)|^https:\/\/www\.snapchat\.com\/add\//);
  });
});

describe("WebView2 hardening", () => {
  const args = (conf.app.windows[0]?.additionalBrowserArgs ?? "").split(/\s+/).filter(Boolean);

  it("starts the engine with its background services switched off", () => {
    for (const flag of ["--disable-background-networking", "--disable-component-update", "--disable-sync", "--disable-domain-reliability", "--no-pings", "--disable-client-side-phishing-detection"]) {
      expect(args).toContain(flag);
    }
    // Chromium honours only the LAST --disable-features, so there must be exactly one, and it must keep wry's defaults.
    const features = args.filter((a) => a.startsWith("--disable-features="));
    expect(features).toHaveLength(1);
    expect(features[0]).toMatch(/msWebOOUI,msPdfOOUI,msSmartScreenProtection/);
    // The Microsoft account sign-in component that made a background connection. On WebView2 156 switching off msOneAuthWAM was
    // enough; on 157 it was not until msForceOneAuthWAM was switched off too (tried on one computer). A newer runtime may need more.
    const off = (features[0] ?? "").replace("--disable-features=", "").split(",");
    for (const name of ["msOneAuthWAM", "msForceOneAuthWAM"]) expect(off).toContain(name);
    expect(args.join(" ")).not.toMatch(/remote-debugging|--proxy|--user-data-dir|--enable-/);
  });

  it("turns SmartScreen and autofill off on the live controller, and removes WEBVIEW2_* variables in release builds", () => {
    const c = production(lib);
    expect(c).toMatch(/SetIsReputationCheckingRequired\(false\)/);
    expect(c).toMatch(/SetIsGeneralAutofillEnabled\(false\)/);
    expect(c).toMatch(/SetIsPasswordAutosaveEnabled\(false\)/);
    expect(c).toMatch(/#\[cfg\(not\(any\(debug_assertions, feature = "dev-hooks"\)\)\)\]\s*fn scrub_webview_environment/);
    expect(c).toMatch(/starts_with\("WEBVIEW2_"\)/);
    expect(c).toMatch(/pub fn run\(\) \{\s*scrub_webview_environment\(\);/); // before anything else
  });

  it("says the WebView2 finding briefly and plainly in docs/RELEASES.md, with the details in the maintainer notes", () => {
    const releases = readFileSync(path.join(root, "..", "..", "docs", "RELEASES.md"), "utf8");
    const section = releases.split("## Network use")[1]?.split("\n## ")[0] ?? "";
    const bullet = section.split("\n").find((l) => l.startsWith("- On Windows, the window is drawn by")) ?? "";
    expect(bullet).not.toBe("");
    expect(bullet.split(/\s+/).length).toBeLessThan(140);
    // Hedged, and the same three facts as the in-app lines (copy.ts): one test, one computer, an update could change it.
    expect(bullet).toMatch(/In one test on one computer/);
    expect(bullet).toMatch(/could change that/);
    expect(bullet).toMatch(/Snappy does not control/);
    // No DLL name, feature flag, run count or certificate name in the public text, and no "second launch" claim
    // (a control run connected on the first launch of a fresh profile).
    expect(bullet).not.toMatch(/\.dll|msOneAuth|msForceOneAuth|outlook\.com|second launch|runtime 15\d/i);
    // The rest of the section says nothing narrower about when the connection happens.
    expect(section).not.toMatch(/second launch/i);
    expect(read("README.md")).not.toMatch(/from the second launch/);
    expect(read("README.md")).toMatch(/MicrosoftAccountWAMExtension\.dll/);
  });

  it("keeps the test hooks out of default and release builds", () => {
    const features = cargo.split("[features]")[1]?.split("[profile")[0] ?? "";
    expect(features).toMatch(/^dev-hooks = \[\]$/m);
    expect(features).not.toMatch(/^default\s*=/m);
    // (test/workflows.test.ts checks that no workflow file asks for them either)
    expect(read("package.json")).not.toMatch(/dev-hooks/);
  });
});
