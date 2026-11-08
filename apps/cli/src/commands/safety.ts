/**
 * snappy-export safety: a short account safety checklist. It is self-reported: Snappy cannot see
 * your settings, so the person says what is done with --done. Nothing is saved between runs and no
 * file is written. Giving an export is optional; it only adds two counts (blocked people and
 * pending requests). Counts only, never a username. Login history is never read.
 */
import { insights } from "@snappy-export/core";
import { formatPercent, isAre, noun, plural, wasWere } from "../format.ts";
import type { InsightCommand } from "../insights-command.ts";
import { insightTerm, loadInsightInput, parseIdList, parseInsightArgs } from "../insights-input.ts";
import type { CommonFlags } from "../insights-input.ts";
import type { Io } from "../io.ts";
import { finish, jsonText, renderNotes, section } from "../render-insights.ts";
import type { NoteLine } from "../render-insights.ts";
import type { Term } from "../term.ts";

export const SAFETY_USAGE = `Usage: snappy-export safety [ZIP files or folder...] [options]

Shows a short account safety checklist. It is self-reported: Snappy cannot see your settings, so
you say what you have done in Snapchat.

Give it your export to add counts of blocked people and pending requests. This is optional, and
nothing is saved between runs.

Options
  --done <names>  The names of the steps you have done, separated by commas. Repeat for more.
  --json          Print JSON instead of text.
  --verbose       Add a short code to each note, for bug reports.
  --no-color      Plain text.

Exit codes: 0 done, 1 could not run.
`;

type Flags = CommonFlags & { done?: string[] };
type Checklist = insights.safetyChecklist.SafetyChecklist;
type Item = insights.safetyChecklist.SafetyItem;
type Note = insights.safetyChecklist.SafetyNote;

const STATUS: Record<insights.safetyChecklist.SafetyStatus, string> = {
  done: "Done",
  todo: "To do",
  stale: "Look again",
};

const num = (n: Note): number => (typeof n.params.count === "number" ? n.params.count : 0);

/** The sentence for one note from core, or from this command. Counts only. */
function noteText(n: Note): string {
  const count = num(n);
  switch (n.code) {
    case "tick-ids-unknown":
      return `${plural(count, "name")} did not match the list. Snappy left ${noun(count, "it", "them")} out.`;
    case "tick-ids-duplicate":
      return `${plural(count, "name")} ${wasWere(count)} given more than once. Snappy counted each one once.`;
    case "tick-times-future":
      return `${plural(count, "date")} ${isAre(count)} in the future. Snappy left ${noun(count, "it", "them")} out.`;
    case "export-not-used":
      return "Your export looks unusable, so Snappy left its counts out.";
    default:
      return "Snappy noted something it cannot describe. Run it with --verbose and share the code.";
  }
}

/** A hint from the export, tied to its item by position. Hedged, since the lists may be partial. */
function hintText(item: Item, hint: Note): string {
  const count = num(hint);
  switch (hint.code) {
    case "blocked-entries":
      return `Your export lists ${plural(count, "blocked person", "blocked people")}. Item ${item.order} may be worth a look.`;
    case "pending-entries":
      return `Your export lists ${plural(count, "pending request")}. Item ${item.order} may be worth a look.`;
    default:
      return `Item ${item.order} may be worth a look.`;
  }
}

export function renderSafety(result: Checklist, term: Term, verbose: boolean): string {
  const p = result.progress;
  const out: string[] = [term.bold("Account safety checklist")];
  out.push(`  ${term.violet(`${p.done} of ${plural(p.total, "item")} marked done (${formatPercent(p.percent / 100)}).`)}`);
  out.push("  This list is self-reported. Snappy cannot see your settings.", "");

  out.push(
    ...section(
      term,
      "Checklist",
      term.table(
        [{ header: "#", align: "right" }, { header: "Status" }, { header: "Name" }, { header: "What to check" }],
        result.items.map((i) => [String(i.order), STATUS[i.status], i.id, insights.safetyChecklist.SAFETY_ITEM_TEXT[i.id]?.label ?? "Review this item"]),
      ),
    ),
  );

  const hints = result.items.filter((i) => i.hint !== undefined);
  if (hints.length > 0) out.push(...section(term, "From your export", hints.map((i) => hintText(i, i.hint as Note))));

  const notes: NoteLine[] = result.notes.map((n) => ({ severity: "warning", code: n.code, text: noteText(n) }));
  const noteLines = renderNotes(notes, term, { heading: "Notes", verbose });
  if (noteLines.length > 0) out.push(...noteLines, "");

  const next =
    p.todo + p.stale === 0
      ? ["Everything on the list is marked done. It may be worth a fresh look every few months."]
      : ["Run this again with --done and the names you finished to see your progress.", "Nothing is saved between runs."];
  out.push(...section(term, "Next", next));
  return finish(out);
}

export async function runSafety(args: string[], io: Io): Promise<number> {
  const { values: flags, positionals } = parseInsightArgs<Flags>("safety", args, { done: { type: "string", multiple: true } });
  if (flags.help) {
    io.out.write(SAFETY_USAGE);
    return 0;
  }
  const term = insightTerm(flags, io);
  const done = parseIdList("--done", flags.done, insights.safetyChecklist.SAFETY_ITEM_IDS);
  const ticks = Object.fromEntries(done.map((id) => [id, true]));

  // The export is optional and adds counts only. A broken one is not used.
  const input = positionals.length > 0 ? await loadInsightInput(positionals, io) : undefined;
  const now = input?.now ?? io.now();
  const friends = input !== undefined && !input.broken ? input.parsed.friends : undefined;
  const built = insights.safetyChecklist.buildSafetyChecklist({ now, ticks, ...(friends !== undefined && { friends }) });
  const result: Checklist = input !== undefined && friends === undefined ? { ...built, notes: [...built.notes, { code: "export-not-used", params: {} }] } : built;

  if (flags.json) io.out.write(jsonText({ generatedAt: new Date(now).toISOString(), ...result }));
  else io.out.write(renderSafety(result, term, flags.verbose === true));
  return 0;
}

export const safetyCommand: InsightCommand = {
  name: "safety",
  synopsis: "safety [ZIP files...]",
  summary: "Walk through an account safety checklist.",
  group: "Checklists",
  usage: SAFETY_USAGE,
  run: runSafety,
};
