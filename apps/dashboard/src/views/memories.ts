import { analyze } from "../analysis.ts";
import type { Analysis } from "../analysis.ts";
import { announce } from "../announce.ts";
import { copyText } from "../clipboard.ts";
import { common, memories, routes } from "../copy.ts";
import { h, setVar } from "../dom.ts";
import type { Child } from "../dom.ts";
import { formatBytes, formatCount, formatMonth, formatPercent, gibToBytes } from "../format.ts";
import { button, routeLink } from "../components/button.ts";
import { emptyState, pageHeader, section, slideIn, stat } from "../components/layout.ts";
import { notice } from "../components/notice.ts";
import { pairingFacts } from "../pairing-facts.ts";
import { parseCapGiB } from "../parse-input.ts";
import { region } from "../reactive.ts";
import { dataDeps } from "./context.ts";
import type { View, ViewContext } from "./context.ts";

export const memoriesView: View = (ctx) =>
  h("div", { class: "view" }, pageHeader(routes.memories.title, memories.lead), h("p", { class: "caption muted" }, memories.noMediaNote), region(ctx.store, dataDeps, (s) => render(ctx, analyze(s), s.capGiB)));

function render(ctx: ViewContext, a: Analysis, capGiB: number): Child[] {
  const addExport = routeLink("start", common.addExport, "primary");
  if (a.source === "none") return [emptyState({ icon: "memories", title: memories.noExportTitle, body: memories.noExportBody, actions: [addExport] })];
  if (a.source === "ledger") return [emptyState({ icon: "memories", title: memories.ledgerOnlyTitle, body: memories.ledgerOnly, actions: [addExport] })];
  const plan = a.plan;
  if (!plan) return [emptyState({ icon: "memories", title: memories.emptyTitle, body: memories.emptyBody, actions: [addExport] })];

  const c = plan.counts;
  return [
    section(
      memories.countsHeading,
      h(
        "dl",
        { class: "stats" },
        stat(memories.total, formatCount(c.total)),
        stat(memories.images, formatCount(c.images)),
        stat(memories.videos, formatCount(c.videos)),
        stat(memories.unknownType, formatCount(c.unknown)),
        stat(memories.dated, formatCount(c.withDate)),
        stat(memories.duplicates, formatCount(plan.duplicates.length)),
      ),
      h("p", { class: "caption muted" }, memories.duplicatesNote),
    ),
    pairingSection(a),
    storageSection(ctx, plan.meter, capGiB),
    rescueSection(),
  ];
}

/** What the export holds for the listed Memories. Counts only: no file name or path is ever shown. */
function pairingSection(a: Analysis): HTMLElement {
  const facts = pairingFacts(a.parsed, a.workspace.issues);
  if (!facts) return section(memories.pairingHeading, notice("info", memories.pairingNone));
  return section(
    memories.pairingHeading,
    h("p", {}, memories.pairingSummary(facts.listed, facts.have, facts.missing)),
    h(
      "dl",
      { class: "stats" },
      stat(memories.pairingListed, formatCount(facts.listed)),
      stat(memories.pairingHave, formatCount(facts.have)),
      stat(memories.pairingMissing, formatCount(facts.missing)),
    ),
    facts.overlays > 0 ? h("p", { class: "caption muted" }, memories.pairingOverlays(facts.overlays)) : null,
    facts.linksEmpty ? notice("info", memories.pairingLinksEmpty) : null,
    facts.missing > 0
      ? h(
          "div",
          { class: "stack" },
          h("h3", { class: "subheading" }, memories.pairingWhyHeading),
          h("ul", { class: "plain-list" }, ...memories.pairingWhy.map((text) => h("li", {}, text))),
          h("h3", { class: "subheading" }, memories.pairingTodoHeading),
          h("p", {}, memories.pairingTodo),
        )
      : null,
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
    h("div", { class: "meter-block" }, h("p", { class: "meter-text" }, text), bar),
    hasSizes ? null : notice("info", memories.noSizes),
    hasSizes && meter.unknownSizeCount > 0 ? h("p", { class: "caption muted" }, memories.unknownSizes(meter.unknownSizeCount)) : null,
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
  const form = h(
    "form",
    { class: "form form-inline", novalidate: true },
    h("div", { class: "field" }, h("label", { class: "label", for: "cap-input" }, memories.capLabel), h("p", { class: "caption muted", id: "cap-help" }, memories.capHelp), input, error),
    button({ label: memories.capUpdate, type: "submit", key: "cap-submit" }),
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

function rescueSection(): HTMLElement {
  return section(
    memories.rescueHeading,
    h("p", {}, memories.rescueBody),
    h("p", { class: "label" }, memories.rescueCommandLabel),
    h(
      "div",
      { class: "command" },
      h("pre", { class: "code" }, h("code", {}, memories.rescueCommand)),
      button({
        label: common.copy,
        icon: "copy",
        key: "copy-command",
        ariaLabel: memories.copyCommand,
        onclick: () => void copyText(memories.rescueCommand).then((ok) => announce(ok ? memories.commandCopied : common.copyFailed)),
      }),
    ),
    h("p", { class: "caption muted" }, memories.rescueNetwork),
  );
}
