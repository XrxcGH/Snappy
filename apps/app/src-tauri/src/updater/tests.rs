//! The updater end to end, inside the test process: the real WinHTTP transport talks to a loopback
//! server that plays GitHub, signatures come from the committed TEST fixtures, and the installer is
//! a fake launcher that records what it was asked to start. No window, no install, no outside network.

use std::fs::File;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use serde_json::Value;

use super::install_kind::Fake;
use super::store::scratch_dir;
use super::testserver::{Reply, Request, Server};
use super::transport_windows::WinHttp;
use super::*;

const BASE_PATH: &str = "/XrxcGH/Snappy";
const START: u64 = 1_794_000_000;

fn fixtures() -> Value {
    serde_json::from_str(include_str!("testdata/signatures.json")).unwrap()
}

fn text(path: &[&str]) -> String {
    path.iter().fold(&fixtures(), |v, k| &v[*k]).as_str().unwrap().to_string()
}

fn installer_bytes() -> Vec<u8> {
    verify::base64_decode(&text(&["contentBase64"])).unwrap()
}

#[derive(Clone)]
struct Serve {
    version: String,
    installer: Vec<u8>,
    signature: String,
    manifest_status: u16,
    manifest_redirect: Option<String>,
    wrong_url: bool,
}

struct SharedProbe(Mutex<Fake>);

impl Probe for SharedProbe {
    fn exe_path(&self) -> Option<PathBuf> {
        self.0.lock().unwrap().exe_path()
    }
    fn registered_install_dir(&self) -> Option<PathBuf> {
        self.0.lock().unwrap().registered_install_dir()
    }
    fn local_app_data(&self) -> Option<PathBuf> {
        self.0.lock().unwrap().local_app_data()
    }
    fn is_elevated(&self) -> Option<bool> {
        self.0.lock().unwrap().is_elevated()
    }
    fn other_instances(&self) -> Option<u32> {
        self.0.lock().unwrap().other_instances()
    }
}

#[derive(Default)]
struct FakeLauncher {
    started: Mutex<Vec<PathBuf>>,
    opened: Mutex<Vec<String>>,
    spawn_fails: AtomicBool,
}

impl Launcher for FakeLauncher {
    fn start_installer(&self, installer: &Path, _workdir: &Path, check: &mut dyn FnMut(&mut File) -> bool) -> Result<(), LaunchError> {
        let mut file = File::open(installer).map_err(|_| LaunchError::Spawn)?;
        if !check(&mut file) {
            return Err(LaunchError::Changed);
        }
        if self.spawn_fails.load(Ordering::SeqCst) {
            return Err(LaunchError::Spawn);
        }
        self.started.lock().unwrap().push(installer.to_path_buf());
        Ok(())
    }

    fn open_page(&self, url: &str) -> bool {
        self.opened.lock().unwrap().push(url.to_string());
        true
    }
}

struct Rig {
    dir: PathBuf,
    server: Server,
    serve: Arc<Mutex<Serve>>,
    clock: Arc<AtomicU64>,
    launcher: Arc<FakeLauncher>,
    probe: Arc<SharedProbe>,
    busy: Arc<AtomicBool>,
    up: Updater,
}

fn header(req: &Request, name: &str) -> String {
    req.headers.iter().find(|(k, _)| k.eq_ignore_ascii_case(name)).map(|(_, v)| v.clone()).unwrap_or_default()
}

impl Rig {
    /// A copy running `running`, installed per user, with the fixture's good 0.2.0 on the server.
    fn new(running: &str) -> Rig {
        let serve = Arc::new(Mutex::new(Serve {
            version: "0.2.0".into(),
            installer: installer_bytes(),
            signature: text(&["signatures", "good"]),
            manifest_status: 200,
            manifest_redirect: None,
            wrong_url: false,
        }));
        let for_server = serve.clone();
        let server = Server::start(move |req| {
            let s = for_server.lock().unwrap().clone();
            let v = &s.version;
            if req.path == format!("{BASE_PATH}/releases/latest/download/latest.json") {
                if let Some(to) = &s.manifest_redirect {
                    return Reply::redirect(302, to);
                }
                if s.manifest_status != 200 {
                    return Reply::status(s.manifest_status);
                }
                let url = if s.wrong_url { format!("http://{}/elsewhere.exe", header(req, "host")) } else { format!("http://{}{BASE_PATH}/releases/download/v{v}/Snappy_{v}_x64-setup.exe", header(req, "host")) };
                let json = format!(r#"{{"version":"{v}","notes":"ignored","platforms":{{"windows-x86_64":{{"signature":"{}","url":"{url}"}}}}}}"#, s.signature);
                Reply::ok(json.into_bytes())
            } else if req.path == format!("{BASE_PATH}/releases/download/v{v}/Snappy_{v}_x64-setup.exe") {
                Reply::ok(s.installer.clone())
            } else {
                Reply::status(404)
            }
        });
        let rig = Rig {
            dir: scratch_dir("rig"),
            server,
            serve,
            clock: Arc::new(AtomicU64::new(START)),
            launcher: Arc::new(FakeLauncher::default()),
            probe: Arc::new(SharedProbe(Mutex::new(Fake::installed()))),
            busy: Arc::new(AtomicBool::new(false)),
            up: Updater::new(
                Config {
                    endpoint: Endpoint::loopback("http://127.0.0.1:1"),
                    policy: Policy::Loopback,
                    keys: None,
                    running: Version::running("0.0.0").unwrap(),
                    running_text: String::new(),
                    paths: Paths::new(PathBuf::new()),
                },
                dummy_deps(),
            ),
        };
        Rig { up: rig.make(running), ..rig }
    }

    /// A fresh updater over the same folder and server, as after a restart of the program.
    fn make(&self, running: &str) -> Updater {
        let f = fixtures();
        let keys = Keys::from_texts(&[f["keys"]["x"].as_str().unwrap(), f["keys"]["z"].as_str().unwrap()]).unwrap();
        let (clock, busy) = (self.clock.clone(), self.busy.clone());
        Updater::new(
            Config {
                endpoint: Endpoint::loopback(&self.server.url(BASE_PATH)),
                policy: Policy::Loopback,
                keys: Some(keys),
                running: Version::running(running).unwrap(),
                running_text: running.to_string(),
                paths: Paths::new(self.dir.join("updates")),
            },
            Deps {
                transport: Arc::new(WinHttp),
                probe: self.probe.clone(),
                launcher: self.launcher.clone(),
                clock: Arc::new(move || clock.load(Ordering::SeqCst)),
                busy: Arc::new(move || busy.load(Ordering::SeqCst)),
            },
        )
    }

    fn serve(&self, change: impl FnOnce(&mut Serve)) {
        change(&mut self.serve.lock().unwrap());
    }

    fn advance(&self, secs: u64) {
        self.clock.fetch_add(secs, Ordering::SeqCst);
    }

    fn count(&self, needle: &str) -> usize {
        self.server.requests().iter().filter(|r| r.path.contains(needle)).count()
    }

    fn manifests(&self) -> usize {
        self.count("latest.json")
    }

    fn installers(&self) -> usize {
        self.count("setup.exe")
    }

    fn paths(&self) -> Paths {
        Paths::new(self.dir.join("updates"))
    }

    fn staged_path(&self) -> PathBuf {
        self.paths().staged_file(&Version::parse("0.2.0").unwrap())
    }

    /// Notice shown, check run, update staged.
    fn staged(running: &str) -> Rig {
        let rig = Rig::new(running);
        rig.up.startup();
        rig.up.set_auto(true);
        rig.up.run_check(false);
        assert_eq!(rig.up.status().state, "staged", "{:?}", rig.up.status());
        rig
    }
}

struct Never;

impl Transport for Never {
    fn get(&self, _: &transport::Target, _: &FetchOptions, _: transport::Sink<'_>) -> Result<transport::Hop, NetError> {
        Err(NetError::Offline)
    }
}

/// Placeholder dependencies for building a `Rig` before its real updater exists.
fn dummy_deps() -> Deps {
    Deps {
        transport: Arc::new(Never),
        probe: Arc::new(SharedProbe(Mutex::new(Fake::installed()))),
        launcher: Arc::new(FakeLauncher::default()),
        clock: Arc::new(|| START),
        busy: Arc::new(|| false),
    }
}

#[test]
fn nothing_is_sent_before_the_first_run_notice_was_shown() {
    let rig = Rig::new("0.1.5");
    rig.up.startup();
    assert!(rig.up.status().notice_pending);
    assert!(!rig.up.automatic_check_allowed());
    rig.up.run_check(false);
    rig.up.schedule();
    assert_eq!(rig.server.requests().len(), 0, "no request before the notice");
    rig.up.set_auto(true); // the page reports the notice with the current value
    assert!(!rig.up.status().notice_pending);
    rig.up.run_check(false);
    assert_eq!(rig.manifests(), 1);
}

#[test]
fn check_now_works_before_the_notice() {
    let rig = Rig::new("0.1.5");
    rig.up.run_check(true);
    assert_eq!(rig.manifests(), 1);
    assert_eq!(rig.up.status().state, "staged");
}

#[test]
fn switching_the_check_off_sends_nothing_and_deletes_the_staged_installer() {
    let rig = Rig::staged("0.1.5");
    assert!(rig.staged_path().is_file());
    rig.up.set_auto(false);
    assert!(!rig.staged_path().exists());
    assert!(!rig.paths().sig_file(&Version::parse("0.2.0").unwrap()).exists());
    let s = rig.up.status();
    assert_eq!((s.state, s.auto, s.version), ("idle", false, None));
    let before = rig.server.requests().len();
    rig.advance(10_000);
    rig.up.run_check(false);
    rig.up.schedule(); // no thread, no connection
    std::thread::sleep(std::time::Duration::from_millis(150));
    assert_eq!(rig.server.requests().len(), before, "toggle off means zero requests");
    // the choice survives a restart
    assert!(!rig.make("0.1.5").status().auto);
}

#[test]
fn an_update_is_downloaded_verified_and_staged() {
    let rig = Rig::staged("0.1.5");
    let s = rig.up.status();
    assert_eq!((s.version.as_deref(), s.percent, s.error, s.supported, s.link_enabled), (Some("0.2.0"), 100, None, true, false));
    assert_eq!(s.last_checked_unix, START);
    assert_eq!(std::fs::read(rig.staged_path()).unwrap(), installer_bytes());
    assert!(!rig.paths().part_file(&Version::parse("0.2.0").unwrap()).exists());
    assert_eq!((rig.manifests(), rig.installers()), (1, 1));
    // the only header the program set is the agent
    let seen = rig.server.requests();
    for r in &seen {
        assert_eq!(header(r, "user-agent"), "Snappy-Updater");
        assert!(!r.path.contains('?'));
    }
}

#[test]
fn a_beta_updates_to_the_release_of_the_same_number() {
    let rig = Rig::new("0.2.0-beta.1");
    rig.up.set_auto(true);
    rig.up.run_check(false);
    assert_eq!(rig.up.status().state, "staged");
    assert_eq!(rig.up.status().current, "0.2.0-beta.1");
}

#[test]
fn up_to_date_downgrade_and_same_version_download_nothing() {
    for running in ["0.2.0", "0.3.0", "1.0.0"] {
        let rig = Rig::new(running);
        rig.up.set_auto(true);
        rig.up.run_check(false);
        let s = rig.up.status();
        assert_eq!((s.state, s.version, s.error), ("idle", None, None), "{running}");
        assert_eq!(rig.installers(), 0, "{running}");
        assert_eq!(s.last_checked_unix, START);
    }
}

#[test]
fn a_tampered_installer_is_refused_deleted_and_not_fetched_again_for_a_day() {
    let rig = Rig::new("0.1.5");
    rig.serve(|s| s.installer[3] ^= 1);
    rig.up.set_auto(true);
    rig.up.run_check(false);
    let s = rig.up.status();
    assert_eq!((s.state, s.error, s.version.as_deref()), ("failed", Some("signature"), Some("0.2.0")));
    assert!(!rig.staged_path().exists());
    assert!(!rig.paths().part_file(&Version::parse("0.2.0").unwrap()).exists());
    assert_eq!(rig.installers(), 1);
    // an hour later the automatic check asks again but does not download the same bad file
    rig.advance(3_700);
    rig.up.run_check(false);
    assert_eq!((rig.manifests(), rig.installers()), (2, 1));
    assert_eq!(rig.up.status().state, "idle");
    // Update now (a manual check) may try again
    rig.advance(100);
    rig.up.run_check(true);
    assert_eq!(rig.installers(), 2);
    // a day after the first rejection the automatic check tries again by itself
    rig.advance(86_400);
    rig.up.run_check(false);
    assert_eq!(rig.installers(), 3);
}

#[test]
fn two_failed_verifications_enable_the_quiet_link() {
    let rig = Rig::new("0.1.5");
    rig.serve(|s| s.installer[0] ^= 1);
    rig.up.set_auto(true);
    rig.up.run_check(false);
    assert!(!rig.up.status().link_enabled);
    rig.advance(100);
    rig.up.run_check(true);
    assert!(rig.up.status().link_enabled);
    assert!(rig.up.open_releases());
    assert_eq!(*rig.launcher.opened.lock().unwrap(), vec![format!("http://127.0.0.1:{}{BASE_PATH}/releases/latest", rig.server.url("").rsplit(':').next().unwrap())]);
}

#[test]
fn the_page_cannot_open_the_link_before_it_is_enabled() {
    let rig = Rig::new("0.1.5");
    assert!(!rig.up.open_releases());
    assert!(rig.launcher.opened.lock().unwrap().is_empty());
}

#[test]
fn a_wrong_key_a_wrong_name_and_a_wrong_version_in_the_signature_are_refused() {
    for (case, downloads) in [("signedByOtherKey", 1), ("wrongFile", 0), ("wrongVersion", 0), ("extraField", 0), ("legacy", 1), ("tamperedAfterSigning", 1)] {
        let rig = Rig::new("0.1.5");
        rig.serve(|s| s.signature = text(&["signatures", case]));
        rig.up.set_auto(true);
        rig.up.run_check(false);
        let s = rig.up.status();
        assert_eq!((s.state, s.error), ("failed", Some("signature")), "{case}");
        assert_eq!(rig.installers(), downloads, "{case}: a bad comment is caught before the download");
        assert!(!rig.staged_path().exists(), "{case}");
    }
}

#[test]
fn a_stripped_signature_a_wrong_address_and_a_missing_file_are_refused() {
    let rig = Rig::new("0.1.5");
    rig.serve(|s| s.signature = String::new());
    rig.up.set_auto(true);
    rig.up.run_check(false);
    assert_eq!((rig.up.status().state, rig.up.status().error), ("idle", Some("manifest")));
    assert_eq!(rig.installers(), 0);
    rig.advance(4_000);
    rig.serve(|s| {
        s.signature = text(&["signatures", "good"]);
        s.wrong_url = true;
    });
    rig.up.run_check(false);
    assert_eq!(rig.up.status().error, Some("manifest"));
    assert_eq!(rig.installers(), 0);
}

#[test]
fn network_trouble_is_silent_and_a_missing_manifest_is_no_information() {
    for status in [404u16, 500, 503, 401, 407] {
        let rig = Rig::new("0.1.5");
        rig.serve(|s| s.manifest_status = status);
        rig.up.set_auto(true);
        rig.up.run_check(false);
        let s = rig.up.status();
        assert_eq!((s.state, s.error, s.version, s.link_enabled), ("idle", Some("status"), None, false), "{status}");
        assert_eq!(rig.installers(), 0);
    }
}

#[test]
fn three_launches_in_a_row_that_break_the_address_rules_enable_the_link_and_a_plain_error_resets_the_count() {
    let rig = Rig::new("0.1.5");
    rig.serve(|s| s.manifest_redirect = Some("http://localhost:1/x".into()));
    rig.up.set_auto(true);
    for n in 1..=3 {
        rig.up.run_check(false);
        assert_eq!(rig.up.status().error, Some("policy"));
        assert_eq!(rig.up.status().link_enabled, n == 3, "after {n}");
        rig.advance(3_700);
    }
    assert_eq!(rig.count("/x"), 0, "the foreign address was never requested");
    let other = Rig::new("0.1.5");
    other.up.set_auto(true);
    for n in 0..6 {
        let redirect = n % 3 != 2;
        other.serve(|s| {
            s.manifest_redirect = redirect.then(|| "http://localhost:1/x".to_string());
            s.manifest_status = if redirect { 200 } else { 500 };
        });
        other.up.run_check(false);
        other.advance(3_700);
    }
    assert!(!other.up.status().link_enabled, "two rejections, then a plain error, never reach three in a row");
}

#[test]
fn automatic_checks_are_at_most_hourly_and_check_now_at_most_every_minute() {
    let rig = Rig::new("0.2.0");
    rig.up.set_auto(true);
    rig.up.run_check(false);
    rig.advance(3_599);
    rig.up.run_check(false);
    assert_eq!(rig.manifests(), 1);
    rig.advance(1);
    rig.up.run_check(false);
    assert_eq!(rig.manifests(), 2);
    rig.up.run_check(true);
    rig.advance(59);
    rig.up.run_check(true);
    assert_eq!(rig.manifests(), 3);
    rig.advance(1);
    rig.up.run_check(true);
    assert_eq!(rig.manifests(), 4);
}

#[test]
fn a_clock_set_back_does_not_block_checks() {
    let rig = Rig::new("0.2.0");
    rig.up.set_auto(true);
    rig.up.run_check(false);
    rig.clock.store(START - 1_000_000, Ordering::SeqCst);
    rig.up.run_check(false);
    assert_eq!(rig.manifests(), 2);
}

#[test]
fn a_copy_that_cannot_update_itself_learns_of_the_version_and_stages_nothing() {
    let rig = Rig::new("0.1.5");
    rig.probe.0.lock().unwrap().elevated = Some(true);
    let up = rig.make("0.1.5");
    up.set_auto(true);
    up.run_check(false);
    let s = up.status();
    assert_eq!((s.supported, s.state, s.version.as_deref(), s.error, s.link_enabled), (false, "idle", Some("0.2.0"), Some("unsupported"), true));
    assert_eq!(rig.installers(), 0);
    assert_eq!(up.install(true), Err(InstallError::Unsupported));
    assert!(up.open_releases());
}

#[test]
fn a_build_without_real_keys_downloads_and_installs_nothing() {
    let rig = Rig::new("0.1.5");
    let cfg = Config {
        endpoint: Endpoint::loopback(&rig.server.url(BASE_PATH)),
        policy: Policy::Loopback,
        keys: None, // what a build gets from placeholder keys (see keys.rs)
        running: Version::running("0.1.5").unwrap(),
        running_text: "0.1.5".into(),
        paths: rig.paths(),
    };
    let up = Updater::new(cfg, Deps { transport: Arc::new(WinHttp), probe: rig.probe.clone(), launcher: rig.launcher.clone(), clock: Arc::new(|| START), busy: Arc::new(|| false) });
    up.set_auto(true);
    up.run_check(false);
    assert_eq!(up.status().error, Some("keys"));
    assert_eq!(rig.installers(), 0);
}

#[test]
fn install_refuses_unless_everything_is_quiet() {
    let rig = Rig::staged("0.1.5");
    assert_eq!(rig.up.install(false), Err(InstallError::Busy), "the page is not idle");
    rig.busy.store(true, Ordering::SeqCst);
    assert_eq!(rig.up.install(true), Err(InstallError::Busy), "a picked file is open or was just read");
    rig.busy.store(false, Ordering::SeqCst);
    rig.probe.0.lock().unwrap().others = Some(1);
    assert_eq!(rig.up.install(true), Err(InstallError::Busy), "another Snappy process exists");
    rig.probe.0.lock().unwrap().others = None;
    assert_eq!(rig.up.install(true), Err(InstallError::Busy), "unknown counts as not alone");
    assert!(rig.launcher.started.lock().unwrap().is_empty());
    rig.probe.0.lock().unwrap().others = Some(0);
    assert_eq!(rig.up.install(true), Ok(()));
    assert_eq!(*rig.launcher.started.lock().unwrap(), vec![rig.staged_path()]);
    assert_eq!(rig.up.status().state, "installing");
}

#[test]
fn install_with_nothing_staged_is_refused() {
    let rig = Rig::new("0.1.5");
    assert_eq!(rig.up.install(true), Err(InstallError::NotStaged));
}

#[test]
fn the_staged_file_is_checked_again_just_before_it_runs() {
    let rig = Rig::staged("0.1.5");
    let mut bytes = std::fs::read(rig.staged_path()).unwrap();
    bytes[10] ^= 1; // another program changed it after it was verified
    std::fs::write(rig.staged_path(), bytes).unwrap();
    assert_eq!(rig.up.install(true), Err(InstallError::Failed));
    assert!(rig.launcher.started.lock().unwrap().is_empty(), "a changed file is never started");
    assert!(!rig.staged_path().exists(), "and it is deleted");
    let s = rig.up.status();
    assert_eq!((s.state, s.error), ("failed", Some("install")));
}

#[test]
fn a_failed_start_is_a_failed_install_and_two_enable_the_link() {
    let rig = Rig::staged("0.1.5");
    rig.launcher.spawn_fails.store(true, Ordering::SeqCst);
    assert_eq!(rig.up.install(true), Err(InstallError::Failed));
    assert_eq!(rig.up.status().state, "failed");
    assert!(!rig.up.status().link_enabled);
    assert_eq!(rig.up.install(true), Err(InstallError::Failed));
    assert!(rig.up.status().link_enabled, "after two failures of the same version");
    assert!(rig.staged_path().is_file(), "a failed start keeps the verified file for another try");
}

#[test]
fn a_staged_update_is_applied_before_the_window_opens() {
    let rig = Rig::staged("0.1.5");
    assert!(rig.up.apply_at_launch());
    assert_eq!(rig.launcher.started.lock().unwrap().len(), 1);
    // the next launch is on the new version: success, shown once, and the installer is cleaned up
    let after = rig.make("0.2.0");
    after.startup();
    let s = after.status();
    assert_eq!((s.updated_to.as_deref(), s.state, s.error, s.link_enabled), (Some("0.2.0"), "idle", None, false));
    assert_eq!(after.status().updated_to, None, "the message is shown once");
    assert!(!rig.staged_path().exists());
    assert!(!after.apply_at_launch());
}

#[test]
fn launch_time_apply_needs_the_setting_the_notice_and_a_fresh_file() {
    let off = Rig::staged("0.1.5");
    off.up.set_auto(false);
    assert!(!off.make("0.1.5").apply_at_launch());

    let stale = Rig::staged("0.1.5");
    stale.advance(48 * 3600);
    assert!(!stale.up.apply_at_launch());
    assert!(!stale.staged_path().exists(), "a file older than 48 hours is deleted, not run");
    assert!(stale.launcher.started.lock().unwrap().is_empty());

    let fresh = Rig::staged("0.1.5");
    fresh.advance(48 * 3600 - 1);
    assert!(fresh.up.apply_at_launch());

    let busy = Rig::staged("0.1.5");
    busy.probe.0.lock().unwrap().others = Some(1);
    assert!(!busy.up.apply_at_launch());
    let unsupported = Rig::staged("0.1.5");
    unsupported.probe.0.lock().unwrap().elevated = Some(true);
    assert!(!unsupported.make("0.1.5").apply_at_launch());
}

#[test]
fn an_installer_that_never_lands_cannot_loop_the_launch() {
    let rig = Rig::staged("0.1.5");
    assert!(rig.up.apply_at_launch(), "first attempt");
    let again = rig.make("0.1.5"); // launched, but the program is still 0.1.5
    again.startup();
    assert_eq!(again.status().error, Some("install"));
    assert!(again.apply_at_launch(), "second attempt");
    let third = rig.make("0.1.5");
    third.startup();
    assert!(!third.apply_at_launch(), "two attempts for this version: the launch-time apply is off");
    assert_eq!(rig.launcher.started.lock().unwrap().len(), 2);
    let s = third.status();
    assert_eq!((s.state, s.link_enabled), ("failed", true));
    // Update now still works by hand
    assert_eq!(third.install(true), Ok(()));
}

#[test]
fn a_withdrawn_release_removes_the_staged_file() {
    let rig = Rig::staged("0.1.5");
    rig.serve(|s| s.version = "0.1.5".into()); // latest is no longer newer than what runs
    rig.advance(3_700);
    rig.up.run_check(false);
    assert!(!rig.staged_path().exists());
    assert_eq!(rig.up.status().state, "idle");
    assert!(!rig.make("0.1.5").apply_at_launch());
}

#[test]
fn an_older_staged_file_is_removed_when_the_manifest_names_another_version() {
    let rig = Rig::staged("0.1.5");
    rig.serve(|s| s.version = "0.3.0".into());
    rig.advance(3_700);
    rig.up.run_check(false);
    assert!(!rig.staged_path().exists(), "the manifest no longer names the staged version");
}

#[test]
fn a_stale_staged_file_is_downloaded_again_by_the_next_check() {
    let rig = Rig::staged("0.1.5");
    rig.advance(48 * 3600 + 5);
    rig.up.run_check(false);
    assert_eq!(rig.installers(), 2);
    assert_eq!(rig.up.status().state, "staged");
}

#[test]
fn staged_files_that_are_already_installed_or_older_are_cleaned_at_startup() {
    let rig = Rig::staged("0.1.5");
    let up = rig.make("0.2.0"); // the version that was staged is now the running one
    up.startup();
    assert!(!rig.staged_path().exists());
    assert_eq!(up.status().state, "idle");
}

#[test]
fn only_one_updater_runs_at_a_time() {
    let rig = Rig::new("0.1.5");
    rig.up.set_auto(true);
    std::fs::create_dir_all(rig.paths().root()).unwrap();
    let _held = open_exclusive(&rig.paths().lock_file()).unwrap(); // another Snappy process holds the lock
    let other = rig.make("0.1.5");
    other.run_check(true);
    assert_eq!(rig.server.requests().len(), 0);
    assert_eq!(other.status().error, Some("busy"));
}

#[test]
fn another_snappy_process_stops_the_check_too() {
    let rig = Rig::new("0.1.5");
    rig.up.set_auto(true);
    rig.probe.0.lock().unwrap().others = Some(1);
    rig.up.run_check(false);
    assert_eq!(rig.server.requests().len(), 0);
}

#[test]
fn the_status_has_only_the_agreed_fields_and_only_validated_text() {
    let rig = Rig::staged("0.1.5");
    let value = serde_json::to_value(rig.up.status()).unwrap();
    let mut keys: Vec<&str> = value.as_object().unwrap().keys().map(String::as_str).collect();
    keys.sort_unstable();
    assert_eq!(keys, ["auto", "current", "error", "last_checked_unix", "link_enabled", "notice_pending", "percent", "state", "supported", "updated_to", "version"]);
    assert_eq!(value["version"], "0.2.0");
    assert_eq!(value["state"], "staged");
}

#[test]
fn a_corrupt_settings_file_resets_to_the_safe_defaults() {
    let rig = Rig::new("0.1.5");
    std::fs::create_dir_all(rig.paths().root()).unwrap();
    std::fs::write(rig.paths().state_file(), b"{ not json").unwrap();
    let up = rig.make("0.1.5");
    up.startup();
    let s = up.status();
    assert!(s.auto && s.notice_pending, "defaults: on, and the notice is shown again before any check");
    up.run_check(false);
    assert_eq!(rig.server.requests().len(), 0);
}
