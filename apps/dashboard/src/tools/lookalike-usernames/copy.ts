/**
 * Lookalike usernames: every string this tool shows. Voice rules are in docs/BRAND.md. Keys end in the kind of text
 * they are (Heading, Header, Note, Line), because the copy lint reads the kind from the key.
 * Nothing here holds an export value: counts come in as arguments, and no function takes a username.
 * A lookalike proves nothing, so the words only ever say a pair may be worth a second look.
 */
import { tools } from "../../copy.ts";
import { countOf, formatCount } from "../../format.ts";

const pairs = (n: number): string => countOf(n, "pair", "pairs");
const has = (n: number): string => (n === 1 ? "has" : "have");
const is = (n: number): string => (n === 1 ? "is" : "are");
const them = (n: number): string => (n === 1 ? "it" : "them");

export const copy = {
  title: "Lookalike usernames",
  oneLiner: "Spot names that look alike.",
  description: "Find usernames in your friends, requests and blocked list that look alike. Lookalikes are common and prove nothing.",
  reads: "Usernames in your friends, requests and blocked lists, compared with each other.",
  empty: {
    title: "No lookalike names",
    body: "Snappy found no pairs of usernames that look alike. It only compares names, so check in Snapchat if you are unsure.",
  },

  doneAnnounce: (found: number): string => (found > 0 ? `Check finished. ${pairs(found)} may be worth a second look.` : "Check finished. No lookalike pairs found."),

  countsHeading: "At a glance",
  facts: { names: "Names compared", high: "Very close pairs", medium: "Close pairs", low: "Slight pairs" },

  pairsHeading: "Worth a second look",
  pairsLine: "Two real people can have names like these. Check a pair before you trust a new request.",
  levels: { high: "Very close", medium: "Close", low: "Slight" },
  reasons: {
    "lookalike-swap": "Similar-looking characters",
    "separator-differs": "Dots or underscores differ",
    "repeated-characters": "Repeated letters",
    "appended-digits": "Digits added",
    "digits-differ": "Digits differ",
    "one-edit": "One character apart",
  },
  contexts: {
    "pending-resembles-friend": "A request resembles a friend",
    "resembles-blocked": "Resembles someone you blocked",
  },
  listLabel: { friends: "Friend", pendingRequests: "Request received", sentRequests: "Request sent", blocked: "Blocked" },

  readOnlyNote: "Snappy only compares the names in your export. It looks no one up and changes nothing in Snapchat.",
  noPeopleNote: "Snappy found no usernames to compare. The export may be short.",
  foundNote: (n: number): string => `${pairs(n)} may be worth a second look.`,
  truncatedNote: (shown: number, total: number): string => `Snappy lists the closest ${countOf(shown, "pair", "pairs")} of ${formatCount(total)}.`,
  duplicatesNote: (n: number): string => `${countOf(n, "extra row", "extra rows")} ${n === 1 ? "repeats" : "repeat"} a person already listed. Snappy counts each person once.`,
  blankNote: (n: number): string => `${countOf(n, "row", "rows")} ${has(n)} no username. Snappy leaves ${them(n)} out.`,
  overlongNote: (n: number): string => `${countOf(n, "username", "usernames")} ${is(n)} too long to compare. Snappy leaves ${them(n)} out.`,
  crowdedNote: (n: number): string => `${countOf(n, "person", "people")} ${n === 1 ? "has a name" : "have names"} in a long numbered family. Snappy does not compare ${them(n)}.`,
  otherNote: tools.otherNote,
} as const;
