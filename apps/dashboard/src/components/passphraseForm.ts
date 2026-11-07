import { passphraseHint, settings } from "../copy.ts";
import { h, setVar } from "../dom.ts";
import { estimateStrength } from "../passphrase.ts";
import { button } from "./button.ts";

let counter = 0;

export interface PassphraseFormOptions {
  /** "unlock" asks for one passphrase; "set" asks twice and shows a strength estimate. */
  mode: "unlock" | "set";
  submitLabel: string;
  busy: boolean;
  /** Return true when the passphrase was accepted (the form clears itself). */
  onSubmit: (passphrase: string) => Promise<boolean>;
  /** Key for focus restoration. */
  key: string;
}

function field(id: string, label: string, key: string, autocomplete: string): { wrap: HTMLElement; input: HTMLInputElement } {
  const input = h("input", { id, class: "input", type: "password", autocomplete, "data-key": key, spellcheck: "false", autocapitalize: "none" });
  return { wrap: h("div", { class: "field" }, h("label", { class: "label", for: id }, label), input), input };
}

/** Passphrase entry with guidance (12 or more characters, no composition rules) and a show toggle. */
export function passphraseForm(options: PassphraseFormOptions): HTMLFormElement {
  const id = `pp${++counter}`;
  const first = field(`${id}-a`, settings.passphraseLabel, `${options.key}:a`, options.mode === "unlock" ? "current-password" : "new-password");
  const second = options.mode === "set" ? field(`${id}-b`, settings.confirmLabel, `${options.key}:b`, "new-password") : null;
  const inputs = [first.input, ...(second ? [second.input] : [])];

  const error = h("p", { class: "field-error", id: `${id}-err`, role: "alert" });
  const hint = h("p", { class: "caption muted", id: `${id}-hint` }, options.mode === "set" ? settings.passphraseHelp : "");
  const fill = h("span", { class: "meter-fill" });
  const meter = h(
    "div",
    { class: "meter strength", role: "meter", "aria-label": passphraseHint.label, "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": "0" },
    fill,
  );
  const strengthText = h("p", { class: "caption", id: `${id}-strength` }, passphraseHint.empty);
  first.input.setAttribute("aria-describedby", options.mode === "set" ? `${id}-hint ${id}-strength` : `${id}-err`);

  if (options.mode === "set") {
    first.input.addEventListener("input", () => {
      const strength = estimateStrength(first.input.value);
      const percent = Math.round(strength.fraction * 100);
      setVar(fill, "width", `${percent}%`);
      meter.setAttribute("aria-valuenow", String(percent));
      strengthText.textContent = first.input.value === "" ? passphraseHint.empty : passphraseHint[strength.level];
      meter.dataset.level = strength.level;
    });
  }

  const showId = `${id}-show`;
  const show = h("input", { id: showId, type: "checkbox", class: "check-input", "data-key": `${options.key}:show` });
  show.addEventListener("change", () => {
    for (const input of inputs) input.type = show.checked ? "text" : "password";
  });

  const submit = button({ label: options.submitLabel, variant: "primary", type: "submit", disabled: options.busy, key: `${options.key}:submit` });

  const form = h(
    "form",
    { class: "form", novalidate: true, autocomplete: "off" },
    first.wrap,
    ...(options.mode === "set" ? [hint, meter, strengthText] : []),
    second?.wrap ?? null,
    h("label", { class: "check", for: showId }, show, h("span", {}, "Show passphrase")),
    error,
    h("div", { class: "actions" }, submit),
  );

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    error.textContent = "";
    const value = first.input.value;
    if (options.mode === "set") {
      // The same rule sealWith applies (characters, not UTF-16 units: an emoji counts once).
      if (!estimateStrength(value).acceptable) {
        error.textContent = settings.tooShort;
        first.input.focus();
        return;
      }
      if (value !== second?.input.value) {
        error.textContent = settings.mismatch;
        second?.input.focus();
        return;
      }
    } else if (value === "") {
      first.input.focus();
      return;
    }
    void options.onSubmit(value).then((accepted) => {
      if (accepted) for (const input of inputs) input.value = "";
    });
  });
  return form;
}
