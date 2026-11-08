/**
 * Rescue manifest: every string this tool shows. Voice rules are in docs/BRAND.md. Keys end in the kind of
 * text they are (Heading, Header, Note, Step, Line, Button, Announce), because the copy lint reads the kind from the key.
 * Nothing here holds an export value: counts come in as arguments, and no function takes a username or file name.
 */
import { countOf } from "../../format.ts";

export const copy = {
  title: "Rescue manifest",
  oneLiner: "List your Memories rescue to check it later.",
  description: "Make a list of the Memories a rescue saves, with their file names, dates and types. Use it later to check the folder.",
  reads: "The dates and media types in your Memories list, and the file names Snappy would save.",
  empty: {
    title: "Nothing to list",
    body: "Snappy found no Memories it could list. Check that your export includes the Memories list.",
  },

  listedAnnounce: (n: number) => `Rescue manifest ready. ${countOf(n, "Memory", "Memories")} listed.`,

  holdsHeading: "What it lists",
  memoriesHeader: "Memories",
  photosHeader: "Photos",
  videosHeader: "Videos",
  otherHeader: "Other types",
  overlaysHeader: "Overlay files",
  undatedHeader: "No date",

  checkHeading: "Check it later",
  saveStep: "Save the manifest and keep it somewhere safe.",
  rescueStep: "Run your Memories rescue to save the files to a folder.",
  verifyStep: "Later, check the folder against the manifest with the check command.",

  downloadButton: "Save JSON",
  downloadNote: "The file lists file names, dates and types. It holds no usernames.",
  unitFileName: "snappy-rescue-manifest.json",

  checkNote: "This page cannot read your folders, so the check runs in a terminal.",
  /** The copy-only command that checks a rescue folder. Its words are the command line tool's own flags. */
  verifyTitle: "Check a rescue folder later",
  verifyManifestExample: "<manifest file>",
  verifyFolderExample: "<rescue folder>",
  sizesNote: "Sizes are not recorded here, so a later check compares names and dates only.",
  repeatsNote: (n: number) => `${countOf(n, "Memory", "Memories")} may repeat another, so the list leaves ${n === 1 ? "it" : "them"} out.`,
  pathSkippedNote: (n: number) => `${countOf(n, "item", "items")} had no usable file name, so the list leaves ${n === 1 ? "it" : "them"} out.`,
  pathDuplicateNote: (n: number) => `${countOf(n, "file name", "file names")} repeated another, so the list leaves ${n === 1 ? "it" : "them"} out.`,
  overlaySkippedNote: (n: number) => `${countOf(n, "overlay file", "overlay files")} had no usable name, so the list leaves ${n === 1 ? "it" : "them"} out.`,
  idReplacedNote: (n: number) => `${countOf(n, "item", "items")} got a new id, since ${n === 1 ? "its id was" : "their ids were"} missing or repeated.`,
  futureNote: (n: number) => `${countOf(n, "date", "dates")} ${n === 1 ? "is" : "are"} in the future, so ${n === 1 ? "it counts" : "they count"} as missing.`,
  invalidNote: (n: number) => `${countOf(n, "date", "dates")} could not be used, so ${n === 1 ? "it counts" : "they count"} as missing.`,
  otherNote: "Snappy noted something it cannot describe here.",
} as const;
