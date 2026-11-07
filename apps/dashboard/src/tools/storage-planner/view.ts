import type { insights } from "@snappy-export/core";
import { dataTable } from "../../components/dataTable.ts";
import type { PillKind } from "../../components/dataTable.ts";
import { factList, section } from "../../components/layout.ts";
import { progressBar } from "../../components/progressBar.ts";
import { toolView } from "../../components/toolPage.ts";
import type { ToolNote } from "../../components/toolPage.ts";
import { h } from "../../dom.ts";
import { formatBytes, formatCount, formatPercent } from "../../format.ts";
import type { ToolMeta } from "../types.ts";
import { copy } from "./copy.ts";
import { storageControls } from "./controls.ts";
import { computeStoragePlanner, DEFAULT_PARAMS } from "./model.ts";
import type { StoragePlannerParams, StoragePlannerResult } from "./model.ts";

export const meta: ToolMeta = { id: "storage-planner", group: "memories", category: "memories", icon: "storage", needs: ["export", "memories"] };

type Tally = insights.storagePlanner.PlanTally;
type Fit = insights.storagePlanner.PlanFit;
type Plan = StoragePlannerResult["plan"];

/** How many download steps and batches the page lists. The rest follow the same order. */
const STEP_ROWS = 12;
const BATCH_ROWS = 10;

const FIT_PILL: Record<Fit, PillKind> = { all: "yes", part: "optional", none: "no", unsized: "optional" };

const yearName = (year: number | null): string => (year === null ? copy.noDateLine : String(year));
/** A year inside a sentence-like cell, where "no date" is not the first word. */
const yearInline = (year: number | null): string => (year === null ? copy.unitNoDate : String(year));

/** A size, with "At least" when some items have no known size, and a plain word when none do. */
function sizeCell(t: Tally): string {
  if (t.items > 0 && t.unsized === t.items) return copy.unknownSizeLine;
  const size = formatBytes(t.knownBytes);
  return t.unsized > 0 ? copy.unitAtLeast(size) : size;
}

const countCell = (n: number): string => copy.unitMemories(n);

function yearSpan(first: number | null, last: number | null): string {
  return first === last ? yearName(first) : copy.unitYears(yearName(first), yearInline(last));
}

function goalSection({ plan }: StoragePlannerResult): HTMLElement {
  const { totals, fit } = plan;
  const used = formatBytes(totals.knownBytes);
  const goal = formatBytes(plan.goalBytes);
  const text = copy.meterText(used, goal, formatPercent(fit.fractionOfGoal), totals.isLowerBound);
  return section(
    copy.goalHeading,
    progressBar({ label: copy.meterLabel, value: fit.fractionOfGoal, valueText: text }),
    h("p", {}, text),
    h("p", {}, fit.fitsAll ? copy.fitsAllLine : copy.fitsPartLine(fit.items, fit.deferredItems)),
    factList([
      { label: copy.countedHeader, value: formatCount(totals.items), icon: "memories" },
      { label: copy.fitsHeader, value: formatCount(fit.items), icon: "check" },
      { label: copy.waitsHeader, value: formatCount(fit.deferredItems), icon: "storage" },
    ]),
  );
}

const yearSection = (plan: Plan): HTMLElement =>
  section(
    copy.byYearHeading,
    dataTable(
      copy.byYearCaption,
      [copy.yearHeader, copy.memoriesHeader, copy.sizeHeader, copy.shareHeader, copy.fitHeader],
      plan.byYear.map((y) => [yearName(y.year), countCell(y.items), sizeCell(y), copy.unitShare(formatPercent(y.share)), copy.fitStates[y.fit]]),
      { pills: { column: 4, kinds: plan.byYear.map((y) => FIT_PILL[y.fit]) } },
    ),
  );

const typeSection = (plan: Plan): HTMLElement =>
  section(
    copy.byTypeHeading,
    dataTable(
      copy.byTypeCaption,
      [copy.typeHeader, copy.memoriesHeader, copy.sizeHeader, copy.shareHeader],
      plan.byType.filter((t) => t.items > 0).map((t) => [copy.types[t.type], countCell(t.items), sizeCell(t), copy.unitShare(formatPercent(t.share))]),
    ),
  );

const partSection = (plan: Plan): HTMLElement =>
  section(
    copy.byPartHeading,
    dataTable(
      copy.byPartCaption,
      [copy.partHeader, copy.memoriesHeader, copy.sizeHeader],
      plan.byPart.map((p) => [p.part === null ? copy.noFileLine : copy.unitPart(p.part), countCell(p.items), sizeCell(p)]),
    ),
  );

function orderSection(plan: Plan): HTMLElement {
  const shown = plan.priority.slice(0, STEP_ROWS);
  return section(
    copy.orderHeading,
    h("p", {}, plan.order === "newest-first" ? copy.orderNewestNote : copy.orderOldestNote),
    dataTable(
      copy.orderCaption,
      [copy.stepHeader, copy.groupHeader, copy.memoriesHeader, copy.sizeHeader, copy.fitHeader],
      shown.map((c, i) => [copy.unitStep(i + 1), copy.unitGroup(copy.types[c.type], yearInline(c.year)), countCell(c.items), sizeCell(c), copy.fitStates[c.fit]]),
      { pills: { column: 4, kinds: shown.map((c) => FIT_PILL[c.fit]) } },
    ),
    plan.priority.length > shown.length ? h("p", { class: "caption" }, copy.moreStepsLine(plan.priority.length - shown.length)) : null,
  );
}

function batchSection(plan: Plan): HTMLElement {
  const shown = plan.batches.slice(0, BATCH_ROWS);
  return section(
    copy.batchesHeading,
    h("p", {}, copy.batchesLine(plan.batches.length, formatBytes(plan.batchBytes))),
    dataTable(
      copy.batchesCaption,
      [copy.batchHeader, copy.memoriesHeader, copy.sizeHeader, copy.yearsHeader, copy.partsHeader],
      shown.map((b) => [
        copy.unitBatch(b.index),
        countCell(b.items),
        formatBytes(b.bytes),
        yearSpan(b.firstYear, b.lastYear),
        b.parts.length > 0 ? copy.unitParts(b.parts.length, b.parts.join(", ")) : copy.noFileLine,
      ]),
    ),
    plan.batches.length > shown.length ? h("p", { class: "caption" }, copy.moreBatchesLine(plan.batches.length - shown.length)) : null,
  );
}

/** Codes the page says in another way: the goal section already tells what would wait, and the empty state covers no Memories. */
const SAID_ELSEWHERE: ReadonlySet<string> = new Set(["empty", "over-goal"]);

/** The sentence for one note. Hedged: sizes come from the export's own lists. */
function noteText(n: insights.storagePlanner.PlanNote): ToolNote {
  const count = Object.values(n.params)[0] ?? 0;
  switch (n.code) {
    case "lower-bound":
      return { kind: "warning", text: copy.unsizedNote(count) };
    case "undated-items":
      return { kind: "info", text: copy.undatedNote(count) };
    case "future-dates":
      return { kind: "warning", text: copy.futureNote(count) };
    case "oversize-items":
      return { kind: "warning", text: copy.oversizeNote(count) };
    case "duplicates-skipped":
      return { kind: "info", text: copy.duplicatesNote(count) };
    default:
      // The goal and batch size are checked before they reach the plan, so their notes never apply here.
      return { kind: "info", text: copy.otherNote };
  }
}

export const view = toolView<StoragePlannerResult, StoragePlannerParams>({
  meta,
  copy,
  params: DEFAULT_PARAMS,
  compute: computeStoragePlanner,
  // Nothing can be planned without at least one known size.
  isEmpty: ({ plan }) => plan.totals.items === plan.totals.unsized,
  summary: ({ plan }) => copy.doneAnnounce(sizeCell({ ...plan.totals, items: plan.totals.items }), formatBytes(plan.goalBytes), plan.fit.deferredItems),
  controls: storageControls,
  render: (result) => {
    const { plan } = result;
    return [
      goalSection(result),
      yearSection(plan),
      typeSection(plan),
      plan.byPart.some((p) => p.part !== null) ? partSection(plan) : null,
      orderSection(plan),
      plan.batches.length > 0 ? batchSection(plan) : null,
    ];
  },
  notes: ({ plan }): ToolNote[] => plan.notes.filter((n) => !SAID_ELSEWHERE.has(n.code)).map(noteText),
  command: "storage",
});
