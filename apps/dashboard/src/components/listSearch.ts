/**
 * "Search usernames" above a list: a search box that narrows the list as you type (after 120 ms of quiet), Escape or
 * Clear empties it. What is typed is a piece of someone's username, so it is held in memory only, per list: never in
 * the address, the page title or any storage, and forgotten with the analysis when the page is locked or the data is
 * deleted. It is a plain `type="search"` input, so a page-wide "/" shortcut can find it.
 */
import { onAnalysisReset } from "../analysis.ts";
import { lists } from "../copy-lists.ts";
import { h } from "../dom.ts";
import { onDispose } from "../reactive.ts";
import { button } from "./button.ts";

/** Quiet time after the last key before the list narrows. */
export const SEARCH_DEBOUNCE_MS = 120;

const queries = new Map<string, string>();
/** Bumped whenever every search is forgotten, so a box that is being replaced does not store text typed before that. */
let epoch = 0;

/** What is typed in the search box of one list (empty when nothing). */
export const searchQuery = (listKey: string): string => queries.get(listKey) ?? "";

export function setSearchQuery(listKey: string, query: string): void {
  if (query === "") queries.delete(listKey);
  else queries.set(listKey, query);
}

/** Forget every search. Lock and Delete saved history do this through the analysis reset, and "Clear filters" does it too. */
export function clearSearches(): void {
  epoch++;
  queries.clear();
}
onAnalysisReset(clearSearches);

export interface ListSearchOptions {
  /** Names the list (and the control, for focus across a repaint of the page around it). */
  listKey: string;
  /** Called with the new text, a moment after typing stops, and at once on Clear and Escape. */
  onChange: (query: string) => void;
}

export function listSearch(options: ListSearchOptions): HTMLElement {
  const id = `search-${options.listKey}`;
  const input = h("input", {
    id,
    class: "input",
    type: "search",
    autocomplete: "off",
    spellcheck: "false",
    autocapitalize: "off",
    placeholder: lists.searchPlaceholder,
    "data-key": `search:${options.listKey}`,
  });
  input.value = searchQuery(options.listKey);

  const clear = button({ label: lists.searchClearButton, ariaLabel: lists.searchClearAria, key: `search-clear:${options.listKey}` });
  const showClear = (): void => {
    if (input.value === "") clear.setAttribute("hidden", "");
    else clear.removeAttribute("hidden");
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  let typedAt = epoch;
  const commit = (): void => {
    clearTimeout(timer);
    timer = undefined;
    options.onChange(input.value);
  };
  const reset = (): void => {
    input.value = "";
    showClear();
    commit();
    input.focus();
  };
  input.addEventListener("input", () => {
    showClear();
    clearTimeout(timer);
    typedAt = epoch;
    timer = setTimeout(commit, SEARCH_DEBOUNCE_MS);
  });
  input.addEventListener("keydown", (event) => {
    if ((event as KeyboardEvent).key !== "Escape" || input.value === "") return;
    // Escape empties the search first; the page's own Escape handling (the phone menu) is not also triggered.
    event.stopPropagation();
    event.preventDefault();
    reset();
  });
  clear.addEventListener("click", reset);
  showClear();
  // A repaint of the page around the box (a filter changed) disposes this scope before the 120 ms are up. Keep what is
  // typed, so the box that replaces this one reads it, rather than dropping it and bringing back the older search. When
  // the searches were cleared after the typing ("Clear filters", Lock, Delete data) the typed text is dropped instead.
  onDispose(() => {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
    if (typedAt === epoch) setSearchQuery(options.listKey, input.value);
  });

  return h("div", { class: "field list-search" }, h("label", { class: "label", for: id }, lists.searchLabel), h("div", { class: "search-row" }, input, clear));
}
