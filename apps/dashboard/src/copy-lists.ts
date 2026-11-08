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

  // Search and sort. The typed text is a piece of a username: it is never put in the address, the title or storage.
  searchLabel: "Search usernames",
  searchPlaceholder: "Type part of a name",
  searchClearButton: "Clear",
  searchClearAria: "Clear search",
  matchCount: (shown: number, total: number) => `${shown} of ${total} match`,
  noMatchSearch: "No one matches. Clear the search to see more.",
  sortLabel: "Sort",
  sortOptions: { likely: "Most likely first", newest: "Newest first", oldest: "Oldest first", confidence: "Highest confidence" },
  clearFiltersButton: "Clear filters",

  // The spreadsheet file each finding list saves, by the list's key ("ghost" is Disappeared friends, "one-way" Unaccepted requests, "dormant" Quiet friends).
  areas: { ghost: { csvFile: "snappy-disappeared.csv" }, "one-way": { csvFile: "snappy-requests.csv" }, dormant: { csvFile: "snappy-quiet.csv" } },

  // The keep list as a list: people you chose to keep, added by username or removed one by one.
  keepHeading: (n: number) => `Keep list (${n})`,
  keepBody: "Anyone on your keep list is left out of the queue. Add a username to protect someone in advance.",
  keepAddLabel: "Add a username",
  keepAddButton: "Add username",
  keepAddError: "Enter one username, with no spaces.",
  keepAlready: (u: string) => `${u} is already on your keep list.`,
  keepRemoveButton: "Remove",
  keepRemoveFor: (u: string) => `Remove ${u} from your keep list`,
  keepRemoved: (u: string) => `${u} is off your keep list.`,
  keepEmpty: "No one is on your keep list yet.",

  // Memories rescue, in the desktop app, where Run holds only a small test.
  rescueLimitNote: (mb: number) => `Run copies a small test here, up to ${mb} MB. A full rescue needs the command line tool.`,
  rescueGuideLine: "The guide says how to get it.",
};
