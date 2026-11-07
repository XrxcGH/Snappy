/**
 * snappy-export reply-speed: how fast you and your friends answer each other in one-to-one chats.
 * Read-only unless the person passes --out: no file is written otherwise and the ledger is never
 * opened. The numbers come from core's replySpeed module, which sees only a conversation, a
 * direction and a time per event. Usernames appear only in the result tables (and in the CSV the
 * person asked for); notes, errors and verbose codes never name anyone.
 */
import { insights } from "@snappy-export/core";
import { intOption } from "../args.ts";
import { formatCount, formatDate, hasHave, noun, plural, wasWere } from "../format.ts";
import type { InsightCommand } from "../insights-command.ts";
import { insightTerm, loadInsightInput, parseInsightArgs, parseUtcOffsetHours } from "../insights-input.ts";
import type { CommonFlags } from "../insights-input.ts";
import { checkOutputPath, saveInsightFile } from "../insights-output.ts";
import type { Io } from "../io.ts";
import { finish, jsonText, renderNotes, section } from "../render-insights.ts";
import type { NoteLine } from "../render-insights.ts";
import type { Term } from "../term.ts";

export const REPLY_SPEED_USAGE = `Usage: snappy-export reply-speed <ZIP files or folder...> [options]

Shows how fast you and your friends reply to each other in one-to-one chats. It reads who wrote and
when, never names, message text, photos or videos. Times are hints, since an export can miss messages.

Times are in UTC unless you set --utc-offset. Give it every part of your export, or a folder or
wildcard such as "mydata*.zip".

Options
  --utc-offset <hours>  Hours from UTC, such as 2 or 5:30. Write -5 as --utc-offset=-5.
  --limit <n>           Rows to show in each table. Default 10.
  --out <file.csv>      Save the friends table, with every row, to this file.
  --force               Replace the file named by --out if it exists.
  --json                Print JSON instead of text.
  --verbose             Add a short code to each note, for bug reports.
  --no-color            Plain text.

Exit codes: 0 done, 1 could not run, 2 the export has errors and was not read.
`;

interface ReplySpeedFlags extends CommonFlags {
  "utc-offset"?: string;
  limit?: string;
  out?: string;
  force?: boolean;
}

type Report = insights.replySpeed.ReplySpeedReport;
type Note = insights.replySpeed.ReplySpeedNote;
type Rank = insights.replySpeed.ReplyRank;

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 1000;
const HOUR_MS = 3_600_000;

export interface ReplySpeedRenderOptions {
  /** Rows to show in each table. Default 10. */
  limit?: number;
  /** The path of the CSV file once it is written, as the person typed it. */
  saved?: string;
  /** True when the person asked for a file but there was nothing to put in it. */
  nothingToSave?: boolean;
}

/** "UTC", "UTC+2:00", "UTC-5:30". */
function offsetLabel(minutes: number): string {
  if (minutes === 0) return "UTC";
  const abs = Math.abs(minutes);
  return `UTC${minutes < 0 ? "-" : "+"}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, "0")}`;
}

/** "12 am", "9 pm". */
const hourLabel = (hour: number): string => `${hour % 12 === 0 ? 12 : hour % 12} ${hour < 12 ? "am" : "pm"}`;

/** A reply time in words: "40 seconds", "12 minutes", "5 hours", "2 days". */
export function durationText(ms: number): string {
  if (ms < 1000) return "Under 1 second";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return plural(seconds, "second");
  const minutes = Math.round(ms / 60_000);
  if (minutes < 120) return plural(minutes, "minute");
  const hours = Math.round(ms / HOUR_MS);
  if (hours < 48) return plural(hours, "hour");
  return plural(Math.round(ms / 86_400_000), "day");
}

const timeCell = (spread: { medianMs: number } | null): string => (spread === null ? "-" : durationText(spread.medianMs));
const num = (v: number | undefined): number => (typeof v === "number" ? v : 0);

/** The sentence for one note. Counts only: a note never names a person. */
function noteText(n: Note, report: Report): string {
  const c = num(n.params.count);
  const hours = report.windowMs / HOUR_MS;
  switch (n.code) {
    case "invalid-now":
      return "Snappy could not read today's date, so it left the results empty.";
    case "no-events":
      return "Your export has no saved chats or Snaps, so there are no replies to time.";
    case "no-one-to-one-events":
      return "Your saved chats are all group chats, and Snappy leaves those out.";
    case "no-replies-found":
      return `Snappy found no replies to time. A reply is a change of sender within ${plural(hours, "hour")}.`;
    case "events-without-time":
      return `${plural(c, "event")} had no usable date and ${wasWere(c)} left out.`;
    case "events-in-future":
      return `${plural(c, "event")} ${noun(c, "is", "are")} dated in the future. Snappy leaves ${noun(c, "it", "them")} out.`;
    case "events-without-person":
      return `${plural(c, "event")} had no person attached and ${wasWere(c)} left out.`;
    case "group-events-skipped":
      return `${plural(c, "group chat event")} ${wasWere(c)} left out.`;
    case "events-direction-unknown":
      return `${plural(c, "event")} ${noun(c, "does", "do")} not say who wrote, so Snappy skipped ${noun(c, "it", "them")}.`;
    case "people-not-in-friends":
      return `${plural(c, "person", "people")} outside your friends list ${wasWere(c)} left out.`;
    case "turns-after-window":
      return `${plural(c, "change of sender", "changes of sender")} took over ${plural(hours, "hour")}. Snappy treats ${noun(c, "it as a new chat, not a reply", "them as new chats, not replies")}.`;
    case "turns-at-same-time":
      return `${plural(c, "message pair")} ${noun(c, "shares", "share")} one exact time, so Snappy cannot tell the order and left ${noun(c, "it", "them")} out.`;
    case "people-below-minimum":
      return `${plural(c, "person", "people")} ${hasHave(c)} replies, but fewer than ${num(n.params.minimum) || report.minReplies}. Snappy shows ${noun(c, "the count", "the counts")} only.`;
    case "few-replies-overall":
      return c === 0 ? "One side has no replies, so the overall times may be off." : `One side has only ${plural(c, "reply", "replies")}, so the overall times may be off.`;
    case "offset-adjusted":
      return "The time zone was moved to the nearest allowed one.";
    default:
      return "Snappy noted something it cannot describe. Run it with --verbose and share the code.";
  }
}

function severityOf(code: insights.replySpeed.ReplySpeedNoteCode): NoteLine["severity"] {
  switch (code) {
    case "invalid-now":
    case "no-events":
    case "no-one-to-one-events":
    case "no-replies-found":
    case "few-replies-overall":
      return "warning";
    default:
      return "info";
  }
}

function headline(report: Report, term: Term): string {
  const { you, them } = report.overall;
  if (you === null && them === null) return "  No replies to time yet.";
  const mine = you === null ? "No replies from you were found." : `You typically reply in ${durationText(you.medianMs)}.`;
  const theirs = them === null ? "No replies from friends were found." : `Friends typically reply in ${durationText(them.medianMs)}.`;
  return `  ${term.violet(`${mine} ${theirs}`)}`;
}

function overallLines(report: Report, term: Term): string[] {
  const { you, them } = report.overall;
  const row = (who: string, totals: typeof you): string[] =>
    totals === null ? [who, "0", "-", "-"] : [who, formatCount(totals.replies), durationText(totals.medianMs), durationText(totals.p90Ms)];
  return term.table(
    [{ header: "Who" }, { header: "Replies", align: "right" }, { header: "Typical", align: "right" }, { header: "90% within", align: "right" }],
    [row("You reply", you), row("Friends reply", them)],
  );
}

function rankLines(list: readonly Rank[], term: Term, limit: number): string[] {
  return term.table(
    [{ header: "Friend" }, { header: "Typical", align: "right" }, { header: "90% within", align: "right" }, { header: "Replies", align: "right" }],
    list.slice(0, limit).map((p) => [p.username, durationText(p.medianMs), durationText(p.p90Ms), formatCount(p.replies)]),
  );
}

const hourColumns = [
  { header: "Hour" },
  { header: "Your replies", align: "right" as const },
  { header: "Your typical", align: "right" as const },
  { header: "Their replies", align: "right" as const },
  { header: "Their typical", align: "right" as const },
];

function hourLines(report: Report, term: Term): string[] {
  const rows = report.byHour
    .filter((b) => b.youReplies + b.themReplies > 0)
    .map((b) => [
      hourLabel(b.hour),
      formatCount(b.youReplies),
      b.youMedianMs === null ? "-" : durationText(b.youMedianMs),
      formatCount(b.themReplies),
      b.themMedianMs === null ? "-" : durationText(b.themMedianMs),
    ]);
  return [
    ...term.table(hourColumns, rows),
    "",
    `The hour is when the reply was sent, in ${offsetLabel(report.utcOffsetMinutes)}.`,
    `A dash means fewer than ${plural(report.minReplies, "reply", "replies")}, too few to time.`,
  ];
}

function friendLines(report: Report, term: Term, limit: number, options: ReplySpeedRenderOptions): string[] {
  const shown = report.friends.slice(0, limit);
  const lines = term.table(
    [{ header: "Friend" }, { header: "Your replies", align: "right" }, { header: "Your typical", align: "right" }, { header: "Their replies", align: "right" }, { header: "Their typical", align: "right" }],
    shown.map((f) => [f.username, formatCount(f.youReplies), timeCell(f.you), formatCount(f.themReplies), timeCell(f.them)]),
  );
  const hidden = report.friends.length - shown.length;
  if (hidden > 0) lines.push("", `${plural(hidden, "more friend")} not shown. Use --limit to show more.`);
  if (options.saved !== undefined) {
    lines.push("", `Saved every row to ${options.saved}.`, "The file lists your friends. Keep it somewhere private.");
  } else if (options.nothingToSave === true) {
    lines.push("", "There are no rows to save, so Snappy wrote no file.");
  } else {
    lines.push("", "Add --out reply-speed.csv to save every row.");
  }
  return lines;
}

function methodLines(report: Report): string[] {
  return [
    `A reply is a change of sender within ${plural(report.windowMs / HOUR_MS, "hour")}. A run of messages counts as one turn.`,
    "Typical is the middle reply time. 90% within is the time nine in ten replies beat.",
    `A friend needs ${plural(report.minReplies, "reply", "replies")} on a side to get times.`,
  ];
}

export function renderReplySpeed(report: Report, term: Term, verbose: boolean, options: ReplySpeedRenderOptions = {}): string {
  const limit = Math.max(1, options.limit ?? DEFAULT_LIMIT);
  const out: string[] = [term.bold("Reply speed"), headline(report, term)];
  const s = report.summary;

  if (s.youReplies + s.themReplies === 0) {
    out.push("");
  } else {
    out.push(`  Based on ${plural(s.youReplies, "reply of yours", "replies of yours")} and ${plural(s.themReplies, "reply of theirs", "replies of theirs")}, as of ${formatDate(report.asOf ?? 0)}.`, "");
    out.push(...section(term, "Overall", overallLines(report, term)));

    const lists: [string, readonly Rank[]][] = [
      ["You reply fastest to", report.fastest.you],
      ["You reply slowest to", report.slowest.you],
      ["Friends reply fastest", report.fastest.them],
      ["Friends reply slowest", report.slowest.them],
    ];
    const ranked = lists.filter(([, list]) => list.length > 0);
    for (const [heading, list] of ranked) out.push(...section(term, heading, rankLines(list, term, limit)));
    if (ranked.length === 0) out.push(...section(term, "Fastest and slowest", ["No friend has enough replies to rank yet."]));

    out.push(...section(term, "By hour of day", hourLines(report, term)));
    if (report.friends.length > 0) out.push(...section(term, "Friends", friendLines(report, term, limit, options)));
    out.push(...section(term, "How this is measured", methodLines(report)));
  }

  const notes: NoteLine[] = report.notes.map((n) => ({ severity: severityOf(n.code), code: n.code, text: noteText(n, report) }));
  const noteLines = renderNotes(notes, term, { heading: "Notes", verbose });
  if (noteLines.length > 0) out.push(...noteLines, "");
  return finish(out);
}

// ----------------------------------------------------------------- the file ---

const CSV_HEADER = [
  "Username",
  "Your replies",
  "Your typical reply (seconds)",
  "Your 90% within (seconds)",
  "Their replies",
  "Their typical reply (seconds)",
  "Their 90% within (seconds)",
] as const;

/** One quoted field. A cell a spreadsheet would run as a formula gets a leading apostrophe. */
function csvCell(value: string): string {
  const flat = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").trim();
  return `"${(/^[=+\-@]/.test(flat) ? `'${flat}` : flat).replace(/"/g, '""')}"`;
}

const seconds = (ms: number | undefined): string => (ms === undefined ? "" : String(Math.round(ms / 1000)));

/** Every friend row as CSV, with a byte order mark so Excel reads UTF-8 and CRLF line ends. */
export function friendsCsv(report: Report): string {
  const rows = report.friends.map((f) => [
    f.username,
    String(f.youReplies),
    seconds(f.you?.medianMs),
    seconds(f.you?.p90Ms),
    String(f.themReplies),
    seconds(f.them?.medianMs),
    seconds(f.them?.p90Ms),
  ]);
  return "﻿" + [CSV_HEADER as readonly string[], ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

// --------------------------------------------------------------------- run ---

export async function runReplySpeed(args: string[], io: Io): Promise<number> {
  const { values: flags, positionals } = parseInsightArgs<ReplySpeedFlags>("reply-speed", args, {
    "utc-offset": { type: "string" },
    limit: { type: "string" },
    out: { type: "string" },
    force: { type: "boolean" },
  });
  if (flags.help) {
    io.out.write(REPLY_SPEED_USAGE);
    return 0;
  }
  const term = insightTerm(flags, io);
  const force = flags.force === true;
  // Check every option and the output name before anything is read.
  const utcOffsetMinutes = flags["utc-offset"] === undefined ? undefined : parseUtcOffsetHours(flags["utc-offset"]);
  const limit = intOption("--limit", flags.limit, 1, MAX_LIMIT) ?? DEFAULT_LIMIT;
  const saveOptions = { option: "--out", extension: ".csv", force };
  if (flags.out !== undefined) await checkOutputPath(io, flags.out, saveOptions);

  const input = await loadInsightInput(positionals, io);

  if (input.broken) {
    // A damaged export gives times that may mislead, so say so, save nothing and stop.
    const notes: NoteLine[] = input.issues.map((i) => ({ severity: i.severity, code: i.code, text: i.message }));
    if (flags.json) {
      io.out.write(jsonText({ generatedAt: new Date(input.now).toISOString(), issues: input.issues, stopped: "export-errors" }));
    } else {
      io.out.write(
        finish([
          ...renderNotes(notes, term, { heading: "Export check", verbose: flags.verbose === true }),
          "",
          "Snappy stopped, since reply times from a broken export may mislead.",
          'Run "snappy-export check" to see what to do.',
        ]),
      );
    }
    return 2;
  }

  // Only current friends are listed. A missing friends list would leave everyone out, so it is not used as a filter.
  const friends = input.parsed.friends.friends.map((f) => f.username);
  const report = insights.replySpeed.findReplySpeed(input.parsed.chats, {
    now: input.now,
    ...(friends.length > 0 && { friends }),
    ...(utcOffsetMinutes !== undefined && { utcOffsetMinutes }),
  });

  let saved: string | undefined;
  if (flags.out !== undefined && report.friends.length > 0) {
    await saveInsightFile(io, flags.out, friendsCsv(report), saveOptions);
    saved = flags.out;
  }

  if (flags.json) {
    io.out.write(jsonText({ generatedAt: new Date(input.now).toISOString(), ...report, ...(saved !== undefined && { saved }) }));
  } else {
    io.out.write(renderReplySpeed(report, term, flags.verbose === true, { limit, ...(saved !== undefined && { saved }), nothingToSave: flags.out !== undefined && saved === undefined }));
  }
  return 0;
}

export const replySpeedCommand: InsightCommand = {
  name: "reply-speed",
  synopsis: "reply-speed <ZIP files...>",
  summary: "See how fast you and friends reply.",
  group: "Chats",
  usage: REPLY_SPEED_USAGE,
  run: runReplySpeed,
};
