//! Whether this running copy may update itself.
//!
//! The updater only runs when it is updating the per-user installer's copy that it is running
//! from. Everything else (a development build, a portable copy, a machine-wide install, an MSI
//! install, a copy run with administrator rights) can still learn that a newer version exists,
//! but stages nothing and shows the plain link instead. Reason: an elevated Snappy that launched an
//! installer from a folder any same-user program can write to would hand that program
//! administrator rights, and a second copy next to the installed one would leave two installs.
//!
//! The facts come from a `Probe` (the real one, in `launch_windows.rs`, asks Windows; tests use a
//! fake). The decision here is plain logic.

use std::path::{Component, Path, PathBuf};

pub trait Probe {
    /// The running program's own file, with links resolved.
    fn exe_path(&self) -> Option<PathBuf>;
    /// The install folder the per-user installer recorded for this product, if any.
    fn registered_install_dir(&self) -> Option<PathBuf>;
    /// The per-user local application data folder.
    fn local_app_data(&self) -> Option<PathBuf>;
    /// Whether this process runs elevated. `None` when it cannot be told.
    fn is_elevated(&self) -> Option<bool>;
    /// How many other processes run the same program file. `None` when it cannot be told.
    fn other_instances(&self) -> Option<u32>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Supported,
    /// Not the per-user installer's copy (no record, a different folder, not under the user's data folder).
    NotInstalled,
    /// Running with administrator rights.
    Elevated,
    /// Something needed to decide could not be read. Treated like unsupported.
    Unknown,
}

/// Components of a path, lowercased, with Windows' extended prefix and trailing separators gone.
fn parts(path: &Path) -> Vec<String> {
    path.components()
        .filter_map(|c| match c {
            Component::Prefix(p) => Some(p.as_os_str().to_string_lossy().trim_start_matches(r"\\?\").to_lowercase()),
            Component::Normal(n) => Some(n.to_string_lossy().to_lowercase()),
            Component::RootDir | Component::CurDir => None,
            Component::ParentDir => Some("..".to_string()),
        })
        .collect()
}

fn same_folder(a: &Path, b: &Path) -> bool {
    let (a, b) = (parts(a), parts(b));
    !a.is_empty() && !a.contains(&"..".to_string()) && a == b
}

fn is_inside(child: &Path, parent: &Path) -> bool {
    let (child, parent) = (parts(child), parts(parent));
    !parent.is_empty() && !child.contains(&"..".to_string()) && child.len() > parent.len() && child[..parent.len()] == parent[..]
}

pub fn kind(probe: &dyn Probe) -> Kind {
    let Some(elevated) = probe.is_elevated() else { return Kind::Unknown };
    if elevated {
        return Kind::Elevated;
    }
    let (Some(exe), Some(registered), Some(data)) = (probe.exe_path(), probe.registered_install_dir(), probe.local_app_data()) else {
        // No installer record is the ordinary state of a development build or a portable copy.
        return if probe.registered_install_dir().is_none() { Kind::NotInstalled } else { Kind::Unknown };
    };
    let in_install_dir = exe.parent().is_some_and(|dir| same_folder(dir, &registered));
    if in_install_dir && is_inside(&registered, &data) {
        Kind::Supported
    } else {
        Kind::NotInstalled
    }
}

/// True when no other copy of the program is running. Unknown counts as "not alone".
pub fn alone(probe: &dyn Probe) -> bool {
    probe.other_instances() == Some(0)
}

// The fakes and tests use Windows paths, so they run on Windows only.
#[cfg(all(test, windows))]
pub struct Fake {
    pub exe: Option<PathBuf>,
    pub registered: Option<PathBuf>,
    pub data: Option<PathBuf>,
    pub elevated: Option<bool>,
    pub others: Option<u32>,
}

#[cfg(all(test, windows))]
impl Fake {
    /// A normal per-user install: the program in `%LOCALAPPDATA%\Snappy`, not elevated, alone.
    pub fn installed() -> Fake {
        Fake {
            exe: Some(PathBuf::from(r"C:\Users\Ana\AppData\Local\Snappy\snappy.exe")),
            registered: Some(PathBuf::from(r"C:\Users\Ana\AppData\Local\Snappy")),
            data: Some(PathBuf::from(r"C:\Users\Ana\AppData\Local")),
            elevated: Some(false),
            others: Some(0),
        }
    }
}

#[cfg(all(test, windows))]
impl Probe for Fake {
    fn exe_path(&self) -> Option<PathBuf> {
        self.exe.clone()
    }
    fn registered_install_dir(&self) -> Option<PathBuf> {
        self.registered.clone()
    }
    fn local_app_data(&self) -> Option<PathBuf> {
        self.data.clone()
    }
    fn is_elevated(&self) -> Option<bool> {
        self.elevated
    }
    fn other_instances(&self) -> Option<u32> {
        self.others
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    fn with(change: impl FnOnce(&mut Fake)) -> Kind {
        let mut f = Fake::installed();
        change(&mut f);
        kind(&f)
    }

    #[test]
    fn the_per_user_install_may_update() {
        assert_eq!(kind(&Fake::installed()), Kind::Supported);
        // case, the extended prefix a canonical path carries, and a trailing separator do not matter
        assert_eq!(with(|f| f.exe = Some(PathBuf::from(r"\\?\c:\users\ana\appdata\local\snappy\SNAPPY.EXE"))), Kind::Supported);
        assert_eq!(with(|f| f.registered = Some(PathBuf::from(r"C:\Users\Ana\AppData\Local\Snappy\"))), Kind::Supported);
        assert_eq!(with(|f| f.data = Some(PathBuf::from(r"\\?\C:\Users\Ana\AppData\Local"))), Kind::Supported);
    }

    #[test]
    fn a_copy_outside_the_recorded_install_folder_may_not() {
        for exe in [
            r"C:\Users\Ana\Downloads\snappy.exe",
            r"C:\Users\Ana\AppData\Local\Snappy\bin\snappy.exe",
            r"C:\Users\Ana\AppData\Local\Snappy2\snappy.exe",
            r"C:\Users\Ana\AppData\Local\Snappy\..\Other\snappy.exe",
            r"D:\Snappy\snappy.exe",
            r"C:\Program Files\Snappy\snappy.exe",
            r"C:\Users\Ana\dev\Snappy\target\release\snappy.exe",
        ] {
            assert_eq!(with(|f| f.exe = Some(PathBuf::from(exe))), Kind::NotInstalled, "{exe}");
        }
    }

    #[test]
    fn a_machine_wide_install_or_one_outside_the_users_data_folder_may_not() {
        let machine = || PathBuf::from(r"C:\Program Files\Snappy");
        assert_eq!(
            with(|f| {
                f.exe = Some(machine().join("snappy.exe"));
                f.registered = Some(machine());
            }),
            Kind::NotInstalled
        );
        // the recorded folder must be strictly inside the data folder, not the data folder itself or a sibling
        assert_eq!(
            with(|f| {
                f.exe = Some(PathBuf::from(r"C:\Users\Ana\AppData\Local\snappy.exe"));
                f.registered = Some(PathBuf::from(r"C:\Users\Ana\AppData\Local"));
            }),
            Kind::NotInstalled
        );
        assert_eq!(with(|f| f.data = Some(PathBuf::from(r"C:\Users\Bob\AppData\Local"))), Kind::NotInstalled);
    }

    #[test]
    fn no_installer_record_means_not_installed_and_an_elevated_run_is_refused() {
        assert_eq!(with(|f| f.registered = None), Kind::NotInstalled);
        assert_eq!(with(|f| f.elevated = Some(true)), Kind::Elevated);
        assert_eq!(with(|f| f.elevated = None), Kind::Unknown);
        assert_eq!(with(|f| f.exe = None), Kind::Unknown);
        assert_eq!(with(|f| f.data = None), Kind::Unknown);
    }

    #[test]
    fn another_copy_running_means_not_alone_and_unknown_counts_as_not_alone() {
        let mut f = Fake::installed();
        assert!(alone(&f));
        f.others = Some(1);
        assert!(!alone(&f));
        f.others = None;
        assert!(!alone(&f));
    }
}
