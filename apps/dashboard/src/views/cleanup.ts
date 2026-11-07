import type { Candidate } from "@snappy-export/core";
import { analyze, filterCandidates } from "../analysis.ts";
import type { Analysis } from "../analysis.ts";
import type { Actions } from "../actions.ts";
import { announce } from "../announce.ts";
import { copyText } from "../clipboard.ts";
import { saveTextFile } from "../download.ts";
import { categories, cleanup, common, routes } from "../copy.ts";
import { h } from "../dom.ts";
import type { Child } from "../dom.ts";
import { queueToCsv, queueToText } from "../queue-export.ts";
import { button, profileLink, routeLink } from "../components/button.ts";
import { candidateRow } from "../components/candidateRow.ts";
import { confidenceBadge } from "../components/confidenceBadge.ts";
import { disclosureSummary, emptyState, pageHeader, slideIn } from "../components/layout.ts";
import { notice } from "../components/notice.ts";
import { pagedList } from "../components/pagedList.ts";
import { progressBar } from "../components/progressBar.ts";
import { usernameChip } from "../components/usernameChip.ts";
import { displayUsername } from "../safe.ts";
import { region } from "../reactive.ts";
import type { CleanupView } from "../reducer.ts";
import { dataDeps } from "./context.ts";
import type { View, ViewContext } from "./context.ts";

/** Whether the "Protected" disclosure is open. Kept here so a Keep click does not close it again. */
let protectedOpen = false;

export const cleanupView: View = (ctx) =>
  h(
    "div",
    { class: "view" },
    pageHeader(routes.cleanup.title, cleanup.lead),
    notice("info", cleanup.note),
    region(ctx.store, (s) => [...dataDeps(s), s.cleanup], (s) => render(ctx, analyze(s), s.cleanup)),
  );

function render(ctx: ViewContext, a: Analysis, view: CleanupView): Child[] {
  const { actions } = ctx;
  if (a.source === "none") {
    return [emptyState({ icon: "queue", title: cleanup.emptyTitle, body: cleanup.emptyBody, actions: [routeLink("start", common.addExport, "primary")] })];
  }
  // An export was read and the queue is empty: say so, and point to the next step rather than the first one.
  if (a.queue.summary.total === 0) {
    return [emptyState({ icon: "check", title: cleanup.nothingFound, body: cleanup.nothingFoundBody, actions: [routeLink("start", common.addAnotherExport, "primary")] })];
  }

  const all = a.queue.items;
  const shown = filterCandidates(all, view);
  const total = all.length;
  const protectedItems = a.queue.protectedItems;

  return [
    // The 30-day protection only works when chat and Snap events were read: say which it is.
    a.hasChats ? notice("info", cleanup.protectedByChats) : notice("warning", cleanup.noChatProtection(a.source === "ledger")),
    controls(actions, view),
    h("p", { class: "summary", role: "status" }, cleanup.summary(shown.length, total)),
    // The consequence is stated before any action, in both modes.
    notice("warning", cleanup.removalWarning),
    listActions(shown),
    shown.length === 0
      ? h("p", { class: "empty-inline" }, cleanup.noMatch)
      : view.guided
        ? guidedPanel(ctx, a, shown)
        : pagedList(shown, (candidate, index) => candidateRow({ candidate, actions, index, profileLinks: !a.sample }), { key: "queue-review", className: "rows candidate-list" }),
    protectedItems.length > 0 ? protectedSection(actions, protectedItems, !a.sample) : null,
  ];
}

function selectField(id: string, label: string, key: string, value: string, options: [string, string][], onChange: (value: string) => void): HTMLElement {
  const select = h(
    "select",
    { id, class: "input", "data-key": key },
    ...options.map(([v, text]) => h("option", { value: v, selected: v === value }, text)),
  );
  select.addEventListener("change", () => onChange(select.value));
  return h("div", { class: "field" }, h("label", { class: "label", for: id }, label), select);
}

function controls(actions: Actions, view: CleanupView): HTMLElement {
  const categoryOptions: [string, string][] = [
    ["all", cleanup.allCategories],
    ...(["ghost", "one-way", "dormant"] as const).map((c): [string, string] => [c, categories[c].label]),
  ];
  const confidenceOptions: [string, string][] = [
    ["all", cleanup.allConfidences],
    ["high", common.confidenceWord.high],
    ["medium", common.confidenceWord.medium],
    ["low", common.confidenceWord.low],
  ];
  return h(
    "div",
    { class: "controls" },
    h(
      "div",
      { class: "filters", role: "group", "aria-label": cleanup.filtersLabel },
      selectField("filter-category", cleanup.categoryLabel, "filter-category", view.category, categoryOptions, (v) => actions.setCleanupView({ category: v as CleanupView["category"] })),
      selectField("filter-confidence", cleanup.confidenceLabel, "filter-confidence", view.confidence, confidenceOptions, (v) => actions.setCleanupView({ confidence: v as CleanupView["confidence"] })),
    ),
    h(
      "div",
      { class: "segmented", role: "group", "aria-label": cleanup.modeLabel },
      button({ label: cleanup.modeReview, key: "mode-review", pressed: !view.guided, onclick: () => actions.setCleanupView({ guided: false }) }),
      button({ label: cleanup.modeGuided, key: "mode-guided", pressed: view.guided, onclick: () => actions.setCleanupView({ guided: true }) }),
    ),
  );
}

function listActions(items: readonly Candidate[]): HTMLElement {
  return h(
    "div",
    { class: "list-actions" },
    h(
      "div",
      { class: "actions" },
      button({
        label: cleanup.saveList,
        icon: "export",
        key: "save-list",
        disabled: items.length === 0,
        onclick: () => announce(saveTextFile(cleanup.csvFile, queueToCsv(items), "text/csv") ? cleanup.listSaved : cleanup.saveFailed),
      }),
      button({
        label: cleanup.copyList,
        icon: "copy",
        key: "copy-list",
        disabled: items.length === 0,
        onclick: () => void copyText(queueToText(items)).then((ok) => announce(ok ? cleanup.listCopied : common.copyFailed)),
      }),
    ),
    h("p", { class: "caption muted" }, cleanup.listHelp),
  );
}

function guidedPanel(ctx: ViewContext, a: Analysis, items: readonly Candidate[]): HTMLElement {
  const { actions } = ctx;
  const checked = new Set(a.workspace.checkedOff);
  const done = items.filter((c) => checked.has(c.key)).length;
  const text = cleanup.progressText(done, items.length);

  return h(
    "section",
    { class: "guided", "aria-labelledby": "guided-title" },
    h("h2", { id: "guided-title", class: "section-title" }, cleanup.guidedHeading),
    h("p", {}, cleanup.guidedNote),
    h("div", { class: "guided-progress" }, h("p", { class: "summary", role: "status" }, text), slideIn(progressBar({ label: cleanup.progressLabel, value: done / items.length, valueText: text }), 0)),
    done > 0
      ? h(
          "div",
          { class: "actions" },
          button({
            label: cleanup.clearChecks,
            key: "clear-checks",
            onclick: () => {
              actions.clearChecked();
              announce(cleanup.checksCleared);
            },
          }),
        )
      : null,
    pagedList(
      items,
      (candidate, index) => guidedRow(actions, candidate, checked.has(candidate.key), items, a, index, !a.sample),
      { key: "queue-guided", className: "rows guided-list" },
    ),
  );
}

function guidedRow(actions: Actions, candidate: Candidate, isDone: boolean, items: readonly Candidate[], a: Analysis, index: number, profileLinks: boolean): HTMLElement {
  const user = displayUsername(candidate.key);
  const box = h("input", { type: "checkbox", class: "check-input", checked: isDone, "aria-label": cleanup.doneFor(user), "data-key": `done:${candidate.key}` });
  box.addEventListener("change", () => {
    actions.toggleChecked(candidate.key);
    const checked = new Set(a.workspace.checkedOff);
    if (box.checked) checked.add(candidate.key);
    else checked.delete(candidate.key);
    const done = items.filter((c) => checked.has(c.key)).length;
    announce(`${user}: ${box.checked ? "done" : "not done"}. ${cleanup.progressText(done, items.length)}.`);
  });
  return slideIn(
    h(
      "li",
      { class: isDone ? "guided-row is-done" : "guided-row" },
      h("label", { class: "check" }, box, h("span", {}, cleanup.done)),
      h("div", { class: "guided-who" }, usernameChip(candidate.key, { key: `copy:${candidate.key}` }), confidenceBadge(candidate.confidence), h("span", { class: "caption muted" }, categories[candidate.category].label)),
      h("div", { class: "candidate-actions" }, profileLinks ? profileLink(candidate.key, "secondary") : null),
    ),
    index,
  );
}

function protectedSection(actions: Actions, items: readonly Candidate[], profileLinks: boolean): HTMLElement {
  const details = h(
    "details",
    { class: "protected" },
    disclosureSummary(cleanup.protectedHeading(items.length), "protected-summary"),
    h("p", { class: "caption muted" }, cleanup.protectedBody),
    pagedList(items, (candidate, index) => candidateRow({ candidate, actions, mode: "protected", index, profileLinks }), { key: "queue-protected", className: "rows candidate-list" }),
  );
  details.open = protectedOpen;
  details.addEventListener("toggle", () => {
    protectedOpen = details.open;
  });
  return details;
}
