import { terminal } from "../copy.ts";
import { h } from "../dom.ts";
import { button } from "./button.ts";

let counter = 0;

export interface ConfirmCardOptions {
  /** What the command writes: the saved history, or files in the virtual folder. */
  effect: "store" | "folder";
  /** The size limit of the virtual folder, in bytes (shown in megabytes). */
  outCap: number;
  onApprove: () => void;
  onCancel: () => void;
  /** Key for focus restoration. */
  key: string;
}

/**
 * The question before a command that writes. It appears every time, and the answer is never remembered.
 * The primary button is the first control, so the panel can put focus on it; Escape cancels.
 */
export function confirmCard(options: ConfirmCardOptions): HTMLElement {
  const id = `confirm${++counter}`;
  const store = options.effect === "store";
  const card = h(
    "div",
    { class: "card card-pad card-tint command-confirm", role: "group", "aria-labelledby": `${id}-title`, "aria-describedby": `${id}-body` },
    h("h3", { id: `${id}-title`, class: "section-title" }, store ? terminal.confirmStoreTitle : terminal.confirmFolderTitle),
    h("p", { id: `${id}-body` }, store ? terminal.confirmStoreBody : terminal.confirmFolderBody(Math.round(options.outCap / (1024 * 1024)))),
    h(
      "div",
      { class: "actions" },
      button({ label: store ? terminal.confirmStoreButton : terminal.confirmFolderButton, variant: "primary", key: `${options.key}:approve`, onclick: options.onApprove }),
      button({ label: terminal.cancelButton, variant: "quiet", key: `${options.key}:decline`, onclick: options.onCancel }),
    ),
  );
  card.addEventListener("keydown", (event) => {
    if ((event as KeyboardEvent).key === "Escape") {
      event.preventDefault();
      options.onCancel();
    }
  });
  return card;
}
