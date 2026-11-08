/**
 * Where the desktop app keeps its data, for Settings to show as text. The app (apps/app) puts the folder's path on the
 * platform object when it starts; the page never works it out and never opens it (there is no opener, no link). The
 * web build has none, so nothing is shown there. The path is the person's own and is shown only on their screen: it
 * is not part of the diagnostics and is never sent anywhere.
 */
import { platform } from "./platform.ts";
import type { Platform } from "./platform.ts";

/** The shell's addition to the platform object. Kept here until the shell's own file names it. */
export interface DataFolder {
  /** The folder that holds the sealed history, the theme and the web engine's files. */
  dataFolder?: string;
}

/** The data folder the desktop app named, or null in the web build and when the app named none. */
export function dataFolder(): string | null {
  const current: Platform & DataFolder = platform();
  const folder = current.dataFolder;
  return current.desktop !== undefined && typeof folder === "string" && folder.trim() !== "" ? folder : null;
}
