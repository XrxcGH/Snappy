/**
 * Habits: every string this tool shows. Voice rules are in docs/BRAND.md. Keys end in the kind of text
 * they are (Heading, Header, Note, Label, Line, Announce), because the copy lint reads the kind from the key.
 * Nothing here holds an export value: counts, percentages and dates come in as arguments, and nothing
 * takes or returns a username (this tool reads times and directions only, so it has none).
 */
import { common, tools } from "../../copy.ts";
import { countOf, formatCount, formatDuration } from "../../format.ts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

const things = (n: number): string => countOf(n, "chat or Snap", "chats and Snaps");

export const copy = {
  title: "Chat and Snap habits",
  oneLiner: "See when you chat and Snap most.",
  description: "See when you chat and Snap most, by hour, day and month. Results use only times and directions.",
  reads: "The time and direction (sent or received) of each chat and Snap, as counts and dates.",
  empty: {
    title: "No dated activity found",
    body: "Snappy found no chats or Snaps with a usable date to count. The export check shows what may be missing.",
  },

  zoneLabel: "Time zone",
  zoneHelp: "Hours, days and months follow this time zone. Snappy starts with your device’s time zone.",
  summaryAnnounce: (used: number, days: number) => `Habits counted ${things(used)} on ${countOf(days, "day", "days")}.`,
  emptyAnnounce: "Habits found nothing with a usable date.",

  glanceHeading: "At a glance",
  countedLabel: "Counted",
  activeDaysLabel: "Active days",
  firstLabel: "First",
  lastLabel: "Last",
  gapLabel: "Typical gap",
  /** The typical time between two chats or Snaps, in words: the same rule as every duration on the pages. */
  unitGap: formatDuration,

  busiestHeading: "Busiest times",
  busiestCaption: "Busiest and quietest times",
  patternHeader: "Pattern",
  busiestHeader: "Busiest",
  shareHeader: "Share",
  quietestHeader: "Quietest",
  hourPattern: "Hour of day",
  weekdayPattern: "Day of week",
  monthPattern: "Month",
  noValue: common.noFigure,
  /** A busiest or quietest value that other times match. */
  unitTied: (value: string): string => `${value} (tied)`,
  /** Cells of the busiest table. At phone width the column names are not repeated, so each cell says what it is. */
  unitBusiestAt: (value: string): string => `${value} is busiest`,
  unitQuietestAt: (value: string): string => `${value} is quietest`,
  unitNoQuietest: "Quietest: not named",
  noQuietestCell: "Not named",
  unitPeakShare: (percent: string, noun: string): string => `${percent} in the busiest ${noun}`,
  unitCounted: (count: string): string => `${count} counted`,
  unitOfTotal: (percent: string): string => `${percent} of the total`,
  unitHourNoun: "hour",
  unitWeekdayNoun: "day",
  unitMonthNoun: "month",

  directionHeading: "Sent and received",
  directionCaption: "Chats and Snaps by direction",
  directionHeader: "Direction",
  countHeader: "Count",
  sentRow: "Sent",
  receivedRow: "Received",
  unknownRow: "Unknown",
  sentLine: (percent: number) => (Number.isFinite(percent) ? `Of those with a known direction, you sent about ${percent}%.` : ""),

  hourHeading: "By hour of day",
  weekdayHeading: "By day of week",
  monthHeading: "By month",
  monthsShownLine: (shown: number, total: number) => `Showing the latest ${countOf(shown, "month", "months")} of ${formatCount(total)}.`,
  /** "9 AM", "12 PM". */
  unitHour: (hour: number): string => (Number.isInteger(hour) && hour >= 0 && hour < 24 ? `${hour % 12 === 0 ? 12 : hour % 12} ${hour < 12 ? "AM" : "PM"}` : ""),
  weekdays: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  /** "Mar 2026", from a year and a month number (1 to 12). */
  unitMonth: (year: number, month: number): string => {
    const name = MONTHS[month - 1];
    return name === undefined || !Number.isFinite(year) ? "" : `${name} ${year}`;
  },

  noneNote: "No chats or Snaps with a usable date were found.",
  undatedNote: (n: number) => `${things(n)} ${n === 1 ? "has" : "have"} no usable date. Snappy leaves ${n === 1 ? "it" : "them"} out.`,
  futureNote: (n: number) => `${things(n)} ${n === 1 ? "is" : "are"} dated in the future. Snappy leaves ${n === 1 ? "it" : "them"} out.`,
  fewNote: (n: number) => `Only ${things(n)} ${n === 1 ? "was" : "were"} counted, so these patterns may be weak.`,
  unknownNote: (percent: number) => (Number.isFinite(percent) ? `About ${percent}% have no known direction, so the sent share may be off.` : ""),
  zoneNote: "The time zone was moved to the nearest allowed one.",
  partialNote: "The first and last months may be partial, so Snappy does not call either of them the quietest.",
  otherNote: tools.otherNote,
} as const;
