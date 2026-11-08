/**
 * Friendship anniversaries: every string this tool shows. Voice rules are in docs/BRAND.md. Keys end in the kind of
 * text they are (Heading, Header, Note, Line, Announce), because the copy lint reads the kind from the key.
 * Nothing here holds an export value: counts come in as arguments, and no function takes or returns a username.
 */
import { countOf, formatCount } from "../../format.ts";

const isOne = (n: number): boolean => n === 1;

/** The window as the end of a sentence. A piece that code joins into a sentence is a "unit" key. */
const unitWindow = (days: number): string => (days >= 366 ? "the next year" : `the next ${countOf(days, "day", "days")}`);

export const copy = {
  title: "Friendship anniversaries",
  oneLiner: "See which friendships reach a whole year soon.",
  description: "Find friendships that reach a whole number of years soon. Dates come from when each connection was created.",
  reads: "Usernames and the date each connection in your friends list was created.",
  empty: {
    title: "No anniversaries soon",
    body: "Snappy found no friendship that reaches a whole year in this window. Friends with no date are left out.",
  },

  unitWindow,
  foundAnnounce: (count: number, days: number): string => `${countOf(count, "anniversary", "anniversaries")} in ${unitWindow(days)}.`,
  noneAnnounce: (days: number): string => `No anniversaries in ${unitWindow(days)}.`,

  controlsLabel: "Choose what to show",
  windowLabel: "Look ahead",
  windowOptions: [
    { days: 30, label: "Next 30 days" },
    { days: 90, label: "Next 90 days" },
    { days: 366, label: "Next year" },
  ],
  milestonesLabel: "Milestones only",
  milestonesHelp: "Milestones are 1, 2, 3, 5 and 10 years.",

  glanceHeading: "At a glance",
  upcomingFact: "Coming up",
  milestoneFact: "Milestones",
  datedFact: "Friends with a date",

  upcomingHeading: "Coming up",
  upcomingCaption: "Upcoming friendship anniversaries",
  dateHeader: "Date",
  friendHeader: "Friend",
  reachesHeader: "Reaches",
  whenHeader: "When",
  yearsCell: (years: number, milestone: boolean): string => (milestone ? `${countOf(years, "year", "years")}, milestone` : countOf(years, "year", "years")),
  whenCell: (days: number): string => (days === 0 ? "Today" : days === 1 ? "Tomorrow" : `In ${countOf(days, "day", "days")}`),
  moreLine: (shown: number, total: number): string => `Showing the first ${formatCount(shown)} of ${formatCount(total)}. Choose a shorter window to see fewer.`,

  caveatNote: "Dates come from when each connection was created. They may not match when you first met.",
  leapNote: "Anniversaries for Feb 29 fall on Feb 28 in years that have no Feb 29.",
  missingNote: (n: number): string => `${countOf(n, "friend", "friends")} ${isOne(n) ? "has" : "have"} no date and ${isOne(n) ? "is" : "are"} left out.`,
  futureNote: (n: number): string => `${countOf(n, "date", "dates")} ${isOne(n) ? "is" : "are"} in the future, so Snappy leaves ${isOne(n) ? "it" : "them"} out.`,
  duplicateNote: (n: number): string => `${countOf(n, "repeated username", "repeated usernames")} in your friends list. Snappy counts each person once.`,
  invalidNote: (n: number): string => `${countOf(n, "entry", "entries")} had no username and ${isOne(n) ? "was" : "were"} left out.`,
  nowInvalidNote: "Snappy could not read the date on your device, so it found nothing.",
} as const;
