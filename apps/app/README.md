# Snappy desktop app

The dashboard in a [Tauri 2](https://v2.tauri.app/) shell: one small native window, the system web engine
(WebView2 on Windows), no server, no Node at run time.

Status: the Windows build has been built, installed, run and uninstalled by hand. The macOS and Linux builds and
the phone apps are not built yet. See [docs/RELEASES.md](../../docs/RELEASES.md) for installers, checksums and the
release workflow, and for what is and is not verified.

## What is in here

| Path | What |
| --- | --- |
| `src-tauri/` | The shell: `tauri.conf.json`, one capability file, `lib.rs` (window, navigation lock, WebView2 settings, eight commands), `readonly.rs` (the read-only file table), `src/updater/` (the update check, see below), `update-public-keys.txt` (the two public update keys: placeholders until the maintainer fills them), `build_guards.rs` (the build's release rules), icons made from `brand/logo/png/app-icon-1024.png`. |
| `src/entry.ts` | The default entry: tells the dashboard it runs in the desktop app, then starts it. "Choose ZIP files" is the page's own file input and the zip is read by the dashboard's background worker. No shell command, no path, no IPC. |
| `src/desktop-platform.ts` | What the app tells the dashboard (`apps/dashboard/src/platform.ts`): it is the desktop app (adds a note to the Privacy page) and it shows no "Open in Snapchat" buttons. |
| `src/entry-native-reader.ts` | The fallback entry (build with `SNAPPY_READER=native`): picks zips in a dialog Rust shows and reads them with the shell's read-only `read_range` command. |
| `src/ipc-reader.ts`, `src/native-zip.ts`, `src/native-import.ts` | The fallback reader (a `RandomAccessReader` over `read_range`), the `Blob`-like wrapper the import pipeline takes, and its runner. |
| `scripts/build-frontend.mjs` | Builds the dashboard (same sources, same strict policy, same single file) into `frontend/`. `SNAPPY_READER` is `input` (default) or `native`. |
| `tools/make-synthetic-zip.mjs` | Writes a large **synthetic** export zip (optionally zip64, past 4 GiB) for big-file tests. |
| `src/update-*.ts`, `src/update.css` | The update banner, Settings card, Privacy block and first-run notice. Desktop entry only: the web build does not contain them. |
| `tools/check-no-network-deps.mjs`, `tools/network-surface.mjs` | Fails if the Rust dependency tree of any release target holds a way to connect to a network, or if a crate appears that `tools/approved-crates.txt` does not name (a person must approve it), if WinHTTP or a process start leaves its one file, or (with `--exe`) if the built program imports any network library other than WinHTTP or holds a test setting. Runs in CI. |
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
| `mod.rs` | The state machine: hourly limit, 60 second limit for Check now, 24 hour back-off for a rejected file, 48 hour limit for a staged one, two attempts per version at launch, one operation at a time. |

The page may ask five questions (`update_status`, `update_check`, `update_install(idle)`, `update_set_auto(auto)`, `update_open_releases`) and passes nothing else: no address, host, header, version or path. `update_install` runs only the file that was downloaded and verified, and only when the page says it is idle and the shell sees no picked file, no recent read and no other copy running. `test/shell-config.test.ts` pins this.

Build rules (`build.rs`, `build_guards.rs`): with `SNAPPY_RELEASE=1` the build fails on placeholder or test update keys and on the test features. The `dev-update-endpoint` feature (a loopback server, test keys from `SNAPPY_E2E_PUBKEYS`, a version from `SNAPPY_E2E_VERSION`) builds only under the `com.snappy.e2e` identity, for the update drill. It is off by default, and no workflow names it.

What the tests cover without a window: `cargo test --lib` runs the whole path against a loopback server and the real WinHTTP, with TEST signatures; `cargo test --lib -- --ignored self_signed` checks that a self-signed HTTPS server is refused (needs `node` and `openssl`); `SNAPPY_RUN_CARGO_TESTS=1 npx vitest run apps/app/test/sign-release.test.ts` signs with a throwaway key and checks with the real verifier; `PLAYWRIGHT_DIR=<dir> npx vitest run apps/app/test/update-ui.test.ts` drives the built page in headless Chromium; `node apps/app/tools/check-web-build-unchanged.mjs <ref>` proves the web build did not change.

What needs a window or an install, and has not been run: the update drill in `test/e2e-update`, the `/UPDATE` installer behavior over a real install, WinHTTP behind a corporate proxy or PAC file, and the real GitHub redirect chain.

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
The system web engines on macOS, Linux and Android have not been checked.

## Notes for contributors

- Do not change the identifier `com.snappy.export`: it names the WebView2 profile folder and so the origin that
  holds the sealed history.
- `Cargo.lock` is committed. Builds and CI use `--locked`. A new Rust dependency must pass
  `node apps/app/tools/check-no-network-deps.mjs`, and a crate that can reach the network needs an owner decision.
- A new version goes in three places that must match: `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and
  `package.json` here. The release workflow refuses a tag that disagrees.
- The page size limit in `apps/dashboard/test/build.test.ts` applies to the desktop frontend too. Do not raise it
  to make room for shell code.
- Regenerate icons with `npm run icons -w @snappy-export/app` after the brand icon changes.
