//! Everything the updater asks Windows for besides the network: the facts `install_kind` needs
//! (the installer's registry record, whether the process is elevated, whether another copy runs),
//! and the two things it may start (the installer, and the browser on one fixed page). This is one
//! of two files with `unsafe` (the other is `transport_windows.rs`), and the only file that may start
//! a process or open the browser (a check in `tools/check-no-network-deps.mjs` enforces it).

use std::ffi::OsString;
use std::os::windows::ffi::OsStringExt;
use std::path::PathBuf;
use std::ptr::{null, null_mut};

use windows_sys::Win32::Foundation::{CloseHandle, ERROR_SUCCESS, INVALID_HANDLE_VALUE};
use windows_sys::Win32::Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_SZ};
use windows_sys::Win32::System::Threading::{GetCurrentProcess, GetCurrentProcessId, OpenProcessToken};

use super::install_kind::Probe;

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

/// A string value of the current user's registry (`subkey` under HKEY_CURRENT_USER). An empty
/// `value` name reads the key's default value. `None` when it is missing or not text.
pub fn registry_text(subkey: &str, value: &str) -> Option<String> {
    let (key, name) = (wide(subkey), wide(value));
    let name_ptr = if value.is_empty() { null() } else { name.as_ptr() };
    let mut bytes: u32 = 0;
    // SAFETY: both names are null-terminated and outlive the call; a null data pointer asks for the size.
    let size = unsafe { RegGetValueW(HKEY_CURRENT_USER, key.as_ptr(), name_ptr, RRF_RT_REG_SZ, null_mut(), null_mut(), &mut bytes) };
    if size != ERROR_SUCCESS || bytes == 0 || bytes > 32 * 1024 {
        return None;
    }
    let mut buf = vec![0u16; bytes as usize / 2 + 1];
    let mut len = (buf.len() * 2) as u32;
    // SAFETY: `buf` is valid for writes of `len` bytes for the whole call.
    let read = unsafe { RegGetValueW(HKEY_CURRENT_USER, key.as_ptr(), name_ptr, RRF_RT_REG_SZ, null_mut(), buf.as_mut_ptr().cast(), &mut len) };
    if read != ERROR_SUCCESS {
        return None;
    }
    let units = (len as usize / 2).min(buf.len());
    let text = OsString::from_wide(&buf[..units]).to_string_lossy().trim_end_matches('\0').to_string();
    Some(text)
}

fn process_is_elevated() -> Option<bool> {
    let mut token = null_mut();
    // SAFETY: the pseudo handle of the current process is always valid; `token` receives a real handle.
    if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == 0 {
        return None;
    }
    let mut elevation = TOKEN_ELEVATION { TokenIsElevated: 0 };
    let mut returned = 0u32;
    // SAFETY: `elevation` is a TOKEN_ELEVATION of the size passed; the token is closed right after.
    let ok = unsafe { GetTokenInformation(token, TokenElevation, (&mut elevation as *mut TOKEN_ELEVATION).cast(), std::mem::size_of::<TOKEN_ELEVATION>() as u32, &mut returned) };
    unsafe { CloseHandle(token) };
    (ok != 0).then_some(elevation.TokenIsElevated != 0)
}

/// How many processes other than this one run an image with this file name (case-insensitive).
fn other_processes_named(image: &str) -> Option<u32> {
    // SAFETY: a snapshot of the process list; the handle is closed below.
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot == INVALID_HANDLE_VALUE {
        return None;
    }
    // SAFETY: a zeroed PROCESSENTRY32W with its size field set is the documented way to start.
    let mut entry: PROCESSENTRY32W = unsafe { std::mem::zeroed() };
    entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
    let own = unsafe { GetCurrentProcessId() };
    let mut others = 0u32;
    // SAFETY: `entry` is valid for writes and has its size set; the snapshot handle is live.
    let mut more = unsafe { Process32FirstW(snapshot, &mut entry) } != 0;
    while more {
        let len = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
        let name = OsString::from_wide(&entry.szExeFile[..len]).to_string_lossy().to_string();
        if entry.th32ProcessID != own && name.eq_ignore_ascii_case(image) {
            others += 1;
        }
        // SAFETY: as above.
        more = unsafe { Process32NextW(snapshot, &mut entry) } != 0;
    }
    unsafe { CloseHandle(snapshot) };
    Some(others)
}

/// The real facts, read from Windows. `product_key` is `Software\<publisher>\<product name>`, the key
/// whose default value the per-user installer sets to the install folder.
pub struct SystemProbe {
    pub product_key: String,
}

impl Probe for SystemProbe {
    fn exe_path(&self) -> Option<PathBuf> {
        std::env::current_exe().ok().and_then(|p| std::fs::canonicalize(p).ok())
    }

    fn registered_install_dir(&self) -> Option<PathBuf> {
        let recorded = registry_text(&self.product_key, "")?;
        std::fs::canonicalize(recorded.trim().trim_matches('"')).ok()
    }

    fn local_app_data(&self) -> Option<PathBuf> {
        std::env::var_os("LOCALAPPDATA").and_then(|p| std::fs::canonicalize(p).ok())
    }

    fn is_elevated(&self) -> Option<bool> {
        process_is_elevated()
    }

    fn other_instances(&self) -> Option<u32> {
        let exe = std::env::current_exe().ok()?;
        other_processes_named(exe.file_name()?.to_str()?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// These ask the real Windows of the machine running the tests (no window, no change to anything).
    #[test]
    fn the_real_probe_can_tell_its_own_facts() {
        let probe = SystemProbe { product_key: r"Software\Snappy contributors\Snappy-test-not-installed".into() };
        let exe = probe.exe_path().expect("the test program has a path");
        assert!(exe.is_file());
        assert!(probe.local_app_data().is_some_and(|p| p.is_dir()));
        assert!(probe.is_elevated().is_some(), "the process token can be read");
        assert_eq!(probe.registered_install_dir(), None, "a product that was never installed has no record");
        // Rust's test harness runs one copy of this program, plus possibly the build tool's own check; none of them is "snappy" itself
        assert!(probe.other_instances().is_some());
    }

    #[test]
    fn counts_other_processes_by_exact_image_name() {
        // the test machine surely runs explorer.exe or svchost.exe; an invented name is never running
        assert_eq!(other_processes_named("snappy-image-that-does-not-exist.exe"), Some(0));
        assert!(other_processes_named("svchost.exe").is_some_and(|n| n > 0));
        assert!(other_processes_named("SVCHOST.EXE").is_some_and(|n| n > 0), "case-insensitive");
        assert_eq!(other_processes_named("svchost"), Some(0), "the whole name must match");
    }

    #[test]
    fn reads_registry_text_and_reports_missing_keys_as_none() {
        assert_eq!(registry_text(r"Software\Snappy contributors\definitely-missing", ""), None);
        assert_eq!(registry_text(r"Environment", "definitely-missing-value"), None);
        // the user's own environment key holds a PATH or TEMP style text value on a normal account; accept either missing or non-empty
        if let Some(text) = registry_text("Environment", "TEMP") {
            assert!(!text.is_empty());
        }
    }
}
