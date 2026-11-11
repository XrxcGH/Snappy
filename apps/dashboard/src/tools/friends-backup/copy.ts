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
  compareStep: "To check it against a later export, choose the saved file below, or copy the command that uses --compare.",
  compareFileHeading: "Compare with a backup file",
  compareFileLine: "Choose a backup you saved before. Snappy reads it here, compares the names with this export and changes nothing.",
  compareFileButton: "Choose backup file",
  compareCaption: "Backup compared with this export",
  compareInBackupHeader: "In backup",
  compareNewHeader: "New",
  compareMissingHeader: "Missing",
  compareSameHeader: "In both",
  unitInBackup: (n: number) => `${formatCount(n)} in the backup`,
  unitNew: (n: number) => `${formatCount(n)} new`,
  unitMissing: (n: number) => `${formatCount(n)} missing`,
  unitInBoth: (n: number) => `${formatCount(n)} in both`,
  compareMadeLine: (date: string) => `The backup was made ${date}.`,
  compareLegendLine: "New is in this export but not in the backup. Missing is in the backup but not in this export.",
  compareSameLine: "This export matches the backup. Nobody is new and nobody is missing.",
  compareAnnounce: (missing: number, added: number) => `Comparison finished. ${formatCount(missing)} missing and ${formatCount(added)} new.`,
  compareSameAnnounce: "Comparison finished. This export matches the backup.",
  notComparedNote: (lists: string) => `Not compared: ${lists}. This export does not hold ${lists.includes(",") ? "them" : "it"}.`,
  currentEmptyNote: "This export has no friends, so it may be the wrong export.",
  manyMissingNote: (missing: number, inBackup: number) => `${formatCount(missing)} of the ${countOf(inBackup, "friend", "friends")} in the backup ${missing === 1 ? "is" : "are"} missing. This export may be cut short.`,
  namesLeftOutNote: (n: number) => `${countOf(n, "name", "names")} in this export had no usable username and ${n === 1 ? "was" : "were"} left out.`,
  fileNotBackupNote: "That file is not a Snappy friends backup. Choose a file saved by this tool or the backup command.",
  fileTooLargeNote: "That file is too large to be a Snappy friends backup.",
  fileVersionNote: "That backup comes from another version of Snappy, so it cannot be read safely.",
  fileTooManyNote: "That backup holds more entries than Snappy reads, so it may not be a real backup.",
  fileUnreadableNote: "Snappy could not read that file.",
  compareHeading: "Check it later",
  compareTitle: "Check later against a saved backup",

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
