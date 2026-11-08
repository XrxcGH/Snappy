/**
 * Waiting on a reply: every string this tool shows. Voice rules are in docs/BRAND.md. Keys end in the kind of
 * text they are (Heading, Header, Note, Line), because the copy lint reads the kind from the key.
 * Nothing here holds an export value: counts and dates come in as arguments, never a username.
 */
import { countOf, formatCount } from "../../format.ts";

const was = (n: number): string => (n === 1 ? "was" : "were");
const has = (n: number): string => (n === 1 ? "has" : "have");
const them = (n: number): string => (n === 1 ? "it" : "them");

export const copy = {
  title: "Waiting on a reply",
  oneLiner: "See who may be waiting on a reply.",
  description: "Find chats where someone may be waiting on you, or you on them, and chats where one side sends most.",
  reads: "Who sent each saved chat and Snap and when, counted per person in one-to-one chats.",
  empty: {
    title: "Nobody looks to be waiting",
    body: "No chat looks unanswered or one-sided. An export can miss messages, so check in Snapchat if you expect more.",
  },

  doneAnnounce: (you: number, theirs: number, oneSided: number): string =>
    `Replies checked. ${countOf(you, "person", "people")} may be waiting on you, ${formatCount(theirs)} on them, and ${countOf(oneSided, "chat", "chats")} look${oneSided === 1 ? "s" : ""} one-sided.`,

  countsHeading: "At a glance",
  youCountLabel: "Waiting on you",
  themCountLabel: "Waiting on them",
  oneSidedCountLabel: "One-sided chats",
  asOfLine: (date: string): string => `Counted up to ${date}.`,

  youHeading: "May be waiting on you",
  youLine: (days: number): string => `They wrote last, at least ${countOf(days, "day", "days")} ago, and you have not answered.`,
  youNoneLine: "No one looks to be waiting on a reply from you.",
  themHeading: "You may be waiting on",
  themLine: (days: number): string => `You wrote last, at least ${countOf(days, "day", "days")} ago, and they have not answered.`,
  themNoneLine: "You may not be waiting on anyone.",

  oneSidedHeading: "Chats that look one-sided",
  oneSidedLine: (days: number, percent: number): string => `In the last ${countOf(days, "day", "days")}, one side sent at least ${percent}% of the messages.`,
  oneSidedNoneLine: "No chat looks one-sided.",
  youSendHeading: "You send most",
  theySendHeading: "They send most",

  /** Under the result, also when nothing was found: the limits are fixed on this page, and the command line tool takes others. */
  limitsLine: (you: number, them: number): string =>
    `The limits are fixed here: ${countOf(you, "day", "days")} of silence for you and ${countOf(them, "day", "days")} for them. The command line tool changes them with --you-days and --them-days.`,

  unitDays: (n: number): string => countOf(n, "day", "days"),
  unitSince: (date: string): string => `since ${date}`,
  unitSentReceived: (sent: number, received: number): string => `${formatCount(sent)} sent, ${formatCount(received)} received`,

  hintNote: "These are hints. An export can miss messages, so check in Snapchat.",
  invalidNowNote: "Snappy could not read today’s date, so it left the lists empty.",
  noEventsNote: "Your export has no saved chats or Snaps to check.",
  noOneToOneNote: "Your saved chats are all group chats, which Snappy leaves out.",
  groupNote: (n: number): string => `${countOf(n, "group chat event", "group chat events")} ${was(n)} left out.`,
  noTimeNote: (n: number): string => `${countOf(n, "event", "events")} had no usable date and ${was(n)} left out.`,
  futureNote: (n: number): string => `${countOf(n, "event", "events")} ${was(n)} dated after your export. Snappy left ${them(n)} out.`,
  noPersonNote: (n: number): string => `${countOf(n, "event", "events")} had no person attached and ${was(n)} left out.`,
  notFriendsNote: (n: number): string => `${countOf(n, "chat", "chats")} with people outside your friends list ${was(n)} left out.`,
  unknownDirectionNote: (n: number): string => `${countOf(n, "chat", "chats")} could not be checked. The export may not say who wrote last.`,
  tiedNote: (n: number): string => `${countOf(n, "chat", "chats")} ${has(n)} a sent and a received message at the same moment. Snappy cannot tell which came last.`,
  tooOldNote: (n: number, days: number): string => `${countOf(n, "chat", "chats")} ${has(n)} been quiet for over ${countOf(days, "day", "days")}. Snappy does not list ${them(n)}.`,
  unreliableNote: (n: number): string => `${countOf(n, "chat", "chats")} had too many messages with no known direction to judge.`,
  otherNote: "Snappy found something it could not describe. The export check can say more.",
} as const;
