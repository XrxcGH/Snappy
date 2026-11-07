/**
 * What the desktop app tells the dashboard about itself (see apps/dashboard/src/platform.ts): it is the
 * desktop app, which adds its note to the Privacy page, and it shows no "Open in Snapchat" buttons,
 * because the window may only ever show Snappy's own page and an address would go nowhere.
 *
 * It sets the platform when it is loaded, so an entry file imports it BEFORE the dashboard starts.
 */
import { setPlatform } from "../../dashboard/src/platform.ts";
import type { Platform } from "../../dashboard/src/platform.ts";

/** "windows" for the one system whose web engine was tested (WebView2), "other" for macOS and Linux. */
export const desktopKind = (userAgent: string): "windows" | "other" => (/\bWindows\b/.test(userAgent) ? "windows" : "other");

export const desktopPlatform: Platform = {
  desktop: desktopKind(typeof navigator === "undefined" ? "" : navigator.userAgent),
  profileLinks: false,
};

setPlatform(desktopPlatform);
