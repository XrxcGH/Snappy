//! Signature checking for an installer. This is the root of trust: the download host, the address
//! and the manifest are all defence in depth; only a file signed by one of the compiled-in keys
//! may be installed.
//!
//! The signature is a minisign signature in the form Tauri writes (`.sig` files and the manifest's
//! `signature` field hold the whole signature text, base64 encoded). Only the pre-hashed form is
//! accepted, so a legacy signature fails. The signed trusted comment must be exactly
//! `timestamp:<digits>`, TAB, `file:<installer name>`, TAB, `version:<x.y.z>`, which stops a valid
//! signature from being paired with another file or another version.

use std::io::Read;

use minisign_verify::{Error as MinisignError, PublicKey, Signature};
use sha2::{Digest, Sha256};

use super::manifest::{installer_name, Version, MAX_INSTALLER_BYTES, MAX_SIGNATURE_BYTES};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VerifyError {
    /// The signature text is too long, not base64 or not a minisign signature.
    Encoding,
    /// A signature made without pre-hashing.
    Legacy,
    /// The key id in the signature is none of the compiled-in keys.
    UnknownKey,
    /// The signature does not match the bytes (or the signed comment).
    BadSignature,
    /// The signed comment is not exactly the three expected fields.
    Comment,
    /// The signed comment names another installer file.
    WrongFile,
    /// The signed comment names another version than the manifest.
    WrongVersion,
    /// The version is not higher than the running one.
    NotNewer,
    /// The file could not be read.
    Io,
    /// The file is larger than the installer cap.
    TooLarge,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyError {
    /// The key file is not in the expected two-line form.
    Format,
    /// A key is still the placeholder text.
    Placeholder,
    /// A key is not a valid minisign public key.
    Decode,
}

/// Strict standard base64 (padding required, no whitespace). `None` for anything else.
pub fn base64_decode(text: &str) -> Option<Vec<u8>> {
    let bytes = text.as_bytes();
    if bytes.is_empty() || bytes.len() % 4 != 0 {
        return None;
    }
    let value = |b: u8| -> Option<u32> {
        match b {
            b'A'..=b'Z' => Some(u32::from(b - b'A')),
            b'a'..=b'z' => Some(u32::from(b - b'a') + 26),
            b'0'..=b'9' => Some(u32::from(b - b'0') + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    };
    let mut out = Vec::with_capacity(bytes.len() / 4 * 3);
    let blocks = bytes.len() / 4;
    for (i, block) in bytes.chunks(4).enumerate() {
        let last = i + 1 == blocks;
        let pad = block.iter().rev().take_while(|&&b| b == b'=').count();
        if pad > 2 || (pad > 0 && !last) {
            return None;
        }
        let mut n = 0u32;
        for &b in &block[..4 - pad] {
            n = (n << 6) | value(b)?;
        }
        n <<= 6 * pad as u32;
        let triple = [(n >> 16) as u8, (n >> 8) as u8, n as u8];
        out.extend_from_slice(&triple[..3 - pad]);
    }
    Some(out)
}

/// The compiled-in public keys, decoded. Order is [signing, recovery]; either may verify.
pub struct Keys(Vec<PublicKey>);

impl Keys {
    /// Each text is a public key as Tauri's config holds it: the two-line public key file, base64 encoded.
    pub fn from_texts<S: AsRef<str>>(texts: &[S]) -> Result<Keys, KeyError> {
        let mut keys = Vec::with_capacity(texts.len());
        for text in texts {
            let text = text.as_ref();
            if text.starts_with("PLACEHOLDER") {
                return Err(KeyError::Placeholder);
            }
            let file = base64_decode(text).and_then(|b| String::from_utf8(b).ok()).ok_or(KeyError::Decode)?;
            keys.push(PublicKey::decode(&file).map_err(|_| KeyError::Decode)?);
        }
        if keys.is_empty() {
            return Err(KeyError::Format);
        }
        Ok(Keys(keys))
    }

    pub fn len(&self) -> usize {
        self.0.len()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    /// Streams the file through the verifier, choosing the key by the key id in the signature. The
    /// file is never held in memory and is capped at the installer limit.
    pub fn verify_reader<R: Read>(&self, checked: &Checked, reader: &mut R) -> Result<(), VerifyError> {
        let mut chosen = None;
        for key in &self.0 {
            match key.verify_stream(&checked.signature) {
                Ok(stream) => {
                    chosen = Some(stream);
                    break;
                }
                Err(MinisignError::UnexpectedKeyId) => continue,
                Err(MinisignError::UnsupportedLegacyMode) => return Err(VerifyError::Legacy),
                Err(_) => return Err(VerifyError::Encoding),
            }
        }
        let mut stream = chosen.ok_or(VerifyError::UnknownKey)?;
        let mut buf = vec![0u8; 64 * 1024];
        let mut total = 0u64;
        loop {
            let n = reader.read(&mut buf).map_err(|_| VerifyError::Io)?;
            if n == 0 {
                break;
            }
            total += n as u64;
            if total > MAX_INSTALLER_BYTES {
                return Err(VerifyError::TooLarge);
            }
            stream.update(&buf[..n]);
        }
        stream.finalize().map_err(|_| VerifyError::BadSignature)
    }
}

/// A signature whose encoding, signed comment and version have been checked, ready to be matched
/// against the file's bytes.
pub struct Checked {
    signature: Signature,
}

/// Checks everything about a signature that does not need the file: its encoding, its signed
/// comment (file name and version) and that the version is higher than the running one. This is
/// cheap, so it runs before a download as well as after it.
pub fn check_signature(signature_text: &str, version: &Version, running: &Version) -> Result<Checked, VerifyError> {
    if signature_text.len() > MAX_SIGNATURE_BYTES {
        return Err(VerifyError::Encoding);
    }
    let text = base64_decode(signature_text).and_then(|b| String::from_utf8(b).ok()).ok_or(VerifyError::Encoding)?;
    let signature = Signature::decode(&text).map_err(|_| VerifyError::Encoding)?;
    let (file, signed_version) = parse_trusted_comment(signature.trusted_comment())?;
    if file != installer_name(version) {
        return Err(VerifyError::WrongFile);
    }
    if signed_version != *version {
        return Err(VerifyError::WrongVersion);
    }
    if version <= running {
        return Err(VerifyError::NotNewer);
    }
    Ok(Checked { signature })
}

/// The signed comment must be exactly three fields in this order: `timestamp:<digits>`,
/// `file:<name>`, `version:<x.y.z>`, separated by single TAB characters, with nothing else.
fn parse_trusted_comment(comment: &str) -> Result<(String, Version), VerifyError> {
    let fields: Vec<&str> = comment.split('\t').collect();
    let [time, file, version] = fields[..] else { return Err(VerifyError::Comment) };
    let digits = time.strip_prefix("timestamp:").filter(|d| !d.is_empty() && d.len() <= 12 && d.bytes().all(|b| b.is_ascii_digit()));
    let file = file.strip_prefix("file:").filter(|f| !f.is_empty() && f.len() <= 128 && f.bytes().all(|b| b.is_ascii_graphic()));
    let version = version.strip_prefix("version:").and_then(Version::parse);
    match (digits, file, version) {
        (Some(_), Some(file), Some(version)) => Ok((file.to_string(), version)),
        _ => Err(VerifyError::Comment),
    }
}

/// SHA-256 of the signature text, in lowercase hex. A rejected (version, signature) pair is
/// remembered by this, so the same bad file is not downloaded again for a day.
pub fn signature_digest(signature_text: &str) -> String {
    let digest = Sha256::digest(signature_text.as_bytes());
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// True for 64 lowercase hex characters.
pub fn is_digest(text: &str) -> bool {
    text.len() == 64 && text.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn fixtures() -> Value {
        serde_json::from_str(include_str!("testdata/signatures.json")).unwrap()
    }

    fn text(v: &Value, path: &[&str]) -> String {
        path.iter().fold(v, |v, k| &v[*k]).as_str().unwrap().to_string()
    }

    fn content() -> Vec<u8> {
        base64_decode(&text(&fixtures(), &["contentBase64"])).unwrap()
    }

    fn v(s: &str) -> Version {
        Version::parse(s).unwrap()
    }

    fn running() -> Version {
        Version::running("0.1.0-beta.2").unwrap()
    }

    /// Runs the whole check the updater runs, with the keys [x, z].
    fn run(case: &str, bytes: &[u8]) -> Result<(), VerifyError> {
        let f = fixtures();
        let keys = Keys::from_texts(&[text(&f, &["keys", "x"]), text(&f, &["keys", "z"])]).unwrap();
        let checked = check_signature(&text(&f, &["signatures", case]), &v("0.2.0"), &running())?;
        keys.verify_reader(&checked, &mut &bytes[..])
    }

    #[test]
    fn a_good_signature_over_the_file_passes() {
        assert_eq!(run("good", &content()), Ok(()));
    }

    #[test]
    fn a_signature_written_by_the_real_tauri_signer_passes() {
        let real: Value = serde_json::from_str(include_str!("testdata/real-tauri.json")).unwrap();
        let keys = Keys::from_texts(&[text(&real, &["publicKey"])]).unwrap();
        let bytes = base64_decode(&text(&real, &["contentBase64"])).unwrap();
        let checked = check_signature(&text(&real, &["signature"]), &v("0.2.0"), &running()).unwrap();
        assert_eq!(keys.verify_reader(&checked, &mut &bytes[..]), Ok(()));
        let mut tampered = bytes.clone();
        tampered[0] ^= 1;
        assert_eq!(keys.verify_reader(&checked, &mut &tampered[..]), Err(VerifyError::BadSignature));
    }

    #[test]
    fn changed_bytes_fail() {
        let mut bytes = content();
        bytes[5] ^= 0x01;
        assert_eq!(run("good", &bytes), Err(VerifyError::BadSignature));
        let mut longer = content();
        longer.push(0);
        assert_eq!(run("good", &longer), Err(VerifyError::BadSignature));
        assert_eq!(run("good", &[]), Err(VerifyError::BadSignature));
        assert_eq!(run("tamperedAfterSigning", &content()), Err(VerifyError::BadSignature));
    }

    #[test]
    fn the_signed_comment_must_be_exactly_the_three_fields() {
        for case in ["extraField", "wrongOrder", "duplicateKey", "missingVersion", "spacesNotTabs"] {
            assert_eq!(run(case, &content()), Err(VerifyError::Comment), "{case}");
        }
    }

    #[test]
    fn the_signed_file_name_and_version_must_match_the_manifest() {
        assert_eq!(run("wrongFile", &content()), Err(VerifyError::WrongFile));
        assert_eq!(run("wrongVersion", &content()), Err(VerifyError::WrongVersion));
    }

    #[test]
    fn a_legacy_signature_and_an_unknown_key_fail() {
        assert_eq!(run("legacy", &content()), Err(VerifyError::Legacy));
        assert_eq!(run("signedByOtherKey", &content()), Err(VerifyError::UnknownKey));
    }

    #[test]
    fn either_key_in_the_list_may_verify_and_the_order_does_not_matter() {
        let f = fixtures();
        let checked = check_signature(&text(&f, &["signatures", "good"]), &v("0.2.0"), &running()).unwrap();
        for order in [["x", "z"], ["z", "x"]] {
            let keys = Keys::from_texts(&order.map(|k| text(&f, &["keys", k]))).unwrap();
            assert_eq!(keys.len(), 2);
            assert_eq!(keys.verify_reader(&checked, &mut &content()[..]), Ok(()));
        }
        // after a rotation the old signing key is no longer in the list
        let rotated = Keys::from_texts(&[text(&f, &["keys", "y"]), text(&f, &["keys", "z"])]).unwrap();
        assert_eq!(rotated.verify_reader(&checked, &mut &content()[..]), Err(VerifyError::UnknownKey));
    }

    #[test]
    fn the_version_must_be_strictly_higher_than_the_running_one() {
        let f = fixtures();
        let sig = text(&f, &["signatures", "good"]);
        assert!(check_signature(&sig, &v("0.2.0"), &v("0.1.9")).is_ok());
        assert!(check_signature(&sig, &v("0.2.0"), &running()).is_ok());
        assert_eq!(check_signature(&sig, &v("0.2.0"), &v("0.2.0")).err(), Some(VerifyError::NotNewer));
        assert_eq!(check_signature(&sig, &v("0.2.0"), &v("0.3.0")).err(), Some(VerifyError::NotNewer));
    }

    #[test]
    fn a_missing_or_malformed_signature_is_a_failure() {
        let ok = text(&fixtures(), &["signatures", "good"]);
        let bad = [String::new(), "!!!!".into(), "QUJD".into(), ok[..ok.len() - 4].to_string(), format!("{ok}A"), "A".repeat(MAX_SIGNATURE_BYTES + 4)];
        for sig in bad {
            assert_eq!(check_signature(&sig, &v("0.2.0"), &running()).err(), Some(VerifyError::Encoding), "{:?}", &sig[..sig.len().min(12)]);
        }
    }

    #[test]
    fn keys_must_decode_and_a_placeholder_is_refused() {
        assert_eq!(Keys::from_texts(&["PLACEHOLDER-SIGNING-KEY"]).err(), Some(KeyError::Placeholder));
        assert_eq!(Keys::from_texts(&["not base64"]).err(), Some(KeyError::Decode));
        assert_eq!(Keys::from_texts(&["QUJD"]).err(), Some(KeyError::Decode));
        assert_eq!(Keys::from_texts::<&str>(&[]).err(), Some(KeyError::Format));
    }

    #[test]
    fn base64_is_strict() {
        assert_eq!(base64_decode("QUJD").unwrap(), b"ABC");
        assert_eq!(base64_decode("QUI=").unwrap(), b"AB");
        assert_eq!(base64_decode("QQ==").unwrap(), b"A");
        for bad in ["", "QUJ", "QUJD\n", "QU=D", "Q===", "====", "QUJ-", "QUJD QUJD", "QQ==QUJD", "QUJ\u{e9}"] {
            assert!(base64_decode(bad).is_none(), "{bad:?}");
        }
    }

    #[test]
    fn a_file_over_the_cap_is_refused_without_being_held() {
        struct Endless(u64);
        impl Read for Endless {
            fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
                self.0 += buf.len() as u64;
                Ok(buf.len())
            }
        }
        let f = fixtures();
        let keys = Keys::from_texts(&[text(&f, &["keys", "x"])]).unwrap();
        let checked = check_signature(&text(&f, &["signatures", "good"]), &v("0.2.0"), &running()).unwrap();
        let mut endless = Endless(0);
        assert_eq!(keys.verify_reader(&checked, &mut endless), Err(VerifyError::TooLarge));
        assert!(endless.0 < MAX_INSTALLER_BYTES + 128 * 1024);
    }

    #[test]
    fn digests_are_stable_hex() {
        let d = signature_digest("abc");
        assert_eq!(d, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        assert!(is_digest(&d));
        assert!(!is_digest(&d.to_uppercase()));
        assert!(!is_digest("abc"));
    }
}
