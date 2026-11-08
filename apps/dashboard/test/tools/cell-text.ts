/**
 * What a table cell says. A cell with a bare value and a full phrase holds both in its nodes (the value for a wide page, the
 * phrase for a phone and for assistive technology), so its textContent is the two run together. These read one or the other.
 */
import type { FakeElement } from "../fake-dom.ts";

/** The words a cell carries: the full phrase when it has one ("27 sent"), else its text. Any other element gives its text. */
export function phrase(el: FakeElement): string {
  if (el.tagName === "td" || el.tagName === "th") {
    const long = el.querySelector(".cell-long");
    if (long !== null) return long.textContent;
  }
  return el.textContent;
}

/** What a wide page shows in a cell: the bare value ("27") when it has one, else its text. Any other element gives its text. */
export function shown(el: FakeElement): string {
  if (el.tagName === "td" || el.tagName === "th") {
    const short = el.querySelector(".cell-short");
    if (short !== null) return short.textContent;
  }
  return el.textContent;
}
