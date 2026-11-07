/**
 * Who reaches out first: every string this tool shows. Voice rules are in docs/BRAND.md. Keys end in the kind of
 * text they are (Heading, Header, Note, Line, Announce), because the copy lint reads the kind from the key.
 * Nothing here holds an export value: counts and dates come in as arguments, and no function takes a name.
 */
import { countOf } from "../../format.ts";

const was = (n: number): string => (n === 1 ? "was" : "were");
const has = (n: number): string => (n === 1 ? "has" : "have");
const isAre = (n: number): string => (n === 1 ? "is" : "are");
const them = (n: number): string => (n === 1 ? "it" : "them");

export const copy = {
  title: "Who reaches out first",
  oneLiner: "See who tends to reach out first.",
  description: "Split each chat into exchanges and see who usually starts them: you, them or neither.",
  reads: "Who sent each saved chat and Snap and when, counted per person in one-to-one chats.",
  empty: {
    title: "No clear starters yet",
    body: "No chat has exchanges with a known starter. An export can miss messages, so check in the app if you expect more.",
  },

  doneAnnounce: (theirs: number, yours: number): string =>
    `Reach-out checked. They mostly reach out first in ${countOf(theirs, "chat", "chats")}, and you in ${countOf(yours, "chat", "chats")}.`,
  emptyAnnounce: "Reach-out checked. No exchange has a known starter.",

  gapLabel: "Hours of silence between exchanges",
  /** Reads out each choice in full, since the button itself shows only the number. */
  unitGap: (hours: number): string => countOf(hours, "hour", "hours"),

  glanceHeading: "At a glance",
  chatsLabel: "Chats checked",
  exchangesLabel: "Exchanges",
  youLabel: "You started",
  themLabel: "They started",
  shareLine: (you: string, theirs: string): string => `You started ${you} of the exchanges and they started ${theirs}.`,
  methodLine: (date: string, hours: number): string => `Counted up to ${date}. A new exchange starts after ${countOf(hours, "hour", "hours")} of silence.`,

  themHeading: "They mostly reach out first",
  themCaption: "Chats where they start most exchanges",
  themRuleLine: (min: number, percent: number): string => `In chats with at least ${countOf(min, "exchange", "exchanges")}, they started ${percent}% or more.`,
  themNoneLine: "No chat shows them starting most of the exchanges.",
  youHeading: "You mostly reach out first",
  youCaption: "Chats where you start most exchanges",
  youRuleLine: (min: number, percent: number): string => `In chats with at least ${countOf(min, "exchange", "exchanges")}, you started ${percent}% or more.`,
  youNoneLine: "No chat shows you starting most of the exchanges.",
  moreLine: (n: number): string => `${countOf(n, "more chat", "more chats")} not shown.`,

  friendHeader: "Friend",
  youStartedHeader: "You started",
  theyStartedHeader: "They started",
  shareHeader: "Share",

  hintNote: "These are hints. An export can miss messages, so check in the app.",
  invalidNowNote: "Snappy could not read today’s date, so it left the lists empty.",
  noEventsNote: "Your export has no saved chats or Snaps to check.",
  noOneToOneNote: "Your saved chats are all group chats, which Snappy leaves out.",
  groupNote: (n: number): string => `${countOf(n, "group chat event", "group chat events")} ${was(n)} left out.`,
  noTimeNote: (n: number): string => `${countOf(n, "event", "events")} had no usable date and ${was(n)} left out.`,
  futureNote: (n: number): string => `${countOf(n, "event", "events")} ${isAre(n)} dated after your export. Snappy left ${them(n)} out.`,
  noPersonNote: (n: number): string => `${countOf(n, "event", "events")} had no person attached and ${was(n)} left out.`,
  notFriendsNote: (n: number): string => `${countOf(n, "chat", "chats")} with people outside your friends list ${was(n)} left out.`,
  starterUnknownNote: (n: number): string => `${countOf(n, "exchange", "exchanges")} could not be counted. The export may not say who wrote first.`,
  starterTiedNote: (n: number): string => `${countOf(n, "exchange", "exchanges")} began with a sent and a received message at the same moment. Snappy cannot tell who wrote first.`,
  tooFewNote: (n: number): string => `${countOf(n, "chat", "chats")} ${has(n)} too few exchanges to judge. Snappy does not list ${them(n)}.`,
  unreliableNote: (n: number): string => `${countOf(n, "chat", "chats")} had too many exchanges with no known starter to judge.`,
  otherNote: "Snappy noted something it cannot describe here.",
} as const;
