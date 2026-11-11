/**
 * Storage planner: every string this tool shows. Voice rules are in docs/BRAND.md. Keys end in the kind of
 * text they are (Heading, Header, Note, Line, Button, Announce), because the copy lint reads the kind from the key.
 * Nothing here holds an export value: counts, sizes and years come in as arguments.
 */
import { countOf, formatCount } from "../../format.ts";

const memoriesOf = (n: number): string => countOf(n, "Memory", "Memories");

export const copy = {
  title: "Storage planner",
  oneLiner: "Plan how to save your Memories.",
  description: "See your Memories by year and type, what fits under your goal, and the order to save them.",
  reads: "Memory dates, types and sizes, and the ZIP part each file is in.",
  empty: {
    title: "No sizes to plan with",
    body: "Snappy found no file sizes for your Memories. Add the ZIP files that hold them, then try again.",
  },

  goalHeader: "Storage goal (GB)",
  goalHelp: "Snappy fits what it can under this size. It starts at your free storage cap.",
  goalError: "Enter a number from 0.1 to 10,000.",
  updateButton: "Update plan",
  orderHeader: "Save first",
  newestLine: "Newest year",
  oldestLine: "Oldest year",

  goalHeading: "Your goal",
  meterLabel: "Memories size compared with your goal",
  meterName: "Size",
  meterText: (used: string, goal: string, percent: string, atLeast: boolean) => `${atLeast ? "At least " : ""}${used} of ${goal} (${percent})`,
  fitsAllLine: "Everything with a known size fits under your goal.",
  fitsPartLine: (fits: number, waits: number) => `Your goal fits ${memoriesOf(fits)}. ${memoriesOf(waits)} would wait for more space.`,
  countedHeader: "Memories counted",
  fitsHeader: "Fit under goal",
  waitsHeader: "Wait for space",

  byYearHeading: "By year",
  byYearCaption: "Memories by year",
  yearHeader: "Year",
  memoriesHeader: "Memories",
  sizeHeader: "Size",
  shareHeader: "Share",
  fitHeader: "Fits",
  noDateLine: "No date",
  unitNoDate: "no date",
  unitMemories: (n: number) => memoriesOf(n),
  unitShare: (percent: string) => `${percent} of total`,
  unitAtLeast: (size: string) => `At least ${size}`,
  unknownSizeLine: "Size unknown",
  fitStates: { all: "Fits", part: "Partly fits", none: "Waits", unsized: "Size unknown" },

  byTypeHeading: "By type",
  byTypeCaption: "Memories by type",
  typeHeader: "Type",
  types: { image: "Photos", video: "Videos", unknown: "Other" },

  byPartHeading: "By ZIP part",
  byPartCaption: "Memories by ZIP part",
  partHeader: "Part",
  unitPart: (n: number) => `Part ${formatCount(n)}`,
  noFileLine: "No file",

  orderHeading: "Download order",
  orderNewestNote: "Newest year first, and photos before videos in each year. Memories with no date come last.",
  orderOldestNote: "Oldest year first, and photos before videos in each year. Memories with no date come last.",
  orderCaption: "Order to save your Memories",
  stepHeader: "Step",
  groupHeader: "Group",
  unitStep: (n: number) => `Step ${formatCount(n)}`,
  unitGroup: (type: string, year: string) => `${type}, ${year}`,
  moreStepsLine: (n: number) => `${countOf(n, "more step", "more steps")} follow in the same order.`,

  batchesHeading: "Batches",
  batchesLine: (n: number, size: string) => `${countOf(n, "batch", "batches")} of up to ${size}, for what fits under your goal.`,
  /** Under the batches: the size is fixed on this page, and the command line tool takes another. */
  batchSizeLine: (size: string) => `Batches are up to ${size} here. The command line tool changes that with --batch-gb.`,
  batchesCaption: "Batches of Memories to save",
  batchHeader: "Batch",
  yearsHeader: "Years",
  partsHeader: "ZIP parts",
  unitBatch: (n: number) => `Batch ${formatCount(n)}`,
  unitYears: (first: string, last: string) => `${first} to ${last}`,
  unitBatchYears: (span: string, many: boolean) => `${many ? "Years" : "Year"} ${span}`,
  unitParts: (count: number, list: string) => `${count === 1 ? "Part" : "Parts"} ${list}`,
  moreBatchesLine: (n: number) => `${countOf(n, "more batch", "more batches")} follow.`,

  doneAnnounce: (used: string, goal: string, waits: number) =>
    waits === 0 ? `Storage plan ready. ${used} of ${goal}, and everything with a known size fits.` : `Storage plan ready. ${used} of ${goal}, and ${memoriesOf(waits)} would wait for more space.`,

  utcNote: "Years use UTC dates, so they can differ from Memories on this day.",
  unsizedNote: (n: number) => `${memoriesOf(n)} ${n === 1 ? "has" : "have"} no known size, so sizes and totals may be short.`,
  undatedNote: (n: number) => `${memoriesOf(n)} ${n === 1 ? "has" : "have"} no usable date and ${n === 1 ? "comes" : "come"} last.`,
  futureNote: (n: number) => `${memoriesOf(n)} ${n === 1 ? "has" : "have"} a date in the future. Snappy treats ${n === 1 ? "it" : "them"} as undated.`,
  oversizeNote: (n: number) => `${memoriesOf(n)} ${n === 1 ? "is" : "are"} larger than a batch and ${n === 1 ? "gets" : "get"} ${n === 1 ? "a batch" : "batches"} alone.`,
  duplicatesNote: (n: number) => `Snappy left out ${countOf(n, "probable duplicate", "probable duplicates")} from these numbers.`,
  otherNote: "Snappy found something it could not describe. The export check can say more.",
} as const;
