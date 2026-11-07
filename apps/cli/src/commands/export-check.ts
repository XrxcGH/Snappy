/**
 * snappy-export check: is this export complete enough to use, and what to do if not. Read-only: it
 * writes no file and never opens the ledger. The verdict comes from core's exportCheck; this file
 * turns its codes into short sentences. Counts and dates only, never a name from the export.
 */
import { insights } from "@snappy-export/core";
import { formatCount, formatDate, noun, plural } from "../format.ts";
import type { InsightCommand } from "../insights-command.ts";
import { friendCountOf, insightTerm, loadInsightInput, parseInsightArgs, FRIEND_COUNT_OPTIONS } from "../insights-input.ts";
import type { CommonFlags, FriendCountFlags } from "../insights-input.ts";
import type { Io } from "../io.ts";
import { daysAgo, finish, jsonText, renderNotes, section } from "../render-insights.ts";
import type { NoteLine } from "../render-insights.ts";
import type { Term } from "../term.ts";

export const EXPORT_CHECK_USAGE = `Usage: snappy-export check <ZIP files or folder...> [options]

Checks that your export is complete enough to use, and says what to do if it is not. It reads
the lists and dates only, never message text, photos or videos.

Give it every part of your export, or a folder or wildcard such as "mydata*.zip".

Options
  --friend-count <n>  The friend count in the app, to catch a short export.
  --json              Print JSON instead of text.
  --verbose           Add a short code to each note, for bug reports.
  --no-color          Plain text.

Exit codes: 0 ready to use, 1 could not run, 2 the export is incomplete or unusable.
`;

type Flags = CommonFlags & FriendCountFlags;
type Check = insights.exportCheck.ExportCheck;

const SECTION_LABEL: Record<insights.exportCheck.SectionId, string> = {
  friends: "Friends list",
  chat_history: "Chat history",
  snap_history: "Snap history",
  memories_list: "Memories list",
  memories_files: "Memories files",
};
/** Lowercase names for use inside a sentence. */
const SECTION_NAME: Record<insights.exportCheck.SectionId, string> = {
  friends: "friends list",
  chat_history: "chat history",
  snap_history: "Snap history",
  memories_list: "Memories list",
  memories_files: "Memories files",
};
const STATUS_LABEL: Record<insights.exportCheck.SectionStatus, string> = {
  present: "Found",
  empty: "Empty",
  missing: "Not found",
  unreadable: "Unreadable",
};
const VERDICT: Record<insights.exportCheck.CheckStatus, string> = {
  ready: "Your export looks ready to use.",
  "ready-with-notes": "Your export looks usable, with a few notes.",
  incomplete: "Your export may be missing some parts.",
  unusable: "Snappy cannot use this export yet.",
};

const num = (v: insights.exportCheck.ParamValue | undefined): number => (typeof v === "number" ? v : 0);
const sectionName = (v: insights.exportCheck.ParamValue | undefined): string => SECTION_NAME[v as insights.exportCheck.SectionId] ?? "list";

/** The sentence for one note. Hedged: Snappy infers from what is in the files. */
function noteText(n: insights.exportCheck.CheckNote): string {
  const count = num(n.params.count);
  switch (n.code) {
    case "html-only-export":
      return "This export is in HTML format. Snappy needs the JSON format.";
    case "no-parts":
      return "No export files were given.";
    case "parts-unreadable":
      return `${plural(count, "ZIP file")} could not be read.`;
    case "parts-empty":
      return `${plural(count, "ZIP file")} ${noun(count, "holds", "hold")} no files.`;
    case "duplicate-usernames":
      return `${plural(count, "repeated username")} in your lists. Snappy counts each person once.`;
    case "friends-empty-but-deleted":
      return "Your friends list is empty, but removed friends are listed. The export may be cut short.";
    case "possibly-date-limited":
      return "The export may cover only part of your history.";
    case "friend-count-mismatch":
      return "The friends list differs from the count you gave. The export may be short.";
    case "future-timestamps":
      return "Some dates are in the future. A device clock may have been wrong.";
    case "dates-in-future":
      return `${plural(count, "date")} in your ${sectionName(n.params.section)} ${noun(count, "is", "are")} in the future. Snappy leaves ${noun(count, "it", "them")} out.`;
    case "dates-missing":
      return `${plural(count, "entry", "entries")} in your ${sectionName(n.params.section)} ${noun(count, "has", "have")} no usable date.`;
    case "export-stale":
      return `This export is about ${plural(num(n.params.ageDays), "day")} old. Request a new one for current results.`;
    case "export-aging":
      return `This export is about ${plural(num(n.params.ageDays), "day")} old.`;
    case "export-date-in-future":
      return "The export date is in the future. Check the date on your device.";
    case "age-from-activity":
      return "The export has no date, so its age comes from the newest activity. It may be newer.";
    case "memories-without-file":
      return `${plural(count, "Memory", "Memories")} ${noun(count, "has", "have")} no matching file in your ZIP files.`;
    case "memories-files-not-found":
      return "Your Memories list is there, but these ZIP files hold no Memories files.";
    case "more-parts-may-exist":
      return "Your export may have more parts. Add the other ZIP files.";
    default:
      return "Snappy noted something it cannot describe. Run it with --verbose and share the code.";
  }
}

/** The sentence for one next step. */
function todoText(a: insights.exportCheck.CheckAction, parts: insights.exportCheck.PartsCheck): string {
  switch (a.code) {
    case "add-export-files":
      return parts.count > 0 && parts.unreadable >= parts.count
        ? "Download your ZIP files again, since they may be damaged."
        : "Add your export: .zip files, or a folder with every part.";
    case "request-json-export":
      return "Request your data again from Snapchat and choose the JSON format.";
    case "reread-parts":
      return `Download the ${plural(num(a.params.count), "damaged ZIP file")} again.`;
    case "add-other-parts":
      return "Add the other parts of your export. Their names end in -2, -3 and so on.";
    case "request-sections": {
      const names = (Array.isArray(a.params.sections) ? a.params.sections : []).map((s) => sectionName(s));
      return `Request your data again and include: ${names.join(", ")}.`;
    }
    case "choose-all-time":
      return "When you request a new export, choose all time as the date range.";
    case "request-newer-export":
      return "Request a newer export from Snapchat.";
    case "check-export-date":
      return "Check the date on your device, then run this again.";
    default:
      return "Run Snappy with --verbose and share the code.";
  }
}

/** The span of dates in one kind of record, or a dash when there are none. */
const dateCell = (ms: number | null): string => (ms === null ? "-" : formatDate(ms));

function ageLine(age: insights.exportCheck.ExportAge): string {
  if (age.at === null) return "Snappy could not tell when this export was made.";
  const when = formatDate(age.at);
  if (age.basis === "newest-activity") return `No export date found. The newest activity is from ${when}.`;
  return age.ageDays === null ? `Made ${when}.` : `Made ${when}, ${daysAgo(age.ageDays)}.`;
}

export function renderExportCheck(check: Check, term: Term, verbose: boolean): string {
  const out: string[] = [term.bold("Export check"), `  ${term.violet(VERDICT[check.status])}`, ""];

  out.push(
    ...section(term, "What was found", [
      `${plural(check.parts.count, "ZIP file")} read.`,
      ...term.table(
        [{ header: "Section" }, { header: "Status" }, { header: "Items", align: "right" }],
        check.sections.map((s) => [SECTION_LABEL[s.id], STATUS_LABEL[s.status], formatCount(s.count)]),
      ),
    ]),
  );

  const rows = (
    [
      ["Chats", check.coverage.chats],
      ["Snaps", check.coverage.snaps],
      ["Memories", check.coverage.memories],
    ] as const
  ).filter(([, c]) => c.dated > 0);
  if (rows.length > 0) {
    out.push(
      ...section(term, "Dates covered", term.table(
        [{ header: "Records" }, { header: "From" }, { header: "To" }, { header: "Span", align: "right" }],
        rows.map(([label, c]) => [label, dateCell(c.oldest), dateCell(c.newest), c.spanDays === null ? "-" : plural(c.spanDays, "day")]),
      )),
    );
  }

  out.push(...section(term, "Export date", [ageLine(check.age)]));

  const notes: NoteLine[] = check.notes.map((n) => ({ severity: n.severity, code: n.code, text: noteText(n) }));
  const noteLines = renderNotes(notes, term, { heading: "Notes", verbose });
  if (noteLines.length > 0) out.push(...noteLines, "");

  if (check.todo.length > 0) {
    out.push(...section(term, "What to do", check.todo.map((a, i) => `${i + 1}. ${todoText(a, check.parts)}`)));
  }
  return finish(out);
}

export async function runExportCheck(args: string[], io: Io): Promise<number> {
  const { values: flags, positionals } = parseInsightArgs<Flags>("check", args, FRIEND_COUNT_OPTIONS);
  if (flags.help) {
    io.out.write(EXPORT_CHECK_USAGE);
    return 0;
  }
  const friendCount = friendCountOf(flags);
  const term = insightTerm(flags, io);

  // The check reads the export as it is, so a damaged one is described, never refused.
  const input = await loadInsightInput(positionals, io, { friendCount, layout: true, structure: true });
  const check = insights.exportCheck.checkExport({
    parsed: input.parsed,
    now: input.now,
    validation: input.issues,
    layout: input.layout,
    structure: input.structure,
    partCount: input.parts.count,
    unreadableParts: input.parts.unreadable,
  });

  if (flags.json) {
    io.out.write(jsonText({ generatedAt: new Date(input.now).toISOString(), ...check }));
  } else {
    io.out.write(renderExportCheck(check, term, flags.verbose === true));
  }
  return check.status === "ready" || check.status === "ready-with-notes" ? 0 : 2;
}

export const exportCheckCommand: InsightCommand = {
  name: "check",
  synopsis: "check <ZIP files...>",
  summary: "Check that your export is complete.",
  group: "Your export",
  usage: EXPORT_CHECK_USAGE,
  run: runExportCheck,
};
