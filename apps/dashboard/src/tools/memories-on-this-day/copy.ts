/**
 * Memories on this day: every string this tool shows. Voice rules are in docs/BRAND.md. Keys end in the kind of
 * text they are (Heading, Header, Note, Line, Announce), because the copy lint reads the kind from the key.
 * Nothing here holds an export value: counts, years and dates come in as arguments, and a Memory is never named.
 */
import { countOf } from "../../format.ts";

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export const copy = {
  title: "Memories on this day",
  oneLiner: "See Memories from this day in earlier years.",
  description: "See the Memories you saved on this day in earlier years, and which years and days hold the most.",
  reads: "The capture dates in your Memories list, counted by day, month and year.",
  empty: {
    title: "No dated Memories",
    body: "Your Memories list has no usable dates. Request your export again with Memories included.",
  },

  dateLabel: "Day",
  dateHelpNote: "Leave it blank to use today.",
  windowLabel: "Days either side",
  zoneLabel: "Time zone",
  /** "None", "1 day", "3 days". */
  unitWindow: (days: number): string => (days === 0 ? "None" : countOf(days, "day", "days")),

  dayHeading: "On this day",
  lookingLine: (date: string, today: boolean, windowDays: number) =>
    `Looking at ${date}${today ? " (today)" : ""}${windowDays > 0 ? `, with ${countOf(windowDays, "day", "days")} either side` : ""}.`,
  foundLine: (total: number, years: number, near: boolean) =>
    `${countOf(total, "Memory", "Memories")} from ${near ? "around this" : "this"} day in ${countOf(years, "year", "years")}.`,
  noneLine: (near: boolean) => `No Memories from ${near ? "around this" : "this"} day in earlier years.`,
  dayCaption: "Memories on this day, by year",
  yearHeader: "Year",
  whenHeader: "When",
  memoriesHeader: "Memories",
  unitAgo: (years: number) => (years <= 0 ? "Same year" : `${countOf(years, "year", "years")} ago`),

  yearsHeading: "Memories by year",
  datedLabel: "Dated Memories",
  spanLabel: "Years covered",
  leftOutLabel: "Left out",
  unitYearSpan: (first: number, last: number) => (first === last ? String(first) : `${first} to ${last}`),
  yearsCaption: "Memories in each year",
  busiestHeader: "Busiest month",
  months,
  unitBusiest: (month: number, count: number) => `${months[month - 1]} busiest (${count})`,
  unitNoBusiest: "No busiest month",
  unitMemories: (n: number) => countOf(n, "Memory", "Memories"),
  unitYears: (n: number) => countOf(n, "year", "years"),

  topDaysHeading: "Busiest days of the year",
  topDaysCaption: "Busiest days across all years",
  dayHeader: "Day",
  yearsHeader: "Years",
  unitMonthDay: (month: number, day: number) => `${months[month - 1]} ${day}`,

  foundAnnounce: (total: number, near: boolean) => `${countOf(total, "Memory", "Memories")} found from ${near ? "around " : ""}this day in earlier years.`,
  noneAnnounce: (near: boolean) => `No Memories found from ${near ? "around " : ""}this day in earlier years.`,
  emptyAnnounce: "No Memories have a usable date.",

  offsetNote: (label: string) => `Dates use ${label}, a fixed offset that does not follow daylight saving.`,
  undatedNote: (n: number) => `${countOf(n, "Memory has", "Memories have")} no usable date, so Snappy left ${n === 1 ? "it" : "them"} out.`,
  futureNote: (n: number) => `${countOf(n, "Memory is", "Memories are")} dated in the future. A device clock may have been wrong, so Snappy left ${n === 1 ? "it" : "them"} out.`,
  duplicateNote: (n: number) => `${countOf(n, "repeated Memory", "repeated Memories")} ${n === 1 ? "was" : "were"} counted once.`,
  noIdNote: (n: number) => `${countOf(n, "Memory", "Memories")} without an id ${n === 1 ? "was" : "were"} left out.`,
  noDatesNote: "No Memories have a usable date.",
  invalidDayNote: "Snappy cannot use that day. Pick another one.",
  windowNote: (days: number) => `The days either side were changed to ${days}.`,
  leapNote: (n: number) => `${countOf(n, "Memory", "Memories")} from Feb 29 ${n === 1 ? "is" : "are"} shown on Feb 28, since this year has no Feb 29.`,
  offsetInvalidNote: "That time zone is not valid, so Snappy used UTC.",
  otherNote: "Snappy noted something it cannot describe here.",
} as const;
