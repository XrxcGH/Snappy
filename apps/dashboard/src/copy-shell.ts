/**
 * The words of the app shell and the Settings page that copy.ts does not hold: the help and feedback group, the
 * keyboard shortcuts, and the saved-history card. copy.ts keeps the original strings, and this file holds what was
 * added with them. Same voice rules (docs/BRAND.md), same lint (test/copy-lint.test.ts reads every src/copy-*.ts
 * file). Text here never contains export values; views insert counts and dates with textContent.
 */

import { countOf } from "./format.ts";

export const shellCopy = {
  // Settings: help and feedback. The diagnostics hold the version, the system and counts, never names, files or dates.
  helpHeading: "Help and feedback",
  diagnosticsNote: "Diagnostics hold the version, your system and counts. They never hold usernames, file names or dates.",
  copyDiagnosticsButton: "Copy diagnostics",
  diagnosticsCopiedAnnounce: "Diagnostics copied.",
  reportNote: "To report a problem, open an issue at this address and paste the diagnostics. Never paste anything from your export.",
  repositoryLabel: "Repository address",
  copyAddressButton: "Copy address",
  addressCopiedAnnounce: "Address copied.",
  whatsNewHeading: "What’s new",

  /** The first words of the name of a license's scrolling text, which a keyboard can reach; the library's name follows. */
  licenseTextLabel: "License text for",

  /** The menu group that holds Memories rescue, which is not a list of people to review. */
  navMemories: "Memories",

  // The header's theme toggle has one fixed name; whether it is on is said by the button's pressed state.
  themeToggleName: "Dark theme",
  /** Said when Settings turns on "Match device"; the other two say "Dark theme on." and "Light theme on." (copy.ts). */
  themeMatchAnnounce: "Theme follows your device.",

  // Settings: the saved history as a list of exports, by date and friend count, never by name.
  historyHeading: "Saved history",
  historyNote: "Exports Snappy has read are listed by date, with a friend count and no names. Deleting one cannot be undone.",
  historyEmpty: "No exports are in your history yet. Add one on Start.",
  historyRow: (date: string, friends: number) => `${date}, ${countOf(friends, "friend", "friends")}`,
  historyDeleteButton: "Delete",
  historyDeleteFor: (date: string) => `Delete the export from ${date}`,
  historyConfirmNote: (date: string) => `Delete the export from ${date} from your history?`,
  historyConfirmButton: "Delete export",
  historyCancelButton: "Cancel",
  historyDeletedAnnounce: "Export deleted from your history.",

  // Settings, Saved data (desktop app only): where the data is, as text to copy. There is no link: the app cannot open folders.
  folderNote: "Snappy keeps its saved data and the web engine’s files in this folder.",
  copyFolderButton: "Copy folder path",
  folderCopiedAnnounce: "Folder path copied.",

  // Settings: the history as a file, locked with a passphrase, to keep or to move to another computer.
  fileHeading: "History file",
  fileNote: "Save your history to a file locked with a passphrase, or open one. The file uses the same format as the command line tool.",
  fileSaveHeading: "Save a file",
  fileSaveButton: "Save history file",
  fileSavedAnnounce: "History file saved.",
  fileSaveFailedNote: "Snappy could not save the file. Try again.",
  fileNothingNote: "Add an export first. There is nothing to save yet.",
  fileOpenHeading: "Open a file",
  fileChooseButton: "Choose history file",
  fileChosenNote: "A file is chosen. Enter its passphrase to open it.",
  fileOpenButton: "Open history file",
  fileCancelButton: "Cancel",
  fileOpenedAnnounce: "History file opened.",
  fileWrongNote: "That passphrase did not open the file, or it is not a Snappy history file.",
  fileUnreadableNote: "Snappy could not read that file. A different version may have made it.",
  fileTooBigNote: "That file is too big to be a Snappy history file.",

  // Keyboard shortcuts: the dialog, the buttons that open it, and the short status after "g".
  shortcutsTitle: "Keyboard shortcuts",
  showShortcutsButton: "Show shortcuts",
  closeShortcutsButton: "Close",
  shortcutsNote: "Shortcuts work when you are not typing in a field. Nothing is remembered.",
  shortcutShowList: "Show this list",
  shortcutSearch: "Jump to the search box",
  shortcutGoTo: (place: string) => `Go to ${place}`,
  /** Joins the two keys of a chord: g, then o. */
  unitThen: "then",
  goPendingStatus: "Go to…",
  goPendingAnnounce: "Go to. Press o, c, t, m, s or h.",
};

/**
 * What is new in each release, three short lines per version, newest first. Settings shows the entry for the version
 * that is running and nothing when there is none, so a stale list never describes the wrong build. The newest entry
 * is kept equal to the desktop app's version by test/diagnostics.test.ts.
 */
export const whatsNew: readonly { version: string; lines: readonly [string, string, string] }[] = [
  {
    version: "0.1.0-beta.3",
    lines: [
      "You can add an unzipped export folder, and import errors and status are clearer.",
      "Keyboard shortcuts are new, and the Tools list has a search box.",
      "Settings can copy diagnostics and save or open a history file.",
    ],
  },
  {
    version: "0.1.0-beta.2",
    lines: [
      "Snappy checks for updates when it opens. You can turn that off in Settings.",
      "The Use sample data button is now near the top of Start.",
      "Each license now opens from its name in Settings.",
    ],
  },
];
