/**
 * The keep list as a list: how many people are on it, a box to add a username before they ever show up in the queue,
 * and a Remove button for each name. The queue's own "Protected" section lists only people the queue would otherwise
 * show, so a kept friend who has left, been renamed or is now protected by recent chats could not be found there.
 * Names are written as text only, through displayUsername.
 */
import type { Actions } from "../actions.ts";
import { announce } from "../announce.ts";
import { common } from "../copy.ts";
import { lists } from "../copy-lists.ts";
import { h } from "../dom.ts";
import { hideInvisible, displayUsername } from "../safe.ts";
import { button } from "./button.ts";
import { detailsBody, disclosureSummary } from "./layout.ts";
import { pagedList } from "./pagedList.ts";
import { usernameText } from "./usernameChip.ts";

/** Whether the section is open. Kept here so adding or removing a name does not close it again. */
let keepOpen = false;

/** Longest username Snapchat allows is far shorter; this only stops pasted paragraphs. */
const MAX_USERNAME = 64;

/**
 * The key to keep for what was typed: trimmed and lower-cased like every username Snappy stores, with one leading "@"
 * dropped. Null when it is empty, too long, or holds spaces or hidden characters (it is one username, not a sentence).
 */
export function keepKeyFrom(typed: string): string | null {
  const name = typed.trim().replace(/^@/, "").toLowerCase();
  if (name === "" || name.length > MAX_USERNAME || /\s/.test(name) || hideInvisible(name) !== name) return null;
  return name;
}

/** What to tell someone whose username was refused: too long, or not one plain username. Null when it is accepted. */
export function keepErrorFor(typed: string): string | null {
  if (keepKeyFrom(typed) !== null) return null;
  return typed.trim().replace(/^@/, "").toLowerCase().length > MAX_USERNAME ? lists.keepAddTooLong : lists.keepAddError;
}

export function keepListSection(actions: Pick<Actions, "keep" | "unkeep">, allowlist: readonly string[]): HTMLElement {
  const input = h("input", {
    id: "keep-add",
    class: "input",
    type: "text",
    autocomplete: "off",
    spellcheck: "false",
    autocapitalize: "off",
    "aria-describedby": "keep-add-error",
    "data-key": "keep-add",
  });
  const error = h("p", { class: "field-error", id: "keep-add-error", role: "alert" });
  const form = h(
    "form",
    { class: "form form-inline keep-add", novalidate: true },
    h("label", { class: "label", for: "keep-add" }, lists.keepAddLabel),
    h("div", { class: "field-row" }, input, button({ label: lists.keepAddButton, type: "submit", key: "keep-add-submit" })),
    error,
  );
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const key = keepKeyFrom(input.value);
    if (key === null) {
      input.setAttribute("aria-invalid", "true");
      error.textContent = keepErrorFor(input.value) ?? lists.keepAddError;
      input.focus();
      return;
    }
    input.removeAttribute("aria-invalid");
    error.textContent = "";
    if (allowlist.includes(key)) {
      announce(lists.keepAlready(displayUsername(key)));
      return;
    }
    actions.keep(key);
    announce(common.kept(displayUsername(key)));
  });

  const rows =
    allowlist.length === 0
      ? h("p", { class: "muted" }, lists.keepEmpty)
      : pagedList(
          allowlist,
          (key) => {
            const user = displayUsername(key);
            return h(
              "li",
              { class: "keep-row" },
              usernameText(key),
              button({
                label: lists.keepRemoveButton,
                ariaLabel: lists.keepRemoveFor(user),
                icon: "close",
                key: `keep-remove:${key}`,
                // The last name has no Remove button left to land on: the box that adds one is next.
                focusNext: "keep-add",
                onclick: () => {
                  actions.unkeep(key);
                  announce(lists.keepRemoved(user));
                },
              }),
            );
          },
          { key: "keep-list", className: "rows keep-rows", skipLink: true },
        );

  const details = h("details", { class: "keep-list" }, disclosureSummary(lists.keepHeading(allowlist.length), "keep-list-summary"), detailsBody(h("p", {}, lists.keepBody), form, rows));
  details.open = keepOpen;
  details.addEventListener("toggle", () => {
    keepOpen = details.open;
  });
  return details;
}
