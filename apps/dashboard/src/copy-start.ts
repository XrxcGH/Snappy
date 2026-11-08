/**
 * The words of the import flow on the Start page that copy.ts does not hold: copy.ts keeps the original
 * strings (the words track owns them), and this file holds what the import flow added. Same voice rules
 * (docs/BRAND.md), same lint (test/copy-lint.test.ts reads every src/copy-*.ts file). Text here never
 * contains export values: file names and counts are inserted by the code, as digits or numbers only.
 */

import { platform } from "./platform.ts";

export const startFlow = {
  /** Names the block that holds the progress or the problem of an import, for a screen reader. */
  statusLabel: "Import status",

  // Stopping an import, and a read that takes a while. Time is shown as it passes, never as a guess of what is left.
  cancelButton: "Cancel",
  stopped: "Stopped. Nothing was added.",
  slowHint: "Large exports can take a few minutes.",
  elapsed: (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")} elapsed`,
  busy: "Wait for the current step to finish.",

  // A folder or JSON files were chosen: a browser unzipped the download (Safari does, unless its "Open safe files" setting is off).
  unzipped: "This looks like an unzipped export, so choose the ZIP files instead. If your browser opened them for you, turn off “Open safe files after downloading” and download them again.",

  // For someone who comes back to Start with exports already read.
  latestLine: (date: string, count: number) => `Latest export: ${date}. ${count === 1 ? "1 export read." : `${count} exports read.`}`,
  openOverview: "Open overview",
  addNewerHeading: "Add a newer export",

  // The chip of a command block when its files are the export that was read on Start.
  filesFromStart: (n: number) => (n === 1 ? "1 file from Start" : `${n} files from Start`),

  // The row in the Start intro for someone with no export yet, before the sample button.
  noExportYet: "No export yet? You can look around first.",

  // Said on Start after a reload cleared the results of an export that was not saved.
  get reloaded(): string {
    return platform().desktop === undefined ? "Your results were cleared when this page reloaded." : "Your results were cleared when the app reloaded.";
  },

  // Files dragged over the page: what a drop will do.
  dropOverlayTitle: "Drop your ZIP files to add them",

  // An unzipped folder read directly (a browser's folder chooser, or a folder dropped on the drop zone).
  chooseFolder: "Choose a folder",
  folderHint: "Browser unzipped it? Choose its folder instead.",
  folderEmpty: "Snappy found no export files in that folder. Choose the folder that holds the json folder, or choose the ZIP files.",
  folderNoMedia: "This export was read from an unzipped folder, so it has no photos or videos. To rescue Memories, choose the ZIP files.",

  // An export refused only because its friends list is empty although removed friends are listed: the person may go on.
  useAnyway: "Use anyway",

  // Parts of two exports. The numbers are the digits after "mydata~" in the file names, nothing else of a name.
  mixedExports: (first: string, second: string) => `These ZIP files come from two different exports, ${first} and ${second}. Choose the parts of one export.`,
};
