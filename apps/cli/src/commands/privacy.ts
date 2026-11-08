/**
 * snappy-export privacy: a checklist of Snapchat privacy settings to review in the app. It reads no
 * export, no ledger and no setting, and it writes nothing. The marks are the person's own word,
 * passed with --done for this run only; nothing is saved. The wording comes from this file, and
 * core's result holds ids, states and counts.
 */
import { insights } from "@snappy-export/core";
import { CliError } from "../errors.ts";
import { plural, wasWere } from "../format.ts";
import type { InsightCommand } from "../insights-command.ts";
import { insightTerm, parseIdList, parseInsightArgs } from "../insights-input.ts";
import type { CommonFlags } from "../insights-input.ts";
import type { Io } from "../io.ts";
import { finish, jsonText, renderNotes, section } from "../render-insights.ts";
import type { NoteLine } from "../render-insights.ts";
import type { Term } from "../term.ts";

export const PRIVACY_USAGE = `Usage: snappy-export privacy [options]

Lists the Snapchat privacy settings worth a look, with a short hint for each. Snappy cannot see or
change your settings, and it reads no export. You mark what you have already done.

Options
  --done <ids>  Mark settings as done, by id, separated by commas.
  --json        Print JSON instead of text.
  --verbose     Add a short code to each note, for bug reports.
  --no-color    Plain text.

Marks are not saved. Add every done id each time you run this.
Exit codes: 0 done, 1 could not run.
`;

type Flags = CommonFlags & { done?: string[] };
type Result = insights.privacyTuneup.TuneupResult;
type Item = insights.privacyTuneup.TuneupItem;

const OWN_OPTIONS = { done: { type: "string", multiple: true } } as const;

const STATE_LABEL: Record<insights.privacyTuneup.TuneupItemState, string> = {
  done: "Done",
  skipped: "Skipped",
  later: "Later",
  todo: "To do",
};
const STATE_WIDTH = 9;

const countOf = (n: number | undefined): number => (typeof n === "number" ? n : 0);

/** The sentence for one note. Marks are the person's word, so the wording says so. */
function noteText(n: insights.privacyTuneup.TuneupNote): string {
  const c = countOf(n.params.count);
  switch (n.code) {
    case "self_reported":
      return "These marks are what you told Snappy. It cannot see your settings.";
    case "nothing_reviewed_yet":
      return "Nothing is marked yet. Open Snapchat and go through the list.";
    case "all_reviewed":
      return "Everything is marked done. A check every few months may be worth it.";
    case "stale_reviews":
      return `${plural(c, "done setting")} may be worth a second look.`;
    case "future_dates_ignored":
      return `${plural(c, "date")} in the future ${wasWere(c)} left out.`;
    case "entries_ignored":
      return `${plural(c, "mark")} could not be used.`;
    case "duplicate_entries":
      return `${plural(c, "mark")} ${wasWere(c)} repeated. Snappy used the newest.`;
    default:
      return "Snappy noted something it cannot describe. Run it with --verbose and share the code.";
  }
}

/** Two lines per setting: its state, id and title, then the hint. The state is a word, never color alone. */
function itemLines(items: Item[], idWidth: number): string[] {
  return items.flatMap((i) => [
    `${STATE_LABEL[i.state].padEnd(STATE_WIDTH)}${i.id.padEnd(idWidth)}  ${i.title}${i.stale ? " (review again)" : ""}`,
    `${" ".repeat(STATE_WIDTH + idWidth + 2)}${i.hint}`,
  ]);
}

export function renderPrivacy(raw: Result, term: Term, verbose: boolean): string {
  const result = raw;
  const p = result.progress;
  const all = result.sections.flatMap((s) => s.items);
  const idWidth = Math.max(0, ...all.map((i) => i.id.length));
  const out: string[] = [term.bold("Privacy tune-up")];

  if (p.applicable === 0) out.push("  No settings to check.");
  else out.push(`  ${term.violet(`${p.done} of ${plural(p.applicable, "setting")} marked done, ${p.percent}%.`)}`);
  const extra = [p.skipped > 0 ? `${p.skipped} skipped` : "", p.later > 0 ? `${p.later} for later` : ""].filter((s) => s !== "");
  if (extra.length > 0) out.push(`  ${extra.join(", ")}.`);
  out.push("");

  for (const s of result.sections) out.push(...section(term, s.title, itemLines(s.items, idWidth)));

  const next = all.find((i) => i.id === result.nextItemId);
  if (next !== undefined) {
    // Marks are not saved, so the command to run next carries every done id plus the next one.
    const ids = [...all.filter((i) => i.state === "done" && i.id !== next.id).map((i) => i.id), next.id];
    out.push(...section(term, "Next", [`${next.title}.`, `Run again with --done ${ids.join(",")} when you have checked it.`]));
  }

  const notes: NoteLine[] = result.notes.map((n) => ({ severity: n.code === "entries_ignored" ? "warning" : "info", code: n.code, text: noteText(n) }));
  const noteLines = renderNotes(notes, term, { heading: "Notes", verbose });
  if (noteLines.length > 0) out.push(...noteLines, "");

  out.push("Marks are not saved. Add every done id each time you run this.", "");
  return finish(out);
}

export async function runPrivacy(args: string[], io: Io): Promise<number> {
  const { values: flags, positionals } = parseInsightArgs<Flags>("privacy", args, OWN_OPTIONS);
  if (flags.help) {
    io.out.write(PRIVACY_USAGE);
    return 0;
  }
  const term = insightTerm(flags, io);
  if (positionals.length > 0) {
    throw new CliError("usage", "This command reads no export, so it takes no files. Use --done to mark settings.");
  }
  const done = parseIdList("--done", flags.done, insights.privacyTuneup.PRIVACY_TUNEUP_ITEMS.map((i) => i.id));

  const now = io.now();
  const result = insights.privacyTuneup.buildPrivacyTuneup(done.map((id) => ({ id, state: "done" as const })), now);

  if (flags.json) io.out.write(jsonText({ generatedAt: new Date(now).toISOString(), ...result }));
  else io.out.write(renderPrivacy(result, term, flags.verbose === true));
  return 0;
}

export const privacyCommand: InsightCommand = {
  name: "privacy",
  synopsis: "privacy [--done <ids>]",
  summary: "Walk through your privacy settings.",
  group: "Checklists",
  usage: PRIVACY_USAGE,
  run: runPrivacy,
};
