import type { Candidate } from "@snappy-export/core";
import { analyze, filterCandidates, sortCandidates } from "../analysis.ts";
import type { Analysis, QueueSort } from "../analysis.ts";
import type { Actions } from "../actions.ts";
import { announce } from "../announce.ts";
import { copyText } from "../clipboard.ts";
import { categories, cleanup, common, routes, tools } from "../copy.ts";
import { lists } from "../copy-lists.ts";
import { append, h } from "../dom.ts";
import type { Child } from "../dom.ts";
import { button, profileLink, profileLinksShown, routeLink } from "../components/button.ts";
import { candidateRow } from "../components/candidateRow.ts";
import { clearSearches, listSearch, searchQuery, setSearchQuery } from "../components/listSearch.ts";
import { categoryOfCandidate, categoryTag } from "../components/category.ts";
import { confidenceBadge } from "../components/confidenceBadge.ts";
import { icon } from "../components/icon.ts";
import { keepListSection } from "../components/keepListSection.ts";
import { listActions, say } from "../components/listActions.ts";
import { disclosureSummary, emptyState, pageHeader, section, slideIn } from "../components/layout.ts";
import { notice } from "../components/notice.ts";
import { pagedList, resetPaging } from "../components/pagedList.ts";
import { relatedTools } from "../components/relatedTools.ts";
import { commandBlock } from "../components/commandBlock.ts";
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
    // Disappeared needs two exports and Quiet needs chat history: zero from a check that could not run is not "all clear".
    const needsTwo = a.snapshotCount < 2;
    const unchecked = needsTwo || !a.hasChats;
    const title = unchecked ? cleanup.nothingFoundSoFar : cleanup.nothingFound;
    const body = unchecked ? cleanup.notAllChecked(needsTwo, !a.hasChats) : cleanup.nothingFoundBody;
    return [
      emptyState({ icon: "check", spot: "overview", category: "cleanup", title, body, actions: [routeLink("start", common.addExport, "primary")] }),
      keepListSection(actions, a.workspace.allowlist),
    ];
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
    slot.replaceChildren();
    append(slot, listParts(ctx, a, view, shown, summary, clear));
    return statusOf(view);
  };
  /**
   * What a change is announced as: the new count line, or "No one matches", or in guided mode the progress. A repainted
   * paragraph is not a live region (a region that did not exist before its text is often not spoken), so the change is
   * announced through the page's own live region, once, after the list has repainted.
   */
  const statusOf = (v: CleanupView): string => {
    const shown = filterCandidates(all, { ...v, query: searchQuery(QUEUE) });
    if (shown.length === 0) return noMatchText(v);
    const checked = new Set(a.workspace.checkedOff);
    return v.guided ? cleanup.progressText(shown.filter((c) => checked.has(c.key)).length, shown.length) : summaryLine(shown.length, total, kept);
  };
  /** Back to the whole queue: every filter, the search and the order. */
  const clear = (): void => {
    clearSearches();
    queueSort = "likely";
    resetPaging();
    // The store change repaints the whole page, which reads the cleared search and order.
    actions.setCleanupView({ category: "all", confidence: "all" });
    announce(statusOf({ ...view, category: "all", confidence: "all" }));
  };
  paintSlot();

  return [
    // The 30-day protection only works when chat and Snap events were read. When they were not, that is a
    // warning and comes first. When they were, the quiet note about it follows the list, so the top of the
    // page holds the one warning that matters before any action (two notices at most above the fold).
    a.hasChats ? null : notice("warning", cleanup.noChatProtection(a.source === "ledger")),
    controls(view, {
      onFilter: (patch) => {
        // A new filter is a new list: it starts at the first page, as a search or an order does.
        resetPaging();
        actions.setCleanupView(patch);
        announce(statusOf({ ...view, ...patch }));
      },
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
    keepListSection(actions, a.workspace.allowlist),
    relatedTools(["friends-backup"], lists.relatedBackupNote),
    // The same search as a command, which finds these people without saving anything to the history.
    section(tools.commandHeading, h("p", {}, lists.previewNote), commandBlock(ctx, "analyze-preview", { key: "cleanup-preview" })),
  ];
}

/** Whether anything narrows or reorders the list. */
const filtersActive = (view: CleanupView): boolean => view.category !== "all" || view.confidence !== "all" || searchQuery(QUEUE).trim() !== "" || queueSort !== "likely";

/** Why nobody is shown: the search alone has its own words; otherwise a filter is the reason. */
const noMatchText = (view: CleanupView): string => (view.category === "all" && view.confidence === "all" ? lists.noMatchSearch : cleanup.noMatch);

/** What sits under the controls: the count line, the warning, Save and Copy, and the rows. */
function listParts(ctx: ViewContext, a: Analysis, view: CleanupView, shown: readonly Candidate[], summary: string, onClear: () => void): Child[] {
  const { actions } = ctx;
  return [
    // The count line and Save and Copy share one line.
    h("div", { class: "list-bar" }, h("p", { class: "summary" }, summary), listActions(shown, { fileName: cleanup.csvFile, profileLinks: profileLinksShown(a.sample) })),
    // The consequence is stated before any action, in both modes.
    notice("warning", lists.removalNote),
    shown.length === 0 ? null : h("p", { class: "caption" }, lists.confidenceKey),
    shown.length === 0
      ? h(
          "div",
          { class: "empty-inline" },
          h("p", {}, noMatchText(view)),
          filtersActive(view) ? h("div", { class: "actions" }, button({ label: lists.clearFiltersButton, key: "clear-filters", onclick: onClear })) : null,
        )
      : view.guided
        ? guidedPanel(ctx, a, shown)
        : pagedList(shown, (candidate, index) => candidateRow({ candidate, actions, index, profileLinks: profileLinksShown(a.sample), showCategory: true }), { key: "queue-review", className: "rows candidate-list", skipLink: true }),
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
  /** A choice kept in the store: the category, the confidence or the mode. */
  onFilter: (patch: Partial<CleanupView>) => void;
  onSearch: (query: string) => void;
  onSort: (order: QueueSort) => void;
}

function controls(view: CleanupView, handlers: ControlHandlers): HTMLElement {
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
    // One row where it fits: the three lists, the search and the mode toggle on the right; in a narrower column the search and the toggle share the second row.
    { class: "controls cleanup-controls" },
    h(
      "div",
      { class: "filters", role: "group", "aria-label": cleanup.filtersLabel },
      selectField("filter-category", cleanup.categoryLabel, "filter-category", view.category, categoryOptions, (v) => handlers.onFilter({ category: v as CleanupView["category"] })),
      selectField("filter-confidence", cleanup.confidenceLabel, "filter-confidence", view.confidence, confidenceOptions, (v) => handlers.onFilter({ confidence: v as CleanupView["confidence"] })),
      selectField("filter-sort", lists.sortLabel, "filter-sort", queueSort, sortOptions, (v) => handlers.onSort(v as QueueSort)),
    ),
    listSearch({ listKey: QUEUE, onChange: handlers.onSearch }),
    h(
      "div",
      { class: "segmented", role: "group", "aria-label": cleanup.modeLabel },
      button({ label: cleanup.modeReview, key: "mode-review", pressed: !view.guided, onclick: () => handlers.onFilter({ guided: false }) }),
      button({ label: cleanup.modeGuided, key: "mode-guided", pressed: view.guided, onclick: () => handlers.onFilter({ guided: true }) }),
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
    h("p", {}, profileLinksShown(a.sample) ? cleanup.guidedNote : lists.guidedNoteNoLinks),
    h("div", { class: "guided-progress" }, h("p", { class: "summary" }, text), slideIn(progressBar({ label: cleanup.progressLabel, value: done / items.length, valueText: text }), 0)),
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
      (candidate, index) => guidedRow(actions, candidate, checked.has(candidate.key), items, a, index, profileLinksShown(a.sample)),
      { key: "queue-guided", className: "rows guided-list", skipLink: true },
    ),
  );
}

/** Whether the rows show an "Open profile" link: never for sample names, and not where the shell turned links off. */

/** A labeled Copy button, for a guided row that has no profile link: copying the name is then the way to find the person. */
function copyUsernameLabeled(username: string): HTMLButtonElement {
  const user = displayUsername(username);
  return button({
    label: lists.copyUsernameButton,
    ariaLabel: common.copyUsername(user),
    icon: "copy",
    key: `copy:${username}`,
    onclick: () => void copyText(username).then((ok) => say(ok, common.copiedUsername(user), common.copyFailed)),
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
    pagedList(items, (candidate, index) => candidateRow({ candidate, actions, mode: "protected", index, profileLinks, showCategory: true }), { key: "queue-protected", className: "rows candidate-list", skipLink: true }),
  );
  details.open = protectedOpen;
  details.addEventListener("toggle", () => {
    protectedOpen = details.open;
  });
  return details;
}
