/**
 * snappy-export storage: plan how to save your Memories under a storage goal. Read-only: it writes
 * no file and never opens the ledger. The plan comes from core's storagePlanner; this file turns its
 * codes into short sentences. Sizes, dates and counts only, never a name, link or path from the
 * export, and the opaque Memory ids that core lists in each batch are dropped from every output.
 */
import { insights } from "@snappy-export/core";
import { CliError } from "../errors.ts";
import { formatBytes, formatCount, formatPercent, NO_VALUE, noun, plural, wasWere } from "../format.ts";
import type { InsightCommand } from "../insights-command.ts";
import { insightTerm, loadInsightInput, parseInsightArgs } from "../insights-input.ts";
import type { CommonFlags } from "../insights-input.ts";
import type { Io } from "../io.ts";
import { PRIVACY_RESULTS, renderIssues } from "../render.ts";
import { finish, jsonText, renderNotes, section } from "../render-insights.ts";
import type { NoteLine } from "../render-insights.ts";
import type { Term } from "../term.ts";

export const STORAGE_USAGE = `Usage: snappy-export storage <ZIP files or folder...> [options]

Plans how to save your Memories under a storage goal: sizes by year, type and ZIP part, a
download order, and batches. It reads dates, types and sizes only, and writes no file.

Give it every part of your export, or a folder or wildcard such as "mydata*.zip".

Options
  --goal-gb <n>   Your storage goal in GB. Default: 5.
  --batch-gb <n>  The largest batch in GB. Default: 1.
  --oldest-first  Save the oldest year first, not the newest.
  --json          Print JSON instead of text.
  --verbose       Add a short code to each note, for bug reports.
  --no-color      Plain text.

Exit codes: 0 plan made, 1 could not run, 2 the export has errors.
`;

type Flags = CommonFlags & { "goal-gb"?: string; "batch-gb"?: string; "oldest-first"?: boolean };
type Plan = insights.storagePlanner.StoragePlan;
type Tally = insights.storagePlanner.PlanTally;
type Fit = insights.storagePlanner.PlanFit;

/** How many download groups and batches the text shows. The JSON has them all. */
const PRIORITY_ROWS = 12;
const BATCH_ROWS = 10;
const GB = 1000 ** 3;

const TYPE_LABEL = { image: "Photos", video: "Videos", unknown: "Other" } as const;
const FIT_LABEL: Record<Fit, string> = { all: "Yes", part: "Partly", none: "No", unsized: "Unknown" };

/** A whole or decimal number above 0, in GB, as bytes. The typed value is never echoed. */
function gbOption(name: string, raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const gb = Number(raw);
  if (!/^\d+(?:\.\d+)?$/.test(raw.trim()) || !Number.isFinite(gb) || gb <= 0 || gb > 100_000) {
    throw new CliError("usage", `${name} must be a number above 0, for example ${name} 5.`);
  }
  return gb * GB;
}

const yearLabel = (year: number | null): string => (year === null ? "No date" : String(year));

function yearSpan(first: number | null, last: number | null): string {
  if (first === last) return yearLabel(first);
  if (first === null) return `No date to ${yearLabel(last)}`;
  if (last === null) return `${first} and no date`;
  return `${first} to ${last}`;
}

/** A size, with "At least" when some items have no known size and "Unknown" when none do. */
function sizeCell(t: Tally): string {
  if (t.items > 0 && t.unsized === t.items) return "Unknown";
  return `${t.unsized > 0 ? "At least " : ""}${formatBytes(t.knownBytes)}`;
}

/** The sentence for one note. Hedged: sizes come from the export's own lists. */
function noteText(n: insights.storagePlanner.PlanNote): string {
  const count = Object.values(n.params)[0] ?? 0;
  const memories = plural(count, "Memory", "Memories");
  switch (n.code) {
    case "empty":
      return "No Memories were found in this export.";
    case "goal-defaulted":
      return "The goal was not usable, so Snappy used 5 GB.";
    case "batch-size-defaulted":
      return "The batch size was not usable, so Snappy used 1 GB.";
    case "lower-bound":
      return `${memories} ${noun(count, "has", "have")} no known size. Sizes marked with + may be short.`;
    case "over-goal":
      return `${memories} would not fit under your goal.`;
    case "undated-items":
      return `${memories} ${noun(count, "has", "have")} no usable date and ${noun(count, "comes", "come")} last.`;
    case "future-dates":
      return `${memories} ${noun(count, "has", "have")} a date in the future. Snappy treats ${noun(count, "it", "them")} as undated.`;
    case "oversize-items":
      return `${memories} ${noun(count, "is", "are")} larger than a batch and ${noun(count, "gets", "get")} ${noun(count, "a batch", "batches")} alone.`;
    case "duplicates-skipped":
      return `${plural(count, "probable duplicate")} ${wasWere(count)} left out of these numbers.`;
    default:
      return "Snappy noted something it cannot describe. Run it with --verbose and share the code.";
  }
}

const NOTE_SEVERITY: Record<string, NoteLine["severity"]> = {
  "lower-bound": "warning",
  "future-dates": "warning",
  "oversize-items": "warning",
  "goal-defaulted": "warning",
  "batch-size-defaulted": "warning",
};

/** What the goal means for the whole plan, in one sentence. */
function fitSentence(plan: Plan): string {
  if (plan.totals.items === 0) return "No Memories were found.";
  if (plan.fit.fitsAll) return "Everything with a known size fits under your goal.";
  return `Your goal fits ${plural(plan.fit.items, "Memory", "Memories")}. ${plural(plan.fit.deferredItems, "Memory", "Memories")} would wait for more space.`;
}

export function renderStorage(plan: Plan, term: Term, verbose: boolean): string {
  const out: string[] = [term.bold("Memories storage plan"), ""];
  const t = plan.totals;

  // The one key figure: how full the goal is.
  const known = `${t.isLowerBound ? "At least " : ""}${formatBytes(t.knownBytes)}`;
  out.push(
    ...section(term, "Your goal", [
      `${term.violet(`${known} of ${formatBytes(plan.goalBytes)}`)} (${formatPercent(plan.fit.fractionOfGoal)})`,
      `${plural(t.items, "Memory", "Memories")} counted.`,
      fitSentence(plan),
    ]),
  );

  if (t.items > 0) {
    out.push(
      ...section(
        term,
        "By year",
        term.table(
          [{ header: "Year" }, { header: "Memories", align: "right" }, { header: "Size", align: "right" }, { header: "Share", align: "right" }, { header: "Fits" }],
          plan.byYear.map((y) => [yearLabel(y.year), formatCount(y.items), sizeCell(y), formatPercent(y.share), FIT_LABEL[y.fit]]),
        ),
      ),
      ...section(
        term,
        "By type",
        term.table(
          [{ header: "Type" }, { header: "Memories", align: "right" }, { header: "Size", align: "right" }, { header: "Share", align: "right" }],
          plan.byType.filter((r) => r.items > 0).map((r) => [TYPE_LABEL[r.type], formatCount(r.items), sizeCell(r), formatPercent(r.share)]),
        ),
      ),
    );
    if (plan.byPart.some((p) => p.part !== null)) {
      out.push(
        ...section(
          term,
          "By ZIP part",
          term.table(
            [{ header: "Part" }, { header: "Memories", align: "right" }, { header: "Size", align: "right" }],
            plan.byPart.map((p) => [p.part === null ? "No file" : `Part ${p.part}`, formatCount(p.items), sizeCell(p)]),
          ),
        ),
      );
    }

    const first = plan.order === "newest-first" ? "Newest" : "Oldest";
    const shown = plan.priority.slice(0, PRIORITY_ROWS);
    out.push(
      ...section(term, "Download order", [
        `${first} year first. Within a year: photos, then videos. Memories with no date come last.`,
        ...term.table(
          [{ header: "Step", align: "right" }, { header: "Year" }, { header: "Type" }, { header: "Memories", align: "right" }, { header: "Size", align: "right" }, { header: "Fits" }],
          shown.map((c, i) => [String(i + 1), yearLabel(c.year), TYPE_LABEL[c.type], formatCount(c.items), sizeCell(c), FIT_LABEL[c.fit]]),
        ),
        ...(plan.priority.length > shown.length ? [`${plural(plan.priority.length - shown.length, "more step")} follow in the same order. Add --json for all of them.`] : []),
      ]),
    );

    if (plan.batches.length > 0) {
      const rows = plan.batches.slice(0, BATCH_ROWS);
      out.push(
        ...section(term, "Batches", [
          `${plural(plan.batches.length, "batch", "batches")} of up to ${formatBytes(plan.batchBytes)}, for what fits under your goal.`,
          ...term.table(
            [{ header: "Batch", align: "right" }, { header: "Memories", align: "right" }, { header: "Size", align: "right" }, { header: "Years" }, { header: "ZIP parts" }],
            rows.map((b) => [String(b.index), formatCount(b.items), formatBytes(b.bytes), yearSpan(b.firstYear, b.lastYear), b.parts.length > 0 ? b.parts.join(", ") : NO_VALUE]),
          ),
          ...(plan.batches.length > rows.length ? [`${plural(plan.batches.length - rows.length, "more batch", "more batches")} follow. Add --json for all of them.`] : []),
        ]),
      );
    }
  }

  const notes: NoteLine[] = plan.notes.map((n) => ({ severity: NOTE_SEVERITY[n.code] ?? "info", code: n.code, text: noteText(n) }));
  const noteLines = renderNotes(notes, term, { heading: "Notes", verbose });
  if (noteLines.length > 0) out.push(...noteLines, "");
  return finish(out);
}

/** The plan without the opaque Memory ids that core lists in each batch. */
function planForJson(plan: Plan): Omit<Plan, "batches"> & { batches: Omit<Plan["batches"][number], "itemIds">[] } {
  return { ...plan, batches: plan.batches.map(({ itemIds: _ids, ...rest }) => rest) };
}

export async function runStorage(args: string[], io: Io): Promise<number> {
  const { values: flags, positionals } = parseInsightArgs<Flags>("storage", args, {
    "goal-gb": { type: "string" },
    "batch-gb": { type: "string" },
    "oldest-first": { type: "boolean" },
  });
  if (flags.help) {
    io.out.write(STORAGE_USAGE);
    return 0;
  }
  const term = insightTerm(flags, io);
  const goalBytes = gbOption("--goal-gb", flags["goal-gb"]);
  const batchBytes = gbOption("--batch-gb", flags["batch-gb"]);

  const input = await loadInsightInput(positionals, io);
  const generatedAt = new Date(input.now).toISOString();

  // A broken export is described, never planned from, the same way `analyze` stops.
  if (input.broken) {
    if (flags.json) {
      io.out.write(jsonText({ generatedAt, issues: input.issues, stopped: "export-errors" }));
    } else {
      const labeled = input.issues.map((i) => ({ ...i, source: "your export" }));
      io.out.write(
        [
          ...renderIssues(labeled, term, flags.verbose === true),
          "",
          "Snappy did not plan from a broken export. Fix the problems above and run it again.",
          PRIVACY_RESULTS,
        ].join("\n") + "\n",
      );
    }
    return 2;
  }

  const plan = insights.storagePlanner.planMemoryStorage(input.parsed.memories, goalBytes ?? 5 * GB, {
    order: flags["oldest-first"] === true ? "oldest-first" : "newest-first",
    batchBytes,
    now: input.now,
  });

  if (flags.json) io.out.write(jsonText({ generatedAt, ...planForJson(plan) }));
  else io.out.write(renderStorage(plan, term, flags.verbose === true));
  return 0;
}

export const storageCommand: InsightCommand = {
  name: "storage",
  synopsis: "storage <ZIP files...>",
  summary: "Plan how to save your Memories.",
  group: "Memories",
  usage: STORAGE_USAGE,
  run: runStorage,
};
