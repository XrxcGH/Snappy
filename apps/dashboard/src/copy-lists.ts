/**
 * The words of the finding lists, the Cleanup queue, the Overview and the Memories page that copy.ts does not
 * hold: copy.ts keeps the original strings, and this file holds what was added with them. Same voice rules
 * (docs/BRAND.md), same lint (test/copy-lint.test.ts reads every src/copy-*.ts file). Text here never
 * contains export values; views insert usernames and counts with textContent.
 */

import { formatCount } from "./format.ts";

export const lists = {
  // Guided removal where there is no profile link to open (the desktop app, and the sample data).
  copyUsernameButton: "Copy username",
  guidedNoteNoLinks: "Go one person at a time. Copy each username, find them in Snapchat, remove them if you want, then mark Done.",

  // The toast after Keep. The sentence for one person is common.kept; a second Keep in the same eight seconds counts up.
  toastLabel: "Keep list update",
  undoButton: "Undo",
  keptCount: (n: number) => `${formatCount(n)} people are on your keep list.`,
  /** The queue's summary line, with how many people are on the keep list: "43 people to review, 1 kept". */
  summaryKept: (summary: string, kept: number) => `${summary}, ${kept} kept`,

  // Search and sort. The typed text is a piece of a username: it is never put in the address, the title or storage.
  searchLabel: "Search usernames",
  searchPlaceholder: "Part of a name",
  searchClearButton: "Clear",
  searchClearAria: "Clear search",
  matchCount: (shown: number, total: number) => `${formatCount(shown)} of ${formatCount(total)} match`,
  noMatchSearch: "No one matches. Clear the search to see more.",
  sortLabel: "Sort",
  sortOptions: { likely: "Most likely", newest: "Newest signal", oldest: "Oldest signal", confidence: "Confidence" },
  // Said under the count while Newest signal or Oldest signal is chosen: the date they go by is not on the row.
  sortNote: "Sorted by the latest dated signal for each person. Rows with none come last.",
  clearFiltersButton: "Clear filters",

  // The spreadsheet file each finding list saves, by the list's key ("ghost" is Disappeared friends, "one-way" Unaccepted requests, "dormant" Quiet friends).
  areas: { ghost: { csvFile: "snappy-disappeared.csv" }, "one-way": { csvFile: "snappy-requests.csv" }, dormant: { csvFile: "snappy-quiet.csv" } },

  // The keep list as a list: people you chose to keep, added by username or removed one by one.
  keepHeading: (n: number) => `Keep list (${n})`,
  keepBody: "Anyone on your keep list is left out of the queue. Add a username to protect someone in advance.",
  keepAddLabel: "Add a username",
  keepAddButton: "Add username",
  keepAddError: "Enter one username, with no spaces.",
  keepAddTooLong: "That username is too long.",
  keepAlready: (u: string) => `${u} is already on your keep list.`,
  keepRemoveButton: "Remove",
  keepRemoveFor: (u: string) => `Remove ${u} from your keep list`,
  keepRemoved: (u: string) => `${u} is off your keep list.`,
  keepEmpty: "No one is on your keep list yet.",

  // What confidence means, said once on each list page. The longer hint for each level is inside "Why this appears".
  confidenceKey: "Confidence is how many signals agree. It is a guess.",

  // The Overview when the results come from the saved history and no export is loaded: Memories are not saved with it.
  cardMemoriesLedger: "Not saved with your history",
  countsHeadingLedger: "In your saved history",

  // Overview: what to do next, and a summary of the counts to copy. The summary holds counts only, never a username.
  nextHeading: "Next steps",
  nextCleanup: "Start with the Cleanup queue",
  nextBackup: "Back up your friends",
  nextReminder: "Make an export reminder",
  nextOnThisDay: "Find Memories from this day",
  copySummaryButton: "Copy summary",
  summaryNote: "The summary holds counts only, never usernames.",
  summaryCopied: "Summary copied.",
  summaryDisappeared: (n: number) => `${formatCount(n)} may have removed me`,
  summaryRequests: (n: number) => `${formatCount(n)} unaccepted ${n === 1 ? "request" : "requests"}`,
  summaryQuiet: (n: number) => `${formatCount(n)} quiet`,
  summaryQueue: (n: number) => `${formatCount(n)} to review`,

  // A long list: a link, shown when it has keyboard focus, that jumps past the rows. The end mark is read by screen readers only.
  skipToEnd: "Skip to end of list",
  endOfList: "End of list",

  // Related tools at the end of a page, and the Tools card on the Overview.
  relatedLabel: "Related tools",
  relatedBackupNote: "Back up your friends before you remove anyone.",
  toolsHeading: "Tools",
  toolsCardText: (n: number) => `${n} small helpers that read your export.`,
  // The warning above the Cleanup rows: short enough for one line in a notice at the page's text width.
  removalNote: "Removing a friend cannot be undone. Any streak ends.",
  // The command that finds the same people without saving anything, shown under the queue.
  previewNote: "A search of the latest export that saves nothing to your history.",

  // Memories rescue, in the desktop app, where Run holds only a small test.
  rescueLimitNote: (mb: number) => `Run copies a small test here, up to ${mb} MB. A full rescue needs the command line tool.`,
  rescueGuideLine: "The guide says how to get it.",
};
