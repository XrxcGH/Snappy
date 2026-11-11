import { announce } from "../announce.ts";
import { common } from "../copy.ts";
import { lists } from "../copy-lists.ts";
import { formatCount } from "../format.ts";
import { h } from "../dom.ts";
import { button } from "./button.ts";

/** How many rows are showing per list. Survives repaints of the surrounding region (a Keep must not collapse the list). */
const shownByKey = new Map<string, number>();

/** Forget paging when a view is left, so the next visit starts at the top. */
export function resetPaging(): void {
  shownByKey.clear();
}

/** A list that asks for a skip link gets it once this many rows are showing. */
export const SKIP_FROM = 8;

export interface PagedListOptions {
  /** Identifies the list across repaints. */
  key: string;
  pageSize?: number;
  /** Class for the list element. */
  className?: string;
  /** Add a "Skip to end of list" link for keyboard users once SKIP_FROM rows or more are showing. Off by default: a short or one-control row needs none. */
  skipLink?: boolean;
  /**
   * Draw each page as a list of its own. A grid lays out every row it holds when one is added, so on a long list the cost of
   * "Show more" grew with the rows already drawn; pages that are lists of their own leave the earlier pages untouched.
   */
  pages?: boolean;
}

/** A list that renders a page of rows and a "Show more" button; long exports can hold thousands of people. */
export function pagedList<T>(items: readonly T[], renderItem: (item: T, index: number) => HTMLElement, options: PagedListOptions): HTMLElement {
  const pageSize = options.pageSize ?? 50;
  const className = options.className ?? "rows";
  const pages = options.pages === true;
  const newList = (): HTMLElement => h("ul", { class: pages ? `${className} page` : className });
  const pageLists: HTMLElement[] = [newList()];
  const footer = h("div", { class: "more" });
  const end = h("span", { class: "list-end sr-only", tabindex: "-1" }, lists.endOfList);
  const paged = h("div", { class: "paged" });
  let shown = Math.min(items.length, Math.max(shownByKey.get(options.key) ?? pageSize, pageSize));

  const paintRows = (from: number, to: number): HTMLElement | undefined => {
    let first: HTMLElement | undefined;
    for (let i = from; i < to; i++) {
      if (pages && i > 0 && i % pageSize === 0) {
        const next = newList();
        paged.insertBefore(next, options.skipLink === true ? end : footer);
        pageLists.push(next);
      }
      const row = renderItem(items[i] as T, i);
      first ??= row;
      pageLists[pageLists.length - 1]!.appendChild(row);
    }
    return first;
  };

  const paintFooter = (): void => {
    footer.replaceChildren();
    const remaining = items.length - shown;
    if (remaining <= 0) return;
    footer.append(
      h("p", { class: "caption muted" }, common.showing(formatCount(shown), formatCount(items.length))),
      button({
        label: common.showMore(Math.min(pageSize, remaining)),
        key: `more:${options.key}`,
        onclick: () => {
          const from = shown;
          shown = Math.min(items.length, shown + pageSize);
          shownByKey.set(options.key, shown);
          const first = paintRows(from, shown);
          paintFooter();
          first?.setAttribute("tabindex", "-1");
          first?.focus({ preventScroll: false });
          announce(common.showing(formatCount(shown), formatCount(items.length)));
        },
      }),
    );
  };

  // The rows go in after the container is laid out: a later page is placed before the end mark or the footer.
  paged.append(...(options.skipLink === true ? [pageLists[0]!, end, footer] : [pageLists[0]!, footer]));
  paintRows(0, shown);
  paintFooter();

  // Every row has several controls (copy, why, keep, open), so a long list is a long run of Tab stops. The link jumps to the
  // mark after the rows, so the next Tab reaches "Show more" or whatever follows the list.
  const skip = h("a", { class: "list-skip", href: "#main" }, lists.skipToEnd);
  skip.addEventListener("click", (event) => {
    event.preventDefault();
    end.focus();
  });
  if (options.skipLink === true && shown >= SKIP_FROM) paged.insertBefore(skip, pageLists[0]!);
  return paged;
}
