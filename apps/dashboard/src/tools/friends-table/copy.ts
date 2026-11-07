/**
 * Friends table: every string this tool shows. Voice rules are in docs/BRAND.md. Keys end in the kind of text they
 * are (Heading, Header, Label, Cell, Note, Line, Button, Announce), because the copy lint reads the kind from the key.
 * Nothing here holds a username: counts and dates come in as arguments, never a name.
 */
import { countOf, formatCount } from "../../format.ts";

const was = (n: number): string => (n === 1 ? "was" : "were");
const has = (n: number): string => (n === 1 ? "has" : "have");
const them = (n: number): string => (n === 1 ? "it" : "them");

export const copy = {
  title: "Friends table",
  oneLiner: "Sort and filter your friends in one table.",
  description: "See every friend with when you added them, your last chat or Snap and a few hints. Sort, filter and download it.",
  reads: "Usernames and added dates from your friends list, plus who sent each saved chat and Snap and when.",
  empty: {
    title: "No friends to show",
    body: "Snappy found no usable usernames in your friends list, so there is nothing to put in the table.",
  },

  doneAnnounce: (friends: number, quiet: number, waiting: number): string =>
    `Friends table ready: ${countOf(friends, "friend", "friends")}, ${formatCount(quiet)} may be quiet and ${formatCount(waiting)} may be waiting on a reply.`,

  glanceHeading: "At a glance",
  friendsLabel: "Friends",
  withChatsLabel: "With chats",
  quietLabel: "May be quiet",
  oneSidedLabel: "May be one-sided",
  waitingLabel: "May be waiting",
  asOfLine: (date: string): string => `Counted up to ${date}.`,

  controlsLabel: "Sort and filter",
  sortLabel: "Sort by",
  showLabel: "Show",
  startsLabel: "Username starts with",
  applyButton: "Show matches",
  // Keyed by the ids in model.ts, so this file holds words only.
  sortLabels: {
    "username-asc": "Username, A to Z",
    "username-desc": "Username, Z to A",
    "added-desc": "Added, newest first",
    "added-asc": "Added, oldest first",
    "last-desc": "Last chat or Snap, newest first",
    "last-asc": "Last chat or Snap, oldest first",
    "first-asc": "First chat or Snap, oldest first",
    "total-desc": "Most chats and Snaps",
    "total-asc": "Fewest chats and Snaps",
    "recent-desc": "Most in the last 90 days",
    "sent-desc": "Most sent by you",
    "received-desc": "Most sent to you",
  },
  showLabels: {
    all: "All friends",
    quiet: "May be quiet",
    "one-sided": "May be one-sided",
    waiting: "May be waiting on a reply",
    "waiting-you": "May be waiting on you",
    "waiting-them": "You may be waiting on them",
  },

  friendsHeading: "Your friends",
  tableCaption: "Friends with dates, counts and hints",
  friendHeader: "Friend",
  addedHeader: "Added",
  lastHeader: "Last chat or Snap",
  totalHeader: "Total",
  sentHeader: "Sent",
  receivedHeader: "Received",
  hintsHeader: "Hints",
  addedCell: (date: string): string => `Added ${date}`,
  noAddedCell: "Added date unknown",
  lastCell: (date: string): string => `Last ${date}`,
  noLastCell: "No chats or Snaps",
  totalCell: (n: number): string => `${formatCount(n)} total`,
  sentCell: (n: number): string => `${formatCount(n)} sent`,
  receivedCell: (n: number): string => `${formatCount(n)} received`,
  noHintsCell: "No hints",
  matchLine: (shown: number, all: number): string => `${countOf(shown, "friend", "friends")} ${shown === 1 ? "matches" : "match"} your filters, out of ${formatCount(all)}.`,
  noMatchLine: "No friends match these filters.",

  hintsHeading: "How hints work",
  quietLine: (days: number): string => `Quiet: no chat or Snap for ${countOf(days, "day", "days")}.`,
  oneSidedLine: (days: number): string => `One-sided: in the last ${countOf(days, "day", "days")}, one side sent most of the messages.`,
  waitingLine: "Waiting: the last message may still be unanswered, so someone may be waiting on a reply.",
  unitQuiet: "quiet",
  unitOneSided: "one-sided",
  unitWaitingYou: "waiting on you",
  unitWaitingThem: "waiting on them",

  downloadLabel: "Download CSV",
  downloadNote: "The file lists the friends in the table above, with usernames. Keep it private.",

  hintNote: "Hints are guesses from saved chats and Snaps. An export can miss messages, so check in the app.",
  invalidNowNote: "Snappy could not read today’s date, so it left the table empty.",
  noFriendsNote: "Your export has no usable friends, so the table is empty.",
  noEventsNote: "Your export has no saved chats or Snaps, so the chat columns are empty.",
  noTimeNote: (n: number): string => `${countOf(n, "event", "events")} had no usable date and ${was(n)} left out.`,
  futureNote: (n: number): string => `${countOf(n, "event", "events")} ${n === 1 ? "is" : "are"} dated after your export. Snappy left ${them(n)} out.`,
  groupNote: (n: number): string => `${countOf(n, "group chat event", "group chat events")} ${was(n)} left out.`,
  notFriendsNote: (n: number): string => `${countOf(n, "event", "events")} with people outside your friends list ${was(n)} left out.`,
  duplicatesNote: (n: number): string => `${countOf(n, "repeated friend", "repeated friends")} ${was(n)} merged, so each person is listed once.`,
  invalidUsernameNote: (n: number): string => `${countOf(n, "friend", "friends")} had no usable username and ${was(n)} left out.`,
  noAddedNote: (n: number): string => `${countOf(n, "friend", "friends")} ${has(n)} no added date, so Snappy could not check them for quiet.`,
  quietNoActivityNote: "Your export has no one-to-one chats or Snaps, so Snappy did not mark anyone as quiet.",
  quietShortNote: (n: number): string => `${countOf(n, "friend", "friends")} without chats ${was(n)} not checked for quiet, since your chats start too recently.`,
  otherNote: "Snappy noted something it cannot describe here.",
} as const;
