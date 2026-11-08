/**
 * Activity calendar: every string this tool shows. Voice rules are in docs/BRAND.md. Keys end in the kind of text
 * they are (Heading, Header, Note, Label, Line, Announce), because the copy lint reads the kind from the key.
 * Nothing here holds an export value: counts, years and dates come in as arguments, and nothing takes or returns a
 * username (this tool reads kinds and times only, so it has none).
 */
import { common, tools } from "../../copy.ts";
import { countOf, formatCount } from "../../format.ts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

const things = (n: number): string => countOf(n, "chat or Snap", "chats and Snaps");

export const copy = {
  title: "Activity calendar",
  oneLiner: "See your activity by day, week and kind.",
  description: "See when you chat and Snap, day by day, and which kinds they were. Results use only kinds and times.",
  reads: "The kind and time of each chat and Snap, as counts and dates.",
  empty: {
    title: "No dated activity found",
    body: "Snappy found no chats or Snaps with a usable date to count. The export check shows what may be missing.",
  },

  zoneLabel: "Time zone",
  zoneHelp: "Days follow this time zone. Snappy starts with your device’s time zone.",
  yearLabel: "Year",
  yearHelp: "The year to list. Snappy starts with your latest.",
  latestOption: "Latest year",

  summaryAnnounce: (used: number, days: number) => `Calendar counted ${things(used)} on ${countOf(days, "day", "days")}.`,
  emptyAnnounce: "Calendar found nothing with a usable date.",

  glanceHeading: "At a glance",
  countedLabel: "Counted",
  activeDaysLabel: "Active days",
  firstLabel: "First",
  lastLabel: "Last",

  /** "Year 2026". */
  yearHeading: (year: number) => (Number.isFinite(year) ? `Year ${year}` : ""),
  yearCaption: "Activity in the year",
  measureHeader: "Measure",
  valueHeader: "Value",
  countedRow: "Counted",
  activeDaysRow: "Active days",
  busiestWeekRow: "Busiest full week",
  quietestWeekRow: "Quietest full week",
  unitCounted: (count: string): string => `${count} counted`,
  unitDays: (n: number): string => countOf(n, "day", "days"),
  /** "Week of Mar 2, 2026, 20 chats and Snaps", with "(tied)" when other weeks match. */
  unitWeek: (date: string, n: number, tied: boolean): string => `Week of ${date}, ${things(n)}${tied ? " (tied)" : ""}`,
  unitNoWeek: "No full week to name",

  gridFor: (year: number, used: number, days: number): string =>
    `Daily activity in ${year}: ${things(used)} on ${countOf(days, "day", "days")}. The tables below hold the same counts.`,
  gridNote: "Each square is one day. A stronger color means more.",
  scrollNote: "The grid starts at the latest weeks. Scroll sideways to see earlier ones.",
  legendLess: "Less",
  legendMore: "More",
  /** The three weekday names shown beside the grid. */
  weekdayShort: ["Mon", "Wed", "Fri"],

  monthHeading: "By month",
  /** The short month names above the grid, January first. */
  monthNames: MONTHS,
  /** "Mar 2026", from a year and a month number (1 to 12). */
  unitMonth: (year: number, month: number): string => {
    const name = MONTHS[month - 1];
    return name === undefined || !Number.isFinite(year) ? "" : `${name} ${year}`;
  },

  runsHeading: "Longest runs",
  allTimeRunsCaption: "Runs across all time",
  yearRunsCaption: (year: number) => (Number.isFinite(year) ? `Runs in ${year}` : ""),
  runHeader: "Run",
  lengthHeader: "Length",
  fromHeader: "From",
  toHeader: "To",
  activeRunRow: "Longest active run",
  quietRunRow: "Longest quiet run",
  unitNoRun: "None found",
  unitFrom: (date: string): string => `From ${date}`,
  unitTo: (date: string): string => `To ${date}`,
  noValue: common.noFigure,
  runsNote: "Runs cover your whole account, never one friend. A quiet run has an active day on both sides.",

  kindsHeading: "Kinds",
  kindsCaption: "Chats and Snaps by kind",
  kindHeader: "Kind",
  allTimeHeader: "All time",
  shareHeader: "Share",
  /** The column for the listed year. */
  yearColumnHeader: (year: number) => (Number.isFinite(year) ? String(year) : ""),
  unitOfTotal: (percent: string): string => `${percent} of the total`,
  unitInYear: (year: number, count: string): string => `${count} counted in ${year}`,
  kindNames: { text: "Text", image: "Image", video: "Video", note: "Note", sticker: "Sticker", other: "Other" },
  otherNote: "Other holds chat media, which may be a photo or a video.",

  kindsByYearHeading: "Kinds by year",
  kindsByYearCaption: "Kinds counted each year",
  yearHeader: "Year",
  totalHeader: "Total",
  unitKindCount: (count: string, kind: string): string => (typeof kind === "string" ? `${count} ${kind}` : ""),
  unitInAll: (count: string): string => `${count} in all`,
  yearsShownLine: (shown: number, total: number) => `Showing the latest ${countOf(shown, "year", "years")} of ${formatCount(total)}.`,

  noneNote: "No chats or Snaps with a usable date were found.",
  undatedNote: (n: number) => `${things(n)} ${n === 1 ? "has" : "have"} no usable date. Snappy leaves ${n === 1 ? "it" : "them"} out.`,
  futureNote: (n: number) => `${things(n)} ${n === 1 ? "is" : "are"} dated in the future. Snappy leaves ${n === 1 ? "it" : "them"} out.`,
  fewNote: (n: number) => `Only ${things(n)} ${n === 1 ? "was" : "were"} counted, so this picture may be weak.`,
  otherKindNote: (percent: number) => (Number.isFinite(percent) ? `About ${percent}% have a kind Snappy cannot sort, so the mix may be off.` : ""),
  yearAdjustedNote: (year: number) => (Number.isFinite(year) ? `That year was not usable, so Snappy shows ${year}.` : ""),
  yearEmptyNote: (year: number) => (Number.isFinite(year) ? `No chats or Snaps were found in ${year}, so its calendar is empty.` : ""),
  zoneNote: "The time zone was moved to the nearest allowed one.",
  unknownNote: tools.otherNote,
} as const;
