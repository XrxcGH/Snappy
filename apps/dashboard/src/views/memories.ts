import { analyze } from "../analysis.ts";
import type { Analysis } from "../analysis.ts";
import { announce } from "../announce.ts";
import { common, memories, routes } from "../copy.ts";
import { h, setVar } from "../dom.ts";
import type { Child } from "../dom.ts";
import { formatBytes, formatCount, formatMonth, formatPercent, gibToBytes } from "../format.ts";
import { button, routeLink } from "../components/button.ts";
import { commandBlock } from "../components/commandBlock.ts";
import { emptyState, pageHeader, section, slideIn, stat, statGrid, subsection } from "../components/layout.ts";
import { notice } from "../components/notice.ts";
import { pairingFacts } from "../pairing-facts.ts";
import { parseCapGiB } from "../parse-input.ts";
import { region } from "../reactive.ts";
import { dataDeps } from "./context.ts";
import type { View, ViewContext } from "./context.ts";

export const memoriesView: View = (ctx) =>
  h("div", { class: "view cat-memories" }, pageHeader(routes.memories.title, memories.lead, { icon: "memories", category: "memories" }), region(ctx.store, dataDeps, (s) => render(ctx, analyze(s), s.capGiB)));

function render(ctx: ViewContext, a: Analysis, capGiB: number): Child[] {
  const addExport = routeLink("start", common.addExport, "primary");
  if (a.source === "none") return [emptyState({ icon: "memories", spot: "import", category: "memories", title: memories.noExportTitle, body: memories.noExportBody, actions: [addExport] })];
  if (a.source === "ledger") return [emptyState({ icon: "memories", spot: "memories", category: "memories", title: memories.ledgerOnlyTitle, body: memories.ledgerOnly, actions: [addExport] })];
  const plan = a.plan;
  if (!plan) return [emptyState({ icon: "memories", spot: "memories", category: "memories", title: memories.emptyTitle, body: memories.emptyBody, actions: [addExport] })];

  const c = plan.counts;
  return [
    section(
      memories.countsHeading,
      statGrid(
        stat(memories.total, formatCount(c.total), { icon: "memories", scope: "memories" }),
        stat(memories.images, formatCount(c.images), { icon: "photo", scope: "memories" }),
        stat(memories.videos, formatCount(c.videos), { icon: "video", scope: "memories" }),
        stat(memories.unknownType, formatCount(c.unknown), { icon: "file", scope: "memories" }),
        stat(memories.dated, formatCount(c.withDate), { icon: "calendar", scope: "memories" }),
        stat(memories.duplicates, formatCount(plan.duplicates.length), { icon: "copy", scope: "memories" }),
      ),
      h("p", {}, memories.duplicatesNote),
    ),
    pairingSection(a),
    storageSection(ctx, plan.meter, capGiB),
    rescueSection(ctx),
  ];
}

/** What the export holds for the listed Memories. Counts only: no file name or path is ever shown. */
function pairingSection(a: Analysis): HTMLElement {
  const facts = pairingFacts(a.parsed, a.workspace.issues);
  if (!facts) return section(memories.pairingHeading, notice("info", memories.pairingNone));
  return section(
    memories.pairingHeading,
    statGrid(
      stat(memories.pairingHave, formatCount(facts.have), { icon: "file", scope: "memories" }),
      stat(memories.pairingMissing, formatCount(facts.missing), { icon: "file-missing", scope: "memories" }),
      stat(memories.pairingOverlayLabel, formatCount(facts.overlays), { icon: "photo", scope: "memories" }),
    ),
    facts.overlays > 0 ? h("p", {}, memories.pairingOverlays) : null,
    facts.linksEmpty ? notice("info", memories.pairingLinksEmpty) : null,
    facts.missing > 0
      ? subsection(memories.pairingWhyHeading, h("ul", { class: "plain-list" }, ...memories.pairingWhy.map((text) => h("li", {}, text))))
      : null,
    facts.missing > 0 ? subsection(memories.pairingTodoHeading, h("p", {}, memories.pairingTodo)) : null,
  );
}

function storageSection(ctx: ViewContext, meter: NonNullable<Analysis["plan"]>["meter"], capGiB: number): HTMLElement {
  const hasSizes = meter.knownBytes > 0;
  const percent = formatPercent(meter.fractionOfCap);
  const text = memories.meterText(formatBytes(meter.knownBytes), formatBytes(gibToBytes(capGiB)), percent);

  const fill = h("span", { class: "meter-fill meter-accent" });
  setVar(fill, "width", `${Math.min(100, Math.round(meter.fractionOfCap * 100))}%`);
  const bar = slideIn(
    h(
      "div",
      { class: "meter meter-large", role: "meter", "aria-label": memories.meterLabel, "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(Math.min(100, Math.round(meter.fractionOfCap * 100))), "aria-valuetext": text },
      fill,
    ),
    0,
  );

  return section(
    memories.meterHeading,
    capForm(ctx, capGiB),
    h("div", { class: "meter-block" }, h("p", { class: "meter-head" }, h("span", { class: "meter-name" }, memories.meterName), " ", h("span", { class: "meter-text" }, text)), bar),
    hasSizes ? null : notice("info", memories.noSizes),
    hasSizes && meter.unknownSizeCount > 0 ? h("p", {}, memories.unknownSizes(meter.unknownSizeCount)) : null,
    hasSizes ? h("p", {}, meter.fractionOfCap >= 1 ? memories.overCap : meter.projectedCapAt !== null ? memories.projection(formatMonth(meter.projectedCapAt)) : memories.noProjection) : null,
  );
}

function capForm(ctx: ViewContext, capGiB: number): HTMLElement {
  const input = h("input", {
    id: "cap-input",
    class: "input input-narrow",
    type: "text",
    inputmode: "decimal",
    autocomplete: "off",
    value: String(capGiB),
    "aria-describedby": "cap-help cap-error",
    "data-key": "cap-input",
  });
  const error = h("p", { class: "field-error", id: "cap-error", role: "alert" });
  // One row: the label above, then the small input and its button side by side. The help and any
  // error sit below the row, so the button lines up with the input and not with the help text.
  const form = h(
    "form",
    { class: "form form-inline cap-form", novalidate: true },
    h("label", { class: "label", for: "cap-input" }, memories.capLabel),
    h("div", { class: "field-row" }, input, button({ label: memories.capUpdate, type: "submit", key: "cap-submit" })),
    h("p", { id: "cap-help" }, memories.capHelp),
    error,
  );
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const gib = parseCapGiB(input.value);
    if (gib === undefined) {
      input.setAttribute("aria-invalid", "true");
      error.textContent = memories.capError;
      input.focus();
      return;
    }
    input.removeAttribute("aria-invalid");
    error.textContent = "";
    ctx.actions.setCapGiB(gib);
    announce(memories.capSet);
  });
  return form;
}

function rescueSection(ctx: ViewContext): HTMLElement {
  return section(
    memories.rescueHeading,
    h("p", {}, memories.rescueBody),
    h("p", { class: "label" }, memories.rescueCommandLabel),
    commandBlock(ctx, "memories-preview", { key: "memories-preview" }),
    commandBlock(ctx, "memories-rescue", { key: "memories-rescue" }),
  );
}
