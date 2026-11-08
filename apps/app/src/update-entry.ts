/**
 * Starts the update interface in the desktop app on Windows, the one system where the updater exists. Imported by the
 * desktop entry files after the dashboard has started; never by the web entry, so the web build has none of it.
 *
 * Outside the desktop shell (the page opened in a plain browser, or a test without the shell) the shell does not answer,
 * the interface finds nothing to show and stays out of the way.
 */
import { invoke } from "@tauri-apps/api/core";
import { desktopPlatform } from "./desktop-platform.ts";
import { createBridge, mountUpdates } from "./update-ui.ts";

if (desktopPlatform.desktop === "windows") {
  const start = (): void => void mountUpdates(createBridge(invoke));
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
}
