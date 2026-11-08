/**
 * The words of the tool plumbing that copy.ts does not hold: the command line tool section of the Export guide,
 * the notes under command blocks, the Tools hub search, the time zone caption and the terminal's Close all.
 * copy.ts keeps the original strings, and this file holds what was added with them. Same voice rules
 * (docs/BRAND.md), same lint (test/copy-lint.test.ts reads every src/copy-*.ts file). Text here never
 * contains export values; views insert usernames and counts with textContent.
 */

import { platform } from "./platform.ts";

/** Wording that differs inside the desktop app, chosen when the text is read (see copy.ts). */
const onDesktop = (web: string, desktop: string): string => (platform().desktop === undefined ? web : desktop);

export const cliTool = {
  heading: "Command line tool",
  body: "Some jobs need the Snappy command line tool, a separate program that runs in a terminal. Node 22.18 or later must be installed.",
  where: "You get it from the Snappy repository on GitHub, which has the install steps.",
  /** Which words every command here starts with, so a person knows what to type after installing. */
  prefixLine: (prefix: string): string => `Commands on this page start with ${prefix}.`,
  get appLine(): string {
    return onDesktop(
      "Run tries a command in this page, using a small temporary space for its files. Copy is for the terminal.",
      "Run tries a command in this window, using a small temporary space for its files. Copy is for the terminal.",
    );
  },
  /** The link under a command block that leads to the section above. */
  linkLabel: "Get the command line tool",
};

export const commandNotes = {
  /** Under a command block on a page whose controls change the result: the command cannot read those controls. */
  defaultView: "The command shows the default view.",
  /** Under a command that cannot run here, because it reads a folder or a file this page cannot open. */
  needsTerminal: "This needs a terminal.",
  /** The name of the command text while it scrolls sideways and can be focused. */
  textLabel: "Command text",
};

export const hubSearch = {
  label: "Find a tool",
  placeholder: "Part of a name",
  /** The summary beside the field and the spoken count while someone types. */
  count: (shown: number, total: number): string => `${shown} of ${total} tools`,
  none: "No tool matches. Clear the field to see them all.",
  clear: "Clear",
  clearAria: "Clear tool search",
};

export const zone = {
  /** The caption on a page that shows dates and times: which zone they are in. */
  datesIn: (name: string): string => `Dates are in ${name}.`,
};

export const terminalTools = {
  closeAll: "Close all",
  closeAllFor: "Close all outputs",
  closedAll: "All outputs closed.",
  /** Spoken with a Run: the title of the command first, so several blocks on one page can be told apart. */
  startedFor: (title: string): string => `${title}: running`,
  /** A Copy button that stands in for a download the engine may block without a word. */
  copyFallback: "Copy text",
  copyFallbackFor: (fileName: string): string => `Copy text of ${fileName}`,
  copiedFile: "Text copied.",
  fallbackHint: "No file arrived? Copy the text instead.",
  /** Under a command that read nothing the person picked, because the sample data is showing. */
  usingSample: "Run uses the sample data.",
};
