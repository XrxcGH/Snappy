/**
 * Words that only assistive technology hears in the desktop app's update interface: the name of the download bar, the one
 * line spoken when the download starts and again at the halfway point, and the names of buttons whose visible label needs
 * context. None of it appears on screen except through a screen reader, and each accessible name still contains the visible
 * label of its button.
 *
 * Kept apart from update-copy.ts, whose wording the owner approves (docs/UPDATES.md). Desktop entry only: the web build
 * never imports this file.
 */
export const updateA11yCopy = {
  /** The bar's name, and the static text spoken when the download banner appears. The percent is never part of it. */
  downloadingLive: "Downloading update",
  /** Spoken once, when the download passes the halfway point. */
  halfwayAnnounce: "Update is half downloaded.",
  /** The first-run notice's "Turn off" button: says what is turned off. The visible label stays inside the name. */
  turnOffName: "Turn off update checks",
} as const;
