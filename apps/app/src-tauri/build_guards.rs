//! The build-time rules that keep test settings out of a release and placeholder keys out of an
//! update. They are plain functions so `cargo test` covers them (this file is compiled into `build.rs`
//! and, under `#[cfg(test)]`, into the library's tests). `build.rs` turns an `Err` into a failed build.

/// The identifier a test build must carry, so it can never share an install or data with the real app.
pub const E2E_IDENTIFIER: &str = "com.snappy.e2e";

pub struct Inputs<'a> {
    /// `SNAPPY_RELEASE=1`: set by the release workflow's build jobs.
    pub release: bool,
    /// The `dev-update-endpoint` feature (loopback server, test keys).
    pub dev_update_endpoint: bool,
    /// The `dev-hooks` feature (WebView2 debugging variables).
    pub dev_hooks: bool,
    /// `SNAPPY_E2E_UNIT_TESTS=1`: lets `cargo test --features dev-update-endpoint` run without the test identity.
    pub unit_tests_only: bool,
    /// The JSON the Tauri command line passes to the build for `--config` overrides (`TAURI_CONFIG`).
    pub tauri_config: Option<&'a str>,
    /// `update-public-keys.txt`.
    pub key_file: &'a str,
    /// Text that holds every TEST key the repository knows (fixtures and the test build's default key).
    pub test_key_material: &'a str,
}

pub fn check(i: &Inputs) -> Result<(), String> {
    if i.release && i.dev_update_endpoint {
        return Err("the dev-update-endpoint feature (a loopback update server and test keys) must never be in a release build".into());
    }
    if i.release && i.dev_hooks {
        return Err("the dev-hooks feature must never be in a release build".into());
    }
    if i.dev_update_endpoint && !i.unit_tests_only {
        let compact: String = i.tauri_config.unwrap_or("").chars().filter(|c| !c.is_whitespace()).collect();
        if !compact.contains(&format!("\"identifier\":\"{E2E_IDENTIFIER}\"")) {
            return Err(format!("the dev-update-endpoint feature is for the end-to-end test build only: build it with a --config that sets the identifier to {E2E_IDENTIFIER}"));
        }
    }
    if i.release {
        release_keys(i.key_file, i.test_key_material)?;
    }
    Ok(())
}

/// Base64 of "untrusted comment: minisign public key:", which every Tauri public key (the content of the .pub file) starts with.
const PUBLIC_KEY_PREFIX: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6";
/// Base64 of "untrusted comment: rsign encrypted secret key", which the private key file starts with.
const SECRET_KEY_PREFIX: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IHJzaWduIGVuY3J5cHRlZCBzZWNyZXQga2V5";
/// A public key file is about 152 characters of base64 (140 to 170 covers a different key id or comment).
const PUBLIC_KEY_LENGTHS: (usize, usize) = (140, 170);

/// A release build needs two real, different public keys: not placeholders, not test keys.
fn release_keys(key_file: &str, test_material: &str) -> Result<(), String> {
    let mut values: Vec<(&str, &str)> = Vec::new();
    for line in key_file.lines().map(str::trim).filter(|l| !l.is_empty() && !l.starts_with('#')) {
        let (name, value) = line.split_once('=').ok_or("update-public-keys.txt has a line that is not `name = value`")?;
        values.push((name.trim(), value.trim()));
    }
    let [("signing", signing), ("recovery", recovery)] = values[..] else {
        return Err("update-public-keys.txt must hold exactly a `signing` line and then a `recovery` line".into());
    };
    for (name, key) in [("signing", signing), ("recovery", recovery)] {
        if key.starts_with("PLACEHOLDER") {
            return Err(format!("the {name} update key in update-public-keys.txt is still a placeholder: a release build needs the maintainer's real public keys"));
        }
        // A secret key file starts with the same words ("untrusted comment:"), so the prefix must be the public one.
        if key.starts_with(SECRET_KEY_PREFIX) {
            return Err(format!("the {name} update key in update-public-keys.txt is a PRIVATE key. Remove it from the repository history and generate a new pair: only the .pub file's content belongs here"));
        }
        let shaped = key.len() >= PUBLIC_KEY_LENGTHS.0 && key.len() <= PUBLIC_KEY_LENGTHS.1 && key.starts_with(PUBLIC_KEY_PREFIX) && key.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'+' | b'/' | b'='));
        if !shaped {
            return Err(format!("the {name} update key in update-public-keys.txt is not a Tauri public key (the content of the .pub file)"));
        }
        if test_material.contains(key) {
            return Err(format!("the {name} update key in update-public-keys.txt is a TEST key"));
        }
    }
    if signing == recovery {
        return Err("the signing and recovery update keys must be two different keys".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const REAL_A: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEFBQUFBQUFBQUFBQUFBQUEKUldRQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE9PQo=";
    const REAL_B: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEJCQkJCQkJCQkJCQkJCQkIKUldRQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI9PQo=";
    const TEST_KEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDAxNDE0Mjk2QUQ0QTIwRTAKUldUZ0lFcXRsa0pCQWFHT1prVU5qLzk0c3FsS2ltdGhyUm4rSTRVOU8zZ2Qvck5Pdk5QbmxuYVQK";

    fn inputs<'a>(key_file: &'a str) -> Inputs<'a> {
        Inputs { release: true, dev_update_endpoint: false, dev_hooks: false, unit_tests_only: false, tauri_config: None, key_file, test_key_material: TEST_KEY }
    }

    /// The shape of a real `tauri signer generate` private key file: the same first words as a public key, 348 characters.
    fn private_key() -> String {
        format!("{SECRET_KEY_PREFIX}{}", "QUFB".repeat(72))
    }

    fn keys(a: &str, b: &str) -> String {
        format!("# comment\nsigning = {a}\nrecovery = {b}\n")
    }

    #[test]
    fn a_release_with_two_real_keys_passes() {
        assert_eq!(check(&inputs(&keys(REAL_A, REAL_B))), Ok(()));
    }

    #[test]
    fn a_release_refuses_placeholders_test_keys_duplicates_and_odd_files() {
        let one_placeholder = keys(REAL_A, "PLACEHOLDER-REPLACE-WITH-THE-RECOVERY-PUBLIC-KEY");
        let both = keys("PLACEHOLDER-A", "PLACEHOLDER-B");
        for (name, file) in [
            ("a placeholder", one_placeholder),
            ("two placeholders", both),
            ("a test key", keys(REAL_A, TEST_KEY)),
            ("a duplicate", keys(REAL_A, REAL_A)),
            ("a short key", keys(REAL_A, "dW50cnVzdGVk")),
            ("a wrong prefix", keys(REAL_A, &"A".repeat(150))),
            ("a private key", keys(REAL_A, &private_key())),
            ("a private key in the signing line", keys(&private_key(), REAL_B)),
            ("a far too long public-looking key", keys(REAL_A, &format!("{REAL_B}{REAL_B}"))),
            ("an order swap", format!("recovery = {REAL_B}\nsigning = {REAL_A}\n")),
            ("an extra line", format!("{}other = 1\n", keys(REAL_A, REAL_B))),
            ("a missing line", format!("signing = {REAL_A}\n")),
            ("no equals sign", "signing REAL\nrecovery REAL\n".to_string()),
            ("empty", String::new()),
        ] {
            assert!(check(&inputs(&file)).is_err(), "{name} must fail a release build");
        }
    }

    #[test]
    fn the_test_build_is_refused_in_a_release_and_outside_the_test_identity() {
        let good = keys(REAL_A, REAL_B);
        let mut i = inputs(&good);
        i.dev_update_endpoint = true;
        assert!(check(&i).unwrap_err().contains("never be in a release"));
        i.release = false;
        assert!(check(&i).is_err(), "no test identity: refused");
        i.tauri_config = Some(r#"{"productName":"Snappy E2E","identifier":"com.snappy.export"}"#);
        assert!(check(&i).is_err(), "the real identifier: refused");
        i.tauri_config = Some(r#"{ "productName": "Snappy E2E", "identifier": "com.snappy.e2e" }"#);
        assert_eq!(check(&i), Ok(()));
        i.tauri_config = None;
        i.unit_tests_only = true;
        assert_eq!(check(&i), Ok(()), "cargo test of the feature");
        // without the feature nothing about identity matters, and placeholder keys are fine outside a release
        let mut plain = inputs("signing = PLACEHOLDER\nrecovery = PLACEHOLDER\n");
        plain.release = false;
        assert_eq!(check(&plain), Ok(()));
    }

    #[test]
    fn the_debug_hooks_are_refused_in_a_release() {
        let good = keys(REAL_A, REAL_B);
        let mut i = inputs(&good);
        i.dev_hooks = true;
        assert!(check(&i).is_err());
        i.release = false;
        assert_eq!(check(&i), Ok(()));
    }
}
