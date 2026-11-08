/**
 * The few things a native shell (the desktop app) can do differently from a plain browser page. The
 * web build leaves this empty and everything falls back to the browser: a file input, the page's
 * own import runner, a link to a Snapchat profile. A shell sets it once from its own entry file
 * (apps/app/src), before the dashboard starts. Nothing here can reach the network.
 */
import type { NamedBlob } from "./actions.ts";
import type { ImportRunner } from "./import-pipeline.ts";

export interface Platform {
  /**
   * Opens the system file dialog for zip parts and resolves to what the person picked: an empty
   * list for "cancelled", or null when the shell wants the page to use its own file input.
   */
  pickZips?(): Promise<NamedBlob[] | null>;
  /** Reads the parts. Replaces the background reader when the parts are not ordinary browser files. */
  runImport?: ImportRunner;
  /** Set only inside the desktop app: adds its note to the Privacy page. The value is the system the app runs on. */
  desktop?: "windows" | "macos" | "other";
  /** False hides the "Open in Snapchat" buttons. The default is to show them. */
  profileLinks?: boolean;
  /**
   * Set by an installed app that is a pre-release: its own version (it names the build in a bug report) and
   * whether it is a beta. The footer and Settings show them. The web build leaves this empty and shows neither.
   */
  release?: { version: string; beta: boolean };
}

let current: Platform = {};

export const setPlatform = (platform: Platform): void => {
  current = platform;
};

/** Read at the moment of use, never at load, so a change made after the page started is honored. */
export const platform = (): Platform => current;

/** The runner the page hands to its actions: the shell's reader when it set one, else `fallback`, chosen on every call. */
export const importRunner =
  (fallback: ImportRunner): ImportRunner =>
  (blobs, hooks) =>
    (current.runImport ?? fallback)(blobs, hooks);
