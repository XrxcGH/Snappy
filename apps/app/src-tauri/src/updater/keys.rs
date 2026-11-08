//! Which public keys this build trusts for updates.
//!
//! A release build trusts the two keys in `update-public-keys.txt` (signing, recovery) and nothing
//! else. The end-to-end test build (`dev-update-endpoint`) trusts only TEST keys: the ones given at
//! compile time in `SNAPPY_E2E_PUBKEYS` (comma separated) or, when that is unset, one committed
//! test key. `build.rs` makes a release build fail if a key is a placeholder or a test key.

use super::verify::{KeyError, Keys};

/// The file release builds read. See its comments.
const KEY_FILE: &str = include_str!("../../update-public-keys.txt");

/// A TEST-ONLY public key (made by `tauri signer generate` for the unit tests, its private half was
/// thrown away). It is in the end-to-end build only when no other test keys are given.
#[cfg(feature = "dev-update-endpoint")]
const TEST_ONLY_DEFAULT_KEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDAxNDE0Mjk2QUQ0QTIwRTAKUldUZ0lFcXRsa0pCQWFHT1prVU5qLzk0c3FsS2ltdGhyUm4rSTRVOU8zZ2Qvck5Pdk5QbmxuYVQK";

/// Reads the two key lines of `update-public-keys.txt`: `signing` then `recovery`, in that order,
/// each once, and nothing else but comments and blank lines.
pub fn parse_key_file(text: &str) -> Result<[String; 2], KeyError> {
    let mut found: Vec<(&str, &str)> = Vec::new();
    for line in text.lines().map(str::trim).filter(|l| !l.is_empty() && !l.starts_with('#')) {
        let (name, value) = line.split_once('=').ok_or(KeyError::Format)?;
        found.push((name.trim(), value.trim()));
    }
    match found[..] {
        [("signing", signing), ("recovery", recovery)] if !signing.is_empty() && !recovery.is_empty() => Ok([signing.to_string(), recovery.to_string()]),
        _ => Err(KeyError::Format),
    }
}

/// The key texts this build trusts, [signing, recovery] (or the test keys in the end-to-end build).
#[cfg(not(feature = "dev-update-endpoint"))]
pub fn trusted_texts() -> Result<Vec<String>, KeyError> {
    parse_key_file(KEY_FILE).map(Vec::from)
}

#[cfg(feature = "dev-update-endpoint")]
pub fn trusted_texts() -> Result<Vec<String>, KeyError> {
    let given = option_env!("SNAPPY_E2E_PUBKEYS").unwrap_or(TEST_ONLY_DEFAULT_KEY);
    Ok(given.split(',').map(|k| k.trim().to_string()).filter(|k| !k.is_empty()).collect())
}

/// The decoded keys. Fails closed: with placeholders nothing can verify, so nothing is installed.
pub fn trusted() -> Result<Keys, KeyError> {
    Keys::from_texts(&trusted_texts()?)
}

/// The file as committed (build.rs and the tests read the same text).
pub fn key_file() -> &'static str {
    KEY_FILE
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_key_file_has_exactly_the_two_lines_and_is_a_placeholder_until_the_maintainer_fills_it() {
        let [signing, recovery] = parse_key_file(key_file()).unwrap();
        let both_placeholders = signing.starts_with("PLACEHOLDER") && recovery.starts_with("PLACEHOLDER");
        let neither = !signing.starts_with("PLACEHOLDER") && !recovery.starts_with("PLACEHOLDER");
        assert!(both_placeholders || neither, "fill in both keys or neither");
        if neither {
            // real keys: both must decode, and they must be two different keys
            assert_ne!(signing, recovery);
            assert!(Keys::from_texts(&[signing, recovery]).is_ok_and(|k| k.len() == 2));
        } else {
            assert_eq!(Keys::from_texts(&[signing, recovery]).err(), Some(KeyError::Placeholder), "a placeholder build can verify nothing");
        }
    }

    #[cfg(feature = "dev-update-endpoint")]
    #[test]
    fn the_test_build_trusts_a_test_key_and_never_the_release_file() {
        let texts = trusted_texts().unwrap();
        assert!(!texts.is_empty() && texts.iter().all(|t| !key_file().contains(t.as_str())));
        assert!(trusted().is_ok());
    }

    #[test]
    fn the_key_file_format_is_strict() {
        let ok = "# c\nsigning = AAAA\n\nrecovery=BBBB\n";
        assert_eq!(parse_key_file(ok).unwrap(), ["AAAA".to_string(), "BBBB".to_string()]);
        for bad in [
            "",
            "signing = A\n",
            "recovery = B\nsigning = A\n",
            "signing = A\nrecovery = B\nextra = C\n",
            "signing = A\nsigning = B\nrecovery = C\n",
            "signing = \nrecovery = B\n",
            "signing A\nrecovery B\n",
        ] {
            assert_eq!(parse_key_file(bad).err(), Some(KeyError::Format), "{bad:?}");
        }
    }
}
