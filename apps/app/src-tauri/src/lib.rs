//! Snappy desktop shell. It hosts the dashboard (one built HTML file) in the system WebView and
//! does five things:
//!
//! 1. The main window can only ever show the app's own bundled page. Every other address (a link,
//!    `window.open`, a redirect, a form post, a script setting `location`) is refused before any
//!    request is made (`allow_navigation` and `on_new_window` below).
//! 2. The optional native reader: three commands that let the page pick export zips in a native
//!    dialog that Rust shows itself and read them back, read-only, by opaque id (`readonly.rs`).
//!    There is no file-system plugin and no command that writes, truncates or takes a path.
//! 3. On Windows the system web engine (WebView2) is started with browser switches that turn off
//!    its background services (in `tauri.conf.json`), and its SmartScreen and autofill settings
//!    are turned off on the live controller.
//! 4. In release builds the environment variables that reconfigure WebView2 (a debugging port, a
//!    different profile folder or runtime) are removed before the engine starts.
//! 5. On Windows, an update check (`updater`): a few seconds after the window opens the program asks
//!    github.com for the newest version, and applies a signed update. It is the only network use of
//!    this program, it is made here and never by the page (whose policy still forbids every
//!    connection), and the person can switch it off. The page reaches it through five commands.
//!
//! Apart from the update check, nothing here opens a network connection.

mod readonly;
pub mod updater;

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use readonly::{Picked, PickedFile};
use tauri::ipc::Response;
use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Manager, State, Url, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

type PickedState = Mutex<Picked>;

/// The updater of this run, if this program has one (Windows only).
struct UpdaterState(Option<updater::Updater>);

/// When a picked file was last read. A restart for an update waits while a read was this recent.
#[derive(Default)]
struct ReadClock(Mutex<Option<Instant>>);

const RECENT_READ: Duration = Duration::from_secs(10);

fn lock(state: &PickedState) -> Result<std::sync::MutexGuard<'_, Picked>, String> {
    state.lock().map_err(|_| "internal state is unavailable".to_string())
}

/// Shows the native "open" dialog (from Rust, so the page never supplies a path) and opens each
/// chosen zip read-only. Returns an id, a name and a size per file; an empty list means cancelled.
#[tauri::command]
async fn pick_zips(app: AppHandle, window: WebviewWindow, state: State<'_, PickedState>) -> Result<Vec<PickedFile>, String> {
    let chosen = app
        .dialog()
        .file()
        .set_title("Choose your Snapchat export")
        .add_filter("Snapchat export (.zip)", &["zip"])
        .set_parent(&window)
        .blocking_pick_files();
    let Some(chosen) = chosen else { return Ok(Vec::new()) };
    let mut table = lock(&state)?;
    // A new pick replaces the previous run's files: earlier ids stop working.
    table.close_all();
    let mut out = Vec::with_capacity(chosen.len());
    for file in chosen {
        let path = file.into_path().map_err(|e| format!("could not use that file: {e}"))?;
        out.push(table.register(&path)?);
    }
    Ok(out)
}

/// Reads `length` bytes at `offset` of a picked file, read-only.
#[tauri::command]
fn read_range(state: State<'_, PickedState>, clock: State<'_, ReadClock>, id: String, offset: u64, length: u64) -> Result<Response, String> {
    let (file, size) = lock(&state)?.lookup(&id)?;
    if let Ok(mut last) = clock.0.lock() {
        *last = Some(Instant::now());
    }
    readonly::read_range(&file, size, offset, length).map(Response::new)
}

/// Lets go of a picked file (the page calls this when an import ends).
#[tauri::command]
fn close_file(state: State<'_, PickedState>, id: String) -> Result<(), String> {
    lock(&state)?.close(&id);
    Ok(())
}

/// What the page may know about updates (see `updater`): enums, numbers and validated version text.
#[tauri::command]
fn update_status(state: State<'_, UpdaterState>) -> updater::Status {
    state.0.as_ref().map_or_else(updater::Status::inert, |u| u.status())
}

/// "Check now" (and "Update now" after a failure): checks, and downloads and stages what it finds.
/// Takes no arguments. The answer comes through `update_status`.
#[tauri::command]
fn update_check(state: State<'_, UpdaterState>) {
    if let Some(u) = &state.0 {
        u.start_check(true);
    }
}

/// Installs the staged update and restarts. `idle` is the page's claim that nothing is in progress;
/// the program also refuses while a picked file is in use or another copy runs. Takes no version
/// and no path: it only ever starts the file that was downloaded and verified.
#[tauri::command]
fn update_install(app: AppHandle, state: State<'_, UpdaterState>, idle: bool) -> Result<(), &'static str> {
    let Some(u) = &state.0 else { return Err("unsupported") };
    match u.install(idle) {
        Ok(()) => {
            app.exit(0); // runs Tauri's own cleanup; the installer was started detached
            Ok(())
        }
        Err(updater::InstallError::Busy) => Err("busy"),
        Err(updater::InstallError::NotStaged) => Err("not_staged"),
        Err(updater::InstallError::Unsupported) => Err("unsupported"),
        Err(updater::InstallError::Failed) => Err("failed"),
    }
}

/// The setting "Check for updates on launch". The page also calls this with the current value when
/// it shows the first-run notice, which is how the program learns the notice was seen.
#[tauri::command]
fn update_set_auto(state: State<'_, UpdaterState>, auto: bool) {
    if let Some(u) = &state.0 {
        u.set_auto(auto);
    }
}

/// Opens the one fixed releases page in the browser. Does nothing until repeated failures (or a
/// copy that cannot update itself) have enabled the link. Takes no address.
#[tauri::command]
fn update_open_releases(state: State<'_, UpdaterState>) {
    if let Some(u) = &state.0 {
        u.open_releases();
    }
}

/// True only for the app's own bundled page. Windows and Android serve it from
/// `http://tauri.localhost` (or `https://` with the HTTPS-scheme option); macOS, Linux and iOS from
/// `tauri://localhost`. A `blob:` address is allowed only when it was made by that same page (the
/// worker and the export downloads use them). Nothing else is allowed: not `about:`, `data:`,
/// `file:`, any other port or user info, and no remote address.
pub fn allow_navigation(url: &Url) -> bool {
    let plain = url.port().is_none() && url.username().is_empty() && url.password().is_none();
    match url.scheme() {
        "tauri" => plain && url.host_str() == Some("localhost"),
        "http" | "https" => plain && url.host_str() == Some("tauri.localhost"),
        "blob" => Url::parse(url.path()).map(|inner| inner.scheme() != "blob" && allow_navigation(&inner)).unwrap_or(false),
        _ => false,
    }
}

/// macOS only: lets the page's own "Save" buttons save a file. A Save button makes a `blob:` link with a
/// `download` name and clicks it. WebView2 handles that itself. On macOS wry answers such a click with a
/// cancel when no download handler is registered, so every Save would do nothing at all. With this handler
/// wry has WebKit put the file in the person's Downloads folder, under the suggested name (a number is added
/// when the name is taken), the way a browser does. Only a `blob:` link made by the app's own page is let
/// through (`allow_navigation`); any other address stays refused. The page gets no path, no dialog and no
/// access to the file system from this: WebKit writes the one file it was asked to save.
#[cfg(target_os = "macos")]
fn allow_download(_webview: tauri::Webview, event: tauri::webview::DownloadEvent<'_>) -> bool {
    match event {
        tauri::webview::DownloadEvent::Requested { url, .. } => url.scheme() == "blob" && allow_navigation(&url),
        _ => true,
    }
}

/// Removes the variables that make WebView2 behave differently from what this build configured:
/// `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` (can open an unauthenticated debugging port),
/// `WEBVIEW2_USER_DATA_FOLDER`, `WEBVIEW2_BROWSER_EXECUTABLE_FOLDER` (loads another runtime),
/// `WEBVIEW2_RELEASE_CHANNEL_PREFERENCE`, `WEBVIEW2_CHANNEL_SEARCH_KIND`, and any other
/// `WEBVIEW2_*`. Kept in debug builds and in test builds made with `--features dev-hooks`.
#[cfg(not(any(debug_assertions, feature = "dev-hooks")))]
fn scrub_webview_environment() {
    let names: Vec<std::ffi::OsString> = std::env::vars_os()
        .map(|(k, _)| k)
        .filter(|k| k.to_string_lossy().to_ascii_uppercase().starts_with("WEBVIEW2_"))
        .collect();
    for name in names {
        std::env::remove_var(name);
    }
}

#[cfg(any(debug_assertions, feature = "dev-hooks"))]
fn scrub_webview_environment() {}

/// True for a request the web engine may make. The app's own page, plus the two address kinds that
/// never touch a network: `data:` (the dashboard's inline fonts and images) and `blob:` made by the
/// page itself. Tauri's own in-process IPC host is allowed so the shell keeps working; the page's
/// content policy still decides whether a page may call it. Everything else (any http or https
/// address, `ws:`, `ftp:`, `file:`) is answered by the shell itself and never leaves the process.
pub fn allow_request(url: &Url) -> bool {
    match url.scheme() {
        "data" | "about" => true,
        "http" | "https" => allow_navigation(url) || (url.host_str() == Some("ipc.localhost") && url.port().is_none()),
        "tauri" | "blob" => allow_navigation(url),
        _ => false,
    }
}

/// Turns off, on the live WebView2 controller, what the page does not need: SmartScreen reputation
/// checks, form autofill and password saving (autofill would keep typed text in the profile
/// folder). It also answers, inside the process, every request to an address the app does not own.
///
/// Why the second part exists: `on_navigation` alone is not enough on WebView2. RAN: with only that
/// handler, `location.href = "http://127.0.0.1:PORT/x"` was cancelled on screen, but the engine
/// had already sent the request and the server answered 200 before the cancel. Intercepting the
/// request itself (`WebResourceRequested`, filter `*`, every request source) is what keeps the
/// request from being sent.
#[cfg(windows)]
fn harden_webview2(window: &WebviewWindow) {
    use webview2_com::take_pwstr;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Settings4, ICoreWebView2Settings8, ICoreWebView2_22, COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
        COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL,
    };
    use webview2_com::WebResourceRequestedEventHandler;
    use windows_core::{Interface, HSTRING, PWSTR};
    let _ = window.with_webview(|webview| unsafe {
        let Ok(core) = webview.controller().CoreWebView2() else { return };
        if let Ok(settings) = core.Settings() {
            if let Ok(s) = settings.cast::<ICoreWebView2Settings8>() {
                let _ = s.SetIsReputationCheckingRequired(false);
            }
            if let Ok(s) = settings.cast::<ICoreWebView2Settings4>() {
                let _ = s.SetIsGeneralAutofillEnabled(false);
                let _ = s.SetIsPasswordAutosaveEnabled(false);
            }
        }

        let env = webview.environment();
        let handler = WebResourceRequestedEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else { return Ok(()) };
            let request = args.Request()?;
            let mut uri = PWSTR::null();
            request.Uri(&mut uri)?;
            let uri = take_pwstr(uri);
            let allowed = Url::parse(&uri).map(|u| allow_request(&u)).unwrap_or(false);
            if !allowed {
                let reason = HSTRING::from("Blocked");
                let response = env.CreateWebResourceResponse(None, 403, &reason, &HSTRING::new())?;
                args.SetResponse(&response)?;
            }
            Ok(())
        }));
        let filter = HSTRING::from("*");
        let added = match core.cast::<ICoreWebView2_22>() {
            Ok(core22) => core22.AddWebResourceRequestedFilterWithRequestSourceKinds(
                &filter,
                COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
                COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL,
            ),
            Err(_) => core.AddWebResourceRequestedFilter(&filter, COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL),
        };
        if added.is_ok() {
            let mut token = 0i64;
            let _ = core.add_WebResourceRequested(&handler, &mut token);
        }
    });
}

#[cfg(not(windows))]
fn harden_webview2(_window: &WebviewWindow) {}

/// The updater, wired to this app's data folder, its installer record and the picked-file table.
fn build_updater(app: &tauri::App) -> Option<updater::Updater> {
    let handle = app.handle().clone();
    let busy = Arc::new(move || {
        let open = handle.state::<PickedState>().lock().map_or(true, |t| !t.is_empty());
        let recent = handle.state::<ReadClock>().0.lock().map_or(true, |t| t.is_some_and(|at| at.elapsed() < RECENT_READ));
        open || recent
    });
    let config = app.config();
    let data = app.path().app_local_data_dir().ok()?;
    let product = config.product_name.clone().unwrap_or_else(|| "Snappy".into());
    updater::for_app(&data, &product, INSTALLER_PUBLISHER, busy)
}

/// The publisher the installer records its folder under (`HKCU\Software\<publisher>\<product name>`), which the
/// updater reads to know it runs from the per-user install. It is written out here and not read from the config,
/// because Tauri leaves `bundle.publisher` out of the config it embeds in the program: reading it gave an empty
/// name, the record was never found, and every installed copy said it could not update itself. A test compares
/// this with `bundle.publisher` in tauri.conf.json, which the installer uses.
const INSTALLER_PUBLISHER: &str = "Snappy contributors";

/// Builds the main window with the handlers that keep it on the app's own page (see the top of this file).
fn main_window(app: &tauri::App, config: &tauri::utils::config::WindowConfig) -> tauri::Result<WebviewWindow> {
    #[allow(unused_mut)]
    let mut builder = WebviewWindowBuilder::from_config(app.handle(), config)?
        .on_navigation(allow_navigation)
        .on_new_window(|_url, _features| NewWindowResponse::Deny);
    #[cfg(target_os = "macos")]
    {
        builder = builder.on_download(allow_download);
    }
    // Test builds only: lets the network experiments try other browser switches without a rebuild.
    #[cfg(all(windows, feature = "dev-hooks"))]
    if let Ok(args) = std::env::var("SNAPPY_WEBVIEW_ARGS") {
        builder = builder.additional_browser_args(&args);
    }
    builder.build()
}

/// Window creation is tried this many times, this long apart (about six seconds in all).
const WINDOW_ATTEMPTS: u32 = 24;
const WINDOW_RETRY_DELAY: Duration = Duration::from_millis(250);

/// True when WebView2 refused with "The requested resource is in use" (ERROR_BUSY, 0x800700AA). That is what it says in the
/// first seconds after a copy that was ended by force (a crash, End task, an installer or a test harness that killed it)
/// when this copy starts, because the dead copy's browser process still holds the profile folder. It passes by itself.
/// RAN: relaunching at once after a force kill ended in this error in 7 of 10 launches; every one was an abort (0xc0000409).
fn profile_busy(error: &tauri::Error) -> bool {
    error.to_string().to_ascii_uppercase().contains("0X800700AA")
}

/// True when the web engine is not installed at all. Tauri has already told the person so in a message (release builds).
fn engine_missing(error: &tauri::Error) -> bool {
    format!("{error:?}").contains("WebviewRuntimeNotInstalled")
}

/// Runs `step` until it succeeds, fails in a way `again` rejects, or `attempts` runs have failed, calling `wait` between
/// runs. The last error is returned.
fn retry<T, E>(attempts: u32, mut step: impl FnMut() -> Result<T, E>, again: impl Fn(&E) -> bool, mut wait: impl FnMut()) -> Result<T, E> {
    let mut run = 1;
    loop {
        match step() {
            Ok(value) => return Ok(value),
            Err(error) if run >= attempts || !again(&error) => return Err(error),
            Err(_) => {
                run += 1;
                wait();
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    scrub_webview_environment();
    tauri::Builder::default()
        // The page's policy forbids every connection, so its messages go by postMessage only (see the script).
        .invoke_system(include_str!("ipc_postmessage.js"))
        .plugin(tauri_plugin_dialog::init())
        .manage(PickedState::default())
        .manage(ReadClock::default())
        .invoke_handler(tauri::generate_handler![pick_zips, read_range, close_file, update_status, update_check, update_install, update_set_auto, update_open_releases])
        .setup(|app| {
            // Before any window: settle the last update, and if a verified one is waiting, run it.
            let updater = build_updater(app);
            if let Some(u) = &updater {
                u.startup();
                if u.apply_at_launch() {
                    app.handle().exit(0);
                    return Ok(());
                }
            }
            app.manage(UpdaterState(updater));
            // The window is created here, not from the config alone, so it can carry the handlers.
            let config = app
                .config()
                .app
                .windows
                .iter()
                .find(|w| w.label == "main")
                .ok_or("the main window is missing from tauri.conf.json")?;
            // The engine can refuse for a moment right after a copy that was ended by force (see `profile_busy`). Failing there
            // ended the program with a crash report, so it waits and tries again. Any other failure, or one that lasts, is
            // said in a message and the program ends normally.
            let created = retry(WINDOW_ATTEMPTS, || main_window(app, config), profile_busy, || std::thread::sleep(WINDOW_RETRY_DELAY));
            let window = match created {
                Ok(window) => window,
                Err(error) => {
                    if !engine_missing(&error) {
                        app.dialog()
                            .message("Snappy could not open its window. Close any other Snappy window and start it again.")
                            .title("Snappy")
                            .kind(MessageDialogKind::Error)
                            .blocking_show();
                    }
                    app.handle().exit(1);
                    return Ok(());
                }
            };
            harden_webview2(&window);
            if let Some(u) = &app.state::<UpdaterState>().0 {
                u.schedule(); // a few seconds from now, only if the setting is on; never blocks start-up
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Snappy could not start");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn allowed(s: &str) -> bool {
        allow_navigation(&Url::parse(s).unwrap())
    }

    #[test]
    fn a_window_that_fails_for_a_moment_is_tried_again() {
        let mut calls = 0;
        let mut waits = 0;
        let got = retry(24, || { calls += 1; if calls < 4 { Err("in use") } else { Ok(calls) } }, |_| true, || waits += 1);
        assert_eq!(got, Ok(4));
        assert_eq!(waits, 3);
    }

    #[test]
    fn a_window_that_never_opens_gives_up_with_the_last_error() {
        let mut calls = 0;
        let mut waits = 0;
        let got: Result<(), u32> = retry(5, || { calls += 1; Err(calls) }, |_| true, || waits += 1);
        assert_eq!(got, Err(5));
        assert_eq!((calls, waits), (5, 4)); // no wait after the last run
    }

    #[test]
    fn a_failure_that_will_not_pass_is_not_tried_again() {
        let mut calls = 0;
        let got: Result<(), &str> = retry(24, || { calls += 1; Err("no engine") }, |e| *e == "in use", || panic!("must not wait"));
        assert_eq!(got, Err("no engine"));
        assert_eq!(calls, 1);
    }

    #[test]
    fn a_window_that_opens_at_once_does_not_wait() {
        let mut waits = 0;
        assert_eq!(retry::<_, ()>(24, || Ok(1), |_| true, || waits += 1), Ok(1));
        assert_eq!(waits, 0);
    }

    fn failure(text: &str) -> tauri::Error {
        tauri::Error::Io(std::io::Error::other(text.to_string()))
    }

    #[test]
    fn only_the_profile_in_use_error_is_waited_out() {
        // the text of the real failure, from the crash it caused
        let busy = failure("failed to create webview: WebView2 error: WindowsError(Error { code: HRESULT(0x800700AA), message: \"The requested resource is in use.\" })");
        assert!(profile_busy(&busy));
        // another HRESULT is not
        assert!(!profile_busy(&failure("WebView2 error: WindowsError(Error { code: HRESULT(0x8007139F), message: \"state\" })")));
    }

    #[test]
    fn a_missing_engine_is_told_apart() {
        assert!(engine_missing(&failure("WebviewRuntimeNotInstalled")));
        assert!(!engine_missing(&failure("WebView2 error: in use")));
    }

    #[test]
    fn only_the_apps_own_page_may_load() {
        assert!(allowed("http://tauri.localhost/"));
        assert!(allowed("http://tauri.localhost/index.html"));
        assert!(allowed("https://tauri.localhost/"));
        assert!(allowed("tauri://localhost/"));
        assert!(allowed("tauri://localhost/index.html"));
        assert!(allowed("blob:http://tauri.localhost/6f1c1f0e-5c1b-4d62-9e37-0a6f3a1f2f10"));
        assert!(allowed("blob:tauri://localhost/6f1c1f0e-5c1b-4d62-9e37-0a6f3a1f2f10"));
    }

    #[test]
    fn only_the_apps_own_requests_are_allowed() {
        let req = |s: &str| allow_request(&Url::parse(s).unwrap());
        assert!(req("http://tauri.localhost/index.html"));
        assert!(req("http://ipc.localhost/pick_zips"));
        assert!(req("data:font/woff2;base64,AAAA"));
        assert!(req("blob:http://tauri.localhost/6f1c1f0e-5c1b-4d62-9e37-0a6f3a1f2f10"));
        for u in [
            "http://127.0.0.1:8080/x",
            "http://localhost/x",
            "https://example.com/?data=secret",
            "http://tauri.localhost.evil.test/",
            "http://ipc.localhost:81/",
            "http://ipc.localhost@evil.test/",
            "ws://127.0.0.1:1/",
            "wss://example.com/",
            "ftp://example.com/",
            "file:///C:/Windows/win.ini",
            "blob:https://example.com/abc",
            "chrome://settings/",
            "edge://settings/",
        ] {
            assert!(!req(u), "{u} must not be requested");
        }
    }

    #[test]
    fn everything_else_is_refused() {
        for u in [
            "http://127.0.0.1:8080/",
            "http://localhost/",
            "http://localhost:1420/",
            "https://example.com/",
            "http://tauri.localhost.evil.test/",
            "http://tauri.localhost@evil.test/",
            "http://evil.test@tauri.localhost/x", // user info in front of the right host
            "http://tauri.localhost:8080/",
            "tauri://localhost:9/",
            "tauri://evil/",
            "about:blank",
            "data:text/html,hi",
            "file:///C:/Windows/win.ini",
            "ftp://tauri.localhost/",
            "javascript:alert(1)",
            "ws://tauri.localhost/",
            "blob:https://example.com/abc",
            "blob:null/abc",
            "blob:blob:http://tauri.localhost/abc",
            "ipc://localhost/x",
            "asset://localhost/x",
        ] {
            assert!(!allowed(u), "{u} must be refused");
        }
    }
}

// The build script's release rules (build.rs), tested here.
#[cfg(test)]
#[path = "../build_guards.rs"]
mod build_guards;

// The installer's publisher, written out in this file (see INSTALLER_PUBLISHER), is the one in the config the installer reads.
#[cfg(test)]
mod installer_publisher_tests {
    use super::INSTALLER_PUBLISHER;

    #[test]
    fn is_the_publisher_the_installer_uses() {
        let conf: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).expect("tauri.conf.json is JSON");
        assert_eq!(conf["bundle"]["publisher"].as_str(), Some(INSTALLER_PUBLISHER));
    }
}
