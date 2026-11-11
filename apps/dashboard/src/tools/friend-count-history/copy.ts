/**
 * Friend count history: every string this tool shows. Voice rules are in docs/BRAND.md. Keys end in the kind of
 * text they are (Heading, Header, Note, Line, Announce), because the copy lint reads the kind from the key.
 * Nothing here holds an export value: counts and month names come in as arguments, never a username.
 *
 * The cells of the tables say what they count ("3 added"), because on a phone each row becomes a card and the
 * column names are not repeated.
 */
import { tools } from "../../copy.ts";
import { countOf, formatCount } from "../../format.ts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

const them = (n: number): string => (n === 1 ? "that friend" : "them");

export const copy = {
  title: "Friend count history",
  oneLiner: "See how your friend count has changed.",
  description: "See how your friend count grew and shrank, month by month. It also compares the curve with your saved history.",
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
  undatedHeader: "No start date",
  gainHeader: "Biggest gain",
  dropHeader: "Biggest drop",
  /** "Mar 2026", from a year and a month number (1 to 12): a short month, because it sits in a table or a fact. */
  unitMonth: (year: number, month: number): string => {
    const name = MONTHS[month - 1];
    return name === undefined || !Number.isFinite(year) ? "" : `${name} ${year}`;
  },
  unitGain: (month: string, n: number) => `${month}, up ${formatCount(n)}`,
  unitDrop: (month: string, n: number) => `${month}, down ${formatCount(n)}`,

  monthsHeading: "Month by month",
  monthsCaption: "Friends added and removed each month",
  monthHeader: "Month",
  monthAddedHeader: "Added",
  monthRemovedHeader: "Removed",
  monthFriendsHeader: "Friends",
  unitSoFar: (month: string) => `${month} (so far)`,
  unitAdded: (n: number) => `${formatCount(n)} added`,
  unitRemoved: (n: number) => `${formatCount(n)} removed`,
  unitFriends: (n: number) => countOf(n, "friend", "friends"),
  monthsShownLine: (shown: number, total: number) =>
    `Showing the latest ${countOf(shown, "month", "months")} of ${formatCount(total)}. The command lists more with --months.`,

  compareHeading: "Against your saved history",
  compareCaption: "Saved exports compared with the curve",
  savedOnHeader: "Saved on",
  savedHeader: "Saved",
  curveHeader: "Curve",
  gapHeader: "Gap",
  resultHeader: "Result",
  unitSaved: (n: number) => `${formatCount(n)} saved`,
  unitCurve: (n: number) => `${formatCount(n)} on the curve`,
  unitGap: (gap: number) => (gap === 0 ? "no gap" : gap > 0 ? `${formatCount(gap)} more saved` : `${formatCount(-gap)} fewer saved`),
  statuses: { close: "Close", differs: "Differs" },
  comparisonsShownLine: (shown: number, total: number) => `Showing the latest ${formatCount(shown)} of ${countOf(total, "saved export", "saved exports")}.`,

  noDatesNote: "No friend in your export has a usable date, so Snappy cannot draw a curve.",
  curveHighNote: "Anyone who left your list on their own is not on the curve. Earlier months may run high.",
  undatedJoinsNote: (n: number) => `${countOf(n, "friend", "friends")} ${n === 1 ? "has" : "have"} no start date. Snappy counts ${them(n)} from the first month.`,
  undatedLeavesNote: (n: number) => `${countOf(n, "removed friend", "removed friends")} ${n === 1 ? "has" : "have"} no removal date, so Snappy leaves ${them(n)} out.`,
  badDatesNote: (n: number) => `${countOf(n, "date", "dates")} ${n === 1 ? "is" : "are"} in the future or too old to be real. Snappy leaves ${n === 1 ? "it" : "them"} out.`,
  leaveBeforeJoinNote: (n: number) =>
    `${countOf(n, "removed friend", "removed friends")} ${n === 1 ? "has" : "have"} a removal date before the start date. Snappy leaves ${n === 1 ? "that removal" : "those removals"} out.`,
  reAddedNote: (n: number) => `${countOf(n, "friend", "friends")} ${n === 1 ? "is" : "are"} in both lists, so you may have added ${them(n)} back.`,
  badSnapshotsNote: (n: number) => `${countOf(n, "saved export", "saved exports")} had a missing or odd date. Snappy left ${n === 1 ? "it" : "them"} out.`,
  noSnapshotsNote: "No saved history was compared. Save your history with a passphrase in Settings to keep exports.",
  noEarlierNote: "No earlier export is saved yet, so there was nothing to compare.",
  oneSnapshotNote: "Only one saved export was found, so the comparison is a single point.",
  agreeNote: (n: number) => `The curve and your saved history are close at ${countOf(n, "saved export", "saved exports")}.`,
  disagreeNote: (disagreeing: number, compared: number, gap: number) =>
    `The curve and your saved history differ at ${formatCount(disagreeing)} of ${countOf(compared, "saved export", "saved exports")}. The largest gap is ${countOf(gap, "friend", "friends")}.`,
  exportErrorsNote: "Your export has errors, so the curve may be off. Run the export check for details.",
  otherNote: tools.otherNote,
} as const;
