/**
 * Every word of the update interface in the desktop app. It lives in the desktop entry only: the web build never contains
 * these strings (a test checks the built web page for them). Sentence case, American English, one short line each.
 *
 * AWAITING THE OWNER'S APPROVAL: the Privacy block, the Settings note and the first-run notice (see docs/UPDATES.md and
 * docs/RELEASES.md). The other lines are interface wording that follows from the design.
 */
export const updateCopy = {
  // Banner
  availableBanner: (version: string): string => `Snappy ${version} is available.`,
  updateNowButton: "Update now",
  laterButton: "Later",
  downloadingBanner: (percent: number): string => {
    if (!Number.isInteger(percent)) throw new RangeError("a percent is a whole number");
    return `Downloading… ${percent}%`;
  },
  readyBanner: "Update ready. Restart to finish.",
  restartNowButton: "Restart now",
  cautionNote: "Restarting closes Snappy. Results aren’t saved unless history is saved.",
  countdownBanner: "Updating now.",
  cancelButton: "Cancel",
  installingBanner: "Updating now.",
  failedBanner: "Couldn’t update. Try again.",
  unsupportedNote: "This copy can’t update itself.",
  getFromGitHubButton: "Download from GitHub",
  updatedToBanner: (version: string): string => `Updated to ${version}.`,
  busyNote: "Finish what you are doing first.",

  // First-run notice
  firstRunNotice: "Snappy checks GitHub for updates when it opens. Change this in Settings.",
  noticeOkButton: "OK",
  noticeTurnOffButton: "Turn off",

  // Settings card
  cardHeading: "Updates",
  versionLabel: (version: string): string => `Version ${version}`,
  checkNowButton: "Check now",
  checkingLabel: "Checking…",
  toggleLabel: "Check for updates on launch",
  lastChecked: (when: string): string => `Last checked ${when}`,
  neverChecked: "Not checked yet",
  cardNote: "Asks github.com for the newest version. Sends no ID and none of your data.",
  upToDateNote: "You’re up to date.",
  unreachableNote: "Can’t reach GitHub.",
  couldNotCheckNote: "Couldn’t check. Try again.",

  // Privacy page block
  privacyHeading: "Update check",
  privacyBody:
    "When Snappy opens, it asks github.com for a small file that names the newest version. If there is a newer one, it downloads it from GitHub. The request has no ID, no version and none of your data. GitHub can see your IP address, the time, and that a Snappy app asked. This is the only connection Snappy itself makes. Your data never leaves your device. You can turn this off in Settings.",
} as const;
