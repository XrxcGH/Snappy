import { section } from "../../components/layout.ts";
import { meterBlock } from "../../components/meterBlock.ts";
import { tickList } from "../../components/tickList.ts";
import type { TickItem } from "../../components/tickList.ts";
import { toolView } from "../../components/toolPage.ts";
import type { ToolNote } from "../../components/toolPage.ts";
import { h } from "../../dom.ts";
import type { ToolMeta } from "../types.ts";
import { copy } from "./copy.ts";
import { computeSafetyChecklist, safetyProgress } from "./model.ts";
import type { SafetyChecklistResult, SafetyHint, SafetyProgress } from "./model.ts";

export const meta: ToolMeta = { id: "safety-checklist", group: "checklists", category: "neutral", icon: "shield", needs: [] };

const hintText = (hint: SafetyHint): string => (hint.kind === "blocked" ? copy.blockedHint(hint.count) : copy.pendingHint(hint.count));
const progressText = (p: SafetyProgress): string => copy.progressText(p.done, p.total);

export const view = toolView<SafetyChecklistResult, Record<string, never>>({
  meta,
  copy,
  compute: computeSafetyChecklist,
  summary: ({ items }) => copy.readyAnnounce(items.length),
  render: ({ items }, ui) => {
    const tickItems: TickItem[] = items.map((item) => ({ id: item.id, label: copy.items[item.id].label, hint: item.hint ? hintText(item.hint) : copy.items[item.id].hint }));
    const list = tickList(ui, meta.id, tickItems);

    // A mark changes the saved or session ticks, which repaints the page, so the progress is read fresh each time.
    const p = safetyProgress(ui.ticks, ui.data.now);
    const text = progressText(p);
    const progress = meterBlock({ name: copy.meterName, label: copy.progressLabel, value: p.done / p.total, valueText: text });
    return [section(copy.progressHeading, progress, h("p", { class: "caption" }, copy.reviewLine)), section(copy.stepsHeading, list)];
  },
  notes: ({ hasExport }): ToolNote[] => (hasExport ? [] : [{ kind: "info", text: copy.noExportNote }]),
  command: "safety",
});
