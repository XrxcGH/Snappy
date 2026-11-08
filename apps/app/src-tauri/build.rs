mod build_guards;

use std::{env, fs};

fn main() {
    release_and_test_settings_guard();

    // The page may call exactly these commands (and only if the capability lists them): three
    // read-only ones for the native reader and the update commands. Declaring them in the app
    // manifest puts them under Tauri's permission system; without it every command would be
    // callable from every page the window ever shows.
    let app = tauri_build::AppManifest::new().commands(&["pick_zips", "read_range", "close_file", "update_status", "update_check", "update_install", "update_set_auto", "update_open_releases"]);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(app)).expect("tauri build script failed");
}

/// Fails the build when a release would carry test settings or placeholder update keys (see
/// `build_guards.rs` for the rules, which have their own unit tests).
fn release_and_test_settings_guard() {
    for name in ["SNAPPY_RELEASE", "TAURI_CONFIG", "SNAPPY_E2E_UNIT_TESTS", "SNAPPY_E2E_PUBKEYS", "SNAPPY_E2E_VERSION"] {
        println!("cargo:rerun-if-env-changed={name}");
    }
    for file in ["update-public-keys.txt", "build_guards.rs", "src/updater/keys.rs", "src/updater/testdata/signatures.json", "src/updater/testdata/real-tauri.json"] {
        println!("cargo:rerun-if-changed={file}");
    }
    let read = |path: &str| fs::read_to_string(path).unwrap_or_default();
    let test_key_material = format!("{}\n{}\n{}", read("src/updater/keys.rs"), read("src/updater/testdata/signatures.json"), read("src/updater/testdata/real-tauri.json"));
    let tauri_config = env::var("TAURI_CONFIG").ok();
    let key_file = read("update-public-keys.txt");
    let inputs = build_guards::Inputs {
        release: env::var("SNAPPY_RELEASE").is_ok_and(|v| v == "1"),
        dev_update_endpoint: env::var_os("CARGO_FEATURE_DEV_UPDATE_ENDPOINT").is_some(),
        dev_hooks: env::var_os("CARGO_FEATURE_DEV_HOOKS").is_some(),
        unit_tests_only: env::var("SNAPPY_E2E_UNIT_TESTS").is_ok_and(|v| v == "1"),
        tauri_config: tauri_config.as_deref(),
        key_file: &key_file,
        test_key_material: &test_key_material,
    };
    if let Err(problem) = build_guards::check(&inputs) {
        panic!("Snappy build refused: {problem}");
    }
}
