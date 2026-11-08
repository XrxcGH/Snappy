/**
 * Reply speed: every string this tool shows. Voice rules are in docs/BRAND.md. Keys end in the kind of text
 * they are (Heading, Header, Note, Label, Line, Cell, Announce), because the copy lint reads the kind from the key.
 * Nothing here holds an export value: counts, times and dates come in as arguments, and nothing takes or returns
 * a username (the friends tables are drawn by the view, which puts each name in the shared username element).
 */
import { countOf, formatCount } from "../../format.ts";

const was = (n: number): string => (n === 1 ? "was" : "were");
const has = (n: number): string => (n === 1 ? "has" : "have");
const them = (n: number): string => (n === 1 ? "it" : "them");
const hoursOf = (hours: number): string => countOf(hours, "hour", "hours");

export const copy = {
  title: "Reply speed",
  oneLiner: "See how fast you and friends reply.",
  description: "See how long you and your friends take to reply in one-to-one chats. Results use only who wrote and when.",
  reads: "Who wrote each saved chat and Snap and when, in one-to-one chats.",
  empty: {
    title: "No replies to time",
    body: "Snappy found no replies in your one-to-one chats. The export check shows what may be missing.",
  },

  doneAnnounce: (you: number, theirs: number): string => `Reply speed counted ${countOf(you, "reply", "replies")} of yours and ${formatCount(theirs)} of theirs.`,
  emptyAnnounce: "Reply speed found no replies to time.",

  zoneLabel: "Time zone",
  zoneHelp: "The hour of day follows this time zone. Snappy starts with the zone of this device.",
  /** A reply time in words: "40 seconds", "12 minutes", "5 hours", "2 days". */
  unitDuration: (ms: number): string => {
    if (!Number.isFinite(ms) || ms < 0) return "";
    if (ms < 1000) return "Under 1 second";
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) return countOf(seconds, "second", "seconds");
    const minutes = Math.round(ms / 60_000);
    if (minutes < 120) return countOf(minutes, "minute", "minutes");
    const hours = Math.round(ms / 3_600_000);
    if (hours < 48) return countOf(hours, "hour", "hours");
    return countOf(Math.round(ms / 86_400_000), "day", "days");
  },

  glanceHeading: "At a glance",
  youTypicalLabel: "Your typical time",
  themTypicalLabel: "Their typical time",
  youCountLabel: "Your replies",
  themCountLabel: "Their replies",
  noValue: "-",
  asOfLine: (date: string): string => `Counted up to ${date}.`,
  methodLine: (hours: number): string => `A reply is a change of sender within ${hoursOf(hours)}. A run of messages counts as one turn.`,
  youNineLine: (time: string): string => `Nine in ten of your replies came within ${time}.`,
  themNineLine: (time: string): string => `Nine in ten of their replies came within ${time}.`,

  rankHeading: "Fastest and slowest",
  rankLine: (min: number): string => `Ranked by typical time. A friend needs ${countOf(min, "reply", "replies")} on a side to be ranked.`,
  rankNoneLine: "No friend has enough replies to rank yet.",
  youFastHeading: "You reply fastest to",
  youSlowHeading: "You reply slowest to",
  themFastHeading: "Friends reply fastest",
  themSlowHeading: "Friends reply slowest",
  youFastCaption: "Friends you reply to fastest",
  youSlowCaption: "Friends you reply to slowest",
  themFastCaption: "Friends who reply to you fastest",
  themSlowCaption: "Friends who reply to you slowest",
  friendHeader: "Friend",
  typicalHeader: "Typical",
  repliesHeader: "Replies",
  unitTypicalCell: (time: string): string => (time === "" ? "" : `${time} typical`),
  unitRepliesCell: (n: number): string => countOf(n, "reply", "replies"),

  hourHeading: "By hour of day",
  hourCaption: "Replies by hour of day",
  hourLine: (zone: string): string => `The hour is when the reply was sent, in ${zone}.`,
  hourHeader: "Hour",
  hourYouHeader: "You",
  hourThemHeader: "Friends",
  /** "9 am", "12 pm". */
  unitHour: (hour: number): string => (Number.isInteger(hour) && hour >= 0 && hour < 24 ? `${hour % 12 === 0 ? 12 : hour % 12} ${hour < 12 ? "am" : "pm"}` : ""),
  /** One side of an hour: the count, and the typical time when there are enough replies. An empty time means too few. */
  hourCell: (n: number, time: string): string => (n === 0 ? "No replies" : typeof time !== "string" || time === "" ? `${countOf(n, "reply", "replies")}, too few to time` : `${countOf(n, "reply", "replies")}, ${time} typical`),

  friendsHeading: "Friends",
  friendsCaption: "Reply times by friend",
  friendsLine: (min: number): string => `Most replies first. A friend needs ${countOf(min, "reply", "replies")} on a side to get a time.`,
  youRepliesHeader: "Your replies",
  youTypicalHeader: "Your typical",
  themRepliesHeader: "Their replies",
  themTypicalHeader: "Their typical",
  tooFewCell: "Too few to time",
  friendsMoreLine: (n: number): string => `${countOf(n, "more friend", "more friends")} not shown. The CSV has every row.`,

  hintNote: "These are hints. An export can miss messages, so times may be off.",
  invalidNowNote: "Snappy could not read today’s date, so it left the results empty.",
  noEventsNote: "Your export has no saved chats or Snaps, so there are no replies to time.",
  noOneToOneNote: "Your saved chats are all group chats, which Snappy leaves out.",
  noRepliesNote: (hours: number): string => `Snappy found no replies to time. A reply is a change of sender within ${hoursOf(hours)}.`,
  noTimeNote: (n: number): string => `${countOf(n, "event", "events")} had no usable date and ${was(n)} left out.`,
  futureNote: (n: number): string => `${countOf(n, "event", "events")} ${n === 1 ? "is" : "are"} dated in the future. Snappy leaves ${them(n)} out.`,
  noPersonNote: (n: number): string => `${countOf(n, "event", "events")} had no person attached and ${was(n)} left out.`,
  groupNote: (n: number): string => `${countOf(n, "group chat event", "group chat events")} ${was(n)} left out.`,
  unknownDirectionNote: (n: number): string => `${countOf(n, "event", "events")} ${n === 1 ? "does" : "do"} not say who wrote, so Snappy skipped ${them(n)}.`,
  notFriendsNote: (n: number): string => `${countOf(n, "person", "people")} outside your friends list ${was(n)} left out.`,
  lateNote: (n: number, hours: number): string =>
    `${countOf(n, "change of sender", "changes of sender")} took over ${hoursOf(hours)}. Snappy treats ${n === 1 ? "it as a new chat, not a reply" : "them as new chats, not replies"}.`,
  sameTimeNote: (n: number): string => `${countOf(n, "message pair", "message pairs")} ${n === 1 ? "shares" : "share"} one exact time, so Snappy cannot tell the order and left ${them(n)} out.`,
  belowMinNote: (n: number, min: number): string => `${countOf(n, "person", "people")} ${has(n)} replies, but fewer than ${formatCount(min)}. Snappy shows ${n === 1 ? "the count" : "the counts"} only.`,
  fewNote: (n: number): string => (n === 0 ? "One side has no replies, so the overall times may be off." : `One side has only ${countOf(n, "reply", "replies")}, so the overall times may be off.`),
  zoneNote: "The time zone was moved to the nearest allowed one.",
  otherNote: "Snappy noted something it cannot describe here.",

  downloadLabel: "Save CSV",
  downloadNote: "The file holds usernames and every friend row. Keep it private.",
  /** The column names of the CSV file. */
  csvHeaders: ["Username", "Your replies", "Your typical reply (seconds)", "Your 90% within (seconds)", "Their replies", "Their typical reply (seconds)", "Their 90% within (seconds)"],
} as const;
