/**
 * FALLBACK entry point of the desktop build, chosen at build time with
 * `SNAPPY_READER=native` (see scripts/build-frontend.mjs). Use it only on a platform whose file
 * input cannot random-access a multi-gigabyte file. It tells the dashboard to pick zips through
 * the shell's own dialog and to read them with the shell's read-only `read_range` command.
 */
import { invoke } from "@tauri-apps/api/core";
import { desktopPlatform } from "./desktop-platform.ts"; // sets the platform; must come before the dashboard starts
import { setPlatform } from "../../dashboard/src/platform.ts";
import "../../dashboard/src/main.ts"; // starts the dashboard when loaded
import { nativeImport } from "./native-import.ts";
import { nativeZip } from "./native-zip.ts";
import type { PickedFile } from "./ipc-reader.ts";

// The dashboard reads the platform when it is used, not while it boots, so adding the reader after the import is fine.
setPlatform({
  ...desktopPlatform,
  async pickZips() {
    const picked = (await invoke("pick_zips")) as PickedFile[];
    return picked.map((file) => nativeZip(file, invoke));
  },
  runImport: nativeImport,
});
