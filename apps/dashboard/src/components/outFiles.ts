import { announce } from "../announce.ts";
import { terminal } from "../copy.ts";
import { h } from "../dom.ts";
import { formatBytes } from "../format.ts";
import { fileNameOf, saveAll, saveFile, summarize } from "../terminal/out-folder.ts";
import type { SaveResult } from "../terminal/out-folder.ts";
import type { CommandId } from "../terminal/commands.ts";
import type { RunResult } from "../terminal/run-types.ts";
import type { TerminalSession } from "../terminal/session.ts";
import { button } from "./button.ts";
import { showNote } from "./toast.ts";

/** The first files are listed one by one; the rest are counted. */
export const LISTED_FILES = 50;

export interface OutFilesOptions {
  id: CommandId;
  result: RunResult;
  /** The stand-in time for a file that has none, for the .zip. */
  now: () => number;
  key: string;
}

/**
 * The files a command saved in the virtual folder: how many and how big, a Save button for each of the
 * first fifty, Save all as one .zip, and Clear. After a Run that was stopped it says what that did to
 * the files. Nothing leaves the page until a Save button is pressed.
 */
export function outFiles(session: TerminalSession, options: OutFilesOptions): HTMLElement | null {
  const { controller } = session;
  const files = controller.files(options.id);
  const stopped = options.result.end === "canceled" || options.result.end === "terminated";
  if (files.length === 0) return stopped ? h("p", { class: "command-hint" }, terminal.outLostNote) : null;

  const { files: count, bytes } = summarize(files);
  const problem = h("p", { class: "field-error", role: "status" });
  const report = (result: SaveResult): void => {
    problem.textContent = result === "too-big" ? terminal.outTooBigNote : result === "failed" ? terminal.outSaveFailedNote : "";
    // A failure is already written on the page, under the buttons; a save gets the same note as every other save.
    if (result === "saved") {
      announce(terminal.outSavedAnnounce);
      showNote(terminal.outSavedAnnounce);
    } else announce(problem.textContent, true);
  };

  const rows = files.slice(0, LISTED_FILES).map((file, i) =>
    h(
      "li",
      { class: "out-file" },
      h("code", { class: "out-file-name" }, file.path),
      button({ label: terminal.saveFileButton, variant: "quiet", ariaLabel: terminal.saveFileFor(fileNameOf(file.path)), key: `${options.key}:save-file:${i}`, onclick: () => report(saveFile(file)) }),
    ),
  );

  return h(
    "section",
    { class: "out-files", "aria-label": terminal.outHeading },
    h("h3", { class: "section-title" }, terminal.outHeading),
    h("p", { class: "caption" }, terminal.outCount(count, formatBytes(bytes))),
    stopped ? h("p", { class: "command-hint" }, terminal.outLostNote) : null,
    // Save all and Clear come first, then the one-by-one list: the Tab order is the reading order, and the list can be fifty stops long.
    h(
      "div",
      { class: "actions" },
      button({ label: terminal.saveAllButton, variant: "primary", key: `${options.key}:save-all`, onclick: () => report(saveAll(files, "rescued-memories", options.now())) }),
      button({ label: terminal.clearOutButton, variant: "quiet", key: `${options.key}:clear-out`, onclick: () => controller.clearFiles(options.id) }),
    ),
    problem,
    h("ul", { class: "plain-list out-list" }, ...rows, files.length > LISTED_FILES ? h("li", { class: "caption" }, terminal.outMore(files.length - LISTED_FILES)) : null),
  );
}
