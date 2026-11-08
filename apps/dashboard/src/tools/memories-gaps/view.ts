import { dataTable } from "../../components/dataTable.ts";
import type { TableCell } from "../../components/dataTable.ts";
import { icon } from "../../components/icon.ts";
import { factList, section } from "../../components/layout.ts";
import { toolView } from "../../components/toolPage.ts";
import type { ToolNote, ToolUi } from "../../components/toolPage.ts";
import { h } from "../../dom.ts";
import { formatCount } from "../../format.ts";
import { OFFSETS, offsetLabel } from "../timezone.ts";
import type { ToolMeta } from "../types.ts";
import { copy } from "./copy.ts";
import { DEFAULT_PARAMS, computeMemoriesGaps } from "./model.ts";
import type { GapNote, GapsParams, GapsResult, MemoryGap, YearMonth } from "./model.ts";

export const meta: ToolMeta = { id: "memories-gaps", group: "memories", category: "memories", icon: "calendar", needs: ["memories"] };

/** The most gap rows the table shows. A longer list is trimmed with a line that says so, so the page stays light. */
const ROW_LIMIT = 50;
/** Shortest gaps to offer, in months. */
const MIN_GAPS = [1, 2, 3, 6, 12] as const;
/** Busiest-stretch widths to offer, in months. */
const STRETCHES = [1, 3, 6, 12] as const;

const num = (n: GapNote, key: string): number => n.params[key] ?? 0;

/** The sentence for one note from core, or null when the page already says it. Hedged: Snappy infers from the dates in the list. */
function noteOf(n: GapNote): ToolNote | null {
  const count = num(n, "count");
  switch (n.code) {
    case "offset-invalid":
      return { kind: "warning", text: copy.offsetInvalidNote };
    case "now-invalid":
      return { kind: "warning", text: copy.nowInvalidNote };
    case "min-gap-adjusted":
      return { kind: "info", text: copy.minGapNote(num(n, "minGapMonths")) };
    case "stretch-adjusted":
      return { kind: "info", text: copy.stretchNote(num(n, "stretchMonths")) };
    case "since-invalid":
      return { kind: "info", text: copy.sinceInvalidNote };
    case "exported-at-invalid":
      return { kind: "info", text: copy.exportDateInvalidNote };
    case "exported-at-future":
      return { kind: "info", text: copy.exportDateFutureNote };
    case "undated-items":
      return { kind: "info", text: copy.undatedNote(count) };
    case "future-dates-skipped":
      return { kind: "warning", text: copy.futureNote(count) };
    case "duplicate-ids-skipped":
      return { kind: "info", text: copy.duplicateNote(count) };
    case "no-dated-items":
      return { kind: "warning", text: copy.noDatesNote };
    case "single-month":
      return { kind: "info", text: copy.singleMonthNote };
    case "no-gaps":
      // The result says it in its own line.
      return null;
    case "gaps-may-be-quiet-time":
      return { kind: "info", text: copy.quietNote(count) };
    case "gap-near-limited-export":
      return { kind: "warning", text: copy.limitedNote(count) };
    default:
      return { kind: "info", text: copy.otherNote };
  }
}

const monthText = (ym: YearMonth): string => copy.unitMonthYear(ym.month, ym.year);

const whereText = (g: MemoryGap): string => {
  const where = g.kind === "start" ? copy.whereStart : g.kind === "end" ? copy.whereEnd : copy.whereMiddle;
  return g.exportHint ? `${where}${copy.unitHinted}` : where;
};

/** A select with its label, drawn like the other selects: the chevron is its own icon, not the browser's arrow. */
function selectField(id: string, label: string, options: readonly [string, string][], value: string, onChange: (value: string) => void): HTMLElement {
  const select = h("select", { id, class: "input", "data-key": id }, ...options.map(([v, text]) => h("option", { value: v, selected: v === value }, text)));
  select.addEventListener("change", () => onChange(select.value));
  const chevron = icon("chevron-right", 16);
  chevron.setAttribute("class", "icon select-chevron");
  return h("div", { class: "field" }, h("label", { class: "label", for: id }, label), h("div", { class: "select-wrap" }, select, chevron));
}

function controls(ui: ToolUi<GapsParams>): HTMLElement {
  return h(
    "div",
    { class: "filters" },
    selectField("gaps-min", copy.minGapLabel, MIN_GAPS.map((n): [string, string] => [String(n), copy.unitMonths(n)]), String(ui.params.minGapMonths), (v) => ui.set({ minGapMonths: Number(v) })),
    selectField("gaps-stretch", copy.stretchLabel, STRETCHES.map((n): [string, string] => [String(n), copy.unitMonths(n)]), String(ui.params.stretchMonths), (v) => ui.set({ stretchMonths: Number(v) })),
    selectField("gaps-offset", copy.zoneLabel, OFFSETS.map((m): [string, string] => [String(m), offsetLabel(m)]), String(ui.params.offsetMinutes), (v) => ui.set({ offsetMinutes: Number(v) })),
  );
}

function glanceSection(r: GapsResult): HTMLElement {
  return section(
    copy.glanceHeading,
    factList([
      { label: copy.datedFact, value: formatCount(r.counts.dated), icon: "memories", scope: "memories" },
      { label: copy.spanFact, value: formatCount(r.range?.months ?? 0), icon: "calendar", scope: "memories" },
      { label: copy.emptyFact, value: formatCount(r.range?.emptyMonths ?? 0), icon: "minus", scope: "memories" },
      { label: copy.longestFact, value: r.longestGapMonths === 0 ? copy.noGapFact : copy.unitMonths(r.longestGapMonths), icon: "quiet", scope: "memories" },
    ]),
  );
}

function gapsSection(r: GapsResult): HTMLElement {
  if (r.gaps.length === 0) return section(copy.gapsHeading, h("p", {}, copy.noGapsLine(r.minGapMonths)));
  const shown = r.gaps.slice(0, ROW_LIMIT);
  return section(
    copy.gapsHeading,
    dataTable(
      copy.gapsCaption,
      [copy.fromHeader, copy.toHeader, copy.whereHeader, copy.lengthHeader],
      shown.map((g) => [monthText(g.from), monthText(g.to), whereText(g), copy.unitMonths(g.months)]),
    ),
    shown.length < r.gaps.length ? h("p", { class: "caption" }, copy.moreLine(shown.length, r.gaps.length)) : null,
  );
}

function busiestSection(r: GapsResult): HTMLElement {
  const rows: TableCell[][] = [];
  const month = r.busiestMonth;
  if (month !== null) {
    const share = `${Math.round((month.count / r.counts.dated) * 100)}%`;
    rows.push([copy.busiestMonthCell, monthText(month), { text: formatCount(month.count), label: copy.unitMemories(month.count) }, { text: share, label: copy.unitShare(share) }]);
  }
  const stretch = r.busiestStretch;
  // A one-month stretch is the busiest month again.
  if (stretch !== null && stretch.months > 1) {
    const share = `${stretch.sharePercent}%`;
    rows.push([copy.stretchCell(stretch.months), copy.unitSpan(monthText(stretch.from), monthText(stretch.to)), { text: formatCount(stretch.count), label: copy.unitMemories(stretch.count) }, { text: share, label: copy.unitShare(share) }]);
  }
  return section(copy.busiestHeading, dataTable(copy.busiestCaption, [copy.highlightHeader, copy.whenHeader, copy.memoriesHeader, copy.shareHeader], rows));
}

export const view = toolView<GapsResult, GapsParams>({
  meta,
  copy,
  params: DEFAULT_PARAMS,
  compute: computeMemoriesGaps,
  isEmpty: (r) => r.counts.dated === 0,
  summary: (r) => (r.counts.dated === 0 ? copy.emptyAnnounce : r.gaps.length === 0 ? copy.noneAnnounce(r.minGapMonths) : copy.foundAnnounce(r.gaps.length)),
  controls,
  render: (r) => [glanceSection(r), gapsSection(r), busiestSection(r)],
  notes: (r): ToolNote[] => [
    { kind: "info", text: copy.offsetNote(offsetLabel(r.utcOffsetMinutes)) },
    ...r.notes.map(noteOf).filter((n): n is ToolNote => n !== null),
    ...(r.gaps.some((g) => g.kind === "start") ? [{ kind: "info", text: copy.startNote } as const] : []),
  ],
  command: "gaps",
});
