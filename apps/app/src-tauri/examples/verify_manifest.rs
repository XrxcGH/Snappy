//! Checks a release's update files offline, with the same code the app uses to decide whether to install.
//!
//!   cargo run --locked --release --example verify_manifest -- <latest.json> <installer.exe> [--pubkey <base64>]
//!
//! It checks that `latest.json` is a valid manifest whose download address is exactly the pinned one for its version,
//! that its signature is a pre-hashed minisign signature whose signed comment names this installer file and this version,
//! and that the signature verifies over the installer's bytes with one of the compiled-in public keys
//! (`update-public-keys.txt`). It uses no network and reads no secret.
//!
//! The maintainer's signing tool runs it before it uploads anything, and `verify-published.yml` runs it every day against
//! what is published. `--pubkey` replaces the compiled-in keys with one given key and exists only to test the tool with a
//! TEST key; the daily check never uses it.
//!
//! Exit status: 0 when everything verifies, 1 when something does not (the reason is printed), 2 for a usage error.

use std::fs::File;
use std::io::Read;
use std::process::ExitCode;

use snappy_lib::updater::keys;
use snappy_lib::updater::manifest::{self, Endpoint, Version, MAX_MANIFEST_BYTES};
use snappy_lib::updater::verify::{self, Keys};

fn usage() -> ExitCode {
    eprintln!("usage: verify_manifest <latest.json> <installer.exe> [--pubkey <base64>]");
    ExitCode::from(2)
}

fn run(manifest_path: &str, installer_path: &str, pubkey: Option<&str>) -> Result<String, String> {
    let mut bytes = Vec::new();
    File::open(manifest_path)
        .map_err(|e| format!("cannot open {manifest_path}: {e}"))?
        .take(MAX_MANIFEST_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("cannot read {manifest_path}: {e}"))?;
    let parsed = manifest::parse(&bytes, &Endpoint::release()).map_err(|e| format!("the manifest is not acceptable: {e:?}"))?;

    let trusted = match pubkey {
        Some(key) => Keys::from_texts(&[key]),
        None => keys::trusted(),
    }
    .map_err(|e| format!("no usable public key: {e:?} (a build with placeholder keys cannot verify anything)"))?;

    // Any version counts as newer than 0.0.0: this checks the release itself, not an upgrade from a running copy.
    let running = Version::running("0.0.0").expect("0.0.0 is a version");
    let checked = verify::check_signature(&parsed.signature, &parsed.version, &running).map_err(|e| format!("the signature is not acceptable: {e:?}"))?;
    let mut installer = File::open(installer_path).map_err(|e| format!("cannot open {installer_path}: {e}"))?;
    trusted.verify_reader(&checked, &mut installer).map_err(|e| format!("the installer does not verify: {e:?}"))?;
    Ok(format!("OK: version {} is signed by a trusted key, names this installer, and the address is the pinned one", parsed.version))
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (manifest_path, installer_path, pubkey) = match args.as_slice() {
        [m, i] => (m.as_str(), i.as_str(), None),
        [m, i, flag, key] if flag == "--pubkey" => (m.as_str(), i.as_str(), Some(key.as_str())),
        _ => return usage(),
    };
    match run(manifest_path, installer_path, pubkey) {
        Ok(line) => {
            println!("{line}");
            ExitCode::SUCCESS
        }
        Err(problem) => {
            eprintln!("FAILED: {problem}");
            ExitCode::from(1)
        }
    }
}
