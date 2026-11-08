/**
 * Stands in for the command line's folder reader inside the app's helper. The command line reads an export that a
 * browser unzipped (a folder) from disk; the app's helper only ever sees the ZIP files that were picked, so that code
 * would travel in the page without ever running. The build swaps this module in: it finds no data files in a folder
 * and refuses to read one. (The page reads a folder itself, in folder-import.ts, before any command runs.)
 */

/** Same shape as the real module's. A test pins that every name here also exists there. */
export async function findDataFiles(): Promise<{ path: string; base: string }[]> {
  return [];
}

export async function folderReader(): Promise<never> {
  throw new Error("Folders are not read here.");
}
