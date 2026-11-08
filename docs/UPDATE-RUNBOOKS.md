# Update runbooks (for maintainers)

Steps for the three things that touch the update keys or a published release. [UPDATES.md](UPDATES.md) says why the update path is built this way, and [RELEASES.md](RELEASES.md) describes the release pipeline.

The update signing keys live offline with the maintainer. No GitHub setting, secret or workflow holds one. Signing is a step on your own computer.

## Before the first release (once)

1. Generate two key pairs offline, on your own computer, each with its own long random passphrase: `npx tauri signer generate -w <file>`. The first is the signing key and the second is the recovery key.
2. Put the signing key file on an encrypted removable drive (BitLocker To Go), plugged in only while signing. Keep its passphrase in your head, or in a password manager that is not on the signing computer.
3. Put the recovery key on two separate encrypted offline media in two places, with its passphrase held separately. It is not in a cloud-synced password manager, and it is never on a networked disk after it is generated.
4. Copy only the two PUBLIC keys (the content of each `.pub` file) into `apps/app/src-tauri/update-public-keys.txt`, replacing the placeholders. Commit that file. Release builds refuse placeholders and refuse the test keys.
5. Set up the repository protections listed in [RELEASES.md](RELEASES.md): two-factor sign-in with a passkey or hardware key, a ruleset on `main`, a ruleset on `v*` tags, the `release` environment, and CODEOWNERS review of the updater, the workflows and the tools.
6. Run the update drill ([apps/app/test/e2e-update](../apps/app/test/e2e-update/README.md)), including its manual list.

## A normal release

1. Bump the version in `tauri.conf.json`, `apps/app/package.json` and `Cargo.toml`, merge to `main`, then tag the merged commit (`vX.Y.Z`, plain numbers only). The release workflow builds the installer and makes a draft. It is not Latest.
2. Install the draft’s installer in Windows Sandbox or a virtual machine and run it. Check that it starts and that an earlier copy updates to it.
3. On your computer, with the signing drive plugged in: `node apps/app/tools/sign-release.mjs --tag vX.Y.Z --key <the signing key file>`. Before anything is downloaded the tool refuses a tag that is not higher than every published release, or whose release is not a draft. It then downloads the installer and checks its checksum (which only catches a damaged download, because the checksum file sits in the same draft) and its build provenance (it must come from this repository's release workflow at this tag). It refuses an installer whose own product version is not the tag's version, shows you what it is and which signing tool will run, asks you to type the version, asks for the passphrase (hidden), signs, writes `latest.json`, checks everything offline with the app’s own verifier, and uploads the `.sig` and `latest.json` to the draft.
4. On GitHub, publish the draft and set it as the Latest release. This is the rollout switch.
5. Watch for the `Verify published release` workflow. If it fails, see “When the daily check fails”.

## Key rotation

**Routine, or the signing key may be exposed.** Sign a release with the RECOVERY key. Installed copies accept it, because the recovery key is in their list.

1. Generate a new key pair offline. It becomes the new recovery key.
2. In `update-public-keys.txt` put the old recovery public key as `signing` and the new public key as `recovery`.
3. Build and draft the release as usual. Sign it with the old recovery key: `sign-release.mjs --key <the recovery key file>`. The tool’s verifier checks the signature against the keys of this checkout, where the old recovery key is now the `signing` entry, so it passes.
4. Publish it as Latest. Updated copies now trust the old recovery key (as the new signing key) and the new key (as recovery). They no longer accept the old signing key.
5. Delete every stored copy of the old signing key at once.

Copies that have not updated still trust the old signing key, so whoever holds a stolen key can target them until they update. Publish the recovery-signed release quickly. This limit cannot be removed.

**The recovery key may be exposed.** Ship a release signed with the SIGNING key whose list replaces the recovery key.

**Both keys are lost.** Installed copies cannot be updated. People must download a new installer by hand. This is the documented worst case, and the reason for two offline copies of the recovery key.

Rehearse a rotation once before the first public release. The drill’s `rotation` scenario does it with test keys.

## A bad release

Apps never go down in version, so a bad release is replaced by a higher one.

1. Unpublish it (back to draft) or delete it on GitHub. `latest.json` and the Latest release then point back at the previous release, which installed copies ignore because it is not newer.
2. A copy that downloaded the bad version but has not installed it deletes it at its next launch if the manifest no longer names it, or after 48 hours at the latest.
3. Ship a fixed release with a higher version as soon as you can, and sign it as usual. If immutable releases are on, a published release cannot be edited, so withdrawal is a delete plus a new higher version.

## When the daily check fails

The `Verify published release` workflow fails when `latest.json` is missing, names a version that is not the highest published tag, points anywhere but the pinned installer address, or does not verify over the installer. Open the run, read the failing step, and act:

- Latest is wrong (it names an older version): set the right release as Latest, or publish the missing `latest.json`.
- The signature does not verify, or the installer changed after signing: treat it as an asset swap. Unpublish the release, work out how the file changed (account sign-ins, collaborators, workflow runs), and re-release from a clean build with a higher version.
- A published release that was never signed: add the signature and `latest.json` with the signing tool, or unpublish it.

## Never rename or transfer the repository first

Installed copies ask one fixed address under the repository’s current name. Before the repository or the account is renamed or transferred, publish a release that carries the new address. Whoever later takes the old name cannot sign, so the worst case is a missing update, never an installed one. Without that release, copies already out there stop finding updates.
