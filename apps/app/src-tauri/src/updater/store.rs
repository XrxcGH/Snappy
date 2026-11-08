//! What the updater remembers between launches (`updater.json`) and where its files live.
//!
//! `updater.json` is untrusted input: another program running as the same user may edit it. So it
//! stores only a toggle, flags, small counters, error codes, timestamps and validated `x.y.z`
//! version strings. It never stores a path or an address, it is size limited, it is parsed with
//! unknown fields refused, and anything wrong with it resets it to the defaults. Every file name the
//! updater uses is rebuilt from constants and a validated version, never read from here.

use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::manifest::{installer_name, Version};
use super::verify::is_digest;

const MAX_STATE_BYTES: u64 = 4096;
const MAX_COUNT: u8 = 10;

/// Why the last operation failed. Only this code is kept and shown: no text from the network.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    /// No connection, a refused connection, a reset or a failed lookup.
    Offline,
    Timeout,
    /// A status other than 200 (and not a redirect), such as 404 before the first release.
    Status,
    /// The address or a redirect broke the rules (host, scheme, port, too many redirects).
    Policy,
    /// The certificate or the secure connection failed.
    Tls,
    /// The manifest was not acceptable.
    Manifest,
    /// The file was too large, or its length was missing or wrong.
    Size,
    /// The signature did not verify, or it named another file or version.
    Signature,
    /// The staged file could not be written, read or removed.
    Disk,
    /// The installer did not run, or the program is not the new version after it ran.
    Install,
    /// Another Snappy process or another updater is running.
    Busy,
    /// This copy is not the per-user install, or runs with administrator rights.
    Unsupported,
    /// No key can verify anything (a build without real update keys).
    Keys,
}

impl ErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            ErrorCode::Offline => "offline",
            ErrorCode::Timeout => "timeout",
            ErrorCode::Status => "status",
            ErrorCode::Policy => "policy",
            ErrorCode::Tls => "tls",
            ErrorCode::Manifest => "manifest",
            ErrorCode::Size => "size",
            ErrorCode::Signature => "signature",
            ErrorCode::Disk => "disk",
            ErrorCode::Install => "install",
            ErrorCode::Busy => "busy",
            ErrorCode::Unsupported => "unsupported",
            ErrorCode::Keys => "keys",
        }
    }
}

/// A file that failed verification: not downloaded again automatically for a day.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Rejected {
    pub version: String,
    pub signature_sha256: String,
    pub at_unix: u64,
}

/// How many times this version failed to verify or install.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Failed {
    pub version: String,
    pub count: u8,
}

/// Written just before the installer is launched. If the running version is not this one at the
/// next launch, that attempt failed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Pending {
    pub version: String,
    pub attempts: u8,
}

/// An installer that was downloaded, verified and is waiting.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Staged {
    pub version: String,
    pub at_unix: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, default)]
pub struct State {
    /// "Check for updates on launch". On by default.
    pub auto: bool,
    /// The first-run notice was shown. No automatic check runs before this.
    pub notice_seen: bool,
    pub last_attempt_unix: u64,
    pub last_checked_unix: u64,
    /// The quiet "Get it from GitHub" link may be used.
    pub link_enabled: bool,
    /// Launches in a row that ended in a rule rejection (not a plain network error).
    pub policy_rejections: u8,
    pub rejected: Option<Rejected>,
    pub failed: Option<Failed>,
    pub pending_install: Option<Pending>,
    pub staged: Option<Staged>,
    pub last_error: Option<ErrorCode>,
    /// Set after a launch on a newly installed version, to show a short message once.
    pub updated_to: Option<String>,
}

impl Default for State {
    fn default() -> Self {
        State {
            auto: true,
            notice_seen: false,
            last_attempt_unix: 0,
            last_checked_unix: 0,
            link_enabled: false,
            policy_rejections: 0,
            rejected: None,
            failed: None,
            pending_install: None,
            staged: None,
            last_error: None,
            updated_to: None,
        }
    }
}

fn version_ok(text: &str) -> bool {
    Version::parse(text).is_some()
}

impl State {
    /// True when every field is inside the range the program itself could have written.
    fn is_sane(&self) -> bool {
        self.policy_rejections <= MAX_COUNT
            && self.rejected.as_ref().map_or(true, |r| version_ok(&r.version) && is_digest(&r.signature_sha256))
            && self.failed.as_ref().map_or(true, |f| version_ok(&f.version) && f.count <= MAX_COUNT)
            && self.pending_install.as_ref().map_or(true, |p| version_ok(&p.version) && p.attempts <= MAX_COUNT)
            && self.staged.as_ref().map_or(true, |s| version_ok(&s.version))
            && self.updated_to.as_deref().map_or(true, version_ok)
    }
}

/// The files of the updater, all under one folder inside the app's data folder. Names are built
/// here from constants and validated versions.
#[derive(Debug, Clone)]
pub struct Paths {
    root: PathBuf,
}

impl Paths {
    /// `root` is `<app local data>/updates`.
    pub fn new(root: PathBuf) -> Paths {
        Paths { root }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn state_file(&self) -> PathBuf {
        self.root.join("updater.json")
    }

    fn state_temp(&self) -> PathBuf {
        self.root.join("updater.json.tmp")
    }

    pub fn lock_file(&self) -> PathBuf {
        self.root.join("lock")
    }

    pub fn tmp_dir(&self) -> PathBuf {
        self.root.join("tmp")
    }

    pub fn ready_dir(&self) -> PathBuf {
        self.root.join("ready")
    }

    pub fn part_file(&self, version: &Version) -> PathBuf {
        self.tmp_dir().join(format!("{}.part", installer_name(version)))
    }

    pub fn staged_file(&self, version: &Version) -> PathBuf {
        self.ready_dir().join(installer_name(version))
    }

    /// The signature text kept beside a staged installer, so the file can be checked again just before it runs.
    pub fn sig_file(&self, version: &Version) -> PathBuf {
        self.ready_dir().join(format!("{}.sig", installer_name(version)))
    }

    pub fn create_dirs(&self) -> io::Result<()> {
        fs::create_dir_all(self.tmp_dir())?;
        fs::create_dir_all(self.ready_dir())
    }

    /// Deletes the known kinds of file in `tmp` and `ready` (an installer, a `.part`) except the
    /// one installer `keep`, and the temporary state file. It never deletes a directory, never
    /// recurses, and leaves every other name alone.
    pub fn clean(&self, keep: Option<&Version>) {
        let kept = keep.map(installer_name);
        let kept_sig = kept.as_ref().map(|n| format!("{n}.sig"));
        let _ = fs::remove_file(self.state_temp());
        for dir in [self.tmp_dir(), self.ready_dir()] {
            let Ok(entries) = fs::read_dir(&dir) else { continue };
            for entry in entries.flatten() {
                let Some(name) = entry.file_name().to_str().map(str::to_string) else { continue };
                let installer = name.strip_suffix(".part").or_else(|| name.strip_suffix(".sig")).unwrap_or(&name);
                if !is_installer_name(installer) || Some(&name) == kept.as_ref() || Some(&name) == kept_sig.as_ref() {
                    continue;
                }
                if entry.file_type().is_ok_and(|t| t.is_file()) {
                    let _ = fs::remove_file(entry.path());
                }
            }
        }
    }

    /// Deletes the staged installer for `version` and its signature, if any.
    pub fn remove_staged(&self, version: &Version) {
        let _ = fs::remove_file(self.staged_file(version));
        let _ = fs::remove_file(self.sig_file(version));
    }
}

/// True for `Snappy_<x.y.z>_x64-setup.exe` with a valid version.
fn is_installer_name(name: &str) -> bool {
    name.strip_prefix("Snappy_")
        .and_then(|rest| rest.strip_suffix("_x64-setup.exe"))
        .and_then(Version::parse)
        .is_some()
}

/// `updater.json`, loaded, held in memory and written atomically.
pub struct Store {
    paths: Paths,
    state: State,
}

impl Store {
    /// Loads the state. A missing, oversized, unreadable, corrupt or out-of-range file gives the defaults.
    pub fn open(paths: Paths) -> Store {
        let state = load(&paths.state_file()).unwrap_or_default();
        Store { paths, state }
    }

    pub fn state(&self) -> &State {
        &self.state
    }

    pub fn paths(&self) -> &Paths {
        &self.paths
    }

    /// Changes the state and writes it. The change stays in memory even if the write fails.
    pub fn update<F: FnOnce(&mut State)>(&mut self, change: F) -> io::Result<()> {
        change(&mut self.state);
        if !self.state.is_sane() {
            self.state = State::default();
        }
        self.save()
    }

    fn save(&self) -> io::Result<()> {
        fs::create_dir_all(self.paths.root())?;
        let text = serde_json::to_vec_pretty(&self.state).map_err(io::Error::other)?;
        let temp = self.paths.state_temp();
        let mut file = File::create(&temp)?;
        file.write_all(&text)?;
        file.flush()?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temp, self.paths.state_file())
    }
}

fn load(path: &Path) -> Option<State> {
    let meta = fs::metadata(path).ok()?;
    if !meta.is_file() || meta.len() > MAX_STATE_BYTES {
        return None;
    }
    let state: State = serde_json::from_slice(&fs::read(path).ok()?).ok()?;
    state.is_sane().then_some(state)
}

#[cfg(test)]
pub fn scratch_dir(tag: &str) -> PathBuf {
    use std::sync::atomic::{AtomicU32, Ordering};
    static N: AtomicU32 = AtomicU32::new(0);
    let dir = std::env::temp_dir().join(format!("snappy-updater-test-{}-{}-{tag}", std::process::id(), N.fetch_add(1, Ordering::Relaxed)));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(s: &str) -> Version {
        Version::parse(s).unwrap()
    }

    fn full_state() -> State {
        State {
            auto: false,
            notice_seen: true,
            last_attempt_unix: 1_794_000_000,
            last_checked_unix: 1_794_000_001,
            link_enabled: true,
            policy_rejections: 2,
            rejected: Some(Rejected { version: "0.2.0".into(), signature_sha256: "a".repeat(64), at_unix: 5 }),
            failed: Some(Failed { version: "0.2.0".into(), count: 2 }),
            pending_install: Some(Pending { version: "0.2.0".into(), attempts: 1 }),
            staged: Some(Staged { version: "0.2.0".into(), at_unix: 7 }),
            last_error: Some(ErrorCode::Signature),
            updated_to: Some("0.1.9".into()),
        }
    }

    #[test]
    fn defaults_are_on_and_unseen() {
        let dir = scratch_dir("defaults");
        let store = Store::open(Paths::new(dir.join("updates")));
        assert!(store.state().auto);
        assert!(!store.state().notice_seen);
        assert_eq!(*store.state(), State::default());
    }

    #[test]
    fn a_change_is_written_atomically_and_read_back() {
        let dir = scratch_dir("roundtrip");
        let paths = Paths::new(dir.join("updates"));
        let mut store = Store::open(paths.clone());
        let full = full_state();
        let copy = full.clone();
        store.update(move |s| *s = copy).unwrap();
        assert!(!paths.state_temp().exists(), "the temporary file is renamed away");
        assert_eq!(*Store::open(paths.clone()).state(), full);
        store.update(|s| s.auto = true).unwrap();
        assert!(Store::open(paths).state().auto);
    }

    #[test]
    fn nothing_that_looks_like_a_path_or_an_address_is_ever_stored() {
        let json = serde_json::to_string(&full_state()).unwrap();
        for bad in ["/", "\\", "http", ".exe", ".part"] {
            assert!(!json.contains(bad), "{bad} found in {json}");
        }
    }

    #[test]
    fn a_corrupt_oversized_or_unknown_file_resets_to_defaults() {
        let dir = scratch_dir("corrupt");
        let paths = Paths::new(dir.join("updates"));
        fs::create_dir_all(paths.root()).unwrap();
        let good = serde_json::to_string(&full_state()).unwrap();
        let cases: Vec<(&str, String)> = vec![
            ("garbage", "not json".into()),
            ("empty", String::new()),
            ("truncated", good[..good.len() / 2].to_string()),
            ("unknown field", good.replacen('{', "{\"path\":\"C:\\\\x\",", 1)),
            ("unknown nested field", good.replace("\"count\":2", "\"count\":2,\"url\":\"x\"")),
            ("bad version", good.replace("\"updated_to\":\"0.1.9\"", "\"updated_to\":\"..\\\\x\"")),
            ("bad digest", good.replace(&"a".repeat(64), "zz")),
            ("big count", good.replace("\"count\":2", "\"count\":200")),
            ("too big", format!("{good}{}", " ".repeat(5000))),
        ];
        for (name, text) in cases {
            fs::write(paths.state_file(), &text).unwrap();
            assert_eq!(*Store::open(paths.clone()).state(), State::default(), "{name}");
        }
        fs::write(paths.state_file(), &good).unwrap();
        assert_eq!(*Store::open(paths).state(), full_state(), "the good file loads");
    }

    #[test]
    fn a_missing_field_takes_its_default() {
        let dir = scratch_dir("partial");
        let paths = Paths::new(dir.join("updates"));
        fs::create_dir_all(paths.root()).unwrap();
        fs::write(paths.state_file(), "{\"notice_seen\":true}").unwrap();
        let state = Store::open(paths).state().clone();
        assert!(state.notice_seen && state.auto);
    }

    #[test]
    fn file_names_come_from_constants_and_a_version() {
        let paths = Paths::new(PathBuf::from("root"));
        assert_eq!(paths.part_file(&v("0.2.0")), Path::new("root").join("tmp").join("Snappy_0.2.0_x64-setup.exe.part"));
        assert_eq!(paths.staged_file(&v("0.2.0")), Path::new("root").join("ready").join("Snappy_0.2.0_x64-setup.exe"));
        assert_eq!(paths.state_file(), Path::new("root").join("updater.json"));
        assert_eq!(paths.lock_file(), Path::new("root").join("lock"));
    }

    #[test]
    fn cleaning_deletes_only_known_names_and_keeps_the_one_asked_for() {
        let dir = scratch_dir("clean");
        let paths = Paths::new(dir.join("updates"));
        paths.create_dirs().unwrap();
        let write = |p: PathBuf| fs::write(p, b"x").unwrap();
        write(paths.staged_file(&v("0.2.0")));
        write(paths.staged_file(&v("0.3.0")));
        write(paths.part_file(&v("0.4.0")));
        write(paths.ready_dir().join("notes.txt"));
        write(paths.tmp_dir().join("Snappy_01.2.0_x64-setup.exe"));
        write(paths.tmp_dir().join("..Snappy_0.2.0_x64-setup.exe"));
        fs::create_dir(paths.ready_dir().join("Snappy_0.9.0_x64-setup.exe")).unwrap();
        write(paths.ready_dir().join("Snappy_0.9.0_x64-setup.exe").join("inner.txt"));
        paths.clean(Some(&v("0.3.0")));
        assert!(!paths.staged_file(&v("0.2.0")).exists());
        assert!(paths.staged_file(&v("0.3.0")).exists(), "the kept installer stays");
        assert!(!paths.part_file(&v("0.4.0")).exists());
        assert!(paths.ready_dir().join("notes.txt").exists(), "unknown names are left alone");
        assert!(paths.tmp_dir().join("Snappy_01.2.0_x64-setup.exe").exists(), "a name with a bad version is not ours");
        assert!(paths.ready_dir().join("Snappy_0.9.0_x64-setup.exe").join("inner.txt").exists(), "a directory is never deleted");
        paths.clean(None);
        assert!(!paths.staged_file(&v("0.3.0")).exists());
    }

    #[test]
    fn error_codes_have_stable_names() {
        let all = [
            ErrorCode::Offline, ErrorCode::Timeout, ErrorCode::Status, ErrorCode::Policy, ErrorCode::Tls, ErrorCode::Manifest, ErrorCode::Size,
            ErrorCode::Signature, ErrorCode::Disk, ErrorCode::Install, ErrorCode::Busy, ErrorCode::Unsupported, ErrorCode::Keys,
        ];
        for code in all {
            assert_eq!(serde_json::to_string(&code).unwrap(), format!("\"{}\"", code.as_str()));
        }
    }
}
