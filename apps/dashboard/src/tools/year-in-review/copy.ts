/**
 * Year in review: every string this tool shows. Voice rules are in docs/BRAND.md. Keys end in the kind of text
 * they are (Heading, Header, Note, Label, Line, Announce), because the copy lint reads the kind from the key.
 * Nothing here holds an export value: counts, percentages, years and dates come in as arguments, and nothing
 * takes or returns a username (this tool reads dates, directions and media types only, so it has none).
 */
import { common } from "../../copy.ts";
import { countOf } from "../../format.ts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;

const things = (n: number): string => countOf(n, "chat or Snap", "chats and Snaps");
const items = (n: number): string => countOf(n, "item", "items");
const isYear = (year: number): boolean => Number.isInteger(year) && year >= 1969 && year <= 2200;

export const copy = {
  title: "Year in review",
  oneLiner: "Sum up a year of chats, Snaps and Memories.",
  description: "See one year of chats, Snaps, new friends and Memories. Results use dates, directions and media types only.",
  reads: "The date, direction and kind of each chat and Snap, friend dates, and Memories dates and types.",
  empty: {
    title: "No dated activity found",
    body: "Snappy found nothing with a usable date to sum up. The export check shows what may be missing.",
  },

  yearLabel: "Year",
  yearHelp: "Snappy starts with the latest year that has dates.",
  latestLabel: "Latest year",
  zoneLabel: "Time zone",
  zoneHelp: "Months and days follow this time zone. Snappy starts with the zone of this device.",

  summaryAnnounce: (year: number, count: number) => (isYear(year) ? `Year in review for ${year} counted ${things(count)}.` : ""),
  quietAnnounce: (year: number) => (isYear(year) ? `Year in review found no chats or Snaps in ${year}.` : ""),
  emptyAnnounce: "Year in review found nothing with a usable date.",

  glanceHeading: "At a glance",
  chatsLabel: "Chats and Snaps",
  activeDaysLabel: "Active days",
  memoriesLabel: "Memories",
  newFriendsLabel: "New friends",
  removedLabel: "Friends removed",
  gapLabel: "Longest gap",
  noValue: common.noFigure,
  /** The tile for the longest quiet stretch, in days. */
  unitGapDays: (days: number): string => (Number.isFinite(days) && days >= 0 ? countOf(days, "day", "days") : ""),

  busiestHeading: "Busiest times",
  busiestCaption: "Busiest month and day",
  patternHeader: "Pattern",
  busiestHeader: "Busiest",
  countHeader: "Count",
  shareHeader: "Share",
  monthPattern: "Month",
  dayPattern: "Day",
  /** A busiest value that other months or days match. */
  unitTied: (value: string): string => `${value} (tied)`,
  /** Cells of the busiest table. At phone width the column names are not repeated, so each cell says what it is. */
  unitBusiestAt: (value: string): string => `${value} is busiest`,
  unitCounted: (count: string): string => `${count} counted`,
  unitOfYear: (percent: string): string => `${percent} of the year`,

  datesHeading: "Key dates",
  firstLabel: "First",
  lastLabel: "Last",
  quietLabel: "Longest quiet stretch",
  /** "Mar 2, 2025 to Mar 13, 2025". */
  unitRange: (start: string, end: string): string => `${start} to ${end}`,
  /** A stretch of one day or more that starts and ends on the same date: "On Jan 21, 2026 (1 day)". */
  unitOneDay: (date: string, days: number): string => `On ${date} (${countOf(days, "day", "days")})`,

  directionHeading: "Sent and received",
  directionCaption: "Snaps and saved chats by direction",
  typeHeader: "Type",
  totalHeader: "Total",
  sentHeader: "Sent",
  receivedHeader: "Received",
  unknownHeader: "Unknown",
  snapsRow: "Snaps",
  chatsRow: "Saved chats",
  bothRow: "Both",
  unitTotal: (count: string): string => `${count} in all`,
  unitSent: (count: string): string => `${count} sent`,
  unitReceived: (count: string): string => `${count} received`,
  unitUnknown: (count: string): string => `${count} unknown`,

  monthHeading: "By month",
  memoriesMonthHeading: "Memories by month",
  months: MONTHS,
  monthsLong: MONTHS_LONG,

  noDataNote: "Nothing has a usable date, so there is no year to show.",
  yearInvalidNote: "That year could not be used, so Snappy chose the latest one.",
  noActivityDataNote: "No chats or Snaps with a usable date were found.",
  noFriendDatesNote: "No friend has a usable date, so new friends are not counted.",
  noRemovalDatesNote: "No removed friend has a usable date, so removals are not counted.",
  noMemoriesNote: "No Memory has a usable date, so Memories are not counted.",
  noActivityInYearNote: (year: number) => (isYear(year) ? `No chats or Snaps are dated in ${year}.` : ""),
  fewNote: (n: number) => `Only ${things(n)} ${n === 1 ? "was" : "were"} counted, so this year may look thin.`,
  unknownNote: (percent: number) => (Number.isFinite(percent) ? `About ${percent}% have no known direction, so sent and received may be off.` : ""),
  progressNote: (year: number) => (isYear(year) ? `${year} is not over yet, so these numbers may still grow.` : ""),
  undatedNote: (n: number) => `${items(n)} ${n === 1 ? "has" : "have"} no usable date. Snappy leaves ${n === 1 ? "it" : "them"} out.`,
  futureNote: (n: number) => `${items(n)} ${n === 1 ? "is" : "are"} dated in the future. Snappy leaves ${n === 1 ? "it" : "them"} out.`,
  zoneNote: "The time zone was moved to the nearest allowed one.",
  savedChatsNote: "Only saved chats are in the export, so chat counts may be lower than what you sent.",
  currentFriendsNote: "New friends counts people still on your list, so it may be lower than the real number.",
  otherNote: "Snappy found something it could not describe. The export check can say more.",
} as const;
