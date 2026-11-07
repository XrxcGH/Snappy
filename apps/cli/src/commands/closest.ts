/**
 * snappy-export closest: the friends you chat and send Snaps with most lately, and the friends
 * whose saved chats and Snaps have faded. Read-only: it writes no file and never opens the ledger.
 * The lists come from core's closestFading. Usernames appear only in the two result tables, which
 * are the point of the command; notes, errors and verbose codes never name anyone.
 */
import { insights } from "@snappy-export/core";
import { intOption } from "../args.ts";
import { formatCount, formatDate, formatPercent, noun, plural } from "../format.ts";
import type { InsightCommand } from "../insights-command.ts";
import { insightTerm, loadInsightInput, parseInsightArgs } from "../insights-input.ts";
import type { CommonFlags } from "../insights-input.ts";
import type { Io } from "../io.ts";
import { finish, jsonText, renderNotes, section } from "../render-insights.ts";
import type { NoteLine } from "../render-insights.ts";
import type { Term } from "../term.ts";

export const CLOSEST_USAGE = `Usage: snappy-export closest <ZIP files or folder...> [options]

Lists the friends you chat and send Snaps with most lately, and friends whose activity has faded.
It reads saved chats and Snaps only, so it may not match real life.

Give it every part of your export, or a folder or wildcard such as "mydata*.zip".

Options
  --window <days>     Length of the recent window. Default 90.
  --half-life <days>  Days after which activity counts half. Default 30.
  --top <n>           Most friends to list in each table. Default 10.
  --json              Print JSON instead of text.
  --verbose           Add a short code to each note, for bug reports.
  --no-color          Plain text.

Exit codes: 0 done, 1 could not run, 2 the export has errors.
`;

interface Flags extends CommonFlags {
  window?: string;
  "half-life"?: string;
  top?: string;
}

type Result = insights.closestFading.ClosestFadingResult;
type Note = insights.closestFading.ClosestFadingNote;

const OWN_OPTIONS = {
  window: { type: "string" },
  "half-life": { type: "string" },
  top: { type: "string" },
} as const;

const num = (v: number | undefined): number => (typeof v === "number" ? v : 0);

/** The note for one core code. Hedged, counts only: nobody is named. */
function noteLine(n: Note): NoteLine {
  const count = num(n.params.count);
  const base = { code: n.code };
  switch (n.code) {
    case "invalid-reference-time":
      return { ...base, severity: "warning", text: "The date for this run looks wrong, so Snappy could not measure recent activity." };
    case "no-activity-data":
      return { ...base, severity: "warning", text: "Your export has no saved chats or Snaps, so there is nothing to rank." };
    case "no-one-to-one-activity":
      return { ...base, severity: "warning", text: "Your saved chats are all group chats. Snappy lists one-to-one activity only." };
    case "measured-to-export-date":
      return {
        ...base,
        severity: "info",
        text: `This export is about ${plural(num(n.params.daysBeforeNow), "day")} old, so Snappy counted back from its date.`,
      };
    case "history-starts-inside-earlier-window":
      return { ...base, severity: "info", text: "Your history may start inside the earlier window, so some fading friends may be missing." };
    case "future-events-ignored":
      return {
        ...base,
        severity: "info",
        text: `${plural(count, "entry", "entries")} ${noun(count, "has", "have")} a date in the future. Snappy leaves ${noun(count, "it", "them")} out.`,
      };
    case "undated-events-ignored":
      return {
        ...base,
        severity: "info",
        text: `${plural(count, "entry", "entries")} ${noun(count, "has", "have")} no usable date. Snappy leaves ${noun(count, "it", "them")} out.`,
      };
    case "non-friend-events-ignored":
      return {
        ...base,
        severity: "info",
        text: `${plural(count, "chat or Snap", "chats or Snaps")} ${noun(count, "is", "are")} with ${noun(count, "someone", "people")} not on your friends list. Snappy leaves ${noun(count, "it", "them")} out.`,
      };
    default:
      return { ...base, severity: "info", text: "Snappy noted something it cannot describe. Run it with --verbose and share the code." };
  }
}

const eventsText = (n: number): string => plural(n, "saved chat or Snap", "saved chats or Snaps");

/** How the lists were worked out, in the person's terms. */
function methodLines(r: Result): string[] {
  const s = r.settings;
  return [
    `Counted back from ${formatDate(r.asOf)}. Recent means the last ${plural(s.windowDays, "day")}.`,
    `Older activity counts less, by half every ${plural(s.halfLifeDays, "day")}.`,
    `Fading means at least ${eventsText(s.minEarlierEvents)} in the ${plural(s.windowDays, "day")} before, and a drop of ${formatPercent(s.minDropFraction)} or more.`,
  ];
}

function closestLines(r: Result, term: Term, top: number): string[] {
  if (r.closest.length === 0) {
    return [`No friend has ${eventsText(r.settings.minClosestEvents)} in the recent window.`];
  }
  const shown = r.closest.slice(0, top);
  const lines = term.table(
    [
      { header: "Rank", align: "right" },
      { header: "Friend" },
      { header: "Activity", align: "right" },
      { header: "Sent", align: "right" },
      { header: "Received", align: "right" },
      { header: "Last", align: "right" },
    ],
    shown.map((f) => [String(f.rank), f.key, formatPercent(f.relativeScore), formatCount(f.events.sent), formatCount(f.events.received), formatDate(f.lastAt)]),
  );
  lines.push("", "Activity is shown against your top friend.");
  return lines;
}

function fadingLines(r: Result, term: Term, top: number): string[] {
  if (r.fading.length === 0) return ["No friend shows a clear drop in activity."];
  const shown = r.fading.slice(0, top);
  const lines = term.table(
    [
      { header: "Friend" },
      { header: "Earlier", align: "right" },
      { header: "Recent", align: "right" },
      { header: "Change", align: "right" },
      { header: "Last", align: "right" },
    ],
    shown.map((f) => [
      f.key,
      formatCount(f.earlierEvents),
      formatCount(f.recentEvents),
      f.stopped ? "Stopped" : `Down ${formatPercent(f.dropFraction)}`,
      formatDate(f.lastAt),
    ]),
  );
  const hidden = r.fading.length - shown.length;
  if (hidden > 0) lines.push("", `${plural(hidden, "more friend")} not shown. Use --top to show more.`);
  lines.push("", "Fading means fewer saved chats and Snaps than before. It does not mean a friendship ended.");
  return lines;
}

export function renderClosest(result: Result, term: Term, verbose: boolean): string {
  const top = Math.max(1, result.settings.topCount);
  const out: string[] = [term.bold("Closest and fading friends")];
  out.push(
    `  ${term.violet(plural(result.closest.length, "friend"))} in the closest list, ${plural(result.fading.length, "friend")} fading.`,
    "",
  );
  out.push(...section(term, "Closest", closestLines(result, term, top)));
  out.push(...section(term, "Fading", fadingLines(result, term, top)));
  out.push(...section(term, "How this is measured", methodLines(result)));
  const noteLines = renderNotes(result.notes.map(noteLine), term, { heading: "Notes", verbose });
  if (noteLines.length > 0) out.push(...noteLines, "");
  return finish(out);
}

export async function runClosest(args: string[], io: Io): Promise<number> {
  const { values: flags, positionals } = parseInsightArgs<Flags>("closest", args, OWN_OPTIONS);
  if (flags.help) {
    io.out.write(CLOSEST_USAGE);
    return 0;
  }
  const term = insightTerm(flags, io);

  // Check every option before anything is read.
  const windowDays = intOption("--window", flags.window, 1, 365);
  const halfLifeDays = intOption("--half-life", flags["half-life"], 1, 365);
  const topCount = intOption("--top", flags.top, 1, 100);

  const input = await loadInsightInput(positionals, io);
  if (input.broken) {
    // A broken export is not a safe base for naming people, so Snappy says what is wrong and stops.
    const issues = input.issues.map((i) => ({ severity: i.severity, code: i.code, text: i.message }));
    if (flags.json) {
      io.out.write(jsonText({ generatedAt: new Date(input.now).toISOString(), issues: input.issues, stopped: "export-errors" }));
    } else {
      io.out.write(
        finish([
          ...renderNotes(issues, term, { heading: "Export problems", verbose: flags.verbose === true }),
          "",
          "Snappy stopped. It will not list friends from a broken export. Fix the problems above and run it again.",
          "",
        ]),
      );
    }
    return 2;
  }

  const result = insights.closestFading.findClosestAndFading(input.parsed, {
    now: input.now,
    ...(windowDays !== undefined && { windowDays }),
    ...(halfLifeDays !== undefined && { halfLifeDays }),
    ...(topCount !== undefined && { topCount }),
  });

  if (flags.json) {
    io.out.write(jsonText({ generatedAt: new Date(input.now).toISOString(), ...result }));
  } else {
    io.out.write(renderClosest(result, term, flags.verbose === true));
  }
  return 0;
}

export const closestCommand: InsightCommand = {
  name: "closest",
  synopsis: "closest <ZIP files...>",
  summary: "Find your closest and fading friends.",
  group: "Friends",
  usage: CLOSEST_USAGE,
  run: runClosest,
};
