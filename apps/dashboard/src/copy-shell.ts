/**
 * The words of the app shell and the Settings page that copy.ts does not hold: the help and feedback group, the
 * keyboard shortcuts, and the saved-history card. copy.ts keeps the original strings, and this file holds what was
 * added with them. Same voice rules (docs/BRAND.md), same lint (test/copy-lint.test.ts reads every src/copy-*.ts
 * file). Text here never contains export values; views insert counts and dates with textContent.
 */

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

  // The header's theme toggle has one fixed name; whether it is on is said by the button's pressed state.
  themeToggleName: "Dark theme",

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
    version: "0.1.0-beta.2",
    lines: [
      "Snappy checks for updates when it opens. You can turn that off in Settings.",
      "The Use sample data button is now near the top of Start.",
      "Each license now opens from its name in Settings.",
    ],
  },
];
