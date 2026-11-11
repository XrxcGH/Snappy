/**
 * A drop that is refused (a read is already going, or a ZIP came with a folder) is said twice: spoken through the polite
 * live region, and written on screen at the top of the window in the toast's look for a few seconds. Every path that
 * refuses a drop uses this one helper, so the Start page's own drop zone and a drop anywhere on the page cannot differ.
 * The on-screen note is not a live region, because announce() already speaks it. Nothing is stored.
 */
import { announce } from "./announce.ts";
import { h } from "./dom.ts";

/** How long the refusal of a drop stays on screen. */
export const REFUSAL_MS = 5000;

let host: HTMLElement | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

/** Say a refusal, spoken and on screen. */
export function refuse(text: string): void {
  announce(text);
  if (typeof document === "undefined") return;
  if (host === null || host.parentNode === null) {
    host = h("div", { class: "toast-host drop-refusal" });
    document.body.appendChild(host);
  }
  host.replaceChildren(h("div", { class: "toast" }, h("p", { class: "toast-text" }, text)));
  clearTimeout(timer);
  const shown = host;
  timer = setTimeout(() => shown.replaceChildren(), REFUSAL_MS);
}

/** Take the on-screen note away at once (the page that showed it is gone). */
export function clearRefusal(): void {
  clearTimeout(timer);
  host?.remove();
  host = null;
}
