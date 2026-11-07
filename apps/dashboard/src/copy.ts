/**
 * Every user-facing string. Voice rules live in docs/BRAND.md: sentence case, US English, plain
 * and calm, hedged ("may have removed you"), no exclamation marks, no emoji. Text here never
 * contains export values; views insert usernames and counts with textContent.
 */
import type { CandidateCategory, Confidence } from "@snappy-export/core";
import { countOf } from "./format.ts";

export const brand = {
  name: "Snappy",
  nonAffiliation:
    "Snappy is an independent tool. It is not affiliated with, endorsed by, or sponsored by Snap Inc. Snapchat is a trademark of Snap Inc.",
  privacyLine: "Your export stays on this device. Snappy reads friend names and dates, and skips messages, photos, and locations.",
  nothingLeft: "Nothing here has left your device.",
  basedOn: "Based on your exports, not on anything Snapchat told us.",
  inferenceNote: "Snapchat gives no signal when someone removes you. Snappy infers this from your exports, so every result shows how sure it is.",
  version: "0.1.0",
};

export interface RouteCopy {
  /** Nav label. */
  label: string;
  /** Page title and h1. */
  title: string;
}

export const routes = {
  start: { label: "Start", title: "Your export stays on this device" },
  overview: { label: "Overview", title: "Overview" },
  disappeared: { label: "Disappeared friends", title: "Disappeared friends" },
  requests: { label: "Requests no one accepted", title: "Requests no one accepted" },
  quiet: { label: "Quiet friends", title: "Quiet friends" },
  cleanup: { label: "Cleanup queue", title: "Cleanup queue" },
  memories: { label: "Memories rescue", title: "Memories rescue" },
  guide: { label: "Export guide", title: "Export guide" },
  privacy: { label: "Privacy", title: "Privacy" },
  settings: { label: "Settings", title: "Settings" },
} satisfies Record<string, RouteCopy>;

export type RouteId = keyof typeof routes;

export const shell = {
  skipLink: "Skip to main content",
  menu: "Menu",
  mainNav: "Main",
  sampleBanner: "It is made up and does not come from any account.",
  clearSample: "Clear sample data",
  sampleCleared: "Sample data cleared.",
  statusSession: "Session only: nothing is saved",
  statusLocked: "Saved data is locked",
  statusUnlocked: "Sealed on this device",
  lockNow: "Lock now",
  lockedShort: "Locked.",
  sampleLabel: "You are looking at sample data.",
};

export const common = {
  copy: "Copy",
  copyFailed: "Snappy could not copy. Select the text and copy it yourself.",
  copyUsername: (u: string) => `Copy username ${u}`,
  copiedUsername: (u: string) => `Copied ${u}`,
  openInSnapchat: "Open in Snapchat",
  // Starts with the visible label, so voice control ("click Open in Snapchat") still matches.
  openInSnapchatFor: (u: string) => `Open in Snapchat: ${u} (opens in a new tab)`,
  showMore: (n: number) => `Show ${n} more`,
  keep: "Keep",
  keepFor: (u: string) => `Keep ${u}`,
  kept: (u: string) => `Kept ${u}. This person is now protected from the queue.`,
  unkeep: "Stop keeping",
  unkeepFor: (u: string) => `Stop keeping ${u}`,
  unkept: (u: string) => `${u} is back in the queue.`,
  why: "Why this appears",
  confidenceWord: { high: "High", medium: "Medium", low: "Low" } satisfies Record<Confidence, string>,
  confidenceSuffix: "confidence",
  confidenceHint: {
    high: "Several signals agree. Still a guess, not a fact.",
    medium: "Some signals agree.",
    low: "Weak signal. Check before acting.",
  } satisfies Record<Confidence, string>,
  noticeLabels: { error: "Error", warning: "Warning", info: "Note", success: "Done" },
  code: "Code",
  protectedLabel: "Protected",
  addExport: "Add your export",
  addAnotherExport: "Add another export",
  openSettings: "Open settings",
  openGuide: "Open the export guide",
};

export const categories = {
  ghost: {
    label: "Disappeared friends",
    lead: "May have removed you",
  },
  "one-way": {
    label: "Requests no one accepted",
    lead: "Has not accepted your request",
  },
  dormant: {
    label: "Quiet friends",
    lead: "No recent chats or Snaps",
  },
} satisfies Record<CandidateCategory, { label: string; lead: string }>;

export const protection: Record<string, string> = {
  allowlist: "On your keep list",
  "recent-message": "You chatted or sent Snaps with them in the last 30 days",
};
export const protectionFallback = "Protected";

export const start = {
  promiseTitle: "Your export stays on this device",
  promiseLead:
    "Snappy finds friends who may have removed you, requests no one accepted, and quiet friends, and helps you rescue your Memories. It never removes anyone and never signs in to Snapchat.",
  promiseMore: "It reads only friend usernames and dates, and skips messages, photos, and locations. This page cannot connect to the internet, and nothing is uploaded, tracked, or counted.",
  privacyLink: "Read the privacy details",
  exportHeading: "1. Get your export from Snapchat",
  exportBody: "Request your data in Snapchat under Settings, then My Data. Snapchat prepares the export and emails you a link, which can take a while, so request it first. Three choices matter:",
  exportPoints: [
    "Select JSON files and User information. Snappy cannot read an HTML-only export.",
    "Choose All Time as the date range. A shorter range can make old friends look like they left.",
    "Chat history is optional, and so is Snap history. Snappy uses only who, when, which direction, and the kind (chat, photo, or video). It never reads the text or opens a photo or video.",
  ],
  exportGuideLink: "Open the export guide",
  countHeading: "2. Tell Snappy your friend count",
  countLabel: "How many friends do you have in Snapchat right now?",
  countHelp: "Optional. Snappy compares it with your export to catch a list that was cut off.",
  countError: "Enter a whole number from 0 to 100,000, or leave this empty.",
  addHeading: "3. Add your export",
  addBody:
    "Choose every ZIP part from Snapchat at once, in any order. Snappy puts them in order itself, reads them here, and never uploads them. The lists are in the part with no number at the end, such as mydata~1234567890123.zip. The numbered parts (-2, -3) hold photos and videos.",
  dropTitle: "Drop your ZIP files here",
  dropAlt: "or",
  choose: "Choose ZIP files",
  reading: (step: number, steps: number, fraction?: number | null) => {
    const done = fraction === undefined || fraction === null ? "" : `, ${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}% done`;
    if (steps <= 1) return `Reading your export${done}`;
    return step >= steps ? "Putting the parts together" : `Part ${step + 1} of ${steps}: reading${done}`;
  },
  readingSample: (step: number, steps: number) => `Building sample export ${Math.min(step + 1, steps)} of ${steps}`,
  progressLabel: "Reading progress",
  readingPercent: (fraction: number) => `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}% done`,
  skippedFiles: (n: number) =>
    `${n === 1 ? "1 file was" : `${n} files were`} skipped because ${n === 1 ? "it is" : "they are"} not ${n === 1 ? "a .zip file" : ".zip files"}. If ${n === 1 ? "it was" : "they were"} part of your export, download ${n === 1 ? "it" : "them"} again as .zip, because the parts that were read may be incomplete.`,
  laterPartsOnly:
    "These look like the numbered parts of an export (-2, -3), which hold photos and videos only. The lists Snappy needs are in part 1, the file with no number at the end. Choose that one too, and add all the parts together.",
  readDone: "Export read. Opening your overview.",
  readDoneShort: "Export read.",
  notAdded: "This export has no friends list, so it was not added to your history.",
  rejected: "Snappy did not use this export because it looks incomplete or damaged, so nothing was added to your history and no one is suggested for removal. Fix the problems below, then add it again.",
  notZip: "Snappy can only read ZIP files. Choose the .zip files from your Snapchat export.",
  readFailed: "Snappy could not read these files. Check that every part of the export finished downloading, then try again.",
  sampleHeading: "Or look around first",
  sampleBody: "Builds two made-up exports in your browser, 120 days apart, so you can see every screen. It is sample data and is never saved.",
  sampleButton: "Try with sample data",
  sampleLoaded: "Sample data loaded. Opening your overview.",
  unlockHeading: "Unlock your saved history",
  unlockBody: "Saved data on this device is sealed with a passphrase. Enter it to compare new exports with your earlier ones.",
  unlockButton: "Unlock",
  unlocking: "Unlocking",
  unlockedAnnounce: "Saved data unlocked.",
  unlockSkip: "You can also add an export now without unlocking. Snappy will merge it with your saved history when you unlock.",
  sessionOnlyTitle: "Session only",
  sessionOnlyBody:
    "Nothing is saved yet. Finding who has disappeared needs two exports made weeks apart, and when you close this tab your results are gone. To keep your history between exports, seal it with a passphrase in Settings before you add your export.",
  sessionOnlyAction: "Set a passphrase",
};

export const overview = {
  emptyTitle: "No export yet",
  emptyBody: "Add your Snapchat data export to see who has disappeared from your friends list, which requests no one accepted, and which friends have gone quiet.",
  emptyAction: "Add your export",
  healthHeading: "Export health",
  healthGood: "Snappy found no problems with your export.",
  healthIntro: (errors: number, warnings: number) => {
    const parts: string[] = [];
    if (errors > 0) parts.push(countOf(errors, "error", "errors"));
    if (warnings > 0) parts.push(countOf(warnings, "warning", "warnings"));
    return parts.length > 0 ? `Snappy found ${parts.join(" and ")}. Read these first: they can change the results.` : "Snappy has a few notes about your export.";
  },
  healthMemoriesHeading: "About your Memories",
  healthMemoriesNote: "These notes are about your Memories only. They do not change your friend results. The Memories page says what to do about them.",
  healthMemoriesLink: "Open Memories",
  healthFromLedger: "These results come from your saved history. Add your export to check its health and to see quiet friends and Memories.",
  schemaNote: "Snapchat has not published the exact layout of its export, so Snappy reads it tolerantly and reports anything unexpected here.",
  countsHeading: "In your export",
  friends: "Friends",
  sentRequests: "Requests you sent",
  snapshots: "Snapshots in your history",
  latestExport: (date: string) => `Latest export: ${date}`,
  findingsHeading: "Findings",
  oneSnapshot: "Add another export later to compare. Snappy needs two exports to see who has disappeared.",
  cardDisappeared: (n: number, canCompare: boolean) => (canCompare ? countOf(n, "person", "people") : "Add another export later to compare"),
  cardRequests: (n: number) => countOf(n, "request", "requests"),
  cardQuiet: (n: number, hasChats: boolean) => (hasChats ? countOf(n, "friend", "friends") : "Needs chat or Snap history"),
  cardQueue: (n: number, protectedCount: number) => `${countOf(n, "person", "people")} to review${protectedCount > 0 ? `, ${protectedCount} protected` : ""}`,
  cardMemories: (n: number) => countOf(n, "Memory", "Memories"),
  cardMemoriesNone: "No Memories in this export",
  open: "Open",
};

export const disappeared = {
  title: routes.disappeared.title,
  lead: "Friends who were in an earlier export and are missing from your newest one, and whom you did not remove yourself.",
  inference: `${brand.inferenceNote} A deleted or renamed account looks the same as a removal.`,
  noExportTitle: "No export yet",
  noExportBody: "Add your Snapchat data export to start your history. Then add another one in a few weeks: Snappy compares the two to see who has disappeared.",
  needTwoTitle: "Add another export later to compare",
  needTwoBody:
    "Snappy compares your friends list across exports. With one export there is nothing to compare yet. In a few weeks, request another export with the same date range (All Time) and add it here.",
  needTwoKeep: "Seal your history with a passphrase in Settings so the first export is still here when you come back.",
  noneTitle: "No one has disappeared",
  noneBody: "Everyone from your earlier exports is still in your newest one, or was removed by you.",
  changesHeading: "Since your previous export",
  changeDisappeared: "Disappeared",
  changeRemoved: "Removed by you",
  changeAdded: "New friends",
  changeAccepted: "Requests accepted",
  listHeading: "May have removed you",
  listCount: (n: number) => `${countOf(n, "person", "people")}, most likely first`,
};

export const requests = {
  title: routes.requests.title,
  lead: "People you sent a friend request to who have not accepted it, and who are not your friends, blocked, or removed by you.",
  inference: "Snapchat does not say why a request is still open. The person may not have seen it, or may have ignored it.",
  emptyTitle: "No unanswered requests found",
  emptyBody: "Either every request you sent was accepted, or your export has no list of sent requests. Check that you selected User information when you requested it.",
  noExportTitle: "No export yet",
  noExportBody: "Add your Snapchat data export to see requests no one accepted.",
  listCount: (n: number) => `${countOf(n, "request", "requests")}, most likely first`,
};

export const quiet = {
  title: routes.quiet.title,
  lead: "Current friends with no one-to-one chat or Snap, in either direction, for six months or more.",
  inference: "Snappy counts the chats saved in your export and your Snap history. You may have kept in touch in ways it cannot show, such as calls or chats that were not saved.",
  noChatsTitle: "Quiet friends needs chat or Snap history",
  noChatsBody:
    "Your export has no chat or Snap history, so Snappy has nothing to judge quiet friends by. Request a new export with Chat history selected. Snappy reads only who, when, which direction, and the kind, and never the text or the photos and videos.",
  noChatsLedger: "Chat and Snap history is not saved with your history. Add an export that includes it to see quiet friends.",
  emptyTitle: "No quiet friends found",
  emptyBody: "Everyone on your friends list has a chat or Snap from the last six months, or has been your friend for less time than that.",
  noExportTitle: "No export yet",
  noExportBody: "Add your Snapchat data export, with Chat history selected, to see quiet friends. Snap history counts too.",
  listCount: (n: number) => `${countOf(n, "friend", "friends")}, quietest first`,
};

export const cleanup = {
  title: routes.cleanup.title,
  lead: "Everyone Snappy found, merged into one list. Keep anyone who should stay, then remove the rest in Snapchat yourself.",
  note: "Snappy never removes anyone and never touches Snapchat. Snapchat removes friends one at a time, so this list is a checklist for you to work through.",
  protectedByChats: "Anyone you chatted with or sent a Snap to in the last 30 days is protected.",
  noChatProtection: (fromLedger: boolean) =>
    `${fromLedger ? "Chat and Snap history is not saved with your history, so" : "This export has no chat or Snap history that Snappy could read, so"} Snappy cannot tell whom you chatted with or sent a Snap to recently, and no one is protected for that reason. Check Snapchat before you remove anyone. Adding an export with Chat history and Snap history turns the protection on.`,
  emptyTitle: "Nothing to review yet",
  emptyBody: "The cleanup queue fills when Snappy finds disappeared friends, requests no one accepted, or quiet friends. Add your export to get started, and add another later to find disappeared friends.",
  nothingFound: "Snappy found no one to review in this export.",
  nothingFoundBody: "No disappeared friends, requests no one accepted, or quiet friends turned up. Add a newer export in a few weeks to check again.",
  filtersLabel: "Filter the list",
  categoryLabel: "Category",
  confidenceLabel: "Confidence",
  allCategories: "All categories",
  allConfidences: "All confidence levels",
  modeLabel: "View",
  modeReview: "Review",
  modeGuided: "Guided removal",
  summary: (shown: number, total: number) => (shown === total ? `${countOf(total, "person", "people")} to review` : `${shown} of ${countOf(total, "person", "people")} match your filters`),
  noMatch: "No one matches these filters. Change a filter to see more people.",
  saveList: "Save list",
  copyList: "Copy list",
  listHelp: "Save list downloads a CSV file. Copy list copies the usernames, one per line. If your browser blocks downloads here, use Copy list.",
  listSaved: "List saved.",
  listCopied: "List copied.",
  saveFailed: "Snappy could not save a file here. Use Copy list instead.",
  protectedHeading: (n: number) => `Protected from removal (${n})`,
  protectedBody: "Snappy keeps these people out of the list above: you chose to keep them, or you chatted or sent Snaps with them recently.",
  guidedHeading: "Guided removal",
  guidedNote: "Work through the list one person at a time. Open each profile in Snapchat, remove them there if you still want to, then check Done here. Snappy does not click anything in Snapchat for you.",
  done: "Done",
  doneFor: (u: string) => `Done with ${u}`,
  progressLabel: "Guided removal progress",
  progressText: (done: number, total: number) => `${done} of ${total} done`,
  clearChecks: "Clear checkmarks",
  checksCleared: "Checkmarks cleared.",
  removalWarning: "Removing a friend cannot be undone. To add them again, they must accept a new request, and any streak with them ends.",
  csvHeader: ["Username", "Category", "Confidence", "Why", "Profile link"],
  csvFile: "snappy-cleanup-list.csv",
};

export const memories = {
  title: routes.memories.title,
  lead: "What your export says about your Memories: how many, how much space they take, and how close you are to Snapchat's free storage cap.",
  noMediaNote: "Snappy reads the list of Memories and the names and saved times of the files in your ZIPs. It never opens a photo or video.",
  noExportTitle: "No export yet",
  ledgerOnlyTitle: "Memories are not saved",
  emptyTitle: "No Memories in this export",
  emptyBody: "Select Export your memories when you request your data. Then add the export here to see counts and the storage meter.",
  noExportBody: "Add your Snapchat data export to see your Memories counts and storage.",
  ledgerOnly: "Memories are not saved with your history. Add an export to see them.",
  countsHeading: "Counts",
  total: "Memories",
  images: "Photos",
  videos: "Videos",
  unknownType: "Other",
  dated: "With a capture date",
  duplicates: "Likely duplicates",
  duplicatesNote: "Found by comparing dates, types, and sizes. Snappy never compares picture content.",
  meterHeading: "Storage",
  capLabel: "Snapchat's free storage cap (as reported; may change)",
  capHelp: "Edit this if Snapchat changes the cap. Size is in GB.",
  capError: "Enter a number from 0.1 to 10,000.",
  capSet: "Storage cap updated.",
  capUpdate: "Update cap",
  copyCommand: "Copy command",
  commandCopied: "Command copied.",
  meterText: (used: string, cap: string, percent: string) => `${used} of ${cap} (${percent})`,
  meterLabel: "Known Memories size compared with the storage cap",
  unknownSizes: (n: number) => `${countOf(n, "Memory has", "Memories have")} no size in the export, so the total is a lower bound.`,
  noSizes: "The export does not list sizes for these Memories, so Snappy cannot measure storage here. The command-line tool can measure files as it saves them.",
  overCap: "The known size is already over the cap.",
  projection: (month: string) => `At your recent pace, you may reach the cap around ${month}.`,
  noProjection: "Snappy does not have enough dated, sized Memories to project a date.",
  pairingHeading: "Files in your export",
  pairingListed: "Saved Memories listed",
  pairingHave: "Have a file in your export",
  pairingMissing: "Not included",
  pairingSummary: (listed: number, have: number, missing: number) =>
    `${countOf(listed, "saved Memory", "saved Memories")} listed, ${have} ${have === 1 ? "has" : "have"} a file in your export, ${missing} ${missing === 1 ? "is" : "are"} not included.`,
  pairingOverlays: (n: number) => `${countOf(n, "caption or sticker overlay", "caption and sticker overlays")} found. They are kept with their photo or video.`,
  pairingWhyHeading: "Why some may be missing",
  pairingWhy: [
    "A part may be missing or may not have finished downloading. Check that you added every part. This is the most common reason, and it is quick to fix.",
    "Snapchat decides what goes into the ZIP parts. It may leave out Memories that it keeps only in the app, or that were saved after your export was prepared.",
    "Snappy matches a file to a Memory by its saved time, and it never guesses. A file it cannot match with certainty counts as not included.",
  ],
  pairingTodoHeading: "What you can do",
  pairingTodo: "For the Memories that are not included, save them from inside the Snapchat app, or request a new export and add every part of it here.",
  pairingNone: "No Memories files were found in the ZIP parts you added. If your export came in several parts, add all of them together, because the Memories files are in the numbered parts.",
  pairingLinksEmpty: "The download links in this export are empty. Snapchat now puts the files inside the ZIP parts instead, so there is nothing to download.",
  rescueHeading: "Rescue your files",
  rescueBody:
    "Memories exports can be many gigabytes, which browsers cannot handle well, so rescuing the files is done by the command-line tool on your computer. It takes the files out of your ZIPs, restores each file's exact capture time, removes duplicates, and sorts files into folders by month.",
  rescueCommandLabel: "Run this in a terminal, from the Snappy folder. Replace the two placeholders with the folder that holds all the parts of your export, and the folder where the rescued files should go:",
  rescueCommand: 'npm run snappy-export -- memories "<your export folder>" --out "<folder for rescued Memories>"',
  rescueNetwork: "Downloading from Snapchat's links is the only step that uses the network. The command-line tool does it only when you ask, and it has nothing to download from an export whose links are empty.",
};

export const guide = {
  title: routes.guide.title,
  lead: "Snappy reads only your own official export, on your own device. It never logs in to Snapchat and never uploads anything.",
  tickHeading: "What to select",
  optionHeader: "Option",
  tickHeader: "Select it?",
  whyHeader: "Why",
  rows: [
    ["Export your memories", "Yes, for Memories rescue", "A backup and capture-date restore. Media is treated as opaque files: Snappy never looks at it."],
    ["Export JSON files", "Yes, required", "Snappy reads JSON only. An HTML-only export is rejected."],
    ["User information", "Yes, required", "Holds your friends list: current, removed by you, blocked, and requests."],
    ["Chat history and Snap history", "Optional", "Used only as who, direction, type, and time, to protect friends you chat or Snap with and to flag long-quiet ones. Message text is never read or kept, and photos and videos are never opened."],
    ["Everything else", "No", "Spotlight, shopping, support, location, other media, and My AI are not used. Leaving them off keeps less sensitive data in the ZIP."],
  ] as const,
  rangeHeading: "Date range: All Time",
  rangeBody:
    "Choose All Time for everything. A shorter range might cut older friends out of the list, which would make them look like people who removed you. Use the same range every time you export so exports can be compared.",
  afterHeading: "After you request it",
  afterSteps: [
    "Snapchat prepares the export and emails you a link. Large exports may come as several ZIP parts. Download them all and keep the original names.",
    "Note your current friend count in Snapchat under Profile, then Friends. Snappy can warn you if the export's count differs.",
    "Do not send the files or their contents to anyone, including Snappy's developers.",
  ],
  shapeHeading: "Share the shape, never the contents",
  shapeBody:
    "If the export does not read correctly, you can print its structure: field names and bucketed counts, with anything unrecognized masked. Read the output before you share it.",
  shapeCommand: "npm run snappy-export -- inspect path/to/export-part1.zip",
  storingHeading: "Storing results",
  storingBody:
    "Snappy keeps a ledger of friends-list snapshots so it can spot people who disappeared between exports. It contains usernames, so seal it with a passphrase. Delete the original ZIP when you are done if you do not need it.",
  addLink: "Add your export",
};

export const privacy = {
  title: routes.privacy.title,
  lead: brand.privacyLine,
  readsHeading: "What Snappy reads",
  neverHeading: "What Snappy never reads",
  readsRows: [
    ["Friend usernames", "The one identifier Snappy keeps, because acting on a person needs a handle."],
    ["Dates on friends and requests", "When a friendship or request began, and when you removed someone."],
    ["Chat and Snap metadata", "Who, which direction, what kind (text, photo, video), and when. Never what was said, and never the photo or video."],
    ["Memories list", "How many, their dates, their types, and sizes if the export lists them."],
    ["File names and times inside the ZIPs", "System file names to find the right JSON files, and the saved time of each Memories file to match it to your Memories list. Photos and videos are not opened."],
  ] as const,
  neverRows: [
    ["Message text", "Never read, never kept."],
    ["Photos and videos", "Never opened, decoded, or compared."],
    ["Locations", "Never read or shown."],
    ["Display names", "Dropped when the file is read."],
    ["Group chat titles", "Replaced by an unreadable code."],
    ["Captions, bios, email, phone", "Never read."],
    ["Purchases, support, and My AI data", "Never read."],
  ] as const,
  whatHeader: "What",
  detailHeader: "Details",
  networkHeading: "Network status",
  networkOk: "No connections: enforced by this page's security policy.",
  networkUnknown: "Snappy could not confirm the security policy in this page. Open the page again from the build you trust.",
  networkDetail: "The policy below blocks every outbound connection, including from Snappy's own code. You can confirm it in your browser's developer tools, where the network tab stays empty.",
  workerHeading: "Reading large exports",
  workerBody:
    "A history can be hundreds of megabytes, so Snappy reads it in a background worker that the page starts from its own code (a blob: worker). The policy below allows that one kind of worker and nothing else: worker-src blob:. The worker inherits connect-src 'none', so it cannot connect anywhere either. If your browser does not allow it, Snappy reads on the page instead.",
  policyLabel: "Security policy in this page",
  sealHeading: "Sealed storage",
  sealBody: [
    "By default Snappy keeps results in memory only. Close the tab and they are gone.",
    "If you set a passphrase, Snappy saves your friends-list history and keep list in your browser as one encrypted blob. The passphrase turns into a key with PBKDF2 (600,000 rounds), and the blob is sealed with AES-256-GCM.",
    "Snappy never stores the passphrase. If you forget it, the saved data cannot be recovered. You can delete it and start over in Settings.",
  ],
  keepHeading: "What the saved blob holds",
  keepBody: "Usernames, dates, your keep list, and your guided-removal checkmarks. It does not hold chats, Snaps, Memories, or anything from the export that is not on this list.",
};

export const settings = {
  title: routes.settings.title,
  themeHeading: "Theme",
  themeLegend: "Color theme",
  themes: { system: "Match my device", light: "Light", dark: "Dark" },
  storageHeading: "Storage and passphrase",
  storageSession: "Session only: nothing is saved. Close this tab and your results are gone.",
  storageLocked: "Saved data is sealed and locked. Unlock it on the Start page.",
  storageUnlocked: "Your history is sealed on this device with your passphrase. Snappy does not store the passphrase.",
  storageUnsupported: "This browser does not allow saving here, so Snappy works in session-only mode.",
  passphraseLabel: "Passphrase",
  confirmLabel: "Repeat the passphrase",
  passphraseHelp: "Use 12 or more characters. A few random words works well. There are no rules about symbols.",
  setButton: "Seal with passphrase",
  changeButton: "Change passphrase",
  mismatch: "The two passphrases are different. Type them again.",
  tooShort: "Use at least 12 characters.",
  sealed: "Ledger sealed with your passphrase.",
  changed: "Passphrase changed.",
  lockedAnnounce: "Locked. Saved data is sealed and nothing is on screen.",
  lockHeading: "Lock now",
  lockBody: "Clears results from this page and keeps the sealed copy. You will need your passphrase to open it again.",
  deleteHeading: "Delete all data on this device",
  deleteBody: "Removes the sealed history and clears everything on screen. This cannot be undone.",
  deleteButton: "Delete all data",
  deleteConfirmTitle: "Delete everything Snappy saved on this device?",
  deleteConfirmBody: "The sealed history, your keep list, and your checkmarks will be gone for good. Your Snapchat export files are not touched.",
  deleteConfirm: "Yes, delete all data",
  deleteCancel: "Cancel",
  deleted: "All data deleted from this device.",
  deleteFailed: "Snappy could not delete the saved data. Close other Snappy tabs and try again.",
  aboutHeading: "About",
  aboutBody: "Snappy reads your own Snapchat export on your device and helps you tidy your friends list and rescue your Memories.",
  versionLabel: (v: string) => `Version ${v}`,
  licensesHeading: "Licenses",
  licensesBody: "Snappy ships three open fonts under the SIL Open Font License 1.1 and one MIT-licensed library. Full license files are in the licenses folder next to this page.",
};

export const passphraseHint = {
  short: "Too short. Use 12 or more characters.",
  weak: "Weak estimate. A longer phrase of several words is stronger.",
  fair: "Fair estimate.",
  good: "Good estimate.",
  strong: "Strong estimate.",
  empty: "Use 12 or more characters. Snappy never stores it.",
  label: "Strength estimate",
};

export const vaultMessages = {
  wrongPassphrase: "That passphrase did not open your saved data. Check it and try again.",
  unreadable: "Snappy could not read the saved data. It may have been saved by a different version.",
  storageUnavailable: "This browser does not allow saving here, so Snappy is working in session-only mode.",
  saveFailed: "Snappy could not save to this browser. Your results are still on screen, but they will be gone when you close this tab.",
  lockedFirst: "Unlock your saved data first, or delete it in Settings to start over.",
  nothingSaved: "No saved data was found on this device.",
  savedElsewhere: "Saved data already exists on this device, perhaps from another tab. Unlock it first, or delete it in Settings to start over.",
};
