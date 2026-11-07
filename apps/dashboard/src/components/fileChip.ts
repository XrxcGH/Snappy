import { announce } from "../announce.ts";
import { terminal } from "../copy.ts";
import { h } from "../dom.ts";
import { onDispose } from "../reactive.ts";
import type { TerminalSession } from "../terminal/session.ts";
import { button } from "./button.ts";

/**
 * The row under a command that reads an export: one chip that says "Choose export", or how many files
 * are chosen, and opens the file picker; and a Clear button once there are some. The files are shared by
 * every command on the page and kept in memory only. The picker opens only from a press, never by itself.
 */
export function fileChip(session: TerminalSession, options: { key: string }): HTMLElement {
  const { picked } = session;
  const input = h("input", { type: "file", accept: ".zip,application/zip", multiple: true, hidden: true, "aria-hidden": "true", tabindex: "-1" });
  const choose = button({ label: terminal.chooseButton, icon: "import", variant: "secondary", key: `${options.key}:choose`, onclick: () => input.click() });
  const clear = button({
    label: terminal.clearFilesButton,
    variant: "quiet",
    key: `${options.key}:clear`,
    onclick: () => {
      picked.clear();
      announce(terminal.filesChosen(0));
      choose.focus({ preventScroll: true });
    },
  });
  const problem = h("p", { class: "field-error", role: "status" });
  const label = choose.querySelector("span");

  const show = (): void => {
    const n = picked.count();
    if (label) label.textContent = n === 0 ? terminal.chooseButton : terminal.filesChosen(n);
    clear.hidden = n === 0;
  };

  input.addEventListener("change", () => {
    const chosen = [...(input.files ?? [])] as (Blob & { name?: string })[];
    input.value = ""; // lets the same file be chosen again
    const { added, skipped } = picked.add(chosen);
    problem.textContent = skipped > 0 && added === 0 ? terminal.notZipNote : "";
    if (added > 0) announce(terminal.filesChosen(picked.count()));
  });

  show();
  onDispose(picked.subscribe(show));
  return h("div", { class: "command-files" }, h("div", { class: "actions" }, choose, clear, input), problem);
}
