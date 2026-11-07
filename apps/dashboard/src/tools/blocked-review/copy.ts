/**
 * Blocked and ignored review: every string this tool shows. Voice rules are in docs/BRAND.md. Keys end in the
 * kind of text they are (Heading, Header, Note, Step, Line), because the copy lint reads the kind from the key.
 * Nothing here holds an export value: counts and dates come in as arguments, and no function takes a username.
 */
import { countOf } from "../../format.ts";

const people = (n: number): string => countOf(n, "person", "people");
const has = (n: number): string => (n === 1 ? "has" : "have");

export const copy = {
  title: "Blocked and ignored review",
  oneLiner: "Look over who you blocked or ignored.",
  description: "See the people you blocked, ignored or hid from suggestions, oldest first. Snappy only lists them and changes nothing.",
  reads: "Usernames and dates in your blocked, ignored and hidden suggestion lists, checked against your friends and requests.",
  empty: {
    title: "No blocked or ignored people",
    body: "Snappy found no blocked, ignored or hidden people in this export. That may simply mean you have none.",
  },

  doneAnnounce: (total: number, worthLook: number): string =>
    worthLook > 0
      ? `Review finished. ${people(total)} in your lists, ${worthLook} may be worth a second look.`
      : `Review finished. ${people(total)} in your lists.`,

  countsHeading: "Your lists",
  facts: { blocked: "Blocked", ignored: "Ignored", hiddenSuggestions: "Hidden suggestions", conflicts: "Worth a look" },

  firstHeading: "What to look at first",
  conflictsStep: (n: number): string => `Look at the ${people(n)} who ${n === 1 ? "shows" : "show"} up in more than one place.`,
  blockedStep: (n: number): string => `Look over your blocked list (${people(n)}).`,
  ignoredStep: (n: number): string => `Look over your ignored list (${people(n)}).`,
  hiddenStep: (n: number): string => `Look over your hidden suggestions (${people(n)}).`,
  otherStep: "Look over your lists again.",

  conflictsHeading: "Worth a second look",
  conflictsLine: "These people are on more than one list, or are also a friend or a request.",
  kinds: {
    "multiple-lists": "On more than one list",
    "also-friend": "Also a friend",
    "also-pending": "Request pending",
    "also-sent": "Request sent",
  },

  blockedHeading: "Blocked, oldest first",
  ignoredHeading: "Ignored, oldest first",
  hiddenHeading: "Hidden suggestions, oldest first",
  listLabel: { blocked: "Blocked", ignored: "Ignored", hiddenSuggestions: "Hidden suggestions" },
  noDateLine: "No date",
  rangeLine: (oldest: string, newest: string): string => (oldest === newest ? `Dated ${oldest}.` : `Oldest ${oldest}. Newest ${newest}.`),

  readOnlyNote: "Snappy only lists these people. It changes nothing in Snapchat.",
  /** A list name inside a sentence. A piece that code joins into a sentence is a "unit" key, so the lint lets it start in lowercase. */
  unitList: (id: string): string => ({ blocked: "blocked", ignored: "ignored", hiddenSuggestions: "hidden suggestions" })[id] ?? "blocked",
  undatedNote: (n: number, where: string): string => `${people(n)} in your ${where} list ${has(n)} no date. Snappy puts ${n === 1 ? "that person" : "them"} last.`,
  futureNote: (n: number, where: string): string => `${people(n)} in your ${where} list ${has(n)} a date in the future. Snappy leaves ${n === 1 ? "it" : "them"} out of the dates.`,
  duplicatesNote: (n: number, where: string): string => `${countOf(n, "extra row", "extra rows")} in your ${where} list repeat${n === 1 ? "s" : ""} a person already listed. Snappy counts each person once.`,
  blankNote: (n: number, where: string): string => `${countOf(n, "row", "rows")} in your ${where} list ${has(n)} no username. Snappy leaves ${n === 1 ? "it" : "them"} out.`,
  conflictsNote: (n: number): string => `${people(n)} may be worth a second look.`,
  friendsEmptyNote: "Your friends list is empty, so Snappy cannot tell who is also a friend. The export may be short.",
  otherNote: "Snappy noted something it cannot describe here.",
} as const;
