import type { Candidate } from "@snappy-export/core";
import { analyze, filterCandidates, sortCandidates } from "../analysis.ts";
import type { Analysis, QueueSort } from "../analysis.ts";
import type { Actions } from "../actions.ts";
import { announce } from "../announce.ts";
import { copyText } from "../clipboard.ts";
import { categories, cleanup, common, routes } from "../copy.ts";
import { lists } from "../copy-lists.ts";
import { platform } from "../platform.ts";
import { h } from "../dom.ts";
import type { Child } from "../dom.ts";
import { button, profileLink, routeLink } from "../components/button.ts";
import { candidateRow } from "../components/candidateRow.ts";
import { clearSearches, listSearch, searchQuery, setSearchQuery } from "../components/listSearch.ts";
import { categoryOfCandidate, categoryTag } from "../components/category.ts";
import { confidenceBadge } from "../components/confidenceBadge.ts";
import { icon } from "../components/icon.ts";
import { listActions } from "../components/listActions.ts";
import { disclosureSummary, emptyState, pageHeader, slideIn } from "../components/layout.ts";
import { notice } from "../components/notice.ts";
import { pagedList, resetPaging } from "../components/pagedList.ts";
import { toastHost } from "../components/toast.ts";
import { progressBar } from "../components/progressBar.ts";
import { usernameChip } from "../components/usernameChip.ts";
import { displayUsername } from "../safe.ts";
import { region } from "../reactive.ts";
import type { CleanupView } from "../reducer.ts";
import { dataDeps } from "./context.ts";
import type { View, ViewContext } from "./context.ts";

/** Whether the "Protected" disclosure is open. Kept here so a Keep click does not close it again. */
let protectedOpen = false;

/** The list's key for the username search, and the chosen order. In memory only, like the filters beside them; "Clear filters" resets both. */
const QUEUE = "queue";
let queueSort: QueueSort = "likely";

export const cleanupView: View = (ctx) =>
  h(
    "div",
    { class: "view cat-cleanup" },
    pageHeader(routes.cleanup.title, cleanup.lead, { icon: "queue", category: "cleanup" }),
    toastHost(),
    region(ctx.store, (s) => [...dataDeps(s), s.cleanup], (s) => render(ctx, analyze(s), s.cleanup), { className: "region region-tight" }),
  );

function render(ctx: ViewContext, a: Analysis, view: CleanupView): Child[] {
  const { actions } = ctx;
  if (a.source === "none") {
    return [emptyState({ icon: "queue", spot: "import", category: "cleanup", title: cleanup.emptyTitle, body: cleanup.emptyBody, actions: [routeLink("start", common.addExport, "primary")] })];
  }
  // An export was read and the queue is empty: say so, and point to the next step rather than the first one.
  if (a.queue.summary.total === 0) {
    return [emptyState({ icon: "check", spot: "overview", category: "cleanup", title: cleanup.nothingFound, body: cleanup.nothingFoundBody, actions: [routeLink("start", common.addExport, "primary")] })];
  }

  const all = a.queue.items;
  const total = all.length;
  const kept = a.workspace.allowlist.length;
  const protectedItems = a.queue.protectedItems;

  // Typing in the search box or choosing an order repaints only this block, so the box keeps focus and the selects stay put.
  const slot = h("div", { class: "queue-slot" });
  const paintSlot = (): string => {
    const shown = sortCandidates(filterCandidates(all, { ...view, query: searchQuery(QUEUE) }), queueSort);
    const summary = summaryLine(shown.length, total, kept);
    slot.replaceChildren(...listParts(ctx, a, view, shown, summary));
    return shown.length === 0 ? noMatchText(view) : summary;
  };
  paintSlot();

  return [
    // The 30-day protection only works when chat and Snap events were read. When they were not, that is a
    // warning and comes first. When they were, the quiet note about it follows the list, so the top of the
    // page holds the one warning that matters before any action (two notices at most above the fold).
    a.hasChats ? null : notice("warning", cleanup.noChatProtection(a.source === "ledger")),
    controls(actions, view, {
      onSearch: (query) => {
        setSearchQuery(QUEUE, query);
        resetPaging();
        announce(paintSlot());
      },
      onSort: (order) => {
        queueSort = order;
        resetPaging();
        paintSlot();
      },
    }),
    slot,
    a.hasChats ? notice("info", cleanup.protectedByChats) : null,
    protectedItems.length > 0 ? protectedSection(actions, protectedItems, !a.sample) : null,
  ];
}

/** Whether anything narrows or reorders the list. */
const filtersActive = (view: CleanupView): boolean => view.category !== "all" || view.confidence !== "all" || searchQuery(QUEUE).trim() !== "" || queueSort !== "likely";

/** Why nobody is shown: the search alone has its own words; otherwise a filter is the reason. */
const noMatchText = (view: CleanupView): string => (view.category === "all" && view.confidence === "all" ? lists.noMatchSearch : cleanup.noMatch);

/** Back to the whole queue: every filter, the search and the order. */
function clearFilters(actions: Actions): void {
  clearSearches();
  queueSort = "likely";
  resetPaging();
  // The store change repaints the whole page, which reads the cleared search and order.
  actions.setCleanupView({ category: "all", confidence: "all" });
}

/** What sits under the controls: the count line, the warning, Save and Copy, and the rows. */
function listParts(ctx: ViewContext, a: Analysis, view: CleanupView, shown: readonly Candidate[], summary: string): HTMLElement[] {
  const { actions } = ctx;
  return [
    h("p", { class: "summary", role: "status" }, summary),
    // The consequence is stated before any action, in both modes.
    notice("warning", cleanup.removalWarning),
    listActions(shown, { fileName: cleanup.csvFile }),
    shown.length === 0
      ? h(
          "div",
          { class: "empty-inline" },
          h("p", {}, noMatchText(view)),
          filtersActive(view) ? h("div", { class: "actions" }, button({ label: lists.clearFiltersButton, key: "clear-filters", onclick: () => clearFilters(actions) })) : null,
        )
      : view.guided
        ? guidedPanel(ctx, a, shown)
        : pagedList(shown, (candidate, index) => candidateRow({ candidate, actions, index, profileLinks: !a.sample, showCategory: true }), { key: "queue-review", className: "rows candidate-list" }),
  ];
}

/** "43 people to review", and once someone is on the keep list, ", 1 kept". */
const summaryLine = (shown: number, total: number, kept: number): string => (kept > 0 ? lists.summaryKept(cleanup.summary(shown, total), kept) : cleanup.summary(shown, total));

function selectField(id: string, label: string, key: string, value: string, options: [string, string][], onChange: (value: string) => void): HTMLElement {
  const select = h(
    "select",
    { id, class: "input", "data-key": key },
    ...options.map(([v, text]) => h("option", { value: v, selected: v === value }, text)),
  );
  select.addEventListener("change", () => onChange(select.value));
  // The select draws no native arrow: the chevron is its own icon, 12 px or more from the right edge.
  const chevron = icon("chevron-right", 16);
  chevron.setAttribute("class", "icon select-chevron");
  return h("div", { class: "field" }, h("label", { class: "label", for: id }, label), h("div", { class: "select-wrap" }, select, chevron));
}

interface ControlHandlers {
  onSearch: (query: string) => void;
  onSort: (order: QueueSort) => void;
}

function controls(actions: Actions, view: CleanupView, handlers: ControlHandlers): HTMLElement {
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
  const sortOptions = (Object.keys(lists.sortOptions) as QueueSort[]).map((order): [string, string] => [order, lists.sortOptions[order]]);
  return h(
    "div",
    { class: "controls" },
    h(
      "div",
      { class: "filters", role: "group", "aria-label": cleanup.filtersLabel },
      selectField("filter-category", cleanup.categoryLabel, "filter-category", view.category, categoryOptions, (v) => actions.setCleanupView({ category: v as CleanupView["category"] })),
      selectField("filter-confidence", cleanup.confidenceLabel, "filter-confidence", view.confidence, confidenceOptions, (v) => actions.setCleanupView({ confidence: v as CleanupView["confidence"] })),
      selectField("filter-sort", lists.sortLabel, "filter-sort", queueSort, sortOptions, (v) => handlers.onSort(v as QueueSort)),
    ),
    listSearch({ listKey: QUEUE, onChange: handlers.onSearch }),
    h(
      "div",
      { class: "segmented", role: "group", "aria-label": cleanup.modeLabel },
      button({ label: cleanup.modeReview, key: "mode-review", pressed: !view.guided, onclick: () => actions.setCleanupView({ guided: false }) }),
      button({ label: cleanup.modeGuided, key: "mode-guided", pressed: view.guided, onclick: () => actions.setCleanupView({ guided: true }) }),
    ),
  );
}

function guidedPanel(ctx: ViewContext, a: Analysis, items: readonly Candidate[]): HTMLElement {
  const { actions } = ctx;
  const checked = new Set(a.workspace.checkedOff);
  const done = items.filter((c) => checked.has(c.key)).length;
  const text = cleanup.progressText(done, items.length);

  return h(
    "section",
    { class: "guided", "aria-label": cleanup.guidedLabel },
    // With no profile link to open (the desktop app, the sample data) the note says to copy the username instead.
    h("p", {}, profileLinksShown(a) ? cleanup.guidedNote : lists.guidedNoteNoLinks),
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
      (candidate, index) => guidedRow(actions, candidate, checked.has(candidate.key), items, a, index, profileLinksShown(a)),
      { key: "queue-guided", className: "rows guided-list" },
    ),
  );
}

/** Whether the rows show an "Open profile" link: never for sample names, and not where the shell turned links off. */
const profileLinksShown = (a: Analysis): boolean => !a.sample && platform().profileLinks !== false;

/** A labeled Copy button, for a guided row that has no profile link: copying the name is then the way to find the person. */
function copyUsernameLabeled(username: string): HTMLButtonElement {
  const user = displayUsername(username);
  return button({
    label: lists.copyUsernameButton,
    ariaLabel: common.copyUsername(user),
    icon: "copy",
    key: `copy:${username}`,
    onclick: () => void copyText(username).then((ok) => announce(ok ? common.copiedUsername(user) : common.copyFailed)),
  });
}

function guidedRow(actions: Actions, candidate: Candidate, isDone: boolean, items: readonly Candidate[], a: Analysis, index: number, profileLinks: boolean): HTMLElement {
  const user = displayUsername(candidate.key);
  const link = profileLinks ? profileLink(candidate.key, "secondary") : null;
  const box = h("input", { type: "checkbox", class: "check-input", checked: isDone, "aria-label": cleanup.doneFor(user), "data-key": `done:${candidate.key}` });
  box.addEventListener("change", () => {
    actions.toggleChecked(candidate.key);
    const checked = new Set(a.workspace.checkedOff);
    if (box.checked) checked.add(candidate.key);
    else checked.delete(candidate.key);
    const done = items.filter((c) => checked.has(c.key)).length;
    announce(cleanup.doneAnnounce(user, box.checked, cleanup.progressText(done, items.length)));
  });
  const cat = categoryOfCandidate(candidate.category);
  return slideIn(
    h(
      "li",
      { class: `${isDone ? "guided-row is-done" : "guided-row"} bar-left cat-${cat}` },
      h("label", { class: "check" }, box, h("span", {}, cleanup.done)),
      // The icon-only copy chip stays where a link is shown; without a link the labeled button replaces it.
      h("div", { class: "guided-who" }, usernameChip(candidate.key, { copy: link !== null, key: `copy:${candidate.key}` }), confidenceBadge(candidate.confidence), categoryTag(cat, categories[candidate.category].label)),
      h("div", { class: "candidate-actions" }, link ?? copyUsernameLabeled(candidate.key)),
    ),
    index,
  );
}

function protectedSection(actions: Actions, items: readonly Candidate[], profileLinks: boolean): HTMLElement {
  const details = h(
    "details",
    { class: "protected" },
    disclosureSummary(cleanup.protectedHeading(items.length), "protected-summary"),
    h("p", {}, cleanup.protectedBody),
    pagedList(items, (candidate, index) => candidateRow({ candidate, actions, mode: "protected", index, profileLinks, showCategory: true }), { key: "queue-protected", className: "rows candidate-list" }),
  );
  details.open = protectedOpen;
  details.addEventListener("toggle", () => {
    protectedOpen = details.open;
  });
  return details;
}
