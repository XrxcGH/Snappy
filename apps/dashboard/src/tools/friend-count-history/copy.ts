/**
 * Friend count history: every string this tool shows. Voice rules are in docs/BRAND.md. Keys end in the kind of
 * text they are (Heading, Header, Note, Line, Announce), because the copy lint reads the kind from the key.
 * Nothing here holds an export value: counts and month names come in as arguments, never a username.
 *
 * The cells of the tables say what they count ("3 added"), because on a phone each row becomes a card and the
 * column names are not repeated.
 */
import { countOf } from "../../format.ts";

const them = (n: number): string => (n === 1 ? "that friend" : "them");

export const copy = {
  title: "Friend count history",
  oneLiner: "See how your friend count has changed.",
  description: "Shows how your friend count grew and shrank, month by month. It also compares the curve with your saved history.",
  reads: "The dates friends were added and removed, and the friend counts in your saved history.",
  empty: {
    title: "No dates to chart",
    body: "No friend in your export has a usable date, so Snappy cannot draw a curve.",
  },

  doneAnnounce: (count: number) => `Friend count finished. Your list holds ${countOf(count, "friend", "friends")}.`,
  emptyAnnounce: "Friend count finished. There are no dates to chart.",

  summaryHeading: "Summary",
  nowHeader: "Friends now",
  addedHeader: "Added",
  removedHeader: "Removed by you",
  gainHeader: "Biggest gain",
  dropHeader: "Biggest drop",
  unitGain: (month: string, n: number) => `${month}, up ${n}`,
  unitDrop: (month: string, n: number) => `${month}, down ${n}`,

  monthsHeading: "Month by month",
  monthsCaption: "Friends added and removed each month",
  monthHeader: "Month",
  monthAddedHeader: "Added",
  monthRemovedHeader: "Removed",
  monthFriendsHeader: "Friends",
  unitSoFar: (month: string) => `${month} (so far)`,
  unitAdded: (n: number) => `${n} added`,
  unitRemoved: (n: number) => `${n} removed`,
  unitFriends: (n: number) => countOf(n, "friend", "friends"),
  monthsShownLine: (shown: number, total: number) => `Showing the latest ${countOf(shown, "month", "months")} of ${total}.`,

  compareHeading: "Against your saved history",
  compareCaption: "Saved snapshots compared with the curve",
  savedOnHeader: "Saved on",
  savedHeader: "Saved",
  curveHeader: "Curve",
  gapHeader: "Gap",
  resultHeader: "Result",
  unitSaved: (n: number) => `${n} saved`,
  unitCurve: (n: number) => `${n} on the curve`,
  unitGap: (gap: number) => (gap === 0 ? "no gap" : gap > 0 ? `${gap} more saved` : `${-gap} fewer saved`),
  statuses: { close: "Close", differs: "Differs" },
  comparisonsShownLine: (shown: number, total: number) => `Showing the latest ${shown} of ${countOf(total, "snapshot", "snapshots")}.`,

  noDatesNote: "No friend in your export has a usable date, so Snappy cannot draw a curve.",
  curveHighNote: "Anyone who left your list on their own is not on the curve. Earlier months may run high.",
  undatedJoinsNote: (n: number) => `${countOf(n, "friend", "friends")} ${n === 1 ? "has" : "have"} no start date. Snappy counts ${them(n)} from the first month.`,
  undatedLeavesNote: (n: number) => `${countOf(n, "removed friend", "removed friends")} ${n === 1 ? "has" : "have"} no removal date, so Snappy leaves ${them(n)} out.`,
  badDatesNote: (n: number) => `${countOf(n, "date", "dates")} ${n === 1 ? "is" : "are"} in the future or too old to be real. Snappy ignores ${n === 1 ? "it" : "them"}.`,
  leaveBeforeJoinNote: (n: number) =>
    `${countOf(n, "removed friend", "removed friends")} ${n === 1 ? "has" : "have"} a removal date before the start date. Snappy ignores ${n === 1 ? "that removal" : "those removals"}.`,
  reAddedNote: (n: number) => `${countOf(n, "friend", "friends")} ${n === 1 ? "is" : "are"} in both lists, so you may have added ${them(n)} back.`,
  badSnapshotsNote: (n: number) => `${countOf(n, "saved snapshot", "saved snapshots")} had a missing or odd date. Snappy ignored ${n === 1 ? "it" : "them"}.`,
  noSnapshotsNote: "No saved history was compared. Snapshots are kept only if you turned saving on.",
  oneSnapshotNote: "Only one snapshot was saved, so the comparison is a single point.",
  agreeNote: (n: number) => `The curve and your saved history are close at ${countOf(n, "snapshot", "snapshots")}.`,
  disagreeNote: (disagreeing: number, compared: number, gap: number) =>
    `The curve and your saved history differ at ${disagreeing} of ${countOf(compared, "snapshot", "snapshots")}. The largest gap is ${countOf(gap, "friend", "friends")}.`,
  exportErrorsNote: "Your export has errors, so the curve may be off. Run the export check for details.",
  otherNote: "Snappy noted something it cannot describe here.",
} as const;
