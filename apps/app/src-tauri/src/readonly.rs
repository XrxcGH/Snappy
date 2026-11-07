//! Read-only access to the files the person picked in the native dialog.
//!
//! This is the whole file-reading surface of the shell. There is deliberately no way to write,
//! truncate, rename, delete or create anything from here, and no function takes a path from the
//! page: a path enters this table only from the dialog that Rust itself showed (see `lib.rs`), and
//! the page only ever holds an opaque id. A script that gets into the page can therefore read the
//! files the person chose in this run, and nothing else, and cannot modify even those.
//!
//! The file is opened with `File::open` (read only). Reads are positional (`seek_read` on Windows,
//! `read_at` elsewhere), so there is no shared cursor and nothing to lock around a read.

use std::collections::hash_map::RandomState;
use std::collections::HashMap;
use std::fs::File;
use std::hash::{BuildHasher, Hasher};
use std::path::Path;
use std::sync::Arc;

/// The most one call may return. Bigger ranges are refused, so the page cannot ask the shell to
/// allocate gigabytes in one go. The page asks for a few MiB at a time.
pub const MAX_READ_BYTES: u64 = 16 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct PickedFile {
    pub id: String,
    pub name: String,
    pub size: u64,
}

struct Entry {
    file: Arc<File>,
    size: u64,
}

#[derive(Default)]
pub struct Picked {
    files: HashMap<String, Entry>,
    ids: Option<RandomState>,
    counter: u64,
}

impl Picked {
    fn next_id(&mut self) -> String {
        // RandomState is seeded from the operating system's random source per process; hashing a
        // counter with it gives an unguessable-enough, collision-free id with no extra crate.
        let state = self.ids.get_or_insert_with(RandomState::new);
        self.counter += 1;
        let mut h = state.build_hasher();
        h.write_u64(self.counter);
        format!("f{:016x}{:04x}", h.finish(), self.counter)
    }

    /// Opens `path` read-only and remembers it under a new id. Only call this with a path the
    /// person just chose in the dialog.
    pub fn register(&mut self, path: &Path) -> Result<PickedFile, String> {
        let file = File::open(path).map_err(|e| format!("could not open the file: {e}"))?;
        let meta = file.metadata().map_err(|e| format!("could not read the file size: {e}"))?;
        if !meta.is_file() {
            return Err("that is not a file".into());
        }
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "export.zip".into());
        let id = self.next_id();
        let size = meta.len();
        self.files.insert(id.clone(), Entry { file: Arc::new(file), size });
        Ok(PickedFile { id, name, size })
    }

    /// Hands out the file for one read without keeping the table locked while reading.
    pub fn lookup(&self, id: &str) -> Result<(Arc<File>, u64), String> {
        self.files
            .get(id)
            .map(|e| (e.file.clone(), e.size))
            .ok_or_else(|| "unknown or closed file id".to_string())
    }

    pub fn close(&mut self, id: &str) {
        self.files.remove(id);
    }

    pub fn close_all(&mut self) {
        self.files.clear();
    }
}

#[cfg(windows)]
fn read_at(file: &File, buf: &mut [u8], offset: u64) -> std::io::Result<usize> {
    std::os::windows::fs::FileExt::seek_read(file, buf, offset)
}

#[cfg(unix)]
fn read_at(file: &File, buf: &mut [u8], offset: u64) -> std::io::Result<usize> {
    std::os::unix::fs::FileExt::read_at(file, buf, offset)
}

/// Reads exactly `length` bytes at `offset`. Refuses ranges outside the file or bigger than
/// [`MAX_READ_BYTES`]; a file that shrank after it was picked is an error, never silently short.
pub fn read_range(file: &File, size: u64, offset: u64, length: u64) -> Result<Vec<u8>, String> {
    if length > MAX_READ_BYTES {
        return Err("that read is larger than the limit".into());
    }
    let end = offset.checked_add(length).ok_or("the range is not valid")?;
    if end > size {
        return Err("the range is outside the file".into());
    }
    let mut out = vec![0u8; length as usize];
    let mut got = 0usize;
    while got < out.len() {
        let n = read_at(file, &mut out[got..], offset + got as u64).map_err(|e| format!("read failed: {e}"))?;
        if n == 0 {
            return Err("the file ended before the requested range".into());
        }
        got += n;
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn temp_file(tag: &str, bytes: &[u8]) -> std::path::PathBuf {
        let p = std::env::temp_dir().join(format!("snappy-readonly-test-{}-{tag}.bin", std::process::id()));
        std::fs::File::create(&p).unwrap().write_all(bytes).unwrap();
        p
    }

    fn pattern(n: usize) -> Vec<u8> {
        (0..n).map(|i| (i % 251) as u8).collect()
    }

    #[test]
    fn reads_exact_ranges_and_leaves_the_file_untouched() {
        let data = pattern(5000);
        let p = temp_file("exact", &data);
        let mut t = Picked::default();
        let f = t.register(&p).unwrap();
        assert_eq!(f.size, 5000);
        let (file, size) = t.lookup(&f.id).unwrap();
        assert_eq!(read_range(&file, size, 0, 5000).unwrap(), data);
        assert_eq!(read_range(&file, size, 4990, 10).unwrap(), data[4990..]);
        assert_eq!(read_range(&file, size, 100, 0).unwrap(), Vec::<u8>::new());
        assert_eq!(read_range(&file, size, 5000, 0).unwrap(), Vec::<u8>::new());
        drop(file);
        t.close_all();
        assert_eq!(std::fs::read(&p).unwrap(), data, "reading must never change the file");
        std::fs::remove_file(&p).unwrap();
    }

    #[test]
    fn refuses_ranges_outside_the_file_and_oversized_reads() {
        let p = temp_file("range", &pattern(100));
        let mut t = Picked::default();
        let f = t.register(&p).unwrap();
        let (file, size) = t.lookup(&f.id).unwrap();
        assert!(read_range(&file, size, 90, 11).is_err());
        assert!(read_range(&file, size, 101, 0).is_err());
        assert!(read_range(&file, size, u64::MAX, 2).is_err());
        assert!(read_range(&file, size, 0, MAX_READ_BYTES + 1).is_err());
        drop(file);
        std::fs::remove_file(&p).ok();
    }

    #[test]
    fn unknown_and_closed_ids_are_refused() {
        let p = temp_file("ids", &pattern(10));
        let mut t = Picked::default();
        assert!(t.lookup("f0000").is_err());
        let a = t.register(&p).unwrap();
        let b = t.register(&p).unwrap();
        assert_ne!(a.id, b.id);
        t.close(&a.id);
        assert!(t.lookup(&a.id).is_err());
        assert!(t.lookup(&b.id).is_ok());
        t.close_all();
        assert!(t.lookup(&b.id).is_err());
        std::fs::remove_file(&p).ok();
    }

    #[test]
    fn a_directory_or_missing_path_is_not_registered() {
        let mut t = Picked::default();
        assert!(t.register(&std::env::temp_dir()).is_err());
        assert!(t.register(Path::new("definitely-not-here.zip")).is_err());
    }

    #[test]
    fn a_file_that_shrinks_after_picking_gives_an_error_not_short_data() {
        let p = temp_file("shrink", &pattern(1000));
        let mut t = Picked::default();
        let f = t.register(&p).unwrap();
        let (file, size) = t.lookup(&f.id).unwrap();
        // The test truncates the file itself, which stands in for another program doing so.
        // (On Windows the open handle shares delete and write access with this second open.)
        let _ = std::fs::OpenOptions::new().write(true).open(&p).and_then(|f| f.set_len(10));
        let r = read_range(&file, size, 0, 1000);
        if std::fs::metadata(&p).map(|m| m.len()).unwrap_or(0) == 10 {
            assert!(r.is_err());
        }
        drop(file);
        t.close_all();
        std::fs::remove_file(&p).ok();
    }
}
