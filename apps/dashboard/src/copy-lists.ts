/**
 * The words of the finding lists, the Cleanup queue, the Overview and the Memories page that copy.ts does not
 * hold: copy.ts keeps the original strings, and this file holds what was added with them. Same voice rules
 * (docs/BRAND.md), same lint (test/copy-lint.test.ts reads every src/copy-*.ts file). Text here never
 * contains export values; views insert usernames and counts with textContent.
 */

export const lists = {
  // Guided removal where there is no profile link to open (the desktop app, and the sample data).
  copyUsernameButton: "Copy username",
  guidedNoteNoLinks: "Go one person at a time. Copy each username, find them in Snapchat, remove them if you want, then mark Done.",

  // The toast after Keep. The sentence for one person is common.kept; a second Keep in the same eight seconds counts up.
  toastLabel: "Keep list update",
  undoButton: "Undo",
  keptCount: (n: number) => `${n} kept.`,
  /** The queue's summary line, with how many people are on the keep list: "43 people to review, 1 kept". */
  summaryKept: (summary: string, kept: number) => `${summary}, ${kept} kept`,

  // Memories rescue, in the desktop app, where Run holds only a small test.
  rescueLimitNote: (mb: number) => `Run copies a small test here, up to ${mb} MB. A full rescue needs the command line tool.`,
  rescueGuideLine: "The guide says how to get it.",
};
