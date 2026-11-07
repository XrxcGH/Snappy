/**
 * Every user-facing string. Voice rules live in docs/BRAND.md: sentence case, US English, plain
 * and calm, hedged ("may have removed you"), no exclamation marks, no emoji. Text here never
 * contains export values; views insert usernames and counts with textContent.
 *
 * Length rules, checked by test/copy-quality.test.ts and test/copy-lint.test.ts: menu labels fit on
 * one line (20 characters or fewer), buttons are a verb plus a short noun, a note is one or two short
 * sentences (about 20 words), and apostrophes and quotes are curly in prose and straight only in code
 * samples.
 *
 * Words used for one thing each: "keep list" (people you chose to keep), "saved history" (what a
 * passphrase seals), "seal" (the action), "lock" (close the saved history for now), "this device".
 */
import type { CandidateCategory, Confidence } from "@snappy-export/core";
import { countOf } from "./format.ts";

export const brand = {
  name: "Snappy",
  nonAffiliation:
    "Snappy is an independent tool. It is not affiliated with, endorsed by, or sponsored by Snap Inc. Snapchat is a trademark of Snap Inc.",
  privacyLine: "Your export stays on this device. Snappy reads friend names and dates, and skips messages, photos, and locations.",
  nothingLeft: "Nothing here has left this device.",
  basedOn: "Based on your exports, not on anything Snapchat told Snappy.",
  version: "0.1.0",
};

/**
 * The one sentence about the theme choice, shown on Settings and on Privacy. It says exactly where the choice
 * lives: one setting in this browser, kept apart from your history (which is sealed and encrypted).
 */
export const themeNote = "Your theme choice is remembered in this browser, apart from your history.";

export interface RouteCopy {
  /** Nav label. One line in the sidebar and the phone menu. */
  label: string;
  /** Page title and h1. The same words as the label. */
  title: string;
}

export const routes = {
  start: { label: "Start", title: "Start" },
  overview: { label: "Overview", title: "Overview" },
  disappeared: { label: "Disappeared friends", title: "Disappeared friends" },
  requests: { label: "Unaccepted requests", title: "Unaccepted requests" },
  quiet: { label: "Quiet friends", title: "Quiet friends" },
  cleanup: { label: "Cleanup queue", title: "Cleanup queue" },
  memories: { label: "Memories rescue", title: "Memories rescue" },
  tools: { label: "Tools", title: "Tools" },
  guide: { label: "Export guide", title: "Export guide" },
  privacy: { label: "Privacy", title: "Privacy" },
  settings: { label: "Settings", title: "Settings" },
} satisfies Record<string, RouteCopy>;

export type RouteId = keyof typeof routes;

export const shell = {
  skipLink: "Skip to main content",
  menu: "Menu",
  mainNav: "Main",
  /** The strip shows the short words on phones, so it stays one row. */
  sampleStrip: "Sample data, not from an account.",
  sampleStripShort: "Sample data",
  clearSample: "Clear sample data",
  clearSampleShort: "Clear",
  sampleCleared: "Sample data cleared.",
  sealedOn: "Sealed history on",
  lockNow: "Lock now",
  lockedShort: "Locked.",
  /** Shown in the footer of an installed beta only, so a bug report can name the build. */
  betaLine: (version: string) => `Beta version ${version}`,
  navFindings: "Findings",
  navMore: "More",
  themeToLight: "Switch to light theme",
  themeToDark: "Switch to dark theme",
  themeChangedDark: "Dark theme on.",
  themeChangedLight: "Light theme on.",
};

export const common = {
  copy: "Copy",
  copyFailed: "Snappy could not copy. Select the text and copy it yourself.",
  copyUsername: (u: string) => `Copy username ${u}`,
  copiedUsername: (u: string) => `Copied ${u}`,
  openInSnapchat: "Open profile",
  // Starts with the visible label, so voice control ("click Open profile") still matches.
  openInSnapchatFor: (u: string) => `Open profile: ${u} (opens Snapchat in a new tab)`,
  showMore: (n: number) => `Show ${n} more`,
  /** The name of a table that scrolls sideways, read by a screen reader when the table takes focus. */
  scrollTableFor: (caption: string) => `${caption}, scrolls sideways`,
  showing: (shown: string, total: string) => `Showing ${shown} of ${total}`,
  keep: "Keep friend",
  keepFor: (u: string) => `Keep friend ${u}`,
  kept: (u: string) => `${u} is on your keep list.`,
  unkeep: "Undo keep",
  unkeepFor: (u: string) => `Undo keep for ${u}`,
  unkept: (u: string) => `${u} is back in the queue.`,
  why: "Why this appears",
  confidenceWord: { high: "High", medium: "Medium", low: "Low" } satisfies Record<Confidence, string>,
  confidenceSuffix: "confidence",
  confidenceHint: {
    high: "Several signals agree. Still a guess, not a fact.",
    medium: "Some signals agree. Still a guess.",
    low: "Weak signal. Check before acting.",
  } satisfies Record<Confidence, string>,
  /** Read aloud before a notice. Never shown, because the icon already says the kind. */
  noticeLabels: { error: "Error", warning: "Warning", info: "Note", success: "Done" },
  details: "Details",
  code: "Code",
  protectedLabel: "Protected",
  /** Shown where a tile has no number yet, so its rows still line up. Decorative; the words beside it say why. */
  noFigure: "–",
  addExport: "Add export",
  openSettings: "Open settings",
  openGuide: "Open guide",
  stepPrefix: (n: number) => `Step ${n}: `,
};

export const categories = {
  ghost: {
    label: "Disappeared friends",
    lead: "May have removed you",
  },
  "one-way": {
    label: "Unaccepted requests",
    lead: "Has not accepted your request",
  },
  dormant: {
    label: "Quiet friends",
    lead: "No recent chats or Snaps",
  },
} satisfies Record<CandidateCategory, { label: string; lead: string }>;

export const protection: Record<string, string> = {
  allowlist: "On your keep list",
  "recent-message": "Recent chat or Snap",
};

export const start = {
  promiseLead: "Sort your Snapchat friend list and Memories from your own data export.",
  trustChips: ["Stays on this device", "Reads names and dates only", "Works without internet"] as const,
  exportHeading: "Get your export from Snapchat",
  exportBody: "In Snapchat, open Settings, then My Data, and request your data. Snapchat emails you a link.",
  exportPoints: [
    "Select JSON files and User information.",
    "Set the date range to “All Time”.",
    "Chat and Snap history is optional. It lets Snappy find quiet friends.",
  ],
  countHeading: "Add your friend count",
  countLabel: "How many friends do you have in Snapchat now?",
  countPlaceholder: "For example, 150",
  countHelp: "Optional. Snappy uses it to spot a list that was cut off.",
  countError: "Use a whole number from 0 to 100,000, or leave it empty.",
  addHeading: "Add your export",
  addBody: "Choose all ZIP parts at once, in any order. Snappy reads them here and never uploads them.",
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
  skippedFiles: (n: number) => `${n === 1 ? "1 file was skipped because it is not a ZIP file." : `${n} files were skipped because they are not ZIP files.`} Your results may be incomplete.`,
  laterPartsOnly: "These are numbered parts, which hold photos and videos. Add part 1, the file with no number.",
  readDone: "Export read. Opening your overview.",
  readDoneShort: "Export read.",
  notAdded: "This export has no friends list, so it was not added to your history.",
  rejected: "Snappy did not use this export because it looks incomplete. Check the notes below, then download it again.",
  notZip: "Snappy can only read ZIP files. Choose the ZIP files from your Snapchat export.",
  readFailed: "Snappy could not read these files. Check that every part finished downloading, then try again.",
  exportTimeFuture: "This export’s date is in the future, so Snappy used today’s date instead.",
  exportTimeUnknown: "Snappy could not tell when this export was made, so it used today’s date.",
  sampleHeading: "Try sample data",
  sampleBody: "Builds two made-up exports in your browser so you can see every screen. The sample is never saved.",
  sampleButton: "Use sample data",
  sampleLoaded: "Sample data loaded. Opening your overview.",
  unlockHeading: "Unlock your saved history",
  unlockBody: "Your saved history is sealed with a passphrase. Enter it to compare new exports with old ones.",
  unlockButton: "Unlock",
  unlocking: "Unlocking",
  unlockedAnnounce: "Saved data unlocked.",
  unlockSkip: "You can add an export without unlocking. Snappy merges it with your history when you unlock.",
  sessionOnlyTitle: "Results not saved",
  sessionOnlyBody: "Closing this tab clears your results. To keep your history, seal it with a passphrase in Settings.",
  sessionOnlyAction: "Set passphrase",
};

export const overview = {
  emptyTitle: "No export yet",
  emptyBody: "Add your export to see who has disappeared, which requests were not accepted, and who is quiet.",
  emptyAction: "Add export",
  healthHeading: "Export health",
  healthGood: "Snappy found no problems with your export.",
  healthIntro: (errors: number, warnings: number) => {
    const parts: string[] = [];
    if (errors > 0) parts.push(countOf(errors, "error", "errors"));
    if (warnings > 0) parts.push(countOf(warnings, "warning", "warnings"));
    return parts.length > 0 ? `Snappy found ${parts.join(" and ")}. These can change your results.` : "Snappy has a few notes about your export.";
  },
  healthMemoriesHeading: "About your Memories",
  healthMemoriesNote: "These notes do not change your friend results. The Memories page says what to do.",
  healthMemoriesLink: "Open Memories",
  healthFromLedger: "These results come from your saved history. Add an export to check its health.",
  schemaNote: "Snapchat does not publish its export layout, so Snappy reports anything unexpected here.",
  countsHeading: "In your export",
  friends: "Friends",
  sentRequests: "Requests sent",
  snapshots: "Exports read",
  latestExport: (date: string) => `Latest export: ${date}`,
  cardMemoriesNone: "No Memories in this export",
  unitDisappeared: (n: number) => (n === 1 ? "person who may have removed you" : "people who may have removed you"),
  unitRequests: (n: number) => (n === 1 ? "request not accepted" : "requests not accepted"),
  unitQuiet: (n: number) => (n === 1 ? "friend with no recent chats or Snaps" : "friends with no recent chats or Snaps"),
  unitQueue: (n: number) => (n === 1 ? "person to review" : "people to review"),
  unitMemories: (n: number) => (n === 1 ? "Memory in your export" : "Memories in your export"),
  protectedNote: (n: number) => `${countOf(n, "person is", "people are")} protected.`,
  openFinding: "Open",
  needsTwo: "Needs two exports",
  needsChats: "Needs chat or Snap history",
  allClearTitle: "Snappy found nothing to review",
  allClearBody: "No disappeared friends, unaccepted requests, or quiet friends. Add a newer export in a few weeks to check again.",
  healthErrors: (n: number) => countOf(n, "error", "errors"),
  healthWarnings: (n: number) => countOf(n, "warning", "warnings"),
  healthNotes: (n: number) => countOf(n, "note", "notes"),
};

/** The Tools hub and the frame every tool page shares. A tool's own words are in src/tools/<id>/copy.ts. */
export const tools = {
  lead: "Small helpers that read your export on this device.",
  noExportNote: "Most tools need an export. Add one on the Start page.",
  groups: { "your-export": "Your export", friends: "Friends", chats: "Chats", memories: "Memories", checklists: "Checklists" },
  open: "Open",
  statusReady: "Ready",
  statusNeeds: { export: "Needs an export", friends: "Needs a friends list", chats: "Needs chat history", memories: "Needs a Memories list" },
  backLink: "Back to tools",
  readsHeading: "What this reads",
  readsNever: "It never reads message text, media, locations, display names or login history.",
  workingLabel: "Working on your results",
  failedNote: "Snappy could not finish this. Reload the page and try again.",
  notesHeading: "Notes",
  commandHeading: "Run it as a command",
  downloadHeading: "Download",
  markNote: "Marks are your own word, and Snappy cannot check them. They are saved only if you turned saving on, and otherwise last this session.",
  markAnnounce: (label: string, on: boolean) => `${label}: marked ${on ? "done" : "not done"}.`,
  downloadSaved: "File saved.",
  downloadFailedNote: "Snappy could not save the file. Your browser may block downloads.",
  needs: {
    exportTitle: "Add your export",
    exportBody: "This tool reads the export you add to Snappy. Add one to see its results.",
    exportLedgerBody: "Your saved history holds friends only. Add an export to use this tool.",
    exportFailedBody: "Your last export was not added. The Start page says why.",
    friendsTitle: "No friends list found",
    friendsBody: "Snappy found no friends list in your export. The export check shows what is missing.",
    chatsTitle: "No chat history found",
    chatsBody: "Snappy found no chat or Snap history in your export. Request it again with chat history included.",
    memoriesTitle: "No Memories list found",
    memoriesBody: "Snappy found no Memories list in your export. Request it again with Memories included.",
    checkLink: "Open export check",
  },
};

export const disappeared = {
  title: routes.disappeared.title,
  lead: "Friends from an earlier export who are missing from your latest one. You did not remove them.",
  inference: "Snapchat gives no signal when someone removes you, so Snappy infers it. A deleted or renamed account looks the same.",
  noExportTitle: "No export yet",
  noExportBody: "Add your export to start your history. Add another in a few weeks, and Snappy compares the two.",
  needTwoTitle: "Add another export later to compare",
  needTwoBody: "You need two exports to compare. In a few weeks, request another with the same date range.",
  needTwoKeep: "To keep this export, set a passphrase in Settings.",
  noneTitle: "No disappeared friends found",
  noneBody: "Everyone from your earlier exports appears to be here, or you removed them.",
  changesHeading: "Since your last export",
  changeDisappeared: "Disappeared",
  changeRemoved: "Removed by you",
  changeAdded: "New friends",
  changeAccepted: "Requests accepted",
  listHeading: "May have removed you",
  // The count is already on the Disappeared card above; the list line only says the order.
  listCount: (_n: number) => "Most likely first",
};

export const requests = {
  title: routes.requests.title,
  lead: "People you sent a request to who have not accepted it. People you blocked or removed are left out.",
  inference: "Snapchat does not say why a request is open. The person may not have seen it.",
  emptyTitle: "No unaccepted requests found",
  emptyBody: "Snappy found none. Check that you selected User information when you requested your export.",
  noExportTitle: "No export yet",
  noExportBody: "Add your export to see unaccepted requests.",
  listCount: (n: number) => `${countOf(n, "request", "requests")}, most likely first`,
};

export const quiet = {
  title: routes.quiet.title,
  lead: "Friends with no chat or Snap for six months or more.",
  inference: "Snappy counts saved chats and Snap history. You may have kept in touch in ways it cannot see.",
  noChatsTitle: "Needs chat or Snap history",
  noChatsBody: "Your export has no chat or Snap history. Request it again with Chat and Snap history selected.",
  noChatsLedger: "Chat and Snap history is not saved with your history. Add an export that includes it.",
  emptyTitle: "No quiet friends found",
  emptyBody: "Snappy found none. Everyone seems to have had a chat or Snap in the last six months.",
  noExportTitle: "No export yet",
  noExportBody: "Add your export, with Chat and Snap history selected, to see quiet friends.",
  listCount: (n: number) => `${countOf(n, "friend", "friends")}, quietest first`,
};

export const cleanup = {
  title: routes.cleanup.title,
  lead: "Everyone Snappy found, in one list. Keep anyone who should stay, and remove only people you choose.",
  protectedByChats: "Anyone you chatted with or sent a Snap to in the last 30 days is protected.",
  noChatProtection: (fromLedger: boolean) =>
    `${fromLedger ? "Chat history is not saved" : "This export has no chat history"}, so Snappy cannot protect recent chats. Check Snapchat before you remove anyone.`,
  emptyTitle: "Nothing to review yet",
  emptyBody: "The queue fills when Snappy finds disappeared friends, unaccepted requests, or quiet friends. Add your export to begin.",
  nothingFound: "Nothing to review",
  nothingFoundBody: "Snappy found no one to review. Add a newer export in a few weeks to check again.",
  filtersLabel: "Filter the list",
  categoryLabel: "Category",
  confidenceLabel: "Confidence",
  allCategories: "All categories",
  allConfidences: "All levels",
  modeLabel: "View",
  modeReview: "Review",
  modeGuided: "Guided removal",
  summary: (shown: number, total: number) => (shown === total ? `${countOf(total, "person", "people")} to review` : `${shown} of ${countOf(total, "person", "people")} match`),
  noMatch: "No one matches. Change a filter to see more.",
  saveList: "Save list",
  copyList: "Copy list",
  listHelp: "Save a spreadsheet file, or copy usernames, one per line.",
  listSaved: "List saved.",
  listCopied: "List copied.",
  saveFailed: "Snappy could not save a file here. Use Copy list instead.",
  protectedHeading: (n: number) => `Protected (${n})`,
  protectedBody: "Snappy leaves these people out of the list above.",
  guidedLabel: "Guided removal",
  guidedNote: "Go one person at a time. Open each profile, remove them in Snapchat if you want, then mark Done.",
  done: "Done",
  doneFor: (u: string) => `Done with ${u}`,
  doneAnnounce: (u: string, done: boolean, progress: string) => `${u} marked ${done ? "done" : "not done"}. ${progress}.`,
  progressLabel: "Progress",
  progressText: (done: number, total: number) => `${done} of ${total} done`,
  clearChecks: "Clear checkmarks",
  checksCleared: "Checkmarks cleared.",
  removalWarning: "Removing a friend cannot be undone. They must accept a new request, and any streak ends.",
  csvHeader: ["Username", "Category", "Confidence", "Why", "Profile link"],
  csvFile: "snappy-cleanup-list.csv",
};

export const memories = {
  title: routes.memories.title,
  lead: "How many Memories you have and how much space they use. Snappy never opens a photo or video.",
  noExportTitle: "No export yet",
  ledgerOnlyTitle: "Memories are not saved",
  emptyTitle: "No Memories in this export",
  emptyBody: "When you request your data, select “Export your Memories”. Then add the export here.",
  noExportBody: "Add your export to see your Memories and storage.",
  ledgerOnly: "Memories are not saved with your history. Add an export to see them.",
  countsHeading: "Counts",
  total: "Memories",
  images: "Photos",
  videos: "Videos",
  unknownType: "Other",
  dated: "With dates",
  duplicates: "Duplicates",
  duplicatesNote: "Snappy finds likely duplicates by comparing dates, types, and sizes. It never compares pictures.",
  meterHeading: "Storage",
  capLabel: "Free storage cap (GB)",
  capHelp: "Snapchat sets this limit and may change it. Edit it if needed.",
  capError: "Enter a number from 0.1 to 10,000.",
  capSet: "Storage cap updated.",
  capUpdate: "Update cap",
  meterName: "Known size",
  meterText: (used: string, cap: string, percent: string) => `${used} of ${cap} (${percent})`,
  meterLabel: "Memories size compared with the storage cap",
  unknownSizes: (n: number) => `${n === 1 ? "One Memory has" : "Some Memories have"} no listed size, so the total may be low.`,
  noSizes: "This export lists no sizes, so Snappy cannot measure storage here.",
  overCap: "The known size is already over the cap.",
  projection: (month: string) => `At your recent pace, you may reach the cap around ${month}.`,
  noProjection: "Snappy does not have enough dated, sized Memories to project a date.",
  pairingHeading: "Files in your export",
  pairingHave: "Files found",
  pairingMissing: "Not included",
  pairingOverlayLabel: "Overlays",
  pairingOverlays: "Overlays are captions and stickers. They stay with their photo or video.",
  pairingWhyHeading: "Why some may be missing",
  pairingWhy: [
    "A part may be missing or still downloading. This is the most common reason.",
    "Snapchat may leave out Memories it keeps only in the app, or saved after your export.",
    "Snappy matches files to Memories by saved time and never guesses. No clear match counts as not included.",
  ],
  pairingTodoHeading: "What you can do",
  pairingTodo: "Save the missing Memories from the Snapchat app, or request a new export and add every part.",
  pairingNone: "No Memories files were found in your ZIP files. Add every part of your export together.",
  pairingLinksEmpty: "This export has no download links. Snapchat now puts the files inside the ZIP parts.",
  rescueHeading: "Rescue your files",
  rescueBody: "The Snappy command line tool copies your Memories into year and month folders. It restores dates and skips likely duplicates.",
  rescueCommandLabel: "Copy a command to run in a terminal, in the Snappy folder, and replace its placeholders. Or press Run to try it here.",
};

export const guide = {
  title: routes.guide.title,
  lead: "Snappy reads only your own export, on this device. It never logs in to Snapchat or uploads anything.",
  tickHeading: "What to select",
  optionHeader: "Option",
  tickHeader: "Select it?",
  whyHeader: "Why",
  rows: [
    ["Export your Memories", "Yes, for rescue", "Needed for Memories rescue. Snappy never looks at the photos or videos."],
    ["Export JSON files", "Yes, required", "Snappy reads JSON only. HTML-only exports are rejected."],
    ["User information", "Yes, required", "Holds your friends list, blocked list, and requests."],
    ["Chat and Snap history", "Optional", "Used only for who, when, and type. Snappy never reads message text or opens media."],
    ["Everything else", "No", "Snappy does not use it. Leaving it off keeps less private data in the ZIP."],
  ] as const,
  rangeHeading: "Choose the “All Time” range",
  rangeBody: "A shorter range can make old friends look like they left. Use the same range every time.",
  afterHeading: "After you request it",
  afterSteps: [
    "Snapchat emails you a link. Download every ZIP part and keep the original names.",
    "The part with no number holds your lists. Numbered parts hold photos and videos.",
    "Note your friend count under Profile, then Friends. Snappy warns you if it differs.",
    "Never send these files to anyone, including Snappy’s developers. Delete them when you are done.",
  ],
  shapeHeading: "Share the shape, never the contents",
  shapeBody: "Run this if an export will not read. It prints only names and counts.",
  tryHeading: "Try the command line",
  tryBody: "Press Run to try a command here, or copy it to run in a terminal, in the Snappy folder.",
  storingHeading: "Saved history",
  storingBody: "Snappy can keep past friend lists to spot who disappeared. They hold usernames, so seal them with a passphrase.",
  addLink: "Add export",
  tickKinds: ["yes", "yes", "yes", "optional", "no"] as const,
};

export const privacy = {
  title: routes.privacy.title,
  lead: brand.privacyLine,
  readsHeading: "What Snappy reads",
  neverHeading: "What Snappy skips",
  neverBody: "Snappy skips these while it reads, and never keeps them.",
  readsRows: [
    ["Friend usernames", "The only identifier Snappy keeps, so you can act on a person."],
    ["Friend and request dates", "When a friendship or request began, and when you removed someone."],
    ["Chat and Snap activity", "Who, which way, what kind, and when. Never the words, photos, or videos."],
    ["Memories list", "Counts, dates, types, and sizes if the export lists them."],
    ["File names and times", "Used to find the right JSON files and match Memories files. Nothing is opened."],
  ] as const,
  neverRows: [
    ["Message text"],
    ["Photos and videos"],
    ["Locations"],
    ["Display names"],
    ["Group chat titles"],
    ["Captions, bios, email, and phone"],
    ["Purchases, support, and My AI data"],
  ] as const,
  whatHeader: "What",
  detailHeader: "Details",
  networkHeading: "Network",
  networkOk: "This page cannot connect to the internet. Its security policy blocks every connection.",
  networkUnknown: "Snappy could not confirm this page’s security policy. Open the page again from a copy you trust.",
  workerBody: "Background helpers read exports and run commands. They cannot connect anywhere either.",
  // Shown only inside the desktop app. Each line says what was checked and no more.
  desktopHeading: "In the desktop app",
  desktopOwnPage: "This app shows only its own page. Links and new windows are refused.",
  desktopWindows: "On Windows, the app uses Microsoft WebView2, a separate program that Snappy does not control.",
  desktopWindowsTest: "In one test on one computer, a sign-in part of WebView2 connected to Microsoft in the background.",
  desktopWindowsOff: "Snappy turns that part off, and the connection stopped. A Microsoft update could change that.",
  desktopOther: "The app uses your system’s web engine, a separate program. We have not checked what it does on its own.",
  policyHeading: "Technical details",
  networkDetail: "To check, open your browser’s developer tools. The network tab stays empty.",
  policyLabel: "Security policy in this page",
  policyWorker: "Background helpers start under the worker-src blob: rule. If blocked, Snappy reads on the page instead, and Run is unavailable.",
  sealHeading: "Saved data",
  sealBody: [
    "By default Snappy keeps your results in memory only. Closing the tab clears them.",
    "With a passphrase, Snappy saves your friend history, keep list, and checklist marks in this browser, encrypted.",
    "Snappy never stores your passphrase. If you forget it, the saved data cannot be recovered.",
    "A passphrase typed into a command here is kept in memory only until the page closes.",
  ],
  sealTech: "The passphrase becomes a key with PBKDF2 (600,000 rounds). The data is sealed with AES-256-GCM.",
  keepHeading: "What the saved data holds",
  keepBody: "Usernames, dates, your keep list, your guided-removal checkmarks, and your checklist marks. Nothing else from your export.",
  themeNote,
};

export const settings = {
  title: routes.settings.title,
  themeHeading: "Theme",
  themes: { dark: "Dark", light: "Light", system: "Match device" },
  themeNote,
  storageHeading: "Saved data",
  storageSession: "Your results are not saved. Closing this tab clears them.",
  storageLocked: "Your saved history is sealed. Unlock it on the Start page.",
  storageUnlocked: "Snappy does not store your passphrase.",
  storageUnsupported: "This browser does not allow saving. Your results last only while this tab is open.",
  passphraseLabel: "Passphrase",
  confirmLabel: "Repeat passphrase",
  passphraseHelp: "Use 12 or more characters. If you forget it, your saved data cannot be recovered.",
  showPassphrase: "Show passphrase",
  setButton: "Seal history",
  changeButton: "Change passphrase",
  mismatch: "The passphrases do not match. Type them again.",
  tooShort: "Add more characters.",
  sealed: "History sealed.",
  changed: "Passphrase changed.",
  lockedAnnounce: "Locked. Your results are cleared from the screen.",
  lockHeading: "Lock",
  lockBody: "Clears this page and keeps the sealed copy. You need your passphrase to open it again.",
  deleteHeading: "Delete saved data",
  deleteBody: "Removes the sealed history and clears the screen. This cannot be undone.",
  deleteButton: "Delete data",
  deleteConfirmTitle: "Delete saved data?",
  deleteConfirmBody: "This deletes your history, keep list, checkmarks, and checklist marks, and cannot be undone. Your export files are not touched.",
  deleteConfirm: "Delete data",
  deleteCancel: "Cancel",
  deleted: "Saved data deleted.",
  deleteFailed: "Snappy could not delete the saved data. Close other Snappy tabs and try again.",
  aboutHeading: "About",
  aboutBody: "Snappy reads your own Snapchat export on this device to tidy your friends list and rescue your Memories.",
  versionLabel: (v: string) => `Version ${v}`,
  licensesHeading: "Licenses",
  licensesBody: "Three open fonts and one MIT library. License files are in the licenses folder that comes with Snappy.",
};

export const passphraseHint = {
  label: "Estimated strength",
  empty: "Not entered",
  short: "Too short",
  weak: "Weak",
  fair: "Fair",
  good: "Good",
  strong: "Strong",
};

export const vaultMessages = {
  wrongPassphrase: "That passphrase did not open your saved data. Check it and try again.",
  unreadable: "Snappy could not read the saved data. A different version may have saved it.",
  storageUnavailable: "This browser does not allow saving, so Snappy is in session-only mode.",
  saveFailed: "Snappy could not save. Your results are on screen, but closing this tab clears them.",
  lockedFirst: "Unlock your saved data first, or delete it in Settings to start over.",
  nothingSaved: "No saved data was found on this device.",
  savedElsewhere: "Saved data already exists here, maybe from another tab. Unlock it first, or delete it in Settings.",
  /** After a command changed the saved history while the dashboard was open. */
  historyUpdated: "Saved history updated. Unlock to see it.",
};

/**
 * The in-app terminal: command blocks, the output panel and the prompts. One-line labels and short
 * notes, like the rest of the interface. Button labels are a verb plus a short noun.
 */
const lowerFirst = (text: string): string => `${text.charAt(0).toLowerCase()}${text.slice(1)}`;

export const terminal = {
  /** The muted one-line title above each command, by command. */
  titles: {
    help: "Show the commands",
    "demo-run": "Try it on invented data",
    inspect: "Show the shape of your export",
    "analyze-preview": "Find friends to review",
    "analyze-save": "Find friends and save history",
    "memories-preview": "Preview the Memories rescue",
    "memories-rescue": "Rescue your Memories",
    "ledger-status": "Show your saved history",
    check: "Check your export",
    storage: "Plan your Memories storage",
    backup: "Preview your friends backup",
    replies: "Find chats waiting on a reply",
    "reply-speed": "See how fast you reply",
    "reach-out": "Find who reaches out first",
    habits: "See your busiest chat hours",
    calendar: "See your activity calendar",
    closest: "Find your closest friends",
    safety: "Show the safety checklist",
    anniversaries: "Find friendship anniversaries",
    "on-this-day": "Find Memories from this day",
    gaps: "Find gaps in your Memories",
    blocked: "Review blocked and ignored",
    lookalikes: "Find lookalike usernames",
    "friend-count": "Chart your friend count",
    friends: "Make a friends table",
    "rescue-manifest": "Make a rescue file list",
    privacy: "Show the privacy checklist",
    remind: "Preview an export reminder",
    since: "Compare with your last export",
    "year-in-review": "Sum up your year",
  },
  runButton: "Run",
  stopButton: "Stop",
  closeButton: "Close",
  copyOutputButton: "Copy output",
  chooseButton: "Choose export",
  clearFilesButton: "Clear",
  continueButton: "Continue",
  cancelButton: "Cancel",
  confirmFolderButton: "Save files",
  confirmStoreButton: "Update history",
  saveFileButton: "Save",
  saveAllButton: "Save all",
  clearOutButton: "Clear files",
  /** Accessible names. Each starts with the visible label. */
  copyFor: (title: string) => `Copy command: ${lowerFirst(title)}`,
  runFor: (title: string) => `Run command: ${lowerFirst(title)}`,
  stopFor: (title: string) => `Stop command: ${lowerFirst(title)}`,
  saveFileFor: (name: string) => `Save ${name}`,
  panelLabelFor: (title: string) => `Output of ${lowerFirst(title)}`,
  logLabel: "Command output",
  filesChosen: (n: number) => (n === 1 ? "1 file chosen" : `${n} files chosen`),
  /** Why Run cannot start yet, or at all. */
  needsFileHint: "Choose your export first.",
  busyHint: "Another command is running.",
  noWorkerNote: "This browser cannot run commands here.",
  networkNote: "Needs a terminal on your computer.",
  /** Under output that suggests --download, which Run cannot do (it has no network). */
  downloadNote: "Downloads need a terminal on your computer.",
  notZipNote: "Choose .zip files from your export.",
  /** The confirmation before a command that writes. */
  confirmFolderTitle: "Save to a virtual folder?",
  confirmFolderBody: (megabytes: number) => `Files stay in this page until you save them. Up to ${megabytes} MB.`,
  confirmStoreTitle: "Update saved history?",
  confirmStoreBody: "This changes the saved history in this browser. It locks the dashboard until you unlock it again.",
  /** The passphrase prompt. The question itself comes from the command. */
  secretTitle: "Passphrase needed",
  secretNote: "Kept in memory only. It is never shown or saved.",
  /** Status words, spoken and shown. */
  startedAnnounce: "Running",
  askingAnnounce: "Needs your passphrase",
  stoppingAnnounce: "Stopping",
  /** The line next to a Stop that was pressed, until the helper ends. */
  stoppingStatus: "Stopping",
  copiedCommandAnnounce: "Command copied.",
  copiedOutputAnnounce: "Output copied.",
  failedAnnounce: "The command could not start.",
  doneAnnounce: (title: string, label: string, code: number) => `${title}: ${label}. Exit code ${code}.`,
  /** The chip under the output: what the exit meant. */
  exit: {
    done: "Done",
    couldNotRun: "Could not run",
    exportErrors: "Export has errors",
    someFailed: "Finished, some items failed",
    stopped: "Stopped",
    blocked: "Needs a terminal on your computer",
    helperStopped: "The helper stopped",
  },
  codeLabel: (code: number) => `Exit code ${code}`,
  secondsLabel: (seconds: string) => `${seconds} s`,
  trimmed: "Earlier output removed.",
  /** The virtual output folder. */
  outHeading: "Saved files",
  outCount: (files: number, size: string) => `${files === 1 ? "1 file" : `${files} files`}, ${size}`,
  outMore: (n: number) => `Plus ${n} more`,
  outLostNote: "Stopping keeps the files already written. If the helper has to be cut off, they are lost.",
  outTooBigNote: "That is too much for one .zip. Save the files one by one.",
  outSavedAnnounce: "File saved.",
  outSaveFailedNote: "Snappy could not save that file. Try again.",
};
