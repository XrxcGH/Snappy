/**
 * The words of the import flow on the Start page that copy.ts does not hold: copy.ts keeps the original
 * strings (the words track owns them), and this file holds what the import flow added. Same voice rules
 * (docs/BRAND.md), same lint (test/copy-lint.test.ts reads every src/copy-*.ts file). Text here never
 * contains export values: file names and counts are inserted by the code, as digits or numbers only.
 */

export const startFlow = {
  /** Names the block that holds the progress or the problem of an import, for a screen reader. */
  statusLabel: "Import status",

  // Stopping an import, and a read that takes a while. Time is shown as it passes, never as a guess of what is left.
  cancelButton: "Cancel",
  stopped: "Stopped. Nothing was added.",
  slowHint: "Large exports can take a few minutes.",
  elapsed: (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")} elapsed`,
  busy: "Wait for the current step to finish.",

  // Parts of two exports. The numbers are the digits after "mydata~" in the file names, nothing else of a name.
  mixedExports: (first: string, second: string) => `These ZIP files come from two different exports, ${first} and ${second}. Choose the parts of one export.`,
};
