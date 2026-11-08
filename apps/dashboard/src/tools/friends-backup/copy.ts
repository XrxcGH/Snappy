/**
 * Friends backup: every string this tool shows. Voice rules are in docs/BRAND.md. Keys end in the kind of
 * text they are (Heading, Header, Note, Step, Line, Button, Announce), because the copy lint reads the kind
 * from the key. Nothing here holds a username: counts and dates come in as arguments.
 */
import { countOf, formatCount } from "../../format.ts";

export const copy = {
  title: "Friends backup",
  oneLiner: "Save a copy of your friends list.",
  description: "Save your friends, blocked and ignored lists as one small file you can keep and check against a later export.",
  reads: "The friends, blocked and ignored lists: usernames, and the dates they were created when your export has them.",
  empty: {
    title: "Nothing to back up",
    body: "Snappy found no usable usernames in your friends lists, so there is nothing to save.",
  },

  doneAnnounce: (friends: number, blocked: number, ignored: number) => `Backup ready: ${countOf(friends, "friend", "friends")}, ${formatCount(blocked)} blocked, ${formatCount(ignored)} ignored.`,

  contentsHeading: "What the backup holds",
  contentsCaption: "People in the backup, by list",
  listHeader: "List",
  peopleHeader: "People",
  datedHeader: "With a date",
  unitPeople: (n: number) => countOf(n, "person", "people"),
  unitDated: (n: number) => `${formatCount(n)} with a date`,
  lists: { friends: "Friends", blocked: "Blocked", ignored: "Ignored" },
  madeLine: (date: string) => `Made ${date}.`,
  unknownTimeLine: "Snappy could not tell when this backup was made.",

  nextHeading: "What to do next",
  saveStep: "Save the file and keep it somewhere private.",
  keepStep: "The file lists usernames, so treat it like a contact list.",
  compareStep: "To check it against a later export, use the command below with the compare option.",

  downloadLabel: "Save JSON",
  downloadNote: "The file holds usernames. Keep it private.",

  skippedNote: (n: number) => `${countOf(n, "entry", "entries")} had no usable username and ${n === 1 ? "was" : "were"} left out.`,
  duplicatesNote: (n: number) => `${countOf(n, "repeated name", "repeated names")} ${n === 1 ? "was" : "were"} merged, so each person is listed once.`,
  invalidDatesNote: (n: number) => `${countOf(n, "date", "dates")} could not be read and ${n === 1 ? "was" : "were"} left out.`,
  futureDatesNote: (n: number) => `${countOf(n, "date", "dates")} ${n === 1 ? "is" : "are"} in the future and ${n === 1 ? "was" : "were"} left out. A device clock may have been wrong.`,
  overLimitNote: (n: number) => `${countOf(n, "person", "people")} over the limit of 100,000 per list ${n === 1 ? "was" : "were"} left out.`,
  overlapNote: (n: number) => `${countOf(n, "person", "people")} may be on both your friends list and your blocked list.`,
  friendsEmptyNote: "Your friends list is empty. The export may be cut short.",
  timeUnknownNote: "The backup has no date, because Snappy could not tell the time.",
} as const;
