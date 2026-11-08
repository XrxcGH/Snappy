//! Automatic updates for the desktop app. The page can ask the program about updates through a few
//! commands; everything that decides what is downloaded, trusted and installed lives here, in Rust.
//! Nothing in this module takes an address, a host, a header, a version or a path from the page.

pub mod keys;
pub mod manifest;
pub mod store;
pub mod transport;
pub mod verify;

use serde::Serialize;

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
