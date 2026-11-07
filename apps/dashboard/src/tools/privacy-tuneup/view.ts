import { section, stat, statGrid } from "../../components/layout.ts";
import { meterBlock } from "../../components/meterBlock.ts";
import { tickList } from "../../components/tickList.ts";
import type { TickItem } from "../../components/tickList.ts";
import { toolView } from "../../components/toolPage.ts";
import type { ToolNote } from "../../components/toolPage.ts";
import type { ToolMeta } from "../types.ts";
import { copy } from "./copy.ts";
import { applyMarks, computePrivacyTuneup } from "./model.ts";
import type { PrivacyTuneup } from "./model.ts";

export const meta: ToolMeta = { id: "privacy-tuneup", group: "checklists", category: "neutral", icon: "shield", needs: [] };

/** The settings in core's order, with this tool's own words. A setting core adds without words here is left out. */
function itemsOf(result: PrivacyTuneup): TickItem[] {
  const out: TickItem[] = [];
  for (const item of result.sections.flatMap((s) => s.items)) {
    const words = copy.items[item.id];
    if (words) out.push({ id: item.id, label: words.label, hint: words.hint });
  }
  return out;
}

export const view = toolView<PrivacyTuneup, Record<string, never>>({
  meta,
  copy,
  compute: computePrivacyTuneup,
  summary: (result) => copy.doneAnnounce(result.progress.total),
  render: (result, ui) => {
    // The ticks are read fresh on every repaint, so the progress follows each mark.
    const { done, applicable, percent } = applyMarks(ui.ticks, ui.data.now).progress;
    return [
      section(
        copy.progressHeading,
        meterBlock({ name: copy.meterName, label: copy.progressLabel, value: applicable > 0 ? done / applicable : 0, valueText: copy.progressText(done, applicable) }),
        statGrid(
          stat(copy.doneHeader, copy.unitOf(done, applicable), { icon: "check", accent: true }),
          stat(copy.leftHeader, String(applicable - done), { icon: "list" }),
          stat(copy.percentHeader, copy.unitPercent(percent), { icon: "overview" }),
        ),
      ),
      section(copy.listHeading, tickList(ui, meta.id, itemsOf(result))),
    ];
  },
  notes: (_result, ui): ToolNote[] => {
    const { notes: found } = applyMarks(ui.ticks, ui.data.now);
    const notes: ToolNote[] = [
      { kind: "info", text: copy.menusNote },
      { kind: "info", text: copy.generalNote },
    ];
    if (found.some((n) => n.code === "nothing_reviewed_yet")) notes.unshift({ kind: "info", text: copy.nothingMarkedNote });
    if (found.some((n) => n.code === "all_reviewed")) notes.unshift({ kind: "info", text: copy.allDoneNote });
    return notes;
  },
  command: "privacy",
});
