/**
 * Since your last export: every string this tool shows. Voice rules are in docs/BRAND.md. Keys end in the kind of
 * text they are (Heading, Header, Note, Line, Cell, Button, Announce), because the copy lint reads the kind from
 * the key. Nothing here holds an export value: counts and dates come in as arguments, and no function takes a name.
 *
 * The cells of the tables say what they hold ("Friends since Mar 3, 2025"), because on a phone each row becomes a
 * card and the column names are not repeated.
 */
import { countOf, formatCount } from "../../format.ts";

const they = (n: number): string => (n === 1 ? "it" : "them");
const have = (n: number): string => (n === 1 ? "has" : "have");
const upDown = (n: number): string => (n > 0 ? `up ${formatCount(n)}` : n < 0 ? `down ${formatCount(-n)}` : "no change");

export const copy = {
  title: "Since your last export",
  oneLiner: "See what changed since your last export.",
  description: "Compare this export with the last one in your saved history. See friends added, friends who may have left and how your requests went.",
  reads: "Friends lists and their dates, the dates and directions of chats and Snaps, Memories dates, and the exports in your saved history.",
  empty: {
    title: "Nothing to compare yet",
    body: "No earlier export with a usable date is saved yet. Snappy compares exports kept in your saved history, which needs saving turned on.",
  },

  doneAnnounce: (added: number, left: number) => `Comparison finished. ${countOf(added, "friend", "friends")} added, ${formatCount(left)} no longer listed.`,
  emptyAnnounce: "Comparison finished. There is no earlier export to compare.",

  glanceHeading: "At a glance",
  compareLine: (previous: string, current: string, days: number) => `Compared ${previous} with ${current}, ${countOf(days, "day", "days")} apart.`,
  factDaysHeader: "Days apart",
  factFriendsHeader: "Friends now",
  factAddedHeader: "New friends",
  factLeftHeader: "No longer listed",
  factAcceptedHeader: "Requests accepted",
  factMemoriesHeader: "New Memories",

  friendsHeading: "Friends and requests",
  friendsLine: (before: number, now: number) => `${countOf(before, "friend", "friends")} before and ${formatCount(now)} now.`,
  noChangeLine: "No friend or request changed between the two exports.",
  moreLine: (n: number) => `${countOf(n, "more person", "more people")} not shown. Download the CSV to see everyone.`,
  nameHeader: "Username",
  dateHeader: "Date",

  addedHeading: "New friends",
  addedCaption: "Friends added since your last export",
  leftHeading: "No longer listed",
  leftCaption: "Friends no longer on your list",
  removedHeading: "Removed by you",
  removedCaption: "Friends you removed",
  blockedHeading: "Blocked by you",
  blockedCaption: "Blocked friends no longer listed",
  acceptedHeading: "Requests accepted",
  acceptedCaption: "Requests you sent that became friends",
  pendingHeading: "Requests still waiting",
  pendingCaption: "Sent requests still waiting",
  vanishedHeading: "Requests no longer listed",
  vanishedCaption: "Sent requests no longer listed",
  friendsSinceCell: (date: string) => `Friends since ${date}`,
  removedOnCell: (date: string) => `Removed ${date}`,
  sentOnCell: (date: string) => `Sent ${date}`,
  noDateCell: "No date",

  memoriesHeading: "Memories",
  memoriesLine: (total: number, fresh: number) => `${countOf(total, "Memory", "Memories")} in this export, ${formatCount(fresh)} captured since your last export.`,
  captureLine: "Snappy counts the date a Memory was captured, not the date it was uploaded.",

  activityHeading: "Chats and Snaps",
  activityCaption: "Saved chats and Snaps by period",
  periodHeader: "Period",
  sentHeader: "Sent",
  receivedHeader: "Received",
  unknownHeader: "Unknown",
  sinceRow: "Since your last export",
  earlierRow: "Before that",
  sentCell: (n: number) => `${formatCount(n)} sent`,
  receivedCell: (n: number) => `${formatCount(n)} received`,
  unknownCell: (n: number) => `${formatCount(n)} unknown`,
  changeLine: (sent: number, received: number) => `Sent: ${upDown(sent)}. Received: ${upDown(received)}.`,
  earlierLine: "Before that is the same length of time before your last export.",

  downloadLabel: "Download CSV",
  downloadNote: "The file lists usernames. Keep it private.",
  unitCsvName: "username",
  unitCsvChange: "change",
  unitCsvDate: "date",

  orderNote: "The saved export is newer than this one, so Snappy compared them the other way round. Chats, Snaps and Memories are not shown.",
  sameTimeNote: "Both exports have the same time, so there is no period to measure.",
  sameDayNote: "Both exports are from the same day, so few changes are likely.",
  longGapNote: (days: number) => `The exports are ${countOf(days, "day", "days")} apart. Anyone no longer listed may have left at any point in that time.`,
  futureTimeNote: (n: number) => `${countOf(n, "export", "exports")} ${have(n)} a date in the future. A device clock may have been wrong.`,
  leftNote: (n: number) => `${countOf(n, "friend", "friends")} ${n === 1 ? "is" : "are"} no longer listed. ${n === 1 ? "That friend" : "They"} may have left your list on their own, or closed the account.`,
  partialNote: (gone: number, before: number) => `${formatCount(gone)} of ${countOf(before, "friend", "friends")} ${gone === 1 ? "is" : "are"} gone. This may be a partial export, so check it before you trust the list.`,
  blockedNote: (n: number) => `${countOf(n, "friend", "friends")} left your list because you blocked ${n === 1 ? "that friend" : "them"}. Snappy keeps ${they(n)} apart.`,
  declinedNote: (n: number) => `${countOf(n, "request", "requests")} you sent ${n === 1 ? "is" : "are"} no longer listed. ${n === 1 ? "It" : "They"} may have been declined.`,
  noActivityNote: "Your export has no saved chats or Snaps, so activity is not shown.",
  notCoveredNote: "Your chats and Snaps may not reach back far enough to compare.",
  badTimesNote: (n: number) => `${countOf(n, "chat or Snap", "chats or Snaps")} ${have(n)} a missing or future date. Snappy leaves ${they(n)} out.`,
  noMemoriesNote: "Your export has no Memories list, so Memories are not shown.",
  badMemoryDatesNote: (n: number) => `${countOf(n, "Memory", "Memories")} ${have(n)} no date or a date in the future. Snappy leaves ${they(n)} out of the new count.`,
  dateGuessedNote: "Your export has no date of its own, so Snappy used the time of this session. Counts may be off by a little.",
  exportErrorsNote: "Your export has errors, so friends may look as if they left. Run the export check for details.",
  otherNote: "Snappy noted something it cannot describe here.",
} as const;
