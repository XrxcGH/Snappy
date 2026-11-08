//! The update manifest: a small JSON file (`latest.json`, the format Tauri's static updater uses)
//! that names the newest version. It is NOT signed, so everything in it is checked, and nothing
//! in it is trusted: the download address is not taken from it but built here from the validated
//! version, and the manifest is only accepted if its address equals that built one exactly.
//! Unknown fields (notes, dates, other platforms) are read past and never kept or shown.

use std::fmt;

use serde::de::{Deserializer, MapAccess, Visitor};
use serde::Deserialize;

/// The manifest, the signature text and the installer are each capped before anything is parsed.
pub const MAX_MANIFEST_BYTES: usize = 64 * 1024;
pub const MAX_SIGNATURE_BYTES: usize = 4 * 1024;
pub const MAX_INSTALLER_BYTES: u64 = 64 * 1024 * 1024;
/// The deepest nesting the manifest may have. A real one has three levels.
const MAX_DEPTH: usize = 8;
/// The key of this platform in `platforms`. ARM64 would add `windows-aarch64` here later.
pub const PLATFORM_KEY: &str = "windows-x86_64";

/// The repository the updates come from. It is a constant on purpose: nothing at run time can
/// change it, except the loopback test build (see `Endpoint::loopback`).
pub const REPO_BASE: &str = "https://github.com/XrxcGH/Snappy";

/// A version as the updater understands it: `x.y.z`, numbers only. The running program may be a
/// pre-release (`0.1.0-beta.1`), which counts as lower than the same number without the suffix.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Version {
    major: u16,
    minor: u16,
    patch: u16,
    /// False for a pre-release, so that `0.1.0-beta.1` sorts below `0.1.0`.
    stable: bool,
}

impl Version {
    /// A version the network may name: exactly `x.y.z`, ASCII digits only, no leading zeros, each
    /// part at most 65535, at most 16 characters. No suffix, no `v`, no whitespace.
    pub fn parse(text: &str) -> Option<Version> {
        if text.len() > 16 {
            return None;
        }
        let mut parts = [0u16; 3];
        let mut pieces = text.split('.');
        for slot in parts.iter_mut() {
            *slot = number(pieces.next()?)?;
        }
        if pieces.next().is_some() {
            return None;
        }
        Some(Version { major: parts[0], minor: parts[1], patch: parts[2], stable: true })
    }

    /// The version this program was built as: `x.y.z`, optionally followed by `-` and a
    /// pre-release label made of letters, digits, dots and hyphens.
    pub fn running(text: &str) -> Option<Version> {
        match text.split_once('-') {
            None => Version::parse(text),
            Some((core, label)) => {
                let ok = !label.is_empty() && label.len() <= 32 && label.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-');
                if !ok {
                    return None;
                }
                Version::parse(core).map(|v| Version { stable: false, ..v })
            }
        }
    }

    /// True when this is a pre-release of its number.
    pub fn is_prerelease(&self) -> bool {
        !self.stable
    }
}

fn number(piece: &str) -> Option<u16> {
    let digits = !piece.is_empty() && piece.bytes().all(|b| b.is_ascii_digit());
    if !digits || (piece.len() > 1 && piece.starts_with('0')) || piece.len() > 5 {
        return None;
    }
    piece.parse().ok()
}

impl fmt::Display for Version {
    /// Only the numbers: the form used in file names and addresses.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}.{}.{}", self.major, self.minor, self.patch)
    }
}

/// Where the manifest and the installers live. The release value is the repository's GitHub
/// releases; the loopback value exists only in the test build (`dev-update-endpoint`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Endpoint {
    base: String,
}

impl Endpoint {
    pub fn release() -> Endpoint {
        Endpoint { base: REPO_BASE.to_string() }
    }

    /// `base` is an origin and path such as `http://127.0.0.1:8123/XrxcGH/Snappy`.
    #[cfg(any(test, feature = "dev-update-endpoint"))]
    pub fn loopback(base: &str) -> Endpoint {
        Endpoint { base: base.trim_end_matches('/').to_string() }
    }

    pub fn manifest_url(&self) -> String {
        format!("{}/releases/latest/download/latest.json", self.base)
    }

    /// The only address an installer may be downloaded from for `version`.
    pub fn installer_url(&self, version: &Version) -> String {
        format!("{}/releases/download/v{version}/{}", self.base, installer_name(version))
    }

    /// The page opened by the last-resort link.
    pub fn releases_page(&self) -> String {
        format!("{}/releases/latest", self.base)
    }
}

/// The installer's file name, which the signature's trusted comment must also carry.
pub fn installer_name(version: &Version) -> String {
    format!("Snappy_{version}_x64-setup.exe")
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ManifestError {
    TooLarge,
    /// Not UTF-8, not JSON, wrong types or a repeated key.
    Malformed,
    TooDeep,
    BadVersion,
    NoPlatform,
    BadUrl,
    NoSignature,
    SignatureTooLarge,
}

/// What a valid manifest tells the program: the version and the signature text for the installer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Manifest {
    pub version: Version,
    pub signature: String,
}

#[derive(Deserialize)]
struct Raw {
    version: Option<String>,
    platforms: Option<Platforms>,
}

#[derive(Deserialize)]
struct Entry {
    signature: Option<String>,
    url: Option<String>,
}

/// `platforms` as a list, so a repeated platform key is seen instead of silently replaced.
struct Platforms(Vec<(String, Entry)>);

impl<'de> Deserialize<'de> for Platforms {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct Walk;
        impl<'de> Visitor<'de> for Walk {
            type Value = Platforms;
            fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str("a map of platforms")
            }
            fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Platforms, A::Error> {
                let mut seen: Vec<(String, Entry)> = Vec::new();
                while let Some(key) = map.next_key::<String>()? {
                    let entry: Entry = map.next_value()?;
                    if seen.iter().any(|(k, _)| *k == key) {
                        return Err(serde::de::Error::custom("duplicate platform"));
                    }
                    seen.push((key, entry));
                }
                Ok(Platforms(seen))
            }
        }
        d.deserialize_map(Walk)
    }
}

/// The deepest nesting of `{` and `[` outside strings. A cheap scan done before parsing.
fn depth(bytes: &[u8]) -> usize {
    let (mut deepest, mut now, mut in_string, mut escaped) = (0usize, 0usize, false, false);
    for &b in bytes {
        if in_string {
            match (escaped, b) {
                (true, _) => escaped = false,
                (false, b'\\') => escaped = true,
                (false, b'"') => in_string = false,
                _ => {}
            }
            continue;
        }
        match b {
            b'"' => in_string = true,
            b'{' | b'[' => {
                now += 1;
                deepest = deepest.max(now);
            }
            b'}' | b']' => now = now.saturating_sub(1),
            _ => {}
        }
    }
    deepest
}

fn is_base64_text(s: &str) -> bool {
    s.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'+' | b'/' | b'='))
}

/// Parses and validates a manifest for this program's platform. The download address in the file
/// must equal, byte for byte, the one built from its version.
pub fn parse(bytes: &[u8], endpoint: &Endpoint) -> Result<Manifest, ManifestError> {
    if bytes.len() > MAX_MANIFEST_BYTES {
        return Err(ManifestError::TooLarge);
    }
    if depth(bytes) > MAX_DEPTH {
        return Err(ManifestError::TooDeep);
    }
    let raw: Raw = serde_json::from_slice(bytes).map_err(|_| ManifestError::Malformed)?;
    let version = raw.version.as_deref().and_then(Version::parse).ok_or(ManifestError::BadVersion)?;
    let platforms = raw.platforms.ok_or(ManifestError::NoPlatform)?;
    let entry = platforms.0.into_iter().find(|(k, _)| k == PLATFORM_KEY).map(|(_, e)| e).ok_or(ManifestError::NoPlatform)?;
    if entry.url.as_deref() != Some(endpoint.installer_url(&version).as_str()) {
        return Err(ManifestError::BadUrl);
    }
    let signature = entry.signature.filter(|s| !s.is_empty()).ok_or(ManifestError::NoSignature)?;
    if signature.len() > MAX_SIGNATURE_BYTES {
        return Err(ManifestError::SignatureTooLarge);
    }
    if !is_base64_text(&signature) {
        return Err(ManifestError::Malformed);
    }
    Ok(Manifest { version, signature })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(s: &str) -> Version {
        Version::parse(s).unwrap()
    }

    fn manifest(version: &str, url: &str, signature: &str) -> String {
        format!(r#"{{"version":"{version}","notes":"x","pub_date":"2026-01-01T00:00:00Z","platforms":{{"windows-x86_64":{{"signature":"{signature}","url":"{url}"}}}}}}"#)
    }

    fn good_url(version: &str) -> String {
        Endpoint::release().installer_url(&v(version))
    }

    fn ok(text: &str) -> Result<Manifest, ManifestError> {
        parse(text.as_bytes(), &Endpoint::release())
    }

    #[test]
    fn a_valid_manifest_gives_the_version_and_the_signature() {
        let m = ok(&manifest("0.2.10", &good_url("0.2.10"), "QUJD")).unwrap();
        assert_eq!(m.version, v("0.2.10"));
        assert_eq!(m.signature, "QUJD");
    }

    #[test]
    fn versions_are_strict_x_y_z() {
        for good in ["0.0.0", "1.2.3", "10.20.30", "65535.65535.0", "0.1.0"] {
            assert!(Version::parse(good).is_some(), "{good}");
        }
        for bad in [
            "", "1", "1.2", "1.2.3.4", "01.2.3", "1.02.3", "1.2.03", "65536.0.0", "1.2.65536", "1.2.3-beta.1", "1.2.3+build", "v1.2.3", " 1.2.3", "1.2.3 ", "1.2.-3", "1..3", "1.2.3\n", "+1.2.3", "１.2.3", "1.2.3a", "999999.0.0",
            "00000000.0.0.0.0",
        ] {
            assert!(Version::parse(bad).is_none(), "{bad:?} must be refused");
        }
        assert!(Version::parse("1111.2222.3333.4444").is_none(), "at most 16 characters");
    }

    #[test]
    fn versions_compare_numerically_and_a_pre_release_is_below_its_release() {
        assert!(v("0.10.0") > v("0.9.9"));
        assert!(v("1.0.0") > v("0.65535.6553"));
        assert!(v("0.2.0") > v("0.1.9"));
        let beta = Version::running("0.1.0-beta.1").unwrap();
        assert!(beta.is_prerelease());
        assert!(v("0.1.0") > beta);
        assert!(v("0.0.9") < beta);
        assert!(Version::running("0.1.0").unwrap() == v("0.1.0"));
        for bad in ["0.1.0-", "0.1.0-be ta", "0.1-beta", "0.1.0-é", "-beta"] {
            assert!(Version::running(bad).is_none(), "{bad}");
        }
        assert_eq!(beta.to_string(), "0.1.0");
    }

    #[test]
    fn the_address_is_built_from_the_version_and_must_match_exactly() {
        assert_eq!(good_url("0.2.0"), "https://github.com/XrxcGH/Snappy/releases/download/v0.2.0/Snappy_0.2.0_x64-setup.exe");
        assert_eq!(Endpoint::release().manifest_url(), "https://github.com/XrxcGH/Snappy/releases/latest/download/latest.json");
        let wrong = [
            "https://github.com/XrxcGH/Snappy/releases/download/v0.2.0/Snappy_0.2.0_x64-setup.exe?x=1",
            "https://github.com/XrxcGH/Snappy/releases/download/v0.2.1/Snappy_0.2.1_x64-setup.exe",
            "https://github.com/XrxcGH/Snappy/releases/download/v0.2.0/Snappy_0.2.0_x64_en-US.msi",
            "http://github.com/XrxcGH/Snappy/releases/download/v0.2.0/Snappy_0.2.0_x64-setup.exe",
            "https://evil.test/XrxcGH/Snappy/releases/download/v0.2.0/Snappy_0.2.0_x64-setup.exe",
            "https://github.com/Other/Snappy/releases/download/v0.2.0/Snappy_0.2.0_x64-setup.exe",
            "https://github.com/XrxcGH/Snappy/releases/download/v0.2.0/snappy_0.2.0_x64-setup.exe",
            "",
        ];
        for url in wrong {
            assert_eq!(ok(&manifest("0.2.0", url, "QUJD")), Err(ManifestError::BadUrl), "{url}");
        }
    }

    #[test]
    fn a_missing_platform_version_or_signature_is_refused() {
        let url = good_url("0.2.0");
        let other = format!(r#"{{"version":"0.2.0","platforms":{{"windows-aarch64":{{"signature":"QUJD","url":"{url}"}}}}}}"#);
        assert_eq!(ok(&other), Err(ManifestError::NoPlatform));
        assert_eq!(ok(r#"{"version":"0.2.0"}"#), Err(ManifestError::NoPlatform));
        assert_eq!(ok(r#"{"platforms":{}}"#), Err(ManifestError::BadVersion));
        assert_eq!(ok(&manifest("0.2.0-beta.1", &url, "QUJD")), Err(ManifestError::BadVersion));
        assert_eq!(ok(&manifest("v0.2.0", &url, "QUJD")), Err(ManifestError::BadVersion));
        assert_eq!(ok(&manifest("0.2.0", &url, "")), Err(ManifestError::NoSignature));
        let stripped = format!(r#"{{"version":"0.2.0","platforms":{{"windows-x86_64":{{"url":"{url}"}}}}}}"#);
        assert_eq!(ok(&stripped), Err(ManifestError::NoSignature));
        assert_eq!(ok(&manifest("0.2.0", &url, "not base64 !")), Err(ManifestError::Malformed));
    }

    #[test]
    fn repeated_keys_are_refused_but_unknown_fields_and_other_platforms_are_read_past() {
        let url = good_url("0.2.0");
        let dup_version = format!(r#"{{"version":"0.2.0","version":"0.3.0","platforms":{{"windows-x86_64":{{"signature":"QUJD","url":"{url}"}}}}}}"#);
        assert_eq!(ok(&dup_version), Err(ManifestError::Malformed));
        let dup_platforms = format!(r#"{{"version":"0.2.0","platforms":{{}},"platforms":{{"windows-x86_64":{{"signature":"QUJD","url":"{url}"}}}}}}"#);
        assert_eq!(ok(&dup_platforms), Err(ManifestError::Malformed));
        let dup_entry = format!(r#"{{"version":"0.2.0","platforms":{{"windows-x86_64":{{"signature":"QUJD","url":"{url}"}},"windows-x86_64":{{"signature":"QUJE","url":"{url}"}}}}}}"#);
        assert_eq!(ok(&dup_entry), Err(ManifestError::Malformed));
        let dup_signature = format!(r#"{{"version":"0.2.0","platforms":{{"windows-x86_64":{{"signature":"QUJD","signature":"QUJE","url":"{url}"}}}}}}"#);
        assert_eq!(ok(&dup_signature), Err(ManifestError::Malformed));
        let extra = format!(r#"{{"version":"0.2.0","extra":{{"a":[1,2,{{"b":null}}]}},"platforms":{{"darwin-aarch64":{{"signature":"x","url":"y","more":1}},"windows-x86_64":{{"signature":"QUJD","url":"{url}","size":5}}}}}}"#);
        assert_eq!(ok(&extra).unwrap().signature, "QUJD");
    }

    #[test]
    fn limits_on_size_depth_and_shape() {
        let url = good_url("0.2.0");
        let big = format!(r#"{{"version":"0.2.0","notes":"{}","platforms":{{"windows-x86_64":{{"signature":"QUJD","url":"{url}"}}}}}}"#, "a".repeat(MAX_MANIFEST_BYTES));
        assert_eq!(ok(&big), Err(ManifestError::TooLarge));
        assert_eq!(ok(&manifest("0.2.0", &url, &"A".repeat(MAX_SIGNATURE_BYTES + 1))), Err(ManifestError::SignatureTooLarge));
        assert!(ok(&manifest("0.2.0", &url, &"A".repeat(MAX_SIGNATURE_BYTES))).is_ok());
        let deep = format!(r#"{{"version":"0.2.0","x":{},"platforms":{{}}}}"#, "[".repeat(40) + &"]".repeat(40));
        assert_eq!(ok(&deep), Err(ManifestError::TooDeep));
        // brackets inside a string do not count as nesting
        let inside = format!(r#"{{"version":"0.2.0","notes":"{}","platforms":{{"windows-x86_64":{{"signature":"QUJD","url":"{url}"}}}}}}"#, "[".repeat(40));
        assert!(ok(&inside).is_ok());
        for bad in ["", "{", "[]", "null", "\"x\"", "{\"version\":5}", "{\"version\":\"0.2.0\",\"platforms\":[]}"] {
            assert!(ok(bad).is_err(), "{bad}");
        }
        assert_eq!(parse(&[0xff, 0xfe, 0x7b, 0x7d], &Endpoint::release()), Err(ManifestError::Malformed));
    }

    #[test]
    fn the_loopback_endpoint_builds_the_same_shapes() {
        let e = Endpoint::loopback("http://127.0.0.1:9/XrxcGH/Snappy/");
        assert_eq!(e.manifest_url(), "http://127.0.0.1:9/XrxcGH/Snappy/releases/latest/download/latest.json");
        assert_eq!(e.installer_url(&v("1.0.0")), "http://127.0.0.1:9/XrxcGH/Snappy/releases/download/v1.0.0/Snappy_1.0.0_x64-setup.exe");
    }
}
