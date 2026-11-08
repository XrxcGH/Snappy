//! The rules for what the updater may connect to, as pure functions, and the shape of a transport.
//!
//! Every address, including each redirect `Location`, is parsed once with the `url` crate. The
//! rules below are applied to the parsed value, and the transport is then given the parsed pieces
//! (host, port, path and query). The original string never reaches the operating system's network
//! code, so there is no second parse to disagree with this one.
//!
//! The first request must go to exactly `github.com`. Later hops (redirects) may go to
//! `github.com` or to a `githubusercontent.com` host: GitHub has already moved release downloads
//! between asset hosts once, and an exact pair would strand every installed copy the next time
//! it does. The host rule is defence in depth; the signature is the root of trust.

use std::net::IpAddr;
use std::sync::atomic::AtomicU64;
use std::time::{Duration, Instant};

use tauri::Url;

/// Redirects followed at most this many times; each one is checked like a first request.
pub const MAX_REDIRECTS: usize = 4;
/// The path of an address (before any `?`) is at most this long.
const MAX_PATH: usize = 512;
/// The whole address, query included. Release asset redirects carry long signed query strings.
const MAX_URL: usize = 4096;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Policy {
    /// The real thing: https on the default port, github.com and githubusercontent.com only.
    Release,
    /// End-to-end tests only: `127.0.0.1`, http or https, any port. Compiled out of release builds.
    #[cfg(any(test, feature = "dev-update-endpoint"))]
    Loopback,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PolicyError {
    /// Control characters, backslashes, spaces, non-ASCII text, `%` in the host part, too long, or not an address.
    Form,
    Scheme,
    UserInfo,
    Port,
    IpHost,
    Host,
    Fragment,
    PathTooLong,
    /// A redirect without a usable `Location`.
    NoLocation,
    TooManyRedirects,
}

/// A checked address, in the pieces the transport connects with.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Target {
    pub host: String,
    pub port: u16,
    pub secure: bool,
    /// Path and query, as the `url` crate serializes them.
    pub path_and_query: String,
    /// True only under `Policy::Loopback`: the transport then skips the system proxy.
    pub loopback: bool,
}

fn clean_text(raw: &str) -> bool {
    raw.len() <= MAX_URL && raw.bytes().all(|b| (0x21..0x7f).contains(&b) && b != b'\\')
}

fn host_allowed(host: &str, hop: usize) -> bool {
    if hop == 0 {
        return host == "github.com";
    }
    host == "github.com" || host == "githubusercontent.com" || host.ends_with(".githubusercontent.com")
}

fn is_ip_literal(host: &str) -> bool {
    host.starts_with('[') || host.parse::<IpAddr>().is_ok()
}

/// Checks one address for request number `hop` (0 for the first). See the module comment.
pub fn check_url(raw: &str, hop: usize, policy: Policy) -> Result<Target, PolicyError> {
    if !clean_text(raw) {
        return Err(PolicyError::Form);
    }
    let authority_end = raw.find("://").map(|i| i + 3).and_then(|start| raw[start..].find(['/', '?', '#']).map(|n| start + n)).unwrap_or(raw.len());
    if raw[..authority_end].contains('%') {
        return Err(PolicyError::Form);
    }
    let url = Url::parse(raw).map_err(|_| PolicyError::Form)?;
    #[cfg(any(test, feature = "dev-update-endpoint"))]
    let loopback = policy == Policy::Loopback;
    #[cfg(not(any(test, feature = "dev-update-endpoint")))]
    let loopback = false;
    let scheme_ok = match url.scheme() {
        "https" => true,
        "http" => loopback,
        _ => false,
    };
    if !scheme_ok {
        return Err(PolicyError::Scheme);
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(PolicyError::UserInfo);
    }
    if url.port().is_some() && !loopback {
        return Err(PolicyError::Port);
    }
    let host = url.host_str().ok_or(PolicyError::Form)?.to_string();
    if loopback {
        if host != "127.0.0.1" {
            return Err(PolicyError::Host);
        }
    } else {
        if is_ip_literal(&host) {
            return Err(PolicyError::IpHost);
        }
        if host.ends_with('.') || !host.is_ascii() || host.split('.').any(|label| label.starts_with("xn--")) || !host_allowed(&host, hop) {
            return Err(PolicyError::Host);
        }
    }
    if url.fragment().is_some() {
        return Err(PolicyError::Fragment);
    }
    if url.path().len() > MAX_PATH {
        return Err(PolicyError::PathTooLong);
    }
    let secure = url.scheme() == "https";
    let port = url.port().unwrap_or(if secure { 443 } else { 80 });
    let path_and_query = match url.query() {
        Some(q) => format!("{}?{q}", url.path()),
        None => url.path().to_string(),
    };
    Ok(Target { host, port, secure, path_and_query, loopback })
}

/// Turns a `Location` header into the full address of the next hop (relative values are resolved
/// against the address that answered). The result must still pass `check_url`.
pub fn resolve_location(from: &Target, location: &str) -> Result<String, PolicyError> {
    if location.is_empty() {
        return Err(PolicyError::NoLocation);
    }
    if !clean_text(location) {
        return Err(PolicyError::Form);
    }
    let scheme = if from.secure { "https" } else { "http" };
    let port = if (from.secure && from.port == 443) || (!from.secure && from.port == 80) { String::new() } else { format!(":{}", from.port) };
    let base = Url::parse(&format!("{scheme}://{}{port}{}", from.host, from.path_and_query)).map_err(|_| PolicyError::Form)?;
    base.join(location).map(|u| u.to_string()).map_err(|_| PolicyError::Form)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NetError {
    Offline,
    Timeout,
    /// The certificate or the secure connection failed. There is no override.
    Tls,
    /// A status other than 200 for the final response, or a redirect where none is allowed.
    Status(u16),
    Policy(PolicyError),
    /// The body is larger than the cap, has no length when one is required, or the length is wrong.
    Size,
    /// The response says it is compressed or otherwise encoded.
    Encoding,
    /// The sink could not take the bytes (the disk).
    Disk,
}

/// What one request without redirects gave.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Hop {
    pub status: u16,
    pub location: Option<String>,
}

#[derive(Debug, Clone, Copy)]
pub struct FetchOptions<'a> {
    /// Bodies larger than this are refused (by the declared length, and again while reading).
    pub max_body: u64,
    /// The installer must declare its length; the manifest may not.
    pub require_length: bool,
    /// The whole fetch, redirects included, ends by this time.
    pub deadline: Instant,
    /// The longest wait for the next piece of data.
    pub idle: Duration,
    /// Receives the declared body length (when there is one) as soon as the headers are in, for a progress figure.
    pub length_out: Option<&'a AtomicU64>,
}

pub type Sink<'a> = &'a mut dyn FnMut(&[u8]) -> Result<(), NetError>;

/// One request, no redirects followed. For status 200 the implementation checks the headers (no
/// `Content-Encoding`, a length when `require_length`, a length within `max_body`) and streams the
/// body into `sink`, failing if the bytes received differ from the declared length. For any other
/// status it reads no body and returns the status and any `Location`.
pub trait Transport {
    fn get(&self, target: &Target, options: &FetchOptions, sink: Sink<'_>) -> Result<Hop, NetError>;
}

/// Follows redirects by hand: at most [`MAX_REDIRECTS`], the whole policy re-applied on each hop,
/// and only status 200 accepted at the end.
pub fn fetch(transport: &dyn Transport, start: &str, policy: Policy, options: &FetchOptions, sink: Sink<'_>) -> Result<(), NetError> {
    let mut next = start.to_string();
    for hop in 0..=MAX_REDIRECTS {
        let target = check_url(&next, hop, policy).map_err(NetError::Policy)?;
        let answer = transport.get(&target, options, &mut *sink)?;
        match answer.status {
            200 => return Ok(()),
            301 | 302 | 303 | 307 | 308 => {
                if hop == MAX_REDIRECTS {
                    return Err(NetError::Policy(PolicyError::TooManyRedirects));
                }
                let location = answer.location.ok_or(NetError::Policy(PolicyError::NoLocation))?;
                next = resolve_location(&target, &location).map_err(NetError::Policy)?;
            }
            other => return Err(NetError::Status(other)),
        }
    }
    Err(NetError::Policy(PolicyError::TooManyRedirects))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    fn release(raw: &str, hop: usize) -> Result<Target, PolicyError> {
        check_url(raw, hop, Policy::Release)
    }

    #[test]
    fn the_first_request_goes_to_github_com_and_nowhere_else() {
        let t = release("https://github.com/XrxcGH/Snappy/releases/latest/download/latest.json", 0).unwrap();
        assert_eq!((t.host.as_str(), t.port, t.secure, t.loopback), ("github.com", 443, true, false));
        assert_eq!(t.path_and_query, "/XrxcGH/Snappy/releases/latest/download/latest.json");
        for u in ["https://objects.githubusercontent.com/x", "https://release-assets.githubusercontent.com/x", "https://githubusercontent.com/x", "https://www.github.com/x"] {
            assert_eq!(release(u, 0), Err(PolicyError::Host), "{u}");
        }
    }

    #[test]
    fn later_hops_may_use_githubusercontent_hosts_on_a_label_boundary() {
        for u in [
            "https://github.com/x",
            "https://githubusercontent.com/x",
            "https://objects.githubusercontent.com/github-production-release-asset/1?sp=r&sig=a%2Bb",
            "https://release-assets.githubusercontent.com/x",
            "https://a.b.githubusercontent.com/x",
        ] {
            assert!(release(u, 1).is_ok(), "{u}");
        }
        for u in [
            "https://evilgithubusercontent.com/x",
            "https://githubusercontent.com.evil.test/x",
            "https://github.com.evil.test/x",
            "https://evil.test/github.com",
            "https://notgithub.com/x",
            "https://githubusercontent.co/x",
            "https://xgithubusercontent.com/x",
            "https://objects.githubusercontent.com.evil.test/x",
        ] {
            assert_eq!(release(u, 1), Err(PolicyError::Host), "{u}");
        }
    }

    #[test]
    fn the_parser_differential_vectors_are_refused() {
        let cases: [(&str, PolicyError); 14] = [
            (r"https://github.com\@evil.test/", PolicyError::Form),
            ("https://github.com.evil.test/", PolicyError::Host),
            ("https://evil.test/github.com", PolicyError::Host),
            ("https://github.com:443@evil.test/", PolicyError::UserInfo),
            ("https://GITHUB.com./", PolicyError::Host),
            ("https://github.com%2f@evil.test/", PolicyError::Form),
            ("https://github%2ecom/", PolicyError::Form),
            ("https://github.com./x", PolicyError::Host),
            ("https://github.com@evil.test/", PolicyError::UserInfo),
            ("https://user:pw@github.com/", PolicyError::UserInfo),
            ("https://github.com:8443/x", PolicyError::Port),
            ("https://github.com:80/x", PolicyError::Port),
            ("https://github.com#@evil.test/", PolicyError::Fragment),
            ("https://github.com/x#frag", PolicyError::Fragment),
        ];
        for (u, why) in cases {
            assert_eq!(release(u, 0), Err(why), "{u}");
            assert_eq!(release(u, 1).err().is_some(), true, "{u} at a later hop");
        }
        // an explicit default port is the same address, and the host is case insensitive
        assert!(release("https://github.com:443/x", 0).is_ok());
        assert!(release("https://GITHUB.com/x", 0).is_ok());
    }

    #[test]
    fn the_scheme_and_the_form_of_an_address_are_checked() {
        for u in ["http://github.com/x", "ftp://github.com/x", "file:///C:/x", "ws://github.com/", "wss://github.com/", "javascript:alert(1)", "data:text/plain,x", "github.com/x", "//github.com/x", ""] {
            assert!(release(u, 0).is_err(), "{u}");
        }
        for u in ["https://github.com/a b", "https://github.com/a\tb", "https://github.com/a\nb", "https://github.com/a\rb", "https://github.com/\u{e9}", "https://gïthub.com/", "https://github.com/\u{0}", "https://github.com/\u{7f}"] {
            assert_eq!(release(u, 0), Err(PolicyError::Form), "{u:?}");
        }
        for u in ["https://127.0.0.1/x", "https://[::1]/x", "https://[::ffff:127.0.0.1]/x", "https://2130706433/x", "https://0x7f.1/x", "https://140.82.112.3/x", "https://127.1/x"] {
            assert_eq!(release(u, 1).err(), Some(PolicyError::IpHost), "{u}");
        }
        assert_eq!(release("https://xn--e1afmkfd.githubusercontent.com/x", 1), Err(PolicyError::Host));
        assert_eq!(release("https://github.com.xn--e1afmkfd/x", 1), Err(PolicyError::Host));
    }

    #[test]
    fn long_paths_and_queries_have_separate_limits() {
        let path = |n: usize| format!("https://github.com/{}", "a".repeat(n));
        assert!(release(&path(511), 0).is_ok());
        assert_eq!(release(&path(512), 0), Err(PolicyError::PathTooLong));
        // a signed asset address has a long query and a short path
        let signed = format!("https://release-assets.githubusercontent.com/a/b?sp=r&sig={}", "A".repeat(1500));
        assert!(release(&signed, 1).is_ok());
        let huge = format!("https://release-assets.githubusercontent.com/a?x={}", "A".repeat(MAX_URL));
        assert_eq!(release(&huge, 1), Err(PolicyError::Form));
    }

    #[test]
    fn the_loopback_policy_allows_only_127_0_0_1() {
        let ok = |u: &str| check_url(u, 0, Policy::Loopback);
        let t = ok("http://127.0.0.1:8123/releases/latest/download/latest.json?x=1").unwrap();
        assert_eq!((t.host.as_str(), t.port, t.secure, t.loopback), ("127.0.0.1", 8123, false, true));
        assert_eq!(t.path_and_query, "/releases/latest/download/latest.json?x=1");
        assert!(ok("https://127.0.0.1:9/x").unwrap().secure);
        for u in ["http://localhost:1/x", "http://127.0.0.2:1/x", "http://github.com/x", "https://github.com/x", "http://127.0.0.1.evil.test/x", "http://user@127.0.0.1:1/x", "http://[::1]:1/x", "ftp://127.0.0.1/x"] {
            assert!(ok(u).is_err(), "{u}");
        }
        assert!(release("http://127.0.0.1:8123/x", 0).is_err(), "release never allows loopback");
    }

    #[test]
    fn a_location_is_resolved_and_then_checked_like_any_address() {
        let from = release("https://github.com/XrxcGH/Snappy/releases/download/v0.2.0/a.exe", 0).unwrap();
        let go = |loc: &str| resolve_location(&from, loc).and_then(|next| release(&next, 1).map(|t| (t.host, t.path_and_query)));
        assert_eq!(go("/other/path").unwrap(), ("github.com".into(), "/other/path".into()));
        assert_eq!(go("https://objects.githubusercontent.com/x?a=b").unwrap(), ("objects.githubusercontent.com".into(), "/x?a=b".into()));
        assert_eq!(go("next.exe").unwrap().1, "/XrxcGH/Snappy/releases/download/v0.2.0/next.exe");
        assert_eq!(go("//evil.test/x"), Err(PolicyError::Host), "a relative location that leaves the host");
        assert_eq!(go("https://evil.test/x"), Err(PolicyError::Host));
        assert_eq!(go("http://github.com/x"), Err(PolicyError::Scheme));
        assert_eq!(go("https://user@github.com/x"), Err(PolicyError::UserInfo));
        assert_eq!(go("https://github.com/x\r\nSet-Cookie: a=b"), Err(PolicyError::Form));
        assert_eq!(go("https://github.com/x\n"), Err(PolicyError::Form));
        assert_eq!(go(""), Err(PolicyError::NoLocation), "an empty location is not an address");
        assert!(go("https://github.com/x#f").is_err());
        assert!(go(r"https://github.com\@evil.test/").is_err());
    }

    /// A transport that plays a script of hops, one per call, and remembers where it was sent.
    struct Script {
        hops: RefCell<Vec<(Hop, &'static [u8])>>,
        seen: RefCell<Vec<Target>>,
    }

    impl Script {
        fn new(hops: Vec<(u16, Option<&str>, &'static [u8])>) -> Script {
            let hops = hops.into_iter().map(|(status, loc, body)| (Hop { status, location: loc.map(str::to_string) }, body)).rev().collect();
            Script { hops: RefCell::new(hops), seen: RefCell::new(Vec::new()) }
        }
    }

    impl Transport for Script {
        fn get(&self, target: &Target, _: &FetchOptions, sink: Sink<'_>) -> Result<Hop, NetError> {
            self.seen.borrow_mut().push(target.clone());
            let (hop, body) = self.hops.borrow_mut().pop().expect("the script ran out");
            if hop.status == 200 {
                sink(body)?;
            }
            Ok(hop)
        }
    }

    fn options() -> FetchOptions<'static> {
        FetchOptions { max_body: 1024, require_length: false, deadline: Instant::now() + Duration::from_secs(5), idle: Duration::from_secs(1), length_out: None }
    }

    fn run(script: &Script, start: &str) -> (Result<(), NetError>, Vec<u8>) {
        let mut got = Vec::new();
        let r = fetch(script, start, Policy::Release, &options(), &mut |b| {
            got.extend_from_slice(b);
            Ok(())
        });
        (r, got)
    }

    const START: &str = "https://github.com/XrxcGH/Snappy/releases/latest/download/latest.json";

    #[test]
    fn a_plain_answer_and_a_redirect_chain_end_in_the_body() {
        let s = Script::new(vec![(200, None, b"hello")]);
        assert_eq!(run(&s, START), (Ok(()), b"hello".to_vec()));
        let s = Script::new(vec![
            (302, Some("https://release-assets.githubusercontent.com/a?sig=1"), b""),
            (301, Some("/b"), b""),
            (200, None, b"body"),
        ]);
        let (r, body) = run(&s, START);
        assert_eq!((r, body), (Ok(()), b"body".to_vec()));
        let seen = s.seen.borrow();
        assert_eq!(seen.iter().map(|t| t.host.as_str()).collect::<Vec<_>>(), ["github.com", "release-assets.githubusercontent.com", "release-assets.githubusercontent.com"]);
        assert_eq!(seen[2].path_and_query, "/b");
    }

    #[test]
    fn a_redirect_to_the_wrong_place_stops_before_a_request_is_made() {
        for loc in ["https://evil.test/x", "http://github.com/x", "https://user@github.com/x", "https://127.0.0.1/x", "//evil.test/x", "https://github.com:8443/x"] {
            let s = Script::new(vec![(302, Some(loc), b""), (200, None, b"never")]);
            let (r, body) = run(&s, START);
            assert!(matches!(r, Err(NetError::Policy(_))), "{loc}: {r:?}");
            assert!(body.is_empty());
            assert_eq!(s.seen.borrow().len(), 1, "{loc}: no second request");
        }
        let s = Script::new(vec![(302, None, b"")]);
        assert_eq!(run(&s, START).0, Err(NetError::Policy(PolicyError::NoLocation)));
    }

    #[test]
    fn a_loop_ends_after_four_redirects() {
        let again = Some("https://github.com/loop");
        let s = Script::new(vec![(302, again, b""), (302, again, b""), (302, again, b""), (302, again, b""), (302, again, b""), (200, None, b"x")]);
        assert_eq!(run(&s, START).0, Err(NetError::Policy(PolicyError::TooManyRedirects)));
        assert_eq!(s.seen.borrow().len(), 5, "the first request and four redirects");
        // exactly four redirects then a 200 is fine
        let s = Script::new(vec![(302, again, b""), (302, again, b""), (302, again, b""), (302, again, b""), (200, None, b"ok")]);
        assert_eq!(run(&s, START), (Ok(()), b"ok".to_vec()));
    }

    #[test]
    fn only_200_is_a_success() {
        for status in [201u16, 204, 206, 304, 401, 404, 407, 429, 500, 503] {
            let s = Script::new(vec![(status, None, b"")]);
            assert_eq!(run(&s, START).0, Err(NetError::Status(status)), "{status}");
        }
    }

    #[test]
    fn the_start_address_is_checked_too() {
        let s = Script::new(vec![]);
        assert!(matches!(run(&s, "http://github.com/x").0, Err(NetError::Policy(PolicyError::Scheme))));
        assert!(s.seen.borrow().is_empty());
    }
}
