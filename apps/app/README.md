# Snappy desktop app

The dashboard in a [Tauri 2](https://v2.tauri.app/) shell: one small native window, the system web engine
(WebView2 on Windows, the system WebKit web view on macOS), no server, no Node at run time.

Status: the Windows build has been built, installed, run and uninstalled by hand. The macOS build (one universal
app in a disk image, unsigned) is built and started by CI on every pull request that touches the shell; nobody has
run it on a real Mac yet. The Linux build and the phone apps are not built yet. See
[docs/RELEASES.md](../../docs/RELEASES.md) for installers, checksums and the release workflow, and for what is and is
not verified, and [docs/MACOS.md](../../docs/MACOS.md) for the macOS build.

## What is in here

| Path | What |
| --- | --- |
| `src-tauri/` | The shell: `tauri.conf.json`, one capability file, `lib.rs` (window, navigation lock, WebView2 settings, eight commands), `readonly.rs` (the read-only file table), `src/updater/` (the update check, see below), `update-public-keys.txt` (the two public update keys, the maintainer's real ones; a release build refuses placeholders and test keys), `build_guards.rs` (the build's release rules), icons made from `brand/logo/png/app-icon-1024.png`. |
| `src/entry.ts` | The default entry: tells the dashboard it runs in the desktop app, then starts it. "Choose ZIP files" is the page's own file input and the zip is read by the dashboard's background worker. No shell command, no path, no IPC. |
| `src/desktop-platform.ts` | What the app tells the dashboard (`apps/dashboard/src/platform.ts`): it is the desktop app (adds a note to the Privacy page) and it shows no "Open in Snapchat" buttons. |
| `src/entry-native-reader.ts` | The fallback entry (build with `SNAPPY_READER=native`): picks zips in a dialog Rust shows and reads them with the shell's read-only `read_range` command. |
| `src/ipc-reader.ts`, `src/native-zip.ts`, `src/native-import.ts` | The fallback reader (a `RandomAccessReader` over `read_range`), the `Blob`-like wrapper the import pipeline takes, and its runner. |
| `scripts/build-frontend.mjs` | Builds the dashboard (same sources, same strict policy, same single file) into `frontend/`. `SNAPPY_READER` is `input` (default) or `native`. |
| `tools/make-synthetic-zip.mjs` | Writes a large **synthetic** export zip (optionally zip64, past 4 GiB) for big-file tests. |
| `tools/make-installer-images.mjs`, `src-tauri/installer/` | Draws the installer's two pictures (`header.bmp`, `sidebar.bmp`) from the brand logo and tokens with no tools installed (`--check` fails when the committed files differ). The folder also holds `hooks.nsh` (leaves the Finish page's desktop shortcut box unticked) and `English.nsh` (the installer's wording; it changes one line, the uninstaller's saved-data box). |
| `src/update-*.ts`, `src/update.css` | The update banner, Settings card, Privacy block and first-run notice. Desktop entry only: the web build does not contain them. |
| `tools/check-no-network-deps.mjs`, `tools/network-surface.mjs` | Fails if the Rust dependency tree of any release target holds a way to connect to a network, or if a crate appears that `tools/approved-crates.txt` does not name (a person must approve it), if WinHTTP or a process start leaves its one file, or (with `--exe`) if the built program imports any network library other than WinHTTP or holds a test setting. Runs in CI. |
| `tools/make-notices.mjs`, `src-tauri/notices/` | Writes `THIRD-PARTY-DESKTOP.txt`: every Rust crate in the program (the six desktop targets, normal dependencies only) and `@tauri-apps/api`, each with the license text its authors published, and the source address of the five MPL-2.0 crates. It reads `cargo metadata --locked --offline` and the npm lock, needs no network, and records a hash of `Cargo.lock`: a test fails when the lock changes and the file does not. Regenerate with `node apps/app/tools/make-notices.mjs` (`--check` compares). The installer ships it with `NOTICE` and `THIRD-PARTY-NOTICES.md` in a `licenses` folder (`bundle.resources`). |
| `tools/sign-release.mjs`, `tools/make-updater-fixtures.mjs`, `tools/check-web-build-unchanged.mjs` | The maintainer's offline signing tool, the generator of the TEST signature fixtures, and the proof that the web build is byte for byte unchanged. |
| `test/e2e-update/`, `test/e2e-ui/` | The hand-run update drill (installs, opens windows) and the headless-browser check of the update interface. |
| `test/` | Guards on the shell config and source, the fallback reader against a fake shell, the platform note, and the workflow files. Rust unit tests are in `src-tauri` (`cargo test --lib`). |

## Build

Prerequisites: Node 22.18 or newer, Rust stable (MSVC on Windows) and the Visual Studio C++ build tools.

```
npm ci --ignore-scripts                          # at the repo root
npm run build -w @snappy-export/app              # = tauri build: the installers under src-tauri/target/release/bundle/ (NSIS .exe on Windows; no MSI)
npm run dev -w @snappy-export/app                # development window (rebuilds the frontend first; no live reload)
cd apps/app/src-tauri && cargo test --lib        # Rust unit tests: navigation allow-list, read-only file table, the updater (with a loopback server)
```

`tauri build` downloads NSIS and WiX the first time, so the build machine needs a network. The app does not.

Two build switches exist for testing. Neither is used by the release workflow, and a test fails if a workflow asks for one:

- `SNAPPY_READER=native` builds the fallback reader (refused when `CI` is set unless `SNAPPY_ALLOW_NATIVE_READER=1`).
- `tauri build --features dev-hooks` keeps the `WEBVIEW2_*` environment variables that release builds remove
  (a debugging port for Playwright, a scratch profile) and reads `SNAPPY_WEBVIEW_ARGS` as the browser switches.
  Never ship that build.

## Checks that need the built program

The tests read source files and build the frontend. Some things can only be seen in the running program, so after
a change to `src-tauri/` or the frontend build, run these by hand on a test build made with `--features dev-hooks`:

1. Start it with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9444` and
   `WEBVIEW2_USER_DATA_FOLDER=<an empty scratch folder>`, and attach Playwright with `chromium.connectOverCDP`.
2. On the Guide page press Run on `demo --run`, then choose a synthetic zip and press Run on `inspect`. Both must
   finish with exit code 0. The commands run in a `blob:` worker, so this also proves the policy allows it.
3. Read the page's policy and the document's `Content-Security-Policy` response header, and collect every
   `securitypolicyviolation` and every request. The only requests are the app's own `tauri.localhost` page and
   the `blob:` worker. Make a synthetic zip with `npm run synthetic-zip -w @snappy-export/app -- --out <file> --mb 100`.
4. Take a window capture of the finished program with synthetic data only. Never use a real export.
5. For the WebView2 switches, launch the finished program three times on one profile (the default one is fine) and
   list the sockets of its process tree every 0.3 seconds for 40 seconds (`netstat -ano`, matched to the tree).
   Expect none. A positive control that shows the sampler works: launch a `dev-hooks` build with
   `SNAPPY_WEBVIEW_ARGS=--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection`, which leaves the sign-in
   features on.
   Also look at what the web engine keeps in its profile folder (`EBWebView` under `WEBVIEW2_USER_DATA_FOLDER`, or the
   installed program's own folder): the `Crashpad` folder (`reports`, `attachments`, `settings.dat`, `watson_metadata`)
   must hold no `.dmp` file after a normal run. After a forced renderer crash it does (see the crash dump record below).
6. Downloads, on Windows and on macOS. Every Save and Download button makes a file in the page and clicks a link to it,
   and the page says "saved" without being told whether the web engine kept the file. WKWebView on macOS treats such a
   link differently from WebView2, and a blocked download would still read as saved. With a synthetic export loaded,
   press each of these and find the file in the Downloads folder, with the right name and the right content:
   Cleanup "Save list" (a spreadsheet file), Friends backup "Download JSON", the Export reminder's "Save calendar
   file" (open the `.ics` in a calendar app), a Friends table "Download CSV", and, after `demo --run` on the Guide
   page, one output file's "Save" and then "Save all" (a `.zip` that opens). If a file does not arrive, "Copy list" is
   the fallback for the Cleanup list: say so in the report and do not call the build ready.
7. Keyboard on macOS (Full Keyboard Access). WKWebView often skips buttons and links on Tab unless the system setting
   "Keyboard navigation" is on, or Option+Tab is used. With the setting off, press Tab from the top of the Start page and
   note whether it reaches the skip link, the menu links and the buttons. Record the result here and in docs/BETA.md.
   Nobody has run this yet: the macOS build has not run on a real Mac.
8. Page zoom, on Windows. Press Ctrl and plus until the page is at 200 percent, then at 300 percent, and Ctrl and
   minus and Ctrl and 0 to come back. At both sizes the menu, the Start steps, a Cleanup row and the update banner
   must stay readable with no sideways scrolling, and Ctrl and scroll must zoom too. macOS and Linux need one more
   capability permission before this works there (it widens the window's permissions, so the owner reviews it); check
   it once the macOS build runs.

9. Notices. After installing, the install folder holds `licenses\NOTICE.txt`, `licenses\THIRD-PARTY-NOTICES.md` and
   `licenses\THIRD-PARTY-DESKTOP.txt`, and the uninstaller removes them. On macOS they are in the app's `Resources/licenses`.

The finished release program removes the `WEBVIEW2_*` variables, so it cannot be driven this way. The test build
and the release build are the same code apart from that.

## The updater (`src-tauri/src/updater`)

The Windows program checks the repository's GitHub releases for a newer version and installs a signed one. It is the only network use of this program, it is made by Rust and never by the page (the page's policy keeps `connect-src 'none'`), and the person can switch it off. [docs/UPDATES.md](../../docs/UPDATES.md) has the design, the threats and the wording; [docs/UPDATE-RUNBOOKS.md](../../docs/UPDATE-RUNBOOKS.md) has the maintainer's steps.

| File | What |
| --- | --- |
| `manifest.rs` | `latest.json`: size and depth limits, strict `x.y.z`, the download address built from the version and required to match exactly. |
| `verify.rs`, `keys.rs` | minisign check (pre-hashed only), the signed comment must be `timestamp`, `file`, `version` in order, version strictly higher. Two public keys from `update-public-keys.txt`. |
| `store.rs` | `updater.json` (untrusted input: no paths, no addresses, reset when odd) and the file names. |
| `transport.rs` | The address and redirect rules as pure functions: every address parsed once, `github.com` first, then `github.com` or `githubusercontent.com`, at most four redirects. |
| `transport_windows.rs` | WinHTTP, the only file that may use it: no redirects, cookies or authentication, no certificate override, TLS 1.2 and 1.3, no `Accept-Encoding`, `Content-Length` required for the installer. |
| `install_kind.rs` | Updates only the per-user installer's copy it runs from, never elevated. |
| `launch_windows.rs` | Starts the installer (`/P /UPDATE /R`) while holding a handle nobody can write through, and opens the one fixed releases page. The only other file with `unsafe`. |
| `mod.rs` | The state machine: hourly limit, 60 second limit for Check now, 24 hour back-off for a rejected file, 48 hour limit for a staged one, two attempts per version at launch, one operation at a time. An automatic run reads the setting again after the manifest, while the installer downloads and before staging: if the person turned the check off meanwhile it stops, deletes what it fetched and stages nothing (a run the person asked for is not affected). |

The page may ask five questions (`update_status`, `update_check`, `update_install(idle)`, `update_set_auto(auto)`, `update_open_releases`) and passes nothing else: no address, host, header, version or path. `update_install` runs only the file that was downloaded and verified, and only when the page says it is idle and the shell sees no picked file, no recent read and no other copy running. `test/shell-config.test.ts` pins this.

Build rules (`build.rs`, `build_guards.rs`): with `SNAPPY_RELEASE=1` the build fails on placeholder or test update keys and on the test features. The `dev-update-endpoint` feature (a loopback server, test keys from `SNAPPY_E2E_PUBKEYS`, a version from `SNAPPY_E2E_VERSION`) builds only under the `com.snappy.e2e` identity, for the update drill. It is off by default, and no workflow names it.

What the tests cover without a window: `cargo test --lib` runs the whole path against a loopback server and the real WinHTTP, with TEST signatures; `cargo test --lib -- --ignored self_signed` checks that a self-signed HTTPS server is refused (needs `node` and `openssl`); `SNAPPY_RUN_CARGO_TESTS=1 npx vitest run apps/app/test/sign-release.test.ts` signs with a throwaway key and checks with the real verifier; `PLAYWRIGHT_DIR=<dir> npx vitest run apps/app/test/update-ui.test.ts` drives the built page in headless Chromium; `node apps/app/tools/check-web-build-unchanged.mjs <ref>` proves the web build did not change.

What needs a window or an install: the update drill in `test/e2e-update` (hand-run; it covers `/UPDATE` over a real per-user install against a loopback server, see its README for the run and what stays manual). Not run anywhere: WinHTTP behind a corporate proxy or PAC file, and the real GitHub redirect chain.

## Privacy posture of this shell

- No shell, http, opener, process, updater, log, store or file-system plugin (the update check is our own small module, not the Tauri updater plugin). Only `tauri-plugin-dialog`, which
  Rust itself uses (the page has no permission to call it). `test/shell-config.test.ts` fails if that list grows.
- The page can call exactly three read-only commands of our own, `pick_zips`, `read_range` and `close_file`, and the five update commands above.
- The one network use is the update check; the Network use section of `docs/RELEASES.md` says what it sends. Everything else in this list is about the page and the file reader. A path never
  comes from the page: Rust shows the file dialog and hands back opaque ids. The file table opens files with
  `File::open` (read only) and has no write, truncate, rename or delete code, so a script in the page cannot
  change a file the person picked.
- The window can only show the app's own bundled page. Links, `window.open`, redirects, form posts and a script
  setting `location` are refused, and on Windows the web engine is stopped from sending the request. The desktop
  app also shows no "Open in Snapchat" button: in tests, the engine still opened a connection to the target of a
  blocked link.
- The page keeps the dashboard's `connect-src 'none'`. The default reader uses no IPC. The fallback reader's
  IPC works because Tauri falls back from fetch to `postMessage`; the console shows one blocked-fetch warning.
- Release builds start WebView2 with its background services off and the account sign-in features `msOneAuthWAM`
  and `msForceOneAuthWAM` disabled. That depends on the installed WebView2 version, so it is not a promise: the
  Windows WebView2 runtime is a separate Microsoft component that Snappy does not control, and nothing in CI can
  see this change. After a runtime update, repeat the socket check in "Checks that need the built program"
  (three launches on one profile, watching the browser process for outbound sockets).
  The Privacy page says this in a short note, shown only in the desktop app. The wording lives in
  `apps/dashboard/src/copy.ts` (`privacy.desktop*`) and in `docs/RELEASES.md`; keep the two in step, and say
  nothing there that has not been checked.

### Record of the WebView2 sign-in finding (maintainers)

What was seen, all on one Windows 11 computer that is not a clean machine:

- A default WebView2 browser process opened an encrypted connection to Microsoft addresses (the certificate was for
  outlook.com) within about ten seconds of starting. A later control run with default switches and a fresh profile
  connected on its first launch, a few seconds in. So the connection does not wait for a second launch.
- It did not come from Snappy's page: it happened with the web engine pointed at a dead proxy. The browser process had
  loaded Microsoft's account sign-in extension (`MicrosoftAccountWAMExtension.dll`).
- Runtime 156: switching off `msOneAuthWAM` stopped it in every test (four runs of 30 to 150 seconds with the switch
  passed by a test build, two runs of 60 seconds on the finished app). The same profile without the switch connected
  in every control run.
- Runtime 157 (the runtime updated itself): with that one switch the connection came back, although the switch was on
  the command line. Adding `msForceOneAuthWAM` stopped it again: no connection in 4 launches of a test build and 3
  launches of the finished app, where the switches without it connected in 5 of 6 launches of the finished app.

Limits: one computer; the feature names belong to Microsoft's runtime, which updates itself, as 157 already showed;
a build runner has no Microsoft account, so nothing automated notices a change. A firewall rule for
`msedgewebview2.exe` should block it, but nobody has tested one (creating it needs administrator rights).
The system web engines on Linux and Android have not been checked. The macOS one has only been looked at by the
automated test in `tools/macos/` (see "macOS build" below).

### Record of the crash dump finding (maintainers)

Question: does a switch stop the web engine from writing crash dumps into its profile folder? Method: a debug build of the
shell (browser arguments from `tauri.conf.json`, plus `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` for a debugging port), a fresh
profile folder per run, the page attached over the debugging port, the renderer crashed with the DevTools command
`Page.crash`, then the profile folder listed 12 seconds later. Runtime 157.0.4341.42, Windows 11, one computer.

| Extra switches | `Crashpad/reports/*.dmp` after the crash |
| --- | --- |
| none | 1 file, about 6 MB, and a `watson_metadata` file |
| `--disable-breakpad` | 1 file, about 6 MB, and a `watson_metadata` file |
| `--disable-crash-reporter --disable-breakpad` | 1 file, about 6 MB, and a `watson_metadata` file |

So neither switch stops the dump: this engine writes it with Crashpad, which those switches do not control. They are not in
`tauri.conf.json`, and a test fails if one is added without a new run of this record. Not measured: what the dump holds (a
renderer crash dump is a copy of process memory, so it may hold what was on the page, such as usernames or a passphrase being
typed), whether Windows uploads it (that follows the person's Windows diagnostic-data setting, which Snappy does not control),
and whether the uninstaller removes the folder. The page's wording about this belongs in `docs/RELEASES.md` and the Privacy
page (`privacy.desktop*`), and has to say only what is shown here.

## macOS build

One universal app (`aarch64` and `x86_64` in one executable), ad-hoc signed, in a `.dmg` (plus an `.app.tar.gz` for the
updater later, made by the smoke test only for now; no `.pkg`). Everything about it is built on GitHub's Apple silicon runners; no Mac is needed or
available to the maintainers.

```
rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm ci --ignore-scripts
npm run tauri -w @snappy-export/app -- build --target universal-apple-darwin --bundles dmg,app -- --locked
```

What is macOS-specific, and where:

| What | Where |
| --- | --- |
| Bundle settings: oldest macOS (13.3), ad-hoc signature, hardened runtime off, no entitlements, dmg layout, no license click-through on the disk image (the license and notice are inside the app instead). Tauri merges this file over `tauri.conf.json` only when building for macOS | `src-tauri/tauri.macos.conf.json` |
| Version strings: macOS accepts only dotted numbers, so `CFBundleShortVersionString` and `CFBundleVersion` are `0.1.0` and the beta tag is in the custom key `SnappyReleaseVersion` | `src-tauri/Info.plist` (merged by Tauri), `bundleVersion` in `tauri.macos.conf.json` |
| Menu bar: Tauri's default menu on macOS (app menu with Hide and Quit, standard Edit menu, Window, Help). No menu code of our own | none |
| Navigation lock and new-window refusal: the same two handlers as Windows (`on_navigation`, `on_new_window`), which wry applies to the WKWebView delegates. The Windows-only `WebResourceRequested` filter has no macOS counterpart | `lib.rs` |
| Save buttons: wry cancels every download click on macOS unless a download handler exists, so the shell registers one (`allow_download`, macOS only; WebKit saves into Downloads, for the page's own `blob:` links only). WebView2 saves by itself, so Windows has none | `lib.rs` |
| The page's address: `tauri://localhost` (Windows uses `http://tauri.localhost`); both are in the allow-list | `lib.rs` |
| Platform flag: `desktopKind` reads the user agent; `macos` shows the macOS Privacy note, which names no WebView2 | `src/desktop-platform.ts`, `copy.ts` (`privacy.desktopMac*`) |
| No updater: the update check is Windows only (`updater::for_app` returns `None` elsewhere, and the update interface mounts only when `desktop` is `windows`), so the macOS app makes no connection of its own | `src-tauri/src/updater/mod.rs`, `src/update-entry.ts` |
| CI build and smoke test: `smoke.sh` (bundle, launch, window, menu, 60-second network watch with a positive control, quit), `netwatch.py` (the sampler; it counts the WebKit helper processes too, because they are not children of the app, and fails if it counted no new networking helper), `windows.swift`, and a WebKit stand-in (`webkit-probe.swift`, `probe.sh`, `probe-server.py`) that tries 13 ways to reach a loopback server from a plain WKWebView, one page load each, checks that the sampler can list the networking helper's sockets, and clicks a Save link | `.github/workflows/desktop-smoke.yml` job `macos-universal-build`, `tools/macos/` |

`test/macos-config.test.ts` guards the config, the `cfg(windows)` gates and the Safari 16.4 floor of the page script. The smoke test needs a macOS runner
and is described in [docs/RELEASES.md](../../docs/RELEASES.md) (what CI checks, and what it cannot).

## Notes for contributors

- Do not change the identifier `com.snappy.export`: it names the WebView2 profile folder and so the origin that
  holds the sealed history.
- `Cargo.lock` is committed. Builds and CI use `--locked`. A new Rust dependency must pass
  `node apps/app/tools/check-no-network-deps.mjs`, and a crate that can reach the network needs an owner decision.
- A new version goes in three places that must match: `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and
  `package.json` here. The release workflow refuses a tag that disagrees. The macOS files repeat the number
  (`src-tauri/Info.plist` and `bundleVersion` in `src-tauri/tauri.macos.conf.json`, without a pre-release suffix),
  and `test/macos-config.test.ts` fails when they disagree.
- The page size limit in `apps/dashboard/test/page-size-limit.ts` applies to the desktop frontend too: the web page
  and the desktop page share it. Do not raise it to make room for shell code.
- Regenerate icons with `npm run icons -w @snappy-export/app` after the brand icon changes.
