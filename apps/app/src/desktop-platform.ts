/**
 * What the desktop app tells the dashboard about itself (see apps/dashboard/src/platform.ts): it is the
 * desktop app, which adds its note to the Privacy page and switches the wording that talks about a browser,
 * a tab or an npm script; it shows no "Open in Snapchat" buttons, because the window may only ever show
 * Snappy's own page and an address would go nowhere; and it names its own version (and Beta, for a beta).
 *
 * It sets the platform when it is loaded, so an entry file imports it BEFORE the dashboard starts.
 */
import { setPlatform } from "../../dashboard/src/platform.ts";
import type { Platform } from "../../dashboard/src/platform.ts";
import pkg from "../package.json" with { type: "json" };

/** "windows" (WebView2) and "macos" (the system WebKit web view) are the two systems whose web engine has been looked at; "other" is Linux. */
export const desktopKind = (userAgent: string): "windows" | "macos" | "other" => (/\bWindows\b/.test(userAgent) ? "windows" : /\bMacintosh\b|\bMac OS X\b/.test(userAgent) ? "macos" : "other");

/** The app's own version (it matches tauri.conf.json and Cargo.toml, which a test checks). A pre-release such as 0.1.0-beta.3 is a beta. */
export const releaseOf = (version: string): { version: string; beta: boolean } => ({ version, beta: /-beta(\.|$)/.test(version) });

export const desktopPlatform: Platform = {
  desktop: desktopKind(typeof navigator === "undefined" ? "" : navigator.userAgent),
  profileLinks: false,
  release: releaseOf(pkg.version),
};

setPlatform(desktopPlatform);
