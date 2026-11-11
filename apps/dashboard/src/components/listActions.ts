/**
 * "Save list" and "Copy list" for a list of people: a spreadsheet file, or the usernames one per line. Used above the
 * Cleanup queue and above each finding list, with the rows that are showing. The file holds usernames, a category,
 * the confidence word and core's evidence sentence, nothing else (see queue-export.ts). What each button gives is said
 * to screen readers as the buttons' description, so the visible row stays one line.
 */
import type { Candidate } from "@snappy-export/core";
import { announce } from "../announce.ts";
import { copyText } from "../clipboard.ts";
import { common, cleanup } from "../copy.ts";
import { h } from "../dom.ts";
import { saveTextFile } from "../download.ts";
import { queueToCsv, queueToText } from "../queue-export.ts";
import { button } from "./button.ts";

export interface ListActionsOptions {
  /** The name of the saved file, such as "snappy-disappeared.csv". */
  fileName: string;
  /** Whether the "Profile link" column is filled in. False for sample names and where the shell has links off, like the rows. */
  profileLinks: boolean;
}

let counter = 0;

/** A button that copies one piece of text, and says so through the live region. The text is read at the moment of the press. */
export function copyTextButton(options: { label: string; text: () => string; done: string; key: string }): HTMLButtonElement {
  return button({
    label: options.label,
    icon: "copy",
    key: options.key,
    onclick: () => void copyText(options.text()).then((ok) => announce(ok ? options.done : common.copyFailed)),
  });
}

export function listActions(items: readonly Candidate[], options: ListActionsOptions): HTMLElement {
  const helpId = `list-actions-help-${++counter}`;
  const save = button({
    label: cleanup.saveList,
    icon: "export",
    key: "save-list",
    disabled: items.length === 0,
    onclick: () => announce(saveTextFile(options.fileName, queueToCsv(items, options.profileLinks), "text/csv") ? cleanup.listSaved : cleanup.saveFailed),
  });
  const copy = button({
    label: cleanup.copyList,
    icon: "copy",
    key: "copy-list",
    disabled: items.length === 0,
    onclick: () => void copyText(queueToText(items)).then((ok) => announce(ok ? cleanup.listCopied : common.copyFailed)),
  });
  save.setAttribute("aria-describedby", helpId);
  copy.setAttribute("aria-describedby", helpId);
  return h("div", { class: "list-actions" }, h("div", { class: "actions" }, save, copy), h("span", { class: "sr-only", id: helpId }, cleanup.listHelp));
}
