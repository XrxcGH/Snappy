import { terminal } from "../copy.ts";
import { h } from "../dom.ts";
import { button } from "./button.ts";

let counter = 0;

export interface SecretPromptOptions {
  /** The command's own question, such as "Passphrase for your saved history: ". */
  question: string;
  /** Receives the answer once. The field is cleared before the answer is passed on. */
  onSubmit: (value: string) => void;
  onCancel: () => void;
  /** Key for focus restoration. */
  key: string;
}

/**
 * A passphrase question, asked outside the command's output. The field is masked, never filled in by the
 * browser, and cleared the moment it is answered. The answer goes to the command and nowhere else: it is
 * not echoed into the output, logged, or kept. Escape cancels.
 */
export function secretPrompt(options: SecretPromptOptions): HTMLFormElement {
  const id = `secret${++counter}`;
  const input = h("input", {
    id: `${id}-field`,
    class: "input",
    type: "password",
    autocomplete: "off",
    autocapitalize: "off",
    spellcheck: "false",
    "aria-describedby": `${id}-note`,
    "data-key": `${options.key}:secret`,
  });
  const cancel = (): void => {
    input.value = "";
    options.onCancel();
  };
  const form = h(
    "form",
    { class: "form card card-pad card-tint secret-prompt", novalidate: true, autocomplete: "off", "aria-labelledby": `${id}-title` },
    h("h3", { id: `${id}-title`, class: "section-title" }, terminal.secretTitle),
    h("div", { class: "field" }, h("label", { class: "label", for: `${id}-field` }, options.question.replace(/[:\s]+$/, "")), input, h("p", { id: `${id}-note`, class: "caption" }, terminal.secretNote)),
    h(
      "div",
      { class: "actions" },
      button({ label: terminal.continueButton, variant: "primary", type: "submit", key: `${options.key}:continue` }),
      button({ label: terminal.cancelButton, variant: "quiet", key: `${options.key}:cancel`, onclick: cancel }),
    ),
  );
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = input.value;
    // An empty answer is not an answer: the field stays open.
    if (value === "") {
      input.focus();
      return;
    }
    input.value = "";
    options.onSubmit(value);
  });
  form.addEventListener("keydown", (event) => {
    if ((event as KeyboardEvent).key === "Escape") {
      event.preventDefault();
      cancel();
    }
  });
  return form;
}
