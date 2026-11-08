/**
 * Memories timeline gaps: every string this tool shows. Voice rules are in docs/BRAND.md. Keys end in the kind of
 * text they are (Heading, Header, Note, Line, Announce), because the copy lint reads the kind from the key.
 * Nothing here holds an export value: counts and month names come in as arguments, and no function takes or returns a username.
 */
import { tools } from "../../copy.ts";
import { zone } from "../../copy-tools.ts";
import { countOf, formatCount } from "../../format.ts";

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

const isOne = (n: number): boolean => n === 1;

export const copy = {
  title: "Memories timeline gaps",
  oneLiner: "Find quiet stretches in your Memories timeline.",
  description: "See the months with no Memories and the months with the most. A gap may be a quiet time.",
  reads: "The capture dates in your Memories list and the oldest date in your friends list.",
  empty: {
    title: "No dated Memories",
    body: "Your Memories list has no usable dates. Request your export again with Memories included.",
  },

  minGapLabel: "Shortest gap",
  stretchLabel: "Busiest stretch",
  zoneLabel: zone.selectLabel,
  /** "1 month", "6 months". */
  unitMonths: (n: number): string => countOf(n, "month", "months"),
  /** "Mar 2021". */
  unitMonthYear: (month: number, year: number): string => `${months[month - 1]} ${year}`,
  /** "Mar 2021 to May 2021". */
  unitSpan: (from: string, to: string): string => `${from} to ${to}`,
  unitHinted: ", export may be limited",

  glanceHeading: "At a glance",
  datedFact: "Dated Memories",
  spanFact: "Months covered",
  emptyFact: "Empty months",
  longestFact: "Longest gap",
  noGapFact: "None",

  gapsHeading: "Gaps",
  gapsCaption: "Gaps in your Memories timeline",
  fromHeader: "From",
  toHeader: "To",
  whereHeader: "Where",
  lengthHeader: "Length",
  whereStart: "Before first Memory",
  whereMiddle: "Between Memories",
  whereEnd: "Since last Memory",
  noGapsLine: (minGap: number): string => `No gaps of ${countOf(minGap, "month", "months")} or more.`,
  moreLine: (shown: number, total: number): string => `Showing the first ${formatCount(shown)} of ${formatCount(total)}. Raise the shortest gap to see fewer.`,

  busiestHeading: "Busiest times",
  busiestCaption: "Months with the most Memories",
  highlightHeader: "Highlight",
  whenHeader: "When",
  memoriesHeader: "Memories",
  shareHeader: "Share",
  busiestMonthCell: "Busiest month",
  stretchCell: (stretch: number): string => `Busiest ${countOf(stretch, "month", "months")}`,
  unitMemories: (n: number): string => countOf(n, "Memory", "Memories"),
  unitShare: (percent: string): string => `${percent} of dated`,

  foundAnnounce: (count: number): string => `${countOf(count, "gap", "gaps")} found in your Memories timeline.`,
  noneAnnounce: (minGap: number): string => `No gaps of ${countOf(minGap, "month", "months")} or more found.`,
  emptyAnnounce: "No Memories have a usable date.",

  offsetNote: (label: string): string => `Dates use ${label}, a fixed offset that does not follow daylight saving.`,
  offsetInvalidNote: "That UTC offset is not valid, so Snappy used UTC.",
  nowInvalidNote: "Snappy could not read the date on your device, so it could not tell which dates are in the future.",
  minGapNote: (n: number): string => `The shortest gap was changed to ${countOf(n, "month", "months")}.`,
  stretchNote: (n: number): string => `The busiest stretch was changed to ${countOf(n, "month", "months")}.`,
  sinceInvalidNote: "Snappy could not use your oldest friend date, so it left out gaps before your first Memory.",
  exportDateInvalidNote: "The export date is not usable, so Snappy used today’s date.",
  exportDateFutureNote: "The export date is in the future, so Snappy used today’s date.",
  undatedNote: (n: number): string => `${countOf(n, "Memory has", "Memories have")} no usable date, so Snappy left ${isOne(n) ? "it" : "them"} out.`,
  futureNote: (n: number): string => `${countOf(n, "Memory is", "Memories are")} dated in the future. A device clock may have been wrong, so Snappy left ${isOne(n) ? "it" : "them"} out.`,
  duplicateNote: (n: number): string => `${countOf(n, "repeated Memory", "repeated Memories")} ${isOne(n) ? "was" : "were"} counted once.`,
  noDatesNote: "No Memories have a usable date.",
  singleMonthNote: "All dated Memories fall in one month, so there is no timeline to compare.",
  quietNote: (n: number): string => `${isOne(n) ? "This gap" : "These gaps"} may be a quiet time. Snappy cannot tell if anything is missing.`,
  limitedNote: (n: number): string => `${countOf(n, "gap", "gaps")} at the start or end may come from a date range chosen for the export.`,
  startNote: "Early gaps count from your oldest friend date.",
  otherNote: tools.otherNote,
} as const;
