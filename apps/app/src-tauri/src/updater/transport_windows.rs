//! The Windows transport: one GET at a time over WinHTTP. This is the ONLY file that may use WinHTTP
//! (a check in `tools/check-no-network-deps.mjs` enforces it) and one of two with `unsafe` (the other
//! is `launch_windows.rs`). It does not decide what may be fetched: `transport::fetch` checks every
//! address first and hands this file only the validated pieces (host, port, path and query).
//!
//! Settings, each on purpose:
//! - Redirects are never followed here (the caller follows `Location` itself, under the same rules).
//! - Cookies, redirects and authentication are switched off, and automatic logon is set to its
//!   strictest level. The program never answers an NTLM or Kerberos challenge, so no credential can
//!   reach a proxy. A proxy that wants a login simply means no automatic updates.
//! - No certificate error is ever ignored. There is no override, not even in the test build.
//! - TLS 1.2 and 1.3; if 1.3 cannot be set, 1.2 alone. Never lower.
//! - The system proxy configuration is used (automatic proxy detection included), except for the
//!   loopback address of the test build, which never goes through a proxy.
//! - No `Referer`, no `Accept-Language`, no `Accept-Encoding`; a response with a content encoding
//!   is refused. The only header set is the `User-Agent`.
//! - A response is accepted only with status 200 and, when a length is required, only with a
//!   `Content-Length` that is within the cap and equal to the bytes received.

use std::ffi::c_void;
use std::ptr::{null, null_mut};
use std::time::Instant;

use windows_sys::Win32::Foundation::{GetLastError, ERROR_INSUFFICIENT_BUFFER};
use windows_sys::Win32::Networking::WinHttp::{
    WinHttpCloseHandle, WinHttpConnect, WinHttpOpen, WinHttpOpenRequest, WinHttpQueryHeaders, WinHttpReadData, WinHttpReceiveResponse, WinHttpSendRequest,
    WinHttpSetOption, WinHttpSetTimeouts, ERROR_WINHTTP_HEADER_NOT_FOUND, ERROR_WINHTTP_TIMEOUT, WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
    WINHTTP_ACCESS_TYPE_DEFAULT_PROXY, WINHTTP_ACCESS_TYPE_NO_PROXY, WINHTTP_AUTOLOGON_SECURITY_LEVEL_HIGH, WINHTTP_DISABLE_AUTHENTICATION,
    WINHTTP_DISABLE_COOKIES, WINHTTP_DISABLE_REDIRECTS, WINHTTP_FLAG_SECURE, WINHTTP_FLAG_SECURE_PROTOCOL_TLS1_2, WINHTTP_FLAG_SECURE_PROTOCOL_TLS1_3,
    WINHTTP_OPTION_AUTOLOGON_POLICY, WINHTTP_OPTION_DISABLE_FEATURE, WINHTTP_OPTION_MAX_RESPONSE_HEADER_SIZE, WINHTTP_OPTION_REDIRECT_POLICY,
    WINHTTP_OPTION_REDIRECT_POLICY_NEVER, WINHTTP_OPTION_SECURE_PROTOCOLS, WINHTTP_QUERY_CONTENT_ENCODING, WINHTTP_QUERY_CONTENT_LENGTH,
    WINHTTP_QUERY_FLAG_NUMBER, WINHTTP_QUERY_LOCATION, WINHTTP_QUERY_STATUS_CODE,
};

use super::transport::{FetchOptions, Hop, NetError, Sink, Target, Transport};

/// The only header the program sets.
const USER_AGENT: &str = "Snappy-Updater";
/// Resolve, connect and send each get this long.
const SETUP_TIMEOUT_MS: i32 = 5_000;
const READ_CHUNK: usize = 64 * 1024;
/// A `Location` longer than this (in UTF-16 units) is refused.
const MAX_HEADER_UNITS: usize = 8 * 1024;
/// The response headers may not be larger than this (WinHTTP's default is 64 KiB).
const MAX_RESPONSE_HEADERS: u32 = 16 * 1024;

// Windows error codes that mean "the secure connection or certificate was not acceptable".
// 12037 date invalid, 12038 name mismatch, 12044 client certificate wanted, 12045 untrusted CA,
// 12055 revocation, 12056 unknown extended usage, 12057 revocation check failed, 12157 channel
// error, 12169 invalid certificate, 12170 revoked, 12171 failed to start, 12175 secure failure.
const TLS_ERRORS: [u32; 12] = [12037, 12038, 12044, 12045, 12055, 12056, 12057, 12157, 12169, 12170, 12171, 12175];

/// A WinHTTP handle that is closed when it goes out of scope.
struct Handle(*mut c_void);

impl Handle {
    fn open(raw: *mut c_void) -> Result<Handle, NetError> {
        if raw.is_null() {
            Err(last_error())
        } else {
            Ok(Handle(raw))
        }
    }
}

impl Drop for Handle {
    fn drop(&mut self) {
        // SAFETY: the handle came from a successful WinHTTP call and is closed exactly once, here.
        unsafe { WinHttpCloseHandle(self.0) };
    }
}

fn last_error() -> NetError {
    // SAFETY: GetLastError only reads the calling thread's last-error value.
    let code = unsafe { GetLastError() };
    if code == ERROR_WINHTTP_TIMEOUT {
        NetError::Timeout
    } else if TLS_ERRORS.contains(&code) {
        NetError::Tls
    } else {
        NetError::Offline
    }
}

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

fn ok(result: i32) -> Result<(), NetError> {
    if result == 0 {
        Err(last_error())
    } else {
        Ok(())
    }
}

fn set_u32(handle: &Handle, option: u32, value: u32) -> Result<(), NetError> {
    // SAFETY: `value` outlives the call and the length passed is its size.
    ok(unsafe { WinHttpSetOption(handle.0, option, (&value as *const u32).cast(), 4) })
}

/// A header as text. `None` when the response has no such header.
fn header_text(request: &Handle, info: u32) -> Result<Option<String>, NetError> {
    let mut bytes: u32 = 0;
    // SAFETY: a null buffer with a zero length asks WinHTTP for the size it needs.
    let first = unsafe { WinHttpQueryHeaders(request.0, info, null(), null_mut(), &mut bytes, null_mut()) };
    if first != 0 {
        return Ok(Some(String::new()));
    }
    // SAFETY: GetLastError only reads the calling thread's last-error value.
    let code = unsafe { GetLastError() };
    if code == ERROR_WINHTTP_HEADER_NOT_FOUND {
        return Ok(None);
    }
    if code != ERROR_INSUFFICIENT_BUFFER || bytes as usize > MAX_HEADER_UNITS * 2 {
        return Err(NetError::Offline);
    }
    let mut buf = vec![0u16; bytes as usize / 2 + 1];
    let mut len = (buf.len() * 2) as u32;
    // SAFETY: `buf` holds `len` bytes and is valid for writes for the whole call.
    ok(unsafe { WinHttpQueryHeaders(request.0, info, null(), buf.as_mut_ptr().cast(), &mut len, null_mut()) })?;
    Ok(Some(String::from_utf16_lossy(&buf[..(len as usize / 2).min(buf.len())])))
}

fn status_code(request: &Handle) -> Result<u16, NetError> {
    let mut status: u32 = 0;
    let mut len: u32 = 4;
    // SAFETY: with the NUMBER flag the result is a u32 written to `status`, which is 4 bytes.
    ok(unsafe { WinHttpQueryHeaders(request.0, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER, null(), (&mut status as *mut u32).cast(), &mut len, null_mut()) })?;
    u16::try_from(status).map_err(|_| NetError::Offline)
}

fn session(target: &Target) -> Result<Handle, NetError> {
    let agent = wide(USER_AGENT);
    let open = |access| {
        // SAFETY: `agent` is a null-terminated UTF-16 string that outlives the call; no proxy names are passed.
        Handle::open(unsafe { WinHttpOpen(agent.as_ptr(), access, null(), null(), 0) })
    };
    if target.loopback {
        return open(WINHTTP_ACCESS_TYPE_NO_PROXY);
    }
    // Automatic proxy detection needs Windows 8.1; older systems use the default proxy settings.
    open(WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY).or_else(|_| open(WINHTTP_ACCESS_TYPE_DEFAULT_PROXY))
}

/// TLS 1.2 and 1.3, or 1.2 alone where 1.3 is unknown. Never lower, never left at the default.
fn require_modern_tls(session: &Handle) -> Result<(), NetError> {
    set_u32(session, WINHTTP_OPTION_SECURE_PROTOCOLS, WINHTTP_FLAG_SECURE_PROTOCOL_TLS1_2 | WINHTTP_FLAG_SECURE_PROTOCOL_TLS1_3)
        .or_else(|_| set_u32(session, WINHTTP_OPTION_SECURE_PROTOCOLS, WINHTTP_FLAG_SECURE_PROTOCOL_TLS1_2))
        .map_err(|_| NetError::Tls)
}

/// The WinHTTP transport. It holds no state: every request opens and closes its own handles.
#[derive(Debug, Default, Clone, Copy)]
pub struct WinHttp;

impl Transport for WinHttp {
    fn get(&self, target: &Target, options: &FetchOptions, sink: Sink<'_>) -> Result<Hop, NetError> {
        let left = || options.deadline.saturating_duration_since(Instant::now());
        if left().is_zero() {
            return Err(NetError::Timeout);
        }
        let session = session(target)?;
        let receive_ms = options.idle.min(left()).as_millis().clamp(1_000, 120_000) as i32;
        // SAFETY: plain integers and a live session handle.
        ok(unsafe { WinHttpSetTimeouts(session.0, SETUP_TIMEOUT_MS, SETUP_TIMEOUT_MS, SETUP_TIMEOUT_MS, receive_ms) })?;
        if target.secure {
            require_modern_tls(&session)?;
        }

        let host = wide(&target.host);
        // SAFETY: `host` is a null-terminated UTF-16 string that outlives the call; the session is live.
        let connection = Handle::open(unsafe { WinHttpConnect(session.0, host.as_ptr(), target.port, 0) })?;
        let (verb, path) = (wide("GET"), wide(&target.path_and_query));
        let flags = if target.secure { WINHTTP_FLAG_SECURE } else { 0 };
        // SAFETY: all strings are null-terminated and outlive the call. A null version means HTTP/1.1, a null
        // referrer sends none, and null accept types send no `Accept` header.
        let request = Handle::open(unsafe { WinHttpOpenRequest(connection.0, verb.as_ptr(), path.as_ptr(), null(), null(), null(), flags) })?;

        set_u32(&request, WINHTTP_OPTION_REDIRECT_POLICY, WINHTTP_OPTION_REDIRECT_POLICY_NEVER)?;
        set_u32(&request, WINHTTP_OPTION_DISABLE_FEATURE, WINHTTP_DISABLE_COOKIES | WINHTTP_DISABLE_REDIRECTS | WINHTTP_DISABLE_AUTHENTICATION)?;
        set_u32(&request, WINHTTP_OPTION_AUTOLOGON_POLICY, WINHTTP_AUTOLOGON_SECURITY_LEVEL_HIGH)?;
        set_u32(&request, WINHTTP_OPTION_MAX_RESPONSE_HEADER_SIZE, MAX_RESPONSE_HEADERS)?;

        // SAFETY: no extra headers and no request body are passed (null pointers with zero lengths).
        ok(unsafe { WinHttpSendRequest(request.0, null(), 0, null(), 0, 0, 0) })?;
        // SAFETY: the request was sent; the reserved argument must be null.
        ok(unsafe { WinHttpReceiveResponse(request.0, null_mut()) })?;

        let status = status_code(&request)?;
        if status != 200 {
            let location = if (300..400).contains(&status) { header_text(&request, WINHTTP_QUERY_LOCATION)? } else { None };
            return Ok(Hop { status, location });
        }

        if let Some(encoding) = header_text(&request, WINHTTP_QUERY_CONTENT_ENCODING)? {
            if !encoding.trim().eq_ignore_ascii_case("identity") {
                return Err(NetError::Encoding);
            }
        }
        let length = match header_text(&request, WINHTTP_QUERY_CONTENT_LENGTH)? {
            Some(text) => Some(text.trim().parse::<u64>().map_err(|_| NetError::Size)?),
            None => None,
        };
        if (options.require_length && length.is_none()) || length.is_some_and(|n| n > options.max_body) {
            return Err(NetError::Size);
        }

        let mut buf = vec![0u8; READ_CHUNK];
        let mut total = 0u64;
        loop {
            if left().is_zero() {
                return Err(NetError::Timeout);
            }
            let mut read: u32 = 0;
            // SAFETY: `buf` is valid for writes of READ_CHUNK bytes, and `read` receives the count.
            ok(unsafe { WinHttpReadData(request.0, buf.as_mut_ptr().cast(), READ_CHUNK as u32, &mut read) })?;
            if read == 0 {
                break;
            }
            total += u64::from(read);
            if total > options.max_body || length.is_some_and(|n| total > n) {
                return Err(NetError::Size);
            }
            sink(&buf[..read as usize])?;
        }
        if length.is_some_and(|n| total != n) {
            return Err(NetError::Size);
        }
        Ok(Hop { status, location: None })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::updater::testserver::{Reply, Server};
    use crate::updater::transport::{fetch, Policy, PolicyError};
    use std::time::Duration;

    fn options(max_body: u64, require_length: bool) -> FetchOptions {
        FetchOptions { max_body, require_length, deadline: Instant::now() + Duration::from_secs(15), idle: Duration::from_secs(5) }
    }

    fn get(server: &Server, path: &str, opts: &FetchOptions) -> (Result<(), NetError>, Vec<u8>) {
        let mut body = Vec::new();
        let result = fetch(&WinHttp, &server.url(path), Policy::Loopback, opts, &mut |b| {
            body.extend_from_slice(b);
            Ok(())
        });
        (result, body)
    }

    #[test]
    fn downloads_a_body_and_sends_only_the_agent_header() {
        let server = Server::start(|req| match req.path.as_str() {
            "/file" => Reply::ok(b"hello, update".to_vec()),
            _ => Reply::status(404),
        });
        let (r, body) = get(&server, "/file", &options(1024, true));
        assert_eq!((r, body), (Ok(()), b"hello, update".to_vec()));
        let seen = server.requests();
        assert_eq!(seen.len(), 1);
        let names: Vec<String> = seen[0].headers.iter().map(|(k, _)| k.to_ascii_lowercase()).collect();
        for banned in ["cookie", "referer", "accept-language", "accept-encoding", "authorization", "origin"] {
            assert!(!names.iter().any(|n| n == banned), "{banned} must not be sent: {names:?}");
        }
        let agent = seen[0].headers.iter().find(|(k, _)| k.eq_ignore_ascii_case("user-agent")).map(|(_, v)| v.as_str());
        assert_eq!(agent, Some("Snappy-Updater"));
        assert!(!seen[0].path.contains('?'), "no query string, no identifier");
    }

    #[test]
    fn follows_a_redirect_by_hand_and_stops_at_a_foreign_host() {
        let server = Server::start(|req| match req.path.as_str() {
            "/a" => Reply::redirect(302, "/b"),
            "/b" => Reply::ok(b"final".to_vec()),
            "/out" => Reply::redirect(302, "http://localhost:1/x"),
            _ => Reply::status(404),
        });
        assert_eq!(get(&server, "/a", &options(1024, true)), (Ok(()), b"final".to_vec()));
        let (r, body) = get(&server, "/out", &options(1024, true));
        assert_eq!(r, Err(NetError::Policy(PolicyError::Host)));
        assert!(body.is_empty());
        assert_eq!(server.requests().iter().filter(|q| q.path == "/x").count(), 0);
    }

    #[test]
    fn a_redirect_loop_ends_and_other_statuses_fail() {
        let server = Server::start(|req| match req.path.as_str() {
            "/loop" => Reply::redirect(302, "/loop"),
            "/401" => Reply::status(401),
            "/407" => Reply::status(407),
            "/500" => Reply::status(500),
            "/206" => Reply::status(206),
            _ => Reply::status(404),
        });
        assert_eq!(get(&server, "/loop", &options(1024, true)).0, Err(NetError::Policy(PolicyError::TooManyRedirects)));
        assert_eq!(server.requests().len(), 5);
        for (path, status) in [("/401", 401), ("/407", 407), ("/500", 500), ("/206", 206), ("/missing", 404)] {
            assert_eq!(get(&server, path, &options(1024, true)).0, Err(NetError::Status(status)), "{path}");
        }
    }

    #[test]
    fn refuses_a_missing_wrong_or_oversized_length_and_an_encoding() {
        let server = Server::start(|req| match req.path.as_str() {
            "/no-length" => Reply::ok(b"abc".to_vec()).without_length(),
            "/too-big" => Reply::ok(vec![7u8; 5000]),
            "/short" => Reply::ok(b"abcdef".to_vec()).declaring(10),
            "/gzip" => Reply::ok(b"abc".to_vec()).with_header("Content-Encoding", "gzip"),
            "/identity" => Reply::ok(b"abc".to_vec()).with_header("Content-Encoding", "identity"),
            _ => Reply::status(404),
        });
        assert_eq!(get(&server, "/no-length", &options(1024, true)).0, Err(NetError::Size));
        assert_eq!(get(&server, "/no-length", &options(1024, false)), (Ok(()), b"abc".to_vec()), "a manifest may come without a length");
        assert_eq!(get(&server, "/too-big", &options(1024, true)).0, Err(NetError::Size));
        // the connection closes before the declared length: refused either as a size error or as a broken connection
        assert!(matches!(get(&server, "/short", &options(1024, true)).0, Err(NetError::Size | NetError::Offline)));
        assert_eq!(get(&server, "/gzip", &options(1024, true)).0, Err(NetError::Encoding));
        assert_eq!(get(&server, "/identity", &options(1024, true)), (Ok(()), b"abc".to_vec()));
    }

    #[test]
    fn an_unreachable_server_is_offline_and_a_silent_one_times_out() {
        let dead = Server::start(|_| Reply::ok(Vec::new()));
        let dead_url = dead.url("/x");
        drop(dead);
        let mut sink = |_: &[u8]| Ok(());
        assert_eq!(fetch(&WinHttp, &dead_url, Policy::Loopback, &options(10, true), &mut sink), Err(NetError::Offline));

        let slow = Server::start(|_| Reply::ok(b"late".to_vec()).after(Duration::from_secs(4)));
        let quick = FetchOptions { max_body: 10, require_length: true, deadline: Instant::now() + Duration::from_secs(15), idle: Duration::from_millis(1_200) };
        let started = Instant::now();
        assert_eq!(fetch(&WinHttp, &slow.url("/x"), Policy::Loopback, &quick, &mut sink), Err(NetError::Timeout));
        assert!(started.elapsed() < Duration::from_secs(4), "the idle limit ends the wait");
    }

    #[test]
    fn the_overall_deadline_ends_a_slow_fetch() {
        let server = Server::start(|_| Reply::ok(b"x".to_vec()));
        let expired = FetchOptions { max_body: 10, require_length: true, deadline: Instant::now(), idle: Duration::from_secs(5) };
        let mut sink = |_: &[u8]| Ok(());
        assert_eq!(fetch(&WinHttp, &server.url("/x"), Policy::Loopback, &expired, &mut sink), Err(NetError::Timeout));
        assert!(server.requests().is_empty(), "no request once the time is up");
    }
}
