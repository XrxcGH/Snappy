# Releases and installers

Snappy is an app you install on your own computer or phone. It reads your Snapchat data export on that device and keeps what it learns on that device. Snappy itself makes one network request, the update check of the Windows desktop app, which you can turn off, and its pages are not allowed to connect to anything. The window is drawn by your system's web engine, which is a separate program (see [Network use](#network-use) for what that means). This page explains where the installers come from, how to check that a download is the file the maintainers built, what the first-run warning means, how a release is made, and how to build Snappy yourself.

**Status.** No release has been published yet. This page describes how releases are meant to work. Only the Windows build has been built and run by hand (by the maintainers). The macOS build is built, started and watched by an automated test on a GitHub computer, and has never been run on a real Mac. The release workflow has not yet run on GitHub, so every row below is a plan, not something you can download today.

## Where installers come from

Installers are published on the **Releases** page of the Snappy repository on GitHub, and nowhere else. Each release is built by a public GitHub Actions workflow from a version tag (for example `v0.2.0`) that points at a commit already on the `main` branch. The workflow builds every platform, signs what it can, writes a checksum for every file, and attaches them to a draft release. A maintainer tests the files, edits the notes, and publishes the release by hand.

The Windows desktop app checks these releases for a newer version when it opens, and installs a signed update by itself when that is safe (see [Updates](#updates)). The first beta, `0.1.0-beta.1`, has no updater: to leave it, download a newer installer once and run it. Other systems do not update themselves: download the newer installer and run it. The app's storage stays on one device and an uninstall can remove it, and Snappy cannot export saved history, so keep your original Snapchat export: you can add it again.

Each release's notes list the files that are attached (and say in bold when one is missing), say whether each one is signed, and say which platforms the maintainers tested by hand.

## Supported platforms

The status column says what has been done for each row. "Not yet built" means the file names, minimum versions and install steps come from the tools' documentation, not from a run, and may change at the first real build.

| Platform | Files | What it needs | Status |
| --- | --- | --- | --- |
| Windows, 64-bit | `Snappy_<version>_x64-setup.exe` (installs for your user, no administrator needed). There is no MSI: an MSI install could not be updated in place by the per-user installer | Windows 10 or 11. The window is drawn by Microsoft's WebView2 runtime, which Windows 11 includes. If it is missing, the installer downloads it from Microsoft. | Built, installed, run and uninstalled by hand on Windows 11. Not yet built by the release workflow. |
| macOS, Apple silicon and Intel | `Snappy_<version>_universal.dmg`: one app that runs natively on both (see [MACOS.md](MACOS.md)) | macOS 13.3 (Ventura) or newer. The window is drawn by the system's own WebKit web view. | Built unsigned, started and watched by CI on an Apple silicon runner (see "Building the macOS beta"). Never run on a real Mac, and the Intel half has never been started anywhere. The release workflow has a macOS row, but it has never run, so nothing proves it makes the same file. |
| Linux, 64-bit | `Snappy_<version>_amd64.AppImage`, `Snappy_<version>_amd64.deb`, `Snappy-<version>-1.x86_64.rpm` | WebKitGTK 4.1, which Ubuntu 22.04, Debian 12, Fedora 38 and newer include. The files are built on Ubuntu 22.04, so the AppImage needs glibc 2.35 or newer. | Not yet built. |
| Android | `Snappy_<version>_android-universal-<signing>.apk` and `.aab` | Android 7.0 or newer. The APK installs directly. The AAB is the format app stores take. | Not yet built, and the mobile project has never been created. The release workflow treats Android as optional until it has worked once: if it fails, the release goes out without it and the notes say so. |

There is no iOS app. There is no ARM build for Windows or Linux.

The Android file name says how it was signed. `release-signed` means it was signed with the project's release key. `debug-signed` means it was signed with a throwaway key made during that build. A `debug-signed` build installs and runs, but Android will not install one build over another, so you have to uninstall first, which deletes the app's data. Keep your original Snapchat export first, because you can add it again.

## Check your download

Every release has a file named `SHA256SUMS`. It holds one line per installer: the file's SHA-256 checksum, then its name. If the release also has `SHA256SUMS.asc`, that is a GPG signature over `SHA256SUMS`; the release notes name the key.

A matching checksum shows that your download is complete and is the same file that is attached to the release. It cannot show that the release itself is trustworthy, because the checksums sit next to the files. For that there are two things: the signatures where present, and the build provenance described below.

**Windows (PowerShell).** Run this in the folder that holds the installer, then compare the result with the matching line in `SHA256SUMS`:

```powershell
(Get-FileHash .\Snappy_0.2.0_x64-setup.exe -Algorithm SHA256).Hash
Select-String "x64-setup.exe" .\SHA256SUMS
```

The hash in `SHA256SUMS` is lowercase and PowerShell prints uppercase. They match if the letters and digits are the same.

**macOS (Terminal).**

```sh
shasum -a 256 Snappy_0.2.0_universal.dmg
grep universal.dmg SHA256SUMS
```

**Linux.** This checks every file you downloaded and skips the ones you did not:

```sh
sha256sum --ignore-missing -c SHA256SUMS
```

If you have the `.asc` file and the maintainers' public key, you can first check the checksums file itself with `gpg --verify SHA256SUMS.asc SHA256SUMS`.

**Build provenance.** Each release's files are attested by GitHub: a signed statement that this exact file was produced by the release workflow, in this repository, from a named commit. Check it with the [GitHub command line tool](https://cli.github.com), replacing `OWNER/REPO` with the repository you downloaded from:

```sh
gh attestation verify Snappy_0.2.0_x64-setup.exe --repo OWNER/REPO
```

This needs a network and an account login for the tool, and it shows where the file came from, not that the code is free of mistakes. It has not been exercised yet, because no release has run through the workflow.

## What the first-run warning looks like

Some installers are not signed. Signing means a company vouches for who built a file, and it costs money and a registration. An unsigned installer is not a sign that something is wrong with it, but the operating system cannot tell, so it warns you. The release notes say which files are signed. If a file is unsigned, check its checksum before you open it.

**Windows.** A blue window titled "Windows protected your PC" says Microsoft Defender SmartScreen prevented an unrecognized app from starting, and the publisher shows as unknown. Choose **More info**, then **Run anyway**. Windows shows this for any installer it has not seen many people download, even a signed one that is new.

On Windows 11 with **Smart App Control** turned on, Windows blocks an unsigned installer outright and offers no "Run anyway". Snappy does not ask you to turn Smart App Control off. If it blocks the installer, use a file the release notes list as signed, or build Snappy yourself on another machine. When Windows files are signed, the signature is on the installers (`.exe` and `.msi`), not on the program file inside them, and the release notes say so. Whether Smart App Control then lets the installed program start has not been tested.

**macOS.** A dialog says Apple could not verify that "Snappy" is free of malware, or that "Snappy" cannot be opened because Apple cannot check it. Choose **Done** (or **Cancel**), then open **System Settings**, **Privacy & Security**, scroll to the Security section, and choose **Open Anyway** next to Snappy. On macOS 14 and earlier you can instead Control-click the app and choose **Open**; macOS 15 removed that shortcut, so use Settings there. A build that Apple has notarized does not show this, and the macOS beta is not notarized (see [MACOS.md](MACOS.md), which also shows the Terminal command that clears the mark).

**Linux.** There is no warning. For an AppImage, make it executable first (`chmod +x Snappy_*.AppImage`). Install a `.deb` with `sudo apt install ./Snappy_*.deb` and an `.rpm` with `sudo dnf install ./Snappy-*.rpm`.

**Android.** Android asks you to allow your browser or file manager to **install unknown apps**, and Google Play Protect may say it has not scanned the app or ask you to confirm. Allow the install for that one app, and turn the setting off again afterward.

## Updates

**Wording awaiting the owner's approval:** the Privacy block, the Settings line and the first-run notice of the update check are drafts (the text is in [UPDATES.md](UPDATES.md)). Do not publish a release until they are approved.

The Windows desktop app asks one fixed address on github.com for a small file (`latest.json`) that names the newest version, a few seconds after the window opens, at most once an hour, and only while the setting "Check for updates on launch" is on and the first-run notice has been shown. If a newer version exists it downloads that installer from GitHub, checks its signature against two public keys built into the app, and keeps it ready. It installs it at the next launch, before the window opens, or when you choose Update now and nothing is in progress. The request has no ID, no version and none of your data. GitHub, the network and any proxy can see your IP address, the time, and that a Snappy app asked.

Only the maintainer's signature makes an installer acceptable, and the signing keys are never on GitHub: the maintainer signs the exact installer they tested, on their own computer (`apps/app/tools/sign-release.mjs`). [UPDATES.md](UPDATES.md) explains the design and its threats, and [UPDATE-RUNBOOKS.md](UPDATE-RUNBOOKS.md) has the release, key rotation and bad-release steps. A draft release is not offered to any app until the maintainer adds the signature and sets it as the Latest release. A pre-release is never offered.

The first install of an unsigned installer shows the SmartScreen warning described above. An update that Snappy downloads itself has no Mark-of-the-Web, so SmartScreen does not trigger for it. Smart App Control, when it is in enforcement mode, blocks an unsigned installer whether it came from you or from an update: an update then fails, and after two failures the app shows the plain link to the Releases page. Trust for updates comes from the update signature, not from Authenticode.

The update check needs Windows' own network stack to work through your proxy. A proxy that asks for a login means no automatic updates (the app never answers the challenge), and the plain link remains. Not run yet: the check against the real GitHub, which has no release to serve.

## Network use

The page makes no connection and is not allowed to. The only network request of Snappy's own code is the Windows desktop app's update check described above, made by the program (never by the page), which you can turn off. It has no telemetry, no crash reporting, no account and no remote fonts or scripts. Its pages are bound by a content security policy that forbids every connection, and on Windows, macOS and Linux the program's dependency list contains no HTTP client, TLS library or other network library (a check in the build fails if one appears; the update check uses Windows' own WinHTTP, and a second check keeps WinHTTP in one source file). On Android the Tauri framework compiles in an HTTP client that it uses only for its development server and never calls in a release build. The release workflow removes the INTERNET permission from the Android manifest and fails if the finished APK still asks for it, which is meant to make Android block any connection. That has not been run: no Android build exists yet, and nothing has been checked on a device.

That is a statement about Snappy's own code and pages. It is not a promise that no process on the computer connects, because these things are outside Snappy's code and are a fact of the platform:

- The Windows installer may download Microsoft's WebView2 runtime if your PC does not have it. This happens once, during installation.
- On Windows, the window is drawn by Microsoft's WebView2, a separate program that Snappy does not control. In one test on one computer, a sign-in part of WebView2 connected to Microsoft in the background, although Snappy's own page made no request. Snappy turns that part off, and the connection stopped in later tests on that computer, but a WebView2 update could change that, and nothing in the build can check it. If you need certainty, block outbound connections for `msedgewebview2.exe` in your firewall (the maintainers have not tested that rule). The same may be true of the system web engines on Linux and Android, which have not been tested. The test details are in the maintainer notes in [apps/app/README.md](../apps/app/README.md).
- On macOS, the window is drawn by the system's own WebKit web view, which Snappy does not control either. There is no update check on macOS, so the macOS app makes no connection of its own. In the automated test described under "Building the macOS beta", the app and its WebKit helper processes made no connection to an outside address in 60 seconds, on one GitHub-hosted computer with one macOS version. A real Mac, a longer run or a later macOS update can differ.
- The desktop window can only show Snappy's own page. In the maintainers' tests on Windows, links, new windows, redirects, form posts and scripts that change the address loaded nothing, and a local test server received no web request in 33 attempts. The engine still opened a connection to the target of some blocked links, though. For that reason the desktop app shows no Open in Snapchat button. Other systems have not been tested.

## Building the Windows beta locally

The first installer is a Windows beta, version `0.1.0-beta.1`, built by hand on a maintainer's computer. It is unsigned, installs for one user and has no updater (the updater arrives with the first release that contains it). [BETA.md](BETA.md) is the page for the people who test it. These are the commands that make it, from the repository folder, in PowerShell:

```powershell
npm ci --ignore-scripts
# Optional: reuse the Rust build folder of an earlier build, which saves most of the compile time.
$env:CARGO_TARGET_DIR = "C:\path\to\an\earlier\target"
npm run build -w @snappy-export/app -- --bundles nsis -- --locked
```

The installer is `Snappy_0.1.0-beta.1_x64-setup.exe`, in `bundle\nsis` under the target folder (`apps\app\src-tauri\target\release` when you do not set `CARGO_TARGET_DIR`). To write its checksum in the format of `SHA256SUMS`:

```powershell
$f = ".\Snappy_0.1.0-beta.1_x64-setup.exe"
"$((Get-FileHash $f -Algorithm SHA256).Hash.ToLower())  $(Split-Path $f -Leaf)" | Set-Content -Encoding ascii "$f.sha256"
```

Notes on this build:

- **Only NSIS.** `--bundles nsis` builds the `.exe` and nothing else. Tauri's documentation says the MSI format accepts only a numeric pre-release part, so `beta.1` is a reason not to build the `.msi` for a beta. That was not tried here.
- **The version.** The installer's file name and product version are `0.1.0-beta.1`. The file carries a numeric file version beside it, `0.1.0.0`. The version lives in `tauri.conf.json`, `Cargo.toml` (and `Cargo.lock`) and `apps/app/package.json`, and a test fails when they differ. The installer is per user (`installMode` is `currentUser`), English only, and names the publisher "Snappy contributors" and the icon from `icons/icon.ico`.
- **The release workflow is not used.** It only accepts tags of the form `vX.Y.Z` and builds `nsis,msi`, so a beta tag would be refused and the MSI step would stop. Teaching it about betas is a later change.
- **The beta label.** An installed beta shows "Beta version 0.1.0-beta.1" in the footer of every page and "Version 0.1.0-beta.1" in Settings. It reads the version from `apps/app/package.json` through the platform seam (`release`), so the web build shows neither.

What was run on 7 November 2026, on one Windows 11 computer with WebView2 runtime 157.0.4341.42, with synthetic data only:

- The installer was run silently (`/S`) into a temporary folder (`/D=`). It made `snappy.exe` and `uninstall.exe` there, a Start menu shortcut, a desktop shortcut, the Apps and features registry entry (name, version `0.1.0-beta.1`, publisher) and the key `HKCU\Software\Snappy contributors\Snappy`. The window title is "Snappy".
- A synthetic export (60 friends, 100 Memories) was chosen in the app's file dialog and read. `demo --run` and `inspect` were run from the Export guide with Run, and both ended with exit code 0. The Export check tool, the Privacy page and Settings were opened.
- Sockets: the app's process tree (the shell and its WebView2 processes, up to eight processes) was listed against `netstat` or the TCP table while the app ran. Launch 1 was a first launch on a new profile, sampled about every 1.6 seconds for 150 seconds while the app was used. Launches 2 and 3 were sampled about every 0.3 seconds (298 and 345 milliseconds on average) for 65 seconds each. No process of the tree had a connection to a non-loopback address in any of them. A control run of the same sampler on a process that opened a connection to a public address did see it. This covers one runtime version on one computer, and the sampler can miss a connection shorter than its interval.
- The uninstaller was run silently. It removed the install folder, both shortcuts and the Apps and features entry. It left the key `HKCU\Software\Snappy contributors\Snappy` and the folder `%LOCALAPPDATA%\com.snappy.export` (the WebView2 profile, one folder named `EBWebView`, about 190 files and 9 MB). The interactive uninstaller, and its option to delete the application data, were not driven, so that option is not verified. The test removed what it had left and put back what was there before.
- Not checked: a first install by double-click with the SmartScreen warning, the default install folder, the interactive installer pages, Smart App Control, other Windows versions, and a computer without the WebView2 runtime.

## Building the macOS beta

The macOS beta is one universal app (Apple silicon and Intel in the same executable) in a disk image: `Snappy_0.1.0-beta.1_universal.dmg`, and the same app as `Snappy_0.1.0-beta.1_universal.app.tar.gz` for a later updater. That archive is made only by the smoke test (a 14-day CI artifact with its `.sha256` file, next to the disk image's); the release workflow does not make or attach it yet, and the release carries the `.dmg` and `SHA256SUMS`. It will need to be made after signing, because signing changes the app, when the updater needs it. It is unsigned apart from the ad-hoc signature that Apple silicon needs, and there is no `.pkg`. [MACOS.md](MACOS.md) is the page for the people who test it. Nobody on the project has a Mac, so the only place it is built and started is a GitHub-hosted Apple silicon runner, in the `macOS universal build and smoke test` job of `.github/workflows/desktop-smoke.yml`. That job runs on every pull request and every push to `main` that touches the app, the dashboard or the workflow. It has no secret and no Apple credential.

To build it the same way yourself, on a Mac, from the repository folder:

```sh
rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm ci --ignore-scripts
npm run tauri -w @snappy-export/app -- build --target universal-apple-darwin --bundles dmg,app -- --locked
```

The files are in `apps/app/src-tauri/target/universal-apple-darwin/release/bundle/` (`dmg` and `macos`). The macOS settings are in `apps/app/src-tauri/tauri.macos.conf.json` and `Info.plist`, which Tauri applies only when it builds for macOS.

Why these choices:

- **`.dmg` and not `.pkg`.** A disk image with the app and an Applications link is the usual way to share a Mac app. A package runs installer scripts and is meant for the App Store or for putting files outside the app, and Snappy needs neither.
- **No license agreement on the disk image.** Tauri turns the shared `licenseFile` setting into a click-through agreement that the disk image shows when it is opened. That is wrong for an Apache-2.0 program, so the macOS settings drop it, and `LICENSE` and `NOTICE` sit inside the app, in `Contents/Resources`.
- **Version strings.** macOS accepts only dotted numbers in `CFBundleShortVersionString` and `CFBundleVersion`, so both are `0.1.0`. The full `0.1.0-beta.1` is in the custom Info.plist key `SnappyReleaseVersion`, in the file names and in the in-app Beta label. `apps/app/test/macos-config.test.ts` fails when these drift from the other three version places.
- **Oldest macOS: 13.3 (Ventura).** The page's script has regular expressions with a look-behind (for example in `packages/core/src/export/layout-report.ts`), which WebKit parses only from Safari 16.4, and a script that does not parse leaves a blank window. macOS 13.3 is the first release that ships that WebKit itself, so it is the floor (an earlier draft said 12.3 and counted only `Object.hasOwn` and `navigator.locks`, which are Safari 15.4). A test (`apps/app/test/macos-config.test.ts`) builds the page and its two workers, and fails if esbuild has to rewrite anything to target Safari 16.4, which means some syntax is newer than the floor. The same comparison for Safari 16.3 must see a difference (the look-behind), or the test fails, so it cannot pass by checking nothing. It checks syntax only, not which web APIs the code calls, and not the style sheet (`subgrid` and `color-mix` need Safari 16 and 16.2, so they are inside the floor). This is an argument from the code, not a run: nothing older than the runner's own macOS has been started. Both halves of the executable are built for 13.3 (the smoke test reads that back with `otool`).
- **Ad-hoc signature, hardened runtime off, no entitlements.** Hardened runtime is for notarized apps, and Snappy is not sandboxed and asks for no extra access, so there is no entitlements file and no network entitlement to grant. The smoke test fails if the signature is anything but ad hoc, if the hardened-runtime flag is on, or if the app carries any entitlement.
- **The menu bar** is Tauri's default on macOS: an app menu with About, Hide and Quit, the standard Edit menu (so Cmd+C, Cmd+V and Cmd+A work in the passphrase and filter fields), View, Window and Help. Snappy adds no menu code.

What CI checks, and what it cannot.

On every run the macOS job:

1. Runs `cargo test --lib` (the navigation allow-list and the read-only file table) and builds the universal app and disk image.
2. Reads the finished files: the Info.plist keys (identifier, both version strings, the beta key, the oldest macOS, the category, no network exception), both architectures in the executable (`lipo -archs`) and the oldest macOS each one needs, `codesign -dv` (ad hoc, no hardened runtime, no entitlements, no team), `codesign --verify --deep --strict`, `hdiutil verify`, that the image shows no license prompt, holds `Snappy.app` and an `Applications` link to `/Applications`, and that `LICENSE` and `NOTICE` are in the app.
3. Installs the app into a temporary folder and starts it with `open -n`. It checks the process stays alive, that the window server lists a window for it, and takes a screenshot of the window and of the screen. It reads the menu bar (File, Edit, View, Window and the Edit items) through System Events.
4. Watches the app's processes for 60 seconds, sampling `lsof -i` about every 0.6 seconds. Because the system web view does its networking in helper processes that are not children of the app, the sampler counts the app, its descendants and every WebKit helper process that started after the watch began. The job fails on any connection from the app's processes to a non-loopback address, and writes every one it sees, with a list of the other connections on the runner for comparison. Two things guard against a watch that sees nothing because it cannot see: the job fails unless a WebKit networking helper (`com.apple.WebKit.Networking`) that started after the watch began was counted as the app's (so a helper that was already running, or reused, cannot be left out unnoticed), and before the app starts, a control process holds a connection to a real outside address and the job fails unless the sampler sees it. That control shows only that `lsof -i` lists a held TCP socket of an ordinary process. That `lsof -i` can list the sockets of the sandboxed networking helper is shown by step 6, not by this control. The app sat idle on the Start page, so its helper had no socket to list at all.
5. Asks the app to quit with an Apple event and checks that it exits and that none of its processes are left.
6. Runs a **stand-in**, not the app: a small separate program (`apps/app/tools/macos/webkit-probe.swift`) that opens a plain WKWebView on a page served from a `tauri://localhost` custom scheme, applies the same WebKit hooks that Snappy's handlers use (a navigation policy that cancels every other address, a refusal of every new window, and a download policy) and a content policy like the app's. It does three things. **(a) Blocked addresses.** One page load per way of reaching a test server on this computer, so that one cannot hide another: window.open, a `target=_blank` link, `fetch`, `XMLHttpRequest`, an image, an iframe, a WebSocket, `sendBeacon` and a request the server holds open (all in one load), and then a link, a form post, `location.replace` and `location.href` (one load each). Each runs with the protections (locked) and without them (control, where a new window really opens). The test counts, per way, what the server received: it fails if the locked run let any request through, and says which ways the control did not show reaching the server (a zero for those would prove nothing). In the run it was written for, all 13 reached the server in the control and none did in the locked run. In the locked run the new-window refusal stopped `window.open`, the navigation policy cancelled the links and both `location` redirects, and the page's content policy stopped the form post and every request made by script (the content policy is what stops `fetch`, `XMLHttpRequest`, images, iframes, WebSockets and `sendBeacon`; the delegates never see those). **(b) The sampler on the web view's helper.** `netwatch.py` watches the stand-in's processes while its control run holds a request open, and the job fails unless `lsof -i` lists a socket of a WebKit networking helper that started during the watch. This is what shows the connection watch of step 4 can see the helper's connections. **(c) A Save click.** A click on a `blob:` link with a download name is run with a download policy of `download` (what the shell now registers on macOS) and of `cancel` (what wry does when no handler is registered, and so what the shell did before). The job fails unless the first saves the file with the right text, and records that the second saves nothing. The same page also checks which web features exist under that address scheme: a secure context, Web Crypto (PBKDF2 and AES-GCM, as the saved history uses), Web Locks, `Object.hasOwn`, IndexedDB and a Worker made from a blob.
7. Uploads the disk image, the app archive, their SHA-256 files, the screenshots, and the raw output of every check, kept for 14 days.

What it cannot show:

- **Anything a person would see or do on a Mac.** The runner has no person: Gatekeeper's first-run dialog, the Open Anyway step, how the window looks and behaves under real use, the native file dialog and picking a real export, drag and drop, and the Cmd shortcuts in a field were not exercised. The screenshot shows that the page drew; it is one frame on a small virtual screen.
- **Notarization.** The app is not signed with a Developer ID and not notarized, and `spctl` rejects it on the runner, as expected. What a notarized build would change is below.
- **Blocked navigation in the real window.** The same two handlers that lock the window on Windows are applied on macOS (`on_navigation` and `on_new_window` act on the WebKit delegates), and the page's content policy blocks every connection. The stand-in (step 6) shows that WKWebView on the runner cancels a link, a redirect and a new window before any request is sent (not what WebView2 did, so the Windows-only request interception has no macOS counterpart), and that the content policy stops the other ways. But the stand-in is not Snappy's code: nothing has loaded a blocked address into the Snappy window itself, and the network watch is silent about a link nobody clicked.
- **Sealing a history in the real window.** The stand-in ran the same Web Crypto calls as the vault (PBKDF2 into AES-GCM, encrypt and decrypt) under `tauri://localhost`, and they worked; IndexedDB, Web Locks and a blob Worker worked too. The page of the real app also opened its IndexedDB store (the folder was created). But nothing has typed a passphrase into the Snappy window on a Mac, so sealing and unlocking there are not verified.
- **Save in the real window.** The shell registers a download handler on macOS only (`allow_download` in `lib.rs`), because wry cancels the click of every Save button when none is registered, which would have made them all do nothing. The handler lets WebKit write the one file into the Downloads folder under its suggested name, and only for a `blob:` link that the app's own page made. The stand-in (step 6c) shows the click saves the file under that policy and nothing under the other. The wry source was read for the cancel, and the Rust handler compiles in the macOS job, but nobody has clicked a Save button in the Snappy window: whether a Save works there, and where the file lands, is unverified. The window shows no message when a file is saved.
- **The Privacy page's macOS note.** The page chooses it from the web view's user agent. The stand-in's web view reported `Macintosh; Intel Mac OS X 10_15_7` on an Apple silicon runner (WebKit freezes that text), which the page reads as macOS, but nobody has opened the Privacy page in the real window to see the note.
- **Apple silicon versus Intel at run time.** The runner is Apple silicon. The Intel half of the executable is built and the smoke test confirms it is there and was built for macOS 13.3, but it has never been started, and neither has any macOS older than the runner's (26.x at the time of writing).
- **The network watch is a sample.** It can miss a connection that opens and closes between two samples, sees only this user's internet sockets, and says nothing about what a later macOS update changes in the web view. It saw no connection from the app in the runs the maintainers read, and the app's networking helper had no socket of any kind in them because the app sat idle on the Start page: that is one runner on one macOS version, and "no connection" here means no connection while idle.
- **Data folders.** What the app leaves behind (see MACOS.md) was listed after one short run, without a sealed history.
- **The release workflow's macOS path.** `release.yml` builds the same universal app in its `desktop` job and has the `sign-macos` job (which keeps the ad-hoc signature while no certificate exists), but none of that has ever run. The smoke test (`smoke.sh`) is not part of it, and neither is a build with `SNAPPY_RELEASE=1`. So the file a release would carry has not been built or checked yet, and its name, checksum line and `.app.tar.gz` (see above) are untested. Only the pull-request build is evidence.

If Apple Developer ID signing and notarization are added later, the `sign-macos` job in `release.yml` (already written, behind the `release` environment, and turned off while the secrets do not exist) signs with the Developer ID certificate, turns the hardened runtime on, notarizes the app and the disk image and staples the tickets. That needs the paid Apple Developer Program membership of the project owner, a Developer ID Application certificate and an app-specific password for notarization. Nothing of that is in the build job or in CI for pull requests, and none of it exists yet.

## How a release is made (for maintainers)

The workflow is `.github/workflows/release.yml`. It is split so that code from the build never meets a signing key.

1. **verify** checks the tag and runs the tests. For a tag push it requires the tag to look like `vX.Y.Z` (a tag with a suffix, and a tag lower than an existing one, are refused), to match the version in `tauri.conf.json`, `apps/app/package.json` and `Cargo.toml`, and to point at a commit that is an ancestor of `origin/main` (`git merge-base --is-ancestor`). It uses no secret.
2. **desktop** and **android** build the apps, with no secret and no environment, read-only repository access, `npm ci --ignore-scripts` and `cargo ... --locked`. They run the dependencies' build scripts, which is why nothing secret is there. They upload unsigned files.
3. **sign-windows**, **sign-macos** and **sign-android** receive only the finished files and the signing secrets. They do not check out the repository and run no `npm`, `cargo` or build script, only `signtool`, `codesign`, `notarytool`, `apksigner` and `jarsigner`. The GitHub token in them has no permissions. Before a secret is read, each one checks that the build job's files are exactly the expected ones, with plain names. Nothing taken from those files (a name, a path) is written to `GITHUB_ENV`, because a crafted name could then reach the steps that hold the secrets. With no secret they pass the files through unsigned (macOS stays ad-hoc signed, Android gets a throwaway key).
4. **attest** records build provenance for the final files.
5. **release** writes `SHA256SUMS`, signs it when a GPG key secret exists, writes notes that list which files are and are not attached, and creates a **draft** release. It is the only job with `contents: write`. It stops if a release for the tag already exists.

The Windows build is NSIS only. Official builds set `SNAPPY_RELEASE=1`, which makes the build refuse placeholder or test update keys, and the built program is checked (it must import `winhttp.dll` and no other download library, and hold no test setting or test key). The release job creates the draft with `--latest=false`; adding the update signature and publishing are the maintainer's steps. A second workflow, `verify-published.yml`, checks every day and after each publish that `latest.json` names the highest published version, points at the pinned installer address and verifies over the installer; a failure emails the owner.

A run started by hand (Actions, Release, Run workflow) is never official: it builds unsigned files, reads no secret and creates no release, whatever branch it is started from. Only a push of a tag counts. To rehearse the signing path without real keys, push a throwaway tag in a fork: it follows the same steps and signs with no keys.

**Before you add the first secret**, set these up. None of them is done yet.

1. Create the environment `release` (Settings, Environments) with a **required reviewer**, and under "Deployment branches and tags" allow only the tag pattern `v*`. Put every signing secret in that environment and none at repository level, because a repository secret can be read by a workflow run on any branch. Expect two approval prompts per release: one for the signing jobs together, one for the release job.
2. Add a tag ruleset that limits who can create tags matching `v*`.
3. In Settings, Actions, General: set workflow permissions to read-only, and require approval for workflows from fork pull requests.
4. Optional: turn on immutable releases (check that the setting exists), so a published release's files cannot be swapped later. The signature files must then be uploaded to the draft before publishing.
5. Turn on two-factor sign-in with a passkey or hardware key for the owner account, and store the recovery codes offline.
6. Add a ruleset on `main` (pull request required, status checks required, no bypass, linear history). `.github/CODEOWNERS` makes the owner the required reviewer of the workflows, the updater, the shell config, the lock file and the tools. Restrict creating, updating and deleting `v*` tags to the owner.
7. Keep dependency updates reviewed by hand, with no auto-merge. `minisign-verify` and `windows-sys` are pinned by `Cargo.lock` and built with `--locked`.
8. Never rename or transfer the repository or the account before shipping a release that carries the new address ([UPDATE-RUNBOOKS.md](UPDATE-RUNBOOKS.md)).

Check the setup with `gh api repos/OWNER/REPO/environments/release --jq '.protection_rules'` (it should list a required reviewer) and `gh api repos/OWNER/REPO/environments/release/deployment-branch-policies` (it should list only `v*`).

The other workflows reference no secret, never use `pull_request_target`, and give each job read-only access, so pull requests from forks and from Dependabot cannot reach anything. `apps/app/test/workflows.test.ts` reads every file in `.github/workflows` and fails the test run on the common forms of a secret, a write permission, an unpinned action, a trigger that runs on someone else's content, an expression inside a script, a checkout that keeps the token, or an `npm ci` without `--ignore-scripts` appearing where it should not. It is a tripwire, not a proof, so review changes to the workflow files by hand as well. A `workflow-lint` job in `ci.yml` runs actionlint for syntax.

Known limits of this design: a compromised build dependency could still produce a malicious installer that the maintainer then signs (the maintainer installs and runs the exact file first, builds are locked, and the daily check compares what is published with the keys, but none of that removes the risk); the Windows signature is on the installer, not on the program inside it; the macOS and Android signing steps and every other step beyond the Windows build have never run on GitHub; and a person who can push to `main` and approve the `release` environment can still ship what they like, because the review step is the person.

## Build it yourself

You do not need the installers. You can build the same app from the source.

You need Node 22.18 or newer and a stable Rust toolchain from [rustup](https://rustup.rs). Then, from the repository folder:

```sh
npm ci --ignore-scripts
npm run build -w @snappy-export/app
```

The installers appear under `apps/app/src-tauri/target/release/bundle/`, in a folder per format. To run the app without installing it, use `npm run dev -w @snappy-export/app`.

What else each platform needs:

- **Windows:** the Visual Studio C++ build tools (the "Desktop development with C++" workload). The first build downloads the NSIS and WiX tools, so it needs a network. The app does not.
- **macOS:** the Xcode command line tools (`xcode-select --install`). For the same universal app that CI builds, run `rustup target add aarch64-apple-darwin x86_64-apple-darwin` and then `npm run tauri -w @snappy-export/app -- build --target universal-apple-darwin --bundles dmg,app -- --locked`. The result is ad-hoc signed (the configuration sets that). To build for one architecture only, give `--target aarch64-apple-darwin` or `--target x86_64-apple-darwin` instead.
- **Linux:** the Tauri build libraries. On Debian and Ubuntu: `sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev patchelf`.
- **Android:** JDK 17, the Android SDK and NDK, `ANDROID_HOME` and `NDK_HOME` set, and the four Android Rust targets (`rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android`). Run `npm run tauri -w @snappy-export/app -- android init`, then delete the `android.permission.INTERNET` line from `apps/app/src-tauri/gen/android/app/src/main/AndroidManifest.xml` (the release workflow does the same), and build with `npm run tauri -w @snappy-export/app -- android build --apk`. The result is unsigned and has to be signed before Android installs it. None of this has been run yet.

To confirm that your build has no network dependencies, run `node apps/app/tools/check-no-network-deps.mjs`.
