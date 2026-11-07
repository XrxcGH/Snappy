# Releases and installers

Snappy is an app you install on your own computer or phone. It reads your Snapchat data export on that device and keeps what it learns on that device. Snappy itself sends nothing over a network, and its pages are not allowed to connect to anything. The window is drawn by your system's web engine, which is a separate program (see [Network use](#network-use) for what that means). This page explains where the installers come from, how to check that a download is the file the maintainers built, what the first-run warning means, how a release is made, and how to build Snappy yourself.

**Status.** No release has been published yet. This page describes how releases are meant to work. Only the Windows build has been built and run (by hand, by the maintainers). The release workflow has not yet run on GitHub, so every other row below is a plan, not something you can download today.

## Where installers come from

Installers are published on the **Releases** page of the Snappy repository on GitHub, and nowhere else. Each release is built by a public GitHub Actions workflow from a version tag (for example `v0.2.0`) that points at a commit already on the `main` branch. The workflow builds every platform, signs what it can, writes a checksum for every file, and attaches them to a draft release. A maintainer tests the files, edits the notes, and publishes the release by hand.

Snappy does not update itself and never checks for updates. To update, download the newer installer from the Releases page and run it. The app's storage stays on one device and an uninstall can remove it, and Snappy cannot export saved history, so keep your original Snapchat export: you can add it again.

Each release's notes list the files that are attached (and say in bold when one is missing), say whether each one is signed, and say which platforms the maintainers tested by hand.

## Supported platforms

The status column says what has been done for each row. "Not yet built" means the file names, minimum versions and install steps come from the tools' documentation, not from a run, and may change at the first real build.

| Platform | Files | What it needs | Status |
| --- | --- | --- | --- |
| Windows, 64-bit | `Snappy_<version>_x64-setup.exe` (installs for your user, no administrator needed) and `Snappy_<version>_x64_en-US.msi` (installs for all users, needs administrator rights) | Windows 10 or 11. The window is drawn by Microsoft's WebView2 runtime, which Windows 11 includes. If it is missing, the installer downloads it from Microsoft. | Built, installed, run and uninstalled by hand on Windows 11. Not yet built by the release workflow. |
| macOS, Apple silicon | `Snappy_<version>_aarch64.dmg` | A current macOS release. | Not yet built. |
| macOS, Intel | `Snappy_<version>_x64.dmg` | A current macOS release. | Not yet built. It is cross-compiled on an Apple silicon runner and has not been started on an Intel Mac. |
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
shasum -a 256 Snappy_0.2.0_aarch64.dmg
grep aarch64.dmg SHA256SUMS
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

**macOS.** A dialog says Apple could not verify that "Snappy" is free of malware, or that "Snappy" cannot be opened because Apple cannot check it. Choose **Done** (or **Cancel**), then open **System Settings**, **Privacy & Security**, scroll to the Security section, and choose **Open Anyway** next to Snappy. On macOS 14 and earlier you can instead Control-click the app and choose **Open**. A build that Apple has notarized does not show this.

**Linux.** There is no warning. For an AppImage, make it executable first (`chmod +x Snappy_*.AppImage`). Install a `.deb` with `sudo apt install ./Snappy_*.deb` and an `.rpm` with `sudo dnf install ./Snappy-*.rpm`.

**Android.** Android asks you to allow your browser or file manager to **install unknown apps**, and Google Play Protect may say it has not scanned the app or ask you to confirm. Allow the install for that one app, and turn the setting off again afterward.

## Network use

Snappy sends nothing over a network. It has no telemetry, no crash reporting, no update check, no account and no remote fonts or scripts. Its pages are bound by a content security policy that forbids every connection, and on Windows, macOS and Linux the program's dependency list contains no network library (a check in the build fails if one appears). On Android the Tauri framework compiles in an HTTP client that it uses only for its development server and never calls in a release build. The release workflow removes the INTERNET permission from the Android manifest and fails if the finished APK still asks for it, which is meant to make Android block any connection. That has not been run: no Android build exists yet, and nothing has been checked on a device.

That is a statement about Snappy's own code and pages. It is not a promise that no process on the computer connects, because these things are outside Snappy's code and are a fact of the platform:

- The Windows installer may download Microsoft's WebView2 runtime if your PC does not have it. This happens once, during installation.
- On Windows, the window is drawn by Microsoft's WebView2, a separate program that Snappy does not control. In one test on one computer, a sign-in part of WebView2 connected to Microsoft in the background, although Snappy's own page made no request. Snappy turns that part off, and the connection stopped in later tests on that computer, but a WebView2 update could change that, and nothing in the build can check it. If you need certainty, block outbound connections for `msedgewebview2.exe` in your firewall (the maintainers have not tested that rule). The same may be true of the system web engines on macOS, Linux and Android, which have not been tested. The test details are in the maintainer notes in [apps/app/README.md](../apps/app/README.md).
- The desktop window can only show Snappy's own page. In the maintainers' tests on Windows, links, new windows, redirects, form posts and scripts that change the address loaded nothing, and a local test server received no web request in 33 attempts. The engine still opened a connection to the target of some blocked links, though. For that reason the desktop app shows no Open in Snapchat button. Other systems have not been tested.

## Building the Windows beta locally

The first installer is a Windows beta, version `0.1.0-beta.1`, built by hand on a maintainer's computer. It is unsigned, installs for one user and has no updater. [BETA.md](BETA.md) is the page for the people who test it. These are the commands that make it, from the repository folder, in PowerShell:

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

## How a release is made (for maintainers)

The workflow is `.github/workflows/release.yml`. It is split so that code from the build never meets a signing key.

1. **verify** checks the tag and runs the tests. For a tag push it requires the tag to look like `vX.Y.Z`, to match the version in `tauri.conf.json`, `apps/app/package.json` and `Cargo.toml`, and to point at a commit that is an ancestor of `origin/main` (`git merge-base --is-ancestor`). It uses no secret.
2. **desktop** and **android** build the apps, with no secret and no environment, read-only repository access, `npm ci --ignore-scripts` and `cargo ... --locked`. They run the dependencies' build scripts, which is why nothing secret is there. They upload unsigned files.
3. **sign-windows**, **sign-macos** and **sign-android** receive only the finished files and the signing secrets. They do not check out the repository and run no `npm`, `cargo` or build script, only `signtool`, `codesign`, `notarytool`, `apksigner` and `jarsigner`. The GitHub token in them has no permissions. Before a secret is read, each one checks that the build job's files are exactly the expected ones, with plain names. Nothing taken from those files (a name, a path) is written to `GITHUB_ENV`, because a crafted name could then reach the steps that hold the secrets. With no secret they pass the files through unsigned (macOS stays ad-hoc signed, Android gets a throwaway key).
4. **attest** records build provenance for the final files.
5. **release** writes `SHA256SUMS`, signs it when a GPG key secret exists, writes notes that list which files are and are not attached, and creates a **draft** release. It is the only job with `contents: write`. It stops if a release for the tag already exists.

A run started by hand (Actions, Release, Run workflow) is never official: it builds unsigned files, reads no secret and creates no release, whatever branch it is started from. Only a push of a tag counts. To rehearse the signing path without real keys, push a throwaway tag in a fork: it follows the same steps and signs with no keys.

**Before you add the first secret**, set these up. None of them is done yet.

1. Create the environment `release` (Settings, Environments) with a **required reviewer**, and under "Deployment branches and tags" allow only the tag pattern `v*`. Put every signing secret in that environment and none at repository level, because a repository secret can be read by a workflow run on any branch. Expect two approval prompts per release: one for the signing jobs together, one for the release job.
2. Add a tag ruleset that limits who can create tags matching `v*`.
3. In Settings, Actions, General: set workflow permissions to read-only, and require approval for workflows from fork pull requests.
4. Optional: turn on immutable releases, so a published release's files cannot be swapped later.

Check the setup with `gh api repos/OWNER/REPO/environments/release --jq '.protection_rules'` (it should list a required reviewer) and `gh api repos/OWNER/REPO/environments/release/deployment-branch-policies` (it should list only `v*`).

The other workflows reference no secret, never use `pull_request_target`, and give each job read-only access, so pull requests from forks and from Dependabot cannot reach anything. `apps/app/test/workflows.test.ts` reads every file in `.github/workflows` and fails the test run on the common forms of a secret, a write permission, an unpinned action, a trigger that runs on someone else's content, an expression inside a script, a checkout that keeps the token, or an `npm ci` without `--ignore-scripts` appearing where it should not. It is a tripwire, not a proof, so review changes to the workflow files by hand as well. A `workflow-lint` job in `ci.yml` runs actionlint for syntax.

Known limits of this design: the Windows signature is on the installers, not on the program inside them; the macOS and Android signing steps and every other step beyond the Windows build have never run on GitHub; and a person who can push to `main` and approve the `release` environment can still ship what they like, because the review step is the person.

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
- **macOS:** the Xcode command line tools (`xcode-select --install`). To build the Intel app on an Apple silicon Mac, run `rustup target add x86_64-apple-darwin` and add `--target x86_64-apple-darwin` after `--` in the command above.
- **Linux:** the Tauri build libraries. On Debian and Ubuntu: `sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev patchelf`.
- **Android:** JDK 17, the Android SDK and NDK, `ANDROID_HOME` and `NDK_HOME` set, and the four Android Rust targets (`rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android`). Run `npm run tauri -w @snappy-export/app -- android init`, then delete the `android.permission.INTERNET` line from `apps/app/src-tauri/gen/android/app/src/main/AndroidManifest.xml` (the release workflow does the same), and build with `npm run tauri -w @snappy-export/app -- android build --apk`. The result is unsigned and has to be signed before Android installs it. None of this has been run yet.

To confirm that your build has no network dependencies, run `node apps/app/tools/check-no-network-deps.mjs`.
