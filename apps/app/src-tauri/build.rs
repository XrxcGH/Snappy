fn main() {
    // The page may call exactly these commands (and only if the capability lists them): three
    // read-only ones for the native reader and the update commands. Declaring them in the app
    // manifest puts them under Tauri's permission system; without it every command would be
    // callable from every page the window ever shows.
    let app = tauri_build::AppManifest::new().commands(&["pick_zips", "read_range", "close_file", "update_status"]);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(app)).expect("tauri build script failed");
}
