//! Automatic updates for the desktop app. The page can ask the program about updates through a few
//! commands; everything that decides what is downloaded, trusted and installed lives here, in Rust.
//! Nothing in this module takes an address, a host, a header, a version or a path from the page.
//!
//! The flow, in short:
//! 1. A few seconds after the window opens (and only if the setting is on, the first-run notice was
//!    shown and the hourly limit allows it) the program asks one fixed address for `latest.json`.
//! 2. If it names a higher version, the installer is downloaded from the one address built from that
//!    version, checked against the compiled-in keys, and kept ready (staged).
//! 3. The staged installer runs at the next launch, before the window opens, or when the page asks
//!    ("Update now") and says it is idle. It is checked again, under a handle nobody can write
//!    through, immediately before it starts.
//!
//! Layout: `manifest` (the JSON file), `verify` and `keys` (trust), `store` (what is remembered),
//! `transport` and `transport_windows` (the network, one file), `install_kind` (may this copy update
//! itself), `launch_windows` (starting the installer, one file) and this file (the state machine).

pub mod install_kind;
pub mod keys;
#[cfg(windows)]
pub mod launch_windows;
pub mod manifest;
pub mod store;
pub mod transport;
#[cfg(windows)]
pub mod transport_windows;
pub mod verify;

#[cfg(test)]
mod testserver;

use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde::Serialize;

use install_kind::{alone, kind, Kind, Probe};
use manifest::{parse as parse_manifest, Endpoint, Version, MAX_INSTALLER_BYTES, MAX_MANIFEST_BYTES, MAX_SIGNATURE_BYTES};
use store::{ErrorCode, Failed, Paths, Pending, Rejected, Staged, State, Store};
use transport::{fetch, FetchOptions, NetError, Policy, Transport};
use verify::{check_signature, signature_digest, Keys};

/// Automatic checks are at least this far apart. "Check now" has its own, shorter limit.
const AUTO_INTERVAL_SECS: u64 = 3600;
const MANUAL_INTERVAL_SECS: u64 = 60;
/// A file that failed verification is not downloaded again automatically for this long.
const REJECT_BACKOFF_SECS: u64 = 24 * 3600;
/// A staged installer older than this is deleted, not run (a release may have been withdrawn since).
const STAGED_MAX_AGE_SECS: u64 = 48 * 3600;
/// Launches of the installer for one version before the launch-time apply is switched off for it.
const MAX_ATTEMPTS: u8 = 2;
/// Failed verifications or installs of one version before the quiet "Get it from GitHub" link appears.
const LINK_AFTER_FAILURES: u8 = 2;
/// Launches in a row that ended in a rule rejection before the same link appears.
const LINK_AFTER_POLICY: u8 = 3;
const CHECK_BUDGET: Duration = Duration::from_secs(20);
const CHECK_IDLE: Duration = Duration::from_secs(10);
const DOWNLOAD_BUDGET: Duration = Duration::from_secs(5 * 60);
const DOWNLOAD_IDLE: Duration = Duration::from_secs(30);
/// The background check starts this long after the window is created.
pub const START_DELAY: Duration = Duration::from_secs(3);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phase {
    Idle,
    Checking,
    Downloading,
    Staged,
    Installing,
    Failed,
}

impl Phase {
    fn as_str(self) -> &'static str {
        match self {
            Phase::Idle => "idle",
            Phase::Checking => "checking",
            Phase::Downloading => "downloading",
            Phase::Staged => "staged",
            Phase::Installing => "installing",
            Phase::Failed => "failed",
        }
    }
}

/// What the page may know about updates: enums, numbers and strings the program validated itself.
/// No text that came from the network ever reaches this struct.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Status {
    pub state: &'static str,
    pub percent: u8,
    pub version: Option<String>,
    pub current: String,
    pub auto: bool,
    pub last_checked_unix: u64,
    pub notice_pending: bool,
    pub link_enabled: bool,
    pub supported: bool,
    pub error: Option<&'static str>,
    pub updated_to: Option<String>,
}

impl Status {
    /// The status of a copy that cannot check for updates: nothing is running and nothing is promised.
    pub fn inert() -> Self {
        Status {
            state: "idle",
            percent: 0,
            version: None,
            current: env!("CARGO_PKG_VERSION").to_string(),
            auto: false,
            last_checked_unix: 0,
            notice_pending: false,
            link_enabled: false,
            supported: false,
            error: None,
            updated_to: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InstallError {
    /// The page is not idle, a picked file is in use, another copy runs, or the updater is busy.
    Busy,
    NotStaged,
    Unsupported,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LaunchError {
    /// The final check of the staged file failed, so nothing was started.
    Changed,
    /// The file could not be opened or the installer could not be started.
    Spawn,
}

/// Starting things outside the program. The Windows implementation is in `launch_windows.rs`.
pub trait Launcher: Send + Sync {
    /// Opens `installer` so nobody can write or delete it, lets `check` verify it through that same
    /// handle, and starts it while the handle is still held.
    fn start_installer(&self, installer: &Path, workdir: &Path, check: &mut dyn FnMut(&mut File) -> bool) -> Result<(), LaunchError>;
    /// Opens a page in the default browser. Only ever called with the fixed releases address.
    fn open_page(&self, url: &str) -> bool;
}

/// Everything fixed when the updater is built.
pub struct Config {
    pub endpoint: Endpoint,
    pub policy: Policy,
    /// `None` when the build has no usable keys (placeholders): nothing can verify, so nothing installs.
    pub keys: Option<Keys>,
    pub running: Version,
    /// The running version as text, as the page shows it (it may carry a pre-release label).
    pub running_text: String,
    pub paths: Paths,
}

/// The outside world, replaceable in tests.
pub struct Deps {
    pub transport: Arc<dyn Transport + Send + Sync>,
    pub probe: Arc<dyn Probe + Send + Sync>,
    pub launcher: Arc<dyn Launcher>,
    /// Seconds since 1970.
    pub clock: Arc<dyn Fn() -> u64 + Send + Sync>,
    /// True while a picked file is open or one was read in the last few seconds.
    pub busy: Arc<dyn Fn() -> bool + Send + Sync>,
}

struct Live {
    phase: Phase,
    percent: u8,
    /// The newer version that is known about, if any.
    version: Option<Version>,
    error: Option<ErrorCode>,
    last_manual: u64,
}

struct Inner {
    cfg: Config,
    deps: Deps,
    store: Mutex<Store>,
    live: Mutex<Live>,
    supported: bool,
    working: AtomicBool,
}

#[derive(Clone)]
pub struct Updater(Arc<Inner>);

fn locked<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Opens a file that no other open may share (on Windows). Used for the lock and the download.
fn open_exclusive(path: &Path) -> std::io::Result<File> {
    let mut options = OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(windows)]
    std::os::windows::fs::OpenOptionsExt::share_mode(&mut options, 0);
    options.open(path)
}

fn error_of(e: NetError) -> ErrorCode {
    match e {
        NetError::Offline => ErrorCode::Offline,
        NetError::Timeout => ErrorCode::Timeout,
        NetError::Tls => ErrorCode::Tls,
        NetError::Status(_) => ErrorCode::Status,
        NetError::Policy(_) => ErrorCode::Policy,
        NetError::Size | NetError::Encoding => ErrorCode::Size,
        NetError::Disk => ErrorCode::Disk,
    }
}

impl Updater {
    pub fn new(cfg: Config, deps: Deps) -> Updater {
        let supported = kind(&*deps.probe) == Kind::Supported;
        let store = Store::open(cfg.paths.clone());
        let live = Live { phase: Phase::Idle, percent: 0, version: None, error: None, last_manual: 0 };
        Updater(Arc::new(Inner { cfg, deps, store: Mutex::new(store), live: Mutex::new(live), supported, working: AtomicBool::new(false) }))
    }

    fn now(&self) -> u64 {
        (self.0.deps.clock)()
    }

    fn state(&self) -> State {
        locked(&self.0.store).state().clone()
    }

    /// Changes what is remembered. A failed write leaves the change in memory only.
    fn save(&self, change: impl FnOnce(&mut State)) {
        let _ = locked(&self.0.store).update(change);
    }

    fn live(&self, change: impl FnOnce(&mut Live)) {
        change(&mut locked(&self.0.live));
    }

    fn paths(&self) -> &Paths {
        &self.0.cfg.paths
    }

    /// First thing at launch: settles what the last run left behind. A launch on the version an
    /// installer was started for is a success. Any other launch counts as a failed attempt.
    pub fn startup(&self) {
        let running = self.0.cfg.running;
        let paths = self.paths();
        let _ = paths.create_dirs();
        self.save(|st| {
            if let Some(p) = st.pending_install.clone() {
                match Version::parse(&p.version) {
                    Some(v) if running >= v => {
                        st.updated_to = Some(p.version.clone());
                        st.pending_install = None;
                        st.failed = None;
                        st.link_enabled = false;
                        st.last_error = None;
                    }
                    Some(_) => {
                        st.last_error = Some(ErrorCode::Install);
                        bump_failed(st, &p.version);
                    }
                    None => st.pending_install = None,
                }
            }
            if st.staged.as_ref().and_then(|s| Version::parse(&s.version)).map_or(true, |v| v <= running) {
                st.staged = None;
            }
        });
        let state = self.state();
        let staged = state.staged.as_ref().and_then(|s| Version::parse(&s.version));
        paths.clean(staged.as_ref());
        self.live(|l| {
            l.error = state.last_error;
            match (&staged, state.last_error) {
                (_, Some(ErrorCode::Install)) => {
                    l.phase = Phase::Failed;
                    l.version = state.pending_install.as_ref().and_then(|p| Version::parse(&p.version));
                }
                (Some(v), _) if paths.staged_file(v).is_file() => {
                    l.phase = Phase::Staged;
                    l.version = Some(*v);
                }
                _ => {}
            }
        });
    }

    pub fn status(&self) -> Status {
        let state = self.state();
        let live = locked(&self.0.live);
        let version = live.version;
        let updated_to = state.updated_to.clone();
        let link = state.link_enabled || (!self.0.supported && version.is_some());
        let status = Status {
            state: live.phase.as_str(),
            percent: live.percent,
            version: version.map(|v| v.to_string()),
            current: self.0.cfg.running_text.clone(),
            auto: state.auto,
            last_checked_unix: state.last_checked_unix,
            notice_pending: !state.notice_seen,
            link_enabled: link,
            supported: self.0.supported,
            error: live.error.map(ErrorCode::as_str),
            updated_to: updated_to.clone(),
        };
        drop(live);
        if updated_to.is_some() {
            // shown once: the page keeps it for its short message
            self.save(|st| st.updated_to = None);
        }
        status
    }

    /// The page reports the first-run notice was shown (with the current value of the switch), or
    /// the person changed the switch. Either way the notice counts as seen. Turning it off deletes
    /// what was downloaded.
    pub fn set_auto(&self, on: bool) {
        self.save(|st| {
            st.auto = on;
            st.notice_seen = true;
        });
        if !on {
            if let Some(v) = self.state().staged.as_ref().and_then(|s| Version::parse(&s.version)) {
                self.paths().remove_staged(&v);
            }
            self.save(|st| st.staged = None);
            self.live(|l| {
                if matches!(l.phase, Phase::Staged | Phase::Failed) {
                    l.phase = Phase::Idle;
                    l.version = None;
                    l.percent = 0;
                }
            });
        }
    }

    /// Whether the background check may run now (setting on, notice shown, not within the hour).
    pub fn automatic_check_allowed(&self) -> bool {
        let st = self.state();
        st.auto && st.notice_seen && !throttled(self.now(), st.last_attempt_unix, AUTO_INTERVAL_SECS)
    }

    /// Runs a check on its own thread. `manual` is "Check now" (or "Update now" after a failure).
    pub fn start_check(&self, manual: bool) {
        let me = self.clone();
        std::thread::spawn(move || me.run_check(manual));
    }

    /// The background check: waits a few seconds, then checks if allowed. When the setting is off no
    /// thread is started at all, so no connection is opened.
    pub fn schedule(&self) {
        self.schedule_after(START_DELAY);
    }

    /// A launch checks only when it STARTS with the setting on and the first-run notice already shown. The launch that
    /// shows the notice does not: the page reports the notice within a second of opening, and looking at the setting
    /// again after the delay would count that and send the first request while the person is still reading it.
    fn schedule_after(&self, delay: Duration) {
        let st = self.state();
        if !st.auto || !st.notice_seen {
            return;
        }
        let me = self.clone();
        std::thread::spawn(move || {
            std::thread::sleep(delay);
            if me.automatic_check_allowed() {
                me.run_check(false);
            }
        });
    }

    /// Checks for an update and, if there is one, downloads and stages it. Blocks until done.
    pub fn run_check(&self, manual: bool) {
        let now = self.now();
        let st = self.state();
        if manual {
            if throttled(now, locked(&self.0.live).last_manual, MANUAL_INTERVAL_SECS) {
                return;
            }
        } else if !st.auto || !st.notice_seen || throttled(now, st.last_attempt_unix, AUTO_INTERVAL_SECS) {
            return;
        }
        if self.0.working.swap(true, Ordering::SeqCst) {
            return; // one operation at a time
        }
        let _working = Reset(&self.0.working);
        {
            let live = locked(&self.0.live);
            if matches!(live.phase, Phase::Installing) {
                return;
            }
        }
        let _ = self.paths().create_dirs();
        let Ok(_lock) = open_exclusive(&self.paths().lock_file()) else {
            self.fail_quiet(ErrorCode::Busy, manual);
            return;
        };
        if !alone(&*self.0.deps.probe) {
            self.fail_quiet(ErrorCode::Busy, manual);
            return;
        }
        self.live(|l| {
            if l.phase != Phase::Staged {
                l.phase = Phase::Checking;
            }
            l.percent = 0;
            l.error = None;
            if manual {
                l.last_manual = now;
            }
        });
        self.save(|st| st.last_attempt_unix = now);
        self.check_and_stage(manual, now);
    }

    fn check_and_stage(&self, manual: bool, now: u64) {
        let cfg = &self.0.cfg;
        let mut body = Vec::new();
        let options = FetchOptions { max_body: MAX_MANIFEST_BYTES as u64, require_length: false, deadline: Instant::now() + CHECK_BUDGET, idle: CHECK_IDLE, length_out: None };
        let fetched = fetch(&*self.0.deps.transport, &cfg.endpoint.manifest_url(), cfg.policy, &options, &mut |b| {
            body.extend_from_slice(b);
            Ok(())
        });
        if let Err(e) = fetched {
            self.manifest_failed(e);
            return;
        }
        self.save(|st| st.policy_rejections = 0);
        let manifest = match parse_manifest(&body, &cfg.endpoint) {
            Ok(m) => m,
            Err(_) => {
                self.finish_idle(Some(ErrorCode::Manifest), None);
                return;
            }
        };
        self.save(|st| st.last_checked_unix = now);
        let (version, running) = (manifest.version, cfg.running);
        if version <= running {
            // Up to date. Anything staged is for an older or the same version: drop it.
            self.drop_staged();
            self.finish_idle(None, None);
            return;
        }
        let st = self.state();
        if let Some(staged) = st.staged.as_ref().and_then(|s| Version::parse(&s.version).map(|v| (v, s.at_unix))) {
            if staged.0 != version || now.saturating_sub(staged.1) >= STAGED_MAX_AGE_SECS || !self.paths().staged_file(&staged.0).is_file() {
                self.drop_staged();
            } else {
                self.live(|l| {
                    l.phase = Phase::Staged;
                    l.version = Some(version);
                    l.percent = 100;
                });
                return;
            }
        }
        let signature_hash = signature_digest(&manifest.signature);
        let backed_off = st.rejected.as_ref().is_some_and(|r| r.version == version.to_string() && r.signature_sha256 == signature_hash && now.saturating_sub(r.at_unix) < REJECT_BACKOFF_SECS);
        if backed_off && !manual {
            self.finish_idle(Some(ErrorCode::Signature), None);
            return;
        }
        if !self.0.supported {
            self.finish_idle(Some(ErrorCode::Unsupported), Some(version));
            return;
        }
        let Some(keys) = cfg.keys.as_ref() else {
            self.finish_idle(Some(ErrorCode::Keys), None);
            return;
        };
        let checked = match check_signature(&manifest.signature, &version, &running) {
            Ok(c) => c,
            Err(_) => {
                self.verification_failed(version, &signature_hash, now);
                return;
            }
        };
        self.live(|l| {
            l.phase = Phase::Downloading;
            l.version = Some(version);
            l.percent = 0;
        });
        let part = self.paths().part_file(&version);
        if let Err(code) = self.download(&version, &part) {
            let _ = fs::remove_file(&part);
            self.fail_download(version, code, manual);
            return;
        }
        let verified = File::open(&part).map_err(|_| VerifyOutcome::Disk).and_then(|mut f| keys.verify_reader(&checked, &mut f).map_err(|_| VerifyOutcome::Bad));
        match verified {
            Ok(()) => {}
            Err(why) => {
                let _ = fs::remove_file(&part);
                match why {
                    VerifyOutcome::Bad => self.verification_failed(version, &signature_hash, now),
                    VerifyOutcome::Disk => self.fail_download(version, ErrorCode::Disk, manual),
                }
                return;
            }
        }
        let (ready, sig_file) = (self.paths().staged_file(&version), self.paths().sig_file(&version));
        let moved = fs::remove_file(&ready).or_else(|e| if e.kind() == std::io::ErrorKind::NotFound { Ok(()) } else { Err(e) }).and_then(|()| fs::rename(&part, &ready)).and_then(|()| fs::write(&sig_file, manifest.signature.as_bytes()));
        if moved.is_err() {
            let _ = fs::remove_file(&part);
            self.paths().remove_staged(&version);
            self.fail_download(version, ErrorCode::Disk, manual);
            return;
        }
        self.save(|st| {
            st.staged = Some(Staged { version: version.to_string(), at_unix: now });
            st.last_error = None;
        });
        self.live(|l| {
            l.phase = Phase::Staged;
            l.percent = 100;
            l.version = Some(version);
        });
    }

    /// Streams the installer to `part`, which is held exclusively while it is written.
    fn download(&self, version: &Version, part: &Path) -> Result<(), ErrorCode> {
        let mut file = open_exclusive(part).map_err(|_| ErrorCode::Disk)?;
        let declared = AtomicU64::new(0);
        let (mut received, mut last_percent) = (0u64, 0u8);
        let options = FetchOptions { max_body: MAX_INSTALLER_BYTES, require_length: true, deadline: Instant::now() + DOWNLOAD_BUDGET, idle: DOWNLOAD_IDLE, length_out: Some(&declared) };
        let url = self.0.cfg.endpoint.installer_url(version);
        fetch(&*self.0.deps.transport, &url, self.0.cfg.policy, &options, &mut |chunk| {
            file.write_all(chunk).map_err(|_| NetError::Disk)?;
            received += chunk.len() as u64;
            let total = declared.load(Ordering::Relaxed);
            let percent = if total > 0 { (received.saturating_mul(100) / total).min(100) as u8 } else { 0 };
            if percent != last_percent {
                last_percent = percent;
                self.live(|l| l.percent = percent);
            }
            Ok(())
        })
        .map_err(error_of)?;
        file.flush().map_err(|_| ErrorCode::Disk)?;
        file.sync_all().map_err(|_| ErrorCode::Disk)
    }

    fn manifest_failed(&self, e: NetError) {
        let code = error_of(e);
        self.save(|st| {
            if matches!(e, NetError::Policy(_)) {
                st.policy_rejections = st.policy_rejections.saturating_add(1).min(store::MAX_COUNT);
                if st.policy_rejections >= LINK_AFTER_POLICY {
                    st.link_enabled = true;
                }
            } else {
                st.policy_rejections = 0;
            }
            st.last_error = Some(code);
        });
        self.finish_idle(Some(code), None);
    }

    /// Back to idle. `error` is what a "Check now" shows; `version` is a newer version that is known
    /// but could not be staged.
    fn finish_idle(&self, error: Option<ErrorCode>, version: Option<Version>) {
        self.live(|l| {
            l.phase = if l.phase == Phase::Staged { Phase::Staged } else { Phase::Idle };
            l.error = error;
            l.percent = 0;
            if l.phase != Phase::Staged {
                l.version = version;
            }
        });
    }

    fn fail_quiet(&self, code: ErrorCode, manual: bool) {
        if manual {
            self.live(|l| l.error = Some(code));
        }
    }

    /// A network failure while downloading: shown only after the person asked for it.
    fn fail_download(&self, version: Version, code: ErrorCode, manual: bool) {
        self.save(|st| st.last_error = Some(code));
        self.live(|l| {
            l.phase = if manual { Phase::Failed } else { Phase::Idle };
            l.error = Some(code);
            l.version = if manual { Some(version) } else { None };
            l.percent = 0;
        });
    }

    /// The signature did not verify: remember the pair so the same file is not fetched again for a day.
    fn verification_failed(&self, version: Version, signature_hash: &str, now: u64) {
        let text = version.to_string();
        self.save(|st| {
            st.last_error = Some(ErrorCode::Signature);
            st.rejected = Some(Rejected { version: text.clone(), signature_sha256: signature_hash.to_string(), at_unix: now });
            bump_failed(st, &text);
        });
        self.live(|l| {
            l.phase = Phase::Failed;
            l.error = Some(ErrorCode::Signature);
            l.version = Some(version);
            l.percent = 0;
        });
    }

    fn drop_staged(&self) {
        if let Some(v) = self.state().staged.as_ref().and_then(|s| Version::parse(&s.version)) {
            self.paths().remove_staged(&v);
        }
        self.save(|st| st.staged = None);
        self.live(|l| {
            if l.phase == Phase::Staged {
                l.phase = Phase::Idle;
                l.version = None;
            }
        });
    }

    /// The page asks to install what is staged. `idle` is the page's claim that nothing is in progress.
    pub fn install(&self, idle: bool) -> Result<(), InstallError> {
        if !idle || (self.0.deps.busy)() || !alone(&*self.0.deps.probe) || self.0.working.load(Ordering::SeqCst) {
            return Err(InstallError::Busy);
        }
        if !self.0.supported {
            return Err(InstallError::Unsupported);
        }
        self.launch_staged()
    }

    /// Before the window exists: if the setting is on and a fresh, verified installer is waiting, run
    /// it. Returns true when the installer was started, so the caller exits instead of opening the window.
    pub fn apply_at_launch(&self) -> bool {
        let st = self.state();
        let Some(staged) = st.staged.clone() else { return false };
        let Some(version) = Version::parse(&staged.version) else { return false };
        if self.now().saturating_sub(staged.at_unix) >= STAGED_MAX_AGE_SECS {
            self.drop_staged();
            return false;
        }
        let attempts = st.pending_install.as_ref().filter(|p| p.version == staged.version).map_or(0, |p| p.attempts);
        let allowed = st.auto && st.notice_seen && self.0.supported && alone(&*self.0.deps.probe) && version > self.0.cfg.running && attempts < MAX_ATTEMPTS;
        allowed && self.launch_staged().is_ok()
    }

    /// Launching is one-way: once an installer was started, no second one is, whoever asks (a double click on
    /// "Restart now", a script in the page, a queued command). The check and the change are one step under the lock.
    /// Returns the phase to go back to if this attempt ends before anything was started.
    fn begin_launch(&self) -> Option<Phase> {
        let mut live = locked(&self.0.live);
        if live.phase == Phase::Installing {
            return None;
        }
        Some(std::mem::replace(&mut live.phase, Phase::Installing))
    }

    fn launch_staged(&self) -> Result<(), InstallError> {
        let Some(before) = self.begin_launch() else { return Err(InstallError::Busy) };
        let result = self.launch_staged_once();
        // Nothing was started and no failure was recorded (nothing staged, a bad signature file): the phase is as it was.
        if matches!(result, Err(InstallError::NotStaged | InstallError::Failed)) && self.phase() == Phase::Installing {
            self.live(|l| l.phase = before);
        }
        result
    }

    fn phase(&self) -> Phase {
        locked(&self.0.live).phase
    }

    fn launch_staged_once(&self) -> Result<(), InstallError> {
        let state = self.state();
        let version = state.staged.as_ref().and_then(|s| Version::parse(&s.version)).ok_or(InstallError::NotStaged)?;
        let (installer, sig_file) = (self.paths().staged_file(&version), self.paths().sig_file(&version));
        let keys = self.0.cfg.keys.as_ref().ok_or(InstallError::Failed)?;
        let signature = read_signature(&sig_file).ok_or(InstallError::NotStaged)?;
        let Ok(checked) = check_signature(&signature, &version, &self.0.cfg.running) else {
            self.paths().remove_staged(&version);
            self.save(|st| st.staged = None);
            return Err(InstallError::Failed);
        };
        let text = version.to_string();
        let previous = state.pending_install.clone();
        let attempts = previous.as_ref().filter(|p| p.version == text).map_or(0, |p| p.attempts).saturating_add(1).min(store::MAX_COUNT);
        // Written BEFORE the installer starts, so a launch that does not end up on this version is counted.
        self.save(|st| st.pending_install = Some(Pending { version: text.clone(), attempts }));
        self.live(|l| l.phase = Phase::Installing);
        let mut verify = |file: &mut File| keys.verify_reader(&checked, file).is_ok();
        match self.0.deps.launcher.start_installer(&installer, &self.paths().ready_dir(), &mut verify) {
            Ok(()) => Ok(()),
            Err(why) => {
                self.save(|st| {
                    st.pending_install = previous;
                    st.last_error = Some(ErrorCode::Install);
                    bump_failed(st, &text);
                });
                if why == LaunchError::Changed {
                    self.paths().remove_staged(&version);
                    self.save(|st| st.staged = None);
                }
                self.live(|l| {
                    l.phase = Phase::Failed;
                    l.error = Some(ErrorCode::Install);
                    l.version = Some(version);
                });
                Err(InstallError::Failed)
            }
        }
    }

    /// Opens the fixed releases page, but only once the link was enabled (repeated failures, or a
    /// copy that cannot update itself).
    pub fn open_releases(&self) -> bool {
        let status = self.status();
        status.link_enabled && self.0.deps.launcher.open_page(&self.0.cfg.endpoint.releases_page())
    }
}

enum VerifyOutcome {
    Bad,
    Disk,
}

/// Clears the "one operation at a time" flag when a check ends, however it ends.
struct Reset<'a>(&'a AtomicBool);

impl Drop for Reset<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

/// True when `last` was less than `interval` seconds before `now`. A time in the future (a clock
/// change, or a tampered file) does not block anything.
fn throttled(now: u64, last: u64, interval: u64) -> bool {
    last != 0 && last <= now && now - last < interval
}

fn bump_failed(st: &mut State, version: &str) {
    let count = match &st.failed {
        Some(f) if f.version == version => f.count.saturating_add(1).min(store::MAX_COUNT),
        _ => 1,
    };
    st.failed = Some(Failed { version: version.to_string(), count });
    if count >= LINK_AFTER_FAILURES {
        st.link_enabled = true;
    }
}

/// The version this program is. The end-to-end test build can be given another one at compile time (`SNAPPY_E2E_VERSION`),
/// so two builds that differ only in version can be made without editing the manifest files.
#[cfg(feature = "dev-update-endpoint")]
const RUNNING_VERSION: &str = match option_env!("SNAPPY_E2E_VERSION") {
    Some(v) => v,
    None => env!("CARGO_PKG_VERSION"),
};
#[cfg(not(feature = "dev-update-endpoint"))]
const RUNNING_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Where this build looks for updates: the repository's GitHub releases. The end-to-end test build
/// (`dev-update-endpoint`) instead reads a loopback address from the environment, and has no updater
/// at all when that is not set.
#[cfg(not(feature = "dev-update-endpoint"))]
fn build_endpoint() -> Option<(Endpoint, Policy)> {
    Some((Endpoint::release(), Policy::Release))
}

#[cfg(feature = "dev-update-endpoint")]
fn build_endpoint() -> Option<(Endpoint, Policy)> {
    std::env::var("SNAPPY_UPDATE_ENDPOINT").ok().map(|base| (Endpoint::loopback(&base), Policy::Loopback))
}

/// The updater of this running program: the real network, the real Windows checks, the system clock.
/// `data_dir` is the app's local data folder; `product` and `publisher` name the installer's registry
/// record. `busy` tells whether a picked file is open or was just read. `None` on systems other
/// than Windows (their update path is a later decision) and when the running version is unreadable.
#[cfg(windows)]
pub fn for_app(data_dir: &Path, product: &str, publisher: &str, busy: Arc<dyn Fn() -> bool + Send + Sync>) -> Option<Updater> {
    let running_text = RUNNING_VERSION;
    let (endpoint, policy) = build_endpoint()?;
    let config = Config {
        endpoint,
        policy,
        keys: keys::trusted().ok(),
        running: Version::running(running_text)?,
        running_text: running_text.to_string(),
        paths: Paths::new(data_dir.join("updates")),
    };
    let clock = || std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs());
    Some(Updater::new(
        config,
        Deps {
            transport: Arc::new(transport_windows::SystemTransport),
            probe: Arc::new(launch_windows::SystemProbe { product_key: format!(r"Software\{publisher}\{product}") }),
            launcher: Arc::new(launch_windows::WindowsLauncher),
            clock: Arc::new(clock),
            busy,
        },
    ))
}

#[cfg(not(windows))]
pub fn for_app(_data_dir: &Path, _product: &str, _publisher: &str, _busy: Arc<dyn Fn() -> bool + Send + Sync>) -> Option<Updater> {
    None
}

fn read_signature(path: &Path) -> Option<String> {
    let mut text = String::new();
    File::open(path).ok()?.take(MAX_SIGNATURE_BYTES as u64 + 1).read_to_string(&mut text).ok()?;
    (text.len() <= MAX_SIGNATURE_BYTES).then_some(text)
}

#[cfg(all(test, windows))]
mod tests;
