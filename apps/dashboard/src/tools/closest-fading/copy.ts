/**
 * Closest and fading: every string this tool shows. Voice rules are in docs/BRAND.md. Keys end in the
 * kind of text they are (Heading, Header, Note, Line, Announce), because the copy lint reads the kind from the
 * key. Nothing here holds an export value: counts and dates come in as arguments, and no function takes a name.
 */
import { tools } from "../../copy.ts";
import { countOf, formatCount } from "../../format.ts";

const have = (n: number): string => (n === 1 ? "has" : "have");
const them = (n: number): string => (n === 1 ? "it" : "them");

export const copy = {
  title: "Closest and fading",
  oneLiner: "See your closest friends and who is fading.",
  description: "Rank friends by recent saved chats and Snaps. See who has gone quieter than before.",
  reads: "Counts, dates and directions of your saved chats and Snaps with each friend.",
  empty: {
    title: "Nothing to rank yet",
    body: "No friend has enough recent chats or Snaps to rank, and none shows a clear drop. Another window may change this.",
  },

  doneAnnounce: (closest: number, fading: number) => `${countOf(closest, "friend", "friends")} in the closest list, ${formatCount(fading)} fading.`,
  emptyAnnounce: "No friends to rank yet.",

  windowLabel: "Recent window in days",
  /** Reads out each choice in full, since the button itself shows only the number. */
  unitWindow: (days: number): string => countOf(days, "day", "days"),

  glanceHeading: "At a glance",
  factFriendsHeader: "Friends listed",
  factActiveHeader: "Active recently",
  factFadingHeader: "Fading",
  methodLine: (date: string, days: number) => `Counted back from ${date}. Recent means the last ${countOf(days, "day", "days")}.`,

  closestHeading: "Closest friends",
  closestCaption: "Closest friends by recent activity",
  closestLine: "Newer saved chats and Snaps count more than older ones.",
  noClosestLine: (minEvents: number) => `No friend has ${countOf(minEvents, "saved chat or Snap", "saved chats or Snaps")} in this window.`,
  friendHeader: "Friend",
  activityHeader: "Activity",
  sentHeader: "Sent",
  receivedHeader: "Received",
  lastHeader: "Last",
  activityCell: (percent: string) => `${percent} of top`,
  sentCell: (n: number) => `${formatCount(n)} sent`,
  receivedCell: (n: number) => `${formatCount(n)} received`,
  lastCell: (date: string) => `Last ${date}`,

  fadingHeading: "Fading friends",
  fadingCaption: "Fading friends by drop in activity",
  fadingLine: (days: number) => `Fewer saved chats and Snaps than in the ${formatCount(days)} days before.`,
  noFadingLine: "No friend shows a clear drop in activity.",
  fadingMoreLine: (n: number) => `${countOf(n, "more friend", "more friends")} not shown.`,
  earlierHeader: "Earlier",
  recentHeader: "Recent",
  changeHeader: "Change",
  earlierCell: (n: number) => `${formatCount(n)} earlier`,
  recentCell: (n: number) => `${formatCount(n)} recent`,
  changeCell: (percent: string) => `Down ${percent}`,

  savedOnlyNote: "Snappy counts saved chats and Snaps only. You may be closer to some friends in ways it cannot see.",
  fadingNote: "Fading means fewer saved chats and Snaps than before, not that a friendship ended.",
  badDateNote: "The date for this run looks wrong, so Snappy could not measure recent activity.",
  noActivityNote: "Your export has no saved chats or Snaps, so there is nothing to rank.",
  groupOnlyNote: "Your saved chats are all group chats. Snappy ranks one-to-one activity only.",
  measuredNote: (days: number) => `This export is about ${countOf(days, "day", "days")} old, so Snappy counted back from its date.`,
  startsLateNote: "Your history may start inside the earlier window, so some fading friends may be missing.",
  futureNote: (n: number) => `${countOf(n, "entry", "entries")} ${have(n)} a date in the future. Snappy leaves ${them(n)} out.`,
  undatedNote: (n: number) => `${countOf(n, "entry", "entries")} ${have(n)} no usable date. Snappy leaves ${them(n)} out.`,
  nonFriendNote: (n: number) => `${countOf(n, "chat or Snap", "chats or Snaps")} ${n === 1 ? "is" : "are"} with ${n === 1 ? "someone" : "people"} not on your friends list. Snappy leaves ${them(n)} out.`,
  otherNote: tools.otherNote,
} as const;
