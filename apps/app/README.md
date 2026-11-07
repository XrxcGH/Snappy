# Snappy desktop app

The dashboard in a [Tauri 2](https://v2.tauri.app/) shell: one small native window, the system web engine
(WebView2 on Windows), no server, no Node at run time.

Status: the Windows build has been built, installed, run and uninstalled by hand. The macOS and Linux builds and
the phone apps are not built yet. See [docs/RELEASES.md](../../docs/RELEASES.md) for installers, checksums and the
release workflow, and for what is and is not verified.

## What is in here

| Path | What |
| --- | --- |
| `src-tauri/` | The shell: `tauri.conf.json`, one capability file, `lib.rs` (window, navigation lock, WebView2 settings, three commands), `readonly.rs` (the read-only file table), icons made from `brand/logo/png/app-icon-1024.png`. |
| `src/entry.ts` | The default entry: tells the dashboard it runs in the desktop app, then starts it. "Choose ZIP files" is the page's own file input and the zip is read by the dashboard's background worker. No shell command, no path, no IPC. |
| `src/desktop-platform.ts` | What the app tells the dashboard (`apps/dashboard/src/platform.ts`): it is the desktop app (adds a note to the Privacy page) and it shows no "Open in Snapchat" buttons. |
| `src/entry-native-reader.ts` | The fallback entry (build with `SNAPPY_READER=native`): picks zips in a dialog Rust shows and reads them with the shell's read-only `read_range` command. |
| `src/ipc-reader.ts`, `src/native-zip.ts`, `src/native-import.ts` | The fallback reader (a `RandomAccessReader` over `read_range`), the `Blob`-like wrapper the import pipeline takes, and its runner. |
| `scripts/build-frontend.mjs` | Builds the dashboard (same sources, same strict policy, same single file) into `frontend/`. `SNAPPY_READER` is `input` (default) or `native`. |
| `tools/make-synthetic-zip.mjs` | Writes a large **synthetic** export zip (optionally zip64, past 4 GiB) for big-file tests. |
| `tools/check-no-network-deps.mjs` | Fails if the Rust dependency tree of any release target holds a way to connect to a network. Runs in CI. |
| `test/` | Guards on the shell config and source, the fallback reader against a fake shell, the platform note, and the workflow files. Rust unit tests are in `src-tauri` (`cargo test --lib`). |

## Build

Prerequisites: Node 22.18 or newer, Rust stable (MSVC on Windows) and the Visual Studio C++ build tools.

```
npm ci --ignore-scripts                          # at the repo root
npm run build -w @snappy-export/app              # = tauri build: NSIS .exe and .msi under src-tauri/target/release/bundle/
npm run dev -w @snappy-export/app                # development window (rebuilds the frontend first; no live reload)
cd apps/app/src-tauri && cargo test --lib        # Rust unit tests: navigation allow-list, read-only file table
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

## Privacy posture of this shell

- No shell, http, opener, process, updater, log, store or file-system plugin. Only `tauri-plugin-dialog`, which
  Rust itself uses (the page has no permission to call it). `test/shell-config.test.ts` fails if that list grows.
- The page can call exactly three commands of our own: `pick_zips`, `read_range` and `close_file`. A path never
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
