import { h, setVar } from "../dom.ts";

export interface ProgressOptions {
  /** Accessible name. */
  label: string;
  /** 0..1, or null when the length of the work is not known. */
  value: number | null;
  /** Spoken value, for example "2 of 5 done". */
  valueText?: string;
}

/**
 * Progress is a bar, not a spinner. A known value grows the bar to its real length; an unknown
 * one shows two bars trading places slowly (reduced motion makes it a static bar).
 */
export function progressBar(options: ProgressOptions): HTMLElement {
  const track = h("div", { role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100" });
  updateProgress(track, options);
  return track;
}

/**
 * Change a bar made by progressBar without replacing it. A replaced element is a new one to
 * assistive technology, so its changing value is never announced as a change; an updated one is.
 */
export function updateProgress(track: HTMLElement, options: ProgressOptions): void {
  const known = options.value !== null;
  const pct = known ? Math.round(Math.min(1, Math.max(0, options.value ?? 0)) * 100) : 0;
  track.className = known ? "progress" : "progress progress-unknown";
  track.setAttribute("aria-label", options.label);
  if (known) track.setAttribute("aria-valuenow", String(pct));
  else track.removeAttribute("aria-valuenow");
  if (options.valueText === undefined) track.removeAttribute("aria-valuetext");
  else track.setAttribute("aria-valuetext", options.valueText);

  if (known) {
    let fill = track.querySelector<HTMLElement>(".progress-fill");
    if (fill === null) {
      fill = h("span", { class: "progress-fill" });
      track.replaceChildren(fill);
    }
    setVar(fill, "width", `${pct}%`);
  } else if (track.querySelector(".progress-slide") === null) {
    track.replaceChildren(h("span", { class: "progress-slide" }), h("span", { class: "progress-slide progress-slide-b" }));
  }
}
