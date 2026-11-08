# The update drill

A hand-run test of the whole update path on Windows: a test build finds a newer test build on a server it makes itself, checks its signature, installs it for the current user, restarts on the new version, and keeps its data. It also feeds the app every kind of broken release and checks that nothing is installed.

Nothing here was run by the session that wrote it, because it needs an install and a window. Run it before the first public release, ideally in Windows Sandbox or a throwaway virtual machine.

## What it needs

- Windows 10 or 11, 64-bit, with Node 22.18 or newer, Rust, the Visual Studio C++ build tools and PowerShell.
- The repository, and `npm ci --ignore-scripts` run once. Building the three test installers takes a while and needs a network for the first build (Cargo and the NSIS tool).
- No real Snappy running. The updater refuses to run while another `snappy.exe` exists, and the drill would report that as a failure.

## Run it

```powershell
node apps/app/test/e2e-update/run-e2e.mjs --list
node apps/app/test/e2e-update/run-e2e.mjs
node apps/app/test/e2e-update/run-e2e.mjs --only update,rotation
```

## What is safe about it

- The test build has its own identity: `Snappy E2E`, identifier `com.snappy.e2e`. Its install folder is `%LOCALAPPDATA%\Snappy E2E`, its data is `%LOCALAPPDATA%\com.snappy.e2e`, and its registry key is its own. It cannot touch a real Snappy.
- It is built with the `dev-update-endpoint` feature, which `build.rs` refuses unless the identity above is set and refuses outright when `SNAPPY_RELEASE=1`. In that build the updater trusts only the TEST keys the drill makes for the run, and talks only to a server on `127.0.0.1` (HTTP or HTTPS). Every other rule stays on: certificate checks, size caps, strict parsing.
- The private test keys are made in a temporary folder with no passphrase, used to sign, and deleted at the end. They are never written to the repository or printed.

## What it checks automatically

| Scenario | What it proves |
| --- | --- |
| `update` | Found, downloaded, verified and staged. One manifest request and one installer request. The only header set is `User-Agent: Snappy-Updater`, with no cookie, referrer or authorization. No Zone.Identifier stream on the staged file. The next launch installs the new version for the current user with no administrator prompt, and a sentinel file in the data folder survives. |
| `tampered`, `wrong-key`, `wrong-name` | A changed installer, a signature from a key the app does not trust, and a signature made for another file name are all refused, with `signature` as the error. |
| `stripped-signature`, `wrong-url` | A manifest with no signature, and one whose installer address is not the exact built one, are refused (`manifest`). |
| `redirect-foreign` | A redirect to another host is refused before any request to it (`policy`). |
| `oversize`, `no-length`, `content-encoding` | An installer larger than 64 MiB, one without a length, and one with a content encoding are refused (`size`). |
| `downgrade`, `same-version` | A lower or equal version is ignored. |
| `offline` | A dead server makes no noise and stages nothing. |
| `toggle-off`, `first-launch` | With the setting off, and on the very first launch before the notice, the server sees zero requests. |
| `rotation` | A release signed by the recovery key is accepted by the old key list and installs. After it, a release signed by the old signing key is refused. |

## What stays manual

Do these once on a real machine and write the result in the release notes of the first release.

1. **A second Snappy process.** Start the test app twice. The second must not run the updater, and "Update now" must answer "Finish what you are doing first".
2. **Mid-task Busy.** Pick a file in the app (the native reader, if built) or start an import, then press "Restart now". It must refuse. Read a file and press "Restart now" within ten seconds: it must refuse too.
3. **Elevated run.** Start the test app as administrator. It must show that it cannot update itself and offer the plain link.
4. **A copied folder.** Copy the install folder somewhere else and start it from there. Same result: it cannot update itself.
5. **An installer that dies.** Stage an update, start the next launch, and end the installer process from Task Manager before it finishes. After two such launches the app must stop applying that version at launch and show the failure state with the quiet link.
6. **The self-signed HTTPS case.** Run `cargo test --lib -- --ignored self_signed` in `apps/app/src-tauri` (needs `node` and `openssl` on the PATH). It starts a self-signed server and requires the transport to fail with a certificate error. It was run by the session that wrote it.
7. **Behind a proxy or PAC file.** Run the check on a network that needs a proxy (a configured system proxy, then one that asks for a login). A proxy that asks for a login must mean "no automatic update" with the quiet link and no credential sent. This is the gate for the WinHTTP transport: if the real transport misbehaves, switch to the fallback described in `docs/UPDATES.md`.
8. **A first install by double-click.** The SmartScreen warning ("Windows protected your PC", More info, Run anyway), and on Windows 11 with Smart App Control on, the block with no "Run anyway".
9. **Uninstall.** Run the uninstaller from Apps and features. The "delete app data" box is the only way data is removed.
10. **Real GitHub.** Publish the first release and a second one, install the first, and watch it update itself from the real address. The real redirect chain, hosts and proxy behavior cannot be tested before a release exists.
