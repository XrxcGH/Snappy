/**
 * Export check: every string this tool shows. Voice rules are in docs/BRAND.md. Keys end in the kind of
 * text they are (Heading, Header, Note, Step, Line), because the copy lint reads the kind from the key.
 * Nothing here holds an export value: counts and dates come in as arguments.
 */
import { countOf } from "../../format.ts";

export const copy = {
  title: "Export check",
  oneLiner: "Check that your export is complete.",
  description: "See whether your export has the lists Snappy needs, and what to do if something is missing.",
  reads: "File names, counts and dates in your lists and histories.",

  verdict: {
    ready: "Your export looks ready to use.",
    readyWithNotes: "Your export looks usable, with a few notes.",
    incomplete: "Your export may be missing some parts.",
    unusable: "Snappy cannot use this export yet.",
  },
  doneAnnounce: "Export check finished.",

  foundHeading: "What was found",
  foundCaption: "Sections found in your export",
  partsLine: (n: number) => `${countOf(n, "ZIP file", "ZIP files")} read.`,
  /** Under the sections: this page does not take the friend count Snapchat shows, and the command does. */
  friendCountLine: "To catch a short friends list, add --friend-count and your Snapchat count.",
  sectionHeader: "Section",
  statusHeader: "Status",
  itemsHeader: "Items",
  sections: {
    friends: "Friends list",
    chat_history: "Chat history",
    snap_history: "Snap history",
    memories_list: "Memories list",
    memories_files: "Memories files",
  },
  /** The same names inside a sentence. A piece that code joins into a sentence is a "unit" key, so the lint lets it start in lowercase. */
  unitSection: (id: string): string => ({ friends: "friends list", chat_history: "chat history", snap_history: "Snap history", memories_list: "Memories list", memories_files: "Memories files" })[id] ?? "list",
  statuses: { present: "Found", empty: "Empty", missing: "Not found", unreadable: "Unreadable" },

  datesHeading: "Dates covered",
  datesCaption: "Dates covered by your export",
  recordsHeader: "Records",
  fromHeader: "From",
  toHeader: "To",
  spanHeader: "Span",
  records: { chats: "Chats", snaps: "Snaps", memories: "Memories" },
  unitFrom: (date: string) => `From ${date}`,
  unitTo: (date: string) => `To ${date}`,
  span: (days: number) => `Span of ${countOf(days, "day", "days")}`,
  unitItems: (n: number) => countOf(n, "item", "items"),
  /** "2,012 days": the span as a cell shows it. */
  unitDays: (n: number) => countOf(n, "day", "days"),
  unitAgo: (days: number) => (days === 0 ? "today" : `${countOf(days, "day", "days")} ago`),
  madeLine: (date: string, ago: string) => `Made ${date}, ${ago}.`,
  /** An export made today: "Made today, Nov 6, 2026." */
  madeTodayLine: (date: string) => `Made today, ${date}.`,
  madeOnlyLine: (date: string) => `Made ${date}.`,
  activityLine: (date: string) => `No export date found. The newest activity is from ${date}.`,
  unknownDateLine: "Snappy could not tell when this export was made.",

  todoHeading: "What to do",
  addFilesStep: "Add your export: .zip files, or a folder with every part.",
  requestJsonStep: "Request your data again from Snapchat and choose the JSON format.",
  addPartsStep: "Add the other parts of your export. Their names end in -2, -3 and so on.",
  requestSectionsStep: (names: string) => `Request your data again and include: ${names}.`,
  allTimeStep: "When you request a new export, choose all time as the date range.",
  newerStep: "Request a newer export from Snapchat.",
  checkDateStep: "Check the date on your device, then add your export again.",
  otherStep: "Request your data again from Snapchat.",

  htmlOnlyNote: "This export is in HTML format. Snappy needs the JSON format.",
  noPartsNote: "Snappy found no files in this export.",
  duplicateNote: (n: number) => `${countOf(n, "repeated username", "repeated usernames")} in your lists. Snappy counts each person once.`,
  friendsEmptyNote: "Your friends list is empty, but removed friends are listed. The export may be cut short.",
  dateLimitedNote: "The export may cover only part of your history.",
  friendCountNote: "The friends list differs from the count you gave. The export may be short.",
  futureStampsNote: "Some dates are in the future. A device clock may have been wrong.",
  datesFutureNote: (n: number, where: string) => `${countOf(n, "date", "dates")} in your ${where} ${n === 1 ? "is" : "are"} in the future. Snappy leaves ${n === 1 ? "it" : "them"} out.`,
  datesMissingNote: (n: number, where: string) => `${countOf(n, "entry", "entries")} in your ${where} ${n === 1 ? "has" : "have"} no usable date.`,
  staleNote: (days: number) => `This export is about ${countOf(days, "day", "days")} old. A newer one gives current results.`,
  agingNote: (days: number) => `This export is about ${countOf(days, "day", "days")} old.`,
  exportFutureNote: "The export date is in the future. Check the date on your device.",
  fromActivityNote: "The export has no date, so its age comes from the newest activity. It may be newer.",
  memoriesNoFileNote: (n: number) => `${countOf(n, "Memory", "Memories")} ${n === 1 ? "has" : "have"} no matching file in your ZIP files.`,
  memoriesFilesNote: "Your Memories list is there, but these ZIP files hold no Memories files.",
  moreNote: "Your export may have more parts. Add the other ZIP files.",
  // The export check is this page, so it does not send a person to itself.
  otherNote: "Snappy found something it could not describe.",
} as const;
